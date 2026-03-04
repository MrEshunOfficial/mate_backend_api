import { Types } from "mongoose";
import { UserRole } from "./base.types";
import { BookingStatus } from "./bookings.types";

// ─── Transition State Machine ─────────────────────────────────────────────────

export enum RoleTransitionStatus {
  PENDING_VALIDATION = "pending_validation", // checks not yet run
  BLOCKED            = "blocked",            // unresolved dependencies exist
  ELIGIBLE           = "eligible",           // all checks passed, ready to proceed
  IN_PROGRESS        = "in_progress",        // transition is being applied
  COMPLETED          = "completed",
  ROLLED_BACK        = "rolled_back",        // something failed mid-transition
}

// ─── Pre-transition Validation ────────────────────────────────────────────────

// Represents the result of the pre-flight check before a role change is allowed.
// The system must run this and return ELIGIBLE before any data is touched.
export interface RoleTransitionValidation {
  userId: Types.ObjectId;
  fromRole: UserRole;
  toRole: UserRole;
  status: RoleTransitionStatus;

  // Bookings where the user is acting as a provider
  activeBookingsAsProvider: Array<{
    bookingId: Types.ObjectId;
    bookingNumber: string;
    status: BookingStatus;
  }>;

  // Tasks where the user has accepted or been requested
  pendingTasksAsProvider: Array<{
    taskId: Types.ObjectId;
    title: string;
  }>;

  // Services still marked isActive: true
  activeServices: Array<{
    serviceId: Types.ObjectId;
    title: string;
  }>;

  // Transition is blocked if any of these are non-empty
  blockers: RoleTransitionBlocker[];

  checkedAt: Date;
}

export interface RoleTransitionBlocker {
  type:
    | "active_booking"       // in-progress or confirmed booking as provider
    | "pending_task"         // accepted/requested task as provider
    | "active_service"       // service still live (informational, not hard block)
    | "unresolved_dispute";  // disputed booking awaiting admin resolution
  entityId: Types.ObjectId;
  description: string;
}

// ─── Transition Event ─────────────────────────────────────────────────────────

// Persisted audit record of a role change — stored in its own collection.
// Never mutated after creation.
export interface RoleTransitionEvent {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  fromRole: UserRole;
  toRole: UserRole;
  status: RoleTransitionStatus;

  // Snapshot of validation result at the time of transition
  validationSnapshot: RoleTransitionValidation;

  // What happened to the existing provider data
  dataHandling: RoleTransitionDataHandling;

  initiatedAt: Date;
  completedAt?: Date;
  rollbackReason?: string;

  // Admin override — allows transition despite soft blockers (e.g. inactive services)
  overriddenBy?: Types.ObjectId;
  overrideReason?: string;
}

// ─── Data Handling Strategy ───────────────────────────────────────────────────

// Describes what the system did with each category of provider data
// when the user transitioned away from the provider role.
export interface RoleTransitionDataHandling {
  // Provider DomainProfile — deactivated, not deleted. Can be reactivated if
  // user switches back to provider role.
  providerDomainProfile: {
    profileId: Types.ObjectId;
    action: "deactivated";
    deactivatedAt: Date;
  };

  // Services — all set to isActive: false and isPrivate: true.
  // Historical booking references remain intact.
  services: {
    action: "deactivated";
    serviceIds: Types.ObjectId[];
    count: number;
  };

  // Completed bookings — retained as-is. Provider earnings history preserved.
  historicalBookings: {
    action: "retained";
    count: number;
  };

  // Client DomainProfile — created fresh, or reactivated if one already existed
  // (user may have been a client before becoming a provider).
  clientDomainProfile:
    | { action: "created"; profileId: Types.ObjectId }
    | { action: "reactivated"; profileId: Types.ObjectId };
}

// ─── Request / Response ───────────────────────────────────────────────────────

export interface RequestRoleChangeBody {
  toRole: UserRole;
  // User must explicitly acknowledge that their provider profile will be deactivated
  acknowledgedDataHandling: boolean;
}

export interface RoleTransitionValidationResponse {
  success: boolean;
  message: string;
  validation?: RoleTransitionValidation;
  error?: string;
}

export interface RoleTransitionResponse {
  success: boolean;
  message: string;
  transition?: Pick<
    RoleTransitionEvent,
    "userId" | "fromRole" | "toRole" | "status" | "completedAt" | "dataHandling"
  >;
  error?: string;
}