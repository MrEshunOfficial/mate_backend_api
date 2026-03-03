// config/cloudinary.config.ts
import { v2 as cloudinary, UploadApiResponse } from "cloudinary";

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export class CloudinaryConfigService {
  constructor(config: CloudinaryConfig) {
    // Cloudinary Configuration
    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
      secure: true, // HTTPS URLs
    });
  }

  /**
   * Helper method to get MIME type from format
   */
  private getMimeType(format: string, resourceType: string): string {
    const mimeTypeMap: Record<string, string> = {
      // Images
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      bmp: "image/bmp",
      // Videos
      mp4: "video/mp4",
      mpeg: "video/mpeg",
      mov: "video/quicktime",
      avi: "video/x-msvideo",
      webm: "video/webm",
      // Audio
      mp3: "audio/mpeg",
      wav: "audio/wav",
      ogg: "audio/ogg",
      // Documents
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      txt: "text/plain",
      csv: "text/csv",
      // Archives
      zip: "application/zip",
      rar: "application/x-rar-compressed",
      "7z": "application/x-7z-compressed",
    };

    return mimeTypeMap[format.toLowerCase()] || `${resourceType}/${format}`;
  }

  /**
   * Uploading file from buffer to Cloudinary
   */
  async uploadFromBuffer(
    buffer: Buffer,
    fileName: string,
    options?: {
      folderName?: string;
      isPublic?: boolean;
      metadata?: Record<string, string>;
      resourceType?: "image" | "video" | "raw" | "auto";
      tags?: string[];
      description?: string;
      entityType?: string;
      entityId?: string;
    }
  ): Promise<{
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
  }> {
    try {
      return new Promise((resolve, reject) => {
        const uploadOptions: any = {
          folder: options?.folderName || "uploads",
          resource_type: options?.resourceType || "auto",
          public_id: fileName.split(".")[0], // Remove extension
          use_filename: true,
          unique_filename: true,
          overwrite: false,
          context: {
            ...options?.metadata,
            ...(options?.description && { description: options.description }),
            ...(options?.entityType && { entityType: options.entityType }),
            ...(options?.entityId && { entityId: options.entityId }),
          },
          tags: options?.tags || [],
        };

        // Set access mode
        if (options?.isPublic === false) {
          uploadOptions.type = "private";
        } else {
          uploadOptions.type = "upload"; // Public by default
        }

        // Upload using upload_stream
        const uploadStream = cloudinary.uploader.upload_stream(
          uploadOptions,
          (error, result) => {
            if (error) {
              reject(error);
              return;
            }

            if (!result) {
              reject(new Error("Upload failed: No result returned"));
              return;
            }

            const extension = result.format;
            const mimeType = this.getMimeType(
              result.format,
              result.resource_type
            );

            // Generate thumbnail URL for images
            let thumbnailUrl: string | undefined;
            if (result.resource_type === "image") {
              thumbnailUrl = this.generateThumbnail(result.public_id);
            }

            resolve({
              url: result.url,
              secureUrl: result.secure_url,
              publicId: result.public_id,
              fileName: result.original_filename || fileName,
              fileSize: result.bytes,
              format: result.format,
              resourceType: result.resource_type,
              width: result.width,
              height: result.height,
              duration: result.duration,
              mimeType,
              extension,
              thumbnailUrl,
            });
          }
        );

        // Write buffer to stream
        uploadStream.end(buffer);
      });
    } catch (error) {
      console.error("Cloudinary upload failed:", error);
      throw new Error(`Failed to upload file to Cloudinary: ${error}`);
    }
  }

  /**
   * Upload file from local path to Cloudinary
   */
  async uploadFromPath(
    filePath: string,
    options?: {
      folderName?: string;
      isPublic?: boolean;
      metadata?: Record<string, string>;
      resourceType?: "image" | "video" | "raw" | "auto";
      tags?: string[];
      description?: string;
      entityType?: string;
      entityId?: string;
    }
  ): Promise<{
    url: string;
    secureUrl: string;
    publicId: string;
    fileName: string;
    fileSize: number;
    format: string;
    resourceType: string;
    mimeType?: string;
    extension?: string;
    thumbnailUrl?: string;
  }> {
    try {
      const uploadOptions: any = {
        folder: options?.folderName || "uploads",
        resource_type: options?.resourceType || "auto",
        use_filename: true,
        unique_filename: true,
        overwrite: false,
        context: {
          ...options?.metadata,
          ...(options?.description && { description: options.description }),
          ...(options?.entityType && { entityType: options.entityType }),
          ...(options?.entityId && { entityId: options.entityId }),
        },
        tags: options?.tags || [],
      };

      if (options?.isPublic === false) {
        uploadOptions.type = "private";
      }

      const result: UploadApiResponse = await cloudinary.uploader.upload(
        filePath,
        uploadOptions
      );

      const extension = result.format;
      const mimeType = this.getMimeType(result.format, result.resource_type);

      // Generate thumbnail URL for images
      let thumbnailUrl: string | undefined;
      if (result.resource_type === "image") {
        thumbnailUrl = this.generateThumbnail(result.public_id);
      }

      return {
        url: result.url,
        secureUrl: result.secure_url,
        publicId: result.public_id,
        fileName: result.original_filename || "",
        fileSize: result.bytes,
        format: result.format,
        resourceType: result.resource_type,
        mimeType,
        extension,
        thumbnailUrl,
      };
    } catch (error) {
      console.error("Cloudinary upload from path failed:", error);
      throw new Error(`Failed to upload file to Cloudinary: ${error}`);
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
      await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType as any,
      });
      console.log(`File ${publicId} deleted successfully`);
    } catch (error) {
      console.error("Failed to delete file:", error);
      throw new Error(`Failed to delete file from Cloudinary: ${error}`);
    }
  }

  /**
   * Generate transformation URL
   * Useful for resizing, cropping, optimizing images on-the-fly
   */
  generateTransformationUrl(
    publicId: string,
    transformations: {
      width?: number;
      height?: number;
      crop?: "fill" | "fit" | "scale" | "limit" | "thumb";
      quality?: number | "auto";
      format?: string;
      effect?: string;
    }
  ): string {
    return cloudinary.url(publicId, {
      transformation: [transformations],
      secure: true,
    });
  }

  /**
   * Generate thumbnail URL for images
   */
  generateThumbnail(
    publicId: string,
    width: number = 200,
    height: number = 200
  ): string {
    return cloudinary.url(publicId, {
      transformation: [
        {
          width,
          height,
          crop: "fill",
          gravity: "auto",
          quality: "auto",
          fetch_format: "auto",
        },
      ],
      secure: true,
    });
  }

  /**
   * Generate responsive image URLs
   */
  generateResponsiveUrls(
    publicId: string,
    widths: number[] = [320, 640, 768, 1024, 1280]
  ): { width: number; url: string }[] {
    return widths.map((width) => ({
      width,
      url: cloudinary.url(publicId, {
        transformation: [
          {
            width,
            crop: "scale",
            quality: "auto",
            fetch_format: "auto",
          },
        ],
        secure: true,
      }),
    }));
  }

  /**
   * Get file metadata
   */
  async getFileMetadata(publicId: string, resourceType: string = "image") {
    try {
      const result = await cloudinary.api.resource(publicId, {
        resource_type: resourceType as any,
      });

      const extension = result.format;
      const mimeType = this.getMimeType(result.format, result.resource_type);

      // Generate thumbnail URL for images
      let thumbnailUrl: string | undefined;
      if (result.resource_type === "image") {
        thumbnailUrl = this.generateThumbnail(result.public_id);
      }

      return {
        publicId: result.public_id,
        format: result.format,
        version: result.version,
        resourceType: result.resource_type,
        type: result.type,
        createdAt: result.created_at,
        bytes: result.bytes,
        width: result.width,
        height: result.height,
        url: result.url,
        secureUrl: result.secure_url,
        mimeType,
        extension,
        thumbnailUrl,
        tags: result.tags,
        context: result.context,
      };
    } catch (error) {
      console.error("Failed to get file metadata:", error);
      throw new Error(`Failed to get file metadata: ${error}`);
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(
    publicId: string,
    resourceType: string = "image"
  ): Promise<boolean> {
    try {
      await cloudinary.api.resource(publicId, {
        resource_type: resourceType as any,
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * List files in a folder
   */
  async listFiles(
    folderPath?: string,
    resourceType: string = "image"
  ): Promise<any[]> {
    try {
      const result = await cloudinary.api.resources({
        type: "upload",
        prefix: folderPath,
        resource_type: resourceType as any,
        max_results: 500,
      });

      return result.resources;
    } catch (error) {
      console.error("Failed to list files:", error);
      throw new Error(`Failed to list files: ${error}`);
    }
  }

  /**
   * Update file access mode (public/private)
   */
  async updateFileAccess(
    publicId: string,
    isPublic: boolean,
    resourceType: string = "image"
  ): Promise<void> {
    try {
      const newType = isPublic ? "upload" : "private";

      // Cloudinary doesn't have a direct "make public/private" method
      // We need to update the resource type
      await cloudinary.uploader.rename(publicId, publicId, {
        resource_type: resourceType as any,
        type: newType,
        overwrite: true,
      });
    } catch (error) {
      console.error("Failed to update file access:", error);
      throw new Error(`Failed to update file access: ${error}`);
    }
  }

  /**
   * Generate optimized image URL
   */
  getOptimizedUrl(
    publicId: string,
    options?: {
      width?: number;
      quality?: "auto" | number;
      format?: "auto" | "webp" | "jpg" | "png";
    }
  ): string {
    return cloudinary.url(publicId, {
      transformation: [
        {
          width: options?.width,
          quality: options?.quality || "auto",
          fetch_format: options?.format || "auto",
        },
      ],
      secure: true,
    });
  }

  /**
   * Add tags to a resource
   */
  async addTags(
    publicId: string,
    tags: string[],
    resourceType: string = "image"
  ): Promise<void> {
    try {
      await cloudinary.uploader.add_tag(tags.join(","), [publicId], {
        resource_type: resourceType as any,
      });
    } catch (error) {
      console.error("Failed to add tags:", error);
      throw new Error(`Failed to add tags: ${error}`);
    }
  }

  /**
   * Remove tags from a resource
   */
  async removeTags(
    publicId: string,
    tags: string[],
    resourceType: string = "image"
  ): Promise<void> {
    try {
      await cloudinary.uploader.remove_tag(tags.join(","), [publicId], {
        resource_type: resourceType as any,
      });
    } catch (error) {
      console.error("Failed to remove tags:", error);
      throw new Error(`Failed to remove tags: ${error}`);
    }
  }

  /**
   * Update file description and metadata
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
      const updateOptions: any = {
        resource_type: resourceType as any,
      };

      if (options.metadata || options.description) {
        updateOptions.context = {
          ...options.metadata,
          ...(options.description && { description: options.description }),
        };
      }

      await cloudinary.uploader.explicit(publicId, updateOptions);

      // Update tags separately if provided
      if (options.tags && options.tags.length > 0) {
        await this.addTags(publicId, options.tags, resourceType);
      }
    } catch (error) {
      console.error("Failed to update file metadata:", error);
      throw new Error(`Failed to update file metadata: ${error}`);
    }
  }
}

/**
 * Initialize Cloudinary Service from environment variables
 */
export const initCloudinaryService = (): CloudinaryConfigService => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "Cloudinary configuration missing: CLOUD_NAME, API_KEY, and API_SECRET are required"
    );
  }

  return new CloudinaryConfigService({
    cloudName,
    apiKey,
    apiSecret,
  });
};