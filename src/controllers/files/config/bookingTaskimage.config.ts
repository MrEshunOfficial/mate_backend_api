import { Types } from "mongoose";
import { MongoDBFileService } from "../../../service/files/mongodb.file.service";
import { EntityImageConfig } from "../../../types/entityConfig";
import { FileEntityType } from "../../../types/file.types";
import { AuthenticatedRequest } from "../../../types/user.types";
import { getParam } from "../../../utils/auth/auth.controller.utils";
import BookingModel from "../../../models/booking.model";
import TaskModel from "../../../models/task.model";

// ─── Booking & Task Attachment Configs ────────────────────────────────────────
//
// Attachments (photos, receipts, completion evidence) differ from profile
// pictures or service covers in one key way: the entity document (Booking,
// Task) carries no reverse foreign-key field pointing back at the file.
// The association is file-side only — the File record's entityId + entityType
// is the single source of truth.
//
// Consequences for linkToEntity / unlinkFromEntity:
//   - linkToEntity only needs to confirm the entity exists and is not deleted.
//     It returns true/false so the upload controller knows whether to proceed.
//     No field is written on the entity document itself.
//   - unlinkFromEntity is a no-op at the entity level. The file controller
//     handles archiving / soft-deleting the File record itself; the entity
//     document needs no update.
//
// Consequences for linkFileToCreatedEntity:
//   Both Booking and Task are created server-side (not via a client form that
//   could pre-upload files). Attachments are uploaded after the entity exists,
//   so linkFileToCreatedEntity is a no-op — it simply confirms the file is
//   already correctly stamped and returns true.
//
// Upload mode: "linked"
//   entityId is always known at upload time (uploads happen inside an existing
//   booking or task context). The file is immediately stamped with entityId
//   and entityType, making it findable via getFilesByEntity.
//
// Access control:
//   Both configs intentionally omit getPublicEntityId — attachments on
//   bookings and tasks are private to the involved parties. Routes using
//   these configs must sit behind auth + participant-ownership middleware.

// ─── Booking Attachment Config ────────────────────────────────────────────────
//
// Covers: completion photos, receipts, dispute evidence — any file a provider
// or client attaches to a booking. All files are associated via the File
// record only; Booking has no attachments array field.
//
// getEntityId reads req.params.bookingId — present on all booking-scoped
// upload and file-management routes.

export const bookingAttachmentConfig: EntityImageConfig = {
  entityType: FileEntityType.BOOKING,
  label: "task_image", // broadest label — caller can specialise at upload time
  folderPrefix: "bookings",
  imageFieldName: "", // no reverse field on Booking — file record is the link
  maxSizeBytes: 20 * 1024 * 1024, // 20 MB — receipts and photos can be larger

  uploadMode: "linked",

  getLinkedFolder: (entityId: string) =>
    `bookings/${entityId}/attachments`,

  // ── Entity ID extraction ──────────────────────────────────────────────────

  getEntityId: (req: AuthenticatedRequest): string | undefined =>
    getParam(req.params.bookingId),

  // No public route — booking files are private to client + provider.
  getPublicEntityId: undefined,

  // ── Model side effects ────────────────────────────────────────────────────

  // Confirms the booking exists and is not soft-deleted before allowing the
  // upload. No field is written on the Booking document — the File record's
  // entityId is the only link.
  linkToEntity: async (
    entityId: string,
    _fileId: Types.ObjectId,
    _userId: string
  ): Promise<boolean> => {
    const exists = await BookingModel.exists({
      _id:       new Types.ObjectId(entityId),
      isDeleted: false,
    });
    return exists !== null;
  },

  // No entity-side field to clear — nothing to do here.
  // The file controller handles archiving the File record itself.
  unlinkFromEntity: async (
    _entityId: string,
    _fileId: Types.ObjectId,
    _userId: string
  ): Promise<void> => {
    // Intentionally empty — attachment association is file-side only.
  },

  // Attachments are always uploaded after the booking exists.
  // The file already has entityId stamped at upload time, so there is
  // nothing left to do here.
  linkFileToCreatedEntity: async (
    _fileId: Types.ObjectId,
    _entityId: string,
    _userId: string,
    _mongoService: MongoDBFileService
  ): Promise<boolean> => {
    return true;
  },
};

// ─── Task Attachment Config ───────────────────────────────────────────────────
//
// Covers: supporting photos, reference images, or any file a client attaches
// to describe their task. All files are associated via the File record only;
// Task has no attachments array field.
//
// getEntityId reads req.params.taskId — present on all task-scoped upload
// and file-management routes.

export const taskAttachmentConfig: EntityImageConfig = {
  entityType: FileEntityType.TASK,
  label: "task_image", // broadest label — caller can specialise at upload time
  folderPrefix: "tasks",
  imageFieldName: "", // no reverse field on Task — file record is the link
  maxSizeBytes: 20 * 1024 * 1024, // 20 MB

  uploadMode: "linked",

  getLinkedFolder: (entityId: string) =>
    `tasks/${entityId}/attachments`,

  // ── Entity ID extraction ──────────────────────────────────────────────────

  getEntityId: (req: AuthenticatedRequest): string | undefined =>
    getParam(req.params.taskId),

  // No public route — task files are private to the client and matched providers.
  getPublicEntityId: undefined,

  // ── Model side effects ────────────────────────────────────────────────────

  // Confirms the task exists and is not soft-deleted before allowing the
  // upload. No field is written on the Task document.
  linkToEntity: async (
    entityId: string,
    _fileId: Types.ObjectId,
    _userId: string
  ): Promise<boolean> => {
    const exists = await TaskModel.exists({
      _id:       new Types.ObjectId(entityId),
      isDeleted: false,
    });
    return exists !== null;
  },

  // No entity-side field to clear — nothing to do here.
  unlinkFromEntity: async (
    _entityId: string,
    _fileId: Types.ObjectId,
    _userId: string
  ): Promise<void> => {
    // Intentionally empty — attachment association is file-side only.
  },

  // Attachments are always uploaded after the task exists.
  linkFileToCreatedEntity: async (
    _fileId: Types.ObjectId,
    _entityId: string,
    _userId: string,
    _mongoService: MongoDBFileService
  ): Promise<boolean> => {
    return true;
  },
};