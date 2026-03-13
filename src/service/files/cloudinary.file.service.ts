// services/cloudinary.file.service.ts
import { Types } from "mongoose";
import { CloudinaryConfigService } from "../../config/cloudinary.config";

export interface UploadFileOptions {
  folderName?: string;
  isPublic?: boolean;
  metadata?: Record<string, string>;
  resourceType?: "image" | "video" | "raw" | "auto";
  tags?: string[];
  description?: string;
  entityType?: string;
  entityId?: string;
  uploaderId?: Types.ObjectId;
  label?: string;
}

export interface CloudinaryUploadResult {
  url: string;
  secureUrl: string;
  publicId: string;
  fileName: string;
  fileSize: number;
  format: string;
  resourceType: string;
  width?: number;
  height?: number;
  duration?: number;
  mimeType?: string;
  extension?: string;
  thumbnailUrl?: string;
}

export class CloudinaryFileService {
  private cloudinaryService: CloudinaryConfigService;

  constructor(cloudinaryService: CloudinaryConfigService) {
    this.cloudinaryService = cloudinaryService;
  }

  /**
   * Upload file from buffer to Cloudinary
   */
  async uploadFile(
    buffer: Buffer,
    fileName: string,
    options?: UploadFileOptions
  ): Promise<CloudinaryUploadResult> {
    try {
      const result = await this.cloudinaryService.uploadFromBuffer(
        buffer,
        fileName,
        {
          folderName: options?.folderName,
          isPublic: options?.isPublic,
          metadata: options?.metadata,
          resourceType: options?.resourceType,
          tags: options?.tags,
          description: options?.description,
          entityType: options?.entityType,
          entityId: options?.entityId?.toString(),
        }
      );

      return result;
    } catch (error) {
      console.error("Failed to upload file to Cloudinary:", error);
      throw new Error(
        `Cloudinary upload failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Upload file from path to Cloudinary
   */
  async uploadFileFromPath(
    filePath: string,
    options?: UploadFileOptions
  ): Promise<CloudinaryUploadResult> {
    try {
      const result = await this.cloudinaryService.uploadFromPath(filePath, {
        folderName: options?.folderName,
        isPublic: options?.isPublic,
        metadata: options?.metadata,
        resourceType: options?.resourceType,
        tags: options?.tags,
        description: options?.description,
        entityType: options?.entityType,
        entityId: options?.entityId?.toString(),
      });

      return result;
    } catch (error) {
      console.error("Failed to upload file from path to Cloudinary:", error);
      throw new Error(
        `Cloudinary upload failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Delete file from Cloudinary
   */
  async deleteFile(
    publicId: string,
    resourceType: string = "image"
  ): Promise<void> {
    try {
      await this.cloudinaryService.deleteFile(publicId, resourceType);
    } catch (error) {
      console.error("Failed to delete file from Cloudinary:", error);
      throw new Error(
        `Cloudinary deletion failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Generate thumbnail URL
   */
  generateThumbnail(
    publicId: string,
    width: number = 200,
    height: number = 200
  ): string {
    return this.cloudinaryService.generateThumbnail(publicId, width, height);
  }

  /**
   * Generate optimized URL
   */
  getOptimizedUrl(
    publicId: string,
    options?: {
      width?: number;
      quality?: "auto" | number;
      format?: "auto" | "webp" | "jpg" | "png";
    }
  ): string {
    return this.cloudinaryService.getOptimizedUrl(publicId, options);
  }

  /**
   * Generate responsive URLs
   */
  generateResponsiveUrls(
    publicId: string,
    widths?: number[]
  ): { width: number; url: string }[] {
    return this.cloudinaryService.generateResponsiveUrls(publicId, widths);
  }

  /**
   * Get file metadata from Cloudinary
   */
  async getFileMetadata(publicId: string, resourceType: string = "image") {
    try {
      return await this.cloudinaryService.getFileMetadata(
        publicId,
        resourceType
      );
    } catch (error) {
      console.error("Failed to get file metadata from Cloudinary:", error);
      throw new Error(
        `Failed to get metadata: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Check if file exists in Cloudinary
   */
  async fileExists(
    publicId: string,
    resourceType: string = "image"
  ): Promise<boolean> {
    return await this.cloudinaryService.fileExists(publicId, resourceType);
  }

  /**
   * Add tags to file
   */
  async addTags(
    publicId: string,
    tags: string[],
    resourceType: string = "image"
  ): Promise<void> {
    try {
      await this.cloudinaryService.addTags(publicId, tags, resourceType);
    } catch (error) {
      console.error("Failed to add tags:", error);
      throw new Error(
        `Failed to add tags: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Remove tags from file
   */
  async removeTags(
    publicId: string,
    tags: string[],
    resourceType: string = "image"
  ): Promise<void> {
    try {
      await this.cloudinaryService.removeTags(publicId, tags, resourceType);
    } catch (error) {
      console.error("Failed to remove tags:", error);
      throw new Error(
        `Failed to remove tags: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Update file metadata
   */
  async updateFileMetadata(
    publicId: string,
    options: {
      description?: string;
      metadata?: Record<string, string>;
      tags?: string[];
    },
    resourceType: string = "image"
  ): Promise<void> {
    try {
      await this.cloudinaryService.updateFileMetadata(
        publicId,
        options,
        resourceType
      );
    } catch (error) {
      console.error("Failed to update file metadata:", error);
      throw new Error(
        `Failed to update metadata: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}