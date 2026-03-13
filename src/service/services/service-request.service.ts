// services/service-requests/service-request.service.ts
import { Types, HydratedDocument } from "mongoose";
import ClientProfileModel from "../../models/profiles/client.profile.model";
import ProviderProfileModel from "../../models/profiles/provider.profile.model";
import { ServiceModel } from "../../models/service/serviceModel";
import {
  ServiceRequest,
  ServiceRequestMethods,
  ServiceRequestStatus,
  CreateServiceRequestBody,
  BrowseServicesParams,
  ExpandServiceSearchParams,
} from "../../types/service-request.types";
import { Coordinates, BrowseLocationContext } from "../../types/location.types";
import {
  LocationService,
  locationService as defaultLocationService,
} from "../location.service";
import ServiceRequestModel from "../../models/service/service-request.model";

type ServiceRequestDoc = HydratedDocument<ServiceRequest, ServiceRequestMethods>;

// ─── Local Types ──────────────────────────────────────────────────────────────

/**
 * A single result item returned by browseServices / expandSearch.
 *
 * Keeps the service document nested under `service` so consumers can
 * destructure serviceId, providerId, and distanceKm at the top level
 * without name collisions.
 */
export interface ServiceBrowseResult {
  serviceId:  Types.ObjectId;
  providerId: Types.ObjectId;
  distanceKm: number;
  service:    any;
  provider:   any;
}

export interface BrowseServicesResult {
  services:        ServiceBrowseResult[];
  locationContext: BrowseLocationContext;
  totalResults:    number;
  hasMore:         boolean;
  page:            number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * A service request expires after 48 hours if the provider does not respond.
 * Shorter than a Task's 7-day window because a direct request deserves
 * a timely reply — an unanswered request after two days signals disinterest.
 */
const DEFAULT_EXPIRY_HOURS = 48;

/** Default initial browse radius when the caller does not supply one */
const DEFAULT_INITIAL_RADIUS_KM = 20;

/** Hard cap on how far a browse can be expanded — prevents returning
 *  the entire country when "load more" is tapped repeatedly */
const MAX_EXPANDED_RADIUS_KM = 100;

/** Statuses that block a new request from the same client to the same
 *  provider/service pair. REJECTED and EXPIRED are excluded — the client
 *  should be allowed to retry after a provider declines or a request lapses. */
const DUPLICATE_BLOCK_STATUSES: ServiceRequestStatus[] = [
  ServiceRequestStatus.PENDING,
  ServiceRequestStatus.ACCEPTED,
];

/** Statuses a service request can be cancelled from */
const CANCELLABLE_STATUSES: ServiceRequestStatus[] = [
  ServiceRequestStatus.PENDING,
];

/** Terminal statuses — no further transitions permitted */
const TERMINAL_STATUSES: ServiceRequestStatus[] = [
  ServiceRequestStatus.ACCEPTED,
  ServiceRequestStatus.REJECTED,
  ServiceRequestStatus.EXPIRED,
  ServiceRequestStatus.CANCELLED,
];

const DEFAULT_CURRENCY = "GHS";

// ─── Service ──────────────────────────────────────────────────────────────────

export class ServiceRequestService {
  constructor(
    private readonly locationService: LocationService = defaultLocationService,
  ) {}

  // ─── Browse / Discovery (Flow 2 entry point) ──────────────────────────────

