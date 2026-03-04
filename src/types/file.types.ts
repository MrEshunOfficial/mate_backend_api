import { Types } from "mongoose";

export enum FileEntityType {
  USER             = "user",
  CLIENT_PROFILE   = "client_profile",
  PROVIDER_PROFILE = "provider_profile",
  SERVICE          = "service",
  CATEGORY         = "category",
  BOOKING          = "booking",
  TASK             = "task",
}

// Renamed from File — avoids collision with the global browser/Node File API
export interface IFile {
  _id: Types.ObjectId;
  uploaderId?: Types.ObjectId;

  url: string;
  fileName: string;
  extension?: string;
  thumbnailUrl?: string;
  fileSize?: number;
  mimeType?: string;
  storageProvider: "local" | "s3" | "cloudinary" | "gcs" | "mega";

  metadata?: Record<string, unknown>;
  tags?: string[];
  description?: string;

  // Typed polymorphic entity link
  entityType?: FileEntityType;
  entityId?: Types.ObjectId;
  label?: string;

  status: "active" | "archived";
  lastAccessedAt?: Date;
  uploadedAt: Date;
  deletedAt?: Date;
}