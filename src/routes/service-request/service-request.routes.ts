import { Router } from "express";
import {
  browseServices,
  expandSearch,
  createServiceRequest,
  getServiceRequestsByClient,
  getClientActivitySummary,
  getServiceRequestsByProvider,
  getPendingRequestsForProvider,
  getProviderActivitySummary,
  getServiceRequestById,
  deleteServiceRequest,
  cancelServiceRequest,
  rejectServiceRequest,
  getAllServiceRequests,
  getServiceRequestStats,
  expireOverdueServiceRequests,
  restoreServiceRequest,
  acceptServiceRequest,
} from "../../controllers/service-request/service-request.controller";
import {
  authenticateToken,
  requireVerification,
  requireAdmin,
} from "../../middleware/auth/auth.middleware";
import {
  requireCustomerOrProvider,
  requireCustomer,
  requireProvider,
} from "../../middleware/role/role.middleware";

const router = Router();

// ─── All routes require authentication + verified email ───────────────────────
router.use(authenticateToken, requireVerification);

// ─── Browse / Discovery ───────────────────────────────────────────────────────

/**
 * POST /api/service-requests/browse
 * Body: { locationContext: BrowseLocationContext, categoryId?, searchTerm?, priceRange? }
 * Query: page?, limit?
 *
 * Flow 2 entry point. Returns active services sorted nearest-first.
 * Open to both customers and providers (e.g. provider scouting competition).
 */
router.post("/browse", requireCustomerOrProvider, browseServices);

/**
 * POST /api/service-requests/browse/expand
 * Body: { originalLocationContext, expandedRadiusKm, page, limit? }
 *
 * Expands the search radius. Returns updated locationContext with isExpanded: true.
 * Client must persist this context for consistent subsequent pagination.
 */
router.post("/browse/expand", requireCustomerOrProvider, expandSearch);

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * POST /api/service-requests
 * Body: CreateServiceRequestBody
 *
 * Creates a new service request from a client to a specific provider.
 * Customer role required — clients initiate service requests.
 */
router.post("/", requireCustomer, createServiceRequest);

// ─── Client Routes ────────────────────────────────────────────────────────────

/**
 * GET /api/service-requests/client/:clientProfileId
 * Query: status?, limit?, skip?
 *
 * Paginated history of service requests made by a client.
 * Only the owning client or an admin should access this.
 */
router.get(
  "/client/:clientProfileId",
  requireCustomerOrProvider, // owner check is enforced inside the handler via profile resolution
  getServiceRequestsByClient,
);

/**
 * GET /api/service-requests/client/:clientProfileId/activity
 *
 * Compact activity counts for the client dashboard header.
 */
router.get(
  "/client/:clientProfileId/activity",
  requireCustomerOrProvider,
  getClientActivitySummary,
);

// ─── Provider Routes ──────────────────────────────────────────────────────────

/**
 * GET /api/service-requests/provider/:providerProfileId
 * Query: status?, limit?, skip?
 *
 * Paginated list of service requests directed at a provider.
 */
router.get(
  "/provider/:providerProfileId",
  requireProvider,
  getServiceRequestsByProvider,
);

/**
 * GET /api/service-requests/provider/:providerProfileId/pending
 * Query: limit?, skip?
 *
 * Provider decision inbox — PENDING requests only, sorted oldest-first (FIFO).
 * Expired requests are excluded; only genuinely actionable items appear.
 */
router.get(
  "/provider/:providerProfileId/pending",
  requireProvider,
  getPendingRequestsForProvider,
);

// ─── All routes require authentication + verified email ───────────────────────
router.use(authenticateToken, requireVerification);

// ─── Browse / Discovery ───────────────────────────────────────────────────────

router.post("/browse", requireCustomerOrProvider, browseServices);
router.post("/browse/expand", requireCustomerOrProvider, expandSearch);

// ─── Create ───────────────────────────────────────────────────────────────────

router.post("/", requireCustomer, createServiceRequest);

// ─── Client Routes ────────────────────────────────────────────────────────────

router.get(
  "/client/:clientProfileId",
  requireCustomerOrProvider,
  getServiceRequestsByClient,
);

router.get(
  "/client/:clientProfileId/activity",
  requireCustomerOrProvider,
  getClientActivitySummary,
);

// ─── Provider Routes ──────────────────────────────────────────────────────────

router.get(
  "/provider/:providerProfileId",
  requireProvider,
  getServiceRequestsByProvider,
);

router.get(
  "/provider/:providerProfileId/pending",
  requireProvider,
  getPendingRequestsForProvider,
);