  /**
   * Returns active services near the client's GPS location, sorted
   * nearest-first with `distanceKm` attached to each result.
   *
   * This is the first step in Flow 2: client opens the browse screen, the
   * device sends a live GPS fix, and the UI renders nearby services.
   *
   * Algorithm:
   *   1. Determine the active search radius (initialRadiusKm when not expanded,
   *      expandedRadiusKm when the client has tapped "load more")
   *   2. Fetch all active, non-deleted services with optional filters applied
   *      at the DB level (category, text search, price range) to reduce the
   *      candidate set before the Haversine pass
   *   3. Populate each service's providerId to get locationData.gpsCoordinates
   *   4. Compute Haversine distance from the client's GPS fix to each provider
   *   5. Discard services whose provider falls outside the radius
   *   6. Sort remaining results nearest-first
   *   7. Return the requested page
   *
   * Note on GPS accuracy: the `accuracy` field on GPSLocation is informational.
   * We do not reject low-accuracy fixes here — the UI should warn the user
   * when accuracy > 100 m, but we still run the search.
   *
   * @param params.locationContext - GPS fix + radius settings
   * @param params.categoryId      - optional category filter (applied at DB level)
   * @param params.searchTerm      - optional text search (uses $text index)
   * @param params.priceRange      - optional min/max price filter
   * @param params.page            - 1-indexed page number (default: 1)
   * @param params.limit           - results per page (default: 20)
   */
  async browseServices(params: BrowseServicesParams): Promise<BrowseServicesResult> {
    const {
      locationContext,
      categoryId,
      searchTerm,
      priceRange,
      page  = 1,
      limit = 20,
    } = params;

    if (!locationContext?.gpsLocation) {
      throw new Error("GPS location is required to browse services");
    }

    const radiusKm = locationContext.isExpanded
      ? (locationContext.expandedRadiusKm ?? DEFAULT_INITIAL_RADIUS_KM)
      : locationContext.initialRadiusKm;

    const from: Coordinates = {
      latitude:  locationContext.gpsLocation.latitude,
      longitude: locationContext.gpsLocation.longitude,
    };

    // ── DB-level filtering ────────────────────────────────────────────────────
    // Reduce the candidate set before the expensive Haversine pass.
    // Text search and price filters are applied here; location filter is
    // applied in application memory because we need Haversine — MongoDB's
    // $near requires GeoJSON format which the current schema does not use.
    const serviceQuery: Record<string, any> = {
      isActive:  true,
      isDeleted: false,
    };

    if (categoryId && Types.ObjectId.isValid(categoryId)) {
      serviceQuery.categoryId = new Types.ObjectId(categoryId);
    }
    if (searchTerm?.trim()) {
      serviceQuery.$text = { $search: searchTerm.trim() };
    }
    if (priceRange?.min != null || priceRange?.max != null) {
      serviceQuery["servicePricing.basePrice"] = {};
      if (priceRange.min != null) {
        serviceQuery["servicePricing.basePrice"].$gte = priceRange.min;
      }
      if (priceRange.max != null) {
        serviceQuery["servicePricing.basePrice"].$lte = priceRange.max;
      }
      if (priceRange.currency) {
        serviceQuery["servicePricing.currency"] =
          priceRange.currency.toUpperCase();
      }
    }

    const services = await ServiceModel.find(serviceQuery)
      .populate({
        path:   "providerId",
        match:  { isDeleted: false },
        select: "businessName locationData providerContactInfo isAlwaysAvailable workingHours businessGalleryImages",
        populate: {
          path:   "businessGalleryImages",
          select: "url thumbnailUrl",
        },
      })
      .populate("categoryId", "catName slug")
      .populate("coverImage",  "url thumbnailUrl")
      .sort(searchTerm ? { score: { $meta: "textScore" } } : { createdAt: -1 })
      .lean();

    // ── Haversine distance filter ─────────────────────────────────────────────
    // Exclude services whose provider has no GPS coordinates or falls outside
    // the radius. Providers with no coordinates are silently excluded rather
    // than given Infinity distance — they have not completed onboarding.
    const nearbyResults: ServiceBrowseResult[] = [];

    for (const service of services) {
      const provider = service.providerId as any;

      // providerId populate returns null when the provider is soft-deleted
      if (!provider || !provider._id) continue;

      const providerCoords: Coordinates | null =
        provider.locationData?.gpsCoordinates ?? null;

      if (!providerCoords) continue;

      const distanceKm = this.locationService.calculateDistance(from, providerCoords);
      if (distanceKm > radiusKm) continue;

      nearbyResults.push({
        serviceId:  service._id as Types.ObjectId,
        providerId: provider._id as Types.ObjectId,
        distanceKm: parseFloat(distanceKm.toFixed(2)),
        service,
        provider,
      });
    }

    // Sort nearest-first, breaking ties by creation date (newest first)
    nearbyResults.sort((a, b) => {
      if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
      return 0;
    });

    // ── Pagination ────────────────────────────────────────────────────────────
    const totalResults = nearbyResults.length;
    const skip         = (page - 1) * limit;
    const pageResults  = nearbyResults.slice(skip, skip + limit);

    return {
      services:        pageResults,
      locationContext,
      totalResults,
      hasMore:         skip + pageResults.length < totalResults,
      page,
    };
  }

