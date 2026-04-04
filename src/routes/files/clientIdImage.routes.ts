// routes/files/clientIdImage.routes.ts
import { Router } from "express";
import { initCloudinaryService } from "../../config/cloudinary.config";
import { CloudinaryFileController } from "../../controllers/files/cl.file.controller";
import { MongoDBFileController } from "../../controllers/files/db.file.controller";
import { authenticateToken } from "../../middleware/auth/auth.middleware";
import { requireClientOwnership } from "../../middleware/role/ownership.middleware";

// ─── Client ID Image Routes ───────────────────────────────────────────────────
//
// idDetails.fileImageId is an ARRAY — clients may hold multiple ID document
// images at once (e.g. front + back of a national ID).
//
// All routes are private — ID documents must never be served publicly.
// Every route requires:
//   authenticateToken      → populates req.userId + req.user
//   requireClientOwnership → verifies req.user owns the :clientProfileId
//
// Cloudinary routes (asset + MongoDB record together):
//   POST   /cloudinary/client-id-image              upload one image (appends to array)
//   POST   /cloudinary/client-id-images             upload multiple images at once
//   GET    /clients/:clientProfileId/id-image        get all active records
//   DELETE /clients/:clientProfileId/id-image/:fileId full delete of one specific image
//
// MongoDB-only routes (record management, Cloudinary asset untouched):
//   GET    /clients/:clientProfileId/id-image/record              get all active records + mark accessed
//   GET    /clients/:clientProfileId/id-image/history             active list + archive list
//   PATCH  /clients/:clientProfileId/id-image/metadata/:fileId    update tags/description on one record
//   POST   /clients/:clientProfileId/id-image/archive/:fileId     soft-archive one specific record
//   POST   /clients/:clientProfileId/id-image/restore/:fileId     restore an archived record
//   DELETE /clients/:clientProfileId/id-image/db/:fileId          hard-delete one record only
//   GET    /clients/:clientProfileId/id-image/stats               storage stats
//   DELETE /clients/:clientProfileId/id-image/cleanup             purge old archives

const router = Router();

const cloudinaryConfig = initCloudinaryService();
const cloudinaryCtrl = new CloudinaryFileController(cloudinaryConfig);
const mongoCtrl = new MongoDBFileController();
const { uploadMiddleware } = cloudinaryCtrl;

// ── Cloudinary upload ─────────────────────────────────────────────────────────

// Single image — appends to idDetails.fileImageId
router.post(
  "/cloudinary/client-id-image",
  authenticateToken,
  uploadMiddleware.single("image"),
  cloudinaryCtrl.uploadClientIdImage,
);

// Multiple images — appends all to idDetails.fileImageId in one request
// Field name must be "images"; client sends multipart/form-data with up to 10 files
router.post(
  "/cloudinary/client-id-images",
  authenticateToken,
  uploadMiddleware.array("images", 10),
  cloudinaryCtrl.uploadMultipleClientIdImages,
);

// ── Entity-scoped Cloudinary routes ──────────────────────────────────────────

// Returns all active ID image records for this client
router.get(
  "/clients/:clientProfileId/id-image",
  authenticateToken,
  requireClientOwnership,
  cloudinaryCtrl.getClientIdImage,
);

// Deletes a specific image from the array (Cloudinary asset + MongoDB record)
// :fileId identifies which entry in idDetails.fileImageId to remove
router.delete(
  "/clients/:clientProfileId/id-image/:fileId",
  authenticateToken,
  requireClientOwnership,
  cloudinaryCtrl.deleteClientIdImage,
);

// ── MongoDB record management ─────────────────────────────────────────────────

// Returns all active records and marks them accessed
router.get(
  "/clients/:clientProfileId/id-image/record",
  authenticateToken,
  requireClientOwnership,
  mongoCtrl.getClientIdImageRecord,
);

// Returns active + paginated archived records
router.get(
  "/clients/:clientProfileId/id-image/history",
  authenticateToken,
  requireClientOwnership,
  mongoCtrl.getClientIdImageHistory,
);

// Updates description/tags on one specific record
router.patch(
  "/clients/:clientProfileId/id-image/metadata/:fileId",
  authenticateToken,
  requireClientOwnership,
  mongoCtrl.updateClientIdImageMetadata,
);

// Soft-archives one specific record (pulls it from idDetails.fileImageId)
router.post(
  "/clients/:clientProfileId/id-image/archive/:fileId",
  authenticateToken,
  requireClientOwnership,
  mongoCtrl.archiveClientIdImage,
);

// Restores one archived record (re-adds it to idDetails.fileImageId)
router.post(
  "/clients/:clientProfileId/id-image/restore/:fileId",
  authenticateToken,
  requireClientOwnership,
  mongoCtrl.restoreClientIdImage,
);

// Hard-deletes one specific record only (Cloudinary asset untouched)
router.delete(
  "/clients/:clientProfileId/id-image/db/:fileId",
  authenticateToken,
  requireClientOwnership,
  mongoCtrl.deleteClientIdImage,
);

router.get(
  "/clients/:clientProfileId/id-image/stats",
  authenticateToken,
  requireClientOwnership,
  mongoCtrl.getClientIdImageStats,
);

router.delete(
  "/clients/:clientProfileId/id-image/cleanup",
  authenticateToken,
  requireClientOwnership,
  mongoCtrl.cleanupArchivedClientIdImages,
);

export default router;
