// routes/files/providerImages.routes.ts
import { Router } from "express";
import { initCloudinaryService } from "../../config/cloudinary.config";
import { CloudinaryFileController } from "../../controllers/files/cl.file.controller";
import { MongoDBFileController } from "../../controllers/files/db.file.controller";
import { authenticateToken } from "../../middleware/auth/auth.middleware";
import { requireProviderOwnership } from "../../middleware/role/ownership.middleware";

// ─── Provider Image Routes ────────────────────────────────────────────────────
//
// Two distinct image types live on ProviderProfile, both backed by ARRAY fields:
//
//   Gallery images (businessGalleryImages)
//   ─────────────────────────────────────
//   Publicly readable — browsing clients can view a provider's portfolio.
//   Write operations (upload, archive, delete) require auth + ownership.
//   Supports single and multi-file upload; all uploads accumulate in the array.
//   Delete requires :fileId to target a specific gallery entry.
//
//   ID document images (idDetails.fileImageId)
//   ──────────────────────────────────────────
//   Fully private — only the owning provider and admins may access.
//   Supports single and multi-file upload (e.g. front + back of ID).
//   Delete requires :fileId to target a specific entry.
//   Every route requires auth + ownership.

const router = Router();

const cloudinaryConfig = initCloudinaryService();
const cloudinaryCtrl = new CloudinaryFileController(cloudinaryConfig);
const mongoCtrl = new MongoDBFileController();
const { uploadMiddleware } = cloudinaryCtrl;

// ════════════════════════════════════════════════════════════════════════════
// GALLERY IMAGES
// ════════════════════════════════════════════════════════════════════════════

// ── Cloudinary upload ────────────────────────────────────────────────────────

// Single image — appends to businessGalleryImages
router.post(
  "/cloudinary/provider-gallery",
  authenticateToken,
  uploadMiddleware.single("image"),
  cloudinaryCtrl.uploadProviderGalleryImage,
);

// Multiple images — appends all to businessGalleryImages in one request
// Field name must be "images"; client sends multipart/form-data with up to 10 files
router.post(
  "/cloudinary/provider-gallery-images",
  authenticateToken,
  uploadMiddleware.array("images", 10),
  cloudinaryCtrl.uploadMultipleProviderGalleryImages,
);

// ── Entity-scoped Cloudinary routes ──────────────────────────────────────────

// Public — no authentication required; returns all active gallery images
router.get(
  "/providers/:providerProfileId/gallery/public",
  cloudinaryCtrl.getPublicProviderGalleryImage,
);

// Returns a transformation URL for one specific gallery image
// :fileId identifies the image; query params: width, quality, format
router.get(
  "/providers/:providerProfileId/gallery/optimized/:fileId",
  cloudinaryCtrl.getOptimizedProviderGalleryImage,
);

// Authenticated — returns all active gallery image records
router.get(
  "/providers/:providerProfileId/gallery",
  authenticateToken,
  cloudinaryCtrl.getProviderGalleryImage,
);

// Deletes a specific gallery image (Cloudinary asset + MongoDB record)
// :fileId identifies which entry in businessGalleryImages to remove
router.delete(
  "/providers/:providerProfileId/gallery/:fileId",
  authenticateToken,
  requireProviderOwnership,
  cloudinaryCtrl.deleteProviderGalleryImage,
);

// ── MongoDB record management (gallery) ──────────────────────────────────────

// Public record read — returns all active gallery records
router.get(
  "/providers/:providerProfileId/gallery/record/public",
  mongoCtrl.getPublicProviderGalleryRecord,
);

// Returns all active records and marks them accessed
router.get(
  "/providers/:providerProfileId/gallery/record",
  authenticateToken,
  mongoCtrl.getProviderGalleryRecord,
);

// Returns active list + paginated archived records
router.get(
  "/providers/:providerProfileId/gallery/history",
  authenticateToken,
  mongoCtrl.getProviderGalleryHistory,
);

