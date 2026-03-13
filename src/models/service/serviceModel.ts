// models/service.model.ts
import { Schema, Types, model, Model, HydratedDocument } from "mongoose";


// ─── Fee Item Subdocument ─────────────────────────────────────────────────────

const feeItemSchema = new Schema(
  {
    label:      { type: String,  required: true, trim: true },
    amount:     { type: Number,  required: true, min: 0 },
    isOptional: { type: Boolean, required: true, default: false },
  },
  { _id: false }
);

// ─── Pricing Tier Subdocument ─────────────────────────────────────────────────

const pricingTierSchema = new Schema(
  {
    tierId:          { type: String,   required: true, trim: true },
    label:           { type: String,   required: true, trim: true },
    description:     { type: String,   trim: true },
    basePrice:       { type: Number,   required: true, min: 0 },
    durationMinutes: { type: Number,   min: 0 },
    deliverables:    { type: [String], default: [] },
  },
  { _id: false }
);

// ─── Service Pricing Subdocument ──────────────────────────────────────────────

const servicePricingSchema = new Schema(
  {
    // --- Model & unit ---
    pricingModel: {
      type: String,
      enum: ["fixed", "hourly", "per_unit", "negotiable", "free"] as PricingModel[],
      required: true,
    },
    basePrice: { type: Number, min: 0, default: null },
    unit:      { type: String, trim: true, default: null },

    // --- Tiered packages ---
    tiers: { type: [pricingTierSchema], default: [] },

    // --- Add-on fees (replaces boolean includeTravelFee / includeAdditionalFees) ---
    additionalFees: { type: [feeItemSchema], default: [] },

    // --- Tax ---
    taxRate:     { type: Number, min: 0, max: 1, default: null },
    taxIncluded: { type: Boolean, required: true, default: false },

    // --- Negotiation floor ---
    minimumPrice: { type: Number, min: 0, default: null },

    // --- Discount / promotions ---
    discount: {
      rate:      { type: Number, min: 0, max: 1 },
      amount:    { type: Number, min: 0 },
      expiresAt: { type: Date },
      promoCode: { type: String, trim: true },
    },

    // --- Currency ---
    currency: {
      type: String,
      required: true,
      default: "GHS",
      uppercase: true,
      trim: true,
    },

    // --- Commission snapshot (audit only — live rate comes from platform config) ---
    commissionRateSnapshot: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      default: 0.2,
    },

    // --- Provider notes ---
    pricingNotes: { type: String, trim: true, maxlength: 1000, default: null },
  },
  { _id: false }
);

// ─── Main Service Schema ──────────────────────────────────────────────────────
// ServiceModel interface is NOT passed to Schema<> — Mongoose doesn't require it
// there and it causes an unresolvable name collision. It is applied only at the
// model() call below via a type cast.

const serviceSchema = new Schema<
  Service,
  Model<Service, {}, ServiceMethods, ServiceVirtuals>,
  ServiceMethods,
  {},
  ServiceVirtuals
>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (tags: string[]) => tags.length <= 20,
        message: "Maximum 20 tags allowed",
      },
    },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: true,
      index: true,
    },
    coverImage: {
      type: Schema.Types.ObjectId,
      ref: "File",
      default: null,
    },

    /**
     * A service belongs to exactly one provider.
     * null = admin-created catalog service not yet assigned to a provider.
     */
    providerId: {
      type: Schema.Types.ObjectId,
      ref: "ProviderProfile",
      required: false,
      default: null,
      index: true,
    },

    // Optional at schema level to support drafts; required before approval
    // or auto-activation.
    servicePricing: {
      type: servicePricingSchema,
      required: false,
      default: null,
    },

    isPrivate: { type: Boolean, default: false },

    // Moderation
    submittedBy:     { type: Schema.Types.ObjectId, ref: "User" },
    approvedBy:      { type: Schema.Types.ObjectId, ref: "User" },
    approvedAt:      { type: Date },
    rejectedAt:      { type: Date },
    rejectionReason: { type: String, trim: true, maxlength: 1000 },
    isActive:        { type: Boolean, default: false, index: true },

    /**
     * When set, the scheduler will activate this service after this timestamp
     * provided it has not been manually rejected in the interim.
     *
     * Set by the service layer when activation criteria are first met.
     * Reset on any substantive content change so the admin has a fresh
     * review window. Cleared on activation, rejection, or deletion.
     *
     * default: null so the field is always present on the document —
     * this avoids the $exists: false vs null ambiguity in scheduler queries.
     */
    scheduledActivationAt: { type: Date, default: null, index: true },

    // SoftDeletable
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
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

serviceSchema.index({ title: "text", description: "text", tags: "text" });
serviceSchema.index({ categoryId: 1, isActive: 1, isDeleted: 1 });
serviceSchema.index({ providerId: 1, isActive: 1, isDeleted: 1 });
serviceSchema.index({ slug: 1, isDeleted: 1 });

/**
 * Scheduler index — covers the exact query issued by processScheduledActivations:
 *   { scheduledActivationAt: { $lte: now }, isActive: false, isDeleted: false,
 *     rejectedAt: { $exists: false } }
 *
 * sparse: true because scheduledActivationAt is null on the vast majority of
 * documents (active, rejected, or never-scheduled services). A sparse index
 * only stores entries where the field is non-null, keeping it small and fast.
 */
serviceSchema.index(
  { scheduledActivationAt: 1, isActive: 1, isDeleted: 1 },
  { sparse: true, name: "idx_scheduled_activation" }
);

// ─── Virtuals ─────────────────────────────────────────────────────────────────

serviceSchema.virtual("isApproved").get(function (): boolean {
  return !!this.approvedAt && !this.rejectedAt;
});