  /**
   * Expands the search radius and returns the next page of results.
   *
   * Called when the client taps "load more" or "expand search" and the UI
   * has exhausted results within the initial radius. The expanded radius is
   * capped at MAX_EXPANDED_RADIUS_KM (100 km) to prevent effectively
   * returning national results on a local browse.
   *
   * Returns an updated `locationContext` with `isExpanded: true` and
   * `expandedRadiusKm` set — the client should persist this context and
   * pass it back in subsequent calls so pagination remains consistent.
   *
   * @param params.originalLocationContext - the context used in the first browse call
   * @param params.expandedRadiusKm        - new radius (capped at MAX_EXPANDED_RADIUS_KM)
   * @param params.page                    - which page within the expanded results
   * @param params.limit                   - results per page (default: 20)
   */
  async expandSearch(
    params: ExpandServiceSearchParams,
  ): Promise<BrowseServicesResult> {
    const { originalLocationContext, expandedRadiusKm, page, limit = 20 } = params;

    if (expandedRadiusKm <= originalLocationContext.initialRadiusKm) {
      throw new Error(
        `Expanded radius (${expandedRadiusKm} km) must be greater than ` +
        `the initial radius (${originalLocationContext.initialRadiusKm} km)`,
      );
    }

    const cappedRadius = Math.min(expandedRadiusKm, MAX_EXPANDED_RADIUS_KM);

    const expandedContext: BrowseLocationContext = {
      ...originalLocationContext,
      expandedRadiusKm: cappedRadius,
      isExpanded:       true,
    };

    return this.browseServices({
      locationContext: expandedContext,
      page,
      limit,
    });
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  /**
   * Creates a new service request from a client to a specific provider.
   *
   * Validations (in order):
   *   1. clientProfileId, serviceId, and providerId are valid ObjectIds
   *   2. Client profile exists and is not deleted
   *   3. Service exists, is active, and belongs to the target provider
   *      (prevents a client crafting a request with a mismatched serviceId/providerId)
   *   4. Provider profile exists and is not deleted
   *   5. No duplicate PENDING or ACCEPTED request exists for the same
   *      client → provider → service triple
   *      (REJECTED and EXPIRED are excluded — the client may retry)
   *   6. scheduledDate is in the future
   *
   * The `discoveryContext` field is stored as-is from the request body —
   * it records how the client found this provider for analytics and dispute
   * context. The service layer does not validate it beyond accepting the
   * union of known source values.
   *
   * NOTE: Accepting a service request is NOT handled here.
   * Acceptance is exclusively performed by BookingService.createBookingFromServiceRequest,
   * which handles the SR → ACCEPTED transition and booking creation atomically.
   * Calling accept() on the SR outside of that path would leave the system in
   * an inconsistent state (accepted SR with no booking).
   *
   * @param clientProfileId - the UserProfile._id of the requesting client
   *                          (matches clientId on Booking — ref: "UserProfile")
   * @param data            - validated request payload
   */
  async createServiceRequest(
    clientProfileId: string,
    data: CreateServiceRequestBody,
  ): Promise<ServiceRequest> {
    if (!Types.ObjectId.isValid(clientProfileId)) {
      throw new Error("Invalid client profile ID");
    }
    if (!Types.ObjectId.isValid(data.serviceId)) {
      throw new Error("Invalid service ID");
    }
    if (!Types.ObjectId.isValid(data.providerId)) {
      throw new Error("Invalid provider profile ID");
    }

    // ── 1. Verify client, service, and provider in parallel ──────────────────
    const [clientExists, service, provider] = await Promise.all([
      ClientProfileModel.countDocuments({
        _id:       new Types.ObjectId(clientProfileId),
        isDeleted: false,
      }),
      ServiceModel.findOne({
        _id:       new Types.ObjectId(data.serviceId),
        isActive:  true,
        isDeleted: false,
      }).lean(),
      ProviderProfileModel.findOne({
        _id:       new Types.ObjectId(data.providerId),
        isDeleted: false,
      }).lean(),
    ]);

    if (!clientExists) throw new Error("Client profile not found");
    if (!service)      throw new Error("Service not found or inactive");
    if (!provider)     throw new Error("Provider profile not found");

    // ── 2. Service ownership guard ────────────────────────────────────────────
    // The service's providerId must match the target provider. This blocks
    // a crafted payload that pairs an arbitrary serviceId with a different provider.
    if (service.providerId?.toString() !== data.providerId) {
      throw new Error(
        "The selected service does not belong to the specified provider",
      );
    }

    // ── 3. Duplicate request guard ────────────────────────────────────────────
    const duplicateExists = await ServiceRequestModel.countDocuments({
      clientId:   new Types.ObjectId(clientProfileId),
      providerId: new Types.ObjectId(data.providerId),
      serviceId:  new Types.ObjectId(data.serviceId),
      status:     { $in: DUPLICATE_BLOCK_STATUSES },
      isDeleted:  false,
    });

    if (duplicateExists) {
      throw new Error(
        "You already have a pending or accepted request for this service " +
        "with this provider. Wait for their response before sending another.",
      );
    }

    // ── 4. Scheduled date must be in the future ───────────────────────────────
    if (data.scheduledDate <= new Date()) {
      throw new Error("Scheduled date must be in the future");
    }

    // ── 5. Calculate expiry ───────────────────────────────────────────────────
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + DEFAULT_EXPIRY_HOURS);

    const serviceRequest = await ServiceRequestModel.create({
      clientId:   new Types.ObjectId(clientProfileId),
      providerId: new Types.ObjectId(data.providerId),
      serviceId:  new Types.ObjectId(data.serviceId),
      serviceLocation:   data.serviceLocation,
      scheduledDate:     data.scheduledDate,
      scheduledTimeSlot: data.scheduledTimeSlot,
      clientMessage:     data.clientMessage?.trim(),
      estimatedBudget:   data.estimatedBudget
        ? {
            ...data.estimatedBudget,
            currency: (
              data.estimatedBudget.currency ?? DEFAULT_CURRENCY
            ).toUpperCase(),
          }
        : undefined,
      discoveryContext: data.discoveryContext,
      status:    ServiceRequestStatus.PENDING,
      expiresAt,
    });

    return serviceRequest.toObject() as ServiceRequest;
  }

