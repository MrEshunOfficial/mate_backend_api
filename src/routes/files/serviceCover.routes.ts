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
// Upload requires NO serviceId — same orphan pattern as category covers.
// The file is stored under services/pending/:uploaderId and the fileId is
// returned. The caller passes that fileId as coverImage in the service create
// or update body. The service handler calls linkFileToCreatedEntity which
// stamps entityId onto the file record and sets coverImage on the service doc.
//
// All other operations (get, delete, optimized) require a :serviceId because
// they look up the cover linked to a specific service.
//
// Service covers are publicly readable — no authenticateToken on GET endpoints.
//
// NOTE: /cloudinary/new must be declared before /cloudinary/:serviceId/cover
// so Express never treats "new" as a :serviceId value.
// ─────────────────────────────────────────────────────────────────────────────

// Upload a cover image — no serviceId needed
router.post(
  "/cloudinary/new",
  authenticateToken,
  cloudinaryController.uploadMiddleware.single("file"),
  cloudinaryController.uploadServiceCover
);

// Optimized transformation URL — declared before the bare GET to avoid
// "optimized" being captured as a dynamic segment
// Query params: width (int), quality (int | "auto"), format ("auto"|"webp"|"jpg"|"png")
router.get(
  "/cloudinary/:serviceId/cover/optimized",
  cloudinaryController.getOptimizedServiceCover
);

// Public-safe fields only (url, thumbnailUrl, uploadedAt) — for SSR / unauthenticated consumers
// Declared before the bare GET so "public" is not captured as a dynamic segment
router.get(
  "/cloudinary/:serviceId/cover/public",
  cloudinaryController.getPublicServiceCover
);

// Active cover secure URL + basic metadata — publicly accessible
router.get(
  "/cloudinary/:serviceId/cover",
  cloudinaryController.getServiceCover
);

// Full delete: removes Cloudinary asset, clears coverImage, hard-deletes MongoDB record
router.delete(
  "/cloudinary/:serviceId/cover",
  authenticateToken,
  cloudinaryController.deleteServiceCover
);

// ─────────────────────────────────────────────────────────────────────────────
// MONGODB  —  record / history / metadata / archive / restore / stats / cleanup
//
// All operations require :serviceId — they manage records already linked
// to an existing service.
//
// Fixed sub-paths (/history, /stats, /metadata, /archive, /restore/:fileId,
// /cleanup, /record/public, /record) are declared before any wildcard to
// ensure Express matches them first.
//
// /record/public is the one unauthenticated MongoDB endpoint — it returns
// only the fields safe for public consumption from the file record.
// ─────────────────────────────────────────────────────────────────────────────

// Paginated archive of past covers — query: limit (default 10), skip (default 0)
router.get(
  "/:serviceId/cover/history",
  authenticateToken,
  mongoController.getServiceCoverHistory
);

// Storage + count statistics across active and archived covers
router.get(
  "/:serviceId/cover/stats",
  authenticateToken,
  mongoController.getServiceCoverStats
);

// Update description and/or tags on the active cover record
router.patch(
  "/:serviceId/cover/metadata",
  authenticateToken,
  mongoController.updateServiceCoverMetadata
);

// Archive the active cover (status → "archived", coverImage cleared)
// Does NOT delete the Cloudinary asset — use DELETE /cloudinary/:serviceId/cover for that
router.post(
  "/:serviceId/cover/archive",
  authenticateToken,
  mongoController.archiveServiceCover
);

// Restore an archived cover; archives the current active cover first
router.post(
  "/:serviceId/cover/restore/:fileId",
  authenticateToken,
  mongoController.restoreServiceCover
);

// Hard-delete archived covers older than `daysOld` days (default 30)
// MongoDB records only — Cloudinary assets for archived covers are not touched
router.delete(
  "/:serviceId/cover/cleanup",
  authenticateToken,
  mongoController.cleanupArchivedServiceCovers
);

// Hard-delete the MongoDB record and unlink coverImage from the service doc
// Does NOT remove the Cloudinary asset — use DELETE /cloudinary/:serviceId/cover for full teardown
router.delete(
  "/:serviceId/cover/record",
  authenticateToken,
  mongoController.deleteServiceCover
);

// Public-safe fields from the active cover record — no auth required
// Declared before the authenticated /record route so "public" is not swallowed
router.get(
  "/:serviceId/cover/record/public",
  mongoController.getPublicServiceCoverRecord
);

// Active cover MongoDB record (marks file as accessed)
router.get(
  "/:serviceId/cover/record",
  authenticateToken,
  mongoController.getServiceCoverRecord
);

export default router;

