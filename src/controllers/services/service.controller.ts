import { ServiceService } from "../../service/services/services.service";
import { ServiceAdminHandler } from "./handlers/admin.handler";
import { ServiceCrudHandler } from "./handlers/crud.handler";
import { ServiceRetrievalHandler } from "./handlers/retrieval.handler";

export class ServiceController {
  private crudHandler: ServiceCrudHandler;
  private retrievalHandler: ServiceRetrievalHandler;
  private adminHandler: ServiceAdminHandler;

  // ─── CRUD Operations ───────────────────────────────────────────────────────
  public createService: ServiceCrudHandler["createService"];
  public updateService: ServiceCrudHandler["updateService"];
  public deleteService: ServiceCrudHandler["deleteService"];
  public togglePrivateStatus: ServiceCrudHandler["togglePrivateStatus"];
  public updateCoverImage: ServiceCrudHandler["updateCoverImage"];
  public removeCoverImage: ServiceCrudHandler["removeCoverImage"];
  public bulkUpdateServices: ServiceCrudHandler["bulkUpdateServices"];

  // ─── Retrieval Operations ──────────────────────────────────────────────────
  public getServiceById: ServiceRetrievalHandler["getServiceById"];
  public getServiceBySlug: ServiceRetrievalHandler["getServiceBySlug"];
  public getActiveServices: ServiceRetrievalHandler["getActiveServices"];
  public getServicesByProvider: ServiceRetrievalHandler["getServicesByProvider"];
  public getServicesByCategory: ServiceRetrievalHandler["getServicesByCategory"];
  public searchServices: ServiceRetrievalHandler["searchServices"];
  public getCompleteService: ServiceRetrievalHandler["getCompleteService"];
  public getAutoActivationStatus: ServiceRetrievalHandler["getAutoActivationStatus"];
  public serviceExists: ServiceRetrievalHandler["serviceExists"];
  public isSlugAvailable: ServiceRetrievalHandler["isSlugAvailable"];

  // ─── Admin Operations ──────────────────────────────────────────────────────
  public getAllServices: ServiceAdminHandler["getAllServices"];
  public getPendingServices: ServiceAdminHandler["getPendingServices"];
  public approveService: ServiceAdminHandler["approveService"];
  public rejectService: ServiceAdminHandler["rejectService"];
  public processScheduledActivations: ServiceAdminHandler["processScheduledActivations"];
  public restoreService: ServiceAdminHandler["restoreService"];
  public permanentlyDeleteService: ServiceAdminHandler["permanentlyDeleteService"];
  public getServiceStats: ServiceAdminHandler["getServiceStats"];

  constructor() {
    const serviceService = new ServiceService();

    this.crudHandler      = new ServiceCrudHandler(serviceService);
    this.retrievalHandler = new ServiceRetrievalHandler(serviceService);
    this.adminHandler     = new ServiceAdminHandler(serviceService);

    // Bind CRUD handlers
    this.createService       = this.crudHandler.createService.bind(this.crudHandler);
    this.updateService       = this.crudHandler.updateService.bind(this.crudHandler);
    this.deleteService       = this.crudHandler.deleteService.bind(this.crudHandler);
    this.togglePrivateStatus = this.crudHandler.togglePrivateStatus.bind(this.crudHandler);
    this.updateCoverImage    = this.crudHandler.updateCoverImage.bind(this.crudHandler);
    this.removeCoverImage    = this.crudHandler.removeCoverImage.bind(this.crudHandler);
    this.bulkUpdateServices  = this.crudHandler.bulkUpdateServices.bind(this.crudHandler);

    // Bind retrieval handlers
    this.getServiceById          = this.retrievalHandler.getServiceById.bind(this.retrievalHandler);
    this.getServiceBySlug        = this.retrievalHandler.getServiceBySlug.bind(this.retrievalHandler);
    this.getActiveServices       = this.retrievalHandler.getActiveServices.bind(this.retrievalHandler);
    this.getServicesByProvider   = this.retrievalHandler.getServicesByProvider.bind(this.retrievalHandler);
    this.getServicesByCategory   = this.retrievalHandler.getServicesByCategory.bind(this.retrievalHandler);
    this.searchServices          = this.retrievalHandler.searchServices.bind(this.retrievalHandler);
    this.getCompleteService      = this.retrievalHandler.getCompleteService.bind(this.retrievalHandler);
    this.getAutoActivationStatus = this.retrievalHandler.getAutoActivationStatus.bind(this.retrievalHandler);
    this.serviceExists           = this.retrievalHandler.serviceExists.bind(this.retrievalHandler);
    this.isSlugAvailable         = this.retrievalHandler.isSlugAvailable.bind(this.retrievalHandler);

    // Bind admin handlers
    this.getAllServices               = this.adminHandler.getAllServices.bind(this.adminHandler);
    this.getPendingServices          = this.adminHandler.getPendingServices.bind(this.adminHandler);
    this.approveService              = this.adminHandler.approveService.bind(this.adminHandler);
    this.rejectService               = this.adminHandler.rejectService.bind(this.adminHandler);
    this.processScheduledActivations = this.adminHandler.processScheduledActivations.bind(this.adminHandler);
    this.restoreService              = this.adminHandler.restoreService.bind(this.adminHandler);
    this.permanentlyDeleteService    = this.adminHandler.permanentlyDeleteService.bind(this.adminHandler);
    this.getServiceStats             = this.adminHandler.getServiceStats.bind(this.adminHandler);
  }
}

// ─── Singleton Instance ───────────────────────────────────────────────────────

const serviceController = new ServiceController();

// ─── Named Exports ────────────────────────────────────────────────────────────

export const {
  // CRUD
  createService,
  updateService,
  deleteService,
  togglePrivateStatus,
  updateCoverImage,
  removeCoverImage,
  bulkUpdateServices,

  // Retrieval
  getServiceById,
  getServiceBySlug,
  getActiveServices,
  getServicesByProvider,
  getServicesByCategory,
  searchServices,
  getCompleteService,
  getAutoActivationStatus,
  serviceExists,
  isSlugAvailable,

  // Admin
  getAllServices,
  getPendingServices,
  approveService,
  rejectService,
  processScheduledActivations,
  restoreService,
  permanentlyDeleteService,
  getServiceStats,
} = serviceController;