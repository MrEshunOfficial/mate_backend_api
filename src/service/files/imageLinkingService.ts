// services/image-linking.service.ts
import { Types, Model } from "mongoose";
import ProfileModel from "../../models/profiles/base.profile.model";
import { FileEntityType } from "../../types/file.types";
import { MongoDBFileService } from "./mongodb.file.service";
import { CategoryModel } from "../../models/service/categoryModel";
import ClientProfileModel from "../../models/profiles/client.profile.model";
import BookingModel from "../../models/booking.model";
import ProviderProfileModel from "../../models/profiles/provider.profile.model";
import { ServiceModel } from "../../models/service/serviceModel";
import TaskModel from "../../models/task.model";

/**
 * Generic Image Linking Service
 *
 * Handles automatic linking of images to entities (profiles, categories, services, providers)
 * Supports flexible workflow where images can be uploaded before or after entity creation
 *
 * Supported entities (keyed by FileEntityType):
 * - FileEntityType.USER              → Profile pictures     (IUserProfile — keyed by userId)
 * - FileEntityType.CLIENT_PROFILE    → Client ID images     (ClientProfile — keyed by _id)
 * - FileEntityType.PROVIDER_PROFILE  → Gallery / ID images  (ProviderProfile — keyed by _id)
 * - FileEntityType.SERVICE           → Cover images         (Service — keyed by _id)
 * - FileEntityType.CATEGORY          → Cover images         (Category — keyed by _id)
 * - FileEntityType.BOOKING           → Booking attachments  (Booking — keyed by _id)
 * - FileEntityType.TASK              → Task attachments     (Task — keyed by _id)
 */

type Label =
  | "profile_picture"
  | "category_cover"
  | "service_cover"
  | "provider_gallery"
  | "provider_id_image"
  | "client_id_image"
  | "product_image";

interface LinkImageConfig {
  entityType: FileEntityType;
  entityId: string;
  imageLabel: Label;
  imageFieldName: string;
  lastModifiedBy?: string;
}

interface ImageLinkResult {
  linked: boolean;
  fileId?: Types.ObjectId;
  url?: string;
  entityId?: Types.ObjectId;
  error?: string;
}

// ─── Provider array field names ───────────────────────────────────────────────

/**
 * Union of all array fields on ProviderProfile that can receive images.
 *
 * "businessGalleryImages"  → ProviderProfile.businessGalleryImages[]
 * "idDetails.fileImageId"  → ProviderProfile.idDetails.fileImageId[]
 *                            (matches the IdDetails interface in base.types.ts)
 *
 * Adding a new image array to ProviderProfile? Add the dot-notation path here.
 */
type ProviderImageArrayField =
  | "businessGalleryImages"
  | "idDetails.fileImageId";

export class ImageLinkingService {
  private fileService: MongoDBFileService;

  constructor() {
    this.fileService = new MongoDBFileService();
  }

  // ─── Entity Model Registry ────────────────────────────────────────────────

  /**
   * Returns the Mongoose model for the given FileEntityType.
   * Every value in FileEntityType must have a case — missing cases are a
   * compile-time gap, so an exhaustive default throw makes omissions obvious
   * at runtime.
   */
  private getEntityModel(entityType: FileEntityType): Model<any> {
    switch (entityType) {
      case FileEntityType.USER:
        return ProfileModel as unknown as Model<any>;

      case FileEntityType.CLIENT_PROFILE:
        return ClientProfileModel as unknown as Model<any>;

      case FileEntityType.PROVIDER_PROFILE:
        return ProviderProfileModel as unknown as Model<any>;

      case FileEntityType.SERVICE:
        return ServiceModel as unknown as Model<any>;

      case FileEntityType.CATEGORY:
        return CategoryModel as unknown as Model<any>;

      case FileEntityType.BOOKING:
        return BookingModel as unknown as Model<any>;

      case FileEntityType.TASK:
        return TaskModel as unknown as Model<any>;

      default:
        // TypeScript will narrow this to `never` when all cases are covered,
        // making future additions to FileEntityType fail loudly here.
        throw new Error(
          `Unsupported entity type for image linking: ${entityType}`
        );
    }
  }

