// models/clientProfile.model.ts
import mongoose, { Schema, model, Model, HydratedDocument } from "mongoose";
import { ClientProfile, ClientProfileMethods, ClientProfileModel as IClientProfileModel } from "../../types/profiles/client.profile.types";

type ClientProfileDocument = HydratedDocument<ClientProfile, ClientProfileMethods>;

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

// Reuses the UserLocation shape — defined inline to avoid circular imports
const coordinatesSchema = new Schema(
  {
    latitude:  { type: Number, required: true },
    longitude: { type: Number, required: true },
  },
  { _id: false }
);

const userLocationSchema = new Schema(
  {
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

const communicationPreferencesSchema = new Schema(
  {
    emailNotifications: { type: Boolean, default: true },
    smsNotifications:   { type: Boolean, default: false },
    pushNotifications:  { type: Boolean, default: true },
  },
  { _id: false }
);

const preferencesSchema = new Schema(
  {
    preferredCategories:      [{ type: Schema.Types.ObjectId, ref: "Category" }],
    communicationPreferences: { type: communicationPreferencesSchema, default: () => ({}) },
    languagePreference:       { type: String, trim: true, default: "en" },
  },
  { _id: false }
);

const savedPaymentMethodSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["mobile_money", "card", "bank_account"],
      required: true,
    },
    provider:  { type: String, trim: true },
    isDefault: { type: Boolean, default: false },
    label:     { type: String, trim: true },
  },
  { _id: false }
);

const verificationDetailsSchema = new Schema(
  {
    phoneVerified: { type: Boolean, default: false },
    emailVerified: { type: Boolean, default: false },
    idVerified:    { type: Boolean, default: false },
    verifiedAt:    { type: Date },
  },
  { _id: false }
);

const emergencyContactSchema = new Schema(
  {
    name:         { type: String, required: true, trim: true },
    relationship: { type: String, required: true, trim: true },
    phoneNumber:  { type: String, required: true, trim: true },
  },
  { _id: false }
);

const clientContactInfoSchema = new Schema(
  {
    // Not required at schema level — a client profile scaffold is created
    // during role transition (and initial signup) before contact info is
    // known. The application layer must enforce completeness before the
    // profile goes live (e.g. via isProfileLive() or equivalent gate).
    primaryContact:   { type: String, trim: true },
    secondaryContact: { type: String, trim: true },
    businessContact:  { type: String, trim: true },
    businessEmail:    { type: String, trim: true, lowercase: true },
    whatsappContact:  { type: String, trim: true },
  },
  { _id: false }
);

// ─── Main Schema ──────────────────────────────────────────────────────────────

const clientProfileSchema = new Schema<
  ClientProfile,
  IClientProfileModel,
  ClientProfileMethods