  // ─── Provider Response ────────────────────────────────────────────────────

  /**
   * Provider rejects a service request directed at them.
   *
   * Ownership guard: the caller's providerProfileId must match the
   * request's providerId.
   *
   * Only PENDING requests can be rejected — once a request is ACCEPTED,
   * EXPIRED, CANCELLED, or already REJECTED, no further response is valid.
   *
   * NOTE: There is intentionally no `acceptServiceRequest` method here.
   * Acceptance is exclusively handled by BookingService.createBookingFromServiceRequest,
   * which atomically creates the Booking and transitions the ServiceRequest
   * to ACCEPTED in a single operation. Separating the two would create a
   * window where the SR is ACCEPTED but no Booking exists.
   *
   * Transition: PENDING → REJECTED
   */
  async rejectServiceRequest(
    serviceRequestId: string,
    providerProfileId: string,
    message?: string,
  ): Promise<ServiceRequest> {
    if (!Types.ObjectId.isValid(serviceRequestId)) {
      throw new Error("Invalid service request ID");
    }
    if (!Types.ObjectId.isValid(providerProfileId)) {
      throw new Error("Invalid provider profile ID");
    }

    const serviceRequest = (await ServiceRequestModel.findOne({
      _id:        new Types.ObjectId(serviceRequestId),
      providerId: new Types.ObjectId(providerProfileId),
      isDeleted:  false,
    })) as ServiceRequestDoc | null;

    if (!serviceRequest) {
      throw new Error(
        "Service request not found or you are not the provider for this request",
      );
    }

    if (serviceRequest.status !== ServiceRequestStatus.PENDING) {
      throw new Error(
        `Cannot reject a service request with status: ${serviceRequest.status}. ` +
        `Only PENDING requests can be rejected.`,
      );
    }

    // Guard: expired requests should be rejected with a specific message
    // rather than silently allowing a provider to "reject" an already-expired one.
    if (serviceRequest.expiresAt && serviceRequest.expiresAt < new Date()) {
      throw new Error(
        "This service request has already expired and cannot be rejected",
      );
    }

    await serviceRequest.reject(
      new Types.ObjectId(providerProfileId),
      message?.trim(),
    );

    return serviceRequest.toObject() as ServiceRequest;
  }