router.get(
  "/provider/:providerProfileId/activity",
  requireProvider,
  getProviderActivitySummary,
);

// ─── Single Resource Routes ───────────────────────────────────────────────────

router.get(
  "/:serviceRequestId",
  requireCustomerOrProvider,
  getServiceRequestById,
);

router.delete(
  "/:serviceRequestId",
  requireCustomerOrProvider,
  deleteServiceRequest,
);

/**
 * POST /api/service-requests/:serviceRequestId/accept
 * Body: { message? }
 *
 * Provider accepts a PENDING service request directed at them.
 * Internally delegates to BookingService.createBookingFromServiceRequest,
 * which atomically creates the Booking and transitions the ServiceRequest
 * to ACCEPTED. Returns both documents so the client can redirect immediately.
 *
 * Must be registered BEFORE /:serviceRequestId/restore and similar catch-all
 * param routes to avoid Express matching "accept" as a serviceRequestId.
 */
router.post("/:serviceRequestId/accept", requireProvider, acceptServiceRequest);

router.post("/:serviceRequestId/cancel", requireCustomer, cancelServiceRequest);

router.post("/:serviceRequestId/reject", requireProvider, rejectServiceRequest);

// ─── Admin Routes ─────────────────────────────────────────────────────────────

router.get("/admin/all", requireAdmin, getAllServiceRequests);
router.get("/admin/stats", requireAdmin, getServiceRequestStats);
router.post("/admin/expire", requireAdmin, expireOverdueServiceRequests);

router.post("/:serviceRequestId/restore", requireAdmin, restoreServiceRequest);

/**
 * GET /api/service-requests/provider/:providerProfileId/activity
 *
 * Compact activity counts for the provider dashboard header.
 */
router.get(
  "/provider/:providerProfileId/activity",
  requireProvider,
  getProviderActivitySummary,
);

// ─── Single Resource Routes ───────────────────────────────────────────────────

/**
 * GET /api/service-requests/:serviceRequestId
 * Query: populate? ("true")
 *
 * Fetches a single service request by its _id.
 * Accessible to any authenticated user — ownership is enforced at the service layer
 * (the service returns null for non-participants on private requests).
 */
router.get(
  "/:serviceRequestId",
  requireCustomerOrProvider,
  getServiceRequestById,
);

/**
 * DELETE /api/service-requests/:serviceRequestId
 *
 * Soft-deletes a service request.
 * Only REJECTED, EXPIRED, or CANCELLED requests can be deleted.
 * ACCEPTED requests are blocked — the linked Booking depends on them.
 */
router.delete(
  "/:serviceRequestId",
  requireCustomerOrProvider,
  deleteServiceRequest,
);

/**
 * POST /api/service-requests/:serviceRequestId/cancel
 * Body: { reason? }
 *
 * Client withdraws a PENDING service request.
 * Only valid before the provider responds.
 */
router.post("/:serviceRequestId/cancel", requireCustomer, cancelServiceRequest);

/**
 * POST /api/service-requests/:serviceRequestId/reject
 * Body: { message? }
 *
 * Provider rejects a PENDING service request directed at them.
 * Only valid for PENDING requests that have not yet expired.
 *
 * NOTE: There is intentionally no /accept endpoint here.
 * Use POST /api/bookings/from-service-request/:serviceRequestId to accept
 * a request — that endpoint atomically creates the Booking.
 */
router.post("/:serviceRequestId/reject", requireProvider, rejectServiceRequest);

// ─── Admin Routes ─────────────────────────────────────────────────────────────

/**
 * GET /api/service-requests/admin/all
 * Query: status?, clientId?, providerId?, includeDeleted?, limit?, skip?
 *
 * Platform-wide paginated list. Admin only.
 */
router.get("/admin/all", requireAdmin, getAllServiceRequests);

/**
 * GET /api/service-requests/admin/stats
 * Query: actorId?, actorRole? ("client" | "provider")
 *
 * Platform-wide or per-actor stats: counts + acceptanceRate, conversionRate,
 * expiryRate, averageResponseMs. Admin only.
 */
router.get("/admin/stats", requireAdmin, getServiceRequestStats);

/**
 * POST /api/service-requests/admin/expire
 *
 * Batch-expires all PENDING requests whose expiresAt has passed.
 * Intended for cron job invocation (every 30 minutes). Admin only.
 */
router.post("/admin/expire", requireAdmin, expireOverdueServiceRequests);

/**
 * POST /api/service-requests/:serviceRequestId/restore
 *
 * Restores a soft-deleted service request. Admin only.
 */
router.post("/:serviceRequestId/restore", requireAdmin, restoreServiceRequest);

export default router;
