import { RequestHandler } from "express";
import { MongoDBFileService } from "../../service/files/mongodb.file.service";
import { categoryCoverConfig } from "./config/categoryCover.config";
import { profilePictureConfig } from "./config/profilePicture.config";
import { serviceCoverConfig } from "./config/serviceCover.config";
import { GenericMongoDBImageHandler } from "./handlers/db.handler";
import {
  bookingAttachmentConfig,
  taskAttachmentConfig,
} from "./config/bookingTaskimage.config";
import { clientIdImageConfig } from "./config/clientprofileImage.config";
import {
  providerGalleryConfig,
  providerIdImageConfig,
} from "./config/providerProfileImage.config";

// ─── MongoDBFileController ────────────────────────────────────────────────────
//
// All MongoDB image record operations for every entity type in one controller.
//
// Adding a new entity type:
//   1. Create a config file in config/files/ (model imports live there only)
//   2. Instantiate a new GenericMongoDBImageHandler with that config
//   3. Bind its methods as named RequestHandler properties below
//   4. Wire the new properties to routes in the appropriate route file
//   Nothing else changes.

export class MongoDBFileController {
  private readonly fileService: MongoDBFileService;

  // ─── Profile Picture ───────────────────────────────────────────────────────

  /** GET    /profile-picture/record
   *  Returns the authenticated user's active picture record. Marks it accessed. */
  public readonly getProfilePictureRecord: RequestHandler;

  /** GET    /profile-picture/:userId/record
   *  Returns any user's active picture record (public-safe fields only). */
  public readonly getPublicProfilePictureRecord: RequestHandler;

  /** GET    /profile-picture/history
   *  Returns current active picture + paginated archive.
   *  Query params: limit (default 10), skip (default 0) */
  public readonly getProfilePictureHistory: RequestHandler;

  /** PATCH  /profile-picture/metadata
   *  Updates description and/or tags on the active picture.
   *  Body: { description?: string; tags?: string[] } */
  public readonly updateProfilePictureMetadata: RequestHandler;

  /** POST   /profile-picture/archive
   *  Archives the active picture (status → "archived"), clears profilePictureId.
   *  Cloudinary asset is NOT deleted — use CloudinaryFileController.deleteProfilePicture. */
  public readonly archiveProfilePicture: RequestHandler;

  /** POST   /profile-picture/restore/:fileId
   *  Restores an archived picture, archiving the current active one first. */
  public readonly restoreProfilePicture: RequestHandler;

  /** DELETE /profile-picture
   *  Hard-deletes the MongoDB record and unlinks from profile.
   *  Does NOT remove the Cloudinary asset. */
  public readonly deleteProfilePicture: RequestHandler;

  /** GET    /profile-picture/stats
   *  Storage and count stats for all picture records (active + archived). */
  public readonly getProfilePictureStats: RequestHandler;

  /** DELETE /profile-picture/cleanup
   *  Hard-deletes archived pictures older than `daysOld` days (default 30).
   *  Query params: daysOld (default "30") */
  public readonly cleanupArchivedProfilePictures: RequestHandler;

  // ─── Category Cover ────────────────────────────────────────────────────────

  /** GET    /categories/:categoryId/cover/record
   *  Returns the MongoDB file record for the active cover. Marks it accessed. */
  public readonly getCategoryCoverRecord: RequestHandler;

  /** GET    /categories/:categoryId/cover/record/public
   *  Returns the active cover record with public-safe fields only. */
  public readonly getPublicCategoryCoverRecord: RequestHandler;

  /** GET    /categories/:categoryId/cover/history
   *  Returns current active cover + paginated archive.
   *  Query params: limit (default 10), skip (default 0) */
  public readonly getCategoryCoverHistory: RequestHandler;

  /** PATCH  /categories/:categoryId/cover/metadata
   *  Updates description and/or tags on the active cover record.
   *  Body: { description?: string; tags?: string[] } */
  public readonly updateCategoryCoverMetadata: RequestHandler;

