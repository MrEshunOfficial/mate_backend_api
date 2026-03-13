import { Router } from "express";
import { initCloudinaryService } from "../../config/cloudinary.config";
import { CloudinaryFileController } from "../../controllers/files/cl.file.controller";
import { MongoDBFileController } from "../../controllers/files/db.file.controller";
import { authenticateToken } from "../../middleware/auth/auth.middleware";

const router = Router();

const cloudinaryController = new CloudinaryFileController(initCloudinaryService());
const mongoController = new MongoDBFileController();

// ─────────────────────────────────────────────────────────────────────────────
// CLOUDINARY  —  upload / read / delete / optimize
// ─────────────────────────────────────────────────────────────────────────────

// Upload (replaces any existing active picture)
router.post(
  "/cloudinary/new",
  authenticateToken,
  cloudinaryController.uploadMiddleware.single("file"),
  cloudinaryController.uploadProfilePicture
);

// Optimized URL — declared before /:userId to avoid param capture
router.get(
  "/cloudinary/optimized",
  authenticateToken,
  cloudinaryController.getOptimizedProfilePicture
);

// Authenticated user's own picture
router.get(
  "/cloudinary/me",
  authenticateToken,
  cloudinaryController.getProfilePicture
);

// Any user's picture by userId (public-safe fields)
router.get(
  "/cloudinary/:userId",
  authenticateToken,
  cloudinaryController.getPublicProfilePicture
);

// Deletes from Cloudinary + MongoDB + unlinks from profile
router.delete(
  "/cloudinary/me",
  authenticateToken,
  cloudinaryController.deleteProfilePicture
);

// ─────────────────────────────────────────────────────────────────────────────
// MONGODB  —  metadata / history / stats / archive / restore / cleanup
//
// NOTE: specific sub-paths are declared before the bare /:userId wildcard so
// Express matches them first.
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/history",
  authenticateToken,
  mongoController.getProfilePictureHistory
);

router.get(
  "/stats",
  authenticateToken,
  mongoController.getProfilePictureStats
);

router.put(
  "/metadata",
  authenticateToken,
  mongoController.updateProfilePictureMetadata
);

router.post(
  "/archive",
  authenticateToken,
  mongoController.archiveProfilePicture
);

router.post(
  "/restore/:fileId",
  authenticateToken,
  mongoController.restoreProfilePicture
);

// DELETE so it doesn't collide with the bare DELETE /profile-picture below
router.delete(
  "/cleanup",
  authenticateToken,
  mongoController.cleanupArchivedProfilePictures
);

// Any user's active record by userId — after all fixed sub-paths
router.get(
  "/:userId",
  authenticateToken,
  mongoController.getPublicProfilePictureRecord
);

// Authenticated user's own active record
router.get(
  "/me",
  authenticateToken,
  mongoController.getProfilePictureRecord
);

// Hard-deletes the active record from MongoDB (no Cloudinary cleanup)
router.delete(
  "/me",
  authenticateToken,
  mongoController.deleteProfilePicture
);

export default router;

