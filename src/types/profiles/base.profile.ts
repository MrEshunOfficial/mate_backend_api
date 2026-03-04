import { Types } from "mongoose";
import { BaseEntity, SoftDeletable, UserRole } from "../base.types";

// NOTE: IUser is intentionally NOT imported here.
// user.types.ts imports IUserProfile from this file — importing IUser back
// would create a circular dependency. ProfileResponse carries only profile
// data; AuthResponse in user.types.ts is the shape that combines both.

// ─── Base Profile ─────────────────────────────────────────────────────────────

export interface IUserProfile extends BaseEntity, SoftDeletable {
  userId: Types.ObjectId;

  // FIX: was optional — a profile with no role is ambiguous in this system.
  // Every profile is either a CUSTOMER or a PROVIDER; there is no in-between.
  role: UserRole;

  bio?: string;
  mobileNumber?: string;
  profilePictureId?: Types.ObjectId;

  // FIX: removed lastModified — BaseEntity.updatedAt already tracks this.
  // Two fields for the same concept will drift.
}

// ─── Domain Profile Link ──────────────────────────────────────────────────────

// DomainProfile is the bridge between IUserProfile and the role-specific
// profile document (ClientProfile or ProviderProfile).
// Chain: IUser → IUserProfile → DomainProfile → ClientProfile | ProviderProfile

// A user can hold multiple DomainProfile records — one per role they have
// ever registered. Only one is active at a time. This supports role transitions
// (provider → client) without destroying existing provider data: the provider
// DomainProfile is deactivated and a client one is created or reactivated.
//
// Query pattern:
//   Active profile  → findOne({ userId, isActive: true })
//   All profiles    → find({ userId })  ← includes deactivated history
export interface DomainProfile extends BaseEntity, SoftDeletable {
  userId: Types.ObjectId;
  profileId: Types.ObjectId; // → ClientProfile._id or ProviderProfile._id

  // FIX: role was missing — without it there is no way to know which collection
  // profileId points to. Same polymorphic reference problem fixed in IFile.
  role: UserRole;

  isActive: boolean;
  activatedAt?: Date;
  deactivatedAt?: Date;
}

// ─── Request Bodies ───────────────────────────────────────────────────────────

export interface CreateProfileRequestBody
  extends Omit<
    IUserProfile,
    // FIX: was only omitting userId/_id/createdAt/updatedAt, leaving
    // isDeleted, deletedAt, deletedBy accessible on the create body
    | "_id"
    | "userId"
    | "createdAt"
    | "updatedAt"
    | "isDeleted"
    | "deletedAt"
    | "deletedBy"
  > {}

export interface UpdateProfileRequestBody
  extends Partial<
    Omit<
      IUserProfile,
      | "_id"
      | "userId"
      | "role"       // role is set at creation and must not change
      | "createdAt"
      | "updatedAt"
      | "isDeleted"
      | "deletedAt"
      | "deletedBy"
    >
  > {}

// ─── Response Types ───────────────────────────────────────────────────────────

export interface ProfileResponse {
  // FIX: missing success field — inconsistent with every other response shape
  success: boolean;
  message: string;
  profile?: Partial<IUserProfile>;
  // FIX: removed user?: Partial<IUser> — importing IUser here creates a circular
  // dependency (user.types ← profile.types ← user.types).
  // Use AuthResponse from user.types.ts wherever both user + profile are needed.
  error?: string;
}