import { Types } from "mongoose";
import { UserRole } from "./base.types";

// ─── Deletion Tiers ───────────────────────────────────────────────────────────

// Not all data is treated equally on account deletion. Three tiers apply:
//
//  HARD_DELETE  — PII that must be fully removed (name, email, password, tokens,
//                 profile pictures, ID document files)
//
//  ANONYMISE    — Records with financial or legal significance that must be
//                 retained but stripped of PII. Booking history, payment records,
//                 and dispute records fall here. A placeholder identity
//                 (e.g. "Deleted User #xxxxxx") replaces personal fields.
//
//  SOFT_DELETE  — Operational data that gets isDeleted: true and can be purged
//                 later by a background job. Services, tasks, service requests,
//                 profiles, and domain profile links.

export enum DeletionTier {
  HARD_DELETE = "hard_delete",
  ANONYMISE   = "anonymise",
  SOFT_DELETE = "soft_delete",
}

// ─── Cascade Policy ───────────────────────────────────────────────────────────

// Defines how each entity collection is handled when an account is deleted.
// This is the system's source of truth for the deletion pipeline.
export interface EntityDeletionPolicy {
  collection: string;
  tier: DeletionTier;
  // Fields to null/replace when tier is ANONYMISE
  fieldsToAnonymise?: string[];
  // Replacement value for anonymised identity fields
  anonymisedIdentifier?: string;   // e.g. "Deleted User #a3f9"
  // Whether deletion of this entity type can be deferred (e.g. active bookings)
  deferrable: boolean;
  // Hard blockers — if any records in this collection match, deletion is rejected
  hardBlockConditions?: string[];
}

// The full cascade policy map for the platform
export interface AccountDeletionPolicy {
  user: EntityDeletionPolicy;
  userProfile: EntityDeletionPolicy;
  domainProfiles: EntityDeletionPolicy;
  clientProfile: EntityDeletionPolicy;
  providerProfile: EntityDeletionPolicy;
  services: EntityDeletionPolicy;
  tasks: EntityDeletionPolicy;
  serviceRequests: EntityDeletionPolicy;

  // Bookings are split — active ones block deletion, completed ones are anonymised
  activeBookings: EntityDeletionPolicy;    // hard block if any exist
  completedBookings: EntityDeletionPolicy; // anonymise, never delete

  // Files are deleted from both DB and storage provider
  files: EntityDeletionPolicy;
}

// ─── Pre-deletion Validation ──────────────────────────────────────────────────

export interface AccountDeletionBlocker {
  type:
    | "active_booking_as_client"   // booking in CONFIRMED or IN_PROGRESS as client
    | "active_booking_as_provider" // booking in CONFIRMED or IN_PROGRESS as provider
    | "unresolved_dispute"         // DISPUTED booking awaiting resolution
    | "pending_payout";            // provider has earnings not yet disbursed
  entityId: Types.ObjectId;
  description: string;
}

export interface AccountDeletionValidation {
  userId: Types.ObjectId;
  isEligible: boolean;
  blockers: AccountDeletionBlocker[];

  // Summary of what will happen if deletion proceeds
  deletionSummary: {
    hardDeleteCount: number;     // records to be permanently removed
    anonymiseCount: number;      // records to be stripped of PII and retained
    softDeleteCount: number;     // records to be flagged for deferred purge
    filesToRemove: number;       // files to be removed from storage
    roles: UserRole[];           // which role profiles will be affected
  };

  checkedAt: Date;
}

// ─── Deletion Event ───────────────────────────────────────────────────────────

export enum AccountDeletionStatus {
  PENDING    = "pending",    // request received, validation not yet run
  SCHEDULED  = "scheduled",  // validated, awaiting grace period expiry
  IN_PROGRESS = "in_progress",
  COMPLETED  = "completed",
  CANCELLED  = "cancelled",  // user cancelled within the grace period
  FAILED     = "failed",     // pipeline error — requires admin review
}

// Persisted record of the deletion pipeline run — never deleted itself.
export interface AccountDeletionEvent {
  _id: Types.ObjectId;
  userId: Types.ObjectId;           // will be nulled post-completion, keep a copy
  anonymisedIdentifier: string;     // e.g. "Deleted User #a3f9" — the replacement identity
  status: AccountDeletionStatus;

  validationSnapshot: AccountDeletionValidation;

  // Grace period — user can cancel within this window
  scheduledAt: Date;
  gracePeriodEndsAt: Date;  // deletion pipeline starts after this
  completedAt?: Date;

  // Per-entity result log
  cascadeResults: EntityDeletionResult[];

  // If the pipeline partially failed
  failedAt?: Date;
  failureReason?: string;
  requiresAdminReview?: boolean;

  // If admin triggered on behalf of user (GDPR request etc.)
  initiatedBy: "user" | "admin";
  adminId?: Types.ObjectId;
}

export interface EntityDeletionResult {
  collection: string;
  tier: DeletionTier;
  recordsAffected: number;
  status: "success" | "failed" | "skipped";
  error?: string;
}

// ─── Request / Response ───────────────────────────────────────────────────────

export interface RequestAccountDeletionBody {
  // User must explicitly confirm before the pipeline is scheduled
  confirmedDeletion: boolean;
  // Optional — surfaces in audit log and support cases
  reason?: string;
  password?: string;   // required for CREDENTIALS auth users as re-auth step
}

export interface AccountDeletionValidationResponse {
  success: boolean;
  message: string;
  validation?: AccountDeletionValidation;
  error?: string;
}

export interface AccountDeletionResponse {
  success: boolean;
  message: string;
  // Returns the grace period window so the client can show a countdown
  gracePeriodEndsAt?: Date;
  cancellationToken?: string;  // opaque token used to cancel within grace period
  error?: string;
}

export interface CancelAccountDeletionBody {
  cancellationToken: string;
}

export interface CancelAccountDeletionResponse {
  success: boolean;
  message: string;
  error?: string;
}