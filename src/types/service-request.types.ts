import { Types, Model, HydratedDocument } from "mongoose";
import { BaseEntity, SoftDeletable } from "./base.types";
import { UserLocation, GPSLocation, BrowseLocationContext } from "./location.types";

export enum ServiceRequestStatus {
  PENDING    = "PENDING",    // submitted, awaiting provider response
  ACCEPTED   = "ACCEPTED",   // provider accepted → converts to Booking
  REJECTED   = "REJECTED",
  EXPIRED    = "EXPIRED",
  CANCELLED  = "CANCELLED",
}

// ─── Service Request Entity ───────────────────────────────────────────────────

export interface ServiceRequest extends BaseEntity, SoftDeletable {
  clientId: Types.ObjectId;
  providerId: Types.ObjectId;
  serviceId: Types.ObjectId;

  serviceLocation: UserLocation;
  scheduledDate: Date;
  scheduledTimeSlot: { start: string; end: string };

  clientMessage?: string;
  estimatedBudget?: { min?: number; max?: number; currency: string };

  status: ServiceRequestStatus;

  providerResponse?: {
    message?: string;
    respondedAt: Date;
  };

  // Records how the client discovered this provider — analytics + dispute context
  discoveryContext?: {
    source: "gps_browse" | "registered" | "manual";
    gpsLocation?: GPSLocation;
    radiusKm?: number;
    wasExpanded?: boolean;  // did the client use "load more" to find this provider?
  };

  convertedToBookingId?: Types.ObjectId;
  convertedAt?: Date;

  expiresAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
}

// ─── Instance Methods ─────────────────────────────────────────────────────────

export interface ServiceRequestMethods {
  softDelete(deletedBy?: Types.ObjectId): Promise<HydratedDocument<ServiceRequest, ServiceRequestMethods>>;
  restore(): Promise<HydratedDocument<ServiceRequest, ServiceRequestMethods>>;
  accept(providerId: Types.ObjectId, message?: string): Promise<HydratedDocument<ServiceRequest, ServiceRequestMethods>>;
  reject(providerId: Types.ObjectId, message?: string): Promise<HydratedDocument<ServiceRequest, ServiceRequestMethods>>;
  cancel(reason?: string, cancelledBy?: Types.ObjectId): Promise<HydratedDocument<ServiceRequest, ServiceRequestMethods>>;
}

// ─── Static Methods ───────────────────────────────────────────────────────────

export interface ServiceRequestModel
  extends Model<ServiceRequest, {}, ServiceRequestMethods> {
  findByClient(clientId: string): Promise<ServiceRequestDocument[]>;
  findByProvider(providerId: string): Promise<ServiceRequestDocument[]>;
  findPendingForProvider(providerId: string): Promise<ServiceRequestDocument[]>;
}

export type ServiceRequestDocument = HydratedDocument<
  ServiceRequest,
  ServiceRequestMethods
>;

// ─── Service Browse (Flow 2 entry point) ──────────────────────────────────────

export interface BrowseServicesParams {
  locationContext: BrowseLocationContext;
  categoryId?: string;
  searchTerm?: string;
  priceRange?: { min?: number; max?: number; currency?: string };
  page?: number;
  limit?: number;
}

// Triggered when client hits "load more" — radius is relaxed
export interface ExpandServiceSearchParams {
  originalLocationContext: BrowseLocationContext;
  expandedRadiusKm: number;
  page: number;
  limit?: number;
}

export interface BrowseServicesResponse {
  success: boolean;
  message: string;
  services?: Array<{
    serviceId: Types.ObjectId;
    providerId: Types.ObjectId;
    distanceKm: number;
    service: any;   // import Service at usage site
  }>;
  locationContext: BrowseLocationContext;
  totalResults?: number;
  hasMore?: boolean;
  error?: string;
}

// ─── API Request / Response ───────────────────────────────────────────────────

export interface CreateServiceRequestBody {
  serviceId: string;
  providerId: string;
  serviceLocation: UserLocation;
  scheduledDate: Date;
  scheduledTimeSlot: { start: string; end: string };
  clientMessage?: string;
  estimatedBudget?: { min?: number; max?: number; currency?: string };
  // How the client found this provider — stored on the ServiceRequest entity
  discoveryContext?: {
    source: "gps_browse" | "registered" | "manual";
    gpsLocation?: GPSLocation;
    radiusKm?: number;
    wasExpanded?: boolean;
  };
}

export interface RespondToServiceRequestBody {
  action: "accept" | "reject";
  message?: string;
}

export interface ServiceRequestResponse {
  success: boolean;
  message: string;
  serviceRequest?: Partial<ServiceRequest>;
  booking?: any;
  error?: string;
}

