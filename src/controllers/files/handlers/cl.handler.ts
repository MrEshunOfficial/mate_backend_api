import { Response } from "express";
import { Types } from "mongoose";
import { CloudinaryFileService } from "../../../service/files/cloudinary.file.service";
import { MongoDBFileService } from "../../../service/files/mongodb.file.service";
import { EntityImageConfig } from "../../../types/entityConfig";
import { IFile } from "../../../types/file.types";
import { AuthenticatedRequest } from "../../../types/user.types";
import { handleError, validateObjectId } from "../../../utils/auth/auth.controller.utils";

// ─── Format helpers ───────────────────────────────────────────────────────────

const ALLOWED_FORMATS = ["auto", "webp", "jpg", "png"] as const;
type OptimizedFormat = (typeof ALLOWED_FORMATS)[number];

// ─── GenericCloudinaryImageHandler ───────────────────────────────────────────

// Handles the Cloudinary-side of image management for any entity type.
// All entity-specific behaviour (model lookups, field names, folder paths)
// is provided by the EntityImageConfig — this class never imports models.
//
// Instantiate once per entity type in CloudinaryFileController:
//   new GenericCloudinaryImageHandler(profilePictureConfig, cloudinary, mongo)
//   new GenericCloudinaryImageHandler(categoryCoverConfig,  cloudinary, mongo)

export class GenericCloudinaryImageHandler {
  constructor(
    private readonly config: EntityImageConfig,
    private readonly cloudinaryService: CloudinaryFileService,
    private readonly mongoService: MongoDBFileService
  ) {}

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async getActiveFile(entityId: string): Promise<IFile | null> {
    const files = await this.mongoService.getFilesByEntity(
      this.config.entityType,
      entityId,
      { status: "active" }
    );
    return files.find((f) => f.label === this.config.label) ?? null;
  }

  // Resolves the Cloudinary folder path for an upload.
  // Linked mode: entityId is known → uses getLinkedFolder or default.
  // Orphan mode: entityId is unknown → uses getOrphanFolder or default.
  private resolveUploadFolder(entityId: string, uploaderId: string): string {
    if (this.config.uploadMode === "orphan") {
      return this.config.getOrphanFolder
        ? this.config.getOrphanFolder(uploaderId)
        : `${this.config.folderPrefix}/pending/${uploaderId}`;
    }
    return this.config.getLinkedFolder
      ? this.config.getLinkedFolder(entityId)
      : `${this.config.folderPrefix}/${entityId}/${this.config.label}`;
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  /**
   * POST   — upload a new image for an entity.
   *
   * Linked mode (e.g. profile picture):
   *   - Resolves entityId from the request immediately.
   *   - Archives + removes any existing active file from Cloudinary.
   *   - Uploads, persists the file record with entityId, and links it.
   *
   * Orphan mode (e.g. category cover):
   *   - No entityId yet — file is stored under a pending folder.
   *   - Returns fileId for the caller to pass to the entity create/update handler.
   *   - entityId and catCoverId are set by that handler, not here.
   */
  upload = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res
          .status(401)
          .json({ success: false, message: "User not authenticated" });
        return;
      }

      if (!req.file) {
        res.status(400).json({ success: false, message: "No file uploaded" });
        return;
      }

      const { file } = req;

      if (!file.mimetype.startsWith("image/")) {
        res.status(400).json({
          success: false,
          message: `${this.config.label} must be an image file`,
        });
        return;
      }

      if (file.size > this.config.maxSizeBytes) {
        res.status(400).json({
          success: false,
          message: `${this.config.label} must be under ${
            this.config.maxSizeBytes / (1024 * 1024)
          } MB`,
        });
        return;
      }

      // In linked mode the entityId is known now; in orphan mode we use
      // uploaderId as a folder key only (it is NOT stored as entityId).
      const entityId =
        this.config.uploadMode === "linked"
          ? (this.config.getEntityId(req) ?? userId)
          : userId;

      // ── Linked mode: retire the existing active file ─────────────────────
      if (this.config.uploadMode === "linked") {
        const existing = await this.getActiveFile(entityId);
        if (existing) {
          // Best-effort — a Cloudinary failure must not block the new upload
          if (existing.metadata?.publicId) {
            try {
              await this.cloudinaryService.deleteFile(
                existing.metadata.publicId as string,
                "image"
              );
            } catch (err) {
              console.warn(
                `[${this.config.label}] Could not delete old Cloudinary asset:`,
                err
              );
            }
          }
          // Unlink and archive in parallel — both are non-blocking on failure
          await Promise.all([
            this.config
              .unlinkFromEntity(entityId, existing._id, userId)
              .catch((err) =>
                console.warn(
                  `[${this.config.label}] unlinkFromEntity failed:`,
                  err
                )
              ),
            this.mongoService.archiveFile(existing._id),
          ]);
        }
      }

