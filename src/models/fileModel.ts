// models/files.model.ts
import mongoose, { Schema, Model, Document } from "mongoose";
import { IFile, FileEntityType } from "../types/file.types";

/**
 * Instance Methods Interface
 */
export interface IFileMethods {
  markAsAccessed(): Promise<this>;
  archive(): Promise<this>;
  restore(): Promise<this>;
  getFileAge(): number;
  isImage(): boolean;
  isVideo(): boolean;
  isDocument(): boolean;
  getFormattedFileSize(): string;
}

/**
 * Static Methods Interface
 */
export interface IFileModel extends Model<IFile, {}, IFileMethods> {
  findByUploader(
    uploaderId: mongoose.Types.ObjectId,
    options?: { status?: "active" | "archived"; limit?: number }
  ): mongoose.Query<
    (IFile & Document & IFileMethods)[],
    IFile & Document & IFileMethods
  >;

  findByEntity(
    entityType: FileEntityType,
    entityId: mongoose.Types.ObjectId,
    options?: { status?: "active" | "archived" }
  ): mongoose.Query<
    (IFile & Document & IFileMethods)[],
    IFile & Document & IFileMethods
  >;

  findByTags(
    tags: string[],
    options?: { status?: "active" | "archived"; matchAll?: boolean }
  ): mongoose.Query<
    (IFile & Document & IFileMethods)[],
    IFile & Document & IFileMethods
  >;

  findByStorageProvider(
    provider: "local" | "s3" | "cloudinary" | "gcs" | "mega",
    options?: { status?: "active" | "archived" }
  ): mongoose.Query<
    (IFile & Document & IFileMethods)[],
    IFile & Document & IFileMethods
  >;

  searchFiles(
    searchTerm: string,
    options?: { status?: "active" | "archived"; limit?: number }
  ): mongoose.Query<
    (IFile & Document & IFileMethods)[],
    IFile & Document & IFileMethods
  >;

  findByMimeTypeCategory(
    category: "image" | "video" | "audio" | "document" | "archive",
    options?: { status?: "active" | "archived" }
  ): mongoose.Query<
    (IFile & Document & IFileMethods)[],
    IFile & Document & IFileMethods
  >;

  getTotalStorageByUploader(uploaderId: mongoose.Types.ObjectId): Promise<
    Array<{
      _id: mongoose.Types.ObjectId;
      totalSize: number;
      fileCount: number;
    }>
  >;

  getStorageStats(): Promise<
    Array<{ _id: string; totalSize: number; fileCount: number }>
  >;

  cleanupOldArchived(daysOld?: number): Promise<{ deletedCount?: number }>;
}

/**
 * File Document type (combines IFile interface with Document and Methods)
 */
export type FileDocument = IFile & Document & IFileMethods;

/**
 * File Schema Definition
 */
const fileSchema = new Schema<IFile, IFileModel, IFileMethods>(
  {
    uploaderId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    extension: {
      type: String,
      trim: true,
    },
    thumbnailUrl: {
      type: String,
      trim: true,
    },
    url: {
      type: String,
      required: [true, "File URL is required"],
      trim: true,
    },
    fileName: {
      type: String,
      required: [true, "File name is required"],
      trim: true,
      index: true,
    },
    fileSize: {
      type: Number,
      min: [0, "File size cannot be negative"],
    },
    mimeType: {
      type: String,
      trim: true,
      index: true,
    },
    storageProvider: {
      type: String,
      required: [true, "Storage provider is required"],
      enum: {
        values: ["local", "s3", "cloudinary", "gcs", "mega"],
        message: "{VALUE} is not a valid storage provider",
      },
      default: "cloudinary",
      index: true,
    },
    // metadata is Record<string, unknown> — use Schema.Types.Mixed per-value
    // but restrict to a plain object (not Map) to align with the IFile type
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    tags: {
      type: [String],
      default: [],
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, "Description cannot exceed 1000 characters"],
    },
    // Typed polymorphic entity link — constrained to FileEntityType enum values
    entityType: {
      type: String,
      trim: true,
      enum: {
        values: Object.values(FileEntityType),
        message: "{VALUE} is not a valid entity type",
      },
      index: true,
    },
    entityId: {
      type: Schema.Types.ObjectId,
      index: true,
    },
    label: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: {
        values: ["active", "archived"],
        message: "{VALUE} is not a valid status",
      },
      default: "active",
      index: true,
    },
    lastAccessedAt: {
      type: Date,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    deletedAt: {
      type: Date,
      index: true,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
    collection: "files",
  }
);

// Compound indexes for common query patterns
fileSchema.index({ uploaderId: 1, uploadedAt: -1 });
fileSchema.index({ entityType: 1, entityId: 1 });
fileSchema.index({ status: 1, uploadedAt: -1 });
fileSchema.index({ storageProvider: 1, status: 1 });
fileSchema.index({ tags: 1, status: 1 });
fileSchema.index({ mimeType: 1, status: 1 });

// Text index for searching file names and descriptions
fileSchema.index({ fileName: "text", description: "text" });

/**
 * Instance Methods
 */

fileSchema.methods.markAsAccessed = function (this: FileDocument) {
  this.lastAccessedAt = new Date();
  return this.save();
};

fileSchema.methods.archive = function (this: FileDocument) {
  this.status = "archived";
  this.deletedAt = new Date();
  return this.save();
};

fileSchema.methods.restore = function (this: FileDocument) {
  this.status = "active";
  this.deletedAt = undefined;
  return this.save();
};