  // ─── Client Cancellation ──────────────────────────────────────────────────

  /**
   * Client withdraws a pending service request before the provider responds.
   *
   * Ownership guard: the caller's clientProfileId must match the
   * request's clientId.
   *
   * Only PENDING requests can be cancelled — once a provider has accepted
   * or rejected the request, the client should go through the booking
   * cancellation flow (BookingService.cancelBooking) if they want to cancel.
   *
   * Transition: PENDING → CANCELLED
   */
  async cancelServiceRequest(
    serviceRequestId: string,
    clientProfileId: string,
    reason?: string,
  ): Promise<ServiceRequest> {
    if (!Types.ObjectId.isValid(serviceRequestId)) {
      throw new Error("Invalid service request ID");
    }
    if (!Types.ObjectId.isValid(clientProfileId)) {
      throw new Error("Invalid client profile ID");
    }

    const serviceRequest = (await ServiceRequestModel.findOne({
      _id:       new Types.ObjectId(serviceRequestId),
      clientId:  new Types.ObjectId(clientProfileId),
      isDeleted: false,
    })) as ServiceRequestDoc | null;

    if (!serviceRequest) {
      throw new Error(
        "Service request not found or you do not own this request",
      );
    }

    if (!CANCELLABLE_STATUSES.includes(serviceRequest.status)) {
      throw new Error(
        `Cannot cancel a service request with status: ${serviceRequest.status}. ` +
        `Only PENDING requests can be cancelled.`,
      );
    }

    await serviceRequest.cancel(
      reason?.trim(),
      new Types.ObjectId(clientProfileId),
    );

    return serviceRequest.toObject() as ServiceRequest;
  }

  // ─── Expiry ───────────────────────────────────────────────────────────────

  /**
   * Batch-expires all PENDING service requests whose `expiresAt` has passed.
   *
   * Should be invoked by a scheduled cron job (e.g. every 30 minutes).
   * Uses `updateMany` to avoid loading documents into application memory.
   *
   * Returns the number of requests transitioned to EXPIRED.
   *
   * Expired requests are retained in the DB — clients and admins can still
   * query them. They are never automatically soft-deleted.
   */
  async expireOverdueServiceRequests(): Promise<number> {
    const result = await ServiceRequestModel.updateMany(
      {
        isDeleted:  false,
        status:     ServiceRequestStatus.PENDING,
        expiresAt:  { $lte: new Date() },
      },
      {
        status:    ServiceRequestStatus.EXPIRED,
      },
    );
    return result.modifiedCount;
  }

  // ─── Core Reads ───────────────────────────────────────────────────────────

  /**
   * Fetches a single service request by its _id.
   *
   * populate: true loads:
   *   - clientId   → UserProfile (bio, mobileNumber, profilePictureId)
   *   - providerId → ProviderProfile (businessName, providerContactInfo, locationData)
   *   - serviceId  → Service (title, slug, servicePricing, coverImage)
   */
  async getServiceRequestById(
    serviceRequestId: string,
    populate: boolean = false,
  ): Promise<ServiceRequest | null> {
    if (!Types.ObjectId.isValid(serviceRequestId)) {
      throw new Error("Invalid service request ID");
    }

    const query = ServiceRequestModel.findOne({
      _id:       new Types.ObjectId(serviceRequestId),
      isDeleted: false,
    });

    if (populate) {
      query
        .populate("clientId",   "bio mobileNumber profilePictureId")
        .populate("providerId", "businessName providerContactInfo locationData")
        .populate("serviceId",  "title slug servicePricing coverImage");
    }

    return (await query.lean()) as ServiceRequest | null;
  }

  /**
   * Returns a paginated list of service requests made by a specific client.
   * Most recent first. The clientProfileId is the UserProfile._id.
   */
  async getServiceRequestsByClient(
    clientProfileId: string,
    options: {
      status?: ServiceRequestStatus;
      limit?:  number;
      skip?:   number;
    } = {},
  ): Promise<{ requests: ServiceRequest[]; total: number; hasMore: boolean }> {
    if (!Types.ObjectId.isValid(clientProfileId)) {
      throw new Error("Invalid client profile ID");
    }

    const { status, limit = 20, skip = 0 } = options;

    const query: Record<string, any> = {
      clientId:  new Types.ObjectId(clientProfileId),
      isDeleted: false,
    };
    if (status) query.status = status;

    const [requests, total] = await Promise.all([
      ServiceRequestModel.find(query)
        .populate("providerId", "businessName providerContactInfo locationData")
        .populate("serviceId",  "title slug servicePricing coverImage")
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean(),
      ServiceRequestModel.countDocuments(query),
    ]);

    return {
      requests: requests as ServiceRequest[],
      total,
      hasMore:  skip + requests.length < total,
    };
  }

