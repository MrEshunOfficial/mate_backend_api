import { Request, Response, NextFunction } from "express";
import { HydratedDocument } from "mongoose";
import ProfileModel from "../../models/profiles/base.profile.model";
import { UserRole, SystemRole } from "../../types/base.types";
import { IUserProfile } from "../../types/profiles/base.profile";
import { AuthenticatedRequest } from "../../types/user.types";

// ─── Extended Request Shape ───────────────────────────────────────────────────

// Role middleware attaches the active profile so controllers don't repeat
// the DB lookup. Use the typed helpers at the bottom to retrieve it.
interface RequestWithProfile extends AuthenticatedRequest {
  userProfile?: HydratedDocument<IUserProfile>;
  userProfileId?: string;
}

// ─── Internal Helper ──────────────────────────────────────────────────────────
// Reusable profile lookup — returns early with an appropriate response if the
// user is not authenticated or has no active profile.
const resolveProfile = async (
  req: RequestWithProfile,
  res: Response
): Promise<HydratedDocument<IUserProfile> | null> => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: "Authentication required",
      error: "User not authenticated",
    });
    return null;
  }

  const userProfile = await ProfileModel.findOne({
    userId: req.user._id,
    isDeleted: { $ne: true },
  });

  if (!userProfile) {
    res.status(403).json({
      success: false,
      message: "Profile required",
      error: "User does not have a registered profile",
    });
    return null;
  }

  return userProfile;
};

// ─── Role Guards ──────────────────────────────────────────────────────────────

/**
 * Allow requests where the profile role matches any entry in `roles`.
 * Usage: requireRole([UserRole.CUSTOMER, UserRole.PROVIDER])
 */
export const requireRole = (roles: UserRole[]) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const profile = await resolveProfile(req as RequestWithProfile, res);
      if (!profile) return; // response already sent

      if (!roles.includes(profile.role as UserRole)) {
        res.status(403).json({
          success: false,
          message: "Access denied",
          error: `This action requires ${roles.join(" or ")} role. Your current role is ${profile.role}`,
        });
        return;
      }

      (req as RequestWithProfile).userProfile = profile;
      (req as RequestWithProfile).userProfileId = profile._id.toString();
      next();
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };
};

export const requireCustomerOrProvider = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const profile = await resolveProfile(req as RequestWithProfile, res);
    if (!profile) return;

    if (
      profile.role !== UserRole.CUSTOMER &&
      profile.role !== UserRole.PROVIDER
    ) {
      res.status(403).json({
        success: false,
        message: "Access denied",
        error: "This action requires customer or provider role",
      });
      return;
    }

    (req as RequestWithProfile).userProfile = profile;
    (req as RequestWithProfile).userProfileId = profile._id.toString();
    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const requireProvider = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const profile = await resolveProfile(req as RequestWithProfile, res);
    if (!profile) return;

    if (profile.role !== UserRole.PROVIDER) {
      res.status(403).json({
        success: false,
        message: "Provider access required",
        error: `Your current role is ${profile.role}, but this action requires provider role`,
      });
      return;
    }

    (req as RequestWithProfile).userProfile = profile;
    (req as RequestWithProfile).userProfileId = profile._id.toString();
    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const requireCustomer = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const profile = await resolveProfile(req as RequestWithProfile, res);
    if (!profile) return;

    if (profile.role !== UserRole.CUSTOMER) {
      res.status(403).json({
        success: false,
        message: "Customer access required",
        error: `Your current role is ${profile.role}, but this action requires customer role`,
      });
      return;
    }

    (req as RequestWithProfile).userProfile = profile;
    (req as RequestWithProfile).userProfileId = profile._id.toString();
    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Optionally attaches the profile if it exists. Never fails the request.
 */
export const attachUserProfile = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authReq = req as RequestWithProfile;
    if (authReq.user) {
      const userProfile = await ProfileModel.findOne({
        userId: authReq.user._id,
        isDeleted: { $ne: true },
      });

      if (userProfile) {
        authReq.userProfile = userProfile;
        authReq.userProfileId = userProfile._id.toString();
      }
    }
    next();
  } catch {
    next(); // non-fatal — continue without profile
  }
};

/**
 * Allows access only to the resource owner or to admins/super-admins.
 * Resolves the owner ID from req.params, req.body, or req.resource in that order.
 *
 * isAdmin / isSuperAdmin are removed from IUser — check is done via systemRole.
 */
export const requireOwnerOrAdmin = (ownerIdField = "userId") => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const authReq = req as RequestWithProfile;

      if (!authReq.user) {
        res.status(401).json({
          success: false,
          message: "Authentication required",
          error: "User not authenticated",
        });
        return;
      }

      const rawOwnerId: unknown =
        req.params[ownerIdField] ??
        req.body[ownerIdField] ??
        (req as any).resource?.[ownerIdField];

      // req.params values can widen to string | string[] in some Express typing
      // paths — take only the first element when an array arrives.
      const ownerId: string | undefined = Array.isArray(rawOwnerId)
        ? rawOwnerId[0]
        : typeof rawOwnerId === "string"
          ? rawOwnerId
          : undefined;

      const isOwner =
        ownerId != null &&
        authReq.user._id.toString() === ownerId.toString();

      const role = authReq.user.systemRole;
      const isAdminOrAbove =
        role === SystemRole.ADMIN || role === SystemRole.SUPER_ADMIN;

      if (!isOwner && !isAdminOrAbove) {
        res.status(403).json({
          success: false,
          message: "Access denied",
          error: "You do not have permission to access this resource",
        });
        return;
      }

      next();
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };
};

// ─── Request Helpers ──────────────────────────────────────────────────────────

export const getUserProfile = (req: Request): HydratedDocument<IUserProfile> | undefined =>
  (req as RequestWithProfile).userProfile;

export const getUserProfileId = (req: Request): string | undefined =>
  (req as RequestWithProfile).userProfileId;

export const hasUserProfile = (req: Request): boolean =>
  !!(req as RequestWithProfile).userProfile;

export const getUserRole = (req: Request): UserRole | undefined =>
  (req as RequestWithProfile).userProfile?.role as UserRole | undefined;