  /** POST   /categories/:categoryId/cover/archive
   *  Archives the active cover (status → "archived"), clears catCoverId.
   *  Cloudinary asset is NOT deleted — use CloudinaryFileController.deleteCategoryCover. */
  public readonly archiveCategoryCover: RequestHandler;

  /** POST   /categories/:categoryId/cover/restore/:fileId
   *  Restores an archived cover, archiving the current active one first. */
  public readonly restoreCategoryCover: RequestHandler;

  /** DELETE /categories/:categoryId/cover
   *  Hard-deletes the MongoDB record and unlinks catCoverId from the category.
   *  Does NOT remove the Cloudinary asset. */
  public readonly deleteCategoryCover: RequestHandler;

  /** GET    /categories/:categoryId/cover/stats
   *  Storage and count stats for all cover records (active + archived). */
  public readonly getCategoryCoverStats: RequestHandler;

  /** DELETE /categories/:categoryId/cover/cleanup
   *  Hard-deletes archived covers older than `daysOld` days (default 30).
   *  Removes MongoDB records only — Cloudinary assets are not affected.
   *  Query params: daysOld (default "30") */
  public readonly cleanupArchivedCategoryCovers: RequestHandler;

  // ─── Service Cover ─────────────────────────────────────────────────────────

  /** GET    /services/:serviceId/cover/record
   *  Returns the MongoDB file record for the active cover. Marks it accessed. */
  public readonly getServiceCoverRecord: RequestHandler;

  /** GET    /services/:serviceId/cover/record/public
   *  Returns the active cover record with public-safe fields only.
   *  Accessible to unauthenticated users browsing the platform. */
  public readonly getPublicServiceCoverRecord: RequestHandler;

  /** GET    /services/:serviceId/cover/history
   *  Returns current active cover + paginated archive.
   *  Query params: limit (default 10), skip (default 0) */
  public readonly getServiceCoverHistory: RequestHandler;

  /** PATCH  /services/:serviceId/cover/metadata
   *  Updates description and/or tags on the active cover record.
   *  Body: { description?: string; tags?: string[] } */
  public readonly updateServiceCoverMetadata: RequestHandler;

  /** POST   /services/:serviceId/cover/archive
   *  Archives the active cover (status → "archived"), clears coverImage on
   *  the service document.
   *  Cloudinary asset is NOT deleted — use CloudinaryFileController.deleteServiceCover. */
  public readonly archiveServiceCover: RequestHandler;

  /** POST   /services/:serviceId/cover/restore/:fileId
   *  Restores an archived cover, archiving the current active one first. */
  public readonly restoreServiceCover: RequestHandler;

  /** DELETE /services/:serviceId/cover
   *  Hard-deletes the MongoDB record and unlinks coverImage from the service.
   *  Does NOT remove the Cloudinary asset. */
  public readonly deleteServiceCover: RequestHandler;

  /** GET    /services/:serviceId/cover/stats
   *  Storage and count stats for all cover records (active + archived). */
  public readonly getServiceCoverStats: RequestHandler;

  /** DELETE /services/:serviceId/cover/cleanup
   *  Hard-deletes archived covers older than `daysOld` days (default 30).
   *  Removes MongoDB records only — Cloudinary assets are not affected.
   *  Query params: daysOld (default "30") */
  public readonly cleanupArchivedServiceCovers: RequestHandler;

  // ─── Client ID Image ───────────────────────────────────────────────────────
  //
  // All routes sit behind auth + client-ownership middleware.
  // No public record endpoint — ID documents are private.

  /** GET    /clients/:clientProfileId/id-image/record
   *  Returns the active ID image file record. Marks it accessed. */
  public readonly getClientIdImageRecord: RequestHandler;

  /** GET    /clients/:clientProfileId/id-image/history
   *  Returns active + paginated archived ID image records.
   *  Query params: limit (default 10), skip (default 0) */
  public readonly getClientIdImageHistory: RequestHandler;