  /**
   * Returns a paginated list of service requests directed at a specific provider.
   * Most recent first.
   */
  async getServiceRequestsByProvider(
    providerProfileId: string,
    options: {
      status?: ServiceRequestStatus;
      limit?:  number;
      skip?:   number;
    } = {},
  ): Promise<{ requests: ServiceRequest[]; total: number; hasMore: boolean }> {
    if (!Types.ObjectId.isValid(providerProfileId)) {
      throw new Error("Invalid provider profile ID");
    }

    const { status, limit = 20, skip = 0 } = options;

    const query: Record<string, any> = {
      providerId: new Types.ObjectId(providerProfileId),
      isDeleted:  false,
    };
    if (status) query.status = status;

    const [requests, total] = await Promise.all([
      ServiceRequestModel.find(query)
        .populate("clientId",  "bio mobileNumber profilePictureId")
        .populate("serviceId", "title slug servicePricing")
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean(),
      ServiceRequestModel.countDocuments(query),
    ]);

    return {
      requests: requests as ServiceRequest[],
      total,
      hasMore:  skip + requests.length < total,
    };
  }

  /**
   * Returns PENDING requests directed at a provider, sorted oldest-first
   * so the provider works through them in arrival order.
   *
   * This is the provider's inbox — the list of requests awaiting their
   * accept or reject decision. Expired requests are excluded (the expiry
   * job will have already flipped them to EXPIRED before this runs, but
   * a tight race is handled by the `expiresAt` filter).
   */
  async getPendingRequestsForProvider(
    providerProfileId: string,
    options: { limit?: number; skip?: number } = {},
  ): Promise<{ requests: ServiceRequest[]; total: number; hasMore: boolean }> {
    if (!Types.ObjectId.isValid(providerProfileId)) {
      throw new Error("Invalid provider profile ID");
    }

    const { limit = 20, skip = 0 } = options;
    const now = new Date();

    const query = {
      providerId: new Types.ObjectId(providerProfileId),
      status:     ServiceRequestStatus.PENDING,
      isDeleted:  false,
      // Exclude requests that have passed their expiry — the cron may not have
      // run yet but we should not surface expired requests in the inbox
      $or: [
        { expiresAt: { $gt: now } },
        { expiresAt: { $exists: false } },
      ],
    };

    const [requests, total] = await Promise.all([
      ServiceRequestModel.find(query)
        .populate("clientId",  "bio mobileNumber profilePictureId")
        .populate("serviceId", "title slug servicePricing coverImage")
        .sort({ createdAt: 1 }) // oldest request first — FIFO inbox
        .limit(limit)
        .skip(skip)
        .lean(),
      ServiceRequestModel.countDocuments(query),
    ]);

    return {
      requests: requests as ServiceRequest[],
      total,
      hasMore:  skip + requests.length < total,
    };
  }

  // ─── Soft Delete / Restore ────────────────────────────────────────────────

  /**
   * Soft-deletes a service request.
   * Only terminal requests (REJECTED, EXPIRED, CANCELLED) may be deleted.
   * ACCEPTED requests must not be deleted — the linked Booking depends on
   * them for audit trail and dispute context.
   */
  async deleteServiceRequest(
    serviceRequestId: string,
    deletedBy?: string,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(serviceRequestId)) {
      throw new Error("Invalid service request ID");
    }

    const serviceRequest = (await ServiceRequestModel.findOne({
      _id:       new Types.ObjectId(serviceRequestId),
      isDeleted: false,
    })) as ServiceRequestDoc | null;

    if (!serviceRequest) throw new Error("Service request not found");