>(
  {
    // Link up the profile chain: IUser → IUserProfile → DomainProfile → ClientProfile
    profile: {
      type: Schema.Types.ObjectId,
      ref: "UserProfile",
      required: [true, "profile reference is required"],
      index: true,
    },

    preferredName: { type: String, trim: true, maxlength: 50 },
    dateOfBirth:   { type: Date },
    idDetails:     { type: idDetailsSchema },

    // Not required at the top-level schema — a client profile scaffold is
    // created during role transition before contact info is known. The
    // application layer must enforce completeness before the profile goes live.
    clientContactInfo: {
      type:    clientContactInfoSchema,
      default: () => ({}),
    },

    savedAddresses:     { type: [userLocationSchema], default: [] },
    defaultAddressIndex: {
      type: Number,
      default: 0,
      min: 0,
    },

    preferences: { type: preferencesSchema, default: () => ({}) },

    favoriteServices:  [{ type: Schema.Types.ObjectId, ref: "Service" }],
    favoriteProviders: [{ type: Schema.Types.ObjectId, ref: "ProviderProfile" }],
    serviceHistory:    [{ type: Schema.Types.ObjectId, ref: "Booking" }],

    savedPaymentMethods: { type: [savedPaymentMethodSchema], default: [] },

    isVerified: { type: Boolean, default: false, index: true },

    verificationDetails: {
      type: verificationDetailsSchema,
      default: () => ({
        phoneVerified: false,
        emailVerified: false,
        idVerified:    false,
      }),
    },

    emergencyContact: { type: emergencyContactSchema },

    // SoftDeletable
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt:  { type: Date, default: null },
    deletedBy:  { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    collection: "clientProfiles",
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

clientProfileSchema.index({ profile: 1, isDeleted: 1 });
clientProfileSchema.index({ "clientContactInfo.primaryContact": 1 });
clientProfileSchema.index({ favoriteServices: 1 });
clientProfileSchema.index({ favoriteProviders: 1 });
clientProfileSchema.index({ "verificationDetails.idVerified": 1, isVerified: 1 });
clientProfileSchema.index({ "savedAddresses.region": 1, "savedAddresses.city": 1 });

// ─── Pre-save Hook ────────────────────────────────────────────────────────────

clientProfileSchema.pre("save", function (next) {
  if (this.isDeleted && !this.deletedAt) {
    this.deletedAt = new Date();
  }
  next();
});

// Exclude soft-deleted records from all find queries by default.
clientProfileSchema.pre(/^find/, function (this: mongoose.Query<any, any>, next) {
  const options = this.getOptions();
  if (!options.includeSoftDeleted) {
    this.find({ isDeleted: { $ne: true } });
  }
  next();
});

// ─── Instance Methods ─────────────────────────────────────────────────────────

clientProfileSchema.methods.softDelete = function (
  this: ClientProfileDocument,
  deletedBy?: mongoose.Types.ObjectId
): Promise<ClientProfileDocument> {
  this.isDeleted = true;
  this.deletedAt = new Date();
  if (deletedBy) this.deletedBy = deletedBy;
  return this.save();
};

clientProfileSchema.methods.restore = function (
  this: ClientProfileDocument
): Promise<ClientProfileDocument> {
  this.isDeleted = false;
  this.deletedAt = undefined as any;
  this.deletedBy = undefined as any;
  return this.save();
};

clientProfileSchema.methods.addFavoriteService = function (
  this: ClientProfileDocument,
  serviceId: mongoose.Types.ObjectId
): Promise<ClientProfileDocument> {
  const exists = this.favoriteServices?.some(
    (id) => id.toString() === serviceId.toString()
  );
  if (!exists) {
    if (!this.favoriteServices) this.favoriteServices = [];
    this.favoriteServices.push(serviceId);
  }
  return this.save();
};

clientProfileSchema.methods.removeFavoriteService = function (
  this: ClientProfileDocument,
  serviceId: mongoose.Types.ObjectId
): Promise<ClientProfileDocument> {
  if (this.favoriteServices) {
    this.favoriteServices = this.favoriteServices.filter(
      (id) => id.toString() !== serviceId.toString()
    ) as any;
  }
  return this.save();
};

clientProfileSchema.methods.addFavoriteProvider = function (
  this: ClientProfileDocument,
  providerId: mongoose.Types.ObjectId
): Promise<ClientProfileDocument> {
  const exists = this.favoriteProviders?.some(
    (id) => id.toString() === providerId.toString()
  );
  if (!exists) {
    if (!this.favoriteProviders) this.favoriteProviders = [];
    this.favoriteProviders.push(providerId);
  }
  return this.save();
};

clientProfileSchema.methods.removeFavoriteProvider = function (
  this: ClientProfileDocument,
  providerId: mongoose.Types.ObjectId
): Promise<ClientProfileDocument> {
  if (this.favoriteProviders) {
    this.favoriteProviders = this.favoriteProviders.filter(
      (id) => id.toString() !== providerId.toString()
    ) as any;
  }
  return this.save();
};

clientProfileSchema.methods.addSavedAddress = function (
  this: ClientProfileDocument,
  address: any
): Promise<ClientProfileDocument> {
  if (!this.savedAddresses) this.savedAddresses = [];
  this.savedAddresses.push(address);
  return this.save();
};

clientProfileSchema.methods.removeSavedAddress = function (
  this: ClientProfileDocument,
  addressIndex: number
): Promise<ClientProfileDocument> {
  if (this.savedAddresses && addressIndex >= 0 && addressIndex < this.savedAddresses.length) {
    this.savedAddresses.splice(addressIndex, 1);
    // Adjust defaultAddressIndex if needed
    if (this.defaultAddressIndex && this.defaultAddressIndex >= this.savedAddresses.length) {
      this.defaultAddressIndex = Math.max(0, this.savedAddresses.length - 1);
    }
  }
  return this.save();
};

clientProfileSchema.methods.setDefaultAddress = function (
  this: ClientProfileDocument,
  addressIndex: number
): Promise<ClientProfileDocument> {
  if (!this.savedAddresses || addressIndex < 0 || addressIndex >= this.savedAddresses.length) {
    return Promise.reject(new Error("Invalid address index"));
  }
  this.defaultAddressIndex = addressIndex;
  return this.save();
};

// ─── Static Methods ───────────────────────────────────────────────────────────

clientProfileSchema.statics.findActive = function () {
  return this.find({ isDeleted: false });
};

clientProfileSchema.statics.findByProfile = function (profileId: string) {
  return this.findOne({ profile: profileId, isDeleted: false });
};

clientProfileSchema.statics.findByLocation = function (region: string, city?: string) {
  const query: Record<string, any> = {
    "savedAddresses.region": region,
    isDeleted: false,
  };
  if (city) {
    query["savedAddresses.city"] = city;
  }
  return this.find(query);
};

clientProfileSchema.statics.findByFavoriteService = function (serviceId: string) {
  return this.find({
    favoriteServices: new mongoose.Types.ObjectId(serviceId),
    isDeleted: false,
  });
};

clientProfileSchema.statics.findVerified = function () {
  return this.find({ isVerified: true, isDeleted: false });
};

// ─── Model ────────────────────────────────────────────────────────────────────

export const ClientProfileModel = model<ClientProfile, IClientProfileModel>(
  "ClientProfile",
  clientProfileSchema
);

export default ClientProfileModel;