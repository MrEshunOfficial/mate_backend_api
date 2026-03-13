// middleware/ownership.middleware.ts
import { Response, NextFunction } from "express";
import { Types } from "mongoose";
import { SystemRole } from "../../types/base.types";
import { AuthenticatedRequest } from "../../types/user.types";
import ProfileModel from "../../models/profiles/base.profile.model";
import { getParam } from "../../utils/auth/auth.controller.utils";
import BookingModel from "../../models/booking.model";
import ClientProfileModel from "../../models/profiles/client.profile.model";
import ProviderProfileModel from "../../models/profiles/provider.profile.model";
import TaskModel from "../../models/task.model";

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Returns true when the authenticated user holds an admin-level system role.
 * Admins bypass all ownership checks — they can act on any entity.
 */
const isAdmin = (req: AuthenticatedRequest): boolean => {
  const role = req.user?.systemRole;
  return role === SystemRole.ADMIN || role === SystemRole.SUPER_ADMIN;
};

/**
 * Looks up the IUserProfile for the authenticated user and returns its _id.
 * Returns null and sends an appropriate response if the profile is missing.
 *
 * Most ownership checks need the IUserProfile._id because entity foreign keys
 * (Booking.clientId, Task.clientId, etc.) all reference IUserProfile._id,
 * not User._id.
 */
const resolveUserProfileId = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Types.ObjectId | null> => {
  const userProfile = await ProfileModel.findOne({
    userId: req.user!._id,
    isDeleted: { $ne: true },
  });

  if (!userProfile) {
    res.status(403).json({
      success: false,
      message: "Profile required",
      error: "No active profile found for this account",
    });
    return null;
  }

  return userProfile._id as Types.ObjectId;
};

// ─── requireClientOwnership ───────────────────────────────────────────────────

/**
 * Verifies that the authenticated user owns the ClientProfile identified by
 * req.params.clientProfileId.
 *
 * Ownership is established by confirming that ClientProfile.profile matches
 * the authenticated user's IUserProfile._id.
 *
 * Admins bypass the check and proceed unconditionally.
 *
 * Used on all client ID image routes where :clientProfileId is in the URL.
 */
export const requireClientOwnership = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
        error: "User not authenticated",
      });
      return;
    }

    // Admins can act on any client profile
    if (isAdmin(req)) {
      next();
      return;
    }

    const clientProfileId = getParam(req.params.clientProfileId);
    if (!clientProfileId || !Types.ObjectId.isValid(clientProfileId)) {
      res.status(400).json({
        success: false,
        message: "Invalid request",
        error: "clientProfileId is required and must be a valid ObjectId",
      });
      return;
    }

    // Resolve the caller's IUserProfile._id
    const userProfileId = await resolveUserProfileId(req, res);
    if (!userProfileId) return; // response already sent

    // Confirm the ClientProfile belongs to this user's profile
    const clientProfile = await ClientProfileModel.findOne({
      _id:      new Types.ObjectId(clientProfileId),
      profile:  userProfileId,   // ClientProfile.profile → IUserProfile._id
      isDeleted: { $ne: true },
    });

    if (!clientProfile) {
      res.status(403).json({
        success: false,
        message: "Access denied",
        error: "You do not have permission to access this client profile",
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

// ─── requireProviderOwnership ─────────────────────────────────────────────────

/**
 * Verifies that the authenticated user owns the ProviderProfile identified by
 * req.params.providerProfileId.
 *
 * Ownership is established by confirming that ProviderProfile.profile matches
 * the authenticated user's IUserProfile._id.
 *
 * Admins bypass the check and proceed unconditionally.
 *
 * Used on provider gallery and provider ID image write routes.
 */
export const requireProviderOwnership = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
        error: "User not authenticated",
      });
      return;
    }

    if (isAdmin(req)) {
      next();
      return;
    }

    const providerProfileId = getParam(req.params.providerProfileId);
    if (!providerProfileId || !Types.ObjectId.isValid(providerProfileId)) {
      res.status(400).json({
        success: false,
        message: "Invalid request",
        error: "providerProfileId is required and must be a valid ObjectId",
      });
      return;
    }

    const userProfileId = await resolveUserProfileId(req, res);
    if (!userProfileId) return;

    const providerProfile = await ProviderProfileModel.findOne({
      _id:      new Types.ObjectId(providerProfileId),
      profile:  userProfileId,   // ProviderProfile.profile → IUserProfile._id
      isDeleted: { $ne: true },
    });

    if (!providerProfile) {
      res.status(403).json({
        success: false,
        message: "Access denied",
        error: "You do not have permission to access this provider profile",
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

// ─── requireBookingParticipant ────────────────────────────────────────────────

/**
 * Verifies that the authenticated user is either the client or the provider
 * on the booking identified by req.params.bookingId.
 *
 * Both Booking.clientId and Booking.providerId reference IUserProfile._id,
 * so the check resolves the caller's profile first then checks membership.
 *
 * Admins bypass the check and proceed unconditionally.
 *
 * Used on all booking attachment routes where :bookingId is in the URL.
 */
export const requireBookingParticipant = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
        error: "User not authenticated",
      });
      return;
    }

    if (isAdmin(req)) {
      next();
      return;
    }

    const bookingId = getParam(req.params.bookingId);
    if (!bookingId || !Types.ObjectId.isValid(bookingId)) {
      res.status(400).json({
        success: false,
        message: "Invalid request",
        error: "bookingId is required and must be a valid ObjectId",
      });
      return;
    }

    const userProfileId = await resolveUserProfileId(req, res);
    if (!userProfileId) return;

    // The caller is a participant if their profile is either clientId or providerId
    const booking = await BookingModel.findOne({
      _id:       new Types.ObjectId(bookingId),
      $or: [
        { clientId:   userProfileId },
        { providerId: userProfileId },
      ],
      isDeleted: { $ne: true },
    });

    if (!booking) {
      res.status(403).json({
        success: false,
        message: "Access denied",
        error: "You are not a participant on this booking",
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

// ─── requireTaskOwner ─────────────────────────────────────────────────────────

/**
 * Verifies that the authenticated user is the client who created the task
 * identified by req.params.taskId.
 *
 * Task.clientId references IUserProfile._id, so the check resolves the
 * caller's profile first then confirms clientId membership.
 *
 * Admins bypass the check and proceed unconditionally.
 *
 * Note: matched providers can VIEW task attachments in practice, but this
 * guard is intentionally strict — a separate requireTaskParticipant guard
 * should be added if providers ever need write access to task files.
 *
 * Used on all task attachment routes where :taskId is in the URL.
 */
export const requireTaskOwner = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
        error: "User not authenticated",
      });
      return;
    }

    if (isAdmin(req)) {
      next();
      return;
    }

    const taskId = getParam(req.params.taskId);
    if (!taskId || !Types.ObjectId.isValid(taskId)) {
      res.status(400).json({
        success: false,
        message: "Invalid request",
        error: "taskId is required and must be a valid ObjectId",
      });
      return;
    }

    const userProfileId = await resolveUserProfileId(req, res);
    if (!userProfileId) return;

    const task = await TaskModel.findOne({
      _id:       new Types.ObjectId(taskId),
      clientId:  userProfileId,   // Task.clientId → IUserProfile._id
      isDeleted: { $ne: true },
    });

    if (!task) {
      res.status(403).json({
        success: false,
        message: "Access denied",
        error: "You are not the owner of this task",
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