fileSchema.methods.getFileAge = function (this: FileDocument): number {
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - this.uploadedAt.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

fileSchema.methods.isImage = function (this: FileDocument): boolean {
  return this.mimeType?.startsWith("image/") ?? false;
};

fileSchema.methods.isVideo = function (this: FileDocument): boolean {
  return this.mimeType?.startsWith("video/") ?? false;
};

fileSchema.methods.isDocument = function (this: FileDocument): boolean {
  const documentMimeTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
  ];
  return documentMimeTypes.includes(this.mimeType ?? "");
};

fileSchema.methods.getFormattedFileSize = function (
  this: FileDocument
): string {
  if (!this.fileSize) return "Unknown";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = this.fileSize;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
};

/**
 * Static Methods
 */

fileSchema.statics.findByUploader = function (
  uploaderId: mongoose.Types.ObjectId,
  options?: { status?: "active" | "archived"; limit?: number }
) {
  const query = this.find({ uploaderId });

  if (options?.status) {
    query.where("status").equals(options.status);
  }
  if (options?.limit) {
    query.limit(options.limit);
  }

  return query.sort({ uploadedAt: -1 });
};

// entityType is now FileEntityType — enforced at the call site
fileSchema.statics.findByEntity = function (
  entityType: FileEntityType,
  entityId: mongoose.Types.ObjectId,
  options?: { status?: "active" | "archived" }
) {
  const query = this.find({ entityType, entityId });

  if (options?.status) {
    query.where("status").equals(options.status);
  }

  return query.sort({ uploadedAt: -1 });
};

fileSchema.statics.findByTags = function (
  tags: string[],
  options?: { status?: "active" | "archived"; matchAll?: boolean }
) {
  const query = options?.matchAll
    ? this.find({ tags: { $all: tags } })
    : this.find({ tags: { $in: tags } });

  if (options?.status) {
    query.where("status").equals(options.status);
  }

  return query.sort({ uploadedAt: -1 });
};

fileSchema.statics.findByStorageProvider = function (
  provider: "local" | "s3" | "cloudinary" | "gcs" | "mega",
  options?: { status?: "active" | "archived" }
) {
  const query = this.find({ storageProvider: provider });

  if (options?.status) {
    query.where("status").equals(options.status);
  }

  return query.sort({ uploadedAt: -1 });
};

fileSchema.statics.searchFiles = function (
  searchTerm: string,
  options?: { status?: "active" | "archived"; limit?: number }
) {
  const query = this.find({ $text: { $search: searchTerm } });

  if (options?.status) {
    query.where("status").equals(options.status);
  }
  if (options?.limit) {
    query.limit(options.limit);
  }

  return query.sort({ score: { $meta: "textScore" } });
};

fileSchema.statics.findByMimeTypeCategory = function (
  category: "image" | "video" | "audio" | "document" | "archive",
  options?: { status?: "active" | "archived" }
) {
  const mimeTypePatterns: Record<string, RegExp> = {
    image: /^image\//,
    video: /^video\//,
    audio: /^audio\//,
    document: /^(application\/(pdf|msword|vnd\.)|text\/)/,
    archive: /^application\/(zip|x-rar|x-7z)/,
  };

  const query = this.find({
    mimeType: { $regex: mimeTypePatterns[category] },
  });

  if (options?.status) {
    query.where("status").equals(options.status);
  }

  return query.sort({ uploadedAt: -1 });
};

fileSchema.statics.getTotalStorageByUploader = function (
  uploaderId: mongoose.Types.ObjectId
) {
  return this.aggregate([
    { $match: { uploaderId, status: "active" } },
    {
      $group: {
        _id: "$uploaderId",
        totalSize: { $sum: "$fileSize" },
        fileCount: { $sum: 1 },
      },
    },
  ]);
};

fileSchema.statics.getStorageStats = function () {
  return this.aggregate([
    { $match: { status: "active" } },
    {
      $group: {
        _id: "$storageProvider",
        totalSize: { $sum: "$fileSize" },
        fileCount: { $sum: 1 },
      },
    },
  ]);
};

fileSchema.statics.cleanupOldArchived = function (daysOld: number = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  return this.deleteMany({
    status: "archived",
    deletedAt: { $lte: cutoffDate },
  });
};

/**
 * Virtual Properties
 */

fileSchema.virtual("fileType").get(function (this: FileDocument) {
  if (!this.mimeType) return "unknown";

  if (this.mimeType.startsWith("image/")) return "image";
  if (this.mimeType.startsWith("video/")) return "video";
  if (this.mimeType.startsWith("audio/")) return "audio";
  if (
    this.mimeType.includes("pdf") ||
    this.mimeType.includes("document") ||
    this.mimeType.includes("sheet") ||
    this.mimeType.includes("presentation") ||
    this.mimeType.startsWith("text/")
  ) {
    return "document";
  }
  if (
    this.mimeType.includes("zip") ||
    this.mimeType.includes("rar") ||
    this.mimeType.includes("7z")
  ) {
    return "archive";
  }

  return "other";
});

fileSchema.virtual("formattedUploadDate").get(function (this: FileDocument) {
  return this.uploadedAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
});

/**
 * Pre-save middleware
 */
fileSchema.pre("save", function (next) {
  if (!this.extension && this.fileName) {
    const parts = this.fileName.split(".");
    if (parts.length > 1) {
      this.extension = parts[parts.length - 1].toLowerCase();
    }
  }
  next();
});

/**
 * Post-save middleware
 */
fileSchema.post("save", function (doc) {
  console.log(`File saved: ${doc.fileName} (${doc._id})`);
});

/**
 * Query middleware — exclude files with a deletedAt timestamp by default
 */
fileSchema.pre(/^find/, function (next) {
  const filter = (this as any).getFilter();
  if (!("deletedAt" in filter)) {
    (this as any).where({ deletedAt: { $exists: false } });
  }
  next();
});

export const FileModel = mongoose.model<IFile, IFileModel>("File", fileSchema);

export default FileModel;