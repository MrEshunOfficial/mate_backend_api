// models/booking.model.ts
import mongoose, { Schema, model, HydratedDocument } from "mongoose";
import {
  Booking,
  BookingMethods,
  BookingModel as IBookingModel,
  BookingStatus,
  PaymentStatus,
  StatusHistoryEntry,
} from "../types/bookings.types";
import { ActorRole } from "../types/base.types";

type BookingDocument = HydratedDocument<Booking, BookingMethods>;

// ─── Sub-schemas ──────────────────────────────────────────────────────────────
const coordinatesSchema = new Schema(
  {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
  },
  { _id: false },
);

const userLocationSchema = new Schema(
  {
    ghanaPostGPS: { type: String, required: true, trim: true },
    nearbyLandmark: { type: String, trim: true },
    region: { type: String, trim: true },
    city: { type: String, trim: true },
    district: { type: String, trim: true },
    locality: { type: String, trim: true },
    streetName: { type: String, trim: true },
    houseNumber: { type: String, trim: true },
    gpsCoordinates: { type: coordinatesSchema },
    isAddressVerified: { type: Boolean, default: false },
    sourceProvider: {
      type: String,
      enum: ["openstreetmap", "google", "ghanapost"],
    },
    createdAt: { type: Date },
    updatedAt: { type: Date },
  },
  { _id: false },
);

const timeSlotSchema = new Schema(
  {
    start: { type: String, required: true },
    end: { type: String, required: true },
  },
  { _id: false },
);

// Each status transition is appended here for a full audit trail.
// Never mutated — append-only.
const statusHistoryEntrySchema = new Schema<StatusHistoryEntry>(
  {
    status: {
      type: String,
      enum: Object.values(BookingStatus),
      required: true,
    },
    timestamp: { type: Date, required: true, default: () => new Date() },
    actor: { type: Schema.Types.ObjectId, ref: "User" },
    actorRole: {
      type: String,
      enum: Object.values(ActorRole),
    },
    reason: { type: String, trim: true },
    message: { type: String, trim: true },
  },
  { _id: false },
);

// ─── Helper: append a status history entry ───────────────────────────────────

function appendStatusHistory(
  doc: BookingDocument,
  status: BookingStatus,
  actorId?: mongoose.Types.ObjectId,
  actorRole?: ActorRole,
  reason?: string,
  message?: string,
): void {
  if (!doc.statusHistory) doc.statusHistory = [];
  doc.statusHistory.push({
    status,
    timestamp: new Date(),
    actor: actorId,
    actorRole,
    reason,
    message,
  });
}

// ─── Main Schema ──────────────────────────────────────────────────────────────

