// routes/client.profile.routes.ts
import { Router } from "express";
import {
  authenticateToken,
  requireVerification,
  requireAdmin,
} from "../../middleware/auth/auth.middleware";
import {
  getMyClientProfile,
  getClientProfileById,
  getProfileReadyStatus,
  updateClientProfile,
  updatePersonalInfo,
  updatePreferences,
  getDefaultAddress,
  setDefaultAddress,
  addSavedAddress,
  updateSavedAddress,
  removeSavedAddress,
  getProvidersNearClient,
  getFavoriteServices,
  addFavoriteService,
  removeFavoriteService,
  getFavoriteProviders,
  addFavoriteProvider,
  removeFavoriteProvider,
  getBookingHistory,
  getTaskHistory,
  getActivitySummary,
  deleteClientProfile,
  restoreClientProfile,
  getAllClients,
  getClientStats,
  getClientProfileByRefAdmin,
  verifyClient,
  adminDeleteClient,
  adminRestoreClient,
  updateContactInfo,
  updateIdImages,
  removeIdImage,
} from "../../controllers/profiles/client/client.profile.controller";
import { requireClientOwnership } from "../../middleware/role/ownership.middleware";
import { requireCustomer } from "../../middleware/role/role.middleware";

const router = Router();

// ─── Middleware Chains ────────────────────────────────────────────────────────

/** Requires a valid JWT and a verified email address */
const authenticated = [authenticateToken, requireVerification];

/** Requires authentication + customer role (role middleware also attaches userProfileId) */
const customerOnly = [...authenticated, requireCustomer];

/** Requires authentication + admin or super-admin system role */
const adminOnly = [...authenticated, requireAdmin];

/**
 * Requires customer role + ownership of the :profileId in the route.
 * requireClientOwnership verifies ClientProfile.profile === caller's UserProfile._id.
 * Admins bypass the ownership check automatically.
 */
const clientOwner = [...customerOnly, requireClientOwnership];

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER-AUTHENTICATED ROUTES
// Static segments declared before parameterised ones to prevent route collision.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /clients/me
 * Returns the calling customer's full profile, resolved via their UserProfile._id.
 */
router.get("/me", ...customerOnly, getMyClientProfile);

/**
 * GET /clients/:profileId
 * Profile view. Pass ?populate=true for populated sub-documents.
 * Protected — clients can only view their own profile; admins can view any.
 */
router.get("/:profileId", ...clientOwner, getClientProfileById);

/**
 * GET /clients/:profileId/profile-status
 * Onboarding checklist: returns isReady and missingFields.
 */
router.get("/:profileId/profile-status", ...clientOwner, getProfileReadyStatus);

/**
 * PUT /clients/:profileId
 * General-purpose field update. Use the isolated endpoints below for
 * sub-documents that require validation or enrichment.
 */
router.put("/:profileId", ...clientOwner, updateClientProfile);

/**
 * PUT /clients/:profileId/contact
 * Replace clientContactInfo as a unit.
 */
router.put("/:profileId/contact", ...clientOwner, updateContactInfo);

/**
 * PUT /clients/:profileId/personal
 * Update preferredName and/or dateOfBirth.
 */
router.put("/:profileId/personal", ...clientOwner, updatePersonalInfo);

/**
 * PUT /clients/:profileId/preferences
 * Merge individual preference fields (dot-notation $set — does not overwrite
 * the entire preferences sub-document).
 */
router.put("/:profileId/preferences", ...clientOwner, updatePreferences);

// ─── ID Document Images ───────────────────────────────────────────────────────

/**
 * POST /clients/:profileId/id-images
 * Attach government ID document images. Requires idDetails metadata to be set
 * first via PUT /clients/:profileId.
 * Body: { fileIds: string[] }
 */
router.post("/:profileId/id-images", ...clientOwner, updateIdImages);

/**
 * DELETE /clients/:profileId/id-images/:fileId
 * Remove a single ID image. Does NOT delete the underlying File document.
 */
router.delete("/:profileId/id-images/:fileId", ...clientOwner, removeIdImage);

// ─── Saved Addresses ──────────────────────────────────────────────────────────

/**
 * GET /clients/:profileId/addresses/default
 * Returns the client's current default saved address (or null if none set).
 * Declared before /:addressId to prevent collision.
 */
router.get("/:profileId/addresses/default", ...clientOwner, getDefaultAddress);

/**
 * PUT /clients/:profileId/addresses/default
 * Sets the default address by index.
 * Body: { index: number }
 * Declared before /:addressId to prevent collision.
 */
router.put("/:profileId/addresses/default", ...clientOwner, setDefaultAddress);

/**
 * POST /clients/:profileId/addresses
 * Enrich and append a new address via Ghana Post GPS code.
 * Body: { ghanaPostGPS, label?, nearbyLandmark?, gpsCoordinates? }
 */
router.post("/:profileId/addresses", ...clientOwner, addSavedAddress);

/**
 * PUT /clients/:profileId/addresses/:addressId
 * Re-enrich and update a specific saved address by its sub-document _id.
 */
