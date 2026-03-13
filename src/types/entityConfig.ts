import { Types } from "mongoose";
import { FileEntityType } from "./file.types";
import { AuthenticatedRequest } from "./user.types";
import { MongoDBFileService } from "../service/files/mongodb.file.service";

// ─── Label ────────────────────────────────────────────────────────────────────

export type ImageLabel =
  | "profile_picture"
  | "category_cover"
  | "service_cover"
  | "provider_gallery"
  | "provider_id_image"
  | "client_id_image"
  | "task_image";

// ─── Upload Mode ──────────────────────────────────────────────────────────────

// "linked"  — entityId is resolvable from the request at upload time.
//             The file record is stored with entityId set and linkToEntity
//             is called immediately. If the entity doesn't exist yet, the
//             file waits — linkToEntity returns false and the entity's own
//             creation handler picks it up via linkFileToCreatedEntity.
//             Example: profile picture (entityId = req.userId, always present).
//
// "orphan"  — entityId is unknown at upload time.
//             The file is stored without entityId and the caller receives a
//             fileId to pass to the entity create/update handler.
//             That handler is responsible for calling linkFileToCreatedEntity,
//             which stamps entityId onto the file record and sets the
//             imageFieldName on the entity document.
//             Example: category cover (no categoryId available at upload time).
export type UploadMode = "linked" | "orphan";

// ─── EntityImageConfig ────────────────────────────────────────────────────────

export interface EntityImageConfig {
  // ── Identity ───────────────────────────────────────────────────────────────

  entityType: FileEntityType;
  label: ImageLabel;

  // ── Cloudinary ─────────────────────────────────────────────────────────────

  folderPrefix: string;
  maxSizeBytes: number;
  uploadMode: UploadMode;

  getLinkedFolder?: (entityId: string) => string;
  getOrphanFolder?: (uploaderId: string) => string;

  // ── Entity document ────────────────────────────────────────────────────────

  // Field name on the entity model that references this image.
  // e.g. "profilePictureId" on IUserProfile, "catCoverId" on Category
  imageFieldName: string;

  // ── Request → entityId resolution ─────────────────────────────────────────

  getEntityId: (req: AuthenticatedRequest) => string | undefined;

  // Required for entity types that expose a public "view another entity's image"
  // route. If omitted, getPublic / getPublicRecord handlers return 404.
  getPublicEntityId?: (req: AuthenticatedRequest) => string | undefined;

  // ── Model side effects ────────────────────────────────────────────────────

  // Write imageFieldName → fileId on the owning entity document.
  // Returns true if the entity was found and updated, false if not found.
  // Called after upload (linked mode) and after restore.
  linkToEntity: (
    entityId: string,
    fileId: Types.ObjectId,
    userId: string
  ) => Promise<boolean>;

  // Clear imageFieldName on the owning entity document.
  // Called before archiving or deleting the file.
  unlinkFromEntity: (
    entityId: string,
    fileId: Types.ObjectId,
    userId: string
  ) => Promise<void>;

  // ── Entity creation / update hook ─────────────────────────────────────────

  // Called by the entity's own create/update handler when it receives a fileId
  // (e.g. catCoverId in the category body, or at profile creation time).
  //
  // Responsibilities per upload mode:
  //
  //   "linked" mode (e.g. profile picture):
  //     entityId was already stamped on the file at upload time — no file
  //     update needed. Just call linkToEntity to write imageFieldName on the
  //     entity document. Used when the entity was created after the upload.
  //
  //   "orphan" mode (e.g. category cover):
  //     entityId was NOT set at upload time — must be stamped onto the file
  //     record NOW so that getFilesByEntity can find it going forward.
  //     Then call linkToEntity to write imageFieldName on the entity document.
  //
  // mongoService is injected so the config function can call updateFile without
  // importing MongoDBFileService (which would create a circular dependency in
  // some module graphs) — the caller already holds the instance.
  linkFileToCreatedEntity: (
    fileId: Types.ObjectId,
    entityId: string,
    userId: string,
    mongoService: MongoDBFileService
  ) => Promise<boolean>;

  // Optional — only needed for orphan-mode configs.
// Extracts entityId from the request body for the case where the entity
// already exists at upload time but the entityId is not in the URL.
// Example: POST /cloudinary/category-cover with { categoryId: "..." } in body.
// If omitted, orphan uploads always store the file without an entityId.
getEntityIdFromBody?: (req: AuthenticatedRequest) => string | undefined;
}