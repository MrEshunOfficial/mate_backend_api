// routes/provider.profile.routes.ts
import { Router } from "express";
import {
  authenticateToken,
  requireVerification,
  requireAdmin,
} from "../../middleware/auth/auth.middleware";
import { searchProviders, getProvidersByLocation, getProvidersNearCoordinates, getProvidersByService, getServiceOfferings, getProviderProfileById, getMyProviderProfile, getProfileLiveStatus, updateProviderProfile, updateContactInfo, updateLocationData, checkLocationVerification, updateBusinessInfo, updateWorkingHours, setAvailability, updateDepositSettings, addServiceOffering, removeServiceOffering, addGalleryImages, reorderGalleryImages, removeGalleryImage, updateIdImages, replaceIdImages, removeIdImage, getAllProviders, getProviderStats, getProviderProfileByRef, verifyProviderAddress, setCompanyTrained, adminDeleteProvider, adminRestoreProvider, adminAddServiceOffering, adminRemoveServiceOffering } from "../../controllers/profiles/provider/provider.profile.controller";
import { requireProviderOwnership } from "../../middleware/role/ownership.middleware";
import { requireProvider } from "../../middleware/role/role.middleware";

const router = Router();

// ─── Middleware Chains ────────────────────────────────────────────────────────

/** Requires a valid JWT and a verified email address */
const authenticated = [authenticateToken, requireVerification];

/** Requires authentication + provider role (role middleware also attaches userProfileId) */
const providerOnly = [...authenticated, requireProvider];

/** Requires authentication + admin or super-admin system role */
const adminOnly = [...authenticated, requireAdmin];

/**
 * Requires provider role + ownership of the :profileId in the route.
 * requireProviderOwnership verifies ProviderProfile.profile === caller's UserProfile._id.
 * Admins bypass the ownership check automatically.
 */
const providerOwner = [...providerOnly, requireProviderOwnership];

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ROUTES — no authentication required
// Order matters: specific static segments before parameterised ones
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /providers/search
 * Multi-filter search with optional distance annotation.
 */
router.get("/search", searchProviders);

/**
 * GET /providers/by-location
 * Region + city filter (no distance calculation).
 */
router.get("/by-location", getProvidersByLocation);

/**
 * GET /providers/near
 * Geospatial proximity search via MongoDB $near.
 */
router.get("/near", getProvidersNearCoordinates);

/**
 * GET /providers/by-service/:serviceId
 * Providers whose serviceOfferings contain the given service.
 */
router.get("/by-service/:serviceId", getProvidersByService);

/**
 * GET /providers/:profileId/services
 * Public: active services only.
 * Owner / admin: can pass ?includeInactive=true.
 */
router.get("/:profileId/services", getServiceOfferings);

/**
 * GET /providers/:profileId
 * Public profile view. Pass ?populate=true for populated sub-documents.
 */
router.get("/:profileId", getProviderProfileById);

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER-AUTHENTICATED ROUTES — require valid JWT + provider role
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /providers/me
 * Returns the calling provider's full profile, resolved via their UserProfile._id.
 */
router.get("/me", ...providerOnly, getMyProviderProfile);

/**
 * GET /providers/:profileId/profile-status
 * Onboarding checklist: returns isLive and missingFields.
 * Owner and admins can call this; middleware chain enforces ownership.
 */
router.get("/:profileId/profile-status", ...providerOwner, getProfileLiveStatus);

/**
 * PUT /providers/:profileId
 * General-purpose field update. Prefer the isolated endpoints below for
 * sub-documents that require validation or enrichment.
 */
router.put("/:profileId", ...providerOwner, updateProviderProfile);

/**
 * PUT /providers/:profileId/contact
 * Replace providerContactInfo as a unit.
 */
router.put("/:profileId/contact", ...providerOwner, updateContactInfo);

/**
 * PUT /providers/:profileId/location
 * Enrich and persist location data from a Ghana Post GPS code.
 */
router.put("/:profileId/location", ...providerOwner, updateLocationData);

/**
 * POST /providers/:profileId/location/verify
 * Self-service: re-run enrichment to check if stored address is still accurate.
 * Does NOT stamp isAddressVerified — admin endpoint does that.
 */
router.post("/:profileId/location/verify", ...providerOwner, checkLocationVerification);

/**
 * PUT /providers/:profileId/business
 * Update businessName, idDetails metadata, and isCompanyTrained.
 */
router.put("/:profileId/business", ...providerOwner, updateBusinessInfo);

/**
 * PUT /providers/:profileId/working-hours
 * Replace the working hours map. Always sets isAlwaysAvailable: false.
 */
router.put("/:profileId/working-hours", ...providerOwner, updateWorkingHours);

/**
 * PUT /providers/:profileId/availability
 * Set isAlwaysAvailable mode and optionally working hours together.
 */
