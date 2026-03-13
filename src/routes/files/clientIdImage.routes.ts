// routes/files/clientIdImage.routes.ts
import { Router } from "express";
import { initCloudinaryService } from "../../config/cloudinary.config";
import { CloudinaryFileController } from "../../controllers/files/cl.file.controller";
import { MongoDBFileController } from "../../controllers/files/db.file.controller";
import { authenticateToken } from "../../middleware/auth/auth.middleware";
import { requireClientOwnership } from "../../middleware/role/ownership.middleware";

// ─── Client ID Image Routes ───────────────────────────────────────────────────
//
// All routes are private — ID documents must never be served publicly.
// Every route requires:
//   authenticate          → populates req.userId + req.user
//   requireClientOwnership → verifies req.user owns the :clientProfileId
//
// Cloudinary routes (asset + MongoDB record together):
//   POST   /cloudinary/client-id-image              upload (linked mode)
//   GET    /clients/:clientProfileId/id-image        get active record
//   DELETE /clients/:clientProfileId/id-image        full delete
//
// MongoDB-only routes (record management, asset untouched):
//   GET    /clients/:clientProfileId/id-image/record          get + mark accessed
//   GET    /clients/:clientProfileId/id-image/history         active + archive list
//   PATCH  /clients/:clientProfileId/id-image/metadata        update tags/description
//   POST   /clients/:clientProfileId/id-image/archive         soft-archive record
//   POST   /clients/:clientProfileId/id-image/restore/:fileId restore archived record
//   DELETE /clients/:clientProfileId/id-image/db              hard-delete record only
//   GET    /clients/:clientProfileId/id-image/stats           storage stats
//   DELETE /clients/:clientProfileId/id-image/cleanup         purge old archives

const router = Router();

const cloudinaryConfig  = initCloudinaryService();
const cloudinaryCtrl    = new CloudinaryFileController(cloudinaryConfig);
const mongoCtrl         = new MongoDBFileController();
const { uploadMiddleware } = cloudinaryCtrl;

// ── Cloudinary upload (no :clientProfileId in URL — entityId comes from auth) ──

router.post(
  "/cloudinary/client-id-image",
  authenticateToken,
  uploadMiddleware.single("image"),
  cloudinaryCtrl.uploadClientIdImage
);

// ── Entity-scoped routes ──────────────────────────────────────────────────────

router.get(
  "/clients/:clientProfileId/id-image",
  authenticateToken,
  requireClientOwnership,
  cloudinaryCtrl.getClientIdImage
);

router.delete(
  "/clients/:clientProfileId/id-image",
  authenticateToken,
  requireClientOwnership,
  cloudinaryCtrl.deleteClientIdImage
);

// ── MongoDB record management ─────────────────────────────────────────────────

router.get(
  "/clients/:clientProfileId/id-image/record",
  authenticateToken,
  requireClientOwnership,
  mongoCtrl.getClientIdImageRecord
);

router.get(
  "/clients/:clientProfileId/id-image/history",
  authenticateToken,
  requireClientOwnership,
  mongoCtrl.getClientIdImageHistory
);

router.patch(
  "/clients/:clientProfileId/id-image/metadata",
  authenticateToken,
  requireClientOwnership,
  mongoCtrl.updateClientIdImageMetadata
);

router.post(
  "/clients/:clientProfileId/id-image/archive",
  authenticateToken,
  requireClientOwnership,
  mongoCtrl.archiveClientIdImage
);

router.post(
  "/clients/:clientProfileId/id-image/restore/:fileId",
  authenticateToken,
  requireClientOwnership,
  mongoCtrl.restoreClientIdImage
);

router.delete(
  "/clients/:clientProfileId/id-image/db",
  authenticateToken,
  requireClientOwnership,
  mongoCtrl.deleteClientIdImage
);

router.get(
  "/clients/:clientProfileId/id-image/stats",
  authenticateToken,
  requireClientOwnership,
  mongoCtrl.getClientIdImageStats
);

router.delete(
  "/clients/:clientProfileId/id-image/cleanup",
  authenticateToken,
  requireClientOwnership,
  mongoCtrl.cleanupArchivedClientIdImages
);

export default router;

