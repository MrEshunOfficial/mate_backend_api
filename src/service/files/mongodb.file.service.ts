import { Types, Document } from "mongoose";
import FileModel from "../../models/fileModel";
import { IFile, FileEntityType } from "../../types/file.types";

export type FileDocument = Document &
  IFile & {
    archive(): Promise<FileDocument>;
    restore(): Promise<FileDocument>;
    markAsAccessed(): Promise<FileDocument>;
    getFileAge(): number;
    isImage(): boolean;
    isVideo(): boolean;
    isDocument(): boolean;
    getFormattedFileSize(): string;
  };

export interface CreateFileData {
  uploaderId?: Types.ObjectId;
  url: string;
  fileName: string;
  fileSize?: number;
  mimeType?: string;
  extension?: string;
  thumbnailUrl?: string;
  storageProvider: "local" | "s3" | "cloudinary" | "gcs" | "mega";
  metadata?: Record<string, unknown>;
  tags?: string[];
  description?: string;
  entityType?: FileEntityType;
  entityId?: Types.ObjectId;
  label?: string;
  status?: "active" | "archived";
  uploadedAt?: Date;
}

export interface UpdateFileData {
  fileName?: string;
  description?: string;
  tags?: string[];
  label?: string;
  metadata?: Record<string, unknown>;
  status?: "active" | "archived";
  // FIX: entityId was missing — required by orphan-mode configs to stamp the
  // entity onto a file record after the entity is created or updated with
  // a catCoverId / serviceImageId / etc. Without this field, getFilesByEntity
  // can never find orphan-uploaded files because entityId stays null forever.
  entityId?: Types.ObjectId;
}

export interface FileQueryOptions {
  status?: "active" | "archived";
  limit?: number;
  skip?: number;
  sort?: { [key: string]: 1 | -1 };
}

