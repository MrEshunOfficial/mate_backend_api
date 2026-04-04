import { ServiceRequestAdminHandler } from "./handlers/admin.handler";
import { ServiceRequestBrowseHandler } from "./handlers/browse.handler";
import { ServiceRequestClientHandler } from "./handlers/client.handler";
import { ServiceRequestCRUDHandler } from "./handlers/crud.handler";
import { ServiceRequestProviderHandler } from "./handlers/provider.handler";

export class ServiceRequestController {
  private browseHandler: ServiceRequestBrowseHandler;
  private crudHandler: ServiceRequestCRUDHandler;
  private clientHandler: ServiceRequestClientHandler;
  private providerHandler: ServiceRequestProviderHandler;
  private adminHandler: ServiceRequestAdminHandler;

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
  public acceptServiceRequest; // ← added
  public rejectServiceRequest;
  public getServiceRequestsByProvider;
  public getPendingRequestsForProvider;
  public getProviderActivitySummary;

  // ─── Admin ───────────────────────────────────────────────────────────────────
  public getAllServiceRequests;
  public getServiceRequestStats;
  public expireOverdueServiceRequests;

  constructor() {
    this.browseHandler = new ServiceRequestBrowseHandler();
    this.crudHandler = new ServiceRequestCRUDHandler();
    this.clientHandler = new ServiceRequestClientHandler();
    this.providerHandler = new ServiceRequestProviderHandler();
    this.adminHandler = new ServiceRequestAdminHandler();

    // Browse
    this.browseServices = this.browseHandler.browseServices;
    this.expandSearch = this.browseHandler.expandSearch;

    // CRUD
    this.createServiceRequest = this.crudHandler.createServiceRequest;
    this.getServiceRequestById = this.crudHandler.getServiceRequestById;
    this.deleteServiceRequest = this.crudHandler.deleteServiceRequest;
    this.restoreServiceRequest = this.crudHandler.restoreServiceRequest;

    // Client
    this.cancelServiceRequest = this.clientHandler.cancelServiceRequest;
    this.getServiceRequestsByClient =
      this.clientHandler.getServiceRequestsByClient;
    this.getClientActivitySummary = this.clientHandler.getClientActivitySummary;

    // Provider
    this.acceptServiceRequest = this.providerHandler.acceptServiceRequest; // ← added
    this.rejectServiceRequest = this.providerHandler.rejectServiceRequest;
    this.getServiceRequestsByProvider =
      this.providerHandler.getServiceRequestsByProvider;
    this.getPendingRequestsForProvider =
      this.providerHandler.getPendingRequestsForProvider;
    this.getProviderActivitySummary =
      this.providerHandler.getProviderActivitySummary;

    // Admin
    this.getAllServiceRequests = this.adminHandler.getAllServiceRequests;
    this.getServiceRequestStats = this.adminHandler.getServiceRequestStats;
    this.expireOverdueServiceRequests =
      this.adminHandler.expireOverdueServiceRequests;
  }
}

// ─── Singleton + Named Exports ────────────────────────────────────────────────

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
  acceptServiceRequest, // ← added
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
