// models/serviceRequest.model.ts
import mongoose, { Schema, model, HydratedDocument } from "mongoose";
import {
  ServiceRequest,
  ServiceRequestMethods,
  ServiceRequestModel as IServiceRequestModel,
  ServiceRequestStatus,
} from "../../types/service-request.types";

type ServiceRequestDocument = HydratedDocument<ServiceRequest, ServiceRequestMethods>;

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const coordinatesSchema = new Schema(
  {
    latitude:  { type: Number, required: true },
    longitude: { type: Number, required: true },
  },
  { _id: false }
);

// Reuses the UserLocation shape — defined inline to avoid circular imports.
// ghanaPostGPS is required on Booking.serviceLocation and Task.registeredLocation
// but is optional here because a browse-originated request may have only GPS
// coordinates and no Ghana Post code at the moment of submission.
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

const timeSlotSchema = new Schema(
  {
    start: { type: String, required: true },
    end:   { type: String, required: true },
  },
  { _id: false }
);

const estimatedBudgetSchema = new Schema(
  {
    min:      { type: Number, min: 0 },
    max:      { type: Number, min: 0 },
    currency: {
      type:     String,
      required: true,
      uppercase: true,
      trim:     true,
      default:  "GHS",
    },
  },
  { _id: false }
);

const providerResponseSchema = new Schema(
  {
    message:     { type: String, trim: true },
    respondedAt: { type: Date, required: true },
  },
  { _id: false }
);

const gpsLocationSchema = new Schema(
  {
    latitude:   { type: Number, required: true },
    longitude:  { type: Number, required: true },
    accuracy:   { type: Number },
    capturedAt: { type: Date, required: true },
  },
  { _id: false }
);

/**
 * Stores how the client found this provider — used for analytics and
 * dispute context. The `source` field distinguishes whether the provider
 * appeared in a GPS-based browse, a registered-address browse, or was
 * found through a manual search / saved favourites.
 */
const discoveryContextSchema = new Schema(
  {
    source: {
      type: String,
      enum: ["gps_browse", "registered", "manual"],
      required: true,
    },
    gpsLocation:  { type: gpsLocationSchema },
    radiusKm:     { type: Number, min: 0 },
    // Records whether the client had to expand the search radius to find
    // this provider — useful for understanding browse UX and coverage gaps.
    wasExpanded:  { type: Boolean, default: false },
  },
  { _id: false }
);

// ─── Main Schema ──────────────────────────────────────────────────────────────

const serviceRequestSchema = new Schema<
  ServiceRequest,
  IServiceRequestModel,
  ServiceRequestMethods
