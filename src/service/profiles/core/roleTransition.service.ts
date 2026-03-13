// services/profiles/core/roleTransition.service.ts
import { Types } from "mongoose";
import ProfileModel from "../../../models/profiles/base.profile.model";
import RoleTransitionEventModel from "../../../models/profiles/transitionEvent.model";
import { UserRole } from "../../../types/base.types";
import { BookingStatus } from "../../../types/bookings.types";
import {
  RoleTransitionValidation,
  RoleTransitionBlocker,
  RoleTransitionStatus,
  RoleTransitionEvent,
  RoleTransitionDataHandling,
} from "../../../types/role-transition.types";
import { TaskStatus } from "../../../types/tasks.types";
import BookingModel from "../../../models/booking.model";
import DomainProfileModel from "../../../models/profiles/domain.profile.model";
import { ServiceModel } from "../../../models/service/serviceModel";
import TaskModel from "../../../models/task.model";
import { ScaffoldResult, profileScaffoldingService } from "../profileScafolding.service";

// ─── Note on removed imports ──────────────────────────────────────────────────
//
// ClientProfileModel and ProviderProfileModel are no longer imported here.
// All role-specific profile document creation is handled by
// ProfileScaffoldingService._createRoleSpecificProfile(). This service only
// needs to know about the transition lifecycle — not which documents to create.

export class RoleTransitionService {

  // ─── Validate ───────────────────────────────────────────────────────────────

  /**
   * Runs all pre-flight checks for a role transition without touching any data.
   * Returns a RoleTransitionValidation the caller can inspect before executing.
   */
  async validate(
    userId: string,
    toRole: UserRole
  ): Promise<RoleTransitionValidation> {
    const userObjectId = new Types.ObjectId(userId);

    const profile = await ProfileModel.findActiveByUserId(userId);
    if (!profile) {
      throw new Error("Profile not found");
    }

    const fromRole = profile.role as UserRole;

    if (fromRole === toRole) {
      throw new Error(`User is already a ${toRole}`);
    }

    const blockers: RoleTransitionBlocker[] = [];
    const activeBookingsAsProvider: RoleTransitionValidation["activeBookingsAsProvider"] = [];
    const pendingTasksAsProvider: RoleTransitionValidation["pendingTasksAsProvider"] = [];
    const activeServices: RoleTransitionValidation["activeServices"] = [];

    // Provider → Customer requires the most checks.
    // Customer → Provider has no hard blockers (just creates a provider profile).
    if (fromRole === UserRole.PROVIDER) {

      // ── Active bookings as provider ────────────────────────────────────────
      const activeBookings = await BookingModel.find({
        providerId: userObjectId,
        status: { $in: [BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS] },
      }).select("bookingNumber status");

      for (const b of activeBookings) {
        activeBookingsAsProvider.push({
          bookingId:     b._id,
          bookingNumber: b.bookingNumber,
          status:        b.status,
        });
        blockers.push({
          type:        "active_booking",
          entityId:    b._id,
          description: `Booking ${b.bookingNumber} is currently ${b.status}. Complete or cancel it before switching roles.`,
        });
      }

      // ── Unresolved disputes ────────────────────────────────────────────────
      const disputedBookings = await BookingModel.find({
        providerId: userObjectId,
        status:     BookingStatus.DISPUTED,
      }).select("bookingNumber status");

      for (const b of disputedBookings) {
        activeBookingsAsProvider.push({
          bookingId:     b._id,
          bookingNumber: b.bookingNumber,
          status:        b.status,
        });
        blockers.push({
          type:        "unresolved_dispute",
          entityId:    b._id,
          description: `Booking ${b.bookingNumber} has an unresolved dispute. It must be resolved by an admin before switching roles.`,
        });
      }

      // ── Pending tasks as provider ──────────────────────────────────────────
      const pendingTasks = await TaskModel.find({
        "acceptedProvider.providerId": userObjectId,
        status: { $in: [TaskStatus.ACCEPTED, TaskStatus.REQUESTED] },
      }).select("title status");

      for (const t of pendingTasks) {
        pendingTasksAsProvider.push({ taskId: t._id, title: t.title });
        blockers.push({
          type:        "pending_task",
          entityId:    t._id,
          description: `Task "${t.title}" is in ${t.status} state. Resolve it before switching roles.`,
        });
      }

      // ── Active services (informational — not a hard block) ─────────────────
      // Active services will be deactivated on transition, not rejected.
      // Surface them so the user knows what will change.
      const services = await ServiceModel.find({
        providerId: userObjectId,
        isActive:   true,
        isDeleted:  false,
      }).select("title");

      for (const s of services) {
        activeServices.push({ serviceId: s._id, title: s.title });
      }
    }

    const hasHardBlockers = blockers.some((b) =>
      (["active_booking", "pending_task", "unresolved_dispute"] as const).includes(
        b.type as "active_booking" | "pending_task" | "unresolved_dispute"
      )
    );

    return {
      userId: userObjectId,
      fromRole,
      toRole,
      status: hasHardBlockers
        ? RoleTransitionStatus.BLOCKED
        : RoleTransitionStatus.ELIGIBLE,
      activeBookingsAsProvider,
      pendingTasksAsProvider,
      activeServices,
      blockers,
      checkedAt: new Date(),
    };
  }

  // ─── Execute ─────────────────────────────────────────────────────────────────

