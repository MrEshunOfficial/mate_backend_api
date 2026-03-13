// controllers/profiles/handlers/base.handler.ts
import { Response } from "express";
import { UserProfileService } from "../../../../service/profiles/core/core.profile.service";
import { AuthenticatedRequest, UpdateProfileRequestBody } from "../../../../types/user.types";

/**
 * Base handler with common utilities for all profile handlers.
 */
export abstract class BaseProfileHandler {
  protected profileService: UserProfileService;

  constructor() {
    this.profileService = new UserProfileService();
  }

  // ─── Request Helpers ────────────────────────────────────────────────────────

  /**
   * Extracts userId from the authenticated request.
   * Throws "UNAUTHORIZED" if the user is not authenticated.
   */
  protected getUserId(req: AuthenticatedRequest): string {
    if (!req.userId) throw new Error("UNAUTHORIZED");
    return req.userId;
  }

  // ─── Sanitization ───────────────────────────────────────────────────────────

  /**
   * Strips immutable/internal fields from an incoming update payload
   * so callers cannot overwrite identity or timestamp fields.
   */
  protected sanitizeProfileUpdates(body: any): UpdateProfileRequestBody {
    // Omit fields that must never be updated through a PATCH endpoint:
    //   userId   — ownership must not change
    //   role     — role transitions go through a dedicated flow
    //   _id      — internal DB key
    //   createdAt / updatedAt — managed by Mongoose timestamps
    //   isDeleted / deletedAt / deletedBy — managed by softDelete / restore
    const {
      userId,
      role,
      _id,
      createdAt,
      updatedAt,
      isDeleted,
      deletedAt,
      deletedBy,
      ...sanitized
    } = body;

    return sanitized as UpdateProfileRequestBody;
  }

  // ─── Validation ─────────────────────────────────────────────────────────────

  /**
   * Validates a mobile number if one is provided.
   * Returns true when the field is absent so optional numbers don't block saves.
   */
  protected validateMobileNumber(mobileNumber?: string): boolean {
    if (!mobileNumber) return true;
    return this.profileService.validateMobileNumber(mobileNumber);
  }

  // ─── Response Helpers ────────────────────────────────────────────────────────

  protected success(
    res: Response,
    data: unknown,
    message: string,
    status = 200
  ): void {
    res.status(status).json({ success: true, message, data });
  }

  protected error(
    res: Response,
    message: string,
    status = 400,
    data?: unknown
  ): void {
    res.status(status).json({
      success: false,
      message,
      ...(data !== undefined && { data }),
    });
  }

  protected handleUnauthorized(res: Response): void {
    this.error(res, "Unauthorized: User ID not found", 401);
  }
}

