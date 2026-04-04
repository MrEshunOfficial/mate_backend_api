import { Router } from "express";
import { getAllBookings, getBookingStats, getActiveBookings, getBookingsPendingValidation, getDisputedBookings, getBookingByNumber, getBookingByTask, getBookingByServiceRequest, createBookingFromTask, createBookingFromServiceRequest, getBookingsByClient, getBookingsByProvider, getUpcomingBookings, getBookingsByDateRange, getActivitySummary, getBookingById, deleteBooking, startService, completeService, validateCompletion, cancelBooking, rescheduleBooking, updatePaymentStatus, getPaymentSummary, resolveDispute, restoreBooking, submitRebuttal } from "../../controllers/booking/booking.controller";
import { authenticateToken, requireVerification, requireAdmin } from "../../middleware/auth/auth.middleware";
import { requireCustomerOrProvider, requireCustomer, requireProvider } from "../../middleware/role/role.middleware";

const router = Router();

// ─── All routes require authentication + verified email ───────────────────────
router.use(authenticateToken, requireVerification);

// ─── Admin Routes (defined first to prevent :bookingId param conflicts) ───────

/**
 * GET /api/bookings/admin/all
 * Query: status?, paymentStatus?, clientId?, providerId?, includeDeleted?, limit?, skip?
 *
 * Platform-wide paginated list. Admin only.
 */
router.get("/admin/all", requireAdmin, getAllBookings);

/**
 * GET /api/bookings/admin/stats
 * Query: actorId?, actorRole? ("customer" | "provider")
 *
 * Platform-wide or per-actor booking statistics. Admin only.
 */
router.get("/admin/stats", requireAdmin, getBookingStats);

/**
 * GET /api/bookings/admin/active
 * Query: limit?, skip?
 *
 * Live oversight of all CONFIRMED + IN_PROGRESS bookings. Admin only.
 */
router.get("/admin/active", requireAdmin, getActiveBookings);

/**
 * GET /api/bookings/admin/pending-validation
 * Query: limit?, skip?
 *
 * Bookings awaiting client validation — stalled validation triage. Admin only.
 */
router.get("/admin/pending-validation", requireAdmin, getBookingsPendingValidation);

/**
 * GET /api/bookings/admin/disputed
 * Query: limit?, skip?
 *
 * All DISPUTED bookings sorted oldest-first for admin triage. Admin only.
 */
router.get("/admin/disputed", requireAdmin, getDisputedBookings);

// ─── Lookup Routes ────────────────────────────────────────────────────────────

/**
 * GET /api/bookings/number/:bookingNumber
 *
 * Looks up a booking by its human-readable booking number (e.g. "BK-20241215-A3F9XX").
 * Used in customer support flows and notification deep-links.
 * includeDeleted is only honoured for admin callers — ignore it for non-admins
 * by overriding the query param in the handler if needed.
 */
router.get("/number/:bookingNumber", requireCustomerOrProvider, getBookingByNumber);

/**
 * GET /api/bookings/task/:taskId
 *
 * Returns the booking linked to a task, if one exists.
 */
router.get("/task/:taskId", requireCustomerOrProvider, getBookingByTask);

/**
 * GET /api/bookings/service-request/:serviceRequestId
 *
 * Returns the booking linked to a service request, if one exists.
 */
router.get(
  "/service-request/:serviceRequestId",
  requireCustomerOrProvider,
  getBookingByServiceRequest,
);

// ─── Creation Routes ──────────────────────────────────────────────────────────

/**
 * POST /api/bookings/from-task/:taskId
 * Body: CreateBookingFromTaskInput
 *
 * Flow 1: Converts an ACCEPTED task into a confirmed booking.
 * Called by the task's owning client after a provider accepts the task.
 * Customer role required.
 */
router.post("/from-task/:taskId", requireCustomer, createBookingFromTask);

/**
 * POST /api/bookings/from-service-request/:serviceRequestId
 * Body: CreateBookingFromServiceRequestInput (all optional — defaults from SR)
 *
 * Flow 2: Provider accepts a PENDING ServiceRequest and creates a booking.
 * This is the single "accept service request" endpoint — it atomically
 * transitions the SR to ACCEPTED and creates the Booking.
 * Provider role required.
 */
router.post(
  "/from-service-request/:serviceRequestId",
  requireProvider,
  createBookingFromServiceRequest,
);

// ─── Client List & Summary Routes ─────────────────────────────────────────────

/**
 * GET /api/bookings/client/:clientProfileId
 * Query: status?, paymentStatus?, limit?, skip?
 *
 * Paginated booking history for a client.
 * clientProfileId is the IUserProfile._id stored as clientId on the Booking.
 */
router.get("/client/:clientProfileId", requireCustomerOrProvider, getBookingsByClient);

/**
 * GET /api/bookings/client/:actorId/activity
 * (resolved via the shared /activity/:actorType/:actorId route below)
 */

// ─── Provider List & Calendar Routes ──────────────────────────────────────────

/**
 * GET /api/bookings/provider/:providerProfileId
 * Query: status?, paymentStatus?, limit?, skip?
 *
 * Paginated booking list for a provider.
 */
router.get("/provider/:providerProfileId", requireProvider, getBookingsByProvider);

