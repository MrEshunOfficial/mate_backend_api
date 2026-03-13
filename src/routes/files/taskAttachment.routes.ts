// routes/files/taskAttachment.routes.ts
import { Router } from "express";
import { initCloudinaryService } from "../../config/cloudinary.config";
import { CloudinaryFileController } from "../../controllers/files/cl.file.controller";
import { MongoDBFileController } from "../../controllers/files/db.file.controller";
import { authenticateToken } from "../../middleware/auth/auth.middleware";
import { requireTaskOwner } from "../../middleware/role/ownership.middleware";

// ─── Task Attachment Routes ───────────────────────────────────────────────────
//
// Files attached to a task (supporting photos, reference images supplied by
// the client when describing the work they need done).
// Association is file-side only — Task has no attachments array field.
// The File record's entityId + entityType = TASK is the sole link.
//
// All routes require:
//   authenticate     → populates req.userId + req.user
//   requireTaskOwner → verifies req.user is the client who created the task
//                      referenced by :taskId
//
// No public routes — task files are private to the client and their matched
// providers. No optimized route — attachments are reference images, not
// display assets needing Cloudinary transformations.
//
// Route map:
//   POST   /cloudinary/task-attachment                   upload
//   GET    /tasks/:taskId/attachments                    get active
//   DELETE /tasks/:taskId/attachments                    full delete
//   GET    /tasks/:taskId/attachments/record             record + mark accessed
//   GET    /tasks/:taskId/attachments/history            active + archive list
//   PATCH  /tasks/:taskId/attachments/metadata           update tags/description
//   POST   /tasks/:taskId/attachments/archive            soft-archive record
//   POST   /tasks/:taskId/attachments/restore/:fileId    restore archived record
//   DELETE /tasks/:taskId/attachments/db                 hard-delete record only
//   GET    /tasks/:taskId/attachments/stats              storage stats
//   DELETE /tasks/:taskId/attachments/cleanup            purge old archives

const router = Router();

const cloudinaryConfig  = initCloudinaryService();
const cloudinaryCtrl    = new CloudinaryFileController(cloudinaryConfig);
const mongoCtrl         = new MongoDBFileController();
const { uploadMiddleware } = cloudinaryCtrl;

// ── Cloudinary upload ─────────────────────────────────────────────────────────
// taskId is passed in the request body — the handler stamps it as entityId.

router.post(
  "/cloudinary/task-attachment",
  authenticateToken,
  uploadMiddleware.single("file"),
  cloudinaryCtrl.uploadTaskAttachment
);

// ── Entity-scoped Cloudinary routes ──────────────────────────────────────────

router.get(
  "/tasks/:taskId/attachments",
  authenticateToken,
  requireTaskOwner,
  cloudinaryCtrl.getTaskAttachment
);

router.delete(
  "/tasks/:taskId/attachments",
  authenticateToken,
  requireTaskOwner,
  cloudinaryCtrl.deleteTaskAttachment
);

// ── MongoDB record management ─────────────────────────────────────────────────

router.get(
  "/tasks/:taskId/attachments/record",
  authenticateToken,
  requireTaskOwner,
  mongoCtrl.getTaskAttachmentRecord
);

router.get(
  "/tasks/:taskId/attachments/history",
  authenticateToken,
  requireTaskOwner,
  mongoCtrl.getTaskAttachmentHistory
);

router.patch(
  "/tasks/:taskId/attachments/metadata",
  authenticateToken,
  requireTaskOwner,
  mongoCtrl.updateTaskAttachmentMetadata
);

router.post(
  "/tasks/:taskId/attachments/archive",
  authenticateToken,
  requireTaskOwner,
  mongoCtrl.archiveTaskAttachment
);

router.post(
  "/tasks/:taskId/attachments/restore/:fileId",
  authenticateToken,
  requireTaskOwner,
  mongoCtrl.restoreTaskAttachment
);

router.delete(
  "/tasks/:taskId/attachments/db",
  authenticateToken,
  requireTaskOwner,
  mongoCtrl.deleteTaskAttachment
);

router.get(
  "/tasks/:taskId/attachments/stats",
  authenticateToken,
  requireTaskOwner,
  mongoCtrl.getTaskAttachmentStats
);

router.delete(
  "/tasks/:taskId/attachments/cleanup",
  authenticateToken,
  requireTaskOwner,
  mongoCtrl.cleanupArchivedTaskAttachments
);

export default router;