>(
  {
    clientId: {
      type:     Schema.Types.ObjectId,
      ref:      "UserProfile",
      required: [true, "clientId is required"],
      index:    true,
    },

    providerId: {
      type:     Schema.Types.ObjectId,
      ref:      "ProviderProfile",
      required: [true, "providerId is required"],
      index:    true,
    },

    serviceId: {
      type:     Schema.Types.ObjectId,
      ref:      "Service",
      required: [true, "serviceId is required"],
      index:    true,
    },

    serviceLocation: {
      type:     userLocationSchema,
      required: [true, "serviceLocation is required"],
    },

    scheduledDate: {
      type:     Date,
      required: [true, "scheduledDate is required"],
    },

    scheduledTimeSlot: {
      type:     timeSlotSchema,
      required: [true, "scheduledTimeSlot is required"],
    },

    clientMessage: {
      type:      String,
      trim:      true,
      maxlength: [2000, "Client message cannot exceed 2000 characters"],
    },

    estimatedBudget: { type: estimatedBudgetSchema },

    status: {
      type: String,
      enum: {
        values:  Object.values(ServiceRequestStatus),
        message: "Invalid service request status",
      },
      default: ServiceRequestStatus.PENDING,
      index:   true,
    },

    providerResponse: { type: providerResponseSchema },

    discoveryContext: { type: discoveryContextSchema },

    // Stamped by BookingService.createBookingFromServiceRequest when the
    // provider accepts. Never set directly by this model.
    convertedToBookingId: {
      type:    Schema.Types.ObjectId,
      ref:     "Booking",
      default: null,
    },
    convertedAt: { type: Date, default: null },

    expiresAt:          { type: Date, index: true },
    cancelledAt:        { type: Date },
    cancellationReason: { type: String, trim: true },

    // SoftDeletable
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date,    default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    collection: "serviceRequests",
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, any>) => {
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

// Provider inbox query — covers getPendingRequestsForProvider
serviceRequestSchema.index({ providerId: 1, status: 1 });
// Client history query
serviceRequestSchema.index({ clientId: 1, status: 1 });
// Duplicate-request guard in ServiceRequestService.createServiceRequest
serviceRequestSchema.index({ clientId: 1, providerId: 1, serviceId: 1, status: 1 });
// Expiry cron job query — sparse because most requests have a set expiresAt
// but we guard against documents without it
serviceRequestSchema.index({ status: 1, expiresAt: 1 }, { sparse: true });
// Booking linkage lookup
serviceRequestSchema.index({ convertedToBookingId: 1 }, { sparse: true });
serviceRequestSchema.index({ status: 1, isDeleted: 1 });

// ─── Virtuals ─────────────────────────────────────────────────────────────────

/**
 * True when the request is still PENDING and has not yet passed its expiry.
 * Used by the provider inbox to surface time-sensitive requests.
 */
serviceRequestSchema.virtual("isExpiredNow").get(function (
  this: ServiceRequestDocument,
): boolean {
  return (
    this.status === ServiceRequestStatus.PENDING &&
    !!this.expiresAt &&
    this.expiresAt < new Date()
  );
});

/**
 * True when the request has been accepted and a booking has been created.
 */
serviceRequestSchema.virtual("isConverted").get(function (
  this: ServiceRequestDocument,
): boolean {
  return (
    this.status === ServiceRequestStatus.ACCEPTED &&
    !!this.convertedToBookingId
  );
});

/**
 * Remaining time in milliseconds before the request expires.
 * Returns 0 when already expired or no expiresAt is set.
 */
serviceRequestSchema.virtual("expiresInMs").get(function (
  this: ServiceRequestDocument,
): number {
  if (!this.expiresAt) return 0;
  return Math.max(0, this.expiresAt.getTime() - Date.now());
});

// ─── Pre-save Hook ─────────────────────────────────────────────────────────────

serviceRequestSchema.pre("save", function (next) {
  if (this.isDeleted && !this.deletedAt) {
    this.deletedAt = new Date();
  }
  if (
    this.status === ServiceRequestStatus.CANCELLED &&
    !this.cancelledAt &&
    this.isModified("status")
  ) {
    this.cancelledAt = new Date();
  }
  next();
});

// Exclude soft-deleted records from all find queries by default.
serviceRequestSchema.pre(/^find/, function (
  this: mongoose.Query<any, any>,
  next,
) {
  const options = this.getOptions();
  if (!options.includeSoftDeleted) {
    this.find({ isDeleted: { $ne: true } });
  }
  next();
});

// ─── Instance Methods ──────────────────────────────────────────────────────────

serviceRequestSchema.methods.softDelete = function (
  this: ServiceRequestDocument,
  deletedBy?: mongoose.Types.ObjectId,
): Promise<ServiceRequestDocument> {
  this.isDeleted = true;
  this.deletedAt = new Date();
  if (deletedBy) this.deletedBy = deletedBy;
  return this.save();
};

serviceRequestSchema.methods.restore = function (
  this: ServiceRequestDocument,
): Promise<ServiceRequestDocument> {
  this.isDeleted    = false;
  this.deletedAt    = undefined as any;
  this.deletedBy    = undefined as any;
  return this.save();
};

/**
 * Transitions the request to ACCEPTED and records the provider's response.
 *
 * NOTE: This method is intentionally private to the model layer and should
 * NOT be called directly from application code. The only valid caller is
 * BookingService.createBookingFromServiceRequest, which wraps this transition
 * with booking creation to maintain consistency between the two documents.
 * Calling this standalone would leave the request ACCEPTED with no booking.
 */
serviceRequestSchema.methods.accept = function (
  this: ServiceRequestDocument,
  providerId: mongoose.Types.ObjectId,
  message?: string,
): Promise<ServiceRequestDocument> {
  if (this.status !== ServiceRequestStatus.PENDING) {
    return Promise.reject(
      new Error(
        `Cannot accept a service request with status: ${this.status}`,
      ),
    );
  }
  if (this.providerId.toString() !== providerId.toString()) {
    return Promise.reject(
      new Error("Only the assigned provider can accept this request"),
    );
  }
  this.status           = ServiceRequestStatus.ACCEPTED;
  this.providerResponse = { message: message?.trim(), respondedAt: new Date() };
  return this.save();
};

serviceRequestSchema.methods.reject = function (
  this: ServiceRequestDocument,
  providerId: mongoose.Types.ObjectId,
  message?: string,
): Promise<ServiceRequestDocument> {
  if (this.status !== ServiceRequestStatus.PENDING) {
    return Promise.reject(
      new Error(
        `Cannot reject a service request with status: ${this.status}`,
      ),
    );
  }
  if (this.providerId.toString() !== providerId.toString()) {
    return Promise.reject(
      new Error("Only the assigned provider can reject this request"),
    );
  }
  this.status           = ServiceRequestStatus.REJECTED;
  this.providerResponse = { message: message?.trim(), respondedAt: new Date() };
  return this.save();
};

serviceRequestSchema.methods.cancel = function (
  this: ServiceRequestDocument,
  reason?: string,
  cancelledBy?: mongoose.Types.ObjectId,
): Promise<ServiceRequestDocument> {
  const terminal: ServiceRequestStatus[] = [
    ServiceRequestStatus.ACCEPTED,
    ServiceRequestStatus.REJECTED,
    ServiceRequestStatus.EXPIRED,
    ServiceRequestStatus.CANCELLED,
  ];
  if (terminal.includes(this.status)) {
    return Promise.reject(
      new Error(
        `Cannot cancel a service request with status: ${this.status}`,
      ),
    );
  }
  this.status             = ServiceRequestStatus.CANCELLED;
  this.cancelledAt        = new Date();
  this.cancellationReason = reason?.trim();
  return this.save();
};

// ─── Static Methods ────────────────────────────────────────────────────────────

serviceRequestSchema.statics.findByClient = function (clientId: string) {
  return this.find({ clientId, isDeleted: false }).sort({ createdAt: -1 });
};

serviceRequestSchema.statics.findByProvider = function (providerId: string) {
  return this.find({ providerId, isDeleted: false }).sort({ createdAt: -1 });
};

/**
 * Returns PENDING requests for a provider that have not yet passed their
 * expiry timestamp. Used by the provider inbox.
 */
serviceRequestSchema.statics.findPendingForProvider = function (
  providerId: string,
) {
  return this.find({
    providerId,
    status:    ServiceRequestStatus.PENDING,
    isDeleted: false,
    $or: [
      { expiresAt: { $gt: new Date() } },
      { expiresAt: { $exists: false } },
    ],
  }).sort({ createdAt: 1 }); // FIFO — oldest first
};

// ─── Model ────────────────────────────────────────────────────────────────────

export const ServiceRequestModel = model<ServiceRequest, IServiceRequestModel>(
  "ServiceRequest",
  serviceRequestSchema,
);

export default ServiceRequestModel;