  /**
   * Executes the role transition after validation passes.
   * Writes a RoleTransitionEvent audit record regardless of outcome.
   */
  async execute(
    userId: string,
    toRole: UserRole,
    acknowledgedDataHandling: boolean
  ): Promise<RoleTransitionEvent> {
    if (!acknowledgedDataHandling) {
      throw new Error(
        "You must acknowledge the data handling implications before switching roles."
      );
    }

    const userObjectId = new Types.ObjectId(userId);
    const validation   = await this.validate(userId, toRole);

    if (validation.status === RoleTransitionStatus.BLOCKED) {
      throw new Error(
        `Role transition blocked: ${validation.blockers.map((b) => b.description).join(" | ")}`
      );
    }

    // Write the audit event in IN_PROGRESS state first.
    // Updated to COMPLETED or ROLLED_BACK once _applyTransition resolves.
    const event = await RoleTransitionEventModel.create({
      userId:             userObjectId,
      fromRole:           validation.fromRole,
      toRole,
      status:             RoleTransitionStatus.IN_PROGRESS,
      validationSnapshot: validation,
      initiatedAt:        new Date(),
    });

    try {
      const dataHandling = await this._applyTransition(
        userId,
        userObjectId,
        validation
      );

      event.status      = RoleTransitionStatus.COMPLETED;
      event.dataHandling = dataHandling;
      event.completedAt  = new Date();
      await event.save();

      return event.toObject() as RoleTransitionEvent;

    } catch (error) {
      // Record the failure — never silently swallow a mid-transition error
      event.status         = RoleTransitionStatus.ROLLED_BACK;
      event.rollbackReason = error instanceof Error ? error.message : String(error);
      await event.save();
      throw error;
    }
  }

  // ─── Internal Transition Logic ────────────────────────────────────────────────

  private async _applyTransition(
    userId: string,
    userObjectId: Types.ObjectId,
    validation: RoleTransitionValidation
  ): Promise<RoleTransitionDataHandling> {
    const { fromRole, toRole } = validation;
    const dataHandling: Partial<RoleTransitionDataHandling> = {};

    // ── Step 1: Deactivate the current role's DomainProfile ───────────────────
    const currentDomainProfile = await DomainProfileModel.findOne({
      userId:   userObjectId,
      role:     fromRole,
      isActive: true,
    });

    if (currentDomainProfile) {
      currentDomainProfile.isActive     = false;
      currentDomainProfile.deactivatedAt = new Date();
      await currentDomainProfile.save();

      if (fromRole === UserRole.PROVIDER) {
        dataHandling.providerDomainProfile = {
          profileId:       currentDomainProfile._id as Types.ObjectId,
          action:          "deactivated",
          deactivatedAt:   currentDomainProfile.deactivatedAt,
        };
      }
    }

    // ── Step 2: Deactivate all provider services (provider → customer only) ───
    if (fromRole === UserRole.PROVIDER) {
      const serviceResult = await ServiceModel.updateMany(
        { providerId: userObjectId, isDeleted: false },
        { isActive: false, isPrivate: true }
      );

      const serviceIds = await ServiceModel.find({
        providerId: userObjectId,
        isDeleted:  false,
      }).distinct("_id");

      dataHandling.services = {
        action:     "deactivated",
        serviceIds,
        count:      serviceResult.modifiedCount,
      };

      const completedBookingCount = await BookingModel.countDocuments({
        providerId: userObjectId,
        status:     BookingStatus.COMPLETED,
      });

      dataHandling.historicalBookings = {
        action: "retained",
        count:  completedBookingCount,
      };
    }

    // ── Step 3: Scaffold or reactivate the target role's profile chain ─────────
    //
    // Delegates entirely to ProfileScaffoldingService — the same service that
    // UserProfileService.createProfile() calls when the user first picks their
    // role at signup. Both paths produce an identical result.
    //
    // Internally, scaffoldDomainProfile() will:
    //   a) Reactivate the existing DomainProfile if the user previously held
    //      this role (preserving all their prior ClientProfile / ProviderProfile data).
    //   b) Create a fresh chain if this is their first time in this role.
    const userProfile = await ProfileModel.findActiveByUserId(userId);
    if (!userProfile) {
      throw new Error("UserProfile not found during role transition");
    }

    const scaffold: ScaffoldResult = await profileScaffoldingService.scaffoldDomainProfile(
      userId,
      userObjectId,
      userProfile._id as Types.ObjectId,
      toRole
    );

    // RoleTransitionDataHandling.clientDomainProfile covers both directions
    // (customer ← provider and provider ← customer), despite the field name.
    dataHandling.clientDomainProfile = {
      action:    scaffold.action,          // "created" | "reactivated"
      profileId: scaffold.domainProfileId,
    };

    // ── Step 4: Update the UserProfile role ────────────────────────────────────
    await ProfileModel.findOneAndUpdate(
      { userId: userObjectId, isDeleted: false },
      { role: toRole },
      { runValidators: true }
    );

    return dataHandling as RoleTransitionDataHandling;
  }

  // ─── History ──────────────────────────────────────────────────────────────────

  /**
   * Returns the full role transition history for a user, most recent first.
   */
  async getTransitionHistory(userId: string): Promise<RoleTransitionEvent[]> {
    const events = await RoleTransitionEventModel.find({
      userId: new Types.ObjectId(userId),
    }).sort({ initiatedAt: -1 });

    return events.map((e) => e.toObject()) as RoleTransitionEvent[];
  }
}