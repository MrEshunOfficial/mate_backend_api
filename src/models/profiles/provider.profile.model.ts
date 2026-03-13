// models/providerProfile.model.ts
import mongoose, { Schema, model, HydratedDocument } from "mongoose";
import { ProviderProfile, ProviderProfileMethods, ProviderProfileModel as IProviderProfileModel } from "../../types/profiles/business.profile.types";

type ProviderProfileDocument = HydratedDocument<ProviderProfile, ProviderProfileMethods>;

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const coordinatesSchema = new Schema(
  {
    latitude:  { type: Number, required: true },
    longitude: { type: Number, required: true },
  },
  { _id: false }
);

const userLocationSchema = new Schema(
  {
    // Not required at schema level — populated during provider onboarding,
    // not at role-transition time. Enforce completeness at the service layer
    // (e.g. prevent going live until ghanaPostGPS is filled in).
    ghanaPostGPS:      { type: String, trim: true },
    nearbyLandmark:    { type: String, trim: true },
    region:            { type: String, trim: true },
    city:              { type: String, trim: true },
    district:          { type: String, trim: true },
    locality:          { type: String, trim: true },
    streetName:        { type: String, trim: true },
    houseNumber:       { type: String, trim: true },
    gpsCoordinates:    { type: coordinatesSchema },
    isAddressVerified: { type: Boolean, default: false },
    sourceProvider: {
      type: String,
      enum: ["openstreetmap", "google", "ghanapost"],
    },
    createdAt: { type: Date },
    updatedAt: { type: Date },
  },
  { _id: false }
);

const idDetailsSchema = new Schema(
  {
    idType: {
      type: String,
      enum: ["national_id", "passport", "voters_id", "drivers_license", "nhis", "other"],
      required: true,
    },
    idNumber:    { type: String, required: true, trim: true },
    fileImageId: [{ type: Schema.Types.ObjectId, ref: "File" }],
  },
  { _id: false }
);

const contactDetailsSchema = new Schema(
  {
    // Not required at schema level — populated during provider onboarding,
    // not at role-transition time. Enforce completeness at the service layer.
    primaryContact:   { type: String, trim: true },
    secondaryContact: { type: String, trim: true },
    businessContact:  { type: String, trim: true },
    businessEmail:    { type: String, trim: true, lowercase: true },
  },
  { _id: false }
);

// Working hours: keyed by day name e.g. "monday" → { start: "09:00", end: "17:00" }
// Mongoose does not support Record<string, ...> directly — use Schema.Types.Mixed
// and validate at the service layer.
const workingHoursSchema = new Schema(
  {},
  { _id: false, strict: false }
);

// ─── Main Schema ──────────────────────────────────────────────────────────────

const providerProfileSchema = new Schema<
  ProviderProfile,
  IProviderProfileModel,
  ProviderProfileMethods
>(
  {
    // Link up the profile chain: IUser → IUserProfile → DomainProfile → ProviderProfile
    profile: {
      type: Schema.Types.ObjectId,
      ref: "UserProfile",
      required: [true, "profile reference is required"],
      index: true,
    },

    businessName: {
      type: String,
      trim: true,
      maxlength: [100, "Business name cannot exceed 100 characters"],
    },

    idDetails: { type: idDetailsSchema },

    isCompanyTrained: {
      type: Boolean,
      required: true,
      default: false,
    },

    serviceOfferings: [{ type: Schema.Types.ObjectId, ref: "Service" }],

    businessGalleryImages: [{ type: Schema.Types.ObjectId, ref: "File" }],

    // Not required at the top-level schema — a provider profile scaffold is
    // created during role transition before contact info is known. The
    // application layer must enforce completeness before the profile goes live.
    providerContactInfo: {
      type: contactDetailsSchema,
    },

    // Same reasoning as providerContactInfo above.
    locationData: {
      type: userLocationSchema,
    },

    isAlwaysAvailable: {
      type: Boolean,
      default: false,
    },

    // Stored as a flexible mixed object keyed by day name.
    // e.g. { monday: { start: "09:00", end: "17:00" }, tuesday: ... }
    workingHours: {
      type: workingHoursSchema,
    },

    requireInitialDeposit: {
      type: Boolean,
      default: false,
    },

    percentageDeposit: {
      type: Number,
      min: [0, "Deposit percentage cannot be negative"],
      max: [100, "Deposit percentage cannot exceed 100"],
      validate: {
        validator: function (this: ProviderProfile, value: number) {
          // Only meaningful when requireInitialDeposit is true
          return !this.requireInitialDeposit || (value > 0 && value <= 100);
        },
        message: "percentageDeposit must be between 1 and 100 when requireInitialDeposit is true",
      },
    },

    // SoftDeletable
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt:  { type: Date, default: null },
    deletedBy:  { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    collection: "providerProfiles",
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

providerProfileSchema.index({ profile: 1, isDeleted: 1 });
providerProfileSchema.index({ "locationData.region": 1, "locationData.city": 1 });
providerProfileSchema.index({ "locationData.gpsCoordinates": "2dsphere" }, { sparse: true });
providerProfileSchema.index({ serviceOfferings: 1 });
providerProfileSchema.index({ businessName: "text" });

// ─── Pre-save Hook ────────────────────────────────────────────────────────────

providerProfileSchema.pre("save", function (next) {
  if (this.isDeleted && !this.deletedAt) {
    this.deletedAt = new Date();
  }
  // If deposit is not required, clear the percentage to avoid stale data
  if (!this.requireInitialDeposit) {
    this.percentageDeposit = undefined;
  }
  next();
});

// Exclude soft-deleted records from all find queries by default.
providerProfileSchema.pre(/^find/, function (this: mongoose.Query<any, any>, next) {
  const options = this.getOptions();
  if (!options.includeSoftDeleted) {
    this.find({ isDeleted: { $ne: true } });
  }
  next();
});

// ─── Instance Methods ─────────────────────────────────────────────────────────

providerProfileSchema.methods.softDelete = function (
  this: ProviderProfileDocument,
  deletedBy?: mongoose.Types.ObjectId
): Promise<ProviderProfileDocument> {
  this.isDeleted = true;
  this.deletedAt = new Date();
  if (deletedBy) this.deletedBy = deletedBy;
  return this.save();
};

providerProfileSchema.methods.restore = function (
  this: ProviderProfileDocument
): Promise<ProviderProfileDocument> {
  this.isDeleted = false;
  this.deletedAt = undefined as any;
  this.deletedBy = undefined as any;
  return this.save();
};

// ─── Static Methods ───────────────────────────────────────────────────────────

providerProfileSchema.statics.findActive = function () {
  return this.find({ isDeleted: false });
};

providerProfileSchema.statics.findByProfile = function (profileId: string) {
  return this.findOne({ profile: profileId, isDeleted: false });
};

providerProfileSchema.statics.findByLocation = function (region: string, city?: string) {
  const query: Record<string, any> = {
    "locationData.region": region,
    isDeleted: false,
  };
  if (city) {
    query["locationData.city"] = city;
  }
  return this.find(query);
};

providerProfileSchema.statics.findByService = function (serviceId: string) {
  return this.find({
    serviceOfferings: new mongoose.Types.ObjectId(serviceId),
    isDeleted: false,
  });
};

// ─── Model ────────────────────────────────────────────────────────────────────

export const ProviderProfileModel = model<ProviderProfile, IProviderProfileModel>(
  "ProviderProfile",
  providerProfileSchema
);

export default ProviderProfileModel;