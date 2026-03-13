import { Types, Model, HydratedDocument, Query } from "mongoose";
import { BaseEntity, SoftDeletable } from "./base.types";

// ---------------------------------------------------------------------------
// Pricing primitives
// ---------------------------------------------------------------------------

/**
 * Discriminates how the service is priced.
 * - fixed      → flat rate per booking
 * - hourly     → basePrice × durationMinutes
 * - per_unit   → basePrice × quantity
 * - negotiable → basePrice is a starting/floor figure only
 * - free       → no charge (community, trial, etc.)
 */
export type PricingModel =
  | "fixed"
  | "hourly"
  | "per_unit"
  | "negotiable"
  | "free";

/**
 * Granular unit label attached to the base price.
 * Extend the string union as your platform grows.
 */
export type PricingUnit =
  | "session"
  | "hour"
  | "half_day"
  | "day"
  | "item"
  | "word"
  | "page"
  | "km"
  | string; // escape hatch for custom units

/**
 * A single additional charge that sits on top of the base price.
 * Using a typed array instead of boolean flags means you can store
 * the actual amount and surface it clearly at checkout.
 */
export interface FeeItem {
  /** Human-readable label shown on the invoice, e.g. "Travel Fee" */
  label: string;
  amount: number;
  /**
   * When true the customer can decline this fee.
   * When false it is always applied (e.g. a mandatory platform surcharge).
   */
  isOptional: boolean;
}

/**
 * One tier in a multi-package offering (Basic / Standard / Premium).
 * When `tiers` is present it takes precedence over `basePrice`.
 */
export interface PricingTier {
  /** Stable identifier used in orders/bookings, e.g. "basic" */
  tierId: string;
  /** Display label, e.g. "Standard Package" */
  label: string;
  description?: string;
  basePrice: number;
  /** Relevant when pricingModel is "hourly" or the tier is time-bounded */
  durationMinutes?: number;
  /** Bullet-point list of what is included, shown to the customer */
  deliverables?: string[];
}

// ---------------------------------------------------------------------------
// Core pricing block
// ---------------------------------------------------------------------------

export interface ServicePricing {
  // --- Model & unit ---
  pricingModel: PricingModel;
  /**
   * Price for a single unit/session.
   * Ignored when `tiers` is provided; used directly otherwise.
   */
  basePrice?: number;
  /** Clarifies what one "unit" means, e.g. "hour", "session" */
  unit?: PricingUnit;

  // --- Tiered packages ---
  /**
   * When present the service offers multiple packages.
   * UI should render a tier selector; orders must reference a tierId.
   */
  tiers?: PricingTier[];

  // --- Add-on fees (replaces the old boolean flags) ---
  /**
   * Each fee carries its own label, amount, and optionality.
   * Replaces the previous `includeTravelFee` / `includeAdditionalFees`
   * boolean fields that stored existence but not value.
   */
  additionalFees?: FeeItem[];

  // --- Tax ---
  /** e.g. 0.15 for 15% VAT / GST. Omit or set 0 if not applicable. */
  taxRate?: number;
  /**
   * True  → displayed price already includes tax (gross pricing).
   * False → tax is added on top at checkout (net pricing).
   */
  taxIncluded: boolean;

  // --- Negotiation floor ---
  /**
   * Only relevant when pricingModel === "negotiable".
   * Prevents customers from submitting offers below this floor.
   */
  minimumPrice?: number;

  // --- Discount / promotions ---
  discount?: {
    /** Percentage discount, e.g. 0.10 for 10% off */
    rate?: number;
    /** Fixed amount off, e.g. 5.00 */
    amount?: number;
    /** ISO 8601 expiry; discount is ignored after this date */
    expiresAt?: Date;
    /** Optional coupon / promo code that triggers this discount */
    promoCode?: string;
  };

  // --- Currency ---
  /** ISO 4217 currency code, e.g. "USD", "GBP", "NGN" */
  currency: string;

  // --- Commission (audit snapshot only) ---
  /**
   * The platform commission rate that was active when this listing was
   * created or last updated. Used for historical audit purposes.
   *
   * The live/authoritative rate must always come from your platform
   * configuration service — NOT from this field. Storing it per-document
   * was the previous design flaw (mass updates required on rate changes).
   */
  commissionRateSnapshot: number;