export class MongoDBFileService {
  /**
   * Create a new file record in MongoDB
   */
  async createFile(fileData: CreateFileData): Promise<IFile> {
    try {
      const file = new FileModel(fileData);
      await file.save();
      return file;
    } catch (error) {
      console.error("Failed to create file record:", error);
      throw new Error(
        `Failed to create file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get file by ID
   */
  async getFileById(fileId: string | Types.ObjectId): Promise<IFile | null> {
    try {
      if (!Types.ObjectId.isValid(fileId)) {
        throw new Error("Invalid file ID");
      }
      return await FileModel.findById(fileId);
    } catch (error) {
      console.error("Failed to get file:", error);
      throw new Error(
        `Failed to get file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Update file record
   */
  async updateFile(
    fileId: string | Types.ObjectId,
    updateData: UpdateFileData
  ): Promise<IFile | null> {
    try {
      if (!Types.ObjectId.isValid(fileId)) {
        throw new Error("Invalid file ID");
      }

      return await FileModel.findByIdAndUpdate(
        fileId,
        { $set: updateData },
        { new: true, runValidators: true }
      );
    } catch (error) {
      console.error("Failed to update file:", error);
      throw new Error(
        `Failed to update file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Delete file record (hard delete)
   */
  async deleteFile(fileId: string | Types.ObjectId): Promise<boolean> {
    try {
      if (!Types.ObjectId.isValid(fileId)) {
        throw new Error("Invalid file ID");
      }

      const result = await FileModel.findByIdAndDelete(fileId);
      return result !== null;
    } catch (error) {
      console.error("Failed to delete file:", error);
      throw new Error(
        `Failed to delete file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Archive file (soft delete)
   */
  async archiveFile(fileId: string | Types.ObjectId): Promise<IFile | null> {
    try {
      if (!Types.ObjectId.isValid(fileId)) {
        throw new Error("Invalid file ID");
      }

      const file = await FileModel.findById(fileId);
      if (!file) return null;

      return await file.archive();
    } catch (error) {
      console.error("Failed to archive file:", error);
      throw new Error(
        `Failed to archive file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Restore archived file
   */
  async restoreFile(fileId: string | Types.ObjectId): Promise<IFile | null> {
    try {
      if (!Types.ObjectId.isValid(fileId)) {
        throw new Error("Invalid file ID");
      }

      const file = await FileModel.findById(fileId);
      if (!file) return null;

      return await file.restore();
    } catch (error) {
      console.error("Failed to restore file:", error);
      throw new Error(
        `Failed to restore file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Mark file as accessed
   */
  async markAsAccessed(fileId: string | Types.ObjectId): Promise<IFile | null> {
    try {
      if (!Types.ObjectId.isValid(fileId)) {
        throw new Error("Invalid file ID");
      }

      const file = await FileModel.findById(fileId);
      if (!file) return null;

      return await file.markAsAccessed();
    } catch (error) {
      console.error("Failed to mark file as accessed:", error);
      throw new Error(
        `Failed to mark file as accessed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get files by uploader
   */
  async getFilesByUploader(
    uploaderId: string | Types.ObjectId,
    options?: FileQueryOptions
  ): Promise<IFile[]> {
    try {
      if (!Types.ObjectId.isValid(uploaderId)) {
        throw new Error("Invalid uploader ID");
      }

      return await FileModel.findByUploader(
        new Types.ObjectId(uploaderId),
        options
      );
    } catch (error) {
      console.error("Failed to get files by uploader:", error);
      throw new Error(
        `Failed to get files: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get files by entity
   */
  async getFilesByEntity(
    entityType: FileEntityType,
    entityId: string | Types.ObjectId,
    options?: FileQueryOptions
  ): Promise<IFile[]> {
    try {
      if (!Types.ObjectId.isValid(entityId)) {
        throw new Error("Invalid entity ID");
      }

      return await FileModel.findByEntity(
        entityType,
        new Types.ObjectId(entityId),
        options
      );
    } catch (error) {
      console.error("Failed to get files by entity:", error);
      throw new Error(
        `Failed to get files: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get files by tags
   */
  async getFilesByTags(
    tags: string[],
    options?: FileQueryOptions & { matchAll?: boolean }
  ): Promise<IFile[]> {
    try {
      return await FileModel.findByTags(tags, options);
    } catch (error) {
      console.error("Failed to get files by tags:", error);
      throw new Error(
        `Failed to get files: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Search files by name or description
   */
  async searchFiles(
    searchTerm: string,
    options?: FileQueryOptions
  ): Promise<IFile[]> {
    try {
      return await FileModel.searchFiles(searchTerm, options);
    } catch (error) {
      console.error("Failed to search files:", error);
      throw new Error(
        `Failed to search files: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get files by MIME type category
   */
  async getFilesByMimeTypeCategory(
    category: "image" | "video" | "audio" | "document" | "archive",
    options?: FileQueryOptions
  ): Promise<IFile[]> {
    try {
      return await FileModel.findByMimeTypeCategory(category, options);
    } catch (error) {
      console.error("Failed to get files by MIME type:", error);
      throw new Error(
        `Failed to get files: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get total storage by uploader
   */
  async getTotalStorageByUploader(uploaderId: string | Types.ObjectId) {
    try {
      if (!Types.ObjectId.isValid(uploaderId)) {
        throw new Error("Invalid uploader ID");
      }

      const result = await FileModel.getTotalStorageByUploader(
        new Types.ObjectId(uploaderId)
      );

      return result[0] ?? { totalSize: 0, fileCount: 0 };
    } catch (error) {
      console.error("Failed to get storage stats:", error);
      throw new Error(
        `Failed to get storage stats: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats() {
    try {
      return await FileModel.getStorageStats();
    } catch (error) {
      console.error("Failed to get storage stats:", error);
      throw new Error(
        `Failed to get storage stats: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Cleanup old archived files
   */
  async cleanupOldArchived(daysOld: number = 30): Promise<number> {
    try {
      const result = await FileModel.cleanupOldArchived(daysOld);
      return result.deletedCount ?? 0;
    } catch (error) {
      console.error("Failed to cleanup archived files:", error);
      throw new Error(
        `Failed to cleanup files: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get all files with pagination
   */
  async getAllFiles(options?: FileQueryOptions): Promise<{
    files: IFile[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const query: Record<string, unknown> = {};

      if (options?.status) {
        query.status = options.status;
      }

      const limit = options?.limit ?? 20;
      const skip = options?.skip ?? 0;
      const page = Math.floor(skip / limit) + 1;

      const [files, total] = await Promise.all([
        FileModel.find(query)
          .sort(options?.sort ?? { uploadedAt: -1 })
          .limit(limit)
          .skip(skip)
          .lean(),
        FileModel.countDocuments(query),
      ]);

      return {
        files: files as IFile[],
        total,
        page,
        limit,
      };
    } catch (error) {
      console.error("Failed to get all files:", error);
      throw new Error(
        `Failed to get files: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Bulk update files
   */
  async bulkUpdateFiles(
    fileIds: (string | Types.ObjectId)[],
    updateData: UpdateFileData
  ): Promise<number> {
    try {
      const validIds = fileIds.filter((id) => Types.ObjectId.isValid(id));

      const result = await FileModel.updateMany(
        { _id: { $in: validIds } },
        { $set: updateData }
      );

      return result.modifiedCount ?? 0;
    } catch (error) {
      console.error("Failed to bulk update files:", error);
      throw new Error(
        `Failed to bulk update: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Bulk delete files
   */
  async bulkDeleteFiles(fileIds: (string | Types.ObjectId)[]): Promise<number> {
    try {
      const validIds = fileIds.filter((id) => Types.ObjectId.isValid(id));

      const result = await FileModel.deleteMany({ _id: { $in: validIds } });

      return result.deletedCount ?? 0;
    } catch (error) {
      console.error("Failed to bulk delete files:", error);
      throw new Error(
        `Failed to bulk delete: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}