import { RequestHandler } from "express";
import multer from "multer";
import { CloudinaryConfigService } from "../../config/cloudinary.config";
import { CloudinaryFileService } from "../../service/files/cloudinary.file.service";
import { MongoDBFileService } from "../../service/files/mongodb.file.service";
import { categoryCoverConfig } from "./config/categoryCover.config";
import { profilePictureConfig } from "./config/profilePicture.config";
import { serviceCoverConfig } from "./config/serviceCover.config";
import { GenericCloudinaryImageHandler } from "./handlers/cl.handler";
import { bookingAttachmentConfig, taskAttachmentConfig } from "./config/bookingTaskimage.config";
import { clientIdImageConfig } from "./config/clientprofileImage.config";
import { providerGalleryConfig, providerIdImageConfig } from "./config/providerProfileImage.config";

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

export class CloudinaryFileController {
  private readonly cloudinaryService: CloudinaryFileService;
  private readonly mongoService: MongoDBFileService;

  public readonly uploadMiddleware: multer.Multer;

  // ─── Profile Picture ───────────────────────────────────────────────────────

  /** POST   /cloudinary/profile-picture
   *  Archives existing picture, uploads new one, auto-links to profile if it exists. */
  public readonly uploadProfilePicture: RequestHandler;

  /** GET    /cloudinary/profile-picture
   *  Returns the authenticated user's active profile picture. */
  public readonly getProfilePicture: RequestHandler;

  /** GET    /cloudinary/profile-picture/:userId
   *  Returns any user's active profile picture (public-safe fields only). */
  public readonly getPublicProfilePicture: RequestHandler;

  /** DELETE /cloudinary/profile-picture
   *  Removes Cloudinary asset, unlinks from profile, hard-deletes MongoDB record. */
  public readonly deleteProfilePicture: RequestHandler;

  /** GET    /cloudinary/profile-picture/optimized
   *  Returns a Cloudinary transformation URL.
   *  Query params: width (int), quality (int | "auto"), format ("auto"|"webp"|"jpg"|"png") */
  public readonly getOptimizedProfilePicture: RequestHandler;

  // ─── Category Cover ────────────────────────────────────────────────────────

  /** POST   /cloudinary/category-cover
   *  Orphan upload — no categoryId required.
   *  Returns fileId to be passed as catCoverId on category create/update. */
  public readonly uploadCategoryCover: RequestHandler;

  /** GET    /categories/:categoryId/cover
   *  Returns the URL and metadata of the current active cover. */
  public readonly getCategoryCover: RequestHandler;

  /** GET    /categories/:categoryId/cover/public
   *  Returns the active cover with public-safe fields only.
   *  Accessible to unauthenticated users browsing the platform. */
  public readonly getPublicCategoryCover: RequestHandler;

  /** DELETE /categories/:categoryId/cover
   *  Full delete: removes Cloudinary asset, clears catCoverId, hard-deletes MongoDB record. */
  public readonly deleteCategoryCover: RequestHandler;

  /** GET    /categories/:categoryId/cover/optimized
   *  Returns a Cloudinary transformation URL.
   *  Query params: width (int), quality (int | "auto"), format ("auto"|"webp"|"jpg"|"png") */
  public readonly getOptimizedCategoryCover: RequestHandler;

  // ─── Service Cover ─────────────────────────────────────────────────────────
  //
  // Service covers use "orphan" upload mode — the upload endpoint has no
  // serviceId in its URL. The returned fileId is passed as coverImage in the
  // service create/update body, at which point linkFileToCreatedEntity stamps
  // entityId onto the file record and sets coverImage on the service document.

  /** POST   /cloudinary/service-cover
   *  Orphan upload — no serviceId required.
   *  Returns fileId to be passed as coverImage on service create/update. */
  public readonly uploadServiceCover: RequestHandler;

