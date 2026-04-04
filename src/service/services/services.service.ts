// services/service.service.ts
import { Types } from "mongoose";
import { MongoDBFileService } from "../files/mongodb.file.service";
import { FileEntityType } from "../../types/file.types";
import FileModel from "../../models/fileModel";
import { ServiceModel } from "../../models/service/serviceModel";
import ProviderProfileModel from "../../models/profiles/provider.profile.model";
import {
  ServicePricing,
  PricingModel,
  Service,
  ServiceDocument,
} from "../../types/services.types";
import { serviceCoverConfig } from "../../controllers/files/config/serviceCover.config";

// ─── Auto-Activation ──────────────────────────────────────────────────────────

/**
 * Delay between service creation and auto-activation.
 * Gives the admin a window to reject before the service goes live.
 * Override via AUTO_ACTIVATION_DELAY_MS env var (useful in tests).
 */
const AUTO_ACTIVATION_DELAY_MS =
  Number(process.env.AUTO_ACTIVATION_DELAY_MS) || 60 * 60 * 1000; // 1 hour

/**
 * Returns true when a service document meets every criterion required
 * for auto-activation. All fields here are set at creation time so the
 * check is synchronous.
 *
 * Criteria:
 *  - servicePricing is present (the one field that may be missing on a draft)
 *  - title, description, categoryId, providerId are guaranteed by createService guards
 */
function meetsAutoActivationCriteria(service: Partial<Service>): boolean {
  return !!service.servicePricing;
}

// ─── Pricing Validation ───────────────────────────────────────────────────────

/**
 * Validates a ServicePricing block before write.
 *
 * Rules enforced:
 *  - basePrice required when pricingModel is fixed | hourly | per_unit
 *  - basePrice must be 0 when pricingModel is free
 *  - minimumPrice only relevant for negotiable; ignored otherwise
 *  - tiers must each carry a unique tierId
 *  - discount: exactly one of rate or amount must be set (not both, not neither)
 *  - taxRate must be between 0 and 1 when present
 *  - commissionRateSnapshot must be between 0 and 1
 */
