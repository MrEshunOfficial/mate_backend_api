import { Types, Model, HydratedDocument } from "mongoose";
import { BaseEntity, IdDetails, SoftDeletable, ContactDetails } from "../base.types";
import { UserLocation } from "../location.types";

export interface ClientContactDetails extends ContactDetails {
  whatsappContact?: string;
}

export interface ClientProfile extends BaseEntity, SoftDeletable {
  profile: Types.ObjectId;
  preferredName?: string;
  dateOfBirth?: Date;
  idDetails?: IdDetails;

  clientContactInfo: ClientContactDetails;
  savedAddresses?: UserLocation[];
  defaultAddressIndex?: number;

  preferences?: {
    preferredCategories?: Types.ObjectId[];
    communicationPreferences?: {
      emailNotifications: boolean;
      smsNotifications: boolean;
      pushNotifications: boolean;
    };
    languagePreference?: string;
  };

  favoriteServices?: Types.ObjectId[];
  favoriteProviders?: Types.ObjectId[];
  serviceHistory?: Types.ObjectId[];   // Booking refs

  savedPaymentMethods?: Array<{
    type: "mobile_money" | "card" | "bank_account";
    provider?: string;
    isDefault: boolean;
    label?: string;
  }>;

  isVerified: boolean;
  verificationDetails?: {
    phoneVerified: boolean;
    emailVerified: boolean;
    idVerified: boolean;
    verifiedAt?: Date;
  };

  emergencyContact?: {
    name: string;
    relationship: string;
    phoneNumber: string;
  };
}

// ─── Instance Methods ─────────────────────────────────────────────────────────

export interface ClientProfileMethods {
  softDelete(deletedBy?: Types.ObjectId): Promise<this>;
  restore(): Promise<this>;
  addFavoriteService(serviceId: Types.ObjectId): Promise<this>;
  removeFavoriteService(serviceId: Types.ObjectId): Promise<this>;
  addFavoriteProvider(providerId: Types.ObjectId): Promise<this>;
  removeFavoriteProvider(providerId: Types.ObjectId): Promise<this>;
  setDefaultAddress(addressIndex: number): Promise<this>;
  addSavedAddress(address: UserLocation): Promise<this>;
  removeSavedAddress(addressIndex: number): Promise<this>;
}

// ─── Static Methods ───────────────────────────────────────────────────────────

export interface ClientProfileModel
  extends Model<ClientProfile, {}, ClientProfileMethods> {
  findActive(): Promise<ClientProfileDocument[]>;
  findByProfile(profileId: string): Promise<ClientProfileDocument | null>;
  findByLocation(region: string, city?: string): Promise<ClientProfileDocument[]>;
  findByFavoriteService(serviceId: string): Promise<ClientProfileDocument[]>;
  findVerified(): Promise<ClientProfileDocument[]>;
}

export type ClientProfileDocument = HydratedDocument<
  ClientProfile,
  ClientProfileMethods
>;

// ─── API Request / Response ───────────────────────────────────────────────────

// SoftDeletable fields excluded — clients must not set delete state on creation
export interface CreateClientProfileRequestBody
  extends Omit<
    ClientProfile,
    "_id" | "createdAt" | "updatedAt" | "isDeleted" | "deletedAt" | "deletedBy"
  > {}

export interface UpdateClientProfileRequestBody
  extends Partial<
    Omit<
      ClientProfile,
      "_id" | "createdAt" | "updatedAt" | "profile" | "isDeleted" | "deletedAt" | "deletedBy"
    >
  > {}

export interface ClientProfileResponse {
  success: boolean;
  message: string;
  clientProfile?: Partial<ClientProfile>;
  error?: string;
}

export interface ManageFavoritesRequestBody {
  serviceId?: string;
  providerId?: string;
  action: "add" | "remove";
}

export interface ManageAddressRequestBody {
  address?: UserLocation;
  addressIndex?: number;
  action: "add" | "remove" | "set_default";
}

export interface UpdateCommunicationPreferencesRequestBody {
  emailNotifications?: boolean;
  smsNotifications?: boolean;
  pushNotifications?: boolean;
}

export interface AddPaymentMethodRequestBody {
  type: "mobile_money" | "card" | "bank_account";
  provider?: string;
  isDefault: boolean;
  label?: string;
}

export interface ClientProfileDetailedResponse extends ClientProfileResponse {
  favoriteServicesCount?: number;
  favoriteProvidersCount?: number;
  totalBookings?: number;
  verificationStatus?: {
    phoneVerified: boolean;
    emailVerified: boolean;
    idVerified: boolean;
    overallVerified: boolean;
  };
}