router.put("/:profileId/availability", ...providerOwner, setAvailability);

/**
 * PUT /providers/:profileId/deposit-settings
 * Update requireInitialDeposit and percentageDeposit as a unit.
 */
router.put("/:profileId/deposit-settings", ...providerOwner, updateDepositSettings);

// ─── Service Offerings (provider-managed) ─────────────────────────────────────

/**
 * POST /providers/:profileId/services/:serviceId
 * Link a service to this provider's profile (repair / admin utility).
 */
router.post("/:profileId/services/:serviceId", ...providerOwner, addServiceOffering);

/**
 * DELETE /providers/:profileId/services/:serviceId
 * Unlink a service from this provider's serviceOfferings.
 */
router.delete("/:profileId/services/:serviceId", ...providerOwner, removeServiceOffering);

// ─── Gallery Images ───────────────────────────────────────────────────────────

/**
 * POST /providers/:profileId/gallery
 * Append images to businessGalleryImages.
 * Body: { fileIds: string[] }
 */
router.post("/:profileId/gallery", ...providerOwner, addGalleryImages);

/**
 * PUT /providers/:profileId/gallery/reorder
 * Replace the gallery array with a caller-supplied ordered list.
 * Must be declared before /:profileId/gallery/:fileId to avoid route collision.
 */
router.put("/:profileId/gallery/reorder", ...providerOwner, reorderGalleryImages);

/**
 * DELETE /providers/:profileId/gallery/:fileId
 * Remove a single image from the gallery.
 */
router.delete("/:profileId/gallery/:fileId", ...providerOwner, removeGalleryImage);

// ─── ID Document Images ───────────────────────────────────────────────────────

/**
 * POST /providers/:profileId/id-images
 * Attach government ID images to idDetails.fileImageId[].
 * Requires idDetails metadata to be set first via PUT /business.
 * Body: { fileIds: string[] }
 */
router.post("/:profileId/id-images", ...providerOwner, updateIdImages);

/**
 * PUT /providers/:profileId/id-images/replace
 * Atomically replace all ID images with a new set.
 * Must be declared before /:profileId/id-images/:fileId to avoid collision.
 * Body: { fileIds: string[] }   — empty array clears all images
 */
router.put("/:profileId/id-images/replace", ...providerOwner, replaceIdImages);

/**
 * DELETE /providers/:profileId/id-images/:fileId
 * Remove a single ID image.
 */
router.delete("/:profileId/id-images/:fileId", ...providerOwner, removeIdImage);

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN-ONLY ROUTES — require valid JWT + ADMIN or SUPER_ADMIN system role
// Mount these under /admin/providers in the main app router:
//   app.use("/api/admin/providers", providerProfileAdminRouter)
// or keep them here under the same router if all routes are under /providers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /providers/admin/all
 * Paginated list of all providers. ?includeDeleted=true to include soft-deleted.
 */
router.get("/admin/all", ...adminOnly, getAllProviders);

/**
 * GET /providers/admin/stats
 * Platform-wide stats. Pass ?providerId= to scope to one provider.
 */
router.get("/admin/stats", ...adminOnly, getProviderStats);

/**
 * GET /providers/admin/ref/:userProfileId
 * Look up a ProviderProfile by its parent UserProfile._id.
 */
router.get("/admin/ref/:userProfileId", ...adminOnly, getProviderProfileByRef);

/**
 * PUT /providers/admin/:profileId/verify-address
 * Stamp isAddressVerified = true after a human has confirmed the address.
 */
router.put("/admin/:profileId/verify-address", ...adminOnly, verifyProviderAddress);

/**
 * PUT /providers/admin/:profileId/company-trained
 * Set or clear the isCompanyTrained flag.
 * Body: { isCompanyTrained: boolean }
 */
router.put("/admin/:profileId/company-trained", ...adminOnly, setCompanyTrained);

/**
 * DELETE /providers/admin/:profileId
 * Admin soft-delete a provider profile.
 */
router.delete("/admin/:profileId", ...adminOnly, adminDeleteProvider);

/**
 * POST /providers/admin/:profileId/restore
 * Restore a soft-deleted provider profile.
 */
router.post("/admin/:profileId/restore", ...adminOnly, adminRestoreProvider);

/**
 * POST /providers/admin/:profileId/services/:serviceId
 * Admin: force-link a service (bypasses ownership guard).
 */
router.post(
  "/admin/:profileId/services/:serviceId",
  ...adminOnly,
  adminAddServiceOffering
);

/**
 * DELETE /providers/admin/:profileId/services/:serviceId
 * Admin: force-unlink a service.
 */
router.delete(
  "/admin/:profileId/services/:serviceId",
  ...adminOnly,
  adminRemoveServiceOffering
);

export default router;