  /** PATCH  /clients/:clientProfileId/id-image/metadata
   *  Updates description and/or tags on the active ID image record.
   *  Body: { description?: string; tags?: string[] } */
  public readonly updateClientIdImageMetadata: RequestHandler;

  /** POST   /clients/:clientProfileId/id-image/archive
   *  Archives the active ID image (status → "archived"), pulls it from
   *  idDetails.fileImageId on the ClientProfile document.
   *  Cloudinary asset is NOT deleted. */
  public readonly archiveClientIdImage: RequestHandler;

  /** POST   /clients/:clientProfileId/id-image/restore/:fileId
   *  Restores an archived ID image, archiving the current active one first. */
  public readonly restoreClientIdImage: RequestHandler;

  /** DELETE /clients/:clientProfileId/id-image
   *  Hard-deletes the MongoDB record and pulls the fileId from idDetails.fileImageId.
   *  Does NOT remove the Cloudinary asset. */
  public readonly deleteClientIdImage: RequestHandler;

  /** GET    /clients/:clientProfileId/id-image/stats
   *  Storage and count stats for all ID image records. */
  public readonly getClientIdImageStats: RequestHandler;

  /** DELETE /clients/:clientProfileId/id-image/cleanup
   *  Hard-deletes archived ID images older than `daysOld` days (default 30).
   *  Query params: daysOld (default "30") */
  public readonly cleanupArchivedClientIdImages: RequestHandler;

  // ─── Provider Gallery ──────────────────────────────────────────────────────
  //
  // Gallery images are publicly readable. Write operations (upload, archive,
  // delete) sit behind auth + provider-ownership middleware.

  /** GET    /providers/:providerProfileId/gallery/record
   *  Returns the active gallery image record. Marks it accessed. */
  public readonly getProviderGalleryRecord: RequestHandler;

  /** GET    /providers/:providerProfileId/gallery/record/public
   *  Returns the active gallery record with public-safe fields only. */
  public readonly getPublicProviderGalleryRecord: RequestHandler;

  /** GET    /providers/:providerProfileId/gallery/history
   *  Returns active + paginated archived gallery records.
   *  Query params: limit (default 10), skip (default 0) */
  public readonly getProviderGalleryHistory: RequestHandler;

  /** PATCH  /providers/:providerProfileId/gallery/metadata
   *  Updates description and/or tags on the active gallery record.
   *  Body: { description?: string; tags?: string[] } */
  public readonly updateProviderGalleryMetadata: RequestHandler;

  /** POST   /providers/:providerProfileId/gallery/archive
   *  Archives the gallery image (status → "archived"), pulls it from
   *  businessGalleryImages on the ProviderProfile document.
   *  Cloudinary asset is NOT deleted. */
  public readonly archiveProviderGallery: RequestHandler;

  /** POST   /providers/:providerProfileId/gallery/restore/:fileId
   *  Restores an archived gallery image, archiving the current active one first. */
  public readonly restoreProviderGallery: RequestHandler;

  /** DELETE /providers/:providerProfileId/gallery
   *  Hard-deletes the MongoDB record and pulls the fileId from businessGalleryImages.
   *  Does NOT remove the Cloudinary asset. */
  public readonly deleteProviderGallery: RequestHandler;

  /** GET    /providers/:providerProfileId/gallery/stats
   *  Storage and count stats for all gallery records. */
  public readonly getProviderGalleryStats: RequestHandler;

  /** DELETE /providers/:providerProfileId/gallery/cleanup
   *  Hard-deletes archived gallery images older than `daysOld` days (default 30).
   *  Query params: daysOld (default "30") */
  public readonly cleanupArchivedProviderGallery: RequestHandler;

  // ─── Provider ID Image ─────────────────────────────────────────────────────
  //
  // All routes sit behind auth + provider-ownership or admin middleware.
  // No public record endpoint.