  /** GET    /services/:serviceId/cover
   *  Returns the URL and metadata of the current active cover.
   *  Publicly accessible — no authentication required. */
  public readonly getServiceCover: RequestHandler;

  /** GET    /services/:serviceId/cover/public
   *  Returns the active cover with public-safe fields only.
   *  Intended for unauthenticated browsing consumers. */
  public readonly getPublicServiceCover: RequestHandler;

  /** DELETE /services/:serviceId/cover
   *  Full delete: removes Cloudinary asset, clears coverImage on the service
   *  document, hard-deletes the MongoDB record. */
  public readonly deleteServiceCover: RequestHandler;

  /** GET    /services/:serviceId/cover/optimized
   *  Returns a Cloudinary transformation URL.
   *  Query params: width (int), quality (int | "auto"), format ("auto"|"webp"|"jpg"|"png") */
  public readonly getOptimizedServiceCover: RequestHandler;

  // ─── Client ID Image ───────────────────────────────────────────────────────
  //
  // ID documents are always uploaded against an existing ClientProfile.
  // Upload mode: "linked" — entityId is known at upload time.
  // No public endpoint — ID documents are private to the client and admins.
  // The idDetails.fileImageId field is an array; link/unlink use $addToSet/$pull.

  /** POST   /cloudinary/client-id-image
   *  Uploads a new ID document image and links it to the client's profile.
   *  Requires :clientProfileId in body or derived from auth context. */
  public readonly uploadClientIdImage: RequestHandler;

  /** GET    /clients/:clientProfileId/id-image
   *  Returns the active ID image records for this client profile. */
  public readonly getClientIdImage: RequestHandler;

  /** DELETE /clients/:clientProfileId/id-image
   *  Removes Cloudinary asset, pulls the fileId from idDetails.fileImageId,
   *  hard-deletes the MongoDB record. */
  public readonly deleteClientIdImage: RequestHandler;

  // ─── Provider Gallery ──────────────────────────────────────────────────────
  //
  // Business gallery images are publicly visible and are uploaded by providers
  // against their existing ProviderProfile. Upload mode: "linked".
  // The businessGalleryImages field is an array; link/unlink use $addToSet/$pull.

  /** POST   /cloudinary/provider-gallery
   *  Uploads a new gallery image and adds it to businessGalleryImages. */
  public readonly uploadProviderGalleryImage: RequestHandler;

  /** GET    /providers/:providerProfileId/gallery
   *  Returns the active gallery image records (authenticated). */
  public readonly getProviderGalleryImage: RequestHandler;

  /** GET    /providers/:providerProfileId/gallery/public
   *  Returns gallery images with public-safe fields only.
   *  Accessible to unauthenticated users browsing the platform. */
  public readonly getPublicProviderGalleryImage: RequestHandler;

  /** DELETE /providers/:providerProfileId/gallery
   *  Removes Cloudinary asset, pulls fileId from businessGalleryImages,
   *  hard-deletes the MongoDB record. */
  public readonly deleteProviderGalleryImage: RequestHandler;

  /** GET    /providers/:providerProfileId/gallery/optimized
   *  Returns a Cloudinary transformation URL for a gallery image.
   *  Query params: width (int), quality (int | "auto"), format ("auto"|"webp"|"jpg"|"png") */
  public readonly getOptimizedProviderGalleryImage: RequestHandler;

  // ─── Provider ID Image ─────────────────────────────────────────────────────
  //
  // ID documents for identity verification — private to the provider and admins.
  // Upload mode: "linked". The idDetails.fileImageId field is an array.
  // No public endpoint. No optimized endpoint (not a display image).

  /** POST   /cloudinary/provider-id-image
   *  Uploads a new ID document image and links it to the provider's profile. */
  public readonly uploadProviderIdImage: RequestHandler;

  /** GET    /providers/:providerProfileId/id-image
   *  Returns the active ID image records (auth + ownership/admin required). */
  public readonly getProviderIdImage: RequestHandler;

