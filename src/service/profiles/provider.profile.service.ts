// services/profiles/provider.profile.service.ts
import { Types } from "mongoose";
import ProviderProfileModel from "../../models/profiles/provider.profile.model";
import { ServiceModel } from "../../models/service/serviceModel";
import { ContactDetails } from "../../types/base.types";
import { Coordinates } from "../../types/location.types";
import {
  ProviderProfile,
  ProviderProfileDocument,
} from "../../types/profiles/business.profile.types";
import { ImageLinkingService } from "../files/imageLinkingService";
import {
  LocationService,
  LocationEnrichmentInput,
  WithDistance,
  locationService as defaultLocationService,
} from "../location.service";

// ─── Working Hours Validation ──────────────────────────────────────────────────

const VALID_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

// HH:MM — 00:00 to 23:59
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validateWorkingHours(
  hours: Record<string, { start: string; end: string }>,
): void {
  for (const [day, slot] of Object.entries(hours)) {
    if (!VALID_DAYS.includes(day.toLowerCase())) {
      throw new Error(
        `Invalid day "${day}". Must be one of: ${VALID_DAYS.join(", ")}`,
      );
    }
    if (!TIME_REGEX.test(slot.start)) {
      throw new Error(
        `Invalid start time "${slot.start}" for ${day}. Format must be HH:MM`,
      );
    }
    if (!TIME_REGEX.test(slot.end)) {
      throw new Error(
        `Invalid end time "${slot.end}" for ${day}. Format must be HH:MM`,
      );
    }
    if (slot.start >= slot.end) {
      throw new Error(`Start time must be before end time for ${day}`);
    }
  }
}

// ─── Profile Completeness Gate ─────────────────────────────────────────────────

/**
 * Ordered list of rules a provider must satisfy before going live.
 * Each rule carries a human-readable message returned to the caller
 * so the frontend can render an actionable checklist.
 *
 * Schema intentionally leaves these fields optional to support scaffolding
 * during role transition — this is the single enforcement point.
 */
const LIVE_REQUIRED_RULES: Array<{
  field: string;
  check: (p: ProviderProfile) => boolean;
  message: string;
}> = [
  {
    field: "providerContactInfo.primaryContact",
    check: (p) => !!p.providerContactInfo?.primaryContact?.trim(),
    message: "Primary contact number is required",
  },
  {
    field: "locationData.ghanaPostGPS",
    check: (p) => !!p.locationData?.ghanaPostGPS?.trim(),
    message: "Location (Ghana Post GPS code) is required",
  },
  {
    field: "locationData.region",
    check: (p) => !!p.locationData?.region?.trim(),
    message:
      "Location region could not be resolved — re-submit your GPS code to fix this",
  },
  {
    field: "serviceOfferings",
    check: (p) =>
      Array.isArray(p.serviceOfferings) && p.serviceOfferings.length > 0,
    message: "At least one service offering must be added",
  },
  {
    field: "isAlwaysAvailable / workingHours",
    check: (p) =>
      p.isAlwaysAvailable === true ||
      (!!p.workingHours && Object.keys(p.workingHours).length > 0),
    message:
      "Availability must be configured — set always available or add working hours",
  },
];

// ─── Types (add to your shared types if not already present) ─────────────────

export type BrowseSortBy = "distance" | "createdAt" | "businessName";
export type BrowseOrder = "asc" | "desc";

export interface BrowseProvidersFilters {
  /** Full-text search on businessName */
  q?: string;
  /** Exact match on locationData.region */
  region?: string;
  /** Exact match on locationData.city */
  city?: string;
  /** Filter to providers offering this serviceId */
  serviceId?: string;
  /** Filter to providers where isAlwaysAvailable === true */
  isAlwaysAvailable?: boolean;
  /** Filter to providers where isCompanyTrained === true */
  isCompanyTrained?: boolean;
  /** Filter to providers where locationData.isAddressVerified === true */
  isAddressVerified?: boolean;
  /**
   * Client coordinates for distance annotation + distance-based sorting.
   * When supplied, every result gets a `distanceKm` field.
   * Providers with no stored coordinates receive distanceKm: Infinity.
   */
  from?: Coordinates;
  /** Radius used to split "nearby" from "other" in the response. Default 10. */
  radiusKm?: number;
}

export interface BrowseProvidersOptions {
  sortBy?: BrowseSortBy;
  order?: BrowseOrder;
  /** 1-based page number. Default 1. */
  page?: number;
  /** Results per page. Default 20, max 100. */
  limit?: number;
}

