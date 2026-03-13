// controllers/profiles/handlers/admin.handler.ts
import { Response, NextFunction } from "express";
import { BaseProfileHandler } from "./base.handler";
import { AuthenticatedRequest } from "../../../../types/user.types";
import { handleError, validateObjectId } from "../../../../utils/auth/auth.controller.utils";


/**
 * Handler for admin profile operations
 */
export class ProfileAdminHandler extends BaseProfileHandler {
  /**
   * Get all profiles with pagination (admin)
   * GET /api/profiles
   */
  getAllProfiles = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { limit = "20", skip = "0", includeDeleted = "false" } = req.query;

      const limitNum = parseInt(limit as string, 10);
      const skipNum = parseInt(skip as string, 10);
      const includeDeletedBool = includeDeleted === "true";

      if (isNaN(limitNum) || isNaN(skipNum) || limitNum < 1 || skipNum < 0) {
        this.error(res, "Invalid limit or skip value", 400);
        return;
      }

      const result = await this.profileService.getAllProfiles(
        limitNum,
        skipNum,
        includeDeletedBool
      );

      this.success(res, result, "Profiles retrieved successfully");
    } catch (error) {
      handleError(res, error, "Failed to retrieve all profiles");
    }
  };

  /**
   * Check if profile exists
   * GET /api/profiles/exists
   */
  checkProfileExists = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = this.getUserId(req);
      const exists = await this.profileService.profileExists(userId);
      this.success(res, { exists }, "Profile existence checked");
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") {
        this.handleUnauthorized(res);
        return;
      }
      handleError(res, error, "Failed to check profile existence");
    }
  };

  /**
   * Bulk update profiles (admin)
   * PATCH /api/profiles/bulk
   */
  bulkUpdateProfiles = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { userIds, updates } = req.body;

      if (!Array.isArray(userIds) || userIds.length === 0) {
        this.error(res, "userIds must be a non-empty array", 400);
        return;
      }

      if (!updates || typeof updates !== "object") {
        this.error(res, "updates object is required", 400);
        return;
      }

      const invalidIds = userIds.filter((id) => !validateObjectId(id));

      if (invalidIds.length > 0) {
        this.error(res, "Invalid user ID format", 400, { invalidIds });
        return;
      }

      const sanitizedUpdates = this.sanitizeProfileUpdates(updates);
      const result = await this.profileService.bulkUpdateProfiles(
        userIds,
        sanitizedUpdates
      );

      this.success(
        res,
        result,
        `${result.modifiedCount} profiles updated successfully`
      );
    } catch (error) {
      handleError(res, error, "Failed to bulk update profiles");
    }
  };
}