// Updates description/tags on one specific gallery record
router.patch(
  "/providers/:providerProfileId/gallery/metadata/:fileId",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.updateProviderGalleryMetadata,
);

// Soft-archives one specific gallery record (pulls it from businessGalleryImages)
router.post(
  "/providers/:providerProfileId/gallery/archive/:fileId",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.archiveProviderGallery,
);

// Restores one archived gallery record (re-adds it to businessGalleryImages)
router.post(
  "/providers/:providerProfileId/gallery/restore/:fileId",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.restoreProviderGallery,
);

// Hard-deletes one specific gallery record only (Cloudinary asset untouched)
router.delete(
  "/providers/:providerProfileId/gallery/db/:fileId",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.deleteProviderGallery,
);

router.get(
  "/providers/:providerProfileId/gallery/stats",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.getProviderGalleryStats,
);

router.delete(
  "/providers/:providerProfileId/gallery/cleanup",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.cleanupArchivedProviderGallery,
);

// ════════════════════════════════════════════════════════════════════════════
// ID DOCUMENT IMAGES  (fully private — no public routes)
// ════════════════════════════════════════════════════════════════════════════

// ── Cloudinary upload ────────────────────────────────────────────────────────

// Single image — appends to idDetails.fileImageId
router.post(
  "/cloudinary/provider-id-image",
  authenticateToken,
  uploadMiddleware.single("image"),
  cloudinaryCtrl.uploadProviderIdImage,
);

// Multiple images — appends all to idDetails.fileImageId in one request
// Field name must be "images"; client sends multipart/form-data with up to 5 files
router.post(
  "/cloudinary/provider-id-images",
  authenticateToken,
  uploadMiddleware.array("images", 5),
  cloudinaryCtrl.uploadMultipleProviderIdImages,
);

// ── Entity-scoped Cloudinary routes ──────────────────────────────────────────

// Returns all active ID image records
router.get(
  "/providers/:providerProfileId/id-image",
  authenticateToken,
  requireProviderOwnership,
  cloudinaryCtrl.getProviderIdImage,
);

// Deletes a specific ID image (Cloudinary asset + MongoDB record)
// :fileId identifies which entry in idDetails.fileImageId to remove
router.delete(
  "/providers/:providerProfileId/id-image/:fileId",
  authenticateToken,
  requireProviderOwnership,
  cloudinaryCtrl.deleteProviderIdImage,
);

// ── MongoDB record management (ID images) ────────────────────────────────────

// Returns all active ID image records and marks them accessed
router.get(
  "/providers/:providerProfileId/id-image/record",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.getProviderIdImageRecord,
);

// Returns active list + paginated archived records
router.get(
  "/providers/:providerProfileId/id-image/history",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.getProviderIdImageHistory,
);

// Updates description/tags on one specific ID image record
router.patch(
  "/providers/:providerProfileId/id-image/metadata/:fileId",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.updateProviderIdImageMetadata,
);

// Soft-archives one specific ID image record (pulls it from idDetails.fileImageId)
router.post(
  "/providers/:providerProfileId/id-image/archive/:fileId",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.archiveProviderIdImage,
);

// Restores one archived ID image record (re-adds it to idDetails.fileImageId)
router.post(
  "/providers/:providerProfileId/id-image/restore/:fileId",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.restoreProviderIdImage,
);

// Hard-deletes one specific ID image record only (Cloudinary asset untouched)
router.delete(
  "/providers/:providerProfileId/id-image/db/:fileId",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.deleteProviderIdImage,
);

router.get(
  "/providers/:providerProfileId/id-image/stats",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.getProviderIdImageStats,
);

router.delete(
  "/providers/:providerProfileId/id-image/cleanup",
  authenticateToken,
  requireProviderOwnership,
  mongoCtrl.cleanupArchivedProviderIdImages,
);

export default router;