serviceSchema.virtual("isRejected").get(function (): boolean {
  return !!this.rejectedAt;
});

serviceSchema.virtual("isPending").get(function (): boolean {
  return !this.approvedAt && !this.rejectedAt;
});

/**
 * True when the service is sitting in the auto-activation queue —
 * i.e. scheduledActivationAt is set to a future time and the service has
 * not yet been activated or rejected.
 * Useful for surfacing an "activating in X minutes" badge in the provider dashboard.
 */
serviceSchema.virtual("isPendingAutoActivation").get(function (): boolean {
  return (
    !!this.scheduledActivationAt &&
    this.scheduledActivationAt > new Date() &&
    !this.isActive &&
    !this.rejectedAt
  );
});

/**
 * True when this service offers multi-tier (package) pricing.
 */
serviceSchema.virtual("hasTiers").get(function (): boolean {
  return (
    Array.isArray(this.servicePricing?.tiers) &&
    this.servicePricing!.tiers.length > 0
  );
});

/**
 * What the provider takes home per base-price unit after commission.
 * Formula: basePrice × (1 − commissionRateSnapshot)
 * Returns null for free/negotiable models, or when pricing/basePrice is absent.
 */
serviceSchema.virtual("providerEarnings").get(function (): number | null {
  const p = this.servicePricing;
  if (!p || p.basePrice == null) return null;
  if (p.pricingModel === "free" || p.pricingModel === "negotiable") return null;
  return p.basePrice * (1 - p.commissionRateSnapshot);
});

/**
 * All-in price shown to the customer before optional fees.
 * Formula: basePrice + mandatory additionalFees + tax (when !taxIncluded)
 * Returns null when pricing or basePrice is absent.
 */
serviceSchema.virtual("effectivePrice").get(function (): number | null {
  const p = this.servicePricing;
  if (!p || p.basePrice == null) return null;

  const mandatoryFees = (p.additionalFees ?? [])
    .filter((fee) => !fee.isOptional)
    .reduce((sum, fee) => sum + fee.amount, 0);

  const subtotal = p.basePrice + mandatoryFees;
  return !p.taxIncluded && p.taxRate
    ? subtotal + subtotal * p.taxRate
    : subtotal;
});

// ─── Instance Methods ─────────────────────────────────────────────────────────

serviceSchema.methods.softDelete = function (
  this: HydratedDocument<Service, ServiceMethods>,
  deletedBy?: Types.ObjectId
) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  if (deletedBy) this.deletedBy = deletedBy;
  return this.save();
};

serviceSchema.methods.restore = function (
  this: HydratedDocument<Service, ServiceMethods>
) {
  this.isDeleted = false;
  this.deletedAt = undefined;
  this.deletedBy = undefined;
  return this.save();
};

serviceSchema.methods.approve = function (
  this: HydratedDocument<Service, ServiceMethods>,
  approverId: Types.ObjectId
) {
  this.approvedBy            = approverId;
  this.approvedAt            = new Date();
  this.isActive              = true;
  this.rejectedAt            = undefined;
  this.rejectionReason       = undefined;
  this.scheduledActivationAt = null; // manual approval supersedes the queue
  return this.save();
};

serviceSchema.methods.reject = function (
  this: HydratedDocument<Service, ServiceMethods>,
  approverId: Types.ObjectId,
  reason: string
) {
  this.approvedBy            = approverId;
  this.rejectedAt            = new Date();
  this.rejectionReason       = reason;
  this.isActive              = false;
  this.approvedAt            = undefined;
  this.scheduledActivationAt = null; // rejection must always win over the queue
  return this.save();
};

// ─── Static Methods ───────────────────────────────────────────────────────────

serviceSchema.statics.findActive = function () {
  return this.find({ isActive: true, isDeleted: false });
};

serviceSchema.statics.findByCategory = function (categoryId: string) {
  return this.find({ categoryId, isActive: true, isDeleted: false });
};

serviceSchema.statics.findByProvider = function (providerId: string) {
  return this.find({ providerId, isDeleted: false });
};

serviceSchema.statics.searchServices = function (
  searchTerm: string,
  filters?: {
    categoryId?: string;
    providerId?: string;
    minPrice?: number;
    maxPrice?: number;
    pricingModel?: PricingModel;
    currency?: string;
  }
) {
  const query: Record<string, any> = {
    $text: { $search: searchTerm },
    isActive: true,
    isDeleted: false,
  };

  if (filters?.categoryId) query.categoryId = filters.categoryId;
  if (filters?.providerId) query.providerId = filters.providerId;
  if (filters?.pricingModel) query["servicePricing.pricingModel"] = filters.pricingModel;
  if (filters?.currency) query["servicePricing.currency"] = filters.currency.toUpperCase();

  if (filters?.minPrice != null || filters?.maxPrice != null) {
    query["servicePricing.basePrice"] = {};
    if (filters.minPrice != null) query["servicePricing.basePrice"].$gte = filters.minPrice;
    if (filters.maxPrice != null) query["servicePricing.basePrice"].$lte = filters.maxPrice;
  }

  return this.find(query).sort({ score: { $meta: "textScore" } });
};

// ─── Export ───────────────────────────────────────────────────────────────────
// The ServiceModel interface from service.types is applied via cast here.
// Importing it as a Schema generic causes an unresolvable name collision with
// the exported const — using it only at the call site avoids the issue entirely.

import type { ServiceModel as IServiceModel } from "../../types/services.types";
import { PricingModel, Service, ServiceMethods, ServiceVirtuals } from "../../types/services.types";
export const ServiceModel = model("Service", serviceSchema) as unknown as IServiceModel;