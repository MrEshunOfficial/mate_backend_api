// models/accountDeletionEvent.model.ts
import mongoose, { Schema, model, Model } from "mongoose";
import {
  AccountDeletionEvent,
  AccountDeletionStatus,
  DeletionTier,
} from "../../types/account-deletion.types";
import { UserRole } from "../../types/base.types";

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const accountDeletionBlockerSchema = new Schema(
  {
    type: {
      type: String,
      enum: [
        "active_booking_as_client",
        "active_booking_as_provider",
        "unresolved_dispute",
        "pending_payout",
      ],
      required: true,
    },
    entityId:    { type: Schema.Types.ObjectId, required: true },
    description: { type: String, required: true },
  },
  { _id: false }
);

const deletionSummarySchema = new Schema(
  {
    hardDeleteCount: { type: Number, required: true, default: 0 },
    anonymiseCount:  { type: Number, required: true, default: 0 },
    softDeleteCount: { type: Number, required: true, default: 0 },
    filesToRemove:   { type: Number, required: true, default: 0 },
    roles: {
      type: [String],
      enum: Object.values(UserRole),
      default: [],
    },
  },
  { _id: false }
);

const validationSnapshotSchema = new Schema(
  {
    userId:     { type: Schema.Types.ObjectId, required: true },
    isEligible: { type: Boolean, required: true },
    blockers:   { type: [accountDeletionBlockerSchema], default: [] },
    deletionSummary: {
      type: deletionSummarySchema,
      required: true,
      default: () => ({
        hardDeleteCount: 0,
        anonymiseCount:  0,
        softDeleteCount: 0,
        filesToRemove:   0,
        roles:           [],
      }),
    },
    checkedAt: { type: Date, required: true },
  },
  { _id: false }
);

const entityDeletionResultSchema = new Schema(
  {
    collection:      { type: String, required: true },
    tier: {
      type: String,
      enum: Object.values(DeletionTier),
      required: true,
    },
    recordsAffected: { type: Number, required: true, default: 0 },
    status: {
      type: String,
      enum: ["success", "failed", "skipped"],
      required: true,
    },
    error: { type: String },
  },
  { _id: false }
);

// ─── Main Schema ──────────────────────────────────────────────────────────────

// AccountDeletionEvent is an append-only audit record.
// Documents in this collection are NEVER updated after creation —
// the pipeline writes a new document for each attempt.
// { timestamps: false } is intentional — initiatedAt and completedAt
// cover the full lifecycle without needing createdAt/updatedAt noise.

const accountDeletionEventSchema = new Schema<AccountDeletionEvent>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId is required"],
      index: true,
      // Note: after pipeline completion the user document will be hard-deleted.
      // We keep userId here for the audit trail; the anonymisedIdentifier
      // field below serves as the permanent reference once userId is gone.
    },

    // Permanent reference that survives user hard-deletion.
    // e.g. "Deleted User #a3f9" — used on anonymised booking records.
    anonymisedIdentifier: {
      type: String,
      required: [true, "anonymisedIdentifier is required"],
      trim: true,
      index: true,
    },

    status: {
      type: String,
      enum: {
        values: Object.values(AccountDeletionStatus),
        message: "Invalid account deletion status",
      },
      default: AccountDeletionStatus.PENDING,
      index: true,
    },

    // Snapshot of the validation run that permitted (or would have blocked) deletion.
    // Stored verbatim — never recalculated after creation.
    validationSnapshot: {
      type: validationSnapshotSchema,
      required: [true, "validationSnapshot is required"],
    },

    // Grace period — user can cancel within this window before data is touched.
    scheduledAt: {
      type: Date,
      required: [true, "scheduledAt is required"],
    },
    gracePeriodEndsAt: {
      type: Date,
      required: [true, "gracePeriodEndsAt is required"],
      index: true,
    },
    completedAt: { type: Date },

    // Per-entity pipeline results — appended as each collection is processed.
    cascadeResults: {
      type: [entityDeletionResultSchema],
      default: [],
    },

    // Failure tracking
    failedAt:             { type: Date },
    failureReason:        { type: String, trim: true },
    requiresAdminReview:  { type: Boolean, default: false },

    // Provenance
    initiatedBy: {
      type: String,
      enum: ["user", "admin"],
      required: [true, "initiatedBy is required"],
    },
    adminId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    // No { timestamps: true } — initiatedAt / completedAt cover the lifecycle.
    // Avoiding Mongoose timestamps prevents a misleading updatedAt from
    // suggesting the record was mutated after creation.
    collection: "accountDeletionEvents",
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, any>) => {
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

// Scheduler query: "find events whose grace period has elapsed and are still SCHEDULED"
accountDeletionEventSchema.index({ status: 1, gracePeriodEndsAt: 1 });

// Admin review queue
accountDeletionEventSchema.index({ requiresAdminReview: 1, status: 1 });

// Lookup by initiator type (user self-service vs admin-triggered)
accountDeletionEventSchema.index({ initiatedBy: 1, status: 1 });

// ─── Virtuals ─────────────────────────────────────────────────────────────────

// True while the user can still cancel the deletion
accountDeletionEventSchema.virtual("isInGracePeriod").get(function () {
  return (
    this.status === AccountDeletionStatus.SCHEDULED &&
    this.gracePeriodEndsAt > new Date()
  );
});

// Convenience flag for scheduler — grace period has elapsed and pipeline should start
accountDeletionEventSchema.virtual("isReadyToProcess").get(function () {
  return (
    this.status === AccountDeletionStatus.SCHEDULED &&
    this.gracePeriodEndsAt <= new Date()
  );
});

// Summary counts derived from cascadeResults — useful for admin dashboards
accountDeletionEventSchema.virtual("totalRecordsAffected").get(function () {
  return (this.cascadeResults ?? []).reduce(
    (sum, r) => sum + (r.recordsAffected ?? 0),
    0
  );
});

accountDeletionEventSchema.virtual("hasFailures").get(function () {
  return (this.cascadeResults ?? []).some((r) => r.status === "failed");
});

// ─── Static Methods ───────────────────────────────────────────────────────────

interface AccountDeletionEventModel extends Model<AccountDeletionEvent> {
  /**
   * Returns events that have passed their grace period and are ready
   * to be picked up by the deletion pipeline scheduler.
   */
  findReadyToProcess(): mongoose.Query<AccountDeletionEvent[], AccountDeletionEvent>;

  /**
   * Returns all deletion events for a given user across all statuses.
   * Used by admin tooling and support cases.
   */
  findByUser(userId: string): mongoose.Query<AccountDeletionEvent[], AccountDeletionEvent>;

  /**
   * Returns events that failed mid-pipeline and require manual admin review.
   */
  findRequiringAdminReview(): mongoose.Query<AccountDeletionEvent[], AccountDeletionEvent>;
}

accountDeletionEventSchema.statics.findReadyToProcess = function () {
  return this.find({
    status:            AccountDeletionStatus.SCHEDULED,
    gracePeriodEndsAt: { $lte: new Date() },
  });
};

accountDeletionEventSchema.statics.findByUser = function (userId: string) {
  return this.find({ userId }).sort({ scheduledAt: -1 });
};

accountDeletionEventSchema.statics.findRequiringAdminReview = function () {
  return this.find({ requiresAdminReview: true }).sort({ failedAt: -1 });
};

// ─── Model ────────────────────────────────────────────────────────────────────

export const AccountDeletionEventModel = model<
  AccountDeletionEvent,
  AccountDeletionEventModel
>("AccountDeletionEvent", accountDeletionEventSchema);

export default AccountDeletionEventModel;