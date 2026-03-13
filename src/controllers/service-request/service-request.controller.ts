import { ServiceRequestAdminHandler } from "./handlers/admin.handler";
import { ServiceRequestBrowseHandler } from "./handlers/browse.handler";
import { ServiceRequestClientHandler } from "./handlers/client.handler";
import { ServiceRequestCRUDHandler } from "./handlers/crud.handler";
import { ServiceRequestProviderHandler } from "./handlers/provider.handler";


/**
 * Service Request Controller
 *
 * Delegates HTTP requests to specialised handler classes:
 *   ServiceRequestBrowseHandler   — Flow 2 discovery: browseServices, expandSearch
 *   ServiceRequestCRUDHandler     — create, getById, delete, restore
 *   ServiceRequestClientHandler   — client cancel, list by client, activity summary
 *   ServiceRequestProviderHandler — provider reject, list by provider, pending inbox, activity summary
 *   ServiceRequestAdminHandler    — admin list all, stats, expire overdue
 *
 * NOTE: There is intentionally no "accept" endpoint on this controller.
 * Acceptance is handled exclusively by BookingController.createBookingFromServiceRequest,
 * which atomically creates a Booking and transitions the ServiceRequest to ACCEPTED.
 */
export class ServiceRequestController {
  private browseHandler:   ServiceRequestBrowseHandler;
  private crudHandler:     ServiceRequestCRUDHandler;
  private clientHandler:   ServiceRequestClientHandler;
  private providerHandler: ServiceRequestProviderHandler;
  private adminHandler:    ServiceRequestAdminHandler;

  // ─── Browse ─────────────────────────────────────────────────────────────────
  public browseServices;
  public expandSearch;

  // ─── CRUD ───────────────────────────────────────────────────────────────────
  public createServiceRequest;
  public getServiceRequestById;
  public deleteServiceRequest;
  public restoreServiceRequest;

  // ─── Client ─────────────────────────────────────────────────────────────────
  public cancelServiceRequest;
  public getServiceRequestsByClient;
  public getClientActivitySummary;

  // ─── Provider ────────────────────────────────────────────────────────────────
  public rejectServiceRequest;
  public getServiceRequestsByProvider;
  public getPendingRequestsForProvider;
  public getProviderActivitySummary;

  // ─── Admin ───────────────────────────────────────────────────────────────────
  public getAllServiceRequests;
  public getServiceRequestStats;
  public expireOverdueServiceRequests;

  constructor() {
    this.browseHandler   = new ServiceRequestBrowseHandler();
    this.crudHandler     = new ServiceRequestCRUDHandler();
    this.clientHandler   = new ServiceRequestClientHandler();
    this.providerHandler = new ServiceRequestProviderHandler();
    this.adminHandler    = new ServiceRequestAdminHandler();

    // Browse
    this.browseServices = this.browseHandler.browseServices;
    this.expandSearch   = this.browseHandler.expandSearch;

    // CRUD
    this.createServiceRequest  = this.crudHandler.createServiceRequest;
    this.getServiceRequestById = this.crudHandler.getServiceRequestById;
    this.deleteServiceRequest  = this.crudHandler.deleteServiceRequest;
    this.restoreServiceRequest = this.crudHandler.restoreServiceRequest;

    // Client
    this.cancelServiceRequest       = this.clientHandler.cancelServiceRequest;
    this.getServiceRequestsByClient = this.clientHandler.getServiceRequestsByClient;
    this.getClientActivitySummary   = this.clientHandler.getClientActivitySummary;

    // Provider
    this.rejectServiceRequest          = this.providerHandler.rejectServiceRequest;
    this.getServiceRequestsByProvider  = this.providerHandler.getServiceRequestsByProvider;
    this.getPendingRequestsForProvider = this.providerHandler.getPendingRequestsForProvider;
    this.getProviderActivitySummary    = this.providerHandler.getProviderActivitySummary;

    // Admin
    this.getAllServiceRequests          = this.adminHandler.getAllServiceRequests;
    this.getServiceRequestStats        = this.adminHandler.getServiceRequestStats;
    this.expireOverdueServiceRequests  = this.adminHandler.expireOverdueServiceRequests;
  }
}

// ─── Singleton + Named Exports ────────────────────────────────────────────────

// Arrow-function methods on class instances are bound to their handler instance
// at construction time, so direct destructuring is safe — no extra .bind() needed.
const serviceRequestController = new ServiceRequestController();

export const {
  // Browse
  browseServices,
  expandSearch,

  // CRUD
  createServiceRequest,
  getServiceRequestById,
  deleteServiceRequest,
  restoreServiceRequest,

  // Client
  cancelServiceRequest,
  getServiceRequestsByClient,
  getClientActivitySummary,

  // Provider
  rejectServiceRequest,
  getServiceRequestsByProvider,
  getPendingRequestsForProvider,
  getProviderActivitySummary,

  // Admin
  getAllServiceRequests,
  getServiceRequestStats,
  expireOverdueServiceRequests,
} = serviceRequestController;

export default ServiceRequestController;