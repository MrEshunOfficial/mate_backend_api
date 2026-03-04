import { Types, Model, HydratedDocument } from "mongoose";
import { BaseEntity, SoftDeletable } from "./base.types";

export interface Service extends BaseEntity, SoftDeletable {
  title: string;
  description: string;
  slug: string;
  tags: string[];
  categoryId: Types.ObjectId;
  coverImage?: Types.ObjectId;

  // A service belongs to exactly one provider — required, never optional
  providerId: Types.ObjectId;

  servicePricing?: {
    serviceBasePrice: number;
    includeTravelFee: boolean;
    includeAdditionalFees: boolean;
    currency: string;
    platformCommissionRate: number;  // e.g. 0.20 for 20%
    providerEarnings: number;        // auto-calculated
  };

  isPrivate: boolean;

  // Moderation
  submittedBy?: Types.ObjectId;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  rejectedAt?: Date;
  rejectionReason?: string;
  isActive?: boolean;
}

export interface ServiceMethods {
  softDelete(deletedBy?: Types.ObjectId): Promise<this>;
  restore(): Promise<this>;
  // Types.ObjectId — matches Service.approvedBy
  approve(approverId: Types.ObjectId): Promise<this>;
  reject(approverId: Types.ObjectId, reason: string): Promise<this>;
}

export interface ServiceVirtuals {
  isApproved: boolean;
  isRejected: boolean;
  isPending: boolean;
}

export interface ServiceModel
  extends Model<Service, {}, ServiceMethods, ServiceVirtuals> {
  findActive(): Promise<ServiceDocument[]>;
  findByCategory(categoryId: string): Promise<ServiceDocument[]>;
  findByProvider(providerId: string): Promise<ServiceDocument[]>;
  searchServices(
    searchTerm: string,
    filters?: {
      categoryId?: string;
      providerId?: string;
      minPrice?: number;
      maxPrice?: number;
    }
  ): Promise<ServiceDocument[]>;
}

export type ServiceDocument = HydratedDocument<
  Service,
  ServiceMethods & ServiceVirtuals
>;