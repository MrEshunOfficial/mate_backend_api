import mongoose, { Schema, Model, Types } from "mongoose";
import { IUser, IUserDocument } from "../../types/user.types";
import { AuthProvider, SystemRole } from "../../types/base.types";

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const userSecuritySchema = new Schema(
  {
    lastLogin: { type: Date },
    lastLoggedOut: { type: Date },
    passwordChangedAt: { type: Date },
  },
  { _id: false }
);

// ─── User Schema ──────────────────────────────────────────────────────────────

const userSchema = new Schema<IUserDocument>(
  {
    // ── Basic Info ────────────────────────────────────────────────────────────
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters long"],
      maxlength: [50, "Name cannot exceed 50 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        "Please provide a valid email address",
      ],
    },
    // Required for CREDENTIALS users only — conditional validation in pre-save
    password: {
      type: String,
      required: function (this: IUser) {
        return this.authProvider === AuthProvider.CREDENTIALS;
      },
      minlength: [6, "Password must be at least 6 characters long"],
      select: false,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },

    // ── Roles & Identity ──────────────────────────────────────────────────────
    // isAdmin / isSuperAdmin removed — derive at call site via systemRole:
    //   systemRole === SystemRole.ADMIN
    //   systemRole === SystemRole.SUPER_ADMIN
    systemRole: {
      type: String,
      enum: {
        values: Object.values(SystemRole),
        message: "systemRole must be user, admin, or super_admin",
      },
      default: SystemRole.USER,
    },
    systemAdminName: {
      type: String,
      default: null,
      trim: true,
    },
    profileId: {
      type: Schema.Types.ObjectId,
      ref: "UserProfile",
    },

    // ── Auth Provider ─────────────────────────────────────────────────────────
    authProvider: {
      type: String,
      enum: {
        values: Object.values(AuthProvider),
        message: "authProvider must be one of: credentials, google, apple, github, facebook",
      },
      default: AuthProvider.CREDENTIALS,
    },
    authProviderId: {
      type: String,
      sparse: true,
    },

    // ── Security Tokens (excluded from default queries) ───────────────────────
    verificationToken: { type: String, select: false },
    resetPasswordToken: { type: String, select: false },
    verificationExpires: { type: Date, select: false },
    resetPasswordExpires: { type: Date, select: false },
    refreshToken: { type: String, select: false },

    // ── Security Tracking ─────────────────────────────────────────────────────
    security: {
      type: userSecuritySchema,
      required: true,
      default: () => ({}),
    },

    // ── Soft Delete ───────────────────────────────────────────────────────────
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ verificationToken: 1 });
userSchema.index({ resetPasswordToken: 1 });
userSchema.index({ authProvider: 1, authProviderId: 1 }, { sparse: true });
userSchema.index({ systemRole: 1 });
userSchema.index({ isDeleted: 1 });
userSchema.index({ createdAt: 1 });
userSchema.index({ "security.lastLogin": 1 });
userSchema.index({ authProvider: 1, email: 1 });
userSchema.index({ systemRole: 1, isDeleted: 1 });
userSchema.index({ isDeleted: 1, isEmailVerified: 1 });

// ─── Pre-save Hooks ───────────────────────────────────────────────────────────

userSchema.pre("save", function (next) {
  // OAuth users are always considered email-verified
  if (this.authProvider !== AuthProvider.CREDENTIALS) {
    this.isEmailVerified = true;
  }

  // Track password change timestamp
  if (this.isModified("password")) {
    this.security.passwordChangedAt = new Date();
  }

  // Stamp deletedAt when soft-deleting for the first time
  if (this.isDeleted && !this.deletedAt) {
    this.deletedAt = new Date();
  }

  next();
});

// Exclude soft-deleted documents from all find queries by default.
// Pass { includeSoftDeleted: true } via query options to bypass.
userSchema.pre(/^find/, function (this: mongoose.Query<any, any>, next) {
  const options = this.getOptions();
  if (!options.includeSoftDeleted) {
    this.find({ isDeleted: { $ne: true } });
  }
  next();
});

// ─── Instance Methods ─────────────────────────────────────────────────────────

userSchema.methods.softDelete = function (
  this: IUserDocument,
  deletedBy?: Types.ObjectId
): Promise<IUserDocument> {
  this.isDeleted = true;
  this.deletedAt = new Date();
  if (deletedBy) {
    this.deletedBy = deletedBy;
  }
  return this.save();
};

userSchema.methods.restore = function (
  this: IUserDocument
): Promise<IUserDocument> {
  this.isDeleted = false;
  this.deletedAt = undefined;
  this.deletedBy = undefined;
  return this.save();
};

// ─── Model ────────────────────────────────────────────────────────────────────

type UserModel = Model<IUserDocument>;

export const User: UserModel = mongoose.model<IUserDocument>(
  "User",
  userSchema
);