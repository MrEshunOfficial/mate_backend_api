import { BookingAdminHandler } from "./admin.handler";
import { BookingCreationHandler } from "./creation.handler";
import { BookingCRUDHandler } from "./crud.handler";
import { BookingPaymentHandler } from "./payment.handler";
import { BookingQueriesHandler } from "./queries.handler";
import { BookingStatusHandler } from "./status.handler";

/**
 * Booking Controller
 *
 * Delegates HTTP requests to specialised handler classes:
 *   BookingCreationHandler — Flow 1 (from task) and Flow 2 (from service request / accept SR)
 *   BookingCRUDHandler     — reads by id/number/task/serviceRequest, list by client/provider, delete, restore
 *   BookingStatusHandler   — startService, completeService, validateCompletion, cancelBooking, rescheduleBooking
 *   BookingPaymentHandler  — updatePaymentStatus (webhook), getPaymentSummary
 *   BookingQueriesHandler  — upcoming, calendar date range, activity summary
 *   BookingAdminHandler    — resolveDispute, active, pendingValidation, disputed, getAllBookings, stats
 */
export class BookingController {
  private creationHandler: BookingCreationHandler;
  private crudHandler:     BookingCRUDHandler;
  private statusHandler:   BookingStatusHandler;
  private paymentHandler:  BookingPaymentHandler;
  private queriesHandler:  BookingQueriesHandler;
  private adminHandler:    BookingAdminHandler;

  // ─── Creation ────────────────────────────────────────────────────────────────
  public createBookingFromTask;
  public createBookingFromServiceRequest;

  // ─── Core CRUD ───────────────────────────────────────────────────────────────
  public getBookingById;
  public getBookingByNumber;
  public getBookingByTask;
  public getBookingByServiceRequest;
  public getBookingsByClient;
  public getBookingsByProvider;
  public deleteBooking;
  public restoreBooking;

  // ─── Status Machine ───────────────────────────────────────────────────────────
  public startService;
  public completeService;
  public validateCompletion;
  public cancelBooking;
  public rescheduleBooking;

  // ─── Payment ──────────────────────────────────────────────────────────────────
  public updatePaymentStatus;
  public getPaymentSummary;

  // ─── Queries ──────────────────────────────────────────────────────────────────
  public getUpcomingBookings;
  public getBookingsByDateRange;
  public getActivitySummary;

  // ─── Admin ───────────────────────────────────────────────────────────────────
  public resolveDispute;
  public getActiveBookings;
  public getBookingsPendingValidation;
  public getDisputedBookings;
  public getAllBookings;
  public getBookingStats;

  constructor() {
    this.creationHandler = new BookingCreationHandler();
    this.crudHandler     = new BookingCRUDHandler();
    this.statusHandler   = new BookingStatusHandler();
    this.paymentHandler  = new BookingPaymentHandler();
    this.queriesHandler  = new BookingQueriesHandler();
    this.adminHandler    = new BookingAdminHandler();

    // Creation
    this.createBookingFromTask           = this.creationHandler.createBookingFromTask;
    this.createBookingFromServiceRequest = this.creationHandler.createBookingFromServiceRequest;

    // CRUD
    this.getBookingById            = this.crudHandler.getBookingById;
    this.getBookingByNumber        = this.crudHandler.getBookingByNumber;
    this.getBookingByTask          = this.crudHandler.getBookingByTask;
    this.getBookingByServiceRequest = this.crudHandler.getBookingByServiceRequest;
    this.getBookingsByClient       = this.crudHandler.getBookingsByClient;
    this.getBookingsByProvider     = this.crudHandler.getBookingsByProvider;
    this.deleteBooking             = this.crudHandler.deleteBooking;
    this.restoreBooking            = this.crudHandler.restoreBooking;

    // Status
    this.startService        = this.statusHandler.startService;
    this.completeService     = this.statusHandler.completeService;
    this.validateCompletion  = this.statusHandler.validateCompletion;
    this.cancelBooking       = this.statusHandler.cancelBooking;
    this.rescheduleBooking   = this.statusHandler.rescheduleBooking;

    // Payment
    this.updatePaymentStatus = this.paymentHandler.updatePaymentStatus;
    this.getPaymentSummary   = this.paymentHandler.getPaymentSummary;

    // Queries
    this.getUpcomingBookings    = this.queriesHandler.getUpcomingBookings;
    this.getBookingsByDateRange = this.queriesHandler.getBookingsByDateRange;
    this.getActivitySummary     = this.queriesHandler.getActivitySummary;

    // Admin
    this.resolveDispute               = this.adminHandler.resolveDispute;
    this.getActiveBookings            = this.adminHandler.getActiveBookings;
    this.getBookingsPendingValidation = this.adminHandler.getBookingsPendingValidation;
    this.getDisputedBookings          = this.adminHandler.getDisputedBookings;
    this.getAllBookings                = this.adminHandler.getAllBookings;
    this.getBookingStats              = this.adminHandler.getBookingStats;
  }
}

// ─── Singleton + Named Exports ────────────────────────────────────────────────

// Arrow-function methods on class instances are bound to their handler instance
// at construction time, so direct destructuring is safe — no extra .bind() needed.
const bookingController = new BookingController();

export const {
  // Creation
  createBookingFromTask,
  createBookingFromServiceRequest,

  // CRUD
  getBookingById,
  getBookingByNumber,
  getBookingByTask,
  getBookingByServiceRequest,
  getBookingsByClient,
  getBookingsByProvider,
  deleteBooking,
  restoreBooking,

  // Status
  startService,
  completeService,
  validateCompletion,
  cancelBooking,
  rescheduleBooking,

  // Payment
  updatePaymentStatus,
  getPaymentSummary,

  // Queries
  getUpcomingBookings,
  getBookingsByDateRange,
  getActivitySummary,

  // Admin
  resolveDispute,
  getActiveBookings,
  getBookingsPendingValidation,
  getDisputedBookings,
  getAllBookings,
  getBookingStats,
} = bookingController;

export default BookingController;