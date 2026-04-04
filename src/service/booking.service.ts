// services/bookings/booking.service.ts
import { Types, HydratedDocument } from "mongoose";
import BookingModel from "../models/booking.model";
import ClientProfileModel from "../models/profiles/client.profile.model";
import ProviderProfileModel from "../models/profiles/provider.profile.model";
import { ServiceModel } from "../models/service/serviceModel";
import TaskModel from "../models/task.model";
import { ActorRole } from "../types/base.types";
import {
  Booking,
  BookingMethods,
  BookingStatus,
  PaymentStatus,
  ValidateBookingRequestBody,
} from "../types/bookings.types";
import { UserLocation } from "../types/location.types";
import { ServiceRequestStatus } from "../types/service-request.types";
import { TaskStatus } from "../types/tasks.types";
import ServiceRequestModel from "../models/service/service-request.model";

type BookingDocument = HydratedDocument<Booking, BookingMethods>;

// ─── Local Input Types ────────────────────────────────────────────────────────

/**
 * Data the caller must supply when converting an ACCEPTED task into a booking.
 *
 * The Task entity deliberately stores no serviceId — it matches providers, not
 * specific services. The caller must pick a concrete service from the provider's
 * matched offerings before a booking can be created.
 */
export interface CreateBookingFromTaskInput {
  /**
   * Which specific service is being booked.
   *
   * OPTIONAL for the task flow — when omitted the service is resolved
   * automatically from task.matchedProviders[acceptedProvider].matchedServices[0].
   *
   * A client may supply this explicitly if the provider offers multiple
   * services and the task matched more than one.
   */
  serviceId?: string;
  /** Where the service will be delivered */
  serviceLocation: UserLocation;
  scheduledDate: Date;
  scheduledTimeSlot: { start: string; end: string };
  /** Summary of work to be done — shown to the provider */
  serviceDescription: string;
  specialInstructions?: string;
  estimatedPrice?: number;
  /** ISO 4217 currency code — defaults to GHS */
  currency?: string;
}

/**
 * Optional overrides when converting an ACCEPTED ServiceRequest into a booking.
 *
 * Most fields (serviceLocation, scheduledDate, timeSlot, serviceId) are
 * inherited from the ServiceRequest itself. Only provide these if you need
 * to override the values stored on the ServiceRequest.
 */
export interface CreateBookingFromServiceRequestInput {
  /**
   * Human-readable summary of the work to be done.
   * Defaults to the ServiceRequest's clientMessage when omitted.
   */
  serviceDescription?: string;
  specialInstructions?: string;
  /**
   * Negotiated price — defaults to the ServiceRequest's estimatedBudget.max
   * when omitted, then falls back to the service's basePrice.
   */
  estimatedPrice?: number;
  /** Override the scheduled date from the ServiceRequest */
  scheduledDate?: Date;
  /** Override the time slot from the ServiceRequest */
  scheduledTimeSlot?: { start: string; end: string };
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Statuses that a booking can be cancelled from */
const CANCELLABLE_STATUSES: BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.IN_PROGRESS,
];

/** Statuses that a booking can be rescheduled from */
const RESCHEDULABLE_STATUSES: BookingStatus[] = [BookingStatus.CONFIRMED];

/** All terminal statuses — no further transitions are valid */
const TERMINAL_STATUSES: BookingStatus[] = [
  BookingStatus.VALIDATED,
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
];

/** Default currency applied when none is supplied */
const DEFAULT_CURRENCY = "GHS";

// ─── Service ──────────────────────────────────────────────────────────────────

export class BookingService {
  // ─── Creation: Flow 1 — From Task ────────────────────────────────────────────