  /**
   * Returns the document field used to look up an entity by its external ID.
   *
   * - IUserProfile is keyed by userId (the owning User._id), not its own _id.
   * - All other entities are looked up by their own _id.
   */
  private getEntityIdField(entityType: FileEntityType): string {
    return entityType === FileEntityType.USER ? "userId" : "_id";
  }

  /**
   * Returns true only for entity types whose schema includes a `lastModifiedBy`
   * field. Applying the field to other collections writes a key that doesn't
   * belong and will confuse future queries.
   *
   * Currently: only Category defines lastModifiedBy.
   */
  private supportsLastModifiedBy(entityType: FileEntityType): boolean {
    return entityType === FileEntityType.CATEGORY;
  }

  // ─── Core Linking ─────────────────────────────────────────────────────────

  /**
   * Link an already-uploaded file to an entity.
   * Called either immediately after upload (when the entity already exists)
   * or during entity creation (to attach a pre-uploaded image).
   *
   * Returns { linked: false } — without an error — when the entity simply
   * doesn't exist yet. The caller can retry once the entity is created.
   */
  async linkImageToEntity(
    entityType: FileEntityType,
    entityId: string,
    imageLabel: Label,
    imageFieldName: string,
    fileId: Types.ObjectId,
    lastModifiedBy?: string
  ): Promise<ImageLinkResult> {
    try {
      const EntityModel = this.getEntityModel(entityType);
      const entityIdField = this.getEntityIdField(entityType);

      const entity = await EntityModel.findOne({
        [entityIdField]: new Types.ObjectId(entityId),
        isDeleted: false,
      });

      if (!entity) {
        return { linked: false };
      }

      const updateData: Record<string, unknown> = {
        [imageFieldName]: fileId,
      };

      if (this.supportsLastModifiedBy(entityType) && lastModifiedBy) {
        updateData.lastModifiedBy = new Types.ObjectId(lastModifiedBy);
      }

      await EntityModel.findByIdAndUpdate(entity._id, updateData, {
        new: true,
        runValidators: false,
      });

      return { linked: true, entityId: entity._id, fileId };
    } catch (error) {
      console.error(`Error linking ${imageLabel} to ${entityType}:`, error);
      return {
        linked: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Attach a pre-uploaded (orphaned) image to a newly created entity.
   * Looks up any active file for this entity whose label matches, then
   * writes the reference back onto the entity document.
   */
  async linkOrphanedImage(
    entityType: FileEntityType,
    entityId: string,
    imageLabel: Label,
    imageFieldName: string,
    lastModifiedBy?: string
  ): Promise<ImageLinkResult> {
    try {
      const files = await this.fileService.getFilesByEntity(
        entityType,
        entityId,
        { status: "active" }
      );

      const orphanedImage = files.find((f) => f.label === imageLabel);
      if (!orphanedImage) {
        return { linked: false };
      }

      const EntityModel = this.getEntityModel(entityType);

      const updateData: Record<string, unknown> = {
        [imageFieldName]: orphanedImage._id,
      };

      if (this.supportsLastModifiedBy(entityType) && lastModifiedBy) {
        updateData.lastModifiedBy = new Types.ObjectId(lastModifiedBy);
      }

      await EntityModel.findByIdAndUpdate(
        new Types.ObjectId(entityId),
        updateData,
        { new: true, runValidators: false }
      );

      return {
        linked: true,
        fileId: orphanedImage._id,
        url: orphanedImage.url,
      };
    } catch (error) {
      console.error(`Error linking orphaned ${imageLabel}:`, error);
      return {
        linked: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Appends multiple images to a provider profile array field.
   *
   * FIX: previous implementation used `{ [fieldName]: fileIds }` which
   * **replaced** the entire array on every call. Now uses `$addToSet` with
   * `$each` so existing images are preserved and duplicates are rejected
   * atomically by MongoDB.
   *
   * Field name reference (ProviderImageArrayField):
   *   "businessGalleryImages"  → ProviderProfile.businessGalleryImages[]
   *   "idDetails.fileImageId"  → ProviderProfile.idDetails.fileImageId[]
   *
   * The caller is responsible for clearing the array before calling this if
   * they want a full replacement (see ProviderProfileService.replaceIdImages).
   */
  async linkMultipleImagesToProvider(
    providerId: string,
    fileIds: Types.ObjectId[],
    fieldName: ProviderImageArrayField
  ): Promise<ImageLinkResult> {
    try {
      const entity = await ProviderProfileModel.findOne({
        _id: new Types.ObjectId(providerId),
        isDeleted: false,
      });

      if (!entity) {
        return { linked: false, error: "Provider not found" };
      }

      // $addToSet + $each: appends items that aren't already in the array.
      // This is idempotent — calling with the same fileIds twice is safe.
      await ProviderProfileModel.findByIdAndUpdate(
        entity._id,
        { $addToSet: { [fieldName]: { $each: fileIds } } },
        { new: true, runValidators: false }
      );

      return { linked: true, entityId: entity._id };
    } catch (error) {
      console.error("Error linking images to provider:", error);
      return {
        linked: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // ─── Unlinking ────────────────────────────────────────────────────────────

  /**
   * Remove a file reference from an entity document.
   * Called when the file record is archived or deleted.
   */
  async unlinkImage(
    entityType: FileEntityType,
    entityId: string,
    imageFieldName: string,
    fileId: Types.ObjectId,
    lastModifiedBy?: string
  ): Promise<{ unlinked: boolean; error?: string }> {
    try {
      const EntityModel = this.getEntityModel(entityType);
      const entityIdField = this.getEntityIdField(entityType);

      const updateData: Record<string, unknown> = {
        $unset: { [imageFieldName]: 1 },
      };

      if (this.supportsLastModifiedBy(entityType) && lastModifiedBy) {
        updateData.lastModifiedBy = new Types.ObjectId(lastModifiedBy);
      }

      const result = await EntityModel.findOneAndUpdate(
        {
          [entityIdField]: new Types.ObjectId(entityId),
          [imageFieldName]: fileId,
          isDeleted: false,
        },
        updateData,
        { new: true, runValidators: false }
      );

      return { unlinked: !!result };
    } catch (error) {
      console.error(`Error unlinking image from ${entityType}:`, error);
      return {
        unlinked: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // ─── Status & Diagnostics ─────────────────────────────────────────────────

  /**
   * Inspect the current link state between an entity and a labelled image.
   * Useful for debugging and pre-flight checks before upload flows.
   */
  async getImageStatus(
    entityType: FileEntityType,
    entityId: string,
    imageLabel: Label,
    imageFieldName: string
  ): Promise<{
    hasEntity: boolean;
    hasImage: boolean;
    isLinked: boolean;
    isPending: boolean;
    entityId?: Types.ObjectId;
    fileId?: Types.ObjectId;
    url?: string;
  }> {
    try {
      const EntityModel = this.getEntityModel(entityType);
      const entityIdField = this.getEntityIdField(entityType);

      const [entity, files] = await Promise.all([
        EntityModel.findOne({
          [entityIdField]: new Types.ObjectId(entityId),
          isDeleted: false,
        }),
        this.fileService.getFilesByEntity(entityType, entityId, {
          status: "active",
        }),
      ]);

      const image = files.find((f) => f.label === imageLabel);

      const hasEntity = !!entity;
      const hasImage  = !!image;
      const isLinked  =
        hasEntity &&
        hasImage &&
        entity[imageFieldName]?.toString() === image._id.toString();
      const isPending = hasImage && (!hasEntity || !isLinked);

      return {
        hasEntity,
        hasImage,
        isLinked,
        isPending,
        entityId: entity?._id,
        fileId:   image?._id,
        url:      image?.url,
      };
    } catch (error) {
      console.error(`Error getting ${imageLabel} status:`, error);
      return {
        hasEntity: false,
        hasImage:  false,
        isLinked:  false,
        isPending: false,
      };
    }
  }

  /**
   * Maintenance utility: repair stale or missing image links for a given
   * entity type and image label.
   *
   * Two cases handled:
   *   1. Entity references a file that no longer exists or doesn't match — clears the stale ref.
   *   2. Entity exists, file exists, but the foreign key is missing — writes the link.
   */
  async repairBrokenLinks(
    entityType: FileEntityType,
    imageLabel: Label,
    imageFieldName: string,
    specificEntityId?: string
  ): Promise<{ repaired: number; errors: string[] }> {
    const errors: string[] = [];
    let repaired = 0;

    try {
      const EntityModel   = this.getEntityModel(entityType);
      const entityIdField = this.getEntityIdField(entityType);

      const query: Record<string, unknown> = { isDeleted: false };
      if (specificEntityId) {
        query[entityIdField] = new Types.ObjectId(specificEntityId);
      }

      const entities = await EntityModel.find(query);

      for (const entity of entities) {
        try {
          const entityIdValue =
            entityType === FileEntityType.USER
              ? entity.userId.toString()
              : entity._id.toString();

          const files = await this.fileService.getFilesByEntity(
            entityType,
            entityIdValue,
            { status: "active" }
          );

          const image = files.find((f) => f.label === imageLabel);

          // Case 1: Stale reference — entity points to a file that no longer matches
          if (
            entity[imageFieldName] &&
            (!image || image._id.toString() !== entity[imageFieldName].toString())
          ) {
            await EntityModel.findByIdAndUpdate(
              entity._id,
              { $unset: { [imageFieldName]: 1 } },
              { runValidators: false }
            );
            repaired++;
          }

          // Case 2: Missing link — file exists but entity doesn't reference it
          if (!entity[imageFieldName] && image) {
            await EntityModel.findByIdAndUpdate(
              entity._id,
              { [imageFieldName]: image._id },
              { runValidators: false }
            );
            repaired++;
          }
        } catch (err) {
          errors.push(
            `Failed to repair ${entityType} ${entity._id}: ${
              err instanceof Error ? err.message : "Unknown error"
            }`
          );
        }
      }
    } catch (err) {
      errors.push(
        `Repair process failed: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    }

    return { repaired, errors };
  }

  // ─── Batch Operations ─────────────────────────────────────────────────────

  /**
   * Link images to multiple entities in a single call.
   * Processes configs sequentially to avoid overwhelming the DB connection pool.
   */
  async batchLinkImages(configs: LinkImageConfig[]): Promise<{
    successful: number;
    failed: number;
    errors: string[];
  }> {
    let successful = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const config of configs) {
      try {
        const files = await this.fileService.getFilesByEntity(
          config.entityType,
          config.entityId,
          { status: "active" }
        );

        const image = files.find((f) => f.label === config.imageLabel);

        if (!image) {
          failed++;
          errors.push(
            `No ${config.imageLabel} found for ${config.entityType} ${config.entityId}`
          );
          continue;
        }

        const result = await this.linkImageToEntity(
          config.entityType,
          config.entityId,
          config.imageLabel,
          config.imageFieldName,
          image._id,
          config.lastModifiedBy
        );

        if (result.linked) {
          successful++;
        } else {
          failed++;
          errors.push(
            result.error ??
              `Failed to link ${config.imageLabel} to ${config.entityType} ${config.entityId}`
          );
        }
      } catch (err) {
        failed++;
        errors.push(
          `Error processing ${config.entityType} ${config.entityId}: ${
            err instanceof Error ? err.message : "Unknown error"
          }`
        );
      }
    }

    return { successful, failed, errors };
  }

  /**
   * Returns all images that exist in the file store for this entity type
   * and label but are not linked to any entity document.
   *
   * TODO: implement per entity type — requires a cross-collection join
   * (aggregate $lookup between the files collection and the entity collection).
   */
  async getOrphanedImages(
    entityType: FileEntityType,
    imageLabel: Label
  ): Promise<{
    orphanedImages: Array<{
      fileId: Types.ObjectId;
      entityId: string;
      url: string;
      uploadedAt: Date;
    }>;
    count: number;
  }> {
    try {
      return { orphanedImages: [], count: 0 };
    } catch (error) {
      console.error(`Error getting orphaned ${imageLabel}:`, error);
      return { orphanedImages: [], count: 0 };
    }
  }
}