  // --- Provider notes ---
  /**
   * Free-text field for the provider to explain pricing nuances.
   * e.g. "Price varies based on travel distance and project complexity."
   */
  pricingNotes?: string;
}

// ---------------------------------------------------------------------------
// Service entity
// ---------------------------------------------------------------------------

export interface Service extends BaseEntity, SoftDeletable {
  title: string;
  description: string;
  slug: string;
  tags: string[];
  categoryId: Types.ObjectId;
  coverImage?: Types.ObjectId;

  /** A service belongs to exactly one provider — required, never optional */
  providerId: Types.ObjectId;

  /**
   * Full pricing configuration for this service.
   * Optional at the schema level to support draft/unpublished services,
   * but should be required before a service can be approved or auto-activated.
   */
  servicePricing?: ServicePricing;

  isPrivate: boolean;

  // --- Moderation ---
  submittedBy?: Types.ObjectId;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  rejectedAt?: Date;
  rejectionReason?: string;
  isActive?: boolean;

  /**
   * Set by the service layer when a service meets all auto-activation criteria
   * at create or update time. The scheduler calls processScheduledActivations()
   * on an interval; once this timestamp has passed and the service has not been
   * manually rejected, it is activated without admin intervention.
   *
   * Lifecycle:
   *   - Set to now + AUTO_ACTIVATION_DELAY_MS when criteria are first met.
   *   - Reset to now + delay on any substantive content change (title /
   *     description / pricing) so the admin has a fresh review window.
   *   - Cleared (set to null) when criteria are no longer met (e.g. pricing
   *     removed), when the scheduler fires, or when the service is manually
   *     approved / rejected / deleted.
   */
  scheduledActivationAt?: Date | null;
}

// ---------------------------------------------------------------------------
// Document methods
// ---------------------------------------------------------------------------

export interface ServiceMethods {
  softDelete(deletedBy?: Types.ObjectId): Promise<this>;
  restore(): Promise<this>;
  approve(approverId: Types.ObjectId): Promise<this>;
  reject(approverId: Types.ObjectId, reason: string): Promise<this>;
}

// ---------------------------------------------------------------------------
// Virtuals
// ---------------------------------------------------------------------------

export interface ServiceVirtuals {
  // --- Moderation state ---
  isApproved: boolean;
  isRejected: boolean;
  isPending: boolean;

  /**
   * True when the service has a future scheduledActivationAt and has not yet
   * been activated or rejected. Convenience flag for dashboard display.
   */
  isPendingAutoActivation: boolean;

  /**
   * What the provider takes home per base-price unit after commission.
   * Formula: basePrice × (1 − commissionRateSnapshot)
   * Returns null when servicePricing or basePrice is not set, or when
   * pricingModel is "free" / "negotiable".
   *
   * Kept as a virtual (not stored) so it never drifts out of sync
   * when basePrice or commissionRateSnapshot is updated.
   */
  providerEarnings: number | null;

  /**
   * The all-in price shown to the customer before optional fees.
   * Formula: basePrice + mandatory additionalFees + tax (if !taxIncluded)
   * Returns null when servicePricing or basePrice is absent.
   */
  effectivePrice: number | null;

  /**
   * True when this service has multi-tier (package) pricing.
   * Convenience flag for UI rendering decisions.
   */
  hasTiers: boolean;
}

// ---------------------------------------------------------------------------
// Model (static methods)
// ---------------------------------------------------------------------------

export interface ServiceModel
  extends Model<Service, {}, ServiceMethods, ServiceVirtuals> {
  findActive(): Query<ServiceDocument[], ServiceDocument>;
  findByCategory(categoryId: string): Query<ServiceDocument[], ServiceDocument>;
  findByProvider(providerId: string): Query<ServiceDocument[], ServiceDocument>;
  searchServices(
    searchTerm: string,
    filters?: {
      categoryId?: string;
      providerId?: string;
      minPrice?: number;
      maxPrice?: number;
      pricingModel?: PricingModel;
      currency?: string;
    }
  ): Query<ServiceDocument[], ServiceDocument>;
}

// ---------------------------------------------------------------------------
// Hydrated document type
// ---------------------------------------------------------------------------

export type ServiceDocument = HydratedDocument<
  Service,
  ServiceMethods & ServiceVirtuals
>;