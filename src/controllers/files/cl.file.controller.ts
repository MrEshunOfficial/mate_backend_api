import multer from "multer";
import { RequestHandler } from "express";
import { CloudinaryFileService } from "../../service/files/cloudinary.file.service";
import { MongoDBFileService } from "../../service/files/mongodb.file.service";
import { CloudinaryConfigService } from "../../config/cloudinary.config";
import { GenericCloudinaryImageHandler } from "./handlers/cl.handler";
import { profilePictureConfig } from "./config/profilePicture.config";
import { categoryCoverConfig } from "./config/categoryCover.config";
import { serviceCoverConfig } from "./config/serviceCover.config";
import { clientIdImageConfig } from "./config/clientprofileImage.config";
import {
  providerGalleryConfig,
  providerIdImageConfig,
} from "./config/providerProfileImage.config";
import {
  bookingAttachmentConfig,
  taskAttachmentConfig,
} from "./config/bookingTaskimage.config";

// 50 MB global cap — individual handler configs enforce tighter per-type limits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ─── CloudinaryFileController ─────────────────────────────────────────────────
//
// All Cloudinary image operations for every entity type in one controller.
//
// Adding a new entity type:
//   1. Create a config file in config/files/ (model imports live there only)
//   2. Instantiate a new GenericCloudinaryImageHandler with that config
//   3. Bind its methods as named RequestHandler properties below
//   4. Wire the new properties to routes in the appropriate route file
//   Nothing else changes.
//
// Array-backed fields (provider gallery, client/provider id-image) expose two
// upload bindings:
//   upload*       — single file via multer.single(); appends to the array
//   uploadMultiple* — batch upload via multer.array(); appends all at once

export class CloudinaryFileController {
  private readonly cloudinaryService: CloudinaryFileService;
  private readonly mongoService: MongoDBFileService;

  public readonly uploadMiddleware: multer.Multer;

  // ─── Profile Picture ───────────────────────────────────────────────────────

  /** POST   /cloudinary/profile-picture
   *  Archives existing picture, uploads new one, auto-links to profile. */
  public readonly uploadProfilePicture: RequestHandler;

  /** GET    /cloudinary/profile-picture */
  public readonly getProfilePicture: RequestHandler;

  /** GET    /cloudinary/profile-picture/:userId */
  public readonly getPublicProfilePicture: RequestHandler;

  /** DELETE /cloudinary/profile-picture */
  public readonly deleteProfilePicture: RequestHandler;

  /** GET    /cloudinary/profile-picture/optimized */
  public readonly getOptimizedProfilePicture: RequestHandler;

  // ─── Category Cover ────────────────────────────────────────────────────────

  /** POST   /cloudinary/category-cover — orphan upload */
  public readonly uploadCategoryCover: RequestHandler;

  /** GET    /categories/:categoryId/cover */
  public readonly getCategoryCover: RequestHandler;

  /** GET    /categories/:categoryId/cover/public */
  public readonly getPublicCategoryCover: RequestHandler;

  /** DELETE /categories/:categoryId/cover */
  public readonly deleteCategoryCover: RequestHandler;

  /** GET    /categories/:categoryId/cover/optimized */
  public readonly getOptimizedCategoryCover: RequestHandler;

  // ─── Service Cover ─────────────────────────────────────────────────────────

  /** POST   /cloudinary/service-cover — orphan upload */
  public readonly uploadServiceCover: RequestHandler;

  /** GET    /services/:serviceId/cover */
  public readonly getServiceCover: RequestHandler;

  /** GET    /services/:serviceId/cover/public */
  public readonly getPublicServiceCover: RequestHandler;

  /** DELETE /services/:serviceId/cover */
  public readonly deleteServiceCover: RequestHandler;

  /** GET    /services/:serviceId/cover/optimized */
  public readonly getOptimizedServiceCover: RequestHandler;

  // ─── Client ID Image ───────────────────────────────────────────────────────
  //
  // idDetails.fileImageId is an array — uploads accumulate; delete requires :fileId.
  // config.isArray = true

  /** POST   /cloudinary/client-id-image
   *  Uploads one ID image and appends it to idDetails.fileImageId. */
  public readonly uploadClientIdImage: RequestHandler;

  /** POST   /cloudinary/client-id-images
   *  Uploads multiple ID images in one request and appends all to idDetails.fileImageId.
   *  Requires multer.array("images", maxFiles) middleware on the route. */
  public readonly uploadMultipleClientIdImages: RequestHandler;

  /** GET    /clients/:clientProfileId/id-image
   *  Returns all active ID image records for this client profile. */
  public readonly getClientIdImage: RequestHandler;