router.put(
  "/:profileId/addresses/:addressId",
  ...clientOwner,
  updateSavedAddress,
);

/**
 * DELETE /clients/:profileId/addresses/:addressId
 * Remove a saved address. Automatically adjusts defaultAddressIndex.
 */
router.delete(
  "/:profileId/addresses/:addressId",
  ...clientOwner,
  removeSavedAddress,
);

// ─── Nearby Provider Discovery ────────────────────────────────────────────────

/**
 * GET /clients/:profileId/nearby-providers
 * Returns providers near the client's default (or specified) saved address,
 * sorted nearest-first with distanceKm attached.
 *
 * Query params: addressIndex?, radiusKm?, serviceId?, isAlwaysAvailable?, limit?
 */
router.get(
  "/:profileId/nearby-providers",
  ...clientOwner,
  getProvidersNearClient,
);

// ─── Favourites: Services ─────────────────────────────────────────────────────

/**
 * GET /clients/:profileId/favorites/services
 * Returns populated favourite service documents (active only).
 */
router.get(
  "/:profileId/favorites/services",
  ...clientOwner,
  getFavoriteServices,
);

/**
 * POST /clients/:profileId/favorites/services/:serviceId
 * Add a service to favourites (idempotent).
 */
router.post(
  "/:profileId/favorites/services/:serviceId",
  ...clientOwner,
  addFavoriteService,
);

/**
 * DELETE /clients/:profileId/favorites/services/:serviceId
 * Remove a service from favourites.
 */
router.delete(
  "/:profileId/favorites/services/:serviceId",
  ...clientOwner,
  removeFavoriteService,
);

// ─── Favourites: Providers ────────────────────────────────────────────────────

/**
 * GET /clients/:profileId/favorites/providers
 * Returns populated favourite provider documents.
 * Pass ?fromLat + ?fromLng for distance-annotated, nearest-first results.
 */
router.get(
  "/:profileId/favorites/providers",
  ...clientOwner,
  getFavoriteProviders,
);

/**
 * POST /clients/:profileId/favorites/providers/:providerProfileId
 * Add a provider to favourites (idempotent).
 */
router.post(
  "/:profileId/favorites/providers/:providerProfileId",
  ...clientOwner,
  addFavoriteProvider,
);

/**
 * DELETE /clients/:profileId/favorites/providers/:providerProfileId
 * Remove a provider from favourites.
 */
router.delete(
  "/:profileId/favorites/providers/:providerProfileId",
  ...clientOwner,
  removeFavoriteProvider,
);

// ─── Activity History ─────────────────────────────────────────────────────────

/**
 * GET /clients/:profileId/bookings
 * Booking history. Query params: status?, limit?, skip?
 */
router.get("/:profileId/bookings", ...clientOwner, getBookingHistory);

/**
 * GET /clients/:profileId/tasks
 * Task history. Query params: status?, limit?, skip?
 */
router.get("/:profileId/tasks", ...clientOwner, getTaskHistory);

/**
 * GET /clients/:profileId/activity-summary
 * Count summary of bookings + tasks for the dashboard header.
 */
router.get("/:profileId/activity-summary", ...clientOwner, getActivitySummary);

// ─────────────────────────────────────────────────────────────────────────────
// SOFT DELETE / RESTORE — authenticated owner or admin
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DELETE /clients/:profileId
 * Soft-delete. Admin-only on this route — clients deactivate via account
 * deletion flow, not direct profile delete.
 */
router.delete("/:profileId", ...adminOnly, deleteClientProfile);

/**
 * POST /clients/:profileId/restore
 * Restore a soft-deleted client profile. Admin-only.
 */
router.post("/:profileId/restore", ...adminOnly, restoreClientProfile);

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN-ONLY ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /clients/admin/all
 * Paginated list of all clients. ?includeDeleted=true for soft-deleted.
 */
router.get("/admin/all", ...adminOnly, getAllClients);

/**
 * GET /clients/admin/stats
 * Platform-wide stats. Pass ?clientId= to scope to one client.
 */
router.get("/admin/stats", ...adminOnly, getClientStats);

/**
 * GET /clients/admin/ref/:userProfileId
 * Look up a ClientProfile by its parent UserProfile._id.
 */
router.get(
  "/admin/ref/:userProfileId",
  ...adminOnly,
  getClientProfileByRefAdmin,
);

/**
 * PUT /clients/admin/:profileId/verify
 * Mark the client as verified (KYC / phone verification).
 * Body: { phoneVerified, emailVerified, idVerified, verifiedAt? }
 */
router.put("/admin/:profileId/verify", ...adminOnly, verifyClient);

/**
 * DELETE /clients/admin/:profileId
 * Admin soft-delete a client profile.
 */
router.delete("/admin/:profileId", ...adminOnly, adminDeleteClient);

/**
 * POST /clients/admin/:profileId/restore
 * Restore a soft-deleted client profile.
 */
router.post("/admin/:profileId/restore", ...adminOnly, adminRestoreClient);

export default router;