  /** DELETE /providers/:providerProfileId/id-image
   *  Removes Cloudinary asset, pulls fileId from idDetails.fileImageId,
   *  hard-deletes the MongoDB record. */
  public readonly deleteProviderIdImage: RequestHandler;

  // ─── Booking Attachment ────────────────────────────────────────────────────
  //
  // Completion photos, receipts, and dispute evidence attached to a booking.
  // Upload mode: "linked" — bookings always exist before files are attached.
  // Association is file-side only (Booking has no attachments array field).
  // No public endpoint. No optimized endpoint.

  /** POST   /cloudinary/booking-attachment
   *  Uploads a file and stamps it with the bookingId as entityId.
   *  Requires :bookingId in body. */
  public readonly uploadBookingAttachment: RequestHandler;

  /** GET    /bookings/:bookingId/attachments
   *  Returns all active attachment records for this booking. */
  public readonly getBookingAttachment: RequestHandler;

  /** DELETE /bookings/:bookingId/attachments
   *  Removes Cloudinary asset and hard-deletes the MongoDB record.
   *  No entity-side field to clear — association is file-side only. */
  public readonly deleteBookingAttachment: RequestHandler;

  // ─── Task Attachment ───────────────────────────────────────────────────────
  //
  // Supporting photos and reference images attached by the client when posting
  // a task. Upload mode: "linked" — tasks always exist before files are attached.
  // Association is file-side only (Task has no attachments array field).
  // No public endpoint. No optimized endpoint.

  /** POST   /cloudinary/task-attachment
   *  Uploads a file and stamps it with the taskId as entityId.
   *  Requires :taskId in body. */
  public readonly uploadTaskAttachment: RequestHandler;

  /** GET    /tasks/:taskId/attachments
   *  Returns all active attachment records for this task. */
  public readonly getTaskAttachment: RequestHandler;

  /** DELETE /tasks/:taskId/attachments
   *  Removes Cloudinary asset and hard-deletes the MongoDB record.
   *  No entity-side field to clear — association is file-side only. */
  public readonly deleteTaskAttachment: RequestHandler;

  // ─── Constructor ───────────────────────────────────────────────────────────