function validatePricing(pricing: Partial<ServicePricing>): void {
  const {
    pricingModel,
    basePrice,
    tiers,
    minimumPrice,
    discount,
    taxRate,
    commissionRateSnapshot,
  } = pricing;

  if (!pricingModel) {
    throw new Error("Pricing model is required");
  }

  const modelsRequiringBasePrice: PricingModel[] = [
    "fixed",
    "hourly",
    "per_unit",
  ];

  if (modelsRequiringBasePrice.includes(pricingModel)) {
    if (basePrice == null) {
      throw new Error(
        `basePrice is required for pricing model "${pricingModel}"`,
      );
    }
    if (basePrice < 0) {
      throw new Error("basePrice must be a non-negative number");
    }
  }

  if (pricingModel === "free" && basePrice != null && basePrice !== 0) {
    throw new Error("basePrice must be 0 for free services");
  }

  if (minimumPrice != null && pricingModel !== "negotiable") {
    throw new Error("minimumPrice is only valid for negotiable pricing models");
  }

  if (tiers && tiers.length > 0) {
    const tierIds = tiers.map((t) => t.tierId);
    const uniqueIds = new Set(tierIds);
    if (uniqueIds.size !== tierIds.length) {
      throw new Error("Each pricing tier must have a unique tierId");
    }
    for (const tier of tiers) {
      if (tier.basePrice < 0) {
        throw new Error(`Tier "${tier.tierId}" basePrice must be non-negative`);
      }
    }
  }

  if (discount) {
    const hasRate = discount.rate != null;
    const hasAmount = discount.amount != null;
    if (hasRate && hasAmount) {
      throw new Error("Discount must specify either rate or amount, not both");
    }
    if (!hasRate && !hasAmount) {
      throw new Error("Discount must specify either rate or amount");
    }
    if (hasRate && (discount.rate! < 0 || discount.rate! > 1)) {
      throw new Error("Discount rate must be between 0 and 1");
    }
    if (hasAmount && discount.amount! < 0) {
      throw new Error("Discount amount must be non-negative");
    }
    if (discount.expiresAt && discount.expiresAt < new Date()) {
      throw new Error("Discount expiry date must be in the future");
    }
  }

  if (taxRate != null && (taxRate < 0 || taxRate > 1)) {
    throw new Error("taxRate must be between 0 and 1");
  }

  if (
    commissionRateSnapshot != null &&
    (commissionRateSnapshot < 0 || commissionRateSnapshot > 1)
  ) {
    throw new Error("commissionRateSnapshot must be between 0 and 1");
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ServiceService {
  private fileService: MongoDBFileService;

  constructor() {
    this.fileService = new MongoDBFileService();
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  /**
   * Create a new service.
   *
   * Auto-activation:
   *   If the service meets all activation criteria at creation time,
   *   scheduledActivationAt is set to now + AUTO_ACTIVATION_DELAY_MS (1 hour).
   *   The scheduler calls processScheduledActivations() on an interval;
   *   when scheduledActivationAt has passed the service is activated without
   *   admin intervention.
   *
   *   If criteria are not met at creation (e.g. pricing omitted on a draft),
   *   scheduledActivationAt is left unset. It will be populated by updateService
   *   once pricing is added.
   *
   * Cover image linking:
   *
   *   Case A — coverImage provided in body (upload happened first, caller has fileId):
   *     serviceCoverConfig.linkFileToCreatedEntity stamps entityId on the file
   *     record and sets coverImage on the service document.
   *
   *   Case B — no coverImage in body (service created before upload, or orphan upload):
   *     We search for the most recent file uploaded by this user that has
   *     entityType: "service", label: "service_cover", and no entityId yet.
   *     We query for BOTH `entityId: null` and `entityId: { $exists: false }`
   *     because the schema may store the absent field as null or omit it entirely.
   *     If found, linkFileToCreatedEntity completes the link.
   *
   * Provider profile linking:
   *   After the service document is created, its _id is pushed into the owning
   *   ProviderProfile.serviceOfferings array via $addToSet (idempotent).
   *   This is done directly via ProviderProfileModel to avoid a circular
   *   import between ServiceService and ProviderProfileService.
   *   If the provider profile is not found the service is still returned —
   *   the link can be repaired by calling ProviderProfileService.addServiceOffering().
   */
  async createService(
    serviceData: Partial<Service>,
    submittedBy: string,
  ): Promise<Service> {
    try {
      const { title, slug, categoryId, providerId, servicePricing } =
        serviceData;

      // 1. Required field guards
      if (!title?.trim()) throw new Error("Service title is required");
      if (!categoryId) throw new Error("Category is required");
      if (!providerId) throw new Error("Provider is required");

      const trimmedTitle = title.trim();

      // 2. Duplicate title check per provider
      const existingByTitle = await ServiceModel.findOne({
        providerId,
        title: { $regex: `^${this.escapeRegex(trimmedTitle)}$`, $options: "i" },
        isDeleted: false,
      });

      if (existingByTitle) {
        throw new Error(
          `You already have a service named "${trimmedTitle}". Please choose a different title.`,
        );
      }

      // 3. Slug uniqueness — slugs are global across all providers
      if (slug) {
        const trimmedSlug = slug.trim().toLowerCase();
        const existingBySlug = await ServiceModel.findOne({
          slug: trimmedSlug,
          isDeleted: false,
        });

        if (existingBySlug) {
          throw new Error(
            `A service with slug "${trimmedSlug}" already exists`,
          );
        }
      }

      // 4. Validate pricing if provided
      if (servicePricing) {
        validatePricing(servicePricing);
      }

      // 5. Schedule auto-activation if criteria are already met.
      //    A service created without pricing starts as a draft with no schedule;
      //    the schedule is set when pricing is added via updateService.
      const scheduledActivationAt = meetsAutoActivationCriteria(serviceData)
        ? new Date(Date.now() + AUTO_ACTIVATION_DELAY_MS)
        : undefined;

      // 6. Create the service document.
      //    coverImage is intentionally excluded from the spread — it is set
      //    exclusively by linkFileToCreatedEntity below so that the file record's
      //    entityId is always stamped at the same time.
      const { coverImage: coverId, ...serviceDataWithoutCover } = serviceData;

      const service = await ServiceModel.create({
        ...serviceDataWithoutCover,
        title: trimmedTitle,
        slug: slug?.trim().toLowerCase(),
        submittedBy: new Types.ObjectId(submittedBy),
        isActive: false, // always starts inactive — activation happens via scheduler
        isDeleted: false,
        scheduledActivationAt,
      });

      // 7. Link the service to the provider's serviceOfferings array.
      //    $addToSet is idempotent — safe to call even if the ID is somehow
      //    already present. Uses ProviderProfileModel directly to avoid a
      //    circular dependency with ProviderProfileService.
      await ProviderProfileModel.findOneAndUpdate(
        { _id: new Types.ObjectId(providerId.toString()), isDeleted: false },
        { $addToSet: { serviceOfferings: service._id } },
      );

      // 8. Link the cover image
      const serviceId = service._id.toString();

      if (coverId) {
        // Case A: caller provided the fileId from a prior upload
        await serviceCoverConfig.linkFileToCreatedEntity(
          new Types.ObjectId(coverId.toString()),
          serviceId,
          submittedBy,
          this.fileService,
        );
      } else {
        // Case B: search for an orphaned cover uploaded by this user
        const orphanedCover = await FileModel.findOne({
          uploaderId: new Types.ObjectId(submittedBy),
          entityType: FileEntityType.SERVICE,
          label: "service_cover",
          $or: [{ entityId: { $exists: false } }, { entityId: null }],
          status: "active",
        }).sort({ uploadedAt: -1 });

        if (orphanedCover) {
          await serviceCoverConfig.linkFileToCreatedEntity(
            orphanedCover._id,
            serviceId,
            submittedBy,
            this.fileService,
          );
        }
      }

      const linked = await ServiceModel.findById(service._id).lean();
      return linked as Service;
    } catch (error) {
      if ((error as any).code === 11000) {
        const field = Object.keys((error as any).keyPattern || {})[0];
        if (field === "slug")
          throw new Error("A service with this slug already exists");
        throw new Error("Duplicate entry detected");
      }
      throw error instanceof Error
        ? error
        : new Error("Failed to create service");
    }
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  async getServiceById(
    serviceId: string,
    includeDetails: boolean = false,
  ): Promise<Service | null> {
    if (!Types.ObjectId.isValid(serviceId))
      throw new Error("Invalid service ID");

    const query = ServiceModel.findOne({
      _id: new Types.ObjectId(serviceId),
      isDeleted: false,
    });

    if (includeDetails) {
      query
        .populate("categoryId", "catName slug")
        .populate("providerId", "businessName locationData providerContactInfo")
        .populate("coverImage", "url thumbnailUrl uploadedAt")
        .populate("submittedBy", "name email")
        .populate("approvedBy", "name email");
    }

    return (await query.lean()) as Service | null;
  }

  async getServiceBySlug(
    slug: string,
    includeDetails: boolean = true,
  ): Promise<Service | null> {
    const query = ServiceModel.findOne({
      slug: slug.toLowerCase(),
      isDeleted: false,
    });

    if (includeDetails) {
      query
        .populate("categoryId", "catName slug")
        .populate({
          path: "providerId",
          select:
            "businessName locationData providerContactInfo isAlwaysAvailable workingHours serviceOfferings requireInitialDeposit percentageDeposit",
          populate: {
            path: "serviceOfferings",
            match: { isDeleted: false, isActive: true },
            select: "title slug coverImage servicePricing isPrivate",
            populate: {
              path: "coverImage",
              select: "url thumbnailUrl",
            },
          },
        })
        .populate("coverImage", "url thumbnailUrl uploadedAt");
    }

    return (await query.lean()) as Service | null;
  }

  async getActiveServices(
    limit: number = 50,
    skip: number = 0,
  ): Promise<{ services: Service[]; total: number; hasMore: boolean }> {
    const [services, total] = await Promise.all([
      ServiceModel.findActive()
        .limit(limit)
        .skip(skip)
        .populate("coverImage", "url thumbnailUrl")
        .populate("categoryId", "catName slug")
        .populate("providerId", "businessName")
        .sort({ createdAt: -1 })
        .lean(),
      ServiceModel.countDocuments({ isActive: true, isDeleted: false }),
    ]);

    return {
      services: services as unknown as Service[],
      total,
      hasMore: skip + services.length < total,
    };
  }

  async getServicesByProvider(
    providerId: string,
    includeInactive: boolean = false,
    limit: number = 50,
    skip: number = 0,
  ): Promise<{ services: Service[]; total: number; hasMore: boolean }> {
    if (!Types.ObjectId.isValid(providerId))
      throw new Error("Invalid provider ID");

    const query: Record<string, any> = {
      providerId: new Types.ObjectId(providerId),
      isDeleted: false,
    };
    if (!includeInactive) query.isActive = true;

    const [services, total] = await Promise.all([
      ServiceModel.find(query)
        .limit(limit)
        .skip(skip)
        .populate("coverImage", "url thumbnailUrl")
        .populate("categoryId", "catName slug")
        .sort({ createdAt: -1 })
        .lean(),
      ServiceModel.countDocuments(query),
    ]);

    return {
      services: services as Service[],
      total,
      hasMore: skip + services.length < total,
    };
  }

  async getServicesByCategory(
    categoryId: string,
    limit: number = 50,
    skip: number = 0,
  ): Promise<{ services: Service[]; total: number; hasMore: boolean }> {
    if (!Types.ObjectId.isValid(categoryId))
      throw new Error("Invalid category ID");

    const [services, total] = await Promise.all([
      ServiceModel.findByCategory(categoryId)
        .limit(limit)
        .skip(skip)
        .populate("coverImage", "url thumbnailUrl")
        .populate("providerId", "businessName locationData")
        .sort({ createdAt: -1 })
        .lean(),
      ServiceModel.countDocuments({
        categoryId: new Types.ObjectId(categoryId),
        isActive: true,
        isDeleted: false,
      }),
    ]);

    return {
      services: services as unknown as Service[],
      total,
      hasMore: skip + services.length < total,
    };
  }

  async searchServices(
    searchTerm: string,
    filters?: {
      categoryId?: string;
      providerId?: string;
      minPrice?: number;
      maxPrice?: number;
      pricingModel?: PricingModel;
      currency?: string;
    },
    limit: number = 20,
    skip: number = 0,
  ): Promise<{ services: Service[]; total: number; hasMore: boolean }> {
    if (!searchTerm?.trim()) throw new Error("Search term is required");

    const results = await ServiceModel.searchServices(
      searchTerm.trim(),
      filters,
    )
      .limit(limit)
      .skip(skip)
      .populate("coverImage", "url thumbnailUrl")
      .populate("categoryId", "catName slug")
      .populate("providerId", "businessName")
      .lean();

    const total = results.length;

    return {
      services: results as unknown as Service[],
      total,
      hasMore: results.length === limit,
    };
  }

  async getAllServices(
    limit: number = 50,
    skip: number = 0,
    includeDeleted: boolean = false,
  ): Promise<{ services: Service[]; total: number; hasMore: boolean }> {
    const query: Record<string, any> = includeDeleted
      ? {}
      : { isDeleted: false };

    const [services, total] = await Promise.all([
      ServiceModel.find(query)
        .limit(limit)
        .skip(skip)
        .populate("coverImage", "url thumbnailUrl uploadedAt")
        .populate("categoryId", "catName slug")
        .populate("providerId", "businessName")
        .populate("submittedBy", "name email")
        .populate("approvedBy", "name email")
        .sort({ createdAt: -1 })
        .lean(),
      ServiceModel.countDocuments(query),
    ]);

    return {
      services: services as Service[],
      total,
      hasMore: skip + services.length < total,
    };
  }

  // ─── Pending / Moderation Queue ───────────────────────────────────────────

  /**
   * Returns services that have been submitted but not yet approved or rejected.
   * Includes services pending auto-activation — admins can pre-emptively reject
   * before the scheduled activation fires.
   */
  async getPendingServices(
    limit: number = 50,
    skip: number = 0,
  ): Promise<{ services: Service[]; total: number; hasMore: boolean }> {
    const query = {
      approvedAt: { $exists: false },
      rejectedAt: { $exists: false },
      submittedBy: { $exists: true },
      isDeleted: false,
    };

    const [services, total] = await Promise.all([
      ServiceModel.find(query)
        .limit(limit)
        .skip(skip)
        .populate("categoryId", "catName slug")
        .populate("providerId", "businessName providerContactInfo")
        .populate("coverImage", "url thumbnailUrl")
        .populate("submittedBy", "name email")
        .sort({ createdAt: 1 }) // oldest first — review in submission order
        .lean(),
      ServiceModel.countDocuments(query),
    ]);

    return {
      services: services as Service[],
      total,
      hasMore: skip + services.length < total,
    };
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  /**
   * Update a service.
   *
   * Auto-activation rescheduling:
   *   Three cases are handled when updates arrive:
   *
   *   1. Service now meets criteria and has no schedule yet (e.g. pricing was
   *      just added to a draft) → schedule activation 1 hour from now.
   *
   *   2. Substantive change on an already-scheduled or approved service
   *      (title / description / pricing changed) → reset the activation window
   *      to 1 hour from now so the admin has a fresh review window.
   *
   *   3. Pricing removed (servicePricing set to null/undefined) → clear the
   *      schedule entirely; the service cannot auto-activate without pricing.
   *
   * Cover image linking:
   *   coverImage is stripped from the Mongoose update spread for the same
   *   reason as createService — direct spread sets coverImage without stamping
   *   entityId on the file record.
   *
   * Re-submission on content change:
   *   If an approved service's title, description, or pricing is edited, it is
   *   moved back to pending (approvedAt cleared) so an admin can re-review,
   *   and the auto-activation window is reset.
   */
  async updateService(
    serviceId: string,
    updates: Partial<Service>,
    updatedBy: string,
  ): Promise<Service | null> {
    if (!Types.ObjectId.isValid(serviceId))
      throw new Error("Invalid service ID");

    const existing = await ServiceModel.findOne({
      _id: new Types.ObjectId(serviceId),
      isDeleted: false,
    });

    if (!existing) throw new Error("Service not found");

    // Slug uniqueness — exclude current doc from the check
    if (updates.slug) {
      const trimmedSlug = updates.slug.trim().toLowerCase();
      const conflict = await ServiceModel.findOne({
        slug: trimmedSlug,
        _id: { $ne: new Types.ObjectId(serviceId) },
        isDeleted: false,
      });
      if (conflict)
        throw new Error(`A service with slug "${trimmedSlug}" already exists`);
      updates.slug = trimmedSlug;
    }

    // Title uniqueness per provider
    if (updates.title) {
      const trimmedTitle = updates.title.trim();
      const titleConflict = await ServiceModel.findOne({
        providerId: existing.providerId,
        title: { $regex: `^${this.escapeRegex(trimmedTitle)}$`, $options: "i" },
        _id: { $ne: new Types.ObjectId(serviceId) },
        isDeleted: false,
      });
      if (titleConflict) {
        throw new Error(
          `You already have a service named "${trimmedTitle}". Please choose a different title.`,
        );
      }
      updates.title = trimmedTitle;
    }

    // Validate updated pricing block
    if (updates.servicePricing) {
      validatePricing(updates.servicePricing);
    }

    // Re-submission: reset approval if substantive content changed
    const substantiveChange =
      updates.title !== undefined ||
      updates.description !== undefined ||
      updates.servicePricing !== undefined;

    const wasApproved = !!existing.approvedAt && !existing.rejectedAt;

    const moderationReset: Partial<Service> =
      substantiveChange && wasApproved
        ? { approvedAt: undefined, approvedBy: undefined, isActive: false }
        : {};

    // ── Auto-activation schedule update ──────────────────────────────────────
    //
    // Merge the pending update with the existing doc to evaluate criteria
    // against what the service will look like after the write.
    const pricingAfterUpdate =
      "servicePricing" in updates
        ? updates.servicePricing // may be null/undefined if caller is clearing it
        : existing.servicePricing;

    const mergedForCriteriaCheck: Partial<Service> = {
      ...existing.toObject(),
      ...updates,
      servicePricing: pricingAfterUpdate,
    };

    let scheduledActivationAt: Date | null | undefined;

    if (!meetsAutoActivationCriteria(mergedForCriteriaCheck)) {
      // Criteria no longer met (e.g. pricing cleared) — cancel any existing schedule
      scheduledActivationAt = null;
    } else if (substantiveChange) {
      // Substantive change on a service that was scheduled or approved —
      // reset the activation window so admin has a full hour to review again
      scheduledActivationAt = new Date(Date.now() + AUTO_ACTIVATION_DELAY_MS);
    } else if (!existing.scheduledActivationAt) {
      // Service now meets criteria for the first time (e.g. pricing just added
      // to a draft that previously had none) — schedule for the first time
      scheduledActivationAt = new Date(Date.now() + AUTO_ACTIVATION_DELAY_MS);
    }
    // else: criteria still met, no substantive change, schedule already set — leave it alone

    // Strip coverImage — handled separately below
    const { coverImage: coverId, ...updatesWithoutCover } = updates;

    const updated = await ServiceModel.findOneAndUpdate(
      { _id: new Types.ObjectId(serviceId), isDeleted: false },
      {
        ...updatesWithoutCover,
        ...moderationReset,
        // Only write scheduledActivationAt when we have a decision
        ...(scheduledActivationAt !== undefined
          ? { scheduledActivationAt }
          : {}),
      },
      { new: true, runValidators: true },
    ).lean();

    if (!updated) throw new Error("Service not found");

    // Link new cover if provided
    if (coverId) {
      await serviceCoverConfig.linkFileToCreatedEntity(
        new Types.ObjectId(coverId.toString()),
        serviceId,
        updatedBy,
        this.fileService,
      );
      return (await ServiceModel.findById(serviceId).lean()) as Service | null;
    }

    return updated as Service;
  }

  // ─── Auto-Activation ──────────────────────────────────────────────────────

  /**
   * Activates all services whose scheduledActivationAt has passed and that
   * have not been manually rejected by an admin in the interim.
   *
   * Call this on a recurring interval (e.g. every 5 minutes) from your
   * scheduler / cron job:
   *
   *   const serviceService = new ServiceService();
   *   cron.schedule("*\/5 * * * *", () => serviceService.processScheduledActivations());
   *
   * A service is skipped (not activated) if an admin has already rejected it
   * (rejectedAt is set), ensuring manual moderation always wins.
   *
   * Returns a summary of what was processed for logging / alerting.
   */
  async processScheduledActivations(): Promise<{
    activated: number;
    skippedRejected: number;
    errors: Array<{ serviceId: string; error: string }>;
  }> {
    const now = new Date();

    // Candidates: scheduled, not yet active, not deleted, not manually rejected
    const candidates = (await ServiceModel.find({
      scheduledActivationAt: { $lte: now },
      isActive: false,
      isDeleted: false,
      rejectedAt: { $exists: false },
    }).select("_id servicePricing rejectedAt")) as ServiceDocument[];

    let activated = 0;
    let skippedRejected = 0;
    const errors: Array<{ serviceId: string; error: string }> = [];

    for (const candidate of candidates) {
      // Double-check criteria at activation time — pricing could have been
      // cleared between scheduling and now
      if (!meetsAutoActivationCriteria(candidate)) {
        // Clear the stale schedule so it is not re-evaluated every run
        await ServiceModel.findByIdAndUpdate(candidate._id, {
          $unset: { scheduledActivationAt: 1 },
        });
        continue;
      }

      try {
        await ServiceModel.findByIdAndUpdate(candidate._id, {
          isActive: true,
          approvedAt: now,
          $unset: {
            scheduledActivationAt: 1,
            rejectedAt: 1,
            rejectionReason: 1,
          },
        });
        activated++;
      } catch (err) {
        errors.push({
          serviceId: candidate._id.toString(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { activated, skippedRejected, errors };
  }

  /**
   * Cancels a pending auto-activation for a service.
   * Called internally by rejectService and deleteService to ensure a
   * rejected/deleted service never fires its scheduled activation.
   */
  private async cancelScheduledActivation(
    serviceId: Types.ObjectId,
  ): Promise<void> {
    await ServiceModel.findByIdAndUpdate(serviceId, {
      $unset: { scheduledActivationAt: 1 },
    });
  }

  /**
   * Returns the auto-activation status for a service.
   * Useful for surfacing the countdown in the provider dashboard.
   */
  async getAutoActivationStatus(serviceId: string): Promise<{
    isScheduled: boolean;
    scheduledActivationAt?: Date | null;
    minutesRemaining?: number;
    meetsActivationCriteria: boolean;
  }> {
    if (!Types.ObjectId.isValid(serviceId))
      throw new Error("Invalid service ID");

    const service = await ServiceModel.findOne({
      _id: new Types.ObjectId(serviceId),
      isDeleted: false,
    }).lean();

    if (!service) throw new Error("Service not found");

    const isScheduled = !!service.scheduledActivationAt;
    const criteriaMet = meetsAutoActivationCriteria(service);
    const minutesRemaining =
      isScheduled && service.scheduledActivationAt
        ? Math.max(
            0,
            Math.ceil(
              (service.scheduledActivationAt.getTime() - Date.now()) / 60_000,
            ),
          )
        : undefined;

    return {
      isScheduled,
      scheduledActivationAt: service.scheduledActivationAt,
      minutesRemaining,
      meetsActivationCriteria: criteriaMet,
    };
  }

  // ─── Moderation ───────────────────────────────────────────────────────────

  async approveService(
    serviceId: string,
    approverId: string,
  ): Promise<Service | null> {
    if (!Types.ObjectId.isValid(serviceId))
      throw new Error("Invalid service ID");
    if (!Types.ObjectId.isValid(approverId))
      throw new Error("Invalid approver ID");

    const service = (await ServiceModel.findOne({
      _id: new Types.ObjectId(serviceId),
      isDeleted: false,
    })) as ServiceDocument | null;

    if (!service) throw new Error("Service not found");

    if (!service.servicePricing) {
      throw new Error(
        "Cannot approve a service without pricing. Ask the provider to add pricing first.",
      );
    }

    // Cancel any pending auto-activation — manual approval supersedes the schedule
    await this.cancelScheduledActivation(service._id);
    await service.approve(new Types.ObjectId(approverId));

    return (await ServiceModel.findById(serviceId).lean()) as Service | null;
  }

  async rejectService(
    serviceId: string,
    approverId: string,
    reason: string,
  ): Promise<Service | null> {
    if (!Types.ObjectId.isValid(serviceId))
      throw new Error("Invalid service ID");
    if (!Types.ObjectId.isValid(approverId))
      throw new Error("Invalid approver ID");
    if (!reason?.trim()) throw new Error("Rejection reason is required");

    const service = (await ServiceModel.findOne({
      _id: new Types.ObjectId(serviceId),
      isDeleted: false,
    })) as ServiceDocument | null;

    if (!service) throw new Error("Service not found");

    // Cancel any pending auto-activation — rejection must always win
    await this.cancelScheduledActivation(service._id);
    await service.reject(new Types.ObjectId(approverId), reason.trim());

    return (await ServiceModel.findById(serviceId).lean()) as Service | null;
  }

  // ─── Visibility ───────────────────────────────────────────────────────────

  async togglePrivateStatus(
    serviceId: string,
    updatedBy: string,
  ): Promise<Service | null> {
    if (!Types.ObjectId.isValid(serviceId))
      throw new Error("Invalid service ID");

    const service = await ServiceModel.findOne({
      _id: new Types.ObjectId(serviceId),
      isDeleted: false,
    });

    if (!service) throw new Error("Service not found");

    service.isPrivate = !service.isPrivate;
    await service.save();

    return service.toObject() as Service;
  }

  // ─── Delete / Restore ─────────────────────────────────────────────────────

  /**
   * Soft-deletes a service.
   *
   * In addition to marking the service as deleted, pulls its ID from the
   * owning ProviderProfile.serviceOfferings array so the provider's profile
   * stays in sync. The service document is retained in full for audit purposes.
   */
  async deleteService(serviceId: string, deletedBy?: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(serviceId))
      throw new Error("Invalid service ID");

    const service = (await ServiceModel.findOne({
      _id: new Types.ObjectId(serviceId),
      isDeleted: false,
    })) as ServiceDocument | null;

    if (!service) throw new Error("Service not found");

    // Cancel any pending auto-activation — a deleted service must never go live
    await this.cancelScheduledActivation(service._id);
    await service.softDelete(
      deletedBy ? new Types.ObjectId(deletedBy) : undefined,
    );

    // Keep ProviderProfile.serviceOfferings in sync
    if (service.providerId) {
      await ProviderProfileModel.findOneAndUpdate(
        { _id: service.providerId, isDeleted: false },
        { $pull: { serviceOfferings: service._id } },
      );
    }

    return true;
  }

  /**
   * Restores a soft-deleted service and re-links it to the provider's
   * serviceOfferings array.
   *
   * The service re-enters the pending queue. If it still meets activation
   * criteria, a fresh 1-hour activation window is scheduled.
   */
  async restoreService(serviceId: string): Promise<Service | null> {
    if (!Types.ObjectId.isValid(serviceId))
      throw new Error("Invalid service ID");

    const service = (await ServiceModel.findOne({
      _id: new Types.ObjectId(serviceId),
      isDeleted: true,
    })) as ServiceDocument | null;

    if (!service) throw new Error("Deleted service not found");

    // A restored service re-enters the pending queue.
    // If it still meets criteria, schedule a fresh activation window.
    service.isActive = false;
    service.approvedAt = undefined;
    service.approvedBy = undefined;

    if (meetsAutoActivationCriteria(service)) {
      (service as any).scheduledActivationAt = new Date(
        Date.now() + AUTO_ACTIVATION_DELAY_MS,
      );
    }

    await service.restore();

    // Re-link to the provider's serviceOfferings array
    if (service.providerId) {
      await ProviderProfileModel.findOneAndUpdate(
        { _id: service.providerId, isDeleted: false },
        { $addToSet: { serviceOfferings: service._id } },
      );
    }

    return (await ServiceModel.findById(serviceId).lean()) as Service | null;
  }

  async permanentlyDeleteService(serviceId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(serviceId))
      throw new Error("Invalid service ID");

    const service = await ServiceModel.findById(serviceId);
    if (!service) throw new Error("Service not found");

    // Remove from provider's serviceOfferings before hard delete
    if (service.providerId) {
      await ProviderProfileModel.findOneAndUpdate(
        { _id: service.providerId },
        { $pull: { serviceOfferings: service._id } },
        { includeSoftDeleted: true } as any,
      );
    }

    await ServiceModel.deleteOne({ _id: service._id });
    return true;
  }

  // ─── Cover Image ──────────────────────────────────────────────────────────

  async updateCoverImageId(
    serviceId: string,
    coverImageId: Types.ObjectId | null,
    updatedBy?: string,
  ): Promise<Service | null> {
    if (!Types.ObjectId.isValid(serviceId))
      throw new Error("Invalid service ID");

    if (coverImageId === null) {
      const service = await ServiceModel.findOneAndUpdate(
        { _id: new Types.ObjectId(serviceId), isDeleted: false },
        { $unset: { coverImage: 1 } },
        { new: true },
      ).lean();

      return service as Service | null;
    }

    const file = await this.fileService.getFileById(coverImageId.toString());
    if (!file) throw new Error("Cover image file not found");
    if (file.label !== "service_cover") {
      throw new Error("The provided file is not a service cover image");
    }

    const linked = await serviceCoverConfig.linkFileToCreatedEntity(
      coverImageId,
      serviceId,
      updatedBy ?? "",
      this.fileService,
    );

    if (!linked) throw new Error("Failed to link cover image");

    return (await ServiceModel.findById(serviceId).lean()) as Service | null;
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  async getServiceStats(providerId?: string): Promise<{
    totalServices: number;
    activeServices: number;
    inactiveServices: number;
    deletedServices: number;
    pendingApproval: number;
    pendingAutoActivation: number;
    approvedServices: number;
    rejectedServices: number;
    privateServices: number;
    servicesWithPricing: number;
    servicesWithCover: number;
  }> {
    const baseQuery: Record<string, any> = providerId
      ? { providerId: new Types.ObjectId(providerId) }
      : {};

    const [
      totalServices,
      activeServices,
      inactiveServices,
      deletedServices,
      pendingApproval,
      pendingAutoActivation,
      approvedServices,
      rejectedServices,
      privateServices,
      servicesWithPricing,
      servicesWithCover,
    ] = await Promise.all([
      ServiceModel.countDocuments({ ...baseQuery, isDeleted: false }),
      ServiceModel.countDocuments({
        ...baseQuery,
        isDeleted: false,
        isActive: true,
      }),
      ServiceModel.countDocuments({
        ...baseQuery,
        isDeleted: false,
        isActive: false,
      }),
      ServiceModel.countDocuments({ ...baseQuery, isDeleted: true }),
      ServiceModel.countDocuments({
        ...baseQuery,
        isDeleted: false,
        approvedAt: { $exists: false },
        rejectedAt: { $exists: false },
        submittedBy: { $exists: true },
      }),
      // Services in the auto-activation queue (scheduled, not yet fired)
      ServiceModel.countDocuments({
        ...baseQuery,
        isDeleted: false,
        isActive: false,
        rejectedAt: { $exists: false },
        scheduledActivationAt: { $exists: true, $gt: new Date() },
      }),
      ServiceModel.countDocuments({
        ...baseQuery,
        isDeleted: false,
        approvedAt: { $exists: true },
        rejectedAt: { $exists: false },
      }),
      ServiceModel.countDocuments({
        ...baseQuery,
        isDeleted: false,
        rejectedAt: { $exists: true },
      }),
      ServiceModel.countDocuments({
        ...baseQuery,
        isDeleted: false,
        isPrivate: true,
      }),
      ServiceModel.countDocuments({
        ...baseQuery,
        isDeleted: false,
        servicePricing: { $ne: null },
      }),
      ServiceModel.countDocuments({
        ...baseQuery,
        isDeleted: false,
        coverImage: { $ne: null },
      }),
    ]);

    return {
      totalServices,
      activeServices,
      inactiveServices,
      deletedServices,
      pendingApproval,
      pendingAutoActivation,
      approvedServices,
      rejectedServices,
      privateServices,
      servicesWithPricing,
      servicesWithCover,
    };
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

  async serviceExists(serviceId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(serviceId)) return false;

    return (
      (await ServiceModel.countDocuments({
        _id: new Types.ObjectId(serviceId),
        isDeleted: false,
      })) > 0
    );
  }

  async isSlugAvailable(
    slug: string,
    excludeServiceId?: string,
  ): Promise<boolean> {
    const query: Record<string, any> = {
      slug: slug.toLowerCase(),
      isDeleted: false,
    };

    if (excludeServiceId && Types.ObjectId.isValid(excludeServiceId)) {
      query._id = { $ne: new Types.ObjectId(excludeServiceId) };
    }

    return (await ServiceModel.countDocuments(query)) === 0;
  }

  async bulkUpdateServices(
    serviceIds: string[],
    updates: Partial<Service>,
  ): Promise<{ modifiedCount: number }> {
    const objectIds = serviceIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    if (objectIds.length === 0)
      throw new Error("No valid service IDs provided");

    // coverImage and scheduledActivationAt must never be bulk-set —
    // both require per-entity handling
    const {
      coverImage: _,
      scheduledActivationAt: __,
      ...safeUpdates
    } = updates as any;

    const result = await ServiceModel.updateMany(
      { _id: { $in: objectIds }, isDeleted: false },
      safeUpdates,
    );

    return { modifiedCount: result.modifiedCount };
  }

  async getCompleteService(serviceId: string): Promise<{
    service: Service | null;
    coverImage?: { url: string; thumbnailUrl?: string; uploadedAt: Date };
    category?: { id: Types.ObjectId; name: string; slug: string };
    provider?: { id: Types.ObjectId; businessName?: string };
  }> {
    if (!Types.ObjectId.isValid(serviceId))
      throw new Error("Invalid service ID");

    const service = await ServiceModel.findOne({
      _id: new Types.ObjectId(serviceId),
      isDeleted: false,
    })
      .populate("categoryId", "catName slug")
      .populate("providerId", "businessName")
      .lean();

    if (!service) return { service: null };

    const result: ReturnType<typeof this.getCompleteService> extends Promise<
      infer R
    >
      ? R
      : never = { service: service as Service };

    if (service.coverImage) {
      const file = await this.fileService.getFileById(
        service.coverImage.toString(),
      );
      if (file?.status === "active") {
        result.coverImage = {
          url: file.url,
          thumbnailUrl: file.thumbnailUrl,
          uploadedAt: file.uploadedAt,
        };
      }
    }

    const cat = service.categoryId as any;
    if (cat?._id) {
      result.category = { id: cat._id, name: cat.catName, slug: cat.slug };
    }

    const prov = service.providerId as any;
    if (prov?._id) {
      result.provider = { id: prov._id, businessName: prov.businessName };
    }

    return result;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
