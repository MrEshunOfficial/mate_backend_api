// routes/files/bookingAttachment.routes.ts
import { Router } from "express";
import { initCloudinaryService } from "../../config/cloudinary.config";
import { CloudinaryFileController } from "../../controllers/files/cl.file.controller";
import { MongoDBFileController } from "../../controllers/files/db.file.controller";
import { authenticateToken } from "../../middleware/auth/auth.middleware";
import { requireBookingParticipant } from "../../middleware/role/ownership.middleware";

// ─── Booking Attachment Routes ────────────────────────────────────────────────
//
// Files attached to a booking (completion photos, receipts, dispute evidence).
// Association is file-side only — Booking has no attachments array field.
// The File record's entityId + entityType = BOOKING is the sole link.
//
// All routes require:
//   authenticate              → populates req.userId + req.user
//   requireBookingParticipant → verifies req.user is the client or provider
//                               on the booking referenced by :bookingId
//
// No public routes — booking files are private to the two participants and
// admins. No optimized route — attachments are documents/photos, not
// display images needing Cloudinary transformations.
//
// Route map:
//   POST   /cloudinary/booking-attachment                   upload
//   GET    /bookings/:bookingId/attachments                 get active
//   DELETE /bookings/:bookingId/attachments                 full delete
//   GET    /bookings/:bookingId/attachments/record          record + mark accessed
//   GET    /bookings/:bookingId/attachments/history         active + archive list
//   PATCH  /bookings/:bookingId/attachments/metadata        update tags/description
//   POST   /bookings/:bookingId/attachments/archive         soft-archive record
//   POST   /bookings/:bookingId/attachments/restore/:fileId restore archived record
//   DELETE /bookings/:bookingId/attachments/db              hard-delete record only
//   GET    /bookings/:bookingId/attachments/stats           storage stats
//   DELETE /bookings/:bookingId/attachments/cleanup         purge old archives

const router = Router();

const cloudinaryConfig  = initCloudinaryService();
const cloudinaryCtrl    = new CloudinaryFileController(cloudinaryConfig);
const mongoCtrl         = new MongoDBFileController();
const { uploadMiddleware } = cloudinaryCtrl;

// ── Cloudinary upload ─────────────────────────────────────────────────────────
// bookingId is passed in the request body — the handler stamps it as entityId.

router.post(
  "/cloudinary/booking-attachment",
  authenticateToken,
  uploadMiddleware.single("file"),
  cloudinaryCtrl.uploadBookingAttachment
);

// ── Entity-scoped Cloudinary routes ──────────────────────────────────────────

router.get(
  "/bookings/:bookingId/attachments",
  authenticateToken,
  requireBookingParticipant,
  cloudinaryCtrl.getBookingAttachment
);

router.delete(
  "/bookings/:bookingId/attachments",
  authenticateToken,
  requireBookingParticipant,
  cloudinaryCtrl.deleteBookingAttachment
);

// ── MongoDB record management ─────────────────────────────────────────────────

router.get(
  "/bookings/:bookingId/attachments/record",
  authenticateToken,
  requireBookingParticipant,
  mongoCtrl.getBookingAttachmentRecord
);

router.get(
  "/bookings/:bookingId/attachments/history",
  authenticateToken,
  requireBookingParticipant,
  mongoCtrl.getBookingAttachmentHistory
);

router.patch(
  "/bookings/:bookingId/attachments/metadata",
  authenticateToken,
  requireBookingParticipant,
  mongoCtrl.updateBookingAttachmentMetadata
);

router.post(
  "/bookings/:bookingId/attachments/archive",
  authenticateToken,
  requireBookingParticipant,
  mongoCtrl.archiveBookingAttachment
);

router.post(
  "/bookings/:bookingId/attachments/restore/:fileId",
  authenticateToken,
  requireBookingParticipant,
  mongoCtrl.restoreBookingAttachment
);

router.delete(
  "/bookings/:bookingId/attachments/db",
  authenticateToken,
  requireBookingParticipant,
  mongoCtrl.deleteBookingAttachment
);

router.get(
  "/bookings/:bookingId/attachments/stats",
  authenticateToken,
  requireBookingParticipant,
  mongoCtrl.getBookingAttachmentStats
);

router.delete(
  "/bookings/:bookingId/attachments/cleanup",
  authenticateToken,
  requireBookingParticipant,
  mongoCtrl.cleanupArchivedBookingAttachments
);

export default router;