  /**
   * Converts an ACCEPTED task into a confirmed booking.
   *
   * Atomic sequence:
   *   1. Verify task exists and is ACCEPTED
   *   2. Verify the accepted provider, service, and client all exist
   *   3. Validate the service belongs to the accepted provider
   *   4. Resolve deposit settings from the provider's profile
   *   5. Generate a unique booking number
   *   6. Persist the Booking document (status: CONFIRMED)
   *   7. Stamp the Task as CONVERTED (via TaskModel.findOneAndUpdate —
   *      avoids importing TaskService to prevent a circular dependency)
   *
   * Steps 6 and 7 are not wrapped in a MongoDB transaction because the
   * codebase does not yet use sessions. If step 7 fails after step 6 succeeds
   * the task will remain in ACCEPTED status and the booking will still be valid.
   * A background reconciliation job can detect and fix this drift by querying:
   *   Booking.taskId exists AND Task.status === ACCEPTED
   *
   * @param taskId - the Task._id to convert
   * @param data   - service selection and scheduling details
   */
  async createBookingFromTask(
    taskId: string,
    data: CreateBookingFromTaskInput,
  ): Promise<{ booking: Booking; taskUpdated: boolean }> {
    if (!Types.ObjectId.isValid(taskId)) throw new Error("Invalid task ID");
    if (data.serviceId && !Types.ObjectId.isValid(data.serviceId)) {
      throw new Error("Invalid service ID");
    }

    // ── 1. Load and verify the task ────────────────────────────────────────────
    const task = await TaskModel.findOne({
      _id: new Types.ObjectId(taskId),
      status: TaskStatus.ACCEPTED,
      isDeleted: false,
    }).lean();

    if (!task) {
      throw new Error(
        "Task not found or not in ACCEPTED status. " +
          "Only accepted tasks can be converted to bookings.",
      );
    }

    const acceptedProviderId = task.acceptedProvider?.providerId;
    if (!acceptedProviderId) {
      throw new Error(
        "Task has no accepted provider — this is an inconsistent state",
      );
    }

    // ── 2. Resolve serviceId ───────────────────────────────────────────────────
    //
    // If the caller supplied a serviceId, use it directly.
    // Otherwise derive it from the accepted provider's matchedServices array —
    // this is the set of services the matching algorithm found relevant to the
    // task. We take the first one (highest-scoring match).
    //
    // If neither source yields a valid ID we fail fast with a clear message
    // rather than letting the service ownership check produce a confusing error.
    let resolvedServiceId: string;

    if (data.serviceId) {
      resolvedServiceId = data.serviceId;
    } else {
      const acceptedProviderMatch = task.matchedProviders?.find(
        (mp) => mp.providerId.toString() === acceptedProviderId.toString(),
      );

      const derivedServiceId = acceptedProviderMatch?.matchedServices?.[0];

      if (
        !derivedServiceId ||
        !Types.ObjectId.isValid(String(derivedServiceId))
      ) {
        throw new Error(
          "Could not determine a service for this booking. " +
            "The accepted provider has no matched services on this task. " +
            "Please provide a serviceId explicitly.",
        );
      }

      resolvedServiceId = String(derivedServiceId);
    }

    // ── 3. Verify provider, service ownership, and client in parallel ──────────
    const [provider, service, clientExists] = await Promise.all([
      ProviderProfileModel.findOne({
        _id: acceptedProviderId,
        isDeleted: false,
      }).lean(),
      ServiceModel.findOne({
        _id: new Types.ObjectId(resolvedServiceId),
        isActive: true,
        isDeleted: false,
      }).lean(),
      ClientProfileModel.countDocuments({
        _id: task.clientId,
        isDeleted: false,
      }),
    ]);

    if (!provider) throw new Error("Accepted provider profile not found");
    if (!service) throw new Error("Service not found or inactive");
    if (!clientExists) throw new Error("Client profile not found");

    // Service must belong to the accepted provider
    if (service.providerId?.toString() !== acceptedProviderId.toString()) {
      throw new Error(
        "The selected service does not belong to the accepted provider",
      );
    }

    // ── 4. Resolve pricing and deposit ────────────────────────────────────────
    const estimatedPrice =
      data.estimatedPrice ?? service.servicePricing?.basePrice ?? undefined;

    const { depositAmount } = this.resolveDepositSettings(
      provider,
      estimatedPrice,
    );

    // ── 5 & 6. Generate booking number and persist ────────────────────────────
    const bookingNumber = await BookingModel.generateBookingNumber();

    const booking = await BookingModel.create({
      bookingNumber,
      taskId: new Types.ObjectId(taskId),
      clientId: task.clientId,
      providerId: acceptedProviderId,
      serviceId: new Types.ObjectId(resolvedServiceId),
      serviceLocation: data.serviceLocation,
      scheduledDate: data.scheduledDate,
      scheduledTimeSlot: data.scheduledTimeSlot,
      serviceDescription: data.serviceDescription.trim(),
      specialInstructions: data.specialInstructions?.trim(),
      estimatedPrice,
      depositAmount,
      depositPaid: false,
      currency: (data.currency ?? DEFAULT_CURRENCY).toUpperCase(),
      status: BookingStatus.CONFIRMED,
      paymentStatus: PaymentStatus.PENDING,
      statusHistory: [
        {
          status: BookingStatus.CONFIRMED,
          timestamp: new Date(),
          actorRole: ActorRole.SYSTEM,
          message: "Booking created from accepted task",
        },
      ],
    });

    // ── 7. Stamp the task as CONVERTED ────────────────────────────────────────
    const taskUpdateResult = await TaskModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(taskId),
        status: TaskStatus.ACCEPTED,
        isDeleted: false,
      },
      {
        status: TaskStatus.CONVERTED,
        convertedToBookingId: booking._id,
        convertedAt: new Date(),
      },
    );

    return {
      booking: booking.toObject() as Booking,
      taskUpdated: !!taskUpdateResult,
    };
  }

  // ─── Creation: Flow 2 — From ServiceRequest ───────────────────────────────

  /**
   * Accepts a pending ServiceRequest and immediately creates a confirmed booking.
   *
   * This method is the provider's single action for "accepting" a service
   * request from a client who browsed services and sent a direct request.
   *
   * Atomic sequence:
   *   1. Verify the ServiceRequest is PENDING and belongs to this provider
   *   2. Verify provider, service, and client all still exist and are active
   *   3. Resolve deposit settings from the provider's profile
   *   4. Generate a unique booking number
   *   5. Persist the Booking document (status: CONFIRMED)
   *   6. Transition the ServiceRequest to ACCEPTED and stamp convertedToBookingId
   *
   * The same session-less note from createBookingFromTask applies here.
   *
   * @param serviceRequestId - the ServiceRequest._id to accept and convert
   * @param providerProfileId - the provider accepting the request (ownership guard)
   * @param data             - optional overrides for price, description, schedule
   */
  async createBookingFromServiceRequest(
    serviceRequestId: string,
    providerProfileId: string,
    data: CreateBookingFromServiceRequestInput = {},
  ): Promise<{ booking: Booking; serviceRequestUpdated: boolean }> {
    if (!Types.ObjectId.isValid(serviceRequestId)) {
      throw new Error("Invalid service request ID");
    }
    if (!Types.ObjectId.isValid(providerProfileId)) {
      throw new Error("Invalid provider profile ID");
    }

    // ── 1. Load and verify the service request ───────────────────────────────
    const serviceRequest = await ServiceRequestModel.findOne({
      _id: new Types.ObjectId(serviceRequestId),
      providerId: new Types.ObjectId(providerProfileId),
      status: ServiceRequestStatus.PENDING,
      isDeleted: false,
    }).lean();

    if (!serviceRequest) {
      throw new Error(
        "Service request not found, not in PENDING status, " +
          "or does not belong to this provider.",
      );
    }

    // Guard: enforce request expiry — expired requests must not be accepted
    if (serviceRequest.expiresAt && serviceRequest.expiresAt < new Date()) {
      throw new Error(
        "This service request has expired and can no longer be accepted",
      );
    }

    // ── 2. Verify provider, service, and client in parallel ─────────────────
    const [provider, service, clientExists] = await Promise.all([
      ProviderProfileModel.findOne({
        _id: new Types.ObjectId(providerProfileId),
        isDeleted: false,
      }).lean(),
      ServiceModel.findOne({
        _id: serviceRequest.serviceId,
        isActive: true,
        isDeleted: false,
      }).lean(),
      ClientProfileModel.countDocuments({
        _id: serviceRequest.clientId,
        isDeleted: false,
      }),
    ]);

    if (!provider) throw new Error("Provider profile not found");
    if (!service) throw new Error("Service not found or inactive");
    if (!clientExists) throw new Error("Client profile not found");

    // ── 3. Resolve pricing and deposit ──────────────────────────────────────
    const estimatedPrice =
      data.estimatedPrice ??
      serviceRequest.estimatedBudget?.max ??
      serviceRequest.estimatedBudget?.min ??
      service.servicePricing?.basePrice ??
      undefined;

    const { depositAmount } = this.resolveDepositSettings(
      provider,
      estimatedPrice,
    );

    // ── 4 & 5. Generate booking number and persist ───────────────────────────
    const bookingNumber = await BookingModel.generateBookingNumber();

    const serviceDescription =
      data.serviceDescription?.trim() ||
      serviceRequest.clientMessage?.trim() ||
      `Service booking for ${service.title}`;

    const booking = await BookingModel.create({
      bookingNumber,
      serviceRequestId: new Types.ObjectId(serviceRequestId),
      clientId: serviceRequest.clientId,
      providerId: new Types.ObjectId(providerProfileId),
      serviceId: serviceRequest.serviceId,
      serviceLocation: serviceRequest.serviceLocation,
      scheduledDate: data.scheduledDate ?? serviceRequest.scheduledDate,
      scheduledTimeSlot:
        data.scheduledTimeSlot ?? serviceRequest.scheduledTimeSlot,
      serviceDescription,
      specialInstructions: data.specialInstructions?.trim(),
      estimatedPrice,
      depositAmount,
      depositPaid: false,
      currency: (
        serviceRequest.estimatedBudget?.currency ?? DEFAULT_CURRENCY
      ).toUpperCase(),
      status: BookingStatus.CONFIRMED,
      paymentStatus: PaymentStatus.PENDING,
      statusHistory: [
        {
          status: BookingStatus.CONFIRMED,
          timestamp: new Date(),
          actorRole: ActorRole.PROVIDER,
          actor: new Types.ObjectId(providerProfileId),
          message: "Booking created from accepted service request",
        },
      ],
    });

    // ── 6. Transition ServiceRequest to ACCEPTED and stamp booking ref ───────
    const srUpdateResult = await ServiceRequestModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(serviceRequestId),
        status: ServiceRequestStatus.PENDING,
      },
      {
        status: ServiceRequestStatus.ACCEPTED,
        convertedToBookingId: booking._id,
        convertedAt: new Date(),
        providerResponse: {
          respondedAt: new Date(),
        },
      },
    );

    return {
      booking: booking.toObject() as Booking,
      serviceRequestUpdated: !!srUpdateResult,
    };
  }

  // ─── Core CRUD ───────────────────────────────────────────────────────────────

  /**
   * Fetches a single booking by its _id.
   *
   * populate: true loads the full graph:
   *   - clientId  → UserProfile (bio, mobileNumber, profilePictureId)
   *   - providerId → ProviderProfile (businessName, providerContactInfo, locationData)
   *   - serviceId  → Service (title, slug, servicePricing, coverImage)
   *   - taskId     → Task (title, status) — when the booking originated from a task
   */
  async getBookingById(
    bookingId: string,
    populate: boolean = false,
  ): Promise<Booking | null> {
    if (!Types.ObjectId.isValid(bookingId))
      throw new Error("Invalid booking ID");

    const query = BookingModel.findOne({
      _id: new Types.ObjectId(bookingId),
      isDeleted: false,
    });

    if (populate) {
      query
        .populate("clientId", "bio mobileNumber profilePictureId")
        .populate("providerId", "businessName providerContactInfo locationData")
        .populate("serviceId", "title slug servicePricing coverImage")
        .populate("taskId", "title status")
        .populate(
          "serviceRequestId",
          "clientMessage estimatedBudget discoveryContext",
        );
    }

    return (await query.lean()) as Booking | null;
  }

  /**
   * Looks up a booking by its human-readable booking number (e.g. "BK-20241215-A3F9XX").
   * Used in customer support flows and notification deep-links.
   *
   * Searches across soft-deleted records too — support agents need access
   * to cancelled booking history.
   */
  async getBookingByNumber(
    bookingNumber: string,
    includeDeleted: boolean = false,
  ): Promise<Booking | null> {
    if (!bookingNumber?.trim()) throw new Error("Booking number is required");

    const query: Record<string, any> = {
      bookingNumber: bookingNumber.trim().toUpperCase(),
    };
    if (!includeDeleted) query.isDeleted = false;

    const queryOptions = includeDeleted ? { includeSoftDeleted: true } : {};

    return (await BookingModel.findOne(query, null, queryOptions)
      .populate("clientId", "bio mobileNumber profilePictureId")
      .populate("providerId", "businessName providerContactInfo locationData")
      .populate("serviceId", "title slug servicePricing")
      .lean()) as Booking | null;
  }

  /**
   * Returns a booking linked to a specific task, if one exists.
   * Used by TaskService and the task detail view.
   */
  async getBookingByTask(taskId: string): Promise<Booking | null> {
    if (!Types.ObjectId.isValid(taskId)) throw new Error("Invalid task ID");
    return (await BookingModel.findOne({
      taskId: new Types.ObjectId(taskId),
      isDeleted: false,
    }).lean()) as Booking | null;
  }

  /**
   * Returns a booking linked to a specific service request, if one exists.
   */
  async getBookingByServiceRequest(
    serviceRequestId: string,
  ): Promise<Booking | null> {
    if (!Types.ObjectId.isValid(serviceRequestId)) {
      throw new Error("Invalid service request ID");
    }
    return (await BookingModel.findOne({
      serviceRequestId: new Types.ObjectId(serviceRequestId),
      isDeleted: false,
    }).lean()) as Booking | null;
  }

  /**
   * Returns a paginated booking history for a client.
   *
   * clientProfileId here is the UserProfile._id — consistent with how
   * clientId is stored on the Booking document (ref: "UserProfile").
   * This mirrors the pattern in ClientProfileService.getBookingHistory().
   */
  async getBookingsByClient(
    clientProfileId: string,
    options: {
      status?: BookingStatus;
      paymentStatus?: PaymentStatus;
      limit?: number;
      skip?: number;
    } = {},
  ): Promise<{ bookings: Booking[]; total: number; hasMore: boolean }> {
    if (!Types.ObjectId.isValid(clientProfileId)) {
      throw new Error("Invalid client profile ID");
    }

    const { status, paymentStatus, limit = 20, skip = 0 } = options;

    const query: Record<string, any> = {
      clientId: new Types.ObjectId(clientProfileId),
      isDeleted: false,
    };
    if (status) query.status = status;
    if (paymentStatus) query.paymentStatus = paymentStatus;

    const [bookings, total] = await Promise.all([
      BookingModel.find(query)
        .populate("serviceId", "title slug coverImage")
        .populate("providerId", "businessName providerContactInfo locationData")
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean(),
      BookingModel.countDocuments(query),
    ]);

    return {
      bookings: bookings as Booking[],
      total,
      hasMore: skip + bookings.length < total,
    };
  }

  /**
   * Returns a paginated booking list for a provider.
   *
   * providerId is the ProviderProfile._id — consistent with how it is stored
   * on the Booking document (ref: "ProviderProfile").
   */
  async getBookingsByProvider(
    providerProfileId: string,
    options: {
      status?: BookingStatus;
      paymentStatus?: PaymentStatus;
      limit?: number;
      skip?: number;
    } = {},
  ): Promise<{ bookings: Booking[]; total: number; hasMore: boolean }> {
    if (!Types.ObjectId.isValid(providerProfileId)) {
      throw new Error("Invalid provider profile ID");
    }

    const { status, paymentStatus, limit = 20, skip = 0 } = options;

    const query: Record<string, any> = {
      providerId: new Types.ObjectId(providerProfileId),
      isDeleted: false,
    };
    if (status) query.status = status;
    if (paymentStatus) query.paymentStatus = paymentStatus;

    const [bookings, total] = await Promise.all([
      BookingModel.find(query)
        .populate("clientId", "bio mobileNumber profilePictureId")
        .populate("serviceId", "title slug servicePricing")
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean(),
      BookingModel.countDocuments(query),
    ]);

    return {
      bookings: bookings as Booking[],
      total,
      hasMore: skip + bookings.length < total,
    };
  }

  // ─── Status Machine ───────────────────────────────────────────────────────────

  /**
   * Provider marks a confirmed booking as in-progress (work has started).
   *
   * Ownership guard: the caller's providerProfileId must match the booking's
   * providerId — a provider cannot start someone else's booking.
   *
   * Transition: CONFIRMED → IN_PROGRESS
   */
  async startService(
    bookingId: string,
    providerProfileId: string,
  ): Promise<Booking> {
    if (!Types.ObjectId.isValid(bookingId))
      throw new Error("Invalid booking ID");
    if (!Types.ObjectId.isValid(providerProfileId))
      throw new Error("Invalid provider profile ID");

    const booking = await this.loadBookingForProvider(
      bookingId,
      providerProfileId,
    );

    await booking.startService(new Types.ObjectId(providerProfileId));
    return booking.toObject() as Booking;
  }

  /**
   * Provider marks work as done and requests client validation.
   *
   * An optional finalPrice can be set here — for hourly or per-unit services
   * where the total is only known at completion. The finalPrice is shown to
   * the client during the validation step.
   *
   * Transition: IN_PROGRESS → AWAITING_VALIDATION
   */
  async completeService(
    bookingId: string,
    providerProfileId: string,
    options: {
      finalPrice?: number;
      providerMessage?: string;
    } = {},
  ): Promise<Booking> {
    if (!Types.ObjectId.isValid(bookingId))
      throw new Error("Invalid booking ID");
    if (!Types.ObjectId.isValid(providerProfileId))
      throw new Error("Invalid provider profile ID");

    if (options.finalPrice !== undefined && options.finalPrice < 0) {
      throw new Error("Final price cannot be negative");
    }

    const booking = await this.loadBookingForProvider(
      bookingId,
      providerProfileId,
    );

    await booking.complete(
      options.finalPrice,
      new Types.ObjectId(providerProfileId),
    );

    return booking.toObject() as Booking;
  }

  /**
   * Client approves or disputes the completed booking.
   *
   * Approval path (payload.approved === true):
   *   - Transitions to VALIDATED
   *   - Saves customerRating and customerReview on the booking
   *   - rating is required on the approval path (enforced by ValidateBookingRequestBody)
   *
   * Dispute path (payload.approved === false):
   *   - Transitions to DISPUTED
   *   - Saves disputeReason on the booking
   *   - An admin must resolve the dispute via resolveDispute()
   *
   * Ownership guard: the caller's clientProfileId must match the booking's clientId.
   *
   * Transition: AWAITING_VALIDATION → VALIDATED | DISPUTED
   */
  async validateCompletion(
    bookingId: string,
    clientProfileId: string,
    payload: ValidateBookingRequestBody,
  ): Promise<Booking> {
    if (!Types.ObjectId.isValid(bookingId))
      throw new Error("Invalid booking ID");
    if (!Types.ObjectId.isValid(clientProfileId))
      throw new Error("Invalid client profile ID");

    const booking = await this.loadBookingForClient(bookingId, clientProfileId);

    if (booking.status !== BookingStatus.AWAITING_VALIDATION) {
      throw new Error(
        `Cannot validate a booking with status: ${booking.status}`,
      );
    }

    if (payload.approved) {
      if (payload.rating < 1 || payload.rating > 5) {
        throw new Error("Rating must be between 1 and 5");
      }
      await booking.validateCompletion(
        true,
        new Types.ObjectId(clientProfileId),
        payload.rating,
        payload.review,
      );
    } else {
      if (!payload.disputeReason?.trim()) {
        throw new Error(
          "A dispute reason is required when disputing a booking",
        );
      }
      await booking.validateCompletion(
        false,
        new Types.ObjectId(clientProfileId),
        undefined,
        undefined,
        payload.disputeReason.trim(),
      );
    }

    return booking.toObject() as Booking;
  }

  /**
   * Admin resolves a DISPUTED booking.
   *
   * resolution: "approve"  → VALIDATED  (finds in favour of provider)
   * resolution: "complete" → COMPLETED  (admin override — used when VALIDATED
   *                                      is not appropriate, e.g. partial work)
   *
   * The admin's resolution is appended to statusHistory with ActorRole.ADMIN.
   *
   * Transition: DISPUTED → VALIDATED | COMPLETED
   */
  async resolveDispute(
    bookingId: string,
    adminId: string,
    resolution: "approve" | "complete",
    notes?: string,
  ): Promise<Booking> {
    if (!Types.ObjectId.isValid(bookingId))
      throw new Error("Invalid booking ID");
    if (!Types.ObjectId.isValid(adminId)) throw new Error("Invalid admin ID");

    const booking = (await BookingModel.findOne({
      _id: new Types.ObjectId(bookingId),
      // ↓ accept both — admin can resolve with or without a provider rebuttal
      status: {
        $in: [BookingStatus.DISPUTED, BookingStatus.REBUTTAL_SUBMITTED],
      },
      isDeleted: false,
    })) as BookingDocument | null;

    if (!booking) {
      throw new Error(
        "Booking not found or not in DISPUTED / REBUTTAL_SUBMITTED status",
      );
    }

    const newStatus =
      resolution === "approve"
        ? BookingStatus.VALIDATED
        : BookingStatus.COMPLETED;

    // Append admin resolution to statusHistory manually since the model
    // method validateCompletion() only handles the client-facing path.
    if (!booking.statusHistory) booking.statusHistory = [];
    booking.statusHistory.push({
      status: newStatus,
      timestamp: new Date(),
      actor: new Types.ObjectId(adminId),
      actorRole: ActorRole.ADMIN,
      reason: "Admin dispute resolution",
      message: notes?.trim(),
    });

    booking.status = newStatus;

    if (newStatus === BookingStatus.VALIDATED) {
      booking.validatedAt = new Date();
    }

    await booking.save();
    return booking.toObject() as Booking;
  }

  /**
   * Provider contests a client's dispute by submitting a rebuttal.
   *
   * The booking must be in DISPUTED status. After submission the booking
   * moves to REBUTTAL_SUBMITTED so the admin dashboard can surface it
   * separately from uncontested disputes.
   *
   * Ownership guard: the caller must be the assigned provider.
   *
   * Transition: DISPUTED → REBUTTAL_SUBMITTED
   */
  async submitRebuttal(
    bookingId: string,
    providerProfileId: string,
    message: string,
  ): Promise<Booking> {
    if (!Types.ObjectId.isValid(bookingId))
      throw new Error("Invalid booking ID");
    if (!Types.ObjectId.isValid(providerProfileId))
      throw new Error("Invalid provider profile ID");
    if (!message?.trim()) throw new Error("Rebuttal message is required");

    const booking = await this.loadBookingForProvider(
      bookingId,
      providerProfileId,
    );

    if (booking.status !== BookingStatus.DISPUTED) {
      throw new Error(
        `Cannot submit a rebuttal on a booking with status: ${booking.status}. ` +
          "Only DISPUTED bookings can be rebutted.",
      );
    }

    await booking.submitRebuttal(
      message.trim(),
      new Types.ObjectId(providerProfileId),
    );

    return booking.toObject() as Booking;
  }

  /**
   * Cancels a booking.
   *
   * Can be called by the client (ActorRole.CUSTOMER), the provider
   * (ActorRole.PROVIDER), or an admin (ActorRole.ADMIN).
   *
   * Only CONFIRMED and IN_PROGRESS bookings can be cancelled.
   * Completed, validated, and already-cancelled bookings are terminal.
   *
   * Ownership guards:
   *   - CUSTOMER cancellations verify clientId matches
   *   - PROVIDER cancellations verify providerId matches
   *   - ADMIN cancellations bypass ownership checks
   */
  async cancelBooking(
    bookingId: string,
    reason: string,
    cancelledBy: ActorRole,
    actorId: string,
  ): Promise<Booking> {
    if (!Types.ObjectId.isValid(bookingId))
      throw new Error("Invalid booking ID");
    if (!Types.ObjectId.isValid(actorId)) throw new Error("Invalid actor ID");
    if (!reason?.trim()) throw new Error("Cancellation reason is required");

    const booking = (await BookingModel.findOne({
      _id: new Types.ObjectId(bookingId),
      isDeleted: false,
    })) as BookingDocument | null;

    if (!booking) throw new Error("Booking not found");

    if (!CANCELLABLE_STATUSES.includes(booking.status)) {
      throw new Error(
        `Cannot cancel a booking with status: ${booking.status}. ` +
          `Only ${CANCELLABLE_STATUSES.join(" and ")} bookings can be cancelled.`,
      );
    }

    // Ownership guard — admins bypass both checks
    if (cancelledBy === ActorRole.CUSTOMER) {
      if (booking.clientId.toString() !== actorId) {
        throw new Error("You do not own this booking");
      }
    } else if (cancelledBy === ActorRole.PROVIDER) {
      if (booking.providerId.toString() !== actorId) {
        throw new Error("You are not the provider for this booking");
      }
    }

    await booking.cancel(
      reason.trim(),
      cancelledBy,
      new Types.ObjectId(actorId),
    );
    return booking.toObject() as Booking;
  }

  /**
   * Reschedules a confirmed booking to a new date and/or time slot.
   *
   * Only CONFIRMED bookings can be rescheduled — once work has started
   * the provider controls progress, not the schedule.
   *
   * Ownership guards mirror cancelBooking:
   *   - CUSTOMER can reschedule their own bookings
   *   - PROVIDER can reschedule bookings assigned to them
   *   - ADMIN can reschedule any booking
   */
  async rescheduleBooking(
    bookingId: string,
    actorId: string,
    actorRole: ActorRole,
    newDate: Date,
    newTimeSlot?: { start: string; end: string },
  ): Promise<Booking> {
    if (!Types.ObjectId.isValid(bookingId))
      throw new Error("Invalid booking ID");
    if (!Types.ObjectId.isValid(actorId)) throw new Error("Invalid actor ID");
    if (!newDate) throw new Error("New scheduled date is required");

    const booking = (await BookingModel.findOne({
      _id: new Types.ObjectId(bookingId),
      isDeleted: false,
    })) as BookingDocument | null;

    if (!booking) throw new Error("Booking not found");

    if (!RESCHEDULABLE_STATUSES.includes(booking.status)) {
      throw new Error(
        `Cannot reschedule a booking with status: ${booking.status}. ` +
          `Only CONFIRMED bookings can be rescheduled.`,
      );
    }

    // Ownership guard
    if (actorRole === ActorRole.CUSTOMER) {
      if (booking.clientId.toString() !== actorId) {
        throw new Error("You do not own this booking");
      }
    } else if (actorRole === ActorRole.PROVIDER) {
      if (booking.providerId.toString() !== actorId) {
        throw new Error("You are not the provider for this booking");
      }
    }

    if (newDate <= new Date()) {
      throw new Error("New scheduled date must be in the future");
    }

    await booking.reschedule(
      newDate,
      newTimeSlot,
      new Types.ObjectId(actorId),
      actorRole,
    );

    return booking.toObject() as Booking;
  }

  // ─── Soft Delete / Restore ────────────────────────────────────────────────────

  /**
   * Soft-deletes a booking record.
   *
   * Only terminal bookings (VALIDATED, COMPLETED, CANCELLED) should be
   * soft-deleted. Active bookings must be cancelled first to preserve the
   * statusHistory audit trail.
   */
  async deleteBooking(bookingId: string, deletedBy?: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(bookingId))
      throw new Error("Invalid booking ID");

    const booking = (await BookingModel.findOne({
      _id: new Types.ObjectId(bookingId),
      isDeleted: false,
    })) as BookingDocument | null;

    if (!booking) throw new Error("Booking not found");

    if (!TERMINAL_STATUSES.includes(booking.status)) {
      throw new Error(
        `Cannot delete a booking with status: ${booking.status}. ` +
          `Cancel the booking before deleting it.`,
      );
    }

    await booking.softDelete(
      deletedBy ? new Types.ObjectId(deletedBy) : undefined,
    );
    return true;
  }

  async restoreBooking(bookingId: string): Promise<Booking | null> {
    if (!Types.ObjectId.isValid(bookingId))
      throw new Error("Invalid booking ID");

    const booking = (await BookingModel.findOne(
      { _id: new Types.ObjectId(bookingId), isDeleted: true },
      null,
      { includeSoftDeleted: true },
    )) as BookingDocument | null;

    if (!booking) throw new Error("Deleted booking not found");

    await booking.restore();
    return (await BookingModel.findById(bookingId).lean()) as Booking | null;
  }

  // ─── Payment ──────────────────────────────────────────────────────────────────

  /**
   * Updates the payment status of a booking.
   *
   * All payment status transitions flow through here — called by the
   * payment gateway webhook handler after a successful payment event.
   *
   * When paymentStatus is DEPOSIT_PAID, depositPaid is automatically set
   * to true on the booking document (mirroring the model method behaviour).
   *
   * When paymentStatus is PAID, the full amount has been received —
   * the booking is financially settled regardless of service status.
   */
  async updatePaymentStatus(
    bookingId: string,
    paymentStatus: PaymentStatus,
    actorId?: string,
  ): Promise<Booking> {
    if (!Types.ObjectId.isValid(bookingId))
      throw new Error("Invalid booking ID");

    const booking = (await BookingModel.findOne({
      _id: new Types.ObjectId(bookingId),
      isDeleted: false,
    })) as BookingDocument | null;

    if (!booking) throw new Error("Booking not found");

    if (TERMINAL_STATUSES.includes(booking.status)) {
      throw new Error(
        `Cannot update payment status on a ${booking.status} booking`,
      );
    }

    await booking.updatePaymentStatus(
      paymentStatus,
      actorId ? new Types.ObjectId(actorId) : undefined,
    );

    return booking.toObject() as Booking;
  }

  /**
   * Returns a breakdown of the financial state of a single booking.
   *
   * Uses the virtual fields computed by the BookingModel so the figures
   * are always consistent with the stored data.
   *
   * Note: virtuals are only available on hydrated documents, not on lean()
   * results — hence we load the full document here.
   */
  async getPaymentSummary(bookingId: string): Promise<{
    estimatedPrice: number | undefined;
    finalPrice: number | undefined;
    depositAmount: number | undefined;
    depositPaid: boolean;
    depositRemaining: number;
    balanceRemaining: number;
    currency: string;
    paymentStatus: PaymentStatus;
  }> {
    if (!Types.ObjectId.isValid(bookingId))
      throw new Error("Invalid booking ID");

    // Must NOT use .lean() — virtuals (depositRemaining, balanceRemaining) are
    // computed on the Mongoose document prototype and are unavailable on plain objects.
    const booking = (await BookingModel.findOne({
      _id: new Types.ObjectId(bookingId),
      isDeleted: false,
    })) as BookingDocument | null;

    if (!booking) throw new Error("Booking not found");

    return {
      estimatedPrice: booking.estimatedPrice,
      finalPrice: booking.finalPrice,
      depositAmount: booking.depositAmount,
      depositPaid: booking.depositPaid ?? false,
      depositRemaining: (booking as any).depositRemaining ?? 0,
      balanceRemaining: (booking as any).balanceRemaining ?? 0,
      currency: booking.currency,
      paymentStatus: booking.paymentStatus,
    };
  }

  // ─── Queries ──────────────────────────────────────────────────────────────────

  /**
   * Returns upcoming confirmed bookings for a provider, sorted by
   * scheduled date ascending (soonest first) — the provider's daily schedule view.
   */
  async getUpcomingBookings(
    providerProfileId: string,
    options: { limit?: number; skip?: number } = {},
  ): Promise<{ bookings: Booking[]; total: number; hasMore: boolean }> {
    if (!Types.ObjectId.isValid(providerProfileId)) {
      throw new Error("Invalid provider profile ID");
    }

    const { limit = 20, skip = 0 } = options;
    const now = new Date();

    const query = {
      providerId: new Types.ObjectId(providerProfileId),
      status: BookingStatus.CONFIRMED,
      scheduledDate: { $gte: now },
      isDeleted: false,
    };

    const [bookings, total] = await Promise.all([
      BookingModel.find(query)
        .populate("clientId", "bio mobileNumber profilePictureId")
        .populate("serviceId", "title slug")
        .sort({ scheduledDate: 1 })
        .limit(limit)
        .skip(skip)
        .lean(),
      BookingModel.countDocuments(query),
    ]);

    return {
      bookings: bookings as Booking[],
      total,
      hasMore: skip + bookings.length < total,
    };
  }

  /**
   * Returns bookings for a provider within a calendar date range.
   * Used by the provider's schedule/calendar view.
   *
   * Includes both CONFIRMED and IN_PROGRESS bookings — i.e. everything
   * that occupies time in the provider's schedule.
   */
  async getBookingsByDateRange(
    providerProfileId: string,
    startDate: Date,
    endDate: Date,
    options: { limit?: number; skip?: number } = {},
  ): Promise<{ bookings: Booking[]; total: number; hasMore: boolean }> {
    if (!Types.ObjectId.isValid(providerProfileId)) {
      throw new Error("Invalid provider profile ID");
    }
    if (!startDate || !endDate)
      throw new Error("Start date and end date are required");
    if (startDate > endDate) {
      throw new Error("Start date must be before end date");
    }

    const { limit = 50, skip = 0 } = options;

    const query = {
      providerId: new Types.ObjectId(providerProfileId),
      scheduledDate: { $gte: startDate, $lte: endDate },
      status: { $in: [BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS] },
      isDeleted: false,
    };

    const [bookings, total] = await Promise.all([
      BookingModel.find(query)
        .populate("clientId", "bio mobileNumber profilePictureId")
        .populate("serviceId", "title slug")
        .sort({ scheduledDate: 1 })
        .limit(limit)
        .skip(skip)
        .lean(),
      BookingModel.countDocuments(query),
    ]);

    return {
      bookings: bookings as Booking[],
      total,
      hasMore: skip + bookings.length < total,
    };
  }

  /**
   * Returns all platform-wide active bookings (CONFIRMED + IN_PROGRESS).
   * Used by the admin operations dashboard for live oversight.
   */
  async getActiveBookings(
    options: { limit?: number; skip?: number } = {},
  ): Promise<{ bookings: Booking[]; total: number; hasMore: boolean }> {
    const { limit = 50, skip = 0 } = options;

    const query = {
      status: { $in: [BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS] },
      isDeleted: false,
    };

    const [bookings, total] = await Promise.all([
      BookingModel.find(query)
        .populate("clientId", "bio mobileNumber")
        .populate("providerId", "businessName providerContactInfo")
        .populate("serviceId", "title slug")
        .sort({ scheduledDate: 1 })
        .limit(limit)
        .skip(skip)
        .lean(),
      BookingModel.countDocuments(query),
    ]);

    return {
      bookings: bookings as Booking[],
      total,
      hasMore: skip + bookings.length < total,
    };
  }

  /**
   * Returns bookings awaiting client validation across the platform.
   * Used by the admin dashboard to monitor stalled validation steps.
   */
  async getBookingsPendingValidation(
    options: { limit?: number; skip?: number } = {},
  ): Promise<{ bookings: Booking[]; total: number; hasMore: boolean }> {
    const { limit = 50, skip = 0 } = options;

    const query = {
      status: BookingStatus.AWAITING_VALIDATION,
      isDeleted: false,
    };

    const [bookings, total] = await Promise.all([
      BookingModel.find(query)
        .populate("clientId", "bio mobileNumber")
        .populate("providerId", "businessName providerContactInfo")
        .populate("serviceId", "title slug")
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean(),
      BookingModel.countDocuments(query),
    ]);

    return {
      bookings: bookings as Booking[],
      total,
      hasMore: skip + bookings.length < total,
    };
  }

  /**
   * Returns all DISPUTED bookings, sorted by dispute time ascending so
   * the oldest unresolved disputes surface first for admin triage.
   */
  async getDisputedBookings(
    options: { limit?: number; skip?: number } = {},
  ): Promise<{ bookings: Booking[]; total: number; hasMore: boolean }> {
    const { limit = 50, skip = 0 } = options;

    const query = {
      // ↓ surface rebutted disputes alongside uncontested ones
      status: {
        $in: [BookingStatus.DISPUTED, BookingStatus.REBUTTAL_SUBMITTED],
      },
      isDeleted: false,
    };

    const [bookings, total] = await Promise.all([
      BookingModel.find(query)
        .populate("clientId", "bio mobileNumber")
        .populate("providerId", "businessName providerContactInfo")
        .populate("serviceId", "title slug")
        .sort({ disputedAt: 1 })
        .limit(limit)
        .skip(skip)
        .lean(),
      BookingModel.countDocuments(query),
    ]);

    return {
      bookings: bookings as Booking[],
      total,
      hasMore: skip + bookings.length < total,
    };
  }

  // ─── Activity Summary ─────────────────────────────────────────────────────────

  /**
   * Compact booking counts for a client or provider dashboard header.
   * Runs all counts in parallel via Promise.all.
   */
  async getActivitySummary(
    actorId: string,
    actorRole: ActorRole.CUSTOMER | ActorRole.PROVIDER,
  ): Promise<{
    total: number;
    active: number;
    awaitingValidation: number;
    completed: number;
    cancelled: number;
    disputed: number;
  }> {
    if (!Types.ObjectId.isValid(actorId)) throw new Error("Invalid actor ID");

    const idField =
      actorRole === ActorRole.CUSTOMER ? "clientId" : "providerId";
    const base = { [idField]: new Types.ObjectId(actorId), isDeleted: false };

    const [total, active, awaitingValidation, completed, cancelled, disputed] =
      await Promise.all([
        BookingModel.countDocuments(base),
        BookingModel.countDocuments({
          ...base,
          status: { $in: [BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS] },
        }),
        BookingModel.countDocuments({
          ...base,
          status: BookingStatus.AWAITING_VALIDATION,
        }),
        BookingModel.countDocuments({
          ...base,
          status: { $in: [BookingStatus.VALIDATED, BookingStatus.COMPLETED] },
        }),
        BookingModel.countDocuments({
          ...base,
          status: BookingStatus.CANCELLED,
        }),
        BookingModel.countDocuments({
          ...base,
          status: BookingStatus.DISPUTED,
        }),
      ]);

    return {
      total,
      active,
      awaitingValidation,
      completed,
      cancelled,
      disputed,
    };
  }

  // ─── Admin Operations ─────────────────────────────────────────────────────────

  /**
   * Returns a paginated list of all bookings across the platform.
   * Supports filtering by status, provider, client, and soft-deleted records.
   */
  async getAllBookings(
    pagination: { limit: number; skip: number },
    filters: {
      status?: BookingStatus;
      paymentStatus?: PaymentStatus;
      clientId?: string;
      providerId?: string;
      includeDeleted?: boolean;
    } = {},
  ): Promise<{ bookings: Booking[]; total: number; hasMore: boolean }> {
    const { limit, skip } = pagination;
    const {
      status,
      paymentStatus,
      clientId,
      providerId,
      includeDeleted = false,
    } = filters;

    const query: Record<string, any> = includeDeleted
      ? {}
      : { isDeleted: false };
    if (status) query.status = status;
    if (paymentStatus) query.paymentStatus = paymentStatus;
    if (clientId && Types.ObjectId.isValid(clientId)) {
      query.clientId = new Types.ObjectId(clientId);
    }
    if (providerId && Types.ObjectId.isValid(providerId)) {
      query.providerId = new Types.ObjectId(providerId);
    }

    const queryOptions = includeDeleted ? { includeSoftDeleted: true } : {};

    const [bookings, total] = await Promise.all([
      BookingModel.find(query, null, queryOptions)
        .populate("clientId", "bio mobileNumber")
        .populate("providerId", "businessName providerContactInfo")
        .populate("serviceId", "title slug")
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean(),
      BookingModel.countDocuments(query),
    ]);

    return {
      bookings: bookings as Booking[],
      total,
      hasMore: skip + bookings.length < total,
    };
  }

  /**
   * Platform-wide or per-actor booking statistics.
   *
   * Pass actorId + actorRole to scope stats to a single client or provider.
   * Omit both for a system-wide admin overview.
   *
   * completionRate = (VALIDATED + COMPLETED) / total non-cancelled, non-deleted
   * averageRating  = mean of all customerRating values (from validated bookings only)
   * disputeRate    = DISPUTED / (VALIDATED + COMPLETED + DISPUTED)
   */
  async getBookingStats(
    options: {
      actorId?: string;
      actorRole?: ActorRole.CUSTOMER | ActorRole.PROVIDER;
    } = {},
  ): Promise<{
    total: number;
    confirmed: number;
    inProgress: number;
    awaitingValidation: number;
    validated: number;
    completed: number;
    disputed: number;
    cancelled: number;
    deleted: number;
    completionRate: number;
    disputeRate: number;
    averageRating: number | null;
    totalRevenue: number;
  }> {
    const { actorId, actorRole } = options;

    const base: Record<string, any> = {};
    if (actorId && Types.ObjectId.isValid(actorId) && actorRole) {
      const idField =
        actorRole === ActorRole.CUSTOMER ? "clientId" : "providerId";
      base[idField] = new Types.ObjectId(actorId);
    }

    const [
      total,
      confirmed,
      inProgress,
      awaitingValidation,
      validated,
      completed,
      disputed,
      cancelled,
      deleted,
      ratingAgg,
      revenueAgg,
    ] = await Promise.all([
      BookingModel.countDocuments({ ...base, isDeleted: false }),
      BookingModel.countDocuments({
        ...base,
        isDeleted: false,
        status: BookingStatus.CONFIRMED,
      }),
      BookingModel.countDocuments({
        ...base,
        isDeleted: false,
        status: BookingStatus.IN_PROGRESS,
      }),
      BookingModel.countDocuments({
        ...base,
        isDeleted: false,
        status: BookingStatus.AWAITING_VALIDATION,
      }),
      BookingModel.countDocuments({
        ...base,
        isDeleted: false,
        status: BookingStatus.VALIDATED,
      }),
      BookingModel.countDocuments({
        ...base,
        isDeleted: false,
        status: BookingStatus.COMPLETED,
      }),
      BookingModel.countDocuments({
        ...base,
        isDeleted: false,
        status: {
          $in: [BookingStatus.DISPUTED, BookingStatus.REBUTTAL_SUBMITTED],
        },
      }),
      BookingModel.countDocuments({
        ...base,
        isDeleted: false,
        status: BookingStatus.CANCELLED,
      }),
      BookingModel.countDocuments({ ...base, isDeleted: true }),

      BookingModel.aggregate<{ avg: number }>([
        {
          $match: {
            ...base,
            isDeleted: false,
            status: { $in: [BookingStatus.VALIDATED, BookingStatus.COMPLETED] },
            customerRating: { $exists: true, $ne: null },
          },
        },
        { $group: { _id: null, avg: { $avg: "$customerRating" } } },
      ]),

      BookingModel.aggregate<{ total: number }>([
        {
          $match: {
            ...base,
            isDeleted: false,
            status: { $in: [BookingStatus.VALIDATED, BookingStatus.COMPLETED] },
            finalPrice: { $exists: true, $ne: null },
          },
        },
        { $group: { _id: null, total: { $sum: "$finalPrice" } } },
      ]),
    ]);

    const resolvedBookings = validated + completed;
    const disputedOrResolved = disputed + resolvedBookings;

    const completionRate =
      total > 0 ? parseFloat(((resolvedBookings / total) * 100).toFixed(2)) : 0;

    const disputeRate =
      disputedOrResolved > 0
        ? parseFloat(((disputed / disputedOrResolved) * 100).toFixed(2))
        : 0;

    const averageRating =
      ratingAgg.length > 0 ? parseFloat(ratingAgg[0].avg.toFixed(2)) : null;

    const totalRevenue =
      revenueAgg.length > 0 ? parseFloat(revenueAgg[0].total.toFixed(2)) : 0;

    return {
      total,
      confirmed,
      inProgress,
      awaitingValidation,
      validated,
      completed,
      disputed,
      cancelled,
      deleted,
      completionRate,
      disputeRate,
      averageRating,
      totalRevenue,
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  /**
   * Loads a booking and enforces that the caller is the assigned provider.
   * Throws consistently so the caller never needs to repeat the ownership check.
   */
  private async loadBookingForProvider(
    bookingId: string,
    providerProfileId: string,
  ): Promise<BookingDocument> {
    const booking = (await BookingModel.findOne({
      _id: new Types.ObjectId(bookingId),
      providerId: new Types.ObjectId(providerProfileId),
      isDeleted: false,
    })) as BookingDocument | null;

    if (!booking) {
      throw new Error(
        "Booking not found or you are not the provider for this booking",
      );
    }

    return booking;
  }

  /**
   * Loads a booking and enforces that the caller is the owning client.
   * clientId on Booking is a UserProfile ref — callers pass their UserProfile._id.
   */
  private async loadBookingForClient(
    bookingId: string,
    clientProfileId: string,
  ): Promise<BookingDocument> {
    const booking = (await BookingModel.findOne({
      _id: new Types.ObjectId(bookingId),
      clientId: new Types.ObjectId(clientProfileId),
      isDeleted: false,
    })) as BookingDocument | null;

    if (!booking) {
      throw new Error("Booking not found or you do not own this booking");
    }

    return booking;
  }

  /**
   * Derives the deposit amount from the provider's deposit settings and
   * the estimated booking price.
   *
   * Returns { depositAmount: undefined } when:
   *   - The provider does not require a deposit
   *   - The estimated price is unknown (cannot compute a percentage of nothing)
   *
   * The result is stored directly on the Booking document at creation time.
   * Changes to the provider's deposit settings after booking creation do NOT
   * retroactively affect existing bookings.
   */
  private resolveDepositSettings(
    provider: any,
    estimatedPrice: number | undefined,
  ): { depositAmount: number | undefined } {
    if (
      !provider.requireInitialDeposit ||
      estimatedPrice == null ||
      estimatedPrice <= 0
    ) {
      return { depositAmount: undefined };
    }

    const percentage = provider.percentageDeposit ?? 0;
    if (percentage <= 0) return { depositAmount: undefined };

    const depositAmount = parseFloat(
      ((estimatedPrice * percentage) / 100).toFixed(2),
    );

    return { depositAmount };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * Shared BookingService instance.
 * Import this in route handlers — do not instantiate BookingService directly
 * in application code.
 */
export const bookingService = new BookingService();
