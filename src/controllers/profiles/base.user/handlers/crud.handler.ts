// controllers/profiles/handlers/crud.handler.ts
import { Response, NextFunction } from "express";
import { BaseProfileHandler } from "./base.handler";
import { CreateProfileRequestBody } from "../../../../types/profiles/base.profile";
import { AuthenticatedRequest } from "../../../../types/user.types";
import {
  handleError,
  validateObjectId,
} from "../../../../utils/auth/auth.controller.utils";

/**
 * Handler for CRUD operations on user profiles.
 */
export class ProfileCRUDHandler extends BaseProfileHandler {
  /**
   * Create a new user profile.
   * POST /api/profiles
   */
  createProfile = async (
    req: AuthenticatedRequest,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      const userId = this.getUserId(req);
      const profileData: CreateProfileRequestBody = req.body;

      // mobileNumber is optional on creation — skip validation when absent
      if (!this.validateMobileNumber(profileData.mobileNumber)) {
        this.error(res, "Invalid mobile number format", 400);
        return;
      }

      const profile = await this.profileService.createProfile(
        userId,
        profileData
      );

      this.success(res, profile, "Profile created successfully", 201);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "UNAUTHORIZED") {
          this.handleUnauthorized(res);
          return;
        }
        if (error.message === "Profile already exists for this user") {
          this.error(res, error.message, 409);
          return;
        }
      }
      handleError(res, error, "Failed to create profile");
    }
  };

  /**
   * Update the current user's own profile.
   * PATCH /api/profiles/me
   *
   * Role changes are not allowed through this endpoint.
   * Call GET /api/profiles/role-transition/validate to check eligibility,
   * then POST /api/profiles/role-transition to proceed.
   */
  updateMyProfile = async (
    req: AuthenticatedRequest,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      const userId = this.getUserId(req);

      if (req.body.role !== undefined) {
        this.error(
          res,
          "Role cannot be changed through this endpoint. " +
            "Call GET /api/profiles/role-transition/validate to check eligibility, " +
            "then POST /api/profiles/role-transition to proceed.",
          422
        );
        return;
      }

      // FIX: validate against req.body (untyped) rather than the sanitized
      // updates — UpdateProfileRequestBody correctly includes mobileNumber,
      // but the spread-based cast in sanitizeProfileUpdates loses that
      // knowledge for the compiler at this call site.
      if (!this.validateMobileNumber(req.body.mobileNumber)) {
        this.error(res, "Invalid mobile number format", 400);
        return;
      }

      const updates = this.sanitizeProfileUpdates(req.body);
      const profile = await this.profileService.updateProfile(userId, updates);

      if (!profile) {
        this.error(res, "Profile not found", 404);
        return;
      }

      this.success(res, profile, "Profile updated successfully");
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") {
        this.handleUnauthorized(res);
        return;
      }
      handleError(res, error, "Failed to update profile");
    }
  };

  /**
   * Update a profile by its ID (admin).
   * PATCH /api/profiles/:profileId
   *
   * Role changes are blocked here too — admins must use the transition
   * flow so audit records are always created.
   */
  updateProfileById = async (
    req: AuthenticatedRequest,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      // FIX: req.params values are typed as string | string[] in some Express
      // versions — cast to string immediately after destructuring.
      const profileId = req.params.profileId as string;

      if (!validateObjectId(profileId)) {
        this.error(res, "Invalid profile ID format", 400);
        return;
      }

      if (req.body.role !== undefined) {
        this.error(
          res,
          "Role cannot be changed through this endpoint. " +
            "Use the role-transition flow to ensure proper validation and audit logging.",
          422
        );
        return;
      }

      // FIX: same as updateMyProfile — validate from req.body before sanitizing
      if (!this.validateMobileNumber(req.body.mobileNumber)) {
        this.error(res, "Invalid mobile number format", 400);
        return;
      }

      const updates = this.sanitizeProfileUpdates(req.body);
      const profile = await this.profileService.updateProfileById(
        profileId,
        updates
      );

      if (!profile) {
        this.error(res, "Profile not found", 404);
        return;
      }

      this.success(res, profile, "Profile updated successfully");
    } catch (error) {
      handleError(res, error, "Failed to update profile");
    }
  };

  /**
   * Soft delete the current user's profile.
   * DELETE /api/profiles/me
   */
  deleteMyProfile = async (
    req: AuthenticatedRequest,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      const userId = this.getUserId(req);
      await this.profileService.deleteProfile(userId);
      this.success(res, null, "Profile deleted successfully");
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") {
        this.handleUnauthorized(res);
        return;
      }
      handleError(res, error, "Failed to delete profile");
    }
  };

  /**
   * Restore a soft-deleted profile.
   * POST /api/profiles/me/restore
   */
  restoreMyProfile = async (
    req: AuthenticatedRequest,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      const userId = this.getUserId(req);
      const profile = await this.profileService.restoreProfile(userId);

      if (!profile) {
        this.error(res, "Deleted profile not found", 404);
        return;
      }

      this.success(res, profile, "Profile restored successfully");
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") {
        this.handleUnauthorized(res);
        return;
      }
      handleError(res, error, "Failed to restore profile");
    }
  };

  /**
   * Permanently delete a profile (admin).
   * DELETE /api/profiles/:userId/permanent
   */
  permanentlyDeleteProfile = async (
    req: AuthenticatedRequest,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      // FIX: same string | string[] issue — cast to string immediately
      const userId = req.params.userId as string;

      if (!validateObjectId(userId)) {
        this.error(res, "Invalid user ID format", 400);
        return;
      }

      await this.profileService.permanentlyDeleteProfile(userId);
      this.success(res, null, "Profile permanently deleted");
    } catch (error) {
      handleError(res, error, "Failed to permanently delete profile");
    }
  };
}