export interface BrowseProvidersResult {
  /** All providers for this page, annotated with distanceKm when `from` is provided */
  providers: WithDistance<ProviderProfile>[] | ProviderProfile[];
  /**
   * Providers from this page that fall within `radiusKm` of `from`.
   * Empty array when no coordinates are supplied.
   */
  nearbyProviders: WithDistance<ProviderProfile>[];
  /** Total number of providers matching the filters (all pages) */
  total: number;
  /** Current page number */
  page: number;
  /** Results per page */
  limit: number;
  hasMore: boolean;
  /** The radius threshold used to define "nearby". Mirrors input. */
  radiusKm: number;
  appliedFilters: BrowseProvidersFilters & BrowseProvidersOptions;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ProviderProfileService {
  private readonly imageLinkingService: ImageLinkingService;

  /**
   * LocationService is injected so tests can supply a mock.
   * All other callers use the module-level singleton.
   */
  constructor(
    private readonly locationService: LocationService = defaultLocationService,
  ) {
    this.imageLinkingService = new ImageLinkingService();
  }

  // ─── Core CRUD ───────────────────────────────────────────────────────────────

  /**
   * Fetch by the ProviderProfile._id.
   * populate: true — loads serviceOfferings, businessGalleryImages, and the
   * parent UserProfile reference (useful for admin views).
   */
  async getProviderProfileById(
    profileId: string,
    populate: boolean = false,
  ): Promise<ProviderProfile | null> {
    if (!Types.ObjectId.isValid(profileId))
      throw new Error("Invalid profile ID");

    const query = ProviderProfileModel.findOne({
      _id: new Types.ObjectId(profileId),
      isDeleted: false,
    });

    if (populate) {
      query
        .populate("profile", "userId role bio mobileNumber profilePictureId")
        .populate("serviceOfferings", "title slug isActive servicePricing")
        .populate("businessGalleryImages", "url thumbnailUrl uploadedAt")
        .populate("idDetails.fileImageId", "url thumbnailUrl uploadedAt");
    }

    return (await query.lean()) as ProviderProfile | null;
  }

  /**
   * Fetch by the UserProfile ObjectId stored in the `profile` field.
   * This is the most common internal lookup — most callers have the
   * UserProfile._id, not the ProviderProfile._id directly.
   */
  async getProviderProfileByProfileRef(
    userProfileId: string,
    populate: boolean = false,
  ): Promise<ProviderProfile | null> {
    if (!Types.ObjectId.isValid(userProfileId)) {
      throw new Error("Invalid user profile ID");
    }

    const query = ProviderProfileModel.findOne({
      profile: new Types.ObjectId(userProfileId),
      isDeleted: false,
    });

    if (populate) {
      query
        .populate("profile", "userId role bio mobileNumber profilePictureId")
        .populate("serviceOfferings", "title slug isActive servicePricing")
        .populate("businessGalleryImages", "url thumbnailUrl uploadedAt")
        .populate("idDetails.fileImageId", "url thumbnailUrl uploadedAt");
    }

    return (await query.lean()) as ProviderProfile | null;
  }

  /**
   * General-purpose update.
   *
   * Immutable fields (profile ref, soft-delete flags) are stripped before
   * the write so a caller can safely spread a full profile object without
   * accidentally overwriting them.
   *
   * For location and contact info, prefer the dedicated methods below —
   * they run validation and enrichment that this method skips.
   */
  async updateProviderProfile(
    profileId: string,
    updates: Partial<ProviderProfile>,
    _updatedBy: string,
  ): Promise<ProviderProfile | null> {
    if (!Types.ObjectId.isValid(profileId))
      throw new Error("Invalid profile ID");

    const {
      profile: _profile,
      isDeleted: _isDeleted,
      deletedAt: _deletedAt,
      deletedBy: _deletedBy,
      ...safeUpdates
    } = updates as any;

    const updated = await ProviderProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { $set: safeUpdates },
      { new: true, runValidators: true },
    ).lean();

    if (!updated) throw new Error("Provider profile not found");
    return updated as ProviderProfile;
  }

  async deleteProviderProfile(
    profileId: string,
    deletedBy?: string,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(profileId))
      throw new Error("Invalid profile ID");

    const profile = (await ProviderProfileModel.findOne({
      _id: new Types.ObjectId(profileId),
      isDeleted: false,
    })) as ProviderProfileDocument | null;

    if (!profile) throw new Error("Provider profile not found");