  /** DELETE /clients/:clientProfileId/id-image/:fileId
   *  Removes a specific Cloudinary asset, pulls its fileId from idDetails.fileImageId,
   *  and hard-deletes the MongoDB record. */
  public readonly deleteClientIdImage: RequestHandler;

  // ─── Provider Gallery ──────────────────────────────────────────────────────
  //
  // businessGalleryImages is an array — uploads accumulate; delete requires :fileId.
  // config.isArray = true

  /** POST   /cloudinary/provider-gallery
   *  Uploads one gallery image and appends it to businessGalleryImages. */
  public readonly uploadProviderGalleryImage: RequestHandler;

  /** POST   /cloudinary/provider-gallery-images
   *  Uploads multiple gallery images in one request.
   *  Requires multer.array("images", maxFiles) middleware on the route. */
  public readonly uploadMultipleProviderGalleryImages: RequestHandler;

  /** GET    /providers/:providerProfileId/gallery */
  public readonly getProviderGalleryImage: RequestHandler;

  /** GET    /providers/:providerProfileId/gallery/public */
  public readonly getPublicProviderGalleryImage: RequestHandler;

  /** DELETE /providers/:providerProfileId/gallery/:fileId */
  public readonly deleteProviderGalleryImage: RequestHandler;

  /** GET    /providers/:providerProfileId/gallery/optimized/:fileId */
  public readonly getOptimizedProviderGalleryImage: RequestHandler;

  // ─── Provider ID Image ─────────────────────────────────────────────────────
  //
  // idDetails.fileImageId is an array — uploads accumulate; delete requires :fileId.
  // config.isArray = true

  /** POST   /cloudinary/provider-id-image
   *  Uploads one ID image and appends it to idDetails.fileImageId. */
  public readonly uploadProviderIdImage: RequestHandler;

  /** POST   /cloudinary/provider-id-images
   *  Uploads multiple ID images in one request.
   *  Requires multer.array("images", maxFiles) middleware on the route. */
  public readonly uploadMultipleProviderIdImages: RequestHandler;

  /** GET    /providers/:providerProfileId/id-image */
  public readonly getProviderIdImage: RequestHandler;

  /** DELETE /providers/:providerProfileId/id-image/:fileId */
  public readonly deleteProviderIdImage: RequestHandler;

  // ─── Booking Attachment ────────────────────────────────────────────────────

  /** POST   /cloudinary/booking-attachment */
  public readonly uploadBookingAttachment: RequestHandler;

  /** GET    /bookings/:bookingId/attachments */
  public readonly getBookingAttachment: RequestHandler;

  /** DELETE /bookings/:bookingId/attachments/:fileId */
  public readonly deleteBookingAttachment: RequestHandler;

  // ─── Task Attachment ───────────────────────────────────────────────────────

  /** POST   /cloudinary/task-attachment */
  public readonly uploadTaskAttachment: RequestHandler;

  /** GET    /tasks/:taskId/attachments */
  public readonly getTaskAttachment: RequestHandler;

  /** DELETE /tasks/:taskId/attachments/:fileId */
  public readonly deleteTaskAttachment: RequestHandler;

  // ─── Constructor ───────────────────────────────────────────────────────────

