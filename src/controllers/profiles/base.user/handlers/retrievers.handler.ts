// controllers/profiles/handlers/retrieval.handler.ts
import { Response, NextFunction } from "express";
import { BaseProfileHandler } from "./base.handler";
import {
  handleError,
  validateObjectId,
} from "../../../../utils/auth/auth.controller.utils";
import { AuthenticatedRequest } from "../../../../types/user.types";

/**
 * Handler for profile retrieval operations.
 */
export class ProfileRetrievalHandler extends BaseProfileHandler {
  /**
   * Get current user's profile.
   * GET /api/profiles/me
   */
  getMyProfile = async (
    req: AuthenticatedRequest,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      const userId = this.getUserId(req);
      const includeDetails = req.query.includeDetails === "true";

      const profile = await this.profileService.getProfileByUserId(
        userId,
        includeDetails
      );

      if (!profile) {
        this.error(res, "Profile not found", 404);
        return;
      }

      this.success(res, profile, "Profile retrieved successfully");
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") {
        this.handleUnauthorized(res);
        return;
      }
      handleError(res, error, "Failed to retrieve profile");
    }
  };

  /**
   * Get complete profile with picture details.
   * GET /api/profiles/me/complete
   */
  getCompleteProfile = async (
    req: AuthenticatedRequest,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      const userId = this.getUserId(req);
      const result = await this.profileService.getCompleteProfile(userId);

      if (!result.profile) {
        this.error(res, "Profile not found", 404);
        return;
      }

      this.success(res, result, "Complete profile retrieved successfully");
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") {
        this.handleUnauthorized(res);
        return;
      }
      handleError(res, error, "Failed to retrieve complete profile");
    }
  };

  /**
   * Get profile by user ID.
   * GET /api/profiles/user/:userId
   */
  getProfileByUserId = async (
    req: AuthenticatedRequest,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      // FIX: req.params values are typed as string | string[] in some Express
      // versions — cast to string immediately to satisfy downstream typings.
      const userId = req.params.userId as string;

      if (!validateObjectId(userId)) {
        this.error(res, "Invalid user ID format", 400);
        return;
      }

      const includeDetails = req.query.includeDetails === "true";
      const profile = await this.profileService.getProfileByUserId(
        userId,
        includeDetails
      );

      if (!profile) {
        this.error(res, "Profile not found", 404);
        return;
      }

      this.success(res, profile, "Profile retrieved successfully");
    } catch (error) {
      handleError(res, error, "Failed to retrieve profile");
    }
  };

  /**
   * Get profile by profile ID.
   * GET /api/profiles/:profileId
   */
  getProfileById = async (
    req: AuthenticatedRequest,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      // FIX: same string | string[] cast
      const profileId = req.params.profileId as string;

      if (!validateObjectId(profileId)) {
        this.error(res, "Invalid profile ID format", 400);
        return;
      }

      const includeDetails = req.query.includeDetails === "true";
      const profile = await this.profileService.getProfileById(
        profileId,
        includeDetails
      );

      if (!profile) {
        this.error(res, "Profile not found", 404);
        return;
      }

      this.success(res, profile, "Profile retrieved successfully");
    } catch (error) {
      handleError(res, error, "Failed to retrieve profile");
    }
  };

  /**
   * Search profiles by bio content.
   * GET /api/profiles/search?q=<term>&limit=<n>&skip=<n>
   */
  searchProfiles = async (
    req: AuthenticatedRequest,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      const { q, limit = "20", skip = "0" } = req.query;

      if (!q || typeof q !== "string") {
        this.error(res, "Search query is required", 400);
        return;
      }

      const limitNum = parseInt(limit as string, 10);
      const skipNum = parseInt(skip as string, 10);

      if (isNaN(limitNum) || isNaN(skipNum) || limitNum < 1 || skipNum < 0) {
        this.error(res, "Invalid limit or skip value", 400);
        return;
      }

      const profiles = await this.profileService.searchProfilesByBio(
        q,
        limitNum,
        skipNum
      );

      this.success(
        res,
        { profiles, count: profiles.length, limit: limitNum, skip: skipNum },
        "Search completed successfully"
      );
    } catch (error) {
      handleError(res, error, "Failed to search profiles");
    }
  };

  /**
   * Get multiple profiles by user IDs.
   * POST /api/profiles/batch
   */
  getProfilesByUserIds = async (
    req: AuthenticatedRequest,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      const { userIds, includeDetails = false } = req.body;

      if (!Array.isArray(userIds) || userIds.length === 0) {
        this.error(res, "userIds must be a non-empty array", 400);
        return;
      }

      const invalidIds = userIds.filter((id) => !validateObjectId(id));

      if (invalidIds.length > 0) {
        this.error(res, "Invalid user ID format", 400, { invalidIds });
        return;
      }

      const profiles = await this.profileService.getProfilesByUserIds(
        userIds,
        includeDetails
      );

      this.success(
        res,
        { profiles, count: profiles.length },
        "Profiles retrieved successfully"
      );
    } catch (error) {
      handleError(res, error, "Failed to retrieve profiles");
    }
  };

  /**
   * Get profile statistics for the current user.
   * GET /api/profiles/me/stats
   */
  getMyProfileStats = async (
    req: AuthenticatedRequest,
    res: Response,
    _next: NextFunction
  ): Promise<void> => {
    try {
      const userId = this.getUserId(req);
      const stats = await this.profileService.getProfileStats(userId);
      this.success(res, stats, "Profile statistics retrieved successfully");
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") {
        this.handleUnauthorized(res);
        return;
      }
      handleError(res, error, "Failed to retrieve profile statistics");
    }
  };
}