    // ACCEPTED is intentionally excluded — the linked booking needs this record
    const deletableStatuses: ServiceRequestStatus[] = [
      ServiceRequestStatus.REJECTED,
      ServiceRequestStatus.EXPIRED,
      ServiceRequestStatus.CANCELLED,
    ];

    if (!deletableStatuses.includes(serviceRequest.status)) {
      throw new Error(
        `Cannot delete a service request with status: ${serviceRequest.status}. ` +
        `Only REJECTED, EXPIRED, or CANCELLED requests can be deleted.`,
      );
    }

    await serviceRequest.softDelete(
      deletedBy ? new Types.ObjectId(deletedBy) : undefined,
    );
    return true;
  }

  async restoreServiceRequest(
    serviceRequestId: string,
  ): Promise<ServiceRequest | null> {
    if (!Types.ObjectId.isValid(serviceRequestId)) {
      throw new Error("Invalid service request ID");
    }

    const serviceRequest = (await ServiceRequestModel.findOne(
      { _id: new Types.ObjectId(serviceRequestId), isDeleted: true },
      null,
      { includeSoftDeleted: true },
    )) as ServiceRequestDoc | null;

    if (!serviceRequest) throw new Error("Deleted service request not found");

    await serviceRequest.restore();
    return (
      await ServiceRequestModel.findById(serviceRequestId).lean()
    ) as ServiceRequest | null;
  }

  // ─── Admin Operations ─────────────────────────────────────────────────────

  /**
   * Returns a paginated list of all service requests across the platform.
   * Used by the admin dashboard.
   */
  async getAllServiceRequests(
    pagination: { limit: number; skip: number },
    filters: {
      status?:         ServiceRequestStatus;
      clientId?:       string;
      providerId?:     string;
      includeDeleted?: boolean;
    } = {},
  ): Promise<{ requests: ServiceRequest[]; total: number; hasMore: boolean }> {
    const { limit, skip } = pagination;
    const { status, clientId, providerId, includeDeleted = false } = filters;

    const query: Record<string, any> = includeDeleted ? {} : { isDeleted: false };
    if (status) query.status = status;
    if (clientId   && Types.ObjectId.isValid(clientId)) {
      query.clientId   = new Types.ObjectId(clientId);
    }
    if (providerId && Types.ObjectId.isValid(providerId)) {
      query.providerId = new Types.ObjectId(providerId);
    }

    const queryOptions = includeDeleted ? { includeSoftDeleted: true } : {};

    const [requests, total] = await Promise.all([
      ServiceRequestModel.find(query, null, queryOptions)
        .populate("clientId",   "bio mobileNumber")
        .populate("providerId", "businessName providerContactInfo")
        .populate("serviceId",  "title slug")
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean(),
      ServiceRequestModel.countDocuments(query),
    ]);

    return {
      requests: requests as ServiceRequest[],
      total,
      hasMore:  skip + requests.length < total,
    };
  }