const bookingSchema = new Schema<Booking, IBookingModel, BookingMethods>(
  {
    bookingNumber: {
      type: String,
      required: [true, "bookingNumber is required"],
      unique: true,
      trim: true,
      index: true,
    },

    // Origin — exactly one of these will be set per booking
    taskId: {
      type: Schema.Types.ObjectId,
      ref: "Task",
      default: null,
      index: true,
    },
    serviceRequestId: {
      type: Schema.Types.ObjectId,
      ref: "ServiceRequest",
      default: null,
      index: true,
    },

    clientId: {
      type: Schema.Types.ObjectId,
      ref: "UserProfile",
      required: [true, "clientId is required"],
      index: true,
    },

    providerId: {
      type: Schema.Types.ObjectId,
      ref: "ProviderProfile",
      required: [true, "providerId is required"],
      index: true,
    },

    serviceId: {
      type: Schema.Types.ObjectId,
      ref: "Service",
      required: [true, "serviceId is required"],
      index: true,
    },

    serviceLocation: {
      type: userLocationSchema,
      required: [true, "serviceLocation is required"],
    },

    scheduledDate: {
      type: Date,
      required: [true, "scheduledDate is required"],
    },

    scheduledTimeSlot: {
      type: timeSlotSchema,
      required: [true, "scheduledTimeSlot is required"],
    },

    serviceDescription: {
      type: String,
      required: [true, "serviceDescription is required"],
      trim: true,
      maxlength: 5000,
    },

    specialInstructions: { type: String, trim: true, maxlength: 2000 },

    // Pricing
    estimatedPrice: { type: Number, min: 0 },
    finalPrice: { type: Number, min: 0 },
    depositAmount: { type: Number, min: 0 },
    depositPaid: { type: Boolean, default: false },
    currency: {
      type: String,
      required: [true, "currency is required"],
      uppercase: true,
      trim: true,
      default: "GHS",
    },

    // State machine
    status: {
      type: String,
      enum: {
        values: Object.values(BookingStatus),
        message: "Invalid booking status",
      },
      default: BookingStatus.CONFIRMED,
      index: true,
    },

    paymentStatus: {
      type: String,
      enum: {
        values: Object.values(PaymentStatus),
        message: "Invalid payment status",
      },
      default: PaymentStatus.PENDING,
      index: true,
    },

    statusHistory: { type: [statusHistoryEntrySchema], default: [] },

    // Completion / validation
    validatedAt: { type: Date },
    disputedAt: { type: Date },
    disputeReason: { type: String, trim: true },
    customerRating: { type: Number, min: 1, max: 5 },
    customerReview: { type: String, trim: true, maxlength: 2000 },
    rebuttalMessage: { type: String, trim: true, maxlength: 2000 }, // ← new
    rebuttalAt: { type: Date },

    // SoftDeletable
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    collection: "bookings",
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

bookingSchema.index({ clientId: 1, status: 1 });
bookingSchema.index({ providerId: 1, status: 1 });
bookingSchema.index({ status: 1, isDeleted: 1 });
bookingSchema.index({ paymentStatus: 1, status: 1 });
bookingSchema.index({ scheduledDate: 1, status: 1 });
bookingSchema.index({ providerId: 1, scheduledDate: 1 });
bookingSchema.index({ taskId: 1 }, { sparse: true });
bookingSchema.index({ serviceRequestId: 1 }, { sparse: true });

// ─── Virtuals ─────────────────────────────────────────────────────────────────

// State interrogation helpers — derived from statusHistory to avoid drift
bookingSchema.virtual("confirmedAt").get(function (
  this: BookingDocument,
): Date | undefined {
  return this.statusHistory?.find((e) => e.status === BookingStatus.CONFIRMED)
    ?.timestamp;
});

bookingSchema.virtual("startedAt").get(function (
  this: BookingDocument,
): Date | undefined {
  return this.statusHistory?.find((e) => e.status === BookingStatus.IN_PROGRESS)
    ?.timestamp;
});

bookingSchema.virtual("completedAt").get(function (
  this: BookingDocument,
): Date | undefined {
  return this.statusHistory?.find(
    (e) =>
      e.status === BookingStatus.VALIDATED ||
      e.status === BookingStatus.COMPLETED,
  )?.timestamp;
});

bookingSchema.virtual("cancelledAt").get(function (
  this: BookingDocument,
): Date | undefined {
  return this.statusHistory?.find((e) => e.status === BookingStatus.CANCELLED)
    ?.timestamp;
});

bookingSchema.virtual("cancellationReason").get(function (
  this: BookingDocument,
): string | undefined {
  return this.statusHistory?.find((e) => e.status === BookingStatus.CANCELLED)
    ?.reason;
});

bookingSchema.virtual("cancelledBy").get(function (
  this: BookingDocument,
): string | undefined {
  return this.statusHistory?.find((e) => e.status === BookingStatus.CANCELLED)
    ?.actorRole;
});

bookingSchema.virtual("providerMessage").get(function (
  this: BookingDocument,
): string | undefined {
  return this.statusHistory?.find((e) => e.status === BookingStatus.IN_PROGRESS)
    ?.message;
});

// Boolean state flags
bookingSchema.virtual("isActive").get(function (
  this: BookingDocument,
): boolean {
  return [BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS].includes(
    this.status,
  );
});

bookingSchema.virtual("isConfirmed").get(function (
  this: BookingDocument,
): boolean {
  return this.status === BookingStatus.CONFIRMED;
});

bookingSchema.virtual("isInProgress").get(function (
  this: BookingDocument,
): boolean {
  return this.status === BookingStatus.IN_PROGRESS;
});

bookingSchema.virtual("isCompleted").get(function (
  this: BookingDocument,
): boolean {
  return [BookingStatus.VALIDATED, BookingStatus.COMPLETED].includes(
    this.status,
  );
});

bookingSchema.virtual("isCancelled").get(function (
  this: BookingDocument,
): boolean {
  return this.status === BookingStatus.CANCELLED;
});

bookingSchema.virtual("isAwaitingValidation").get(function (
  this: BookingDocument,
): boolean {
  return this.status === BookingStatus.AWAITING_VALIDATION;
});

bookingSchema.virtual("isValidated").get(function (
  this: BookingDocument,
): boolean {
  return this.status === BookingStatus.VALIDATED;
});

bookingSchema.virtual("isDisputed").get(function (
  this: BookingDocument,
): boolean {
  return this.status === BookingStatus.DISPUTED;
});

bookingSchema.virtual("requiresValidation").get(function (
  this: BookingDocument,
): boolean {
  return this.status === BookingStatus.AWAITING_VALIDATION;
});

bookingSchema.virtual("isUpcoming").get(function (
  this: BookingDocument,
): boolean {
  return (
    this.status === BookingStatus.CONFIRMED && this.scheduledDate > new Date()
  );
});

bookingSchema.virtual("isPastDue").get(function (
  this: BookingDocument,
): boolean {
  return (
    this.status === BookingStatus.CONFIRMED && this.scheduledDate < new Date()
  );
});

// Duration in calendar days between confirmed and completed
bookingSchema.virtual("durationInDays").get(function (
  this: BookingDocument,
): number | null {
  const start = this.statusHistory?.find(
    (e) => e.status === BookingStatus.CONFIRMED,
  )?.timestamp;
  const end = this.statusHistory?.find(
    (e) =>
      e.status === BookingStatus.VALIDATED ||
      e.status === BookingStatus.COMPLETED,
  )?.timestamp;
  if (!start || !end) return null;
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
});

// Deposit helpers
bookingSchema.virtual("requiresDeposit").get(function (
  this: BookingDocument,
): boolean {
  return !!(this.depositAmount && this.depositAmount > 0);
});

bookingSchema.virtual("depositRemaining").get(function (
  this: BookingDocument,
): number {
  if (!this.depositAmount) return 0;
  return this.depositPaid ? 0 : this.depositAmount;
});

bookingSchema.virtual("balanceRemaining").get(function (
  this: BookingDocument,
): number {
  const price = this.finalPrice ?? this.estimatedPrice ?? 0;
  const deposit = this.depositPaid ? (this.depositAmount ?? 0) : 0;
  return Math.max(0, price - deposit);
});

// ─── Pre-save Hook ────────────────────────────────────────────────────────────

bookingSchema.pre("save", function (next) {
  if (this.isDeleted && !this.deletedAt) {
    this.deletedAt = new Date();
  }
  next();
});

// Exclude soft-deleted records from all find queries by default.
bookingSchema.pre(/^find/, function (this: mongoose.Query<any, any>, next) {
  const options = this.getOptions();
  if (!options.includeSoftDeleted) {
    this.find({ isDeleted: { $ne: true } });
  }
  next();
});

// ─── Instance Methods ─────────────────────────────────────────────────────────

bookingSchema.methods.softDelete = function (
  this: BookingDocument,
  deletedBy?: mongoose.Types.ObjectId,
): Promise<BookingDocument> {
  this.isDeleted = true;
  this.deletedAt = new Date();
  if (deletedBy) this.deletedBy = deletedBy;
  return this.save();
};

bookingSchema.methods.restore = function (
  this: BookingDocument,
): Promise<BookingDocument> {
  this.isDeleted = false;
  this.deletedAt = undefined as any;
  this.deletedBy = undefined as any;
  return this.save();
};

bookingSchema.methods.startService = function (
  this: BookingDocument,
  providerId?: mongoose.Types.ObjectId,
): Promise<BookingDocument> {
  if (this.status !== BookingStatus.CONFIRMED) {
    return Promise.reject(
      new Error(
        `Cannot start service on a booking with status: ${this.status}`,
      ),
    );
  }
  this.status = BookingStatus.IN_PROGRESS;
  appendStatusHistory(
    this,
    BookingStatus.IN_PROGRESS,
    providerId,
    ActorRole.PROVIDER,
  );
  return this.save();
};

bookingSchema.methods.complete = function (
  this: BookingDocument,
  finalPrice?: number,
  providerId?: mongoose.Types.ObjectId,
): Promise<BookingDocument> {
  if (this.status !== BookingStatus.IN_PROGRESS) {
    return Promise.reject(
      new Error(`Cannot complete a booking with status: ${this.status}`),
    );
  }
  this.status = BookingStatus.AWAITING_VALIDATION;
  if (finalPrice != null) this.finalPrice = finalPrice;
  appendStatusHistory(
    this,
    BookingStatus.AWAITING_VALIDATION,
    providerId,
    ActorRole.PROVIDER,
  );
  return this.save();
};

bookingSchema.methods.validateCompletion = function (
  this: BookingDocument,
  approved: boolean,
  clientId: mongoose.Types.ObjectId,
  rating?: number,
  review?: string,
  disputeReason?: string,
): Promise<BookingDocument> {
  if (this.status !== BookingStatus.AWAITING_VALIDATION) {
    return Promise.reject(
      new Error(`Cannot validate a booking with status: ${this.status}`),
    );
  }
  if (approved) {
    this.status = BookingStatus.VALIDATED;
    this.validatedAt = new Date();
    if (rating != null) this.customerRating = rating;
    if (review) this.customerReview = review;
    appendStatusHistory(
      this,
      BookingStatus.VALIDATED,
      clientId,
      ActorRole.CUSTOMER,
    );
  } else {
    this.status = BookingStatus.DISPUTED;
    this.disputedAt = new Date();
    this.disputeReason = disputeReason;
    appendStatusHistory(
      this,
      BookingStatus.DISPUTED,
      clientId,
      ActorRole.CUSTOMER,
      disputeReason,
    );
  }
  return this.save();
};

bookingSchema.methods.cancel = function (
  this: BookingDocument,
  reason: string,
  cancelledBy: ActorRole,
  actorId?: mongoose.Types.ObjectId,
): Promise<BookingDocument> {
  const cancellable: BookingStatus[] = [
    BookingStatus.CONFIRMED,
    BookingStatus.IN_PROGRESS,
  ];
  if (!cancellable.includes(this.status)) {
    return Promise.reject(
      new Error(`Cannot cancel a booking with status: ${this.status}`),
    );
  }
  this.status = BookingStatus.CANCELLED;
  appendStatusHistory(
    this,
    BookingStatus.CANCELLED,
    actorId,
    cancelledBy,
    reason,
  );
  return this.save();
};

bookingSchema.methods.updatePaymentStatus = function (
  this: BookingDocument,
  paymentStatus: PaymentStatus,
  actorId?: mongoose.Types.ObjectId,
): Promise<BookingDocument> {
  this.paymentStatus = paymentStatus;
  if (paymentStatus === PaymentStatus.DEPOSIT_PAID) {
    this.depositPaid = true;
  }
  return this.save();
};

bookingSchema.methods.reschedule = function (
  this: BookingDocument,
  newDate: Date,
  newTimeSlot?: { start: string; end: string },
  actorId?: mongoose.Types.ObjectId,
  actorRole?: ActorRole,
): Promise<BookingDocument> {
  if (this.status !== BookingStatus.CONFIRMED) {
    return Promise.reject(
      new Error(`Cannot reschedule a booking with status: ${this.status}`),
    );
  }
  this.scheduledDate = newDate;
  if (newTimeSlot) this.scheduledTimeSlot = newTimeSlot;
  return this.save();
};

bookingSchema.methods.submitRebuttal = function (
  this: BookingDocument,
  message: string,
  providerId: mongoose.Types.ObjectId,
): Promise<BookingDocument> {
  if (this.status !== BookingStatus.DISPUTED) {
    return Promise.reject(
      new Error(
        `Cannot submit a rebuttal on a booking with status: ${this.status}`,
      ),
    );
  }
  this.status = BookingStatus.REBUTTAL_SUBMITTED;
  this.rebuttalMessage = message.trim();
  this.rebuttalAt = new Date();
  appendStatusHistory(
    this,
    BookingStatus.REBUTTAL_SUBMITTED,
    providerId,
    ActorRole.PROVIDER,
    undefined,
    message.trim(),
  );
  return this.save();
};

// ─── Static Methods ───────────────────────────────────────────────────────────

bookingSchema.statics.findActive = function () {
  return this.find({
    status: { $in: [BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS] },
    isDeleted: false,
  });
};

bookingSchema.statics.findByClient = function (clientId: string) {
  return this.find({ clientId, isDeleted: false }).sort({ createdAt: -1 });
};

bookingSchema.statics.findByProvider = function (providerId: string) {
  return this.find({ providerId, isDeleted: false }).sort({ createdAt: -1 });
};

bookingSchema.statics.findByStatus = function (status: BookingStatus) {
  return this.find({ status, isDeleted: false });
};

bookingSchema.statics.findByTask = function (taskId: string) {
  return this.findOne({ taskId, isDeleted: false });
};

bookingSchema.statics.findByServiceRequest = function (
  serviceRequestId: string,
) {
  return this.findOne({ serviceRequestId, isDeleted: false });
};

bookingSchema.statics.findUpcoming = function (providerId?: string) {
  const query: Record<string, any> = {
    status: BookingStatus.CONFIRMED,
    scheduledDate: { $gte: new Date() },
    isDeleted: false,
  };
  if (providerId) query.providerId = providerId;
  return this.find(query).sort({ scheduledDate: 1 });
};

bookingSchema.statics.findByDateRange = function (
  startDate: Date,
  endDate: Date,
  providerId?: string,
) {
  const query: Record<string, any> = {
    scheduledDate: { $gte: startDate, $lte: endDate },
    isDeleted: false,
  };
  if (providerId) query.providerId = providerId;
  return this.find(query).sort({ scheduledDate: 1 });
};

/**
 * Generates a unique, human-readable booking number.
 *
 * Format: BK-YYYYMMDD-XXXXXX
 *   BK      — entity prefix
 *   YYYYMMDD — UTC date of creation (sortable)
 *   XXXXXX   — 6-character alphanumeric suffix (collision-checked)
 *
 * Retries up to 5 times on the rare case of a suffix collision.
 */
bookingSchema.statics.generateBookingNumber =
  async function (): Promise<string> {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD

    const MAX_ATTEMPTS = 5;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const suffix = Array.from({ length: 6 }, () =>
        chars.charAt(Math.floor(Math.random() * chars.length)),
      ).join("");

      const candidate = `BK-${datePart}-${suffix}`;
      const exists = await (this as any).findOne(
        { bookingNumber: candidate },
        null,
        { includeSoftDeleted: true },
      );

      if (!exists) return candidate;
    }

    // Practically impossible but fail loudly rather than silently producing a duplicate
    throw new Error(
      "Failed to generate a unique booking number after 5 attempts. " +
        "Investigate collision rate or widen the suffix character space.",
    );
  };

// ─── Model ────────────────────────────────────────────────────────────────────

export const BookingModel = model<Booking, IBookingModel>(
  "Booking",
  bookingSchema,
);

export default BookingModel;