    await profile.softDelete(
      deletedBy ? new Types.ObjectId(deletedBy) : undefined,
    );
    return true;
  }

  async restoreProviderProfile(
    profileId: string,
  ): Promise<ProviderProfile | null> {
    if (!Types.ObjectId.isValid(profileId))
      throw new Error("Invalid profile ID");

    const profile = (await ProviderProfileModel.findOne(
      { _id: new Types.ObjectId(profileId), isDeleted: true },
      null,
      { includeSoftDeleted: true },
    )) as ProviderProfileDocument | null;

    if (!profile) throw new Error("Deleted provider profile not found");

    await profile.restore();
    return (await ProviderProfileModel.findById(
      profileId,
    ).lean()) as ProviderProfile | null;
  }

  // ─── Onboarding: Isolated Field Updates ──────────────────────────────────────

  /**
   * Updates providerContactInfo as a unit.
   * primaryContact, if provided, must not be an empty string.
   */
  async updateContactInfo(
    profileId: string,
    contactData: Partial<ContactDetails>,
  ): Promise<ProviderProfile | null> {
    if (!Types.ObjectId.isValid(profileId))
      throw new Error("Invalid profile ID");

    if (
      contactData.primaryContact !== undefined &&
      !contactData.primaryContact.trim()
    ) {
      throw new Error("Primary contact cannot be empty");
    }

    const updated = await ProviderProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { $set: { providerContactInfo: contactData } },
      { new: true, runValidators: true },
    ).lean();

    if (!updated) throw new Error("Provider profile not found");
    return updated as ProviderProfile;
  }

  /**
   * Enriches and saves location data.
   *
   * The user provides only ghanaPostGPS (+ optional nearbyLandmark / live GPS).
   * LocationService fills in region, city, district, coordinates, etc.
   *
   * Returns the saved profile AND a missingFields list so the controller
   * can decide whether to surface a warning (e.g. "We couldn't resolve your
   * district — you can add it manually").
   */
  async updateLocationData(
    profileId: string,
    input: LocationEnrichmentInput,
  ): Promise<{ profile: ProviderProfile; missingFields: string[] }> {
    if (!Types.ObjectId.isValid(profileId))
      throw new Error("Invalid profile ID");

    const enriched = await this.locationService.enrichLocation(input);

    if (!enriched.success || !enriched.location) {
      throw new Error(enriched.error ?? "Location enrichment failed");
    }

    const updated = await ProviderProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { $set: { locationData: enriched.location } },
      { new: true, runValidators: true },
    ).lean();

    if (!updated) throw new Error("Provider profile not found");

    return {
      profile: updated as ProviderProfile,
      missingFields: enriched.missingFields ?? [],
    };
  }

  /**
   * Updates business identity fields: name, ID document metadata, training flag.
   * Does NOT update ID images — use updateIdImages() for that.
   */
  async updateBusinessInfo(
    profileId: string,
    data: {
      businessName?: string;
      idDetails?: Omit<
        NonNullable<ProviderProfile["idDetails"]>,
        "fileImageId"
      >;
      isCompanyTrained?: boolean;
    },
  ): Promise<ProviderProfile | null> {
    if (!Types.ObjectId.isValid(profileId))
      throw new Error("Invalid profile ID");

    if (data.businessName !== undefined) {
      const trimmed = data.businessName.trim();
      if (!trimmed) throw new Error("Business name cannot be empty");
      data.businessName = trimmed;
    }

    const updated = await ProviderProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { $set: data },
      { new: true, runValidators: true },
    ).lean();

    if (!updated) throw new Error("Provider profile not found");
    return updated as ProviderProfile;
  }

  /**
   * Replaces the working hours map.
   *
   * Validates day names and HH:MM time format.
   * Always sets isAlwaysAvailable: false — calling this implicitly means
   * the provider has specific hours.
   */
  async updateWorkingHours(
    profileId: string,
    workingHours: Record<string, { start: string; end: string }>,
  ): Promise<ProviderProfile | null> {
    if (!Types.ObjectId.isValid(profileId))
      throw new Error("Invalid profile ID");

    if (!workingHours || Object.keys(workingHours).length === 0) {
      throw new Error(
        "Working hours cannot be empty. " +
          "Use setAvailability({ isAlwaysAvailable: true }) instead.",
      );
    }

    validateWorkingHours(workingHours);

    const updated = await ProviderProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      {
        $set: {
          workingHours,
          isAlwaysAvailable: false, // coupled — specific hours implies not always available
        },
      },
      { new: true, runValidators: true },
    ).lean();

    if (!updated) throw new Error("Provider profile not found");
    return updated as ProviderProfile;
  }

  /**
   * Sets availability mode.
   *
   * isAlwaysAvailable: true  — clears workingHours (they are irrelevant)
   * isAlwaysAvailable: false — workingHours are required and validated
   *
   * These two fields are always written together to prevent contradictory state.
   */
  async setAvailability(
    profileId: string,
    isAlwaysAvailable: boolean,
    workingHours?: Record<string, { start: string; end: string }>,
  ): Promise<ProviderProfile | null> {
    if (!Types.ObjectId.isValid(profileId))
      throw new Error("Invalid profile ID");

    if (!isAlwaysAvailable) {
      if (!workingHours || Object.keys(workingHours).length === 0) {
        throw new Error(
          "Working hours are required when isAlwaysAvailable is false",
        );
      }
      validateWorkingHours(workingHours);
    }

    const update = isAlwaysAvailable
      ? {
          $set: { isAlwaysAvailable: true },
          $unset: { workingHours: 1 }, // stale hours have no meaning — remove them
        }
      : {
          $set: { isAlwaysAvailable: false, workingHours },
        };

    const updated = await ProviderProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      update,
      { new: true, runValidators: true },
    ).lean();

    if (!updated) throw new Error("Provider profile not found");
    return updated as ProviderProfile;
  }

  /**
   * Returns whether the provider has satisfied all requirements to go live.
   *
   * This is the single completeness gate — called by the go-live flow,
   * the onboarding checklist endpoint, and any other path that must know
   * whether the profile is ready before activating services.
   */
  async isProfileLive(profileId: string): Promise<{
    isLive: boolean;
    missingFields: string[];
  }> {
    if (!Types.ObjectId.isValid(profileId))
      throw new Error("Invalid profile ID");

    const profile = (await ProviderProfileModel.findOne({
      _id: new Types.ObjectId(profileId),
      isDeleted: false,
    }).lean()) as ProviderProfile | null;

    if (!profile) throw new Error("Provider profile not found");

    const missingFields = LIVE_REQUIRED_RULES.filter(
      (rule) => !rule.check(profile),
    ).map((rule) => rule.message);

    return {
      isLive: missingFields.length === 0,
      missingFields,
    };
  }

  // ─── Deposit Settings ─────────────────────────────────────────────────────────

  /**
   * Updates both deposit fields as a unit, mirroring the pre-save hook logic
   * explicitly at the service layer for clarity and for cases where the hook
   * does not fire (e.g. updateMany, findOneAndUpdate without runValidators).
   *
   * When requireInitialDeposit is false, percentageDeposit is always cleared.
   */
  async updateDepositSettings(
    profileId: string,
    requireInitialDeposit: boolean,
    percentageDeposit?: number,
  ): Promise<ProviderProfile | null> {
    if (!Types.ObjectId.isValid(profileId))
      throw new Error("Invalid profile ID");

    if (requireInitialDeposit) {
      if (percentageDeposit == null) {
        throw new Error(
          "percentageDeposit is required when requireInitialDeposit is true",
        );
      }
      if (percentageDeposit <= 0 || percentageDeposit > 100) {
        throw new Error("percentageDeposit must be between 1 and 100");
      }
    }

    const update = requireInitialDeposit
      ? { $set: { requireInitialDeposit: true, percentageDeposit } }
      : {
          $set: { requireInitialDeposit: false },
          $unset: { percentageDeposit: 1 },
        };

    const updated = await ProviderProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      update,
      { new: true, runValidators: true },
    ).lean();

    if (!updated) throw new Error("Provider profile not found");
    return updated as ProviderProfile;
  }

  // ─── Service Offerings ────────────────────────────────────────────────────────

  /**
   * Links a service to this provider's profile.
   * $addToSet is used for idempotency — adding the same service twice is safe.
   *
   * Ownership guard: the service's providerId must match this profileId.
   * This prevents a provider linking someone else's service to their profile.
   * (ServiceService.createService() is always the canonical creation path and
   * sets providerId automatically — this method is a repair/admin utility.)
   */
  async addServiceOffering(
    profileId: string,
    serviceId: string,
  ): Promise<ProviderProfile | null> {
    if (!Types.ObjectId.isValid(profileId))
      throw new Error("Invalid profile ID");
    if (!Types.ObjectId.isValid(serviceId))
      throw new Error("Invalid service ID");

    const service = await ServiceModel.findOne({
      _id: new Types.ObjectId(serviceId),
      isDeleted: false,
    }).lean();

    if (!service) throw new Error("Service not found");

    // Ownership guard — service must belong to this provider
    if (service.providerId?.toString() !== profileId) {
      throw new Error("This service does not belong to this provider profile");
    }

    const updated = await ProviderProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { $addToSet: { serviceOfferings: new Types.ObjectId(serviceId) } },
      { new: true, runValidators: true },
    ).lean();

    if (!updated) throw new Error("Provider profile not found");
    return updated as ProviderProfile;
  }

  async removeServiceOffering(
    profileId: string,
    serviceId: string,
  ): Promise<ProviderProfile | null> {
    if (!Types.ObjectId.isValid(profileId))
      throw new Error("Invalid profile ID");
    if (!Types.ObjectId.isValid(serviceId))
      throw new Error("Invalid service ID");

    const updated = await ProviderProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { $pull: { serviceOfferings: new Types.ObjectId(serviceId) } },
      { new: true },
    ).lean();

    if (!updated) throw new Error("Provider profile not found");
    return updated as ProviderProfile;
  }

  /**
   * Returns populated Service documents for this provider.
   * By default returns only active services — pass includeInactive: true
   * for the provider's own dashboard view.
   */
  async getServiceOfferings(
    profileId: string,
    includeInactive: boolean = false,
  ) {
    if (!Types.ObjectId.isValid(profileId))
      throw new Error("Invalid profile ID");

    const profile = (await ProviderProfileModel.findOne({
      _id: new Types.ObjectId(profileId),
      isDeleted: false,
    })
      .select("serviceOfferings")
      .lean()) as Pick<ProviderProfile, "serviceOfferings"> | null;

    if (!profile) throw new Error("Provider profile not found");
    if (!profile.serviceOfferings?.length) return [];

    const serviceQuery: Record<string, any> = {
      _id: { $in: profile.serviceOfferings },
      isDeleted: false,
    };
    if (!includeInactive) serviceQuery.isActive = true;

    return ServiceModel.find(serviceQuery)
      .populate("categoryId", "catName slug")
      .populate("coverImage", "url thumbnailUrl")
      .lean();
  }

  // ─── Gallery Images ───────────────────────────────────────────────────────────

  /**
   * Appends images to businessGalleryImages.
   * Delegates to ImageLinkingService so the File record's entityId is stamped
   * at the same time — keeps the file and profile references in sync.
   */
  async addGalleryImages(
    profileId: string,
    fileIds: Types.ObjectId[],
    _uploadedBy: string,
  ): Promise<ProviderProfile | null> {
    if (!Types.ObjectId.isValid(profileId))
      throw new Error("Invalid profile ID");
    if (!fileIds.length) throw new Error("At least one file ID is required");

    const result = await this.imageLinkingService.linkMultipleImagesToProvider(
      profileId,
      fileIds,
      "businessGalleryImages",
    );

    if (!result.linked) {
      throw new Error(result.error ?? "Failed to link gallery images");
    }

    return (await ProviderProfileModel.findById(
      profileId,
    ).lean()) as ProviderProfile | null;
  }

  async removeGalleryImage(
    profileId: string,
    fileId: string,
  ): Promise<ProviderProfile | null> {
    if (!Types.ObjectId.isValid(profileId))
      throw new Error("Invalid profile ID");
    if (!Types.ObjectId.isValid(fileId)) throw new Error("Invalid file ID");

    const updated = await ProviderProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { $pull: { businessGalleryImages: new Types.ObjectId(fileId) } },
      { new: true },
    ).lean();

    if (!updated) throw new Error("Provider profile not found");
    return updated as ProviderProfile;
  }

  /**
   * Replaces the gallery array with a caller-supplied ordered list.
   * Validates that every ID in orderedFileIds already belongs to this
   * provider's gallery before writing — prevents injection of foreign files.
   */
  async reorderGalleryImages(
    profileId: string,
    orderedFileIds: string[],
  ): Promise<ProviderProfile | null> {
    if (!Types.ObjectId.isValid(profileId))
      throw new Error("Invalid profile ID");
    if (!orderedFileIds.length)
      throw new Error("orderedFileIds cannot be empty");

    const profile = (await ProviderProfileModel.findOne({
      _id: new Types.ObjectId(profileId),
      isDeleted: false,
    })
      .select("businessGalleryImages")
      .lean()) as Pick<ProviderProfile, "businessGalleryImages"> | null;

    if (!profile) throw new Error("Provider profile not found");

    const existingIds = new Set(
      (profile.businessGalleryImages ?? []).map((id) => id.toString()),
    );

    const foreign = orderedFileIds.filter((id) => !existingIds.has(id));
    if (foreign.length > 0) {
      throw new Error("Some file IDs do not belong to this provider's gallery");
    }

    const updated = await ProviderProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      {
        businessGalleryImages: orderedFileIds.map(
          (id) => new Types.ObjectId(id),
        ),
      },
      { new: true },
    ).lean();

    if (!updated) throw new Error("Provider profile not found");
    return updated as ProviderProfile;
  }

  // ─── ID Document Images ───────────────────────────────────────────────────────

  /**
   * Attaches government ID document images to the provider's idDetails.
   *
   * Stored at idDetails.fileImageId[] — a separate array from businessGalleryImages
   * so the two image sets never mix. Both front and back scans can be stored here.
   *
   * The idDetails metadata (type, number) must be set first via updateBusinessInfo()
   * before calling this, so the image is always associated with a known document.
   *
   * Delegates to ImageLinkingService to stamp entityId on the File record,
   * consistent with how gallery images are handled.
   */
  async updateIdImages(
    profileId: string,
    fileIds: Types.ObjectId[],
    _uploadedBy: string,
  ): Promise<ProviderProfile | null> {
    if (!Types.ObjectId.isValid(profileId))
      throw new Error("Invalid profile ID");
    if (!fileIds.length) throw new Error("At least one file ID is required");

    // Verify the provider has idDetails set before linking images
    const profile = (await ProviderProfileModel.findOne({
      _id: new Types.ObjectId(profileId),
      isDeleted: false,
    })
      .select("idDetails")
      .lean()) as Pick<ProviderProfile, "idDetails"> | null;

    if (!profile) throw new Error("Provider profile not found");
    if (!profile.idDetails?.idType) {
      throw new Error(
        "ID document details (type and number) must be set before uploading ID images. " +
          "Call updateBusinessInfo() first.",
      );
    }

    const result = await this.imageLinkingService.linkMultipleImagesToProvider(
      profileId,
      fileIds,
      "idDetails.fileImageId",
    );

    if (!result.linked) {
      throw new Error(result.error ?? "Failed to link ID images");
    }

    return (await ProviderProfileModel.findById(
      profileId,
    ).lean()) as ProviderProfile | null;
  }

  /**
   * Removes a single ID image from idDetails.fileImageId.
   *
   * Does NOT delete the underlying File document — the caller must decide
   * whether to hard-delete the file after unlinking. This prevents accidental
   * data loss if the file is referenced elsewhere or needs to be re-linked.
   */
  async removeIdImage(
    profileId: string,
    fileId: string,
  ): Promise<ProviderProfile | null> {
    if (!Types.ObjectId.isValid(profileId))
      throw new Error("Invalid profile ID");
    if (!Types.ObjectId.isValid(fileId)) throw new Error("Invalid file ID");

    const updated = await ProviderProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { $pull: { "idDetails.fileImageId": new Types.ObjectId(fileId) } },
      { new: true },
    ).lean();

    if (!updated) throw new Error("Provider profile not found");
    return updated as ProviderProfile;
  }

  /**
   * Replaces all ID images with a new set.
   * Used when the provider re-uploads their documents (e.g. expired ID).
   *
   * All existing fileImageId entries are replaced atomically — the old files
   * are NOT deleted from the File collection (the caller handles cleanup).
   */
  async replaceIdImages(
    profileId: string,
    fileIds: Types.ObjectId[],
    uploadedBy: string,
  ): Promise<ProviderProfile | null> {
    if (!Types.ObjectId.isValid(profileId))
      throw new Error("Invalid profile ID");

    // Clear existing images first, then link the new ones
    await ProviderProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { $set: { "idDetails.fileImageId": [] } },
    );

    if (!fileIds.length) {
      return (await ProviderProfileModel.findById(
        profileId,
      ).lean()) as ProviderProfile | null;
    }

    return this.updateIdImages(profileId, fileIds, uploadedBy);
  }

  // ─── Discovery / Search ───────────────────────────────────────────────────────

  async getProvidersByLocation(
    region: string,
    city?: string,
  ): Promise<ProviderProfile[]> {
    if (!region?.trim()) throw new Error("Region is required");
    const results = await ProviderProfileModel.findByLocation(
      region.trim(),
      city?.trim(),
    );
    return results as unknown as ProviderProfile[];
  }

  /**
   * Geospatial proximity search using MongoDB's $near operator.
   *
   * ⚠️  SCHEMA NOTE: The current coordinatesSchema stores { latitude, longitude }
   * as plain numbers. MongoDB's 2dsphere index requires GeoJSON Point format:
   *   { type: "Point", coordinates: [longitude, latitude] }
   *
   * For $near to work correctly, the schema and all stored documents need to
   * be migrated to GeoJSON format. Until then this query will not use the index.
   * A GeoJSON migration is recommended before this method goes to production.
   *
   * For distance-annotated results without the GeoJSON migration, use
   * searchProviders() + attachDistancesToProviders() instead.
   */
  async getProvidersNearCoordinates(
    lat: number,
    lng: number,
    radiusKm: number = 10,
    limit: number = 20,
  ): Promise<{ providers: WithDistance<ProviderProfile>[]; total: number }> {
    const radiusMeters = radiusKm * 1000;

    // GeoJSON coordinates are [longitude, latitude] — note the order
    const providers = await ProviderProfileModel.find({
      "locationData.gpsCoordinates": {
        $near: {
          $geometry: { type: "Point", coordinates: [lng, lat] },
          $maxDistance: radiusMeters,
        },
      },
      isDeleted: false,
    })
      .limit(limit)
      .lean();

    const from: Coordinates = { latitude: lat, longitude: lng };

    const withDistances = this.locationService.attachDistances(
      from,
      providers as unknown as ProviderProfile[],
      (p) => p.locationData?.gpsCoordinates,
    );

    return {
      providers: withDistances,
      total: withDistances.length,
    };
  }

  /**
   * Attaches Haversine distances to an already-fetched list of providers.
   *
   * Used in flows where providers were loaded by other means (e.g. region
   * filter, text search) and the caller wants distance from a reference point
   * without running a geospatial DB query.
   *
   * Returns providers sorted nearest-first. Providers with no coordinates
   * get distanceKm: Infinity and sort to the end.
   *
   * @param from       - reference coordinates (client location, task location, etc.)
   * @param providers  - pre-fetched provider list
   */
  attachDistancesToProviders(
    from: Coordinates | undefined | null,
    providers: ProviderProfile[],
  ): WithDistance<ProviderProfile>[] {
    return this.locationService
      .attachDistances(from, providers, (p) => p.locationData?.gpsCoordinates)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  async getProvidersByService(serviceId: string): Promise<ProviderProfile[]> {
    if (!Types.ObjectId.isValid(serviceId))
      throw new Error("Invalid service ID");
    const results = await ProviderProfileModel.findByService(serviceId);
    return results as unknown as ProviderProfile[];
  }

  /**
   * Multi-filter search across region, city, service, availability, and
   * business name text search.
   *
   * Text search uses the `businessName: "text"` index from the schema.
   * All other filters use standard field indexes.
   *
   * Pass `from` to receive distance-annotated, nearest-first results.
   * Omit it for unordered results (admin views, region-only browsing).
   */
  async searchProviders(
    filters: {
      region?: string;
      city?: string;
      serviceId?: string;
      searchTerm?: string;
      isAlwaysAvailable?: boolean;
      from?: Coordinates;
    },
    limit: number = 20,
    skip: number = 0,
  ): Promise<{
    providers: WithDistance<ProviderProfile>[] | ProviderProfile[];
    total: number;
    hasMore: boolean;
  }> {
    const { from, ...dbFilters } = filters;
    const query: Record<string, any> = { isDeleted: false };

    if (dbFilters.region?.trim()) {
      query["locationData.region"] = dbFilters.region.trim();
    }
    if (dbFilters.city?.trim()) {
      query["locationData.city"] = dbFilters.city.trim();
    }
    if (dbFilters.serviceId && Types.ObjectId.isValid(dbFilters.serviceId)) {
      query.serviceOfferings = new Types.ObjectId(dbFilters.serviceId);
    }
    if (dbFilters.isAlwaysAvailable !== undefined) {
      query.isAlwaysAvailable = dbFilters.isAlwaysAvailable;
    }
    if (dbFilters.searchTerm?.trim()) {
      query.$text = { $search: dbFilters.searchTerm.trim() };
    }

    const [providers, total] = await Promise.all([
      ProviderProfileModel.find(query)
        .limit(limit)
        .skip(skip)
        .populate("serviceOfferings", "title slug isActive")
        .populate("businessGalleryImages", "url thumbnailUrl")
        .sort(
          dbFilters.searchTerm
            ? { score: { $meta: "textScore" } }
            : { createdAt: -1 },
        )
        .lean(),
      ProviderProfileModel.countDocuments(query),
    ]);

    // If a reference point is supplied, annotate with distances and sort
    // nearest-first. This overrides the DB sort order intentionally —
    // proximity is the most useful ordering for client-facing discovery.
    if (from) {
      const withDistances = this.attachDistancesToProviders(
        from,
        providers as unknown as ProviderProfile[],
      );
      return {
        providers: withDistances,
        total,
        hasMore: skip + providers.length < total,
      };
    }

    return {
      providers: providers as unknown as ProviderProfile[],
      total,
      hasMore: skip + providers.length < total,
    };
  }

  // ─── Admin / Moderation ───────────────────────────────────────────────────────

  async getAllProviders(
    pagination: { limit: number; skip: number },
    includeDeleted: boolean = false,
  ): Promise<{
    providers: ProviderProfile[];
    total: number;
    hasMore: boolean;
  }> {
    const { limit, skip } = pagination;

    // countDocuments is not covered by the pre-find soft-delete hook —
    // always pass isDeleted condition explicitly here
    const countQuery: Record<string, any> = includeDeleted
      ? {}
      : { isDeleted: false };

    const [providers, total] = await Promise.all([
      ProviderProfileModel.find(
        includeDeleted ? {} : { isDeleted: false },
        null,
        includeDeleted ? { includeSoftDeleted: true } : {},
      )
        .limit(limit)
        .skip(skip)
        .populate("profile", "userId role bio mobileNumber")
        .populate("serviceOfferings", "title slug isActive")
        .sort({ createdAt: -1 })
        .lean(),
      ProviderProfileModel.countDocuments(countQuery),
    ]);

    return {
      providers: providers as unknown as ProviderProfile[],
      total,
      hasMore: skip + providers.length < total,
    };
  }

  /**
   * Admin action: stamps isAddressVerified = true on the provider's location.
   *
   * Before writing, re-runs LocationService.verifyStoredLocation() and logs
   * any discrepancies. Discrepancies are non-blocking — the admin has
   * physically verified the address and their decision takes precedence.
   */
  async verifyProviderAddress(
    profileId: string,
    _verifiedBy: string,
  ): Promise<ProviderProfile | null> {
    if (!Types.ObjectId.isValid(profileId))
      throw new Error("Invalid profile ID");

    const profile = (await ProviderProfileModel.findOne({
      _id: new Types.ObjectId(profileId),
      isDeleted: false,
    }).lean()) as ProviderProfile | null;

    if (!profile) throw new Error("Provider profile not found");
    if (!profile.locationData?.ghanaPostGPS) {
      throw new Error(
        "Provider has no location data to verify — ask them to complete onboarding first",
      );
    }

    if (profile.locationData.gpsCoordinates) {
      const verification = await this.locationService.verifyStoredLocation(
        profile.locationData,
      );
      if (!verification.verified) {
        console.warn(
          `[ProviderProfile ${profileId}] Address verification discrepancies:`,
          verification.discrepancies,
        );
      }
    }

    const updated = await ProviderProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { $set: { "locationData.isAddressVerified": true } },
      { new: true },
    ).lean();

    if (!updated) throw new Error("Provider profile not found");
    return updated as ProviderProfile;
  }

  /**
   * Admin action: toggle whether the provider has completed company training.
   */
  async setCompanyTrained(
    profileId: string,
    value: boolean,
    _updatedBy: string,
  ): Promise<ProviderProfile | null> {
    if (!Types.ObjectId.isValid(profileId))
      throw new Error("Invalid profile ID");

    const updated = await ProviderProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { isCompanyTrained: value },
      { new: true },
    ).lean();

    if (!updated) throw new Error("Provider profile not found");
    return updated as ProviderProfile;
  }

  /**
   * Platform-wide or per-provider stats.
   * Pass providerId to scope to a single provider (useful for their dashboard).
   * Omit it for a system-wide admin overview.
   *
   * Note: liveReadyProviders is a DB approximation — it excludes the
   * availability rule because workingHours uses Mixed/strict:false which is
   * unreliable to query. Always use isProfileLive() for an authoritative check.
   */
  async getProviderStats(providerId?: string): Promise<{
    totalProviders: number;
    deletedProviders: number;
    verifiedAddresses: number;
    companyTrainedProviders: number;
    alwaysAvailableProviders: number;
    providersWithServices: number;
    providersWithGallery: number;
    providersWithIdImages: number;
    liveReadyProviders: number;
  }> {
    const base: Record<string, any> = providerId
      ? { _id: new Types.ObjectId(providerId) }
      : {};

    const [
      totalProviders,
      deletedProviders,
      verifiedAddresses,
      companyTrained,
      alwaysAvailable,
      withServices,
      withGallery,
      withIdImages,
      liveReady,
    ] = await Promise.all([
      ProviderProfileModel.countDocuments({ ...base, isDeleted: false }),
      ProviderProfileModel.countDocuments({ ...base, isDeleted: true }),
      ProviderProfileModel.countDocuments({
        ...base,
        isDeleted: false,
        "locationData.isAddressVerified": true,
      }),
      ProviderProfileModel.countDocuments({
        ...base,
        isDeleted: false,
        isCompanyTrained: true,
      }),
      ProviderProfileModel.countDocuments({
        ...base,
        isDeleted: false,
        isAlwaysAvailable: true,
      }),
      ProviderProfileModel.countDocuments({
        ...base,
        isDeleted: false,
        serviceOfferings: { $exists: true, $not: { $size: 0 } },
      }),
      ProviderProfileModel.countDocuments({
        ...base,
        isDeleted: false,
        businessGalleryImages: { $exists: true, $not: { $size: 0 } },
      }),
      ProviderProfileModel.countDocuments({
        ...base,
        isDeleted: false,
        "idDetails.fileImageId": { $exists: true, $not: { $size: 0 } },
      }),
      ProviderProfileModel.countDocuments({
        ...base,
        isDeleted: false,
        "providerContactInfo.primaryContact": { $exists: true, $ne: "" },
        "locationData.region": { $exists: true, $ne: "" },
        serviceOfferings: { $exists: true, $not: { $size: 0 } },
      }),
    ]);

    return {
      totalProviders,
      deletedProviders,
      verifiedAddresses,
      companyTrainedProviders: companyTrained,
      alwaysAvailableProviders: alwaysAvailable,
      providersWithServices: withServices,
      providersWithGallery: withGallery,
      providersWithIdImages: withIdImages,
      liveReadyProviders: liveReady,
    };
  }

  // ─── Method Implementation ────────────────────────────────────────────────────

  /**
   * browseProviders — unified public provider discovery.
   *
   * Design goals:
   * 1. Single endpoint for all client-facing browse/search scenarios.
   * 2. Full filter surface: text, region, city, service, availability, training,
   *    address verification, and GPS distance.
   * 3. Correct distance-sorted pagination without requiring a GeoJSON migration.
   *    When `from` coordinates are provided, we fetch all matching records, apply
   *    Haversine sorting in memory, then slice for the requested page.
   *    This is pragmatic for provider counts up to ~500; revisit with a 2dsphere
   *    GeoJSON migration if the collection grows significantly.
   * 4. Returns `nearbyProviders` — the subset within `radiusKm` — alongside the
   *    full page so the frontend can render two sections without a second request.
   *
   * Sorting behaviour:
   *   sortBy: "distance"      — requires `from`; falls back to "createdAt" if absent
   *   sortBy: "createdAt"     — newest first (desc) or oldest first (asc)
   *   sortBy: "businessName"  — A–Z (asc) or Z–A (desc)
   */
  async browseProviders(
    filters: BrowseProvidersFilters = {},
    options: BrowseProvidersOptions = {},
  ): Promise<BrowseProvidersResult> {
    const {
      q,
      region,
      city,
      serviceId,
      isAlwaysAvailable,
      isCompanyTrained,
      isAddressVerified,
      from,
      radiusKm: radiusInput = 10,
    } = filters;

    const {
      sortBy = from ? "distance" : "createdAt",
      order = sortBy === "businessName" ? "asc" : "desc",
      page = 1,
      limit: rawLimit = 20,
    } = options;

    const radiusKm = Math.max(1, Math.min(200, radiusInput));
    const limit = Math.max(1, Math.min(100, rawLimit));
    const currentPage = Math.max(1, page);

    // ── 1. Build MongoDB query ─────────────────────────────────────────────────
    const query: Record<string, unknown> = { isDeleted: false };

    if (region?.trim()) {
      query["locationData.region"] = new RegExp(`^${region.trim()}$`, "i");
    }
    if (city?.trim()) {
      query["locationData.city"] = new RegExp(`^${city.trim()}$`, "i");
    }
    if (serviceId && Types.ObjectId.isValid(serviceId)) {
      query.serviceOfferings = new Types.ObjectId(serviceId);
    }
    if (isAlwaysAvailable === true) {
      query.isAlwaysAvailable = true;
    }
    if (isCompanyTrained === true) {
      query.isCompanyTrained = true;
    }
    if (isAddressVerified === true) {
      query["locationData.isAddressVerified"] = true;
    }
    if (q?.trim()) {
      // Uses the `businessName: "text"` index defined on the schema.
      query.$text = { $search: q.trim() };
    }

    // ── 2. Distance-sorted path (Haversine, in-memory) ────────────────────────
    // When the caller wants distance-ordered results we must fetch all matching
    // records before we can sort — MongoDB cannot sort by Haversine distance
    // without the GeoJSON 2dsphere index migration. We cap the fetch at 500 to
    // bound memory usage; this is safe for the current provider count.
    if (sortBy === "distance" && from) {
      const CAP = 500;

      const rawProviders = (await ProviderProfileModel.find(query)
        .limit(CAP)
        .populate("serviceOfferings", "title slug isActive")
        .sort(q?.trim() ? { score: { $meta: "textScore" } } : { createdAt: -1 })
        .lean()) as unknown as ProviderProfile[];

      // Annotate every record with a Haversine distance
      const withDistances = this.locationService
        .attachDistances(
          from,
          rawProviders,
          (p) => p.locationData?.gpsCoordinates,
        )
        .sort((a, b) =>
          order === "asc"
            ? a.distanceKm - b.distanceKm
            : b.distanceKm - a.distanceKm,
        );

      const total = withDistances.length;
      const skip = (currentPage - 1) * limit;
      const page_providers = withDistances.slice(skip, skip + limit);

      const nearbyProviders = withDistances.filter(
        (p) => isFinite(p.distanceKm) && p.distanceKm <= radiusKm,
      );

      return {
        providers: page_providers,
        nearbyProviders,
        total,
        page: currentPage,
        limit,
        hasMore: skip + page_providers.length < total,
        radiusKm,
        appliedFilters: { ...filters, ...options },
      };
    }

    // ── 3. DB-sorted path (createdAt or businessName) ─────────────────────────
    // Standard DB-level sort + skip/limit for non-distance sorts.
    const dbSort: Record<string, 1 | -1 | { $meta: "textScore" }> = q?.trim()
      ? { score: { $meta: "textScore" } }
      : sortBy === "businessName"
        ? { businessName: order === "asc" ? 1 : -1 }
        : { createdAt: order === "asc" ? 1 : -1 };

    const skip = (currentPage - 1) * limit;

    const [rawProviders, total] = await Promise.all([
      ProviderProfileModel.find(query)
        .sort(dbSort)
        .skip(skip)
        .limit(limit)
        .populate("serviceOfferings", "title slug isActive")
        .lean(),
      ProviderProfileModel.countDocuments(query),
    ]);

    const providers = rawProviders as unknown as ProviderProfile[];

    // Annotate with distances when coordinates are provided, even when not
    // sorting by distance — the frontend uses distanceKm for the distance badge.
    let annotated: WithDistance<ProviderProfile>[] | ProviderProfile[] =
      providers;
    let nearbyProviders: WithDistance<ProviderProfile>[] = [];

    if (from) {
      const withDistances = this.locationService.attachDistances(
        from,
        providers,
        (p) => p.locationData?.gpsCoordinates,
      );
      annotated = withDistances;
      nearbyProviders = withDistances.filter(
        (p) => isFinite(p.distanceKm) && p.distanceKm <= radiusKm,
      );
    }

    return {
      providers: annotated,
      nearbyProviders,
      total,
      page: currentPage,
      limit,
      hasMore: skip + providers.length < total,
      radiusKm,
      appliedFilters: { ...filters, ...options },
    };
  }
}