  /**
   * Platform-wide or per-actor service request statistics.
   *
   * Pass actorId + actorRole to scope to a single client or provider.
   * Omit both for a system-wide admin overview.
   *
   * Metrics:
   *   acceptanceRate     — ACCEPTED / (ACCEPTED + REJECTED) — provider responsiveness
   *   conversionRate     — ACCEPTED with a linked booking / total — booking follow-through
   *   averageResponseMs  — mean time from createdAt to providerResponse.respondedAt
   *   expiryRate         — EXPIRED / total — signals providers are not checking inbox
   */
  async getServiceRequestStats(options: {
    actorId?:   string;
    actorRole?: "client" | "provider";
  } = {}): Promise<{
    total:              number;
    pending:            number;
    accepted:           number;
    rejected:           number;
    expired:            number;
    cancelled:          number;
    deleted:            number;
    acceptanceRate:     number;
    conversionRate:     number;
    expiryRate:         number;
    averageResponseMs:  number | null;
  }> {
    const { actorId, actorRole } = options;

    const base: Record<string, any> = {};
    if (actorId && Types.ObjectId.isValid(actorId) && actorRole) {
      const field   = actorRole === "client" ? "clientId" : "providerId";
      base[field]   = new Types.ObjectId(actorId);
    }

    const [
      total,
      pending,
      accepted,
      rejected,
      expired,
      cancelled,
      deleted,
      converted,
      responseTimeAgg,
    ] = await Promise.all([
      ServiceRequestModel.countDocuments({ ...base, isDeleted: false }),
      ServiceRequestModel.countDocuments({ ...base, isDeleted: false, status: ServiceRequestStatus.PENDING }),
      ServiceRequestModel.countDocuments({ ...base, isDeleted: false, status: ServiceRequestStatus.ACCEPTED }),
      ServiceRequestModel.countDocuments({ ...base, isDeleted: false, status: ServiceRequestStatus.REJECTED }),
      ServiceRequestModel.countDocuments({ ...base, isDeleted: false, status: ServiceRequestStatus.EXPIRED }),
      ServiceRequestModel.countDocuments({ ...base, isDeleted: false, status: ServiceRequestStatus.CANCELLED }),
      ServiceRequestModel.countDocuments({ ...base, isDeleted: true }),

      // Conversion: ACCEPTED requests that have a booking linked
      ServiceRequestModel.countDocuments({
        ...base,
        isDeleted:            false,
        status:               ServiceRequestStatus.ACCEPTED,
        convertedToBookingId: { $exists: true, $ne: null },
      }),

      // Average response time: ms between createdAt and providerResponse.respondedAt
      // Only available on ACCEPTED and REJECTED (the two paths with a provider response)
      ServiceRequestModel.aggregate([
        {
          $match: {
            ...base,
            isDeleted: false,
            status:    { $in: [ServiceRequestStatus.ACCEPTED, ServiceRequestStatus.REJECTED] },
            "providerResponse.respondedAt": { $exists: true },
          },
        },
        {
          $project: {
            responseMs: {
              $subtract: ["$providerResponse.respondedAt", "$createdAt"],
            },
          },
        },
        {
          $group: {
            _id:             null,
            avgResponseMs:   { $avg: "$responseMs" },
          },
        },
      ]),
    ]);

    const decidedByProvider = accepted + rejected;

    const acceptanceRate =
      decidedByProvider > 0
        ? parseFloat(((accepted / decidedByProvider) * 100).toFixed(2))
        : 0;

    const conversionRate =
      accepted > 0
        ? parseFloat(((converted / accepted) * 100).toFixed(2))
        : 0;

    const expiryRate =
      total > 0
        ? parseFloat(((expired / total) * 100).toFixed(2))
        : 0;

    const averageResponseMs =
      responseTimeAgg.length > 0
        ? parseFloat(responseTimeAgg[0].avgResponseMs.toFixed(0))
        : null;

    return {
      total,
      pending,
      accepted,
      rejected,
      expired,
      cancelled,
      deleted,
      acceptanceRate,
      conversionRate,
      expiryRate,
      averageResponseMs,
    };
  }

  /**
   * Returns a compact activity summary for a client or provider dashboard header.
   * Runs all counts in parallel.
   */
  async getActivitySummary(
    actorId:   string,
    actorRole: "client" | "provider",
  ): Promise<{
    total:     number;
    pending:   number;
    accepted:  number;
    rejected:  number;
    expired:   number;
    cancelled: number;
  }> {
    if (!Types.ObjectId.isValid(actorId)) throw new Error("Invalid actor ID");

    const field = actorRole === "client" ? "clientId" : "providerId";
    const base  = { [field]: new Types.ObjectId(actorId), isDeleted: false };

    const [total, pending, accepted, rejected, expired, cancelled] =
      await Promise.all([
        ServiceRequestModel.countDocuments(base),
        ServiceRequestModel.countDocuments({ ...base, status: ServiceRequestStatus.PENDING }),
        ServiceRequestModel.countDocuments({ ...base, status: ServiceRequestStatus.ACCEPTED }),
        ServiceRequestModel.countDocuments({ ...base, status: ServiceRequestStatus.REJECTED }),
        ServiceRequestModel.countDocuments({ ...base, status: ServiceRequestStatus.EXPIRED }),
        ServiceRequestModel.countDocuments({ ...base, status: ServiceRequestStatus.CANCELLED }),
      ]);

    return { total, pending, accepted, rejected, expired, cancelled };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * Shared ServiceRequestService instance.
 * Import this in route handlers — do not instantiate directly in application code.
 *
 * In tests, construct a fresh instance with a mocked LocationService:
 *   new ServiceRequestService(mockLocationService)
 */
export const serviceRequestService = new ServiceRequestService();