      // ── Upload to Cloudinary ─────────────────────────────────────────────
      const folder = this.resolveUploadFolder(entityId, userId);

      const uploadResult = await this.cloudinaryService.uploadFile(
        file.buffer,
        file.originalname,
        {
          folderName: folder,
          isPublic: true,
          resourceType: "image",
          tags: [this.config.entityType, this.config.label, userId],
          description: `${this.config.label} image`,
          // entityType is string in UploadFileOptions — pass the enum value directly
          entityType: this.config.entityType,
          entityId:
            this.config.uploadMode === "linked" ? entityId : undefined,
          uploaderId: new Types.ObjectId(userId),
          label: this.config.label,
        }
      );

      // ── Persist file record to MongoDB ───────────────────────────────────
      const fileRecord = await this.mongoService.createFile({
        uploaderId: new Types.ObjectId(userId),
        url: uploadResult.secureUrl,
        fileName: uploadResult.fileName,
        fileSize: uploadResult.fileSize,
        mimeType: file.mimetype,
        extension: uploadResult.extension,
        thumbnailUrl: uploadResult.thumbnailUrl,
        storageProvider: "cloudinary",
        // metadata on IFile is Record<string, unknown> — mixed types are fine here
        metadata: {
          publicId: uploadResult.publicId,
          format: uploadResult.format,
          resourceType: uploadResult.resourceType,
          width: uploadResult.width,
          height: uploadResult.height,
        },
        tags: [this.config.entityType, this.config.label, userId],
        description: `${this.config.label} image`,
        entityType: this.config.entityType,
        // Only set entityId when the entity is already known
        entityId:
          this.config.uploadMode === "linked"
            ? new Types.ObjectId(entityId)
            : undefined,
        label: this.config.label,
        status: "active",
      });

      // ── Orphan mode: return fileId for deferred linking ──────────────────
      // ── Orphan mode: return fileId, and link immediately if entityId was provided
if (this.config.uploadMode === "orphan") {
  const entityId = this.config.getEntityIdFromBody?.(req);

  let linked = false;
  if (entityId && validateObjectId(entityId)) {
    try {
      linked = await this.config.linkFileToCreatedEntity(
        fileRecord._id,
        entityId,
        userId,
        this.mongoService
      );
    } catch (err) {
      console.warn(`[${this.config.label}] linkFileToCreatedEntity failed:`, err);
    }
  }

  res.status(200).json({
    success: true,
    message: linked
      ? `${this.config.label} uploaded and linked successfully`
      : `${this.config.label} uploaded successfully. Pass the returned fileId as ${this.config.imageFieldName} when creating or updating the entity.`,
    data: {
      fileId: fileRecord._id,
      url: uploadResult.secureUrl,
      thumbnailUrl: uploadResult.thumbnailUrl,
      width: uploadResult.width,
      height: uploadResult.height,
      linkedToEntity: linked,
    },
  });
  return;
}

      // ── Linked mode: link to the entity document ─────────────────────────
      let linked = false;
      try {
        linked = await this.config.linkToEntity(entityId, fileRecord._id, userId);
      } catch (err) {
        console.warn(`[${this.config.label}] linkToEntity failed:`, err);
      }

