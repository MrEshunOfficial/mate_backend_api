import { Types, Model, HydratedDocument } from "mongoose";
import { BaseEntity, SoftDeletable, ActorRole } from "./base.types";
import { UserLocation } from "./location.types";

export enum BookingStatus {
  CONFIRMED           = "CONFIRMED",
  IN_PROGRESS         = "IN_PROGRESS",
  AWAITING_VALIDATION = "AWAITING_VALIDATION",
  VALIDATED           = "VALIDATED",
  DISPUTED            = "DISPUTED",
  COMPLETED           = "COMPLETED",   // admin override — prefer VALIDATED
  CANCELLED           = "CANCELLED",
}

export enum PaymentStatus {
  PENDING        = "PENDING",
  DEPOSIT_PAID   = "DEPOSIT_PAID",
  PARTIALLY_PAID = "PARTIALLY_PAID",
  PAID           = "PAID",
  REFUNDED       = "REFUNDED",
  FAILED         = "FAILED",
}

export interface StatusHistoryEntry {
  status: BookingStatus;
  timestamp: Date;
  actor?: Types.ObjectId;
  actorRole?: ActorRole;
  reason?: string;
  message?: string;
}

// Discriminated union — rating is required when approving, disputeReason when disputing
export type ValidateBookingRequestBody =
  | { approved: true;  rating: number; review?: string; disputeReason?: never }
  | { approved: false; disputeReason: string; rating?: never; review?: never };

// ─── Booking Entity ───────────────────────────────────────────────────────────

export interface Booking extends BaseEntity, SoftDeletable {
  bookingNumber: string;

  // Origin — exactly one will be set
  taskId?: Types.ObjectId;
  serviceRequestId?: Types.ObjectId;

  clientId: Types.ObjectId;
  providerId: Types.ObjectId;
  serviceId: Types.ObjectId;

  serviceLocation: UserLocation;
  scheduledDate: Date;
  scheduledTimeSlot: { start: string; end: string };
  serviceDescription: string;
  specialInstructions?: string;

  estimatedPrice?: number;
  finalPrice?: number;
  depositAmount?: number;
  depositPaid?: boolean;
  currency: string;

  status: BookingStatus;
  paymentStatus: PaymentStatus;
  statusHistory?: StatusHistoryEntry[];

  // Validation
  validatedAt?: Date;
  disputedAt?: Date;
  disputeReason?: string;
  customerRating?: number;
  customerReview?: string;

  // Virtuals (Mongoose computed, read-only)
  readonly isActive?: boolean;
  readonly isConfirmed?: boolean;
  readonly isInProgress?: boolean;
  readonly isCompleted?: boolean;
  readonly isCancelled?: boolean;
  readonly isAwaitingValidation?: boolean;
  readonly isValidated?: boolean;
  readonly isDisputed?: boolean;
  readonly requiresValidation?: boolean;
  readonly isUpcoming?: boolean;
  readonly isPastDue?: boolean;
  readonly confirmedAt?: Date;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly cancelledAt?: Date;
  readonly cancellationReason?: string;
  readonly cancelledBy?: string;
  readonly providerMessage?: string;
  readonly durationInDays?: number | null;
  readonly requiresDeposit?: boolean;
  readonly depositRemaining?: number;
  readonly balanceRemaining?: number;
}

// ─── Instance Methods ─────────────────────────────────────────────────────────

export interface BookingMethods {
  softDelete(deletedBy?: Types.ObjectId): Promise<HydratedDocument<Booking, BookingMethods>>;
  restore(): Promise<HydratedDocument<Booking, BookingMethods>>;
  startService(providerId?: Types.ObjectId): Promise<HydratedDocument<Booking, BookingMethods>>;
  complete(finalPrice?: number, providerId?: Types.ObjectId): Promise<HydratedDocument<Booking, BookingMethods>>;
  validateCompletion(
    approved: boolean,
    clientId: Types.ObjectId,
    rating?: number,
    review?: string,
    disputeReason?: string
  ): Promise<HydratedDocument<Booking, BookingMethods>>;
  cancel(
    reason: string,
    cancelledBy: ActorRole,
    actorId?: Types.ObjectId
  ): Promise<HydratedDocument<Booking, BookingMethods>>;
  updatePaymentStatus(
    paymentStatus: PaymentStatus,
    actorId?: Types.ObjectId
  ): Promise<HydratedDocument<Booking, BookingMethods>>;
  reschedule(
    newDate: Date,
    newTimeSlot?: { start: string; end: string },
    actorId?: Types.ObjectId,
    actorRole?: ActorRole
  ): Promise<HydratedDocument<Booking, BookingMethods>>;
}

// ─── Static Methods ───────────────────────────────────────────────────────────

export interface BookingModel extends Model<Booking, {}, BookingMethods> {
  findActive(): any;
  findByClient(clientId: string): any;
  findByProvider(providerId: string): any;
  findByStatus(status: BookingStatus): any;
  findByTask(taskId: string): any;
  findByServiceRequest(serviceRequestId: string): any;
  findUpcoming(providerId?: string): any;
  findByDateRange(startDate: Date, endDate: Date, providerId?: string): any;
  generateBookingNumber(): Promise<string>;
}

// ─── Response Types ───────────────────────────────────────────────────────────

export interface BookingValidationResponse {
  success: boolean;
  message: string;
  booking: Booking;
}

export interface PopulatedBooking
  extends Omit<Booking, "clientId" | "providerId" | "serviceId" | "taskId" | "serviceRequestId"> {
  clientId: { _id: Types.ObjectId; name: string; email: string };
  providerId: { _id: Types.ObjectId; businessName?: string; profile: Types.ObjectId };
  serviceId: { _id: Types.ObjectId; title: string; slug: string };
  taskId?: { _id: Types.ObjectId; title: string; status: string };
  serviceRequestId?: { _id: Types.ObjectId; clientMessage?: string };
}

