import { Schema, model, Model, HydratedDocument } from "mongoose";
import { IUserProfile } from "../../types/profiles/base.profile";
import { UserRole } from "../../types/base.types";

// ─── Method Interfaces ────────────────────────────────────────────────────────

interface IUserProfileMethods {
  softDelete(): Promise<HydratedDocument<IUserProfile, IUserProfileMethods>>;
  restore(): Promise<HydratedDocument<IUserProfile, IUserProfileMethods>>;
}

interface IUserProfileModel
  extends Model<IUserProfile, {}, IUserProfileMethods> {
  findActiveByUserId(
    userId: string
  ): Promise<HydratedDocument<IUserProfile, IUserProfileMethods> | null>;

  findWithDetails(
    userId: string
  ): Promise<HydratedDocument<IUserProfile, IUserProfileMethods> | null>;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const userProfileSchema = new Schema<
  IUserProfile,
  IUserProfileModel,
  IUserProfileMethods
>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    // FIX: enum must be Object.values(UserRole) — Mongoose needs an array of
    // string values, not the enum object itself.
    role: {
      type: String,
      enum: {
        values: Object.values(UserRole),
        message: "role must be customer or service_provider",
      },
      required: [true, "role is required"],
      default: UserRole.CUSTOMER,
    },

    bio: {
      type: String,
      trim: true,
      maxlength: [500, "Bio cannot exceed 500 characters"],
    },

    mobileNumber: {
      type: String,
      trim: true,
      validate: {
        validator: (v: string) =>
          !v ||
          /^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,9}$/.test(v),
        message: (props: { value: string }) =>
          `${props.value} is not a valid phone number`,
      },
    },

    profilePictureId: {
      type: Schema.Types.ObjectId,
      ref: "File",
      index: true,
    },

    // FIX: lastModified removed — BaseEntity.updatedAt (set by { timestamps: true })
    // already tracks the last modification time. Two fields for the same concept
    // will silently drift.

    // Soft delete
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,       // provides createdAt + updatedAt (= BaseEntity)
    collection: "userProfiles",
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

userProfileSchema.index({ userId: 1, isDeleted: 1 });
userProfileSchema.index({ profilePictureId: 1 }, { sparse: true });

// ─── Pre-save Hook ────────────────────────────────────────────────────────────

// FIX: next() was commented out — every save would hang indefinitely.
userProfileSchema.pre("save", function (next) {
  if (this.isDeleted && !this.deletedAt) {
    this.deletedAt = new Date();
  }
  next();
});

// FIX: next() was commented out — every findOneAndUpdate would hang indefinitely.
userProfileSchema.pre("findOneAndUpdate", function (next) {
  // updatedAt is handled automatically by { timestamps: true }
  next();
});

// ─── Instance Methods ─────────────────────────────────────────────────────────

userProfileSchema.method("softDelete", async function (
  this: HydratedDocument<IUserProfile, IUserProfileMethods>
) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  return this.save();
});

userProfileSchema.method("restore", async function (
  this: HydratedDocument<IUserProfile, IUserProfileMethods>
) {
  this.isDeleted = false;
  this.deletedAt = undefined;
  this.deletedBy = undefined;
  return this.save();
});

// ─── Static Methods ───────────────────────────────────────────────────────────

userProfileSchema.static(
  "findActiveByUserId",
  function (userId: string) {
    return this.findOne({ userId, isDeleted: false });
  }
);

userProfileSchema.static(
  "findWithDetails",
  function (userId: string) {
    return this.findOne({ userId, isDeleted: false })
      .populate("userId", "name email")           // IUser.name — not firstName/lastName
      .populate("profilePictureId", "url thumbnailUrl uploadedAt");
  }
);

// ─── Virtuals ─────────────────────────────────────────────────────────────────

// FIX: previous virtual referenced user.firstName / user.lastName which don't
// exist on IUser — IUser only has a single `name` field.
userProfileSchema.virtual("displayName").get(function () {
  if (this.populated("userId")) {
    const user = this.userId as any;
    return user.name ?? undefined;
  }
  return undefined;
});

userProfileSchema.set("toJSON", {
  virtuals: true,
  transform: (_doc, ret: any) => {
    delete ret.__v;
    return ret;
  },
});

userProfileSchema.set("toObject", { virtuals: true });

// ─── Model ────────────────────────────────────────────────────────────────────

export const ProfileModel = model<IUserProfile, IUserProfileModel>(
  "UserProfile",
  userProfileSchema
);

export default ProfileModel;