      res.status(200).json({
        success: true,
        message: linked
          ? `${this.config.label} uploaded and linked successfully`
          : `${this.config.label} uploaded. It will be linked automatically when the entity is created.`,
        data: {
          fileId: fileRecord._id,
          url: uploadResult.secureUrl,
          thumbnailUrl: uploadResult.thumbnailUrl,
          width: uploadResult.width,
          height: uploadResult.height,
          linkedToEntity: linked,
        },
      });
    } catch (error) {
      handleError(res, error, `Failed to upload ${this.config.label}`);
    }
  };

  /**
   * GET   — returns the active image for the authenticated user's own entity.
   * entityId is resolved via config.getEntityId (e.g. req.userId or req.params.categoryId).
   */
  get = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const entityId = this.config.getEntityId(req);
      if (!entityId || !validateObjectId(entityId)) {
        res
          .status(400)
          .json({ success: false, message: "Invalid or missing entity ID" });
        return;
      }

      const file = await this.getActiveFile(entityId);
      if (!file) {
        res
          .status(404)
          .json({ success: false, message: `${this.config.label} not found` });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          fileId: file._id,
          url: file.url,
          thumbnailUrl: file.thumbnailUrl,
          uploadedAt: file.uploadedAt,
          metadata: file.metadata,
        },
      });
    } catch (error) {
      handleError(res, error, `Failed to get ${this.config.label}`);
    }
  };

  /**
   * GET /:entityId  — returns another entity's active image (public-safe fields only).
   * Only available when config.getPublicEntityId is defined.
   * Returns 404 for entity types that do not support this access pattern.
   */
  getPublic = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      if (!this.config.getPublicEntityId) {
        res.status(404).json({
          success: false,
          message: "Public access is not available for this entity type",
        });
        return;
      }

      const entityId = this.config.getPublicEntityId(req);
      if (!entityId || !validateObjectId(entityId)) {
        res.status(400).json({ success: false, message: "Invalid entity ID" });
        return;
      }

      const file = await this.getActiveFile(entityId);
      if (!file) {
        res
          .status(404)
          .json({ success: false, message: `${this.config.label} not found` });
        return;
      }

      // Public response — metadata and internal fields intentionally excluded
      res.status(200).json({
        success: true,
        data: {
          fileId: file._id,
          url: file.url,
          thumbnailUrl: file.thumbnailUrl,
          uploadedAt: file.uploadedAt,
        },
      });
    } catch (error) {
      handleError(res, error, `Failed to get ${this.config.label}`);
    }
  };

  /**
   * DELETE   — full delete: removes Cloudinary asset, unlinks from entity document,
   * and hard-deletes the MongoDB record.
   */
  delete = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res
          .status(401)
          .json({ success: false, message: "User not authenticated" });
        return;
      }

      const entityId = this.config.getEntityId(req);
      if (!entityId || !validateObjectId(entityId)) {
        res
          .status(400)
          .json({ success: false, message: "Invalid or missing entity ID" });
        return;
      }

      const file = await this.getActiveFile(entityId);
      if (!file) {
        res
          .status(404)
          .json({ success: false, message: `${this.config.label} not found` });
        return;
      }

      if (file.metadata?.publicId) {
        await this.cloudinaryService.deleteFile(
          file.metadata.publicId as string,
          "image"
        );
      }

      await Promise.all([
        this.config.unlinkFromEntity(entityId, file._id, userId),
        this.mongoService.deleteFile(file._id),
      ]);

      res.status(200).json({
        success: true,
        message: `${this.config.label} deleted successfully`,
      });
    } catch (error) {
      handleError(res, error, `Failed to delete ${this.config.label}`);
    }
  };

  /**
   * GET /optimized  — returns a Cloudinary transformation URL.
   * Query params: width (int), quality (int | "auto"), format ("auto"|"webp"|"jpg"|"png")
   */
  getOptimized = async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    try {
      const entityId = this.config.getEntityId(req);
      if (!entityId || !validateObjectId(entityId)) {
        res
          .status(400)
          .json({ success: false, message: "Invalid or missing entity ID" });
        return;
      }

      const { width, quality, format } = req.query;

      const file = await this.getActiveFile(entityId);
      if (!file) {
        res
          .status(404)
          .json({ success: false, message: `${this.config.label} not found` });
        return;
      }

      if (!file.metadata?.publicId) {
        res.status(400).json({
          success: false,
          message: `${this.config.label} does not have a Cloudinary public ID`,
        });
        return;
      }

      const optimizedUrl = this.cloudinaryService.getOptimizedUrl(
        file.metadata.publicId as string,
        {
          width: width ? parseInt(width as string, 10) : undefined,
          quality:
            quality === "auto"
              ? "auto"
              : quality
              ? parseInt(quality as string, 10)
              : undefined,
          format: ALLOWED_FORMATS.includes(format as OptimizedFormat)
            ? (format as OptimizedFormat)
            : undefined,
        }
      );

      res.status(200).json({
        success: true,
        data: { optimizedUrl, originalUrl: file.url },
      });
    } catch (error) {
      handleError(
        res,
        error,
        `Failed to generate optimized ${this.config.label}`
      );
    }
  };
}