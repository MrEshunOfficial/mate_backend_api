// models/domainProfile.model.ts
import mongoose, { Schema, Model, HydratedDocument, model } from "mongoose";
import { UserRole } from "../../types/base.types";
import { DomainProfile } from "../../types/profiles/base.profile";

// ─── Method Interfaces ────────────────────────────────────────────────────────

interface IDomainProfileMethods {
  softDelete(deletedBy?: mongoose.Types.ObjectId): Promise<DomainProfileDocument>;
  restore(): Promise<DomainProfileDocument>;
}

interface IDomainProfileModel extends Model<DomainProfile, {}, IDomainProfileMethods> {
  /**
   * Returns the single active DomainProfile for a user.
   * Only one profile can be active at a time — use this for all
   * runtime role resolution (e.g. "what role is this user currently in?").
   */
  findActiveByUserId(
    userId: string
  ): Promise<DomainProfileDocument | null>;

  /**
   * Returns ALL DomainProfile records for a user across all roles,
   * including deactivated ones. Used during role transitions to detect
   * whether an existing profile can be reactivated rather than created fresh.
   */
  findAllByUserId(userId: string): Promise<DomainProfileDocument[]>;

  /**
   * Returns the DomainProfile for a specific user + role combination.
   * Used to check whether a provider profile already exists before
   * deciding between "created" vs "reactivated" in RoleTransitionDataHandling.
   */
  findByUserAndRole(
    userId: string,
    role: UserRole
  ): Promise<DomainProfileDocument | null>;
}

type DomainProfileDocument = HydratedDocument<DomainProfile, IDomainProfileMethods>;

// ─── Schema ───────────────────────────────────────────────────────────────────

const domainProfileSchema = new Schema<
  DomainProfile,
  IDomainProfileModel,
  IDomainProfileMethods
>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId is required"],
      index: true,
    },

    // Points to either a ClientProfile._id or ProviderProfile._id.
    // role (below) discriminates which collection to query.
    profileId: {
      type: Schema.Types.ObjectId,
      required: [true, "profileId is required"],
      index: true,
    },

    // Required — without this field there is no way to know which collection
    // profileId resolves to (ClientProfile vs ProviderProfile).
    role: {
      type: String,
      enum: {
        values: Object.values(UserRole),
        message: "role must be customer or service_provider",
      },
      required: [true, "role is required"],
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    activatedAt: {
      type: Date,
      default: () => new Date(),
    },

    deactivatedAt: {
      type: Date,
      default: null,
    },

    // SoftDeletable
    isDeleted: { type: Boolean, default: false },
    deletedAt:  { type: Date, default: null },
    deletedBy:  { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    collection: "domainProfiles",
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

// Core lookup: "what role is this user currently in?"
domainProfileSchema.index({ userId: 1, isActive: 1 });

// Role-transition check: "does a provider profile already exist for this user?"
domainProfileSchema.index({ userId: 1, role: 1 });

// Full history scan
domainProfileSchema.index({ userId: 1, isDeleted: 1 });

// ─── Pre-save Hook ────────────────────────────────────────────────────────────

domainProfileSchema.pre("save", function (next) {
  if (this.isDeleted && !this.deletedAt) {
    this.deletedAt = new Date();
  }

  // Keep deactivatedAt in sync with isActive state
  if (!this.isActive && !this.deactivatedAt) {
    this.deactivatedAt = new Date();
  }
  if (this.isActive && this.deactivatedAt) {
    this.deactivatedAt = null as any;
  }

  next();
});

// Exclude soft-deleted records from all find queries by default.
domainProfileSchema.pre(/^find/, function (this: mongoose.Query<any, any>, next) {
  const options = this.getOptions();
  if (!options.includeSoftDeleted) {
    this.find({ isDeleted: { $ne: true } });
  }
  next();
});

// ─── Instance Methods ─────────────────────────────────────────────────────────

domainProfileSchema.methods.softDelete = function (
  this: DomainProfileDocument,
  deletedBy?: mongoose.Types.ObjectId
): Promise<DomainProfileDocument> {
  this.isDeleted  = true;
  this.deletedAt  = new Date();
  this.isActive   = false;
  if (deletedBy) this.deletedBy = deletedBy;
  return this.save();
};

domainProfileSchema.methods.restore = function (
  this: DomainProfileDocument
): Promise<DomainProfileDocument> {
  this.isDeleted  = false;
  this.deletedAt  = undefined as any;
  this.deletedBy  = undefined as any;
  return this.save();
};

// ─── Static Methods ───────────────────────────────────────────────────────────

domainProfileSchema.statics.findActiveByUserId = function (
  userId: string
): Promise<DomainProfileDocument | null> {
  return this.findOne({ userId, isActive: true, isDeleted: false });
};

domainProfileSchema.statics.findAllByUserId = function (
  userId: string
): Promise<DomainProfileDocument[]> {
  return (this as any).find({ userId }, null, { includeSoftDeleted: true });
};

domainProfileSchema.statics.findByUserAndRole = function (
  userId: string,
  role: UserRole
): Promise<DomainProfileDocument | null> {
  return (this as any).findOne({ userId, role }, null, { includeSoftDeleted: true });
};

// ─── Model ────────────────────────────────────────────────────────────────────

export const DomainProfileModel = model<DomainProfile, IDomainProfileModel>(
  "DomainProfile",
  domainProfileSchema
);

export default DomainProfileModel;