  /** GET    /providers/:providerProfileId/id-image/record
   *  Returns the active ID image record. Marks it accessed. */
  public readonly getProviderIdImageRecord: RequestHandler;

  /** GET    /providers/:providerProfileId/id-image/history
   *  Returns active + paginated archived ID image records.
   *  Query params: limit (default 10), skip (default 0) */
  public readonly getProviderIdImageHistory: RequestHandler;

  /** PATCH  /providers/:providerProfileId/id-image/metadata
   *  Updates description and/or tags on the active ID image record.
   *  Body: { description?: string; tags?: string[] } */
  public readonly updateProviderIdImageMetadata: RequestHandler;

  /** POST   /providers/:providerProfileId/id-image/archive
   *  Archives the active ID image, pulls it from idDetails.fileImageId.
   *  Cloudinary asset is NOT deleted. */
  public readonly archiveProviderIdImage: RequestHandler;

  /** POST   /providers/:providerProfileId/id-image/restore/:fileId
   *  Restores an archived ID image, archiving the current active one first. */
  public readonly restoreProviderIdImage: RequestHandler;

  /** DELETE /providers/:providerProfileId/id-image
   *  Hard-deletes the MongoDB record and pulls the fileId from idDetails.fileImageId.
   *  Does NOT remove the Cloudinary asset. */
  public readonly deleteProviderIdImage: RequestHandler;

  /** GET    /providers/:providerProfileId/id-image/stats
   *  Storage and count stats for all ID image records. */
  public readonly getProviderIdImageStats: RequestHandler;

  /** DELETE /providers/:providerProfileId/id-image/cleanup
   *  Hard-deletes archived ID images older than `daysOld` days (default 30).
   *  Query params: daysOld (default "30") */
  public readonly cleanupArchivedProviderIdImages: RequestHandler;

  // ─── Booking Attachment ────────────────────────────────────────────────────
  //
  // Association is file-side only (Booking has no attachments array field).
  // All routes sit behind auth + booking-participant middleware.
  // No public endpoint.

  /** GET    /bookings/:bookingId/attachments/record
   *  Returns the active attachment record. Marks it accessed. */
  public readonly getBookingAttachmentRecord: RequestHandler;

  /** GET    /bookings/:bookingId/attachments/history
   *  Returns active + paginated archived attachment records.
   *  Query params: limit (default 10), skip (default 0) */
  public readonly getBookingAttachmentHistory: RequestHandler;

  /** PATCH  /bookings/:bookingId/attachments/metadata
   *  Updates description and/or tags on the active attachment record.
   *  Body: { description?: string; tags?: string[] } */
  public readonly updateBookingAttachmentMetadata: RequestHandler;

  /** POST   /bookings/:bookingId/attachments/archive
   *  Archives the attachment record (status → "archived").
   *  No entity-side field to clear. Cloudinary asset is NOT deleted. */
  public readonly archiveBookingAttachment: RequestHandler;

  /** POST   /bookings/:bookingId/attachments/restore/:fileId
   *  Restores an archived attachment record. */
  public readonly restoreBookingAttachment: RequestHandler;

  /** DELETE /bookings/:bookingId/attachments
   *  Hard-deletes the MongoDB record. No entity-side field to clear.
   *  Does NOT remove the Cloudinary asset. */
  public readonly deleteBookingAttachment: RequestHandler;

  /** GET    /bookings/:bookingId/attachments/stats
   *  Storage and count stats for all attachment records. */
  public readonly getBookingAttachmentStats: RequestHandler;

  /** DELETE /bookings/:bookingId/attachments/cleanup
   *  Hard-deletes archived attachments older than `daysOld` days (default 30).
   *  Query params: daysOld (default "30") */
  public readonly cleanupArchivedBookingAttachments: RequestHandler;

  // ─── Task Attachment ───────────────────────────────────────────────────────
  //
  // Association is file-side only (Task has no attachments array field).
  // All routes sit behind auth + task-owner middleware.
  // No public endpoint.