  constructor(cloudinaryConfig: CloudinaryConfigService) {
    this.cloudinaryService = new CloudinaryFileService(cloudinaryConfig);
    this.mongoService      = new MongoDBFileService();
    this.uploadMiddleware  = upload;

    // ── Handler instantiation ────────────────────────────────────────────────

    const profilePictureHandler = new GenericCloudinaryImageHandler(
      profilePictureConfig,
      this.cloudinaryService,
      this.mongoService
    );

    const categoryCoverHandler = new GenericCloudinaryImageHandler(
      categoryCoverConfig,
      this.cloudinaryService,
      this.mongoService
    );

    const serviceCoverHandler = new GenericCloudinaryImageHandler(
      serviceCoverConfig,
      this.cloudinaryService,
      this.mongoService
    );

    const clientIdImageHandler = new GenericCloudinaryImageHandler(
      clientIdImageConfig,
      this.cloudinaryService,
      this.mongoService
    );

    const providerGalleryHandler = new GenericCloudinaryImageHandler(
      providerGalleryConfig,
      this.cloudinaryService,
      this.mongoService
    );

    const providerIdImageHandler = new GenericCloudinaryImageHandler(
      providerIdImageConfig,
      this.cloudinaryService,
      this.mongoService
    );

    const bookingAttachmentHandler = new GenericCloudinaryImageHandler(
      bookingAttachmentConfig,
      this.cloudinaryService,
      this.mongoService
    );

    const taskAttachmentHandler = new GenericCloudinaryImageHandler(
      taskAttachmentConfig,
      this.cloudinaryService,
      this.mongoService
    );

    // ── Profile Picture bindings ─────────────────────────────────────────────
    this.uploadProfilePicture       = profilePictureHandler.upload.bind(profilePictureHandler);
    this.getProfilePicture          = profilePictureHandler.get.bind(profilePictureHandler);
    this.getPublicProfilePicture    = profilePictureHandler.getPublic.bind(profilePictureHandler);
    this.deleteProfilePicture       = profilePictureHandler.delete.bind(profilePictureHandler);
    this.getOptimizedProfilePicture = profilePictureHandler.getOptimized.bind(profilePictureHandler);

    // ── Category Cover bindings ──────────────────────────────────────────────
    this.uploadCategoryCover        = categoryCoverHandler.upload.bind(categoryCoverHandler);
    this.getCategoryCover           = categoryCoverHandler.get.bind(categoryCoverHandler);
    this.getPublicCategoryCover     = categoryCoverHandler.getPublic.bind(categoryCoverHandler);
    this.deleteCategoryCover        = categoryCoverHandler.delete.bind(categoryCoverHandler);
    this.getOptimizedCategoryCover  = categoryCoverHandler.getOptimized.bind(categoryCoverHandler);

    // ── Service Cover bindings ───────────────────────────────────────────────
    this.uploadServiceCover         = serviceCoverHandler.upload.bind(serviceCoverHandler);
    this.getServiceCover            = serviceCoverHandler.get.bind(serviceCoverHandler);
    this.getPublicServiceCover      = serviceCoverHandler.getPublic.bind(serviceCoverHandler);
    this.deleteServiceCover         = serviceCoverHandler.delete.bind(serviceCoverHandler);
    this.getOptimizedServiceCover   = serviceCoverHandler.getOptimized.bind(serviceCoverHandler);

    // ── Client ID Image bindings ─────────────────────────────────────────────
    this.uploadClientIdImage        = clientIdImageHandler.upload.bind(clientIdImageHandler);
    this.getClientIdImage           = clientIdImageHandler.get.bind(clientIdImageHandler);
    this.deleteClientIdImage        = clientIdImageHandler.delete.bind(clientIdImageHandler);

    // ── Provider Gallery bindings ────────────────────────────────────────────
    this.uploadProviderGalleryImage        = providerGalleryHandler.upload.bind(providerGalleryHandler);
    this.getProviderGalleryImage           = providerGalleryHandler.get.bind(providerGalleryHandler);
    this.getPublicProviderGalleryImage     = providerGalleryHandler.getPublic.bind(providerGalleryHandler);
    this.deleteProviderGalleryImage        = providerGalleryHandler.delete.bind(providerGalleryHandler);
    this.getOptimizedProviderGalleryImage  = providerGalleryHandler.getOptimized.bind(providerGalleryHandler);

    // ── Provider ID Image bindings ───────────────────────────────────────────
    this.uploadProviderIdImage      = providerIdImageHandler.upload.bind(providerIdImageHandler);
    this.getProviderIdImage         = providerIdImageHandler.get.bind(providerIdImageHandler);
    this.deleteProviderIdImage      = providerIdImageHandler.delete.bind(providerIdImageHandler);

    // ── Booking Attachment bindings ──────────────────────────────────────────
    this.uploadBookingAttachment    = bookingAttachmentHandler.upload.bind(bookingAttachmentHandler);
    this.getBookingAttachment       = bookingAttachmentHandler.get.bind(bookingAttachmentHandler);
    this.deleteBookingAttachment    = bookingAttachmentHandler.delete.bind(bookingAttachmentHandler);

    // ── Task Attachment bindings ─────────────────────────────────────────────
    this.uploadTaskAttachment       = taskAttachmentHandler.upload.bind(taskAttachmentHandler);
    this.getTaskAttachment          = taskAttachmentHandler.get.bind(taskAttachmentHandler);
    this.deleteTaskAttachment       = taskAttachmentHandler.delete.bind(taskAttachmentHandler);
  }
}