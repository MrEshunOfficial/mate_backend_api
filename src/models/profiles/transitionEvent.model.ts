// models/roleTransitionEvent.model.ts
import { Schema, model } from "mongoose";
import { UserRole } from "../../types/base.types";
import { RoleTransitionEvent, RoleTransitionStatus } from "../../types/role-transition.types";

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const roleTransitionBlockerSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["active_booking", "pending_task", "active_service", "unresolved_dispute"],
      required: true,
    },
    entityId: { type: Schema.Types.ObjectId, required: true },
    description: { type: String, required: true },
  },
  { _id: false }
);

const validationSnapshotSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    fromRole: { type: String, enum: Object.values(UserRole), required: true },
    toRole: { type: String, enum: Object.values(UserRole), required: true },
    status: { type: String, enum: Object.values(RoleTransitionStatus), required: true },
    activeBookingsAsProvider: [
      {
        bookingId: Schema.Types.ObjectId,
        bookingNumber: String,
        status: String,
        _id: false,
      },
    ],
    pendingTasksAsProvider: [
      {
        taskId: Schema.Types.ObjectId,
        title: String,
        _id: false,
      },
    ],
    activeServices: [
      {
        serviceId: Schema.Types.ObjectId,
        title: String,
        _id: false,
      },
    ],
    blockers: [roleTransitionBlockerSchema],
    checkedAt: { type: Date, required: true },
  },
  { _id: false }
);

const dataHandlingSchema = new Schema(
  {
    providerDomainProfile: {
      profileId: Schema.Types.ObjectId,
      action: { type: String, enum: ["deactivated"] },
      deactivatedAt: Date,
    },
    services: {
      action: { type: String, enum: ["deactivated"] },
      serviceIds: [Schema.Types.ObjectId],
      count: Number,
    },
    historicalBookings: {
      action: { type: String, enum: ["retained"] },
      count: Number,
    },
    clientDomainProfile: {
      action: { type: String, enum: ["created", "reactivated"] },
      profileId: Schema.Types.ObjectId,
    },
  },
  { _id: false }
);

// ─── Schema ───────────────────────────────────────────────────────────────────

const roleTransitionEventSchema = new Schema<RoleTransitionEvent>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    fromRole: {
      type: String,
      enum: Object.values(UserRole),
      required: true,
    },
    toRole: {
      type: String,
      enum: Object.values(UserRole),
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(RoleTransitionStatus),
      // required: true,
      default: RoleTransitionStatus.PENDING_VALIDATION,
    },
    validationSnapshot: { type: validationSnapshotSchema, required: true },
    dataHandling: { type: dataHandlingSchema },
    initiatedAt: { type: Date, required: true, default: Date.now },
    completedAt: { type: Date },
    rollbackReason: { type: String },
    overriddenBy: { type: Schema.Types.ObjectId, ref: "User" },
    overrideReason: { type: String },
  },
  {
    // Audit records are never mutated after creation — no timestamps needed,
    // initiatedAt and completedAt cover the lifecycle explicitly.
    collection: "roleTransitionEvents",
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

roleTransitionEventSchema.index({ userId: 1, initiatedAt: -1 });
roleTransitionEventSchema.index({ status: 1 });

// ─── Model ────────────────────────────────────────────────────────────────────

export const RoleTransitionEventModel = model<RoleTransitionEvent>(
  "RoleTransitionEvent",
  roleTransitionEventSchema
);

export default RoleTransitionEventModel;