  /** GET    /tasks/:taskId/attachments/record
   *  Returns the active attachment record. Marks it accessed. */
  public readonly getTaskAttachmentRecord: RequestHandler;

  /** GET    /tasks/:taskId/attachments/history
   *  Returns active + paginated archived attachment records.
   *  Query params: limit (default 10), skip (default 0) */
  public readonly getTaskAttachmentHistory: RequestHandler;

  /** PATCH  /tasks/:taskId/attachments/metadata
   *  Updates description and/or tags on the active attachment record.
   *  Body: { description?: string; tags?: string[] } */
  public readonly updateTaskAttachmentMetadata: RequestHandler;

  /** POST   /tasks/:taskId/attachments/archive
   *  Archives the attachment record (status → "archived").
   *  No entity-side field to clear. Cloudinary asset is NOT deleted. */
  public readonly archiveTaskAttachment: RequestHandler;

  /** POST   /tasks/:taskId/attachments/restore/:fileId
   *  Restores an archived attachment record. */
  public readonly restoreTaskAttachment: RequestHandler;

  /** DELETE /tasks/:taskId/attachments
   *  Hard-deletes the MongoDB record. No entity-side field to clear.
   *  Does NOT remove the Cloudinary asset. */
  public readonly deleteTaskAttachment: RequestHandler;

  /** GET    /tasks/:taskId/attachments/stats
   *  Storage and count stats for all attachment records. */
  public readonly getTaskAttachmentStats: RequestHandler;

  /** DELETE /tasks/:taskId/attachments/cleanup
   *  Hard-deletes archived attachments older than `daysOld` days (default 30).
   *  Query params: daysOld (default "30") */
  public readonly cleanupArchivedTaskAttachments: RequestHandler;

  // ─── Constructor ───────────────────────────────────────────────────────────

  constructor() {
    this.fileService = new MongoDBFileService();

    // ── Handler instantiation ────────────────────────────────────────────────

    const profilePictureHandler = new GenericMongoDBImageHandler(
      profilePictureConfig,
      this.fileService,
    );

    const categoryCoverHandler = new GenericMongoDBImageHandler(
      categoryCoverConfig,
      this.fileService,
    );

    const serviceCoverHandler = new GenericMongoDBImageHandler(
      serviceCoverConfig,
      this.fileService,
    );

    const clientIdImageHandler = new GenericMongoDBImageHandler(
      clientIdImageConfig,
      this.fileService,
    );

    const providerGalleryHandler = new GenericMongoDBImageHandler(
      providerGalleryConfig,
      this.fileService,
    );

    const providerIdImageHandler = new GenericMongoDBImageHandler(
      providerIdImageConfig,
      this.fileService,
    );

    const bookingAttachmentHandler = new GenericMongoDBImageHandler(
      bookingAttachmentConfig,
      this.fileService,
    );

    const taskAttachmentHandler = new GenericMongoDBImageHandler(
      taskAttachmentConfig,
      this.fileService,
    );

    // ── Profile Picture bindings ─────────────────────────────────────────────
    this.getProfilePictureRecord = profilePictureHandler.getRecord.bind(
      profilePictureHandler,
    );
    this.getPublicProfilePictureRecord =
      profilePictureHandler.getPublicRecord.bind(profilePictureHandler);
    this.getProfilePictureHistory = profilePictureHandler.getHistory.bind(
      profilePictureHandler,
    );
    this.updateProfilePictureMetadata =
      profilePictureHandler.updateMetadata.bind(profilePictureHandler);
    this.archiveProfilePicture = profilePictureHandler.archive.bind(
      profilePictureHandler,
    );
    this.restoreProfilePicture = profilePictureHandler.restore.bind(
      profilePictureHandler,
    );
    this.deleteProfilePicture = profilePictureHandler.delete.bind(
      profilePictureHandler,
    );
    this.getProfilePictureStats = profilePictureHandler.getStats.bind(
      profilePictureHandler,
    );
    this.cleanupArchivedProfilePictures =
      profilePictureHandler.cleanupArchived.bind(profilePictureHandler);

    // ── Category Cover bindings ──────────────────────────────────────────────
    this.getCategoryCoverRecord =
      categoryCoverHandler.getRecord.bind(categoryCoverHandler);
    this.getPublicCategoryCoverRecord =
      categoryCoverHandler.getPublicRecord.bind(categoryCoverHandler);
    this.getCategoryCoverHistory =
      categoryCoverHandler.getHistory.bind(categoryCoverHandler);
    this.updateCategoryCoverMetadata =
      categoryCoverHandler.updateMetadata.bind(categoryCoverHandler);
    this.archiveCategoryCover =
      categoryCoverHandler.archive.bind(categoryCoverHandler);
    this.restoreCategoryCover =
      categoryCoverHandler.restore.bind(categoryCoverHandler);
    this.deleteCategoryCover =
      categoryCoverHandler.delete.bind(categoryCoverHandler);
    this.getCategoryCoverStats =
      categoryCoverHandler.getStats.bind(categoryCoverHandler);
    this.cleanupArchivedCategoryCovers =
      categoryCoverHandler.cleanupArchived.bind(categoryCoverHandler);

    // ── Service Cover bindings ───────────────────────────────────────────────
    this.getServiceCoverRecord =
      serviceCoverHandler.getRecord.bind(serviceCoverHandler);
    this.getPublicServiceCoverRecord =
      serviceCoverHandler.getPublicRecord.bind(serviceCoverHandler);
    this.getServiceCoverHistory =
      serviceCoverHandler.getHistory.bind(serviceCoverHandler);
    this.updateServiceCoverMetadata =
      serviceCoverHandler.updateMetadata.bind(serviceCoverHandler);
    this.archiveServiceCover =
      serviceCoverHandler.archive.bind(serviceCoverHandler);
    this.restoreServiceCover =
      serviceCoverHandler.restore.bind(serviceCoverHandler);
    this.deleteServiceCover =
      serviceCoverHandler.delete.bind(serviceCoverHandler);
    this.getServiceCoverStats =
      serviceCoverHandler.getStats.bind(serviceCoverHandler);
    this.cleanupArchivedServiceCovers =
      serviceCoverHandler.cleanupArchived.bind(serviceCoverHandler);

    // ── Client ID Image bindings ─────────────────────────────────────────────
    this.getClientIdImageRecord =
      clientIdImageHandler.getRecord.bind(clientIdImageHandler);
    this.getClientIdImageHistory =
      clientIdImageHandler.getHistory.bind(clientIdImageHandler);
    this.updateClientIdImageMetadata =
      clientIdImageHandler.updateMetadata.bind(clientIdImageHandler);
    this.archiveClientIdImage =
      clientIdImageHandler.archive.bind(clientIdImageHandler);
    this.restoreClientIdImage =
      clientIdImageHandler.restore.bind(clientIdImageHandler);
    this.deleteClientIdImage =
      clientIdImageHandler.delete.bind(clientIdImageHandler);
    this.getClientIdImageStats =
      clientIdImageHandler.getStats.bind(clientIdImageHandler);
    this.cleanupArchivedClientIdImages =
      clientIdImageHandler.cleanupArchived.bind(clientIdImageHandler);

    // ── Provider Gallery bindings ────────────────────────────────────────────
    this.getProviderGalleryRecord = providerGalleryHandler.getRecord.bind(
      providerGalleryHandler,
    );
    this.getPublicProviderGalleryRecord =
      providerGalleryHandler.getPublicRecord.bind(providerGalleryHandler);
    this.getProviderGalleryHistory = providerGalleryHandler.getHistory.bind(
      providerGalleryHandler,
    );
    this.updateProviderGalleryMetadata =
      providerGalleryHandler.updateMetadata.bind(providerGalleryHandler);
    this.archiveProviderGallery = providerGalleryHandler.archive.bind(
      providerGalleryHandler,
    );
    this.restoreProviderGallery = providerGalleryHandler.restore.bind(
      providerGalleryHandler,
    );
    this.deleteProviderGallery = providerGalleryHandler.delete.bind(
      providerGalleryHandler,
    );
    this.getProviderGalleryStats = providerGalleryHandler.getStats.bind(
      providerGalleryHandler,
    );
    this.cleanupArchivedProviderGallery =
      providerGalleryHandler.cleanupArchived.bind(providerGalleryHandler);

    // ── Provider ID Image bindings ───────────────────────────────────────────
    this.getProviderIdImageRecord = providerIdImageHandler.getRecord.bind(
      providerIdImageHandler,
    );
    this.getProviderIdImageHistory = providerIdImageHandler.getHistory.bind(
      providerIdImageHandler,
    );
    this.updateProviderIdImageMetadata =
      providerIdImageHandler.updateMetadata.bind(providerIdImageHandler);
    this.archiveProviderIdImage = providerIdImageHandler.archive.bind(
      providerIdImageHandler,
    );
    this.restoreProviderIdImage = providerIdImageHandler.restore.bind(
      providerIdImageHandler,
    );
    this.deleteProviderIdImage = providerIdImageHandler.delete.bind(
      providerIdImageHandler,
    );
    this.getProviderIdImageStats = providerIdImageHandler.getStats.bind(
      providerIdImageHandler,
    );
    this.cleanupArchivedProviderIdImages =
      providerIdImageHandler.cleanupArchived.bind(providerIdImageHandler);

    // ── Booking Attachment bindings ──────────────────────────────────────────
    this.getBookingAttachmentRecord = bookingAttachmentHandler.getRecord.bind(
      bookingAttachmentHandler,
    );
    this.getBookingAttachmentHistory = bookingAttachmentHandler.getHistory.bind(
      bookingAttachmentHandler,
    );
    this.updateBookingAttachmentMetadata =
      bookingAttachmentHandler.updateMetadata.bind(bookingAttachmentHandler);
    this.archiveBookingAttachment = bookingAttachmentHandler.archive.bind(
      bookingAttachmentHandler,
    );
    this.restoreBookingAttachment = bookingAttachmentHandler.restore.bind(
      bookingAttachmentHandler,
    );
    this.deleteBookingAttachment = bookingAttachmentHandler.delete.bind(
      bookingAttachmentHandler,
    );
    this.getBookingAttachmentStats = bookingAttachmentHandler.getStats.bind(
      bookingAttachmentHandler,
    );
    this.cleanupArchivedBookingAttachments =
      bookingAttachmentHandler.cleanupArchived.bind(bookingAttachmentHandler);

    // ── Task Attachment bindings ─────────────────────────────────────────────
    this.getTaskAttachmentRecord = taskAttachmentHandler.getRecord.bind(
      taskAttachmentHandler,
    );
    this.getTaskAttachmentHistory = taskAttachmentHandler.getHistory.bind(
      taskAttachmentHandler,
    );
    this.updateTaskAttachmentMetadata =
      taskAttachmentHandler.updateMetadata.bind(taskAttachmentHandler);
    this.archiveTaskAttachment = taskAttachmentHandler.archive.bind(
      taskAttachmentHandler,
    );
    this.restoreTaskAttachment = taskAttachmentHandler.restore.bind(
      taskAttachmentHandler,
    );
    this.deleteTaskAttachment = taskAttachmentHandler.delete.bind(
      taskAttachmentHandler,
    );
    this.getTaskAttachmentStats = taskAttachmentHandler.getStats.bind(
      taskAttachmentHandler,
    );
    this.cleanupArchivedTaskAttachments =
      taskAttachmentHandler.cleanupArchived.bind(taskAttachmentHandler);
  }
}