  constructor(cloudinaryConfig: CloudinaryConfigService) {
    this.cloudinaryService = new CloudinaryFileService(cloudinaryConfig);
    this.mongoService = new MongoDBFileService();
    this.uploadMiddleware = upload;

    // ── Handler instantiation ────────────────────────────────────────────────

    const profilePictureHandler = new GenericCloudinaryImageHandler(
      profilePictureConfig,
      this.cloudinaryService,
      this.mongoService,
    );

    const categoryCoverHandler = new GenericCloudinaryImageHandler(
      categoryCoverConfig,
      this.cloudinaryService,
      this.mongoService,
    );

    const serviceCoverHandler = new GenericCloudinaryImageHandler(
      serviceCoverConfig,
      this.cloudinaryService,
      this.mongoService,
    );

    const clientIdImageHandler = new GenericCloudinaryImageHandler(
      clientIdImageConfig,
      this.cloudinaryService,
      this.mongoService,
    );

    const providerGalleryHandler = new GenericCloudinaryImageHandler(
      providerGalleryConfig,
      this.cloudinaryService,
      this.mongoService,
    );

    const providerIdImageHandler = new GenericCloudinaryImageHandler(
      providerIdImageConfig,
      this.cloudinaryService,
      this.mongoService,
    );

    const bookingAttachmentHandler = new GenericCloudinaryImageHandler(
      bookingAttachmentConfig,
      this.cloudinaryService,
      this.mongoService,
    );

    const taskAttachmentHandler = new GenericCloudinaryImageHandler(
      taskAttachmentConfig,
      this.cloudinaryService,
      this.mongoService,
    );

    // ── Profile Picture bindings ─────────────────────────────────────────────
    this.uploadProfilePicture = profilePictureHandler.upload.bind(
      profilePictureHandler,
    );
    this.getProfilePicture = profilePictureHandler.get.bind(
      profilePictureHandler,
    );
    this.getPublicProfilePicture = profilePictureHandler.getPublic.bind(
      profilePictureHandler,
    );
    this.deleteProfilePicture = profilePictureHandler.delete.bind(
      profilePictureHandler,
    );
    this.getOptimizedProfilePicture = profilePictureHandler.getOptimized.bind(
      profilePictureHandler,
    );

    // ── Category Cover bindings ──────────────────────────────────────────────
    this.uploadCategoryCover =
      categoryCoverHandler.upload.bind(categoryCoverHandler);
    this.getCategoryCover = categoryCoverHandler.get.bind(categoryCoverHandler);
    this.getPublicCategoryCover =
      categoryCoverHandler.getPublic.bind(categoryCoverHandler);
    this.deleteCategoryCover =
      categoryCoverHandler.delete.bind(categoryCoverHandler);
    this.getOptimizedCategoryCover =
      categoryCoverHandler.getOptimized.bind(categoryCoverHandler);

    // ── Service Cover bindings ───────────────────────────────────────────────
    this.uploadServiceCover =
      serviceCoverHandler.upload.bind(serviceCoverHandler);
    this.getServiceCover = serviceCoverHandler.get.bind(serviceCoverHandler);
    this.getPublicServiceCover =
      serviceCoverHandler.getPublic.bind(serviceCoverHandler);
    this.deleteServiceCover =
      serviceCoverHandler.delete.bind(serviceCoverHandler);
    this.getOptimizedServiceCover =
      serviceCoverHandler.getOptimized.bind(serviceCoverHandler);

    // ── Client ID Image bindings ─────────────────────────────────────────────
    this.uploadClientIdImage =
      clientIdImageHandler.upload.bind(clientIdImageHandler);
    this.uploadMultipleClientIdImages =
      clientIdImageHandler.uploadMultiple.bind(clientIdImageHandler);
    this.getClientIdImage = clientIdImageHandler.get.bind(clientIdImageHandler);
    this.deleteClientIdImage =
      clientIdImageHandler.delete.bind(clientIdImageHandler);

    // ── Provider Gallery bindings ────────────────────────────────────────────
    this.uploadProviderGalleryImage = providerGalleryHandler.upload.bind(
      providerGalleryHandler,
    );
    this.uploadMultipleProviderGalleryImages =
      providerGalleryHandler.uploadMultiple.bind(providerGalleryHandler);
    this.getProviderGalleryImage = providerGalleryHandler.get.bind(
      providerGalleryHandler,
    );
    this.getPublicProviderGalleryImage = providerGalleryHandler.getPublic.bind(
      providerGalleryHandler,
    );
    this.deleteProviderGalleryImage = providerGalleryHandler.delete.bind(
      providerGalleryHandler,
    );
    this.getOptimizedProviderGalleryImage =
      providerGalleryHandler.getOptimized.bind(providerGalleryHandler);

    // ── Provider ID Image bindings ───────────────────────────────────────────
    this.uploadProviderIdImage = providerIdImageHandler.upload.bind(
      providerIdImageHandler,
    );
    this.uploadMultipleProviderIdImages =
      providerIdImageHandler.uploadMultiple.bind(providerIdImageHandler);
    this.getProviderIdImage = providerIdImageHandler.get.bind(
      providerIdImageHandler,
    );
    this.deleteProviderIdImage = providerIdImageHandler.delete.bind(
      providerIdImageHandler,
    );

    // ── Booking Attachment bindings ──────────────────────────────────────────
    this.uploadBookingAttachment = bookingAttachmentHandler.upload.bind(
      bookingAttachmentHandler,
    );
    this.getBookingAttachment = bookingAttachmentHandler.get.bind(
      bookingAttachmentHandler,
    );
    this.deleteBookingAttachment = bookingAttachmentHandler.delete.bind(
      bookingAttachmentHandler,
    );

    // ── Task Attachment bindings ─────────────────────────────────────────────
    this.uploadTaskAttachment = taskAttachmentHandler.upload.bind(
      taskAttachmentHandler,
    );
    this.getTaskAttachment = taskAttachmentHandler.get.bind(
      taskAttachmentHandler,
    );
    this.deleteTaskAttachment = taskAttachmentHandler.delete.bind(
      taskAttachmentHandler,
    );
  }
}