/**
 * GET /api/bookings/provider/:providerProfileId/upcoming
 * Query: limit?, skip?
 *
 * Provider's daily schedule — upcoming CONFIRMED bookings, soonest-first.
 */
router.get(
  "/provider/:providerProfileId/upcoming",
  requireProvider,
  getUpcomingBookings,
);

/**
 * GET /api/bookings/provider/:providerProfileId/calendar
 * Query: startDate (required), endDate (required), limit?, skip?
 *
 * CONFIRMED + IN_PROGRESS bookings within a date range.
 * Used by the provider's calendar/schedule view.
 */
router.get(
  "/provider/:providerProfileId/calendar",
  requireProvider,
  getBookingsByDateRange,
);

// ─── Activity Summary ─────────────────────────────────────────────────────────

/**
 * GET /api/bookings/activity/:actorType/:actorId
 * actorType: "client" | "provider"
 *
 * Compact booking counts for a client or provider dashboard header.
 * Returns: total, active, awaitingValidation, completed, cancelled, disputed.
 */
router.get(
  "/activity/:actorType/:actorId",
  requireCustomerOrProvider,
  getActivitySummary,
);

// ─── Single Booking Resource Routes ──────────────────────────────────────────

/**
 * GET /api/bookings/:bookingId
 * Query: populate? ("true")
 *
 * Fetches a booking by its _id. Accessible to participants and admins.
 */
router.get("/:bookingId", requireCustomerOrProvider, getBookingById);

/**
 * DELETE /api/bookings/:bookingId
 *
 * Soft-deletes a booking (VALIDATED, COMPLETED, or CANCELLED only).
 * Active bookings must be cancelled first.
 */
router.delete("/:bookingId", requireCustomerOrProvider, deleteBooking);

// ─── Status Transition Routes ─────────────────────────────────────────────────

/**
 * POST /api/bookings/:bookingId/start
 *
 * Provider marks a CONFIRMED booking as IN_PROGRESS (work has started).
 * Transition: CONFIRMED → IN_PROGRESS
 */
router.post("/:bookingId/start", requireProvider, startService);

/**
 * POST /api/bookings/:bookingId/complete
 * Body: { finalPrice?, providerMessage? }
 *
 * Provider marks work as done and requests client validation.
 * Transition: IN_PROGRESS → AWAITING_VALIDATION
 */
router.post("/:bookingId/complete", requireProvider, completeService);

/**
 * POST /api/bookings/:bookingId/validate
 * Body: { approved: true, rating, review? } | { approved: false, disputeReason }
 *
 * Client approves or disputes the completed work.
 * Transition: AWAITING_VALIDATION → VALIDATED | DISPUTED
 */
router.post("/:bookingId/validate", requireCustomer, validateCompletion);

/**
 * POST /api/bookings/:bookingId/cancel
 * Body: { reason, cancelledBy: "customer" | "provider" | "admin" }
 *
 * Cancels a CONFIRMED or IN_PROGRESS booking.
 * Ownership is enforced per cancelledBy role.
 */
router.post("/:bookingId/cancel", requireCustomerOrProvider, cancelBooking);

/**
 * POST /api/bookings/:bookingId/rebut
 * Body: { message: string }
 *
 * Provider contests a DISPUTED booking with a written rebuttal.
 * Transition: DISPUTED → REBUTTAL_SUBMITTED
 * An admin then sees both the client's dispute reason and the provider's
 * rebuttal before making a final resolution decision.
 */
router.post("/:bookingId/rebut", requireProvider, submitRebuttal);

/**
 * POST /api/bookings/:bookingId/reschedule
 * Body: { newDate, newTimeSlot?, actorRole: "customer" | "provider" | "admin" }
 *
 * Reschedules a CONFIRMED booking. Only CONFIRMED bookings can be rescheduled.
 */
router.post("/:bookingId/reschedule", requireCustomerOrProvider, rescheduleBooking);

// ─── Payment Routes ───────────────────────────────────────────────────────────

/**
 * PATCH /api/bookings/:bookingId/payment-status
 * Body: { paymentStatus }
 *
 * Updates the payment status. Intended for webhook handlers and admin overrides.
 * In production, restrict to service-account or admin tokens at the API gateway.
 */
router.patch("/:bookingId/payment-status", requireAdmin, updatePaymentStatus);

/**
 * GET /api/bookings/:bookingId/payment-summary
 *
 * Financial breakdown: estimated/final price, deposit, outstanding balance.
 * Accessible to booking participants and admins.
 */
router.get("/:bookingId/payment-summary", requireCustomerOrProvider, getPaymentSummary);

// ─── Admin Action Routes ──────────────────────────────────────────────────────

/**
 * POST /api/bookings/:bookingId/resolve-dispute
 * Body: { resolution: "approve" | "complete", notes? }
 *
 * Admin resolves a DISPUTED booking.
 * Transition: DISPUTED → VALIDATED | COMPLETED
 */
router.post("/:bookingId/resolve-dispute", requireAdmin, resolveDispute);

/**
 * POST /api/bookings/:bookingId/restore
 *
 * Restores a soft-deleted booking. Admin only.
 */
router.post("/:bookingId/restore", requireAdmin, restoreBooking);

export default router;