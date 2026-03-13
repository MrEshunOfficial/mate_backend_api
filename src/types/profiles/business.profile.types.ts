import { Types, Model, HydratedDocument } from "mongoose";
import { BaseEntity, ContactDetails, IdDetails, SoftDeletable } from "../base.types";
import { UserLocation } from "../location.types";

export interface ProviderProfile extends BaseEntity, SoftDeletable {
  profile: Types.ObjectId;

  businessName?: string;
  idDetails?: IdDetails;
  isCompanyTrained: boolean;
  serviceOfferings?: Types.ObjectId[];
  businessGalleryImages?: Types.ObjectId[];

  providerContactInfo: ContactDetails;
  locationData: UserLocation;

  isAlwaysAvailable: boolean;
  workingHours?: Record<string, { start: string; end: string }>;

  requireInitialDeposit: boolean;
  percentageDeposit?: number;
}

// ─── Instance Methods ─────────────────────────────────────────────────────────

export interface ProviderProfileMethods {
  softDelete(deletedBy?: Types.ObjectId): Promise<this>;
  restore(): Promise<this>;
}

export type ProviderProfileDocument = HydratedDocument<
  ProviderProfile,
  ProviderProfileMethods
>;

// ─── Static Methods ───────────────────────────────────────────────────────────

export interface ProviderProfileModel
  extends Model<ProviderProfile, {}, ProviderProfileMethods> {
  findActive(): Promise<ProviderProfileDocument[]>;
  findByLocation(region: string, city?: string): Promise<ProviderProfileDocument[]>;
  findByProfile(profileId: string): Promise<ProviderProfileDocument | null>;
  findByService(serviceId: string): Promise<ProviderProfileDocument[]>;
}

// ─── API Request / Response ───────────────────────────────────────────────────

export interface CreateProviderProfileRequestBody
  extends Omit<
    ProviderProfile,
    "_id" | "createdAt" | "updatedAt" | "isDeleted" | "deletedAt" | "deletedBy"
  > {}

export interface UpdateProviderProfileRequestBody
  extends Partial<
    Omit<
      ProviderProfile,
      "_id" | "createdAt" | "updatedAt" | "profile" | "isDeleted" | "deletedAt" | "deletedBy"
    >
  > {}

export interface ProviderProfileResponse {
  success: boolean;
  message: string;
  providerProfile?: Partial<ProviderProfile>;
  error?: string;
}

