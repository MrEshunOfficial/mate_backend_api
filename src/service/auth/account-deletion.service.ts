import crypto from "crypto";
import { Types } from "mongoose";

// Importing the index registers all cascade handlers with the registry
import "./cascade/userProfile.cascade";

import { User } from "../../models/auth/auth.model";
import {
  AccountDeletionStatus,
  AccountDeletionEvent,
} from "../../types/account-deletion.types";
import { UserRole } from "../../types/base.types";
import AccountDeletionEventModel from "../../models/auth/accountDeletionEvent.model";
import { cascadeRegistry } from "../../registry/cascade.registry";

// ─── Service ──────────────────────────────────────────────────────────────────

export class AccountDeletionService {

  // ── Step 1: Validate eligibility ───────────────────────────────────────────

  async validateEligibility(userId: string) {
    const blockers: AccountDeletionEvent["validationSnapshot"]["blockers"] = [];

    // ── Add blocker checks here as your app grows ──────────────────────────
    //
    // Example — active bookings:
    //   const active = await BookingModel.find({
    //     clientId: userId,
    //     status: { $in: ["pending", "confirmed"] },
    //   });
    //   for (const b of active) {
    //     blockers.push({
    //       type: "active_booking_as_client",
    //       entityId: b._id,
    //       description: `Active booking #${b._id}`,
    //     });
    //   }
    //
    // Example — pending payouts:
    //   const payouts = await PayoutModel.find({ userId, status: "pending" });
    //   for (const p of payouts) {
    //     blockers.push({
    //       type: "pending_payout",
    //       entityId: p._id,
    //       description: `Pending payout of ${p.amount}`,
    //     });
    //   }

    const { hardDeleteCount, anonymiseCount, softDeleteCount } =
      cascadeRegistry.getSummary();

    return {
      isEligible: blockers.length === 0,
      blockers,
      deletionSummary: {
        hardDeleteCount,
        anonymiseCount,
        softDeleteCount,
        filesToRemove: 0, // update if you track file counts separately
        roles: [UserRole.CUSTOMER],
      },
    };
  }

  // ── Step 2: Schedule deletion (creates the audit event) ────────────────────

  async scheduleDeletion(
    userId:            string,
    initiatedBy:       "user" | "admin",
    adminId?:          string,
    gracePeriodHours = 24
  ): Promise<AccountDeletionEvent> {
    const userObjectId = new Types.ObjectId(userId);

    // Block duplicate in-flight requests
    const existing = await AccountDeletionEventModel.findOne({
      userId: userObjectId,
      status: {
        $in: [AccountDeletionStatus.PENDING, AccountDeletionStatus.SCHEDULED],
      },
    });
    if (existing) throw new Error("DELETION_ALREADY_SCHEDULED");

    const validation = await this.validateEligibility(userId);
    if (!validation.isEligible) throw new Error("DELETION_BLOCKED");

    const now              = new Date();
    const gracePeriodEndsAt = new Date(
      now.getTime() + gracePeriodHours * 60 * 60 * 1_000
    );

    // Permanent reference that outlives the user document
    const anonymisedIdentifier = `Deleted User #${crypto
      .randomBytes(2)
      .toString("hex")}`;

    const event = await AccountDeletionEventModel.create({
      userId: userObjectId,
      anonymisedIdentifier,
      status: AccountDeletionStatus.SCHEDULED,
      validationSnapshot: {
        userId:          userObjectId,
        isEligible:      true,
        blockers:        validation.blockers,
        deletionSummary: validation.deletionSummary,
        checkedAt:       now,
      },
      scheduledAt:     now,
      gracePeriodEndsAt,
      initiatedBy,
      adminId: adminId ? new Types.ObjectId(adminId) : null,
    });

    return event;
  }

  // ── Step 3: Cancel (within grace period) ───────────────────────────────────

  async cancelDeletion(userId: string): Promise<void> {
    const event = await AccountDeletionEventModel.findOne({
      userId: new Types.ObjectId(userId),
      status: AccountDeletionStatus.SCHEDULED,
    });

    if (!event)              throw new Error("NO_PENDING_DELETION");
    if (!event.isInGracePeriod) throw new Error("GRACE_PERIOD_EXPIRED");

    // Append-only — write a cancelled record, never mutate the original
    await AccountDeletionEventModel.create({
      ...event.toObject(),
      _id:         new Types.ObjectId(),
      status:      AccountDeletionStatus.CANCELLED,
      completedAt: new Date(),
    });
  }

  // ── Step 4: Execute pipeline (called by scheduler) ─────────────────────────

  async executePipeline(eventId: string): Promise<void> {
    const event = await AccountDeletionEventModel.findById(eventId);
    if (!event)                 throw new Error("EVENT_NOT_FOUND");
    if (!event.isReadyToProcess) throw new Error("NOT_READY_TO_PROCESS");

    const ctx = {
      userId:               event.userId as Types.ObjectId,
      anonymisedIdentifier: event.anonymisedIdentifier,
    };

    // Run every registered cascade handler
    const cascadeResults = await cascadeRegistry.runAll(ctx);

    const hasFailed = cascadeResults.some((r) => r.status === "failed");

    if (hasFailed) {
      // Append a failed audit record — do NOT hard-delete the user
      await AccountDeletionEventModel.create({
        ...event.toObject(),
        _id:                new Types.ObjectId(),
        status:             AccountDeletionStatus.FAILED,
        cascadeResults,
        failedAt:           new Date(),
        failureReason:      "One or more cascade steps failed — see cascadeResults",
        requiresAdminReview: true,
      });
      return;
    }

    // ── Point of no return — hard-delete the user document last ──────────────
    await User.findByIdAndDelete(event.userId);

    await AccountDeletionEventModel.create({
      ...event.toObject(),
      _id:           new Types.ObjectId(),
      status:        AccountDeletionStatus.COMPLETED,
      cascadeResults,
      completedAt:   new Date(),
    });
  }

  // ── Scheduler entry point ───────────────────────────────────────────────────

  /** Called by the cron job every N minutes. */
  async processReadyEvents(): Promise<void> {
    const events = await AccountDeletionEventModel.findReadyToProcess();

    await Promise.allSettled(
      events.map((e: { _id: { toString: () => string; }; }) => this.executePipeline(e._id.toString()))
    );
  }

  // ── Admin helpers ───────────────────────────────────────────────────────────

  async getDeletionStatus(userId: string) {
    return AccountDeletionEventModel.findByUser(userId);
  }

  async getAdminReviewQueue() {
    return AccountDeletionEventModel.findRequiringAdminReview();
  }
}

export const accountDeletionService = new AccountDeletionService();