// types/entityConfig.ts
//
// EntityImageConfig — the single configuration object that drives both
// GenericCloudinaryImageHandler and GenericMongoDBImageHandler.
//
// Adding a new image type is entirely a matter of supplying a new config
// object; neither handler class needs to be touched.

import { Types } from "mongoose";
import { FileEntityType } from "./file.types";
import { AuthenticatedRequest } from "./user.types";
import { MongoDBFileService } from "../service/files/mongodb.file.service";

// ─── Label ────────────────────────────────────────────────────────────────────

export type Label =
  | "profile_picture"
  | "category_cover"
  | "service_cover"
  | "provider_gallery"
  | "provider_id_image"
  | "client_id_image"
  | "booking_attachment"
  | "task_attachment"
  | "product_image";

// ─── EntityImageConfig ────────────────────────────────────────────────────────

export interface EntityImageConfig {
  // ── Identity ───────────────────────────────────────────────────────────────

  /** FileEntityType enum value — used as the entityType field on file records. */
  entityType: FileEntityType;

  /** Human-readable label stamped on every file record and used in log/error messages. */
  label: Label;

  /**
   * Name of the field on the entity document that holds the image reference.
   * For scalar fields:  "profilePictureId", "catCoverId"
   * For array fields:   "businessGalleryImages", "idDetails.fileImageId"
   */
  imageFieldName: string;

  // ── Upload behaviour ───────────────────────────────────────────────────────

  /**
   * "linked"  — entityId is known at upload time; the file is stamped with it
   *             and linked to the entity immediately.
   * "orphan"  — entityId is not known yet; the file is stored under a pending
   *             folder and linked when the entity is created/updated.
   */
  uploadMode: "linked" | "orphan";

  /**
   * Whether the entity field that holds this image type is an array.
   *
   * false (default) — scalar field (e.g. profilePictureId).
   *   • upload: retires the existing active file before uploading a new one.
   *   • get:    returns a single { fileId, url, ... } object.
   *   • delete/archive: targets the one active file implicitly.
   *
   * true — array field (e.g. businessGalleryImages, idDetails.fileImageId).
   *   • upload: appends to the array — existing files are never retired.
   *   • uploadMultiple: batch-appends multiple files.
   *   • get:    returns { files: [...], count } with all active entries.
   *   • delete/archive/updateMetadata: require req.params.fileId to identify
   *     which specific entry in the array to act on.
   *   • restore: re-adds to the array without displacing other active files.
   */
  isArray?: boolean;

  /**
   * Maximum number of files accepted by the uploadMultiple handler.
   * Only meaningful when isArray is true.
   * Defaults to 10 if not specified.
   */
  maxFiles?: number;

  /** Maximum accepted file size in bytes. */
  maxSizeBytes: number;

  // ── Cloudinary folder ──────────────────────────────────────────────────────

  /**
   * Top-level Cloudinary folder prefix.
   * Used as a fallback when getLinkedFolder / getOrphanFolder are not provided.
   */
  folderPrefix: string;

  /**
   * Overrides the upload folder for linked-mode uploads.
   * Receives the resolved entityId.
   */
  getLinkedFolder?: (entityId: string) => string;

  /**
   * Overrides the upload folder for orphan-mode uploads.
   * Receives the uploaderId (userId of the authenticated user).
   */
  getOrphanFolder?: (uploaderId: string) => string;

  // ── Entity ID resolution ───────────────────────────────────────────────────

  /**
   * Extracts the entity ID from an authenticated request.
   * For user-owned images: returns req.userId.
   * For entity-scoped images: returns req.params.providerProfileId etc.
   */
  getEntityId: (req: AuthenticatedRequest) => string | undefined;

  /**
   * Extracts the entity ID for public (unauthenticated) GET routes.
   * Omit for entity types with no public image access.
   */
  getPublicEntityId?: (req: AuthenticatedRequest) => string | undefined;

  /**
   * Orphan mode only — extracts a pre-existing entityId from the request body.
   * When present and valid, the handler links the file immediately after upload
   * instead of returning an unlinked fileId.
   */
  getEntityIdFromBody?: (req: AuthenticatedRequest) => string | undefined;

  // ── Linking ────────────────────────────────────────────────────────────────

  /**
   * Writes the fileId reference onto the entity document.
   *
   * For scalar fields:  sets the field to fileId.
   * For array fields:   uses $addToSet so the call is safe to make twice
   *                     and never overwrites existing entries.
   *
   * Returns true if the entity was found and updated, false otherwise.
   */
  linkToEntity: (
    entityId: string,
    fileId: Types.ObjectId,
    userId: string,
  ) => Promise<boolean>;

  /**
   * Removes the fileId reference from the entity document.
   *
   * For scalar fields:  $unsets the field.
   * For array fields:   uses $pull to remove only the targeted fileId.
   */
  unlinkFromEntity: (
    entityId: string,
    fileId: Types.ObjectId,
    userId: string,
  ) => Promise<void>;

  /**
   * Orphan mode only — called when the entity is created / updated with the
   * fileId in its body. Stamps entityId onto the file record and links it.
   * Required when uploadMode === "orphan".
   */
  linkFileToCreatedEntity?: (
    fileId: Types.ObjectId,
    entityId: string,
    userId: string,
    mongoService: MongoDBFileService,
  ) => Promise<boolean>;
}
