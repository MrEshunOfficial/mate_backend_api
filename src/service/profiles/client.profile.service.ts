// services/profiles/client.profile.service.ts
import { Types } from "mongoose";
import ClientProfileModel from "../../models/profiles/client.profile.model";
import BookingModel from "../../models/booking.model";
import TaskModel from "../../models/task.model";
import ProviderProfileModel from "../../models/profiles/provider.profile.model";
import { ServiceModel } from "../../models/service/serviceModel";
import {
  ClientProfile,
  ClientProfileDocument,
} from "../../types/profiles/client.profile.types";
import { ProviderProfile } from "../../types/profiles/business.profile.types";
import { BookingStatus } from "../../types/bookings.types";
import { TaskStatus } from "../../types/tasks.types";
import { Coordinates, UserLocation } from "../../types/location.types";
import { ImageLinkingService } from "../files/imageLinkingService";
import { LocationService, LocationEnrichmentInput, WithDistance, 
  locationService as defaultLocationService} from "../location.service";

// ─── Local Types ──────────────────────────────────────────────────────────────

/**
 * SavedAddress extends UserLocation with a display label and sub-document _id.
 * The underlying schema stores savedAddresses as UserLocation[] — we add the
 * label and _id locally so service code can reference them without a type cast.
 */
export type SavedAddress = UserLocation & {
  label?: string;
  _id?: Types.ObjectId;
};

// ─── Profile Completeness Gate ─────────────────────────────────────────────────

/**
 * Rules a client must satisfy before the account is considered fully set up.
 * Less strict than the provider gate — clients don't need to go "live",
 * but we do want a contact number and at least one saved address before
 * they can book a service.
 *
 * Schema leaves these optional to support scaffolding at signup — this is
 * the single enforcement point, checked by isProfileReady().
 */
const READY_REQUIRED_RULES: Array<{
  field: string;
  check: (p: ClientProfile) => boolean;
  message: string;
}> = [
  {
    field: "clientContactInfo.primaryContact",
    check: (p) => !!p.clientContactInfo?.primaryContact?.trim(),
    message: "Primary contact number is required",
  },
  {
    field: "savedAddresses",
    check: (p) =>
      Array.isArray(p.savedAddresses) && p.savedAddresses.length > 0,
    message: "At least one saved address is required before booking",
  },
];

// ─── Service ──────────────────────────────────────────────────────────────────

export class ClientProfileService {
  private readonly imageLinkingService: ImageLinkingService;

  /**
   * LocationService is injected so tests can supply a mock.
   * All other callers use the module-level singleton.
   */
  constructor(
    private readonly locationService: LocationService = defaultLocationService
  ) {
    this.imageLinkingService = new ImageLinkingService();
  }

  // ─── Core CRUD ───────────────────────────────────────────────────────────────

  /**
   * Fetch by the ClientProfile._id.
   */
  async getClientProfileById(
    profileId: string,
    populate: boolean = false
  ): Promise<ClientProfile | null> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");

    const query = ClientProfileModel.findOne({
      _id: new Types.ObjectId(profileId),
      isDeleted: false,
    });

    if (populate) {
      query
        .populate("profile", "userId role bio mobileNumber profilePictureId")
        .populate("favoriteServices", "title slug isActive servicePricing")
        .populate("favoriteProviders", "businessName providerContactInfo locationData");
    }

    return (await query.lean()) as ClientProfile | null;
  }

  /**
   * Fetch by the UserProfile ObjectId stored in the `profile` field.
   * Most common internal lookup — callers typically have the UserProfile._id.
   */
  async getClientProfileByProfileRef(
    userProfileId: string,
    populate: boolean = false
  ): Promise<ClientProfile | null> {
    if (!Types.ObjectId.isValid(userProfileId)) {
      throw new Error("Invalid user profile ID");
    }

    const query = ClientProfileModel.findOne({
      profile: new Types.ObjectId(userProfileId),
      isDeleted: false,
    });

    if (populate) {
      query
        .populate("profile", "userId role bio mobileNumber profilePictureId")
        .populate("favoriteServices", "title slug isActive servicePricing")
        .populate("favoriteProviders", "businessName providerContactInfo locationData");
    }

    return (await query.lean()) as ClientProfile | null;
  }

  /**
   * General-purpose update.
   * Immutable fields are stripped before write.
   * For contact info and addresses, use the dedicated methods — they
   * run enrichment and validation that this method skips.
   */
  async updateClientProfile(
    profileId: string,
    updates: Partial<ClientProfile>,
    _updatedBy: string
  ): Promise<ClientProfile | null> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");

    const {
      profile:     _profile,
      isDeleted:   _isDeleted,
      deletedAt:   _deletedAt,
      deletedBy:   _deletedBy,
      ...safeUpdates
    } = updates as any;

    const updated = await ClientProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { $set: safeUpdates },
      { new: true, runValidators: true }
    ).lean();

    if (!updated) throw new Error("Client profile not found");
    return updated as ClientProfile;
  }

  async deleteClientProfile(
    profileId: string,
    deletedBy?: string
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");

    const profile = (await ClientProfileModel.findOne({
      _id: new Types.ObjectId(profileId),
      isDeleted: false,
    })) as ClientProfileDocument | null;

    if (!profile) throw new Error("Client profile not found");

    await profile.softDelete(
      deletedBy ? new Types.ObjectId(deletedBy) : undefined
    );
    return true;
  }

  async restoreClientProfile(
    profileId: string
  ): Promise<ClientProfile | null> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");

    const profile = (await ClientProfileModel.findOne(
      { _id: new Types.ObjectId(profileId), isDeleted: true },
      null,
      { includeSoftDeleted: true }
    )) as ClientProfileDocument | null;

    if (!profile) throw new Error("Deleted client profile not found");

    await profile.restore();
    return (await ClientProfileModel.findById(profileId).lean()) as ClientProfile | null;
  }

  // ─── Onboarding: Isolated Field Updates ──────────────────────────────────────

  /**
   * Updates clientContactInfo as a unit.
   * primaryContact must not be empty when provided.
   */
  async updateContactInfo(
    profileId: string,
    contactData: Partial<ClientProfile["clientContactInfo"]>
  ): Promise<ClientProfile | null> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");

    if (
      contactData.primaryContact !== undefined &&
      !contactData.primaryContact.trim()
    ) {
      throw new Error("Primary contact cannot be empty");
    }

    const updated = await ClientProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { $set: { clientContactInfo: contactData } },
      { new: true, runValidators: true }
    ).lean();

    if (!updated) throw new Error("Client profile not found");
    return updated as ClientProfile;
  }

  /**
   * Updates non-sensitive personal info: preferredName, dateOfBirth.
   */
  async updatePersonalInfo(
    profileId: string,
    data: {
      preferredName?: string;
      dateOfBirth?: Date;
    }
  ): Promise<ClientProfile | null> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");

    if (data.preferredName !== undefined) {
      const trimmed = data.preferredName.trim();
      if (!trimmed) throw new Error("Preferred name cannot be empty");
      data.preferredName = trimmed;
    }

    const updated = await ClientProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { $set: data },
      { new: true, runValidators: true }
    ).lean();

    if (!updated) throw new Error("Client profile not found");
    return updated as ClientProfile;
  }

  /**
   * Returns whether the client has satisfied minimum requirements to book.
   *
   * Mirrors isProfileLive() on the provider side — both use the same
   * READY_REQUIRED_RULES / LIVE_REQUIRED_RULES pattern so the frontend
   * can render a consistent onboarding checklist.
   */
  async isProfileReady(profileId: string): Promise<{
    isReady: boolean;
    missingFields: string[];
  }> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");

    const profile = (await ClientProfileModel.findOne({
      _id: new Types.ObjectId(profileId),
      isDeleted: false,
    }).lean()) as ClientProfile | null;

    if (!profile) throw new Error("Client profile not found");

    const missingFields = READY_REQUIRED_RULES
      .filter((rule) => !rule.check(profile))
      .map((rule) => rule.message);

    return {
      isReady: missingFields.length === 0,
      missingFields,
    };
  }

  // ─── Saved Addresses ──────────────────────────────────────────────────────────

  /**
   * Enriches and appends a new address to savedAddresses.
   *
   * The user provides only ghanaPostGPS (+ optional nearbyLandmark / live GPS).
   * LocationService fills in region, city, district, coordinates, etc.
   *
   * Returns the saved profile AND missingFields so the controller can warn
   * the user if OSM couldn't resolve the full address.
   *
   * The label (e.g. "Home", "Work") is stored as-is for UI display.
   */
  async addSavedAddress(
    profileId: string,
    input: LocationEnrichmentInput & { label?: string }
  ): Promise<{ profile: ClientProfile; missingFields: string[] }> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");

    const enriched = await this.locationService.enrichLocation(input);

    if (!enriched.success || !enriched.location) {
      throw new Error(enriched.error ?? "Location enrichment failed");
    }

    const newAddress: SavedAddress = {
      ...enriched.location,
      label: input.label?.trim(),
      _id: new Types.ObjectId(),
    };

    const updated = await ClientProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { $push: { savedAddresses: newAddress } },
      { new: true, runValidators: true }
    ).lean();

    if (!updated) throw new Error("Client profile not found");

    return {
      profile: updated as ClientProfile,
      missingFields: enriched.missingFields ?? [],
    };
  }

  /**
   * Updates a specific saved address by its sub-document _id.
   * Re-runs location enrichment so coordinates and OSM fields stay fresh.
   */
  async updateSavedAddress(
    profileId: string,
    addressId: string,
    input: LocationEnrichmentInput & { label?: string }
  ): Promise<{ profile: ClientProfile; missingFields: string[] }> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");
    if (!Types.ObjectId.isValid(addressId)) throw new Error("Invalid address ID");

    const enriched = await this.locationService.enrichLocation(input);

    if (!enriched.success || !enriched.location) {
      throw new Error(enriched.error ?? "Location enrichment failed");
    }

    const updatedFields: Record<string, any> = {};
    const loc = enriched.location;

    // Write each field using the positional $ operator so only the matching
    // sub-document is updated — we never overwrite the entire savedAddresses array
    for (const [key, value] of Object.entries(loc)) {
      updatedFields[`savedAddresses.$.${key}`] = value;
    }
    if (input.label !== undefined) {
      updatedFields["savedAddresses.$.label"] = input.label.trim();
    }

    const updated = await ClientProfileModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(profileId),
        isDeleted: false,
        "savedAddresses._id": new Types.ObjectId(addressId),
      },
      { $set: updatedFields },
      { new: true, runValidators: true }
    ).lean();

    if (!updated) throw new Error("Address not found or profile not found");

    return {
      profile: updated as ClientProfile,
      missingFields: enriched.missingFields ?? [],
    };
  }

  /**
   * Removes a saved address by its sub-document _id.
   *
   * If the removed address was the default, defaultAddressIndex is reset to 0
   * (the new first address). If savedAddresses is now empty, it is set to -1
   * to indicate no default is set.
   */
  async removeSavedAddress(
    profileId: string,
    addressId: string
  ): Promise<ClientProfile | null> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");
    if (!Types.ObjectId.isValid(addressId)) throw new Error("Invalid address ID");

    const profile = (await ClientProfileModel.findOne({
      _id: new Types.ObjectId(profileId),
      isDeleted: false,
    }).lean()) as ClientProfile | null;

    if (!profile) throw new Error("Client profile not found");

  const removedIdx = (profile.savedAddresses as SavedAddress[] ?? []).findIndex(
  (a) => a._id?.toString() === addressId
  );

    if (removedIdx === -1) throw new Error("Address not found");

    const pullResult = await ClientProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { $pull: { savedAddresses: { _id: new Types.ObjectId(addressId) } } },
      { new: true }
    ).lean() as ClientProfile | null;

    if (!pullResult) throw new Error("Client profile not found");

    // Adjust defaultAddressIndex if the removed address was at or before the default
    const currentDefault = profile.defaultAddressIndex ?? 0;
    const remainingCount = (pullResult.savedAddresses ?? []).length;

    let newDefault = currentDefault;
    if (remainingCount === 0) {
      newDefault = -1; // no addresses left
    } else if (removedIdx === currentDefault) {
      newDefault = 0; // removed the default — fall back to first
    } else if (removedIdx < currentDefault) {
      newDefault = currentDefault - 1; // shift down
    }

    if (newDefault !== currentDefault) {
      return (await ClientProfileModel.findOneAndUpdate(
        { _id: new Types.ObjectId(profileId), isDeleted: false },
        { defaultAddressIndex: newDefault },
        { new: true }
      ).lean()) as ClientProfile | null;
    }

    return pullResult;
  }

  /**
   * Sets the default address by index within savedAddresses.
   * The index must be within bounds — validated before write.
   */
  async setDefaultAddress(
    profileId: string,
    index: number
  ): Promise<ClientProfile | null> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");

    const profile = (await ClientProfileModel.findOne({
      _id: new Types.ObjectId(profileId),
      isDeleted: false,
    })
      .select("savedAddresses")
      .lean()) as Pick<ClientProfile, "savedAddresses"> | null;

    if (!profile) throw new Error("Client profile not found");

    const count = (profile.savedAddresses ?? []).length;
    if (index < 0 || index >= count) {
      throw new Error(
        `Invalid default address index ${index}. ` +
        `Must be between 0 and ${count - 1}.`
      );
    }

    const updated = await ClientProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { defaultAddressIndex: index },
      { new: true }
    ).lean();

    if (!updated) throw new Error("Client profile not found");
    return updated as ClientProfile;
  }

  /**
   * Returns the client's default saved address, or null if none exists.
   * Convenience method for the booking flow when it needs the service location.
   */
  async getDefaultAddress(profileId: string): Promise<SavedAddress | null> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");

    const profile = (await ClientProfileModel.findOne({
      _id: new Types.ObjectId(profileId),
      isDeleted: false,
    })
      .select("savedAddresses defaultAddressIndex")
      .lean()) as Pick<ClientProfile, "savedAddresses" | "defaultAddressIndex"> | null;

    if (!profile) throw new Error("Client profile not found");

    const addresses = profile.savedAddresses ?? [];
    const idx = profile.defaultAddressIndex ?? 0;

    if (addresses.length === 0 || idx < 0 || idx >= addresses.length) {
      return null;
    }

    return addresses[idx];
  }

  // ─── Distance: Providers Near Client ─────────────────────────────────────────

  /**
   * Returns providers near the client's default (or specified) saved address,
   * sorted nearest-first with distanceKm attached to each result.
   *
   * This is the primary method for client-facing provider discovery —
   * "show me providers near my home address".
   *
   * @param profileId    - the ClientProfile._id
   * @param addressIndex - which saved address to use as the reference point.
   *                       Defaults to defaultAddressIndex when omitted.
   * @param radiusKm     - only return providers within this radius
   * @param filters      - optional region/city/service filters applied before
   *                       the distance calculation (reduces the candidate set)
   * @param limit        - max number of results after distance filtering
   */
  async getProvidersNearClient(
    profileId: string,
    options: {
      addressIndex?: number;
      radiusKm?: number;
      filters?: {
        serviceId?: string;
        isAlwaysAvailable?: boolean;
      };
      limit?: number;
    } = {}
  ): Promise<{
    providers: WithDistance<ProviderProfile>[];
    referenceAddress: SavedAddress | null;
    total: number;
  }> {
    const { addressIndex, radiusKm = 20, filters = {}, limit = 20 } = options;

    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");

    // Resolve the reference address
    const profile = (await ClientProfileModel.findOne({
      _id: new Types.ObjectId(profileId),
      isDeleted: false,
    })
      .select("savedAddresses defaultAddressIndex")
      .lean()) as Pick<ClientProfile, "savedAddresses" | "defaultAddressIndex"> | null;

    if (!profile) throw new Error("Client profile not found");

    const addresses  = profile.savedAddresses ?? [];
    const idx        = addressIndex ?? (profile.defaultAddressIndex ?? 0);
    const refAddress = addresses[idx] ?? null;
    const from       = refAddress?.gpsCoordinates ?? null;

    // Build the provider candidate query — apply optional filters at DB level
    // to reduce the set before Haversine is run in application memory
    const providerQuery: Record<string, any> = { isDeleted: false };

    if (filters.serviceId && Types.ObjectId.isValid(filters.serviceId)) {
      providerQuery.serviceOfferings = new Types.ObjectId(filters.serviceId);
    }
    if (filters.isAlwaysAvailable !== undefined) {
      providerQuery.isAlwaysAvailable = filters.isAlwaysAvailable;
    }
    if (refAddress?.region) {
      // Prefer same-region providers — dramatically reduces candidate set
      providerQuery["locationData.region"] = refAddress.region;
    }

    const candidates = await ProviderProfileModel.find(providerQuery)
      .populate("serviceOfferings", "title slug isActive")
      .populate("businessGalleryImages", "url thumbnailUrl")
      .lean();

    // Attach Haversine distances and filter by radius
    const nearby = this.locationService.filterByDistance(
      from,
      candidates as unknown as ProviderProfile[],
      (p) => p.locationData?.gpsCoordinates,
      radiusKm
    );

    return {
      providers:        nearby.slice(0, limit),
      referenceAddress: refAddress,
      total:            nearby.length,
    };
  }

  /**
   * Attaches distances to an already-fetched provider list, measured from
   * a specific client saved address (or the default address).
   *
   * Used in flows where providers are already loaded (e.g. after a text
   * search) and the caller just wants distance annotations added.
   */
  async attachDistancesFromClient(
    profileId: string,
    providers: ProviderProfile[],
    addressIndex?: number
  ): Promise<WithDistance<ProviderProfile>[]> {
    const address = await this.getDefaultAddress(profileId);

    const from: Coordinates | null =
      addressIndex !== undefined
        ? ((await ClientProfileModel.findOne(
            { _id: new Types.ObjectId(profileId), isDeleted: false }
          ).select("savedAddresses").lean()) as any)?.savedAddresses?.[addressIndex]
            ?.gpsCoordinates ?? null
        : address?.gpsCoordinates ?? null;

    return this.locationService
      .attachDistances(from, providers, (p) => p.locationData?.gpsCoordinates)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  // ─── Distance: Tasks ──────────────────────────────────────────────────────────

  /**
   * Attaches distanceKm to each matched provider on a task, measured from
   * the task's location (GPS fix at posting, falling back to registered address).
   *
   * Called by the task service / task controller after matchedProviders is
   * populated, before returning the result to the client:
   *
   *   const enriched = await clientProfileService.attachDistancesToTaskProviders(task);
   *   return enriched;  // matchedProviders now have distanceKm
   *
   * The task model stores distances as a plain `distance` field on each
   * ProviderMatchResult. This method populates that field rather than
   * attaching WithDistance<> to avoid changing the task type shape.
   *
   * @param task           - the full Task document (with matchedProviders populated)
   * @param providerDocs   - loaded ProviderProfile docs keyed by providerId string.
   *                         Pass these when you've already fetched them to avoid
   *                         a redundant DB round-trip.
   */
  async attachDistancesToTaskProviders(
    task: {
      locationContext: {
        registeredLocation?: { gpsCoordinates?: Coordinates };
        gpsLocationAtPosting?: { latitude: number; longitude: number };
      };
      matchedProviders: Array<{
        providerId: Types.ObjectId;
        distanceKm?: number;
        [key: string]: any;
      }>;
    },
    providerDocs: Map<string, ProviderProfile>
  ): Promise<typeof task.matchedProviders> {
    // Prefer the live GPS fix from the moment the task was posted,
    // fall back to the registered address coordinates
    const gpsAtPosting = task.locationContext.gpsLocationAtPosting;
    const from: Coordinates | null = gpsAtPosting
      ? { latitude: gpsAtPosting.latitude, longitude: gpsAtPosting.longitude }
      : task.locationContext.registeredLocation?.gpsCoordinates ?? null;

    return task.matchedProviders.map((match) => {
      const provider = providerDocs.get(match.providerId.toString());
      const to       = provider?.locationData?.gpsCoordinates ?? null;

      return {
        ...match,
        distanceKm: from && to
          ? this.locationService.calculateDistance(from, to)
          : undefined,
      };
    });
  }

  // ─── ID Document Images ───────────────────────────────────────────────────────

  /**
   * Attaches government ID document images to the client's idDetails.
   *
   * Clients may be required to upload ID for KYC verification. Stored at
   * idDetails.fileImageId[] — the same IdDetails shape used by ProviderProfile.
   *
   * idDetails metadata (type, number) must be set first via updateClientProfile()
   * before images are uploaded, so an image is never floating without a document type.
   *
   * Delegates to ImageLinkingService to stamp entityId on the File record,
   * consistent with how provider ID images are handled.
   */
  async updateIdImages(
    profileId: string,
    fileIds: Types.ObjectId[],
    _uploadedBy: string
  ): Promise<ClientProfile | null> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");
    if (!fileIds.length) throw new Error("At least one file ID is required");

    const profile = (await ClientProfileModel.findOne({
      _id: new Types.ObjectId(profileId),
      isDeleted: false,
    })
      .select("idDetails")
      .lean()) as Pick<ClientProfile, "idDetails"> | null;

    if (!profile) throw new Error("Client profile not found");
    if (!profile.idDetails?.idType) {
      throw new Error(
        "ID document details (type and number) must be set before uploading ID images. " +
        "Call updateClientProfile() with idDetails first."
      );
    }

    // FileEntityType.CLIENT_PROFILE maps to ClientProfileModel in ImageLinkingService
    const { FileEntityType } = await import("../../types/file.types");

    const result = await this.imageLinkingService.linkImageToEntity(
      FileEntityType.CLIENT_PROFILE,
      profileId,
      "client_id_image",
      "idDetails.fileImageId",
      fileIds[0] // primary image — for multiple files call sequentially
    );

    if (!result.linked) {
      throw new Error(result.error ?? "Failed to link ID image");
    }

    // For multiple files, push all IDs directly after the first link
    if (fileIds.length > 1) {
      await ClientProfileModel.findOneAndUpdate(
        { _id: new Types.ObjectId(profileId), isDeleted: false },
        { $addToSet: { "idDetails.fileImageId": { $each: fileIds.slice(1) } } }
      );
    }

    return (await ClientProfileModel.findById(profileId).lean()) as ClientProfile | null;
  }

  /**
   * Removes a single ID image from idDetails.fileImageId.
   * Does NOT delete the underlying File document — caller decides cleanup.
   */
  async removeIdImage(
    profileId: string,
    fileId: string
  ): Promise<ClientProfile | null> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");
    if (!Types.ObjectId.isValid(fileId)) throw new Error("Invalid file ID");

    const updated = await ClientProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { $pull: { "idDetails.fileImageId": new Types.ObjectId(fileId) } },
      { new: true }
    ).lean();

    if (!updated) throw new Error("Client profile not found");
    return updated as ClientProfile;
  }

  // ─── Favorites ────────────────────────────────────────────────────────────────

  /**
   * Adds a service to the client's favourites list.
   * $addToSet ensures idempotency — adding the same service twice is safe.
   * Verifies the service exists before writing.
   */
  async addFavoriteService(
    profileId: string,
    serviceId: string
  ): Promise<ClientProfile | null> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");
    if (!Types.ObjectId.isValid(serviceId)) throw new Error("Invalid service ID");

    const serviceExists = await ServiceModel.countDocuments({
      _id: new Types.ObjectId(serviceId),
      isDeleted: false,
    });
    if (!serviceExists) throw new Error("Service not found");

    const updated = await ClientProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { $addToSet: { favoriteServices: new Types.ObjectId(serviceId) } },
      { new: true }
    ).lean();

    if (!updated) throw new Error("Client profile not found");
    return updated as ClientProfile;
  }

  async removeFavoriteService(
    profileId: string,
    serviceId: string
  ): Promise<ClientProfile | null> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");
    if (!Types.ObjectId.isValid(serviceId)) throw new Error("Invalid service ID");

    const updated = await ClientProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { $pull: { favoriteServices: new Types.ObjectId(serviceId) } },
      { new: true }
    ).lean();

    if (!updated) throw new Error("Client profile not found");
    return updated as ClientProfile;
  }

  /**
   * Returns the client's favourite services, populated with title, slug,
   * pricing, and cover image.
   */
  async getFavoriteServices(profileId: string) {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");

    const profile = (await ClientProfileModel.findOne({
      _id: new Types.ObjectId(profileId),
      isDeleted: false,
    })
      .select("favoriteServices")
      .lean()) as Pick<ClientProfile, "favoriteServices"> | null;

    if (!profile) throw new Error("Client profile not found");
    if (!profile.favoriteServices?.length) return [];

    return ServiceModel.find({
      _id: { $in: profile.favoriteServices },
      isDeleted: false,
      isActive: true,
    })
      .populate("categoryId", "catName slug")
      .populate("coverImage", "url thumbnailUrl")
      .lean();
  }

  /**
   * Adds a provider to the client's favourites list.
   * $addToSet ensures idempotency.
   * Verifies the provider exists before writing.
   */
  async addFavoriteProvider(
    profileId: string,
    providerProfileId: string
  ): Promise<ClientProfile | null> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");
    if (!Types.ObjectId.isValid(providerProfileId)) {
      throw new Error("Invalid provider profile ID");
    }

    const providerExists = await ProviderProfileModel.countDocuments({
      _id: new Types.ObjectId(providerProfileId),
      isDeleted: false,
    });
    if (!providerExists) throw new Error("Provider profile not found");

    const updated = await ClientProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { $addToSet: { favoriteProviders: new Types.ObjectId(providerProfileId) } },
      { new: true }
    ).lean();

    if (!updated) throw new Error("Client profile not found");
    return updated as ClientProfile;
  }

  async removeFavoriteProvider(
    profileId: string,
    providerProfileId: string
  ): Promise<ClientProfile | null> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");
    if (!Types.ObjectId.isValid(providerProfileId)) {
      throw new Error("Invalid provider profile ID");
    }

    const updated = await ClientProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { $pull: { favoriteProviders: new Types.ObjectId(providerProfileId) } },
      { new: true }
    ).lean();

    if (!updated) throw new Error("Client profile not found");
    return updated as ClientProfile;
  }

  /**
   * Returns the client's favourite providers, populated with business info,
   * location, and service offerings.
   *
   * Pass `from` to receive distance-annotated results sorted nearest-first.
   * Omit it for unsorted results.
   */
  async getFavoriteProviders(
    profileId: string,
    from?: Coordinates
  ): Promise<WithDistance<ProviderProfile>[] | ProviderProfile[]> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");

    const profile = (await ClientProfileModel.findOne({
      _id: new Types.ObjectId(profileId),
      isDeleted: false,
    })
      .select("favoriteProviders")
      .lean()) as Pick<ClientProfile, "favoriteProviders"> | null;

    if (!profile) throw new Error("Client profile not found");
    if (!profile.favoriteProviders?.length) return [];

    const providers = await ProviderProfileModel.find({
      _id: { $in: profile.favoriteProviders },
      isDeleted: false,
    })
      .populate("serviceOfferings", "title slug isActive")
      .populate("businessGalleryImages", "url thumbnailUrl")
      .lean();

    if (from) {
      return this.locationService
        .attachDistances(from, providers as unknown as ProviderProfile[], (p) => p.locationData?.gpsCoordinates)
        .sort((a, b) => a.distanceKm - b.distanceKm);
    }

    return providers as unknown as ProviderProfile[];
  }

  // ─── Service / Booking History ────────────────────────────────────────────────

  /**
   * Returns the client's booking history with optional status filter.
   * Most recent first.
   */
  async getBookingHistory(
    profileId: string,
    options: {
      status?: BookingStatus;
      limit?: number;
      skip?: number;
    } = {}
  ): Promise<{
    bookings: any[];
    total: number;
    hasMore: boolean;
  }> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");

    const { status, limit = 20, skip = 0 } = options;

    // clientId on Booking is a UserProfile ref — we need the profile ObjectId
    const query: Record<string, any> = {
      clientId: new Types.ObjectId(profileId),
      isDeleted: false,
    };

    if (status) query.status = status;

    const [bookings, total] = await Promise.all([
      BookingModel.find(query)
        .populate("serviceId", "title slug coverImage")
        .populate("providerId", "businessName providerContactInfo locationData")
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean(),
      BookingModel.countDocuments(query),
    ]);

    return { bookings, total, hasMore: skip + bookings.length < total };
  }

  /**
   * Returns the client's task history with optional status filter.
   * Most recent first.
   */
  async getTaskHistory(
    profileId: string,
    options: {
      status?: TaskStatus;
      limit?: number;
      skip?: number;
    } = {}
  ): Promise<{
    tasks: any[];
    total: number;
    hasMore: boolean;
  }> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");

    const { status, limit = 20, skip = 0 } = options;

    const query: Record<string, any> = {
      clientId: new Types.ObjectId(profileId),
      isDeleted: false,
    };

    if (status) query.status = status;

    const [tasks, total] = await Promise.all([
      TaskModel.find(query)
        .populate("category", "catName slug")
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean(),
      TaskModel.countDocuments(query),
    ]);

    return { tasks, total, hasMore: skip + tasks.length < total };
  }

  /**
   * Returns a count summary of the client's activity across bookings and tasks.
   * Used by the client dashboard header.
   */
  async getActivitySummary(profileId: string): Promise<{
    totalBookings: number;
    activeBookings: number;
    completedBookings: number;
    totalTasks: number;
    activeTasks: number;
    completedTasks: number;
  }> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");

    const clientObjectId = new Types.ObjectId(profileId);

    const [
      totalBookings,
      activeBookings,
      completedBookings,
      totalTasks,
      activeTasks,
      completedTasks,
    ] = await Promise.all([
      BookingModel.countDocuments({ clientId: clientObjectId, isDeleted: false }),
      BookingModel.countDocuments({
        clientId: clientObjectId,
        isDeleted: false,
        status: { $in: [BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS] },
      }),
      BookingModel.countDocuments({
        clientId: clientObjectId,
        isDeleted: false,
        status: { $in: [BookingStatus.VALIDATED, BookingStatus.COMPLETED] },
      }),
      TaskModel.countDocuments({ clientId: clientObjectId, isDeleted: false }),
      TaskModel.countDocuments({
        clientId: clientObjectId,
        isDeleted: false,
        status: {
          $in: [
            TaskStatus.PENDING,
            TaskStatus.MATCHED,
            TaskStatus.FLOATING,
            TaskStatus.REQUESTED,
            TaskStatus.ACCEPTED,
          ],
        },
      }),
      TaskModel.countDocuments({
        clientId: clientObjectId,
        isDeleted: false,
        status: TaskStatus.CONVERTED,
      }),
    ]);

    return {
      totalBookings,
      activeBookings,
      completedBookings,
      totalTasks,
      activeTasks,
      completedTasks,
    };
  }

  // ─── Preferences ──────────────────────────────────────────────────────────────

  /**
   * Updates client preferences (notification settings, language, etc.)
   * merged into the existing preferences sub-document.
   */
  async updatePreferences(
    profileId: string,
    preferences: Partial<NonNullable<ClientProfile["preferences"]>>
  ): Promise<ClientProfile | null> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");

    if (!preferences || Object.keys(preferences).length === 0) {
      throw new Error("Preferences payload cannot be empty");
    }

    // Use dot-notation $set to merge individual preference fields rather than
    // replacing the entire preferences sub-document. This lets the caller
    // update a single field (e.g. languagePreference) without touching the rest.
    const update: Record<string, any> = {};
    for (const [key, value] of Object.entries(preferences as Record<string, any>)) {
      update[`preferences.${key}`] = value;
    }

    const updated = await ClientProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      { $set: update },
      { new: true, runValidators: true }
    ).lean();

    if (!updated) throw new Error("Client profile not found");
    return updated as ClientProfile;
  }

  // ─── Admin / Moderation ───────────────────────────────────────────────────────

  /**
   * Admin action: mark the client as verified (KYC or phone verification).
   */
  async verifyClient(
    profileId: string,
    verificationDetails: ClientProfile["verificationDetails"],
    _verifiedBy: string
  ): Promise<ClientProfile | null> {
    if (!Types.ObjectId.isValid(profileId)) throw new Error("Invalid profile ID");

    const updated = await ClientProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      {
        $set: {
          isVerified: true,
          verificationDetails,
        },
      },
      { new: true }
    ).lean();

    if (!updated) throw new Error("Client profile not found");
    return updated as ClientProfile;
  }

  async getAllClients(
    pagination: { limit: number; skip: number },
    includeDeleted: boolean = false
  ): Promise<{ clients: ClientProfile[]; total: number; hasMore: boolean }> {
    const { limit, skip } = pagination;

    const countQuery: Record<string, any> = includeDeleted
      ? {}
      : { isDeleted: false };

    const [clients, total] = await Promise.all([
      ClientProfileModel.find(
        includeDeleted ? {} : { isDeleted: false },
        null,
        includeDeleted ? { includeSoftDeleted: true } : {}
      )
        .limit(limit)
        .skip(skip)
        .populate("profile", "userId role bio mobileNumber")
        .sort({ createdAt: -1 })
        .lean(),
      ClientProfileModel.countDocuments(countQuery),
    ]);

    return {
      clients: clients as unknown as ClientProfile[],
      total,
      hasMore: skip + clients.length < total,
    };
  }

  /**
   * Platform-wide or per-client stats.
   */
  async getClientStats(clientId?: string): Promise<{
    totalClients: number;
    deletedClients: number;
    verifiedClients: number;
    clientsWithAddresses: number;
    clientsWithFavorites: number;
  }> {
    const base: Record<string, any> = clientId
      ? { _id: new Types.ObjectId(clientId) }
      : {};

    const [
      totalClients,
      deletedClients,
      verifiedClients,
      withAddresses,
      withFavorites,
    ] = await Promise.all([
      ClientProfileModel.countDocuments({ ...base, isDeleted: false }),
      ClientProfileModel.countDocuments({ ...base, isDeleted: true }),
      ClientProfileModel.countDocuments({ ...base, isDeleted: false, isVerified: true }),
      ClientProfileModel.countDocuments({
        ...base,
        isDeleted: false,
        savedAddresses: { $exists: true, $not: { $size: 0 } },
      }),
      ClientProfileModel.countDocuments({
        ...base,
        isDeleted: false,
        $or: [
          { favoriteServices: { $exists: true, $not: { $size: 0 } } },
          { favoriteProviders: { $exists: true, $not: { $size: 0 } } },
        ],
      }),
    ]);

    return {
      totalClients,
      deletedClients,
      verifiedClients,
      clientsWithAddresses: withAddresses,
      clientsWithFavorites: withFavorites,
    };
  }
}