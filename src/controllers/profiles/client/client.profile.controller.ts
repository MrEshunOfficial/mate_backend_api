// controllers/profiles/client/client.profile.controllers.ts
import { ClientCRUDHandler } from "./handlers/crud.handler";
import { ClientLocationHandler } from "./handlers/location.handler";
import { ClientRetrievalHandler } from "./handlers/retrieval.handler";
import { ClientHistoryHandler } from "./handlers/history.handler";
import { ClientAdminHandler } from "./handlers/admin.handler";

/**
 * Client Profile Controller
 *
 * Delegates HTTP requests to specialised handler classes:
 *   ClientCRUDHandler       — core read / update / delete + isolated onboarding updates
 *                             (contact info, personal info, preferences, ID images)
 *   ClientLocationHandler   — saved address management + nearby provider discovery
 *   ClientRetrievalHandler  — favourites management (services + providers)
 *   ClientHistoryHandler    — booking history, task history, activity summary
 *   ClientAdminHandler      — admin-only: list all, stats, verify client, delete/restore
 */
export class ClientProfileController {
  private crudHandler: ClientCRUDHandler;
  private locationHandler: ClientLocationHandler;
  private retrievalHandler: ClientRetrievalHandler;
  private historyHandler: ClientHistoryHandler;
  private adminHandler: ClientAdminHandler;

  // ─── CRUD ───────────────────────────────────────────────────────────────────
  public getClientProfileById;
  public getMyClientProfile;
  public getClientProfileByRef;
  public updateClientProfile;
  public updateContactInfo;
  public updatePersonalInfo;
  public getProfileReadyStatus;
  public updateIdImages;
  public removeIdImage;
  public updatePreferences;
  public deleteClientProfile;
  public restoreClientProfile;

  // ─── Location / Saved Addresses ──────────────────────────────────────────────
  public getDefaultAddress;
  public addSavedAddress;
  public updateSavedAddress;
  public removeSavedAddress;
  public setDefaultAddress;
  public getProvidersNearClient;

  // ─── Retrieval: Favourites ────────────────────────────────────────────────────
  public getFavoriteServices;
  public addFavoriteService;
  public removeFavoriteService;
  public getFavoriteProviders;
  public addFavoriteProvider;
  public removeFavoriteProvider;

  // ─── History ──────────────────────────────────────────────────────────────────
  public getBookingHistory;
  public getTaskHistory;
  public getActivitySummary;

  // ─── Admin ────────────────────────────────────────────────────────────────────
  public getAllClients;
  public getClientStats;
  public getClientProfileByRefAdmin;
  public verifyClient;
  public adminDeleteClient;
  public adminRestoreClient;

  constructor() {
    this.crudHandler       = new ClientCRUDHandler();
    this.locationHandler   = new ClientLocationHandler();
    this.retrievalHandler  = new ClientRetrievalHandler();
    this.historyHandler    = new ClientHistoryHandler();
    this.adminHandler      = new ClientAdminHandler();

    // CRUD
    this.getClientProfileById   = this.crudHandler.getClientProfileById;
    this.getMyClientProfile     = this.crudHandler.getMyClientProfile;
    this.getClientProfileByRef  = this.crudHandler.getClientProfileByRef;
    this.updateClientProfile    = this.crudHandler.updateClientProfile;
    this.updateContactInfo      = this.crudHandler.updateContactInfo;
    this.updatePersonalInfo     = this.crudHandler.updatePersonalInfo;
    this.getProfileReadyStatus  = this.crudHandler.getProfileReadyStatus;
    this.updateIdImages         = this.crudHandler.updateIdImages;
    this.removeIdImage          = this.crudHandler.removeIdImage;
    this.updatePreferences      = this.crudHandler.updatePreferences;
    this.deleteClientProfile    = this.crudHandler.deleteClientProfile;
    this.restoreClientProfile   = this.crudHandler.restoreClientProfile;

    // Location
    this.getDefaultAddress      = this.locationHandler.getDefaultAddress;
    this.addSavedAddress        = this.locationHandler.addSavedAddress;
    this.updateSavedAddress     = this.locationHandler.updateSavedAddress;
    this.removeSavedAddress     = this.locationHandler.removeSavedAddress;
    this.setDefaultAddress      = this.locationHandler.setDefaultAddress;
    this.getProvidersNearClient = this.locationHandler.getProvidersNearClient;

    // Retrieval
    this.getFavoriteServices    = this.retrievalHandler.getFavoriteServices;
    this.addFavoriteService     = this.retrievalHandler.addFavoriteService;
    this.removeFavoriteService  = this.retrievalHandler.removeFavoriteService;
    this.getFavoriteProviders   = this.retrievalHandler.getFavoriteProviders;
    this.addFavoriteProvider    = this.retrievalHandler.addFavoriteProvider;
    this.removeFavoriteProvider = this.retrievalHandler.removeFavoriteProvider;

    // History
    this.getBookingHistory    = this.historyHandler.getBookingHistory;
    this.getTaskHistory       = this.historyHandler.getTaskHistory;
    this.getActivitySummary   = this.historyHandler.getActivitySummary;

    // Admin
    this.getAllClients             = this.adminHandler.getAllClients;
    this.getClientStats           = this.adminHandler.getClientStats;
    this.getClientProfileByRefAdmin = this.adminHandler.getClientProfileByRef;
    this.verifyClient             = this.adminHandler.verifyClient;
    this.adminDeleteClient        = this.adminHandler.adminDeleteClient;
    this.adminRestoreClient       = this.adminHandler.adminRestoreClient;
  }
}

// ─── Singleton + Named Exports ────────────────────────────────────────────────

// Arrow-function methods on class instances are bound to their handler instance
// at construction time, so direct destructuring is safe — no extra .bind() needed.
const clientProfileController = new ClientProfileController();

export const {
  // CRUD
  getClientProfileById,
  getMyClientProfile,
  getClientProfileByRef,
  updateClientProfile,
  updateContactInfo,
  updatePersonalInfo,
  getProfileReadyStatus,
  updateIdImages,
  removeIdImage,
  updatePreferences,
  deleteClientProfile,
  restoreClientProfile,

  // Location
  getDefaultAddress,
  addSavedAddress,
  updateSavedAddress,
  removeSavedAddress,
  setDefaultAddress,
  getProvidersNearClient,

  // Retrieval
  getFavoriteServices,
  addFavoriteService,
  removeFavoriteService,
  getFavoriteProviders,
  addFavoriteProvider,
  removeFavoriteProvider,

  // History
  getBookingHistory,
  getTaskHistory,
  getActivitySummary,

  // Admin
  getAllClients,
  getClientStats,
  getClientProfileByRefAdmin,
  verifyClient,
  adminDeleteClient,
  adminRestoreClient,
} = clientProfileController;

export default ClientProfileController;