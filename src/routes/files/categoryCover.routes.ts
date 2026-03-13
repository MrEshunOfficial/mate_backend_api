import { Router } from "express";
import { initCloudinaryService } from "../../config/cloudinary.config";
import { CloudinaryFileController } from "../../controllers/files/cl.file.controller";
import { MongoDBFileController } from "../../controllers/files/db.file.controller";
import { authenticateToken } from "../../middleware/auth/auth.middleware";

const router = Router({ mergeParams: true });

const cloudinaryController = new CloudinaryFileController(initCloudinaryService());
const mongoController = new MongoDBFileController();

// ─────────────────────────────────────────────────────────────────────────────
// CLOUDINARY  —  upload / read / delete / optimize
//
// Upload requires NO categoryId — mirrors the profile picture pattern.
// The file is stored as a standalone record and the fileId is returned.
// The caller passes that fileId as catCoverId in the category create or
// update request body. The category handler then sets catCoverId on the
// document and updates the file record's entityId.
//
// All other operations (get, delete, optimized) require a :categoryId
// because they look up the cover linked to a specific category.
//
// NOTE: /cloudinary/category-cover must be declared before
// /cloudinary/:categoryId/cover so Express never treats "category-cover"
// as a :categoryId value.
// ─────────────────────────────────────────────────────────────────────────────

// Upload a cover image — no categoryId needed
router.post(
  "/cloudinary/new",
  authenticateToken,
  cloudinaryController.uploadMiddleware.single("file"),
  cloudinaryController.uploadCategoryCover
);

// Optimized transformation URL — declared before the bare GET to avoid
// "optimized" being captured as a dynamic segment
router.get(
  "/cloudinary/:categoryId/cover/optimized",
  authenticateToken,
  cloudinaryController.getOptimizedCategoryCover
);

// Active cover secure URL + basic metadata
router.get(
  "/cloudinary/:categoryId/cover",
  authenticateToken,
  cloudinaryController.getCategoryCover
);

// Full delete: removes Cloudinary asset, clears catCoverId, hard-deletes MongoDB record
router.delete(
  "/cloudinary/:categoryId/cover",
  authenticateToken,
  cloudinaryController.deleteCategoryCover
);

// ─────────────────────────────────────────────────────────────────────────────
// MONGODB  —  record / history / metadata / archive / restore / stats / cleanup
//
// All operations require :categoryId — they manage records already linked
// to an existing category.
//
// Fixed sub-paths (/history, /stats, /metadata, /archive, /restore/:fileId,
// /cleanup, /record) are declared before any wildcard to ensure Express
// matches them first.
// ─────────────────────────────────────────────────────────────────────────────

// Paginated archive of past covers — query: limit (default 10), skip (default 0)
router.get(
  "/:categoryId/cover/history",
  authenticateToken,
  mongoController.getCategoryCoverHistory
);

// Storage + count statistics across active and archived covers
router.get(
  "/:categoryId/cover/stats",
  authenticateToken,
  mongoController.getCategoryCoverStats
);

// Update description and/or tags on the active cover record
router.patch(
  "/:categoryId/cover/metadata",
  authenticateToken,
  mongoController.updateCategoryCoverMetadata
);

// Archive the active cover (status → "archived", catCoverId cleared)
// Does NOT delete the Cloudinary asset — use DELETE /cloudinary/:categoryId/cover for that
router.post(
  "/:categoryId/cover/archive",
  authenticateToken,
  mongoController.archiveCategoryCover
);

// Restore an archived cover; archives the current active cover first
router.post(
  "/:categoryId/cover/restore/:fileId",
  authenticateToken,
  mongoController.restoreCategoryCover
);

// Hard-delete archived covers older than `daysOld` days (default 30)
// MongoDB records only — Cloudinary assets for archived covers are not touched
router.delete(
  "/:categoryId/cover/cleanup",
  authenticateToken,
  mongoController.cleanupArchivedCategoryCovers
);

// Active cover MongoDB record (marks file as accessed)
router.get(
  "/:categoryId/cover/record",
  authenticateToken,
  mongoController.getCategoryCoverRecord
);

export default router;

