// routes/files/providerImages.routes.ts
import { Router } from "express";
import { initCloudinaryService } from "../../config/cloudinary.config";
import { CloudinaryFileController } from "../../controllers/files/cl.file.controller";
import { MongoDBFileController } from "../../controllers/files/db.file.controller";
import { authenticateToken } from "../../middleware/auth/auth.middleware";
import { requireProviderOwnership } from "../../middleware/role/ownership.middleware";

// ─── Provider Image Routes ────────────────────────────────────────────────────
//
// Two distinct image types live on ProviderProfile, handled in one route file:
//
//   Gallery images (businessGalleryImages)
//   ─────────────────────────────────────
//   Publicly readable — browsing clients can view a provider's portfolio.
//   Write operations (upload, archive, delete) require auth + ownership.
//
//   ID document images (idDetails.fileImageId)
//   ──────────────────────────────────────────
//   Fully private — only the owning provider and admins may access.
//   Every route requires auth + ownership.
//
// Both types use linked upload mode — ProviderProfile must exist before files
// are attached. The providerProfileId is always present in the URL or derived
// from the authenticated user's context at upload time.

const router = Router();

const cloudinaryConfig  = initCloudinaryService();
const cloudinaryCtrl    = new CloudinaryFileController(cloudinaryConfig);
const mongoCtrl         = new MongoDBFileController();
const { uploadMiddleware } = cloudinaryCtrl;

// ════════════════════════════════════════════════════════════════════════════
// GALLERY IMAGES
// ════════════════════════════════════════════════════════════════════════════

// ── Cloudinary upload ────────────────────────────────────────────────────────

router.post(
  "/cloudinary/provider-gallery",
  authenticateToken,
  uploadMiddleware.single("image"),
  cloudinaryCtrl.uploadProviderGalleryImage
);

// ── Entity-scoped Cloudinary routes ──────────────────────────────────────────

// Public — no authentication required
router.get(
  "/providers/:providerProfileId/gallery/public",
  cloudinaryCtrl.getPublicProviderGalleryImage
);

router.get(
  "/providers/:providerProfileId/gallery/optimized",
  cloudinaryCtrl.getOptimizedProviderGalleryImage
);

// Authenticated
router.get(
  "/providers/:providerProfileId/gallery",
  authenticateToken,
  cloudinaryCtrl.getProviderGalleryImage
);

router.delete(
  "/providers/:providerProfileId/gallery",
  authenticateToken,
  requireProviderOwnership,
  cloudinaryCtrl.deleteProviderGalleryImage
);

// ── MongoDB record management (gallery) ──────────────────────────────────────

// Public record read
router.get(
  "/providers/:providerProfileId/gallery/record/public",
  mongoCtrl.getPublicProviderGalleryRecord
);

// Authenticated record operations
router.get(
  "/providers/:providerProfileId/gallery/record",
  authenticateToken,
  mongoCtrl.getProviderGalleryRecord
);

router.get(
  "/providers/:providerProfileId/gallery/history",
  authenticateToken,
  mongoCtrl.getProviderGalleryHistory
);

router.patch(
  "/providers/:providerProfileId/gallery/metadata",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.updateProviderGalleryMetadata
);

router.post(
  "/providers/:providerProfileId/gallery/archive",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.archiveProviderGallery
);

router.post(
  "/providers/:providerProfileId/gallery/restore/:fileId",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.restoreProviderGallery
);

router.delete(
  "/providers/:providerProfileId/gallery/db",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.deleteProviderGallery
);

router.get(
  "/providers/:providerProfileId/gallery/stats",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.getProviderGalleryStats
);

router.delete(
  "/providers/:providerProfileId/gallery/cleanup",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.cleanupArchivedProviderGallery
);

// ════════════════════════════════════════════════════════════════════════════
// ID DOCUMENT IMAGES  (fully private — no public routes)
// ════════════════════════════════════════════════════════════════════════════

// ── Cloudinary upload ────────────────────────────────────────────────────────

router.post(
  "/cloudinary/provider-id-image",
  authenticateToken,
  uploadMiddleware.single("image"),
  cloudinaryCtrl.uploadProviderIdImage
);

// ── Entity-scoped Cloudinary routes ──────────────────────────────────────────

router.get(
  "/providers/:providerProfileId/id-image",
  authenticateToken,
  requireProviderOwnership,
  cloudinaryCtrl.getProviderIdImage
);

router.delete(
  "/providers/:providerProfileId/id-image",
  authenticateToken,
  requireProviderOwnership,
  cloudinaryCtrl.deleteProviderIdImage
);

// ── MongoDB record management (ID images) ────────────────────────────────────

router.get(
  "/providers/:providerProfileId/id-image/record",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.getProviderIdImageRecord
);

router.get(
  "/providers/:providerProfileId/id-image/history",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.getProviderIdImageHistory
);

router.patch(
  "/providers/:providerProfileId/id-image/metadata",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.updateProviderIdImageMetadata
);

router.post(
  "/providers/:providerProfileId/id-image/archive",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.archiveProviderIdImage
);

router.post(
  "/providers/:providerProfileId/id-image/restore/:fileId",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.restoreProviderIdImage
);

router.delete(
  "/providers/:providerProfileId/id-image/db",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.deleteProviderIdImage
);

router.get(
  "/providers/:providerProfileId/id-image/stats",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.getProviderIdImageStats
);

router.delete(
  "/providers/:providerProfileId/id-image/cleanup",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.cleanupArchivedProviderIdImages
);

export default router;

