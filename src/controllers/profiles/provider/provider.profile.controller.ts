// controllers/profiles/provider/provider.profile.controllers.ts
import { ProviderCRUDHandler } from "./handlers/crud.handler";
import { ProviderLocationHandler } from "./handlers/location.handler";
import { ProviderRetrievalHandler } from "./handlers/retrieval.handler";
import { ProviderSearchHandler } from "./handlers/search.handler";
import { ProviderAdminHandler } from "./handlers/admin.handler";
import { ProviderBrowseHandler } from "./handlers/browse.handler";

/**
 * Provider Profile Controller
 *
 * Delegates HTTP requests to specialised handler classes:
 *   ProviderCRUDHandler       — core read / update / delete + isolated onboarding updates
 *   ProviderLocationHandler   — location enrichment and self-service verification check
 *   ProviderRetrievalHandler  — gallery images, ID images, service offering management
 *   ProviderSearchHandler     — discovery: text search, location filter, proximity
 *   ProviderAdminHandler      — admin-only: list all, stats, verify address, company training
 *   ProviderBrowseHandler     — public discovery: unified filter + sort surface
 */
export class ProviderProfileController {
  private crudHandler: ProviderCRUDHandler;
  private locationHandler: ProviderLocationHandler;
  private retrievalHandler: ProviderRetrievalHandler;
  private searchHandler: ProviderSearchHandler;
  private adminHandler: ProviderAdminHandler;
  private browseHandler: ProviderBrowseHandler;

  // ─── CRUD ───────────────────────────────────────────────────────────────────
  public getProviderProfileById;
  public getMyProviderProfile;
  public getProviderProfileByRef;
  public updateProviderProfile;
  public updateContactInfo;
  public updateBusinessInfo;
  public updateWorkingHours;
  public setAvailability;
  public updateDepositSettings;
  public getProfileLiveStatus;
  public deleteProviderProfile;
  public restoreProviderProfile;

  // ─── Location ────────────────────────────────────────────────────────────────
  public updateLocationData;
  public checkLocationVerification;

  // ─── Retrieval: Gallery / ID Images / Service Offerings ─────────────────────
  public getServiceOfferings;
  public addServiceOffering;
  public removeServiceOffering;
  public addGalleryImages;
  public removeGalleryImage;
  public reorderGalleryImages;
  public updateIdImages;
  public removeIdImage;
  public replaceIdImages;

  // ─── Search / Discovery ──────────────────────────────────────────────────────
  public searchProviders;
  public getProvidersByLocation;
  public getProvidersNearCoordinates;
  public getProvidersByService;

  // ─── Browse ──────────────────────────────────────────────────────────────────
  public browseProviders;

  // ─── Admin ───────────────────────────────────────────────────────────────────
  public getAllProviders;
  public verifyProviderAddress;
  public setCompanyTrained;
  public getProviderStats;
  public adminDeleteProvider;
  public adminRestoreProvider;
  public adminAddServiceOffering;
  public adminRemoveServiceOffering;

  constructor() {
    this.crudHandler = new ProviderCRUDHandler();
    this.locationHandler = new ProviderLocationHandler();
    this.retrievalHandler = new ProviderRetrievalHandler();
    this.searchHandler = new ProviderSearchHandler();
    this.adminHandler = new ProviderAdminHandler();
    this.browseHandler = new ProviderBrowseHandler();

    // CRUD
    this.getProviderProfileById = this.crudHandler.getProviderProfileById;
    this.getMyProviderProfile = this.crudHandler.getMyProviderProfile;
    this.getProviderProfileByRef = this.crudHandler.getProviderProfileByRef;
    this.updateProviderProfile = this.crudHandler.updateProviderProfile;
    this.updateContactInfo = this.crudHandler.updateContactInfo;
    this.updateBusinessInfo = this.crudHandler.updateBusinessInfo;
    this.updateWorkingHours = this.crudHandler.updateWorkingHours;
    this.setAvailability = this.crudHandler.setAvailability;
    this.updateDepositSettings = this.crudHandler.updateDepositSettings;
    this.getProfileLiveStatus = this.crudHandler.getProfileLiveStatus;
    this.deleteProviderProfile = this.crudHandler.deleteProviderProfile;
    this.restoreProviderProfile = this.crudHandler.restoreProviderProfile;

    // Location
    this.updateLocationData = this.locationHandler.updateLocationData;
    this.checkLocationVerification =
      this.locationHandler.checkLocationVerification;

    // Retrieval
    this.getServiceOfferings = this.retrievalHandler.getServiceOfferings;
    this.addServiceOffering = this.retrievalHandler.addServiceOffering;
    this.removeServiceOffering = this.retrievalHandler.removeServiceOffering;
    this.addGalleryImages = this.retrievalHandler.addGalleryImages;
    this.removeGalleryImage = this.retrievalHandler.removeGalleryImage;
    this.reorderGalleryImages = this.retrievalHandler.reorderGalleryImages;
    this.updateIdImages = this.retrievalHandler.updateIdImages;
    this.removeIdImage = this.retrievalHandler.removeIdImage;
    this.replaceIdImages = this.retrievalHandler.replaceIdImages;

    // Search
    this.searchProviders = this.searchHandler.searchProviders;
    this.getProvidersByLocation = this.searchHandler.getProvidersByLocation;
    this.getProvidersNearCoordinates =
      this.searchHandler.getProvidersNearCoordinates;
    this.getProvidersByService = this.searchHandler.getProvidersByService;

    // Browse
    this.browseProviders = this.browseHandler.browseProviders;

    // Admin
    this.getAllProviders = this.adminHandler.getAllProviders;
    this.verifyProviderAddress = this.adminHandler.verifyProviderAddress;
    this.setCompanyTrained = this.adminHandler.setCompanyTrained;
    this.getProviderStats = this.adminHandler.getProviderStats;
    this.adminDeleteProvider = this.adminHandler.adminDeleteProvider;
    this.adminRestoreProvider = this.adminHandler.adminRestoreProvider;
    this.adminAddServiceOffering = this.adminHandler.adminAddServiceOffering;
    this.adminRemoveServiceOffering =
      this.adminHandler.adminRemoveServiceOffering;
  }
}

// ─── Singleton + Named Exports ────────────────────────────────────────────────

// Arrow-function methods on class instances are bound to their handler instance
// at construction time, so direct destructuring is safe — no extra .bind() needed.
const providerProfileController = new ProviderProfileController();

export const {
  // CRUD
  getProviderProfileById,
  getMyProviderProfile,
  getProviderProfileByRef,
  updateProviderProfile,
  updateContactInfo,
  updateBusinessInfo,
  updateWorkingHours,
  setAvailability,
  updateDepositSettings,
  getProfileLiveStatus,
  deleteProviderProfile,
  restoreProviderProfile,

  // Location
  updateLocationData,
  checkLocationVerification,

  // Retrieval
  getServiceOfferings,
  addServiceOffering,
  removeServiceOffering,
  addGalleryImages,
  removeGalleryImage,
  reorderGalleryImages,
  updateIdImages,
  removeIdImage,
  replaceIdImages,

  // Search
  searchProviders,
  getProvidersByLocation,
  getProvidersNearCoordinates,
  getProvidersByService,

  // Browse
  browseProviders,

  // Admin
  getAllProviders,
  verifyProviderAddress,
  setCompanyTrained,
  getProviderStats,
  adminDeleteProvider,
  adminRestoreProvider,
  adminAddServiceOffering,
  adminRemoveServiceOffering,
} = providerProfileController;

export default ProviderProfileController;
