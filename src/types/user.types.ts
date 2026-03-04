import { Types, Document } from "mongoose";
import { Request } from "express";
import { BaseEntity, SoftDeletable, SystemRole, AuthProvider } from "./base.types";
import { IUserProfile } from "./profiles/base.profile";

// ─── Security Tracking ────────────────────────────────────────────────────────

export interface UserSecurity {
  lastLogin?: Date;
  lastLoggedOut?: Date;
  passwordChangedAt?: Date;
}

// ─── Auth Shape ───────────────────────────────────────────────────────────────

// FIX: authProvider and authProviderId were two independent fields with no coupling.
// A credentials user having an authProviderId, or an OAuth user missing one, was
// both valid at the type level — which is wrong. Discriminated union fixes this.
type CredentialsAuth = {
  authProvider: AuthProvider.CREDENTIALS;
  authProviderId?: never;
};

type OAuthAuth = {
  authProvider:
    | AuthProvider.GOOGLE
    | AuthProvider.APPLE
    | AuthProvider.GITHUB
    | AuthProvider.FACEBOOK;
  authProviderId: string; // required for all OAuth providers
};

export type UserAuth = CredentialsAuth | OAuthAuth;

// ─── User Entity ──────────────────────────────────────────────────────────────

export interface IUser extends BaseEntity, SoftDeletable {
  name: string;
  email: string;
  password?: string;
  isEmailVerified: boolean;

  profileId?: Types.ObjectId;
  systemRole: SystemRole;
  systemAdminName?: string;

  // FIX: removed isAdmin and isSuperAdmin — both duplicate systemRole and will
  // silently drift. Derive at the call site instead:
  //   user.systemRole === SystemRole.ADMIN
  //   user.systemRole === SystemRole.SUPER_ADMIN

  verificationToken?: string;
  resetPasswordToken?: string;
  verificationExpires?: Date;
  resetPasswordExpires?: Date;
  refreshToken?: string;

  security: UserSecurity;
  authProvider: AuthProvider;
  authProviderId?: string;
}

// ─── Document Types ───────────────────────────────────────────────────────────

export interface IUserMethods {
  // FIX: was string — must match SoftDeletable.deletedBy: Types.ObjectId
  softDelete(deletedBy?: Types.ObjectId): Promise<IUserDocument>;
  restore(): Promise<IUserDocument>;
}

export interface IUserDocument extends IUser, IUserMethods, Document {
  // FIX: removed _id re-declaration — already inherited from BaseEntity
}

// Use when profileId has been populated from the DB
export interface IUserPopulated extends Omit<IUser, "profileId"> {
  profileId: IUserProfile;
}

export interface IUserDocumentPopulated
  extends IUserPopulated,
    IUserMethods,
    Document {}

// ─── OAuth ────────────────────────────────────────────────────────────────────

export interface GoogleAuthRequestBody {
  idToken: string;
}

export interface AppleAuthRequestBody {
  idToken: string;
  user?: {
    name?: {
      firstName: string;
      lastName: string;
    };
  };
}

export interface OAuthUserData {
  email: string;
  name: string;
  avatar?: string;
  providerId: string;
  // FIX: was a partial string union — now uses AuthProvider enum as the single
  // source of truth, consistent with IUser.authProvider
  provider: AuthProvider;
}

// ─── Request Bodies ───────────────────────────────────────────────────────────

export interface SignupRequestBody {
  name: string;
  email: string;
  password: string;
}

export interface LoginRequestBody {
  email: string;
  password: string;
}

export interface ResetPasswordRequestBody {
  email: string;
}

export interface VerifyEmailRequestBody {
  token: string;
}

export interface UpdatePasswordRequestBody {
  token: string;
  password: string;
}

export interface ResendVerificationRequestBody {
  email: string;
}

export interface UpdateProfileRequestBody {
  name?: string;
  profile?: Partial<IUserProfile>;
}

// FIX: was silently empty with no indication of intent
// TODO: define preference fields (e.g. notifications, language, theme)
export interface UpdateProfilePreferencesRequestBody {}

export interface LinkProviderRequestBody {
  // FIX: was a string union — scoped to OAuth-only providers via enum
  provider: AuthProvider.GOOGLE | AuthProvider.APPLE;
  idToken: string;
}

// ─── Request & Response ───────────────────────────────────────────────────────

// FIX: userId (string from JWT) and user (IUser document) could be set
// independently by different middlewares with no type-level guard.
// AuthenticatedRequest represents the unauthenticated/partial state.
// VerifiedRequest narrows to the guaranteed-populated state for protected routes.
export interface AuthenticatedRequest extends Request {
  // string is intentional — JWT payloads carry string IDs.
  // Cast to Types.ObjectId only at the DB query layer.
  userId?: string;
  user?: IUser;
  profile?: IUserProfile | null;
}

// Use this type inside route handlers that sit behind auth middleware
export interface VerifiedRequest extends AuthenticatedRequest {
  userId: string;
  user: IUser;
}

export interface AuthResponse {
  // FIX: missing success field — every other response shape in the codebase has it
  success: boolean;
  message: string;
  user?: Partial<IUser>;
  profile?: Partial<IUserProfile> | null;
  hasProfile?: boolean;
  token?: string;
  requiresVerification?: boolean;
  email?: string;
  error?: string;
}