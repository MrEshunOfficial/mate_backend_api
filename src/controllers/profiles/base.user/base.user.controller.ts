// controllers/profiles/userProfile.controller.ts
import { ProfileAdminHandler } from "./handlers/admin.handler";
import { ProfileCRUDHandler } from "./handlers/crud.handler";
import { ProfileRetrievalHandler } from "./handlers/retrievers.handler";
import { RoleTransitionHandler } from "./handlers/roleTransition.handler";

/**
 * User Profile Controller
 *
 * Delegates HTTP requests to specialized handler classes:
 *   ProfileCRUDHandler      — create / update / delete / restore
 *   ProfileRetrievalHandler — all read operations
 *   ProfileAdminHandler     — admin-only operations
 *   RoleTransitionHandler   — role transition validation + execution
 */
export class UserProfileController {
  private crudHandler: ProfileCRUDHandler;
  private retrievalHandler: ProfileRetrievalHandler;
  private adminHandler: ProfileAdminHandler;
  private roleTransitionHandler: RoleTransitionHandler;

  // ─── CRUD Operations ────────────────────────────────────────────────────────
  public createProfile;
  public updateMyProfile;
  public updateProfileById;
  public deleteMyProfile;
  public restoreMyProfile;
  public permanentlyDeleteProfile;

  // ─── Retrieval Operations ────────────────────────────────────────────────────
  public getMyProfile;
  public getCompleteProfile;
  public getProfileByUserId;
  public getProfileById;
  public searchProfiles;
  public getProfilesByUserIds;
  public getMyProfileStats;

  // ─── Admin Operations ────────────────────────────────────────────────────────
  public getAllProfiles;
  public checkProfileExists;
  public bulkUpdateProfiles;

  // ─── Role Transition Operations ──────────────────────────────────────────────
  public validateTransition;
  public executeTransition;
  public getTransitionHistory;

  constructor() {
    this.crudHandler = new ProfileCRUDHandler();
    this.retrievalHandler = new ProfileRetrievalHandler();
    this.adminHandler = new ProfileAdminHandler();
    this.roleTransitionHandler = new RoleTransitionHandler();

    // CRUD
    this.createProfile = this.crudHandler.createProfile;
    this.updateMyProfile = this.crudHandler.updateMyProfile;
    this.updateProfileById = this.crudHandler.updateProfileById;
    this.deleteMyProfile = this.crudHandler.deleteMyProfile;
    this.restoreMyProfile = this.crudHandler.restoreMyProfile;
    this.permanentlyDeleteProfile = this.crudHandler.permanentlyDeleteProfile;

    // Retrieval
    this.getMyProfile = this.retrievalHandler.getMyProfile;
    this.getCompleteProfile = this.retrievalHandler.getCompleteProfile;
    this.getProfileByUserId = this.retrievalHandler.getProfileByUserId;
    this.getProfileById = this.retrievalHandler.getProfileById;
    this.searchProfiles = this.retrievalHandler.searchProfiles;
    this.getProfilesByUserIds = this.retrievalHandler.getProfilesByUserIds;
    this.getMyProfileStats = this.retrievalHandler.getMyProfileStats;

    // Admin
    this.getAllProfiles = this.adminHandler.getAllProfiles;
    this.checkProfileExists = this.adminHandler.checkProfileExists;
    this.bulkUpdateProfiles = this.adminHandler.bulkUpdateProfiles;

    // Role Transition
    this.validateTransition = this.roleTransitionHandler.validateTransition;
    this.executeTransition = this.roleTransitionHandler.executeTransition;
    this.getTransitionHistory = this.roleTransitionHandler.getTransitionHistory;
  }
}

// ─── Singleton + Named Exports ────────────────────────────────────────────────

// Arrow-function handlers on class instances are already bound to their handler
// instance, so direct destructuring is safe — no extra .bind() calls needed.
const userProfileController = new UserProfileController();

export const {
  // CRUD
  createProfile,
  updateMyProfile,
  updateProfileById,
  deleteMyProfile,
  restoreMyProfile,
  permanentlyDeleteProfile,

  // Retrieval
  getMyProfile,
  getCompleteProfile,
  getProfileByUserId,
  getProfileById,
  searchProfiles,
  getProfilesByUserIds,
  getMyProfileStats,

  // Admin
  getAllProfiles,
  checkProfileExists,
  bulkUpdateProfiles,

  // Role Transition
  validateTransition,
  executeTransition,
  getTransitionHistory,
} = userProfileController;

export default UserProfileController;