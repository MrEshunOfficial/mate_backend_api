// services/tasks/task.service.ts
import { Types, HydratedDocument } from "mongoose";
import TaskModel from "../../models/task.model";
import BookingModel from "../../models/booking.model";
import ClientProfileModel from "../../models/profiles/client.profile.model";
import ProviderProfileModel from "../../models/profiles/provider.profile.model";
import { CategoryModel } from "../../models/service/categoryModel";
import {
  Task,
  TaskMethods,
  TaskStatus,
  CreateTaskRequestBody,
  UpdateTaskRequestBody,
  MatchingSummary,
} from "../../types/tasks.types";
import { ActorRole } from "../../types/base.types";
import {
  LocationService,
  LocationEnrichmentInput,
  locationService as defaultLocationService,
} from "../location.service";
import {
  TaskMatchingService,
  taskMatchingService as defaultTaskMatchingService,
} from "./task.matching.service";

type TaskDocument = HydratedDocument<Task, TaskMethods>;

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default lifetime of a task before it auto-expires if not converted or cancelled */
const DEFAULT_EXPIRY_DAYS = 7;

/** Default currency applied when estimatedBudget is provided without one */
const DEFAULT_CURRENCY = "GHS";

/** Statuses that permit content edits (title, description, tags, schedule, budget) */
const EDITABLE_STATUSES: TaskStatus[] = [
  TaskStatus.PENDING,
  TaskStatus.MATCHED,
  TaskStatus.FLOATING,
];

/** Statuses that must be exited before a task can be soft-deleted */
const DELETABLE_STATUSES: TaskStatus[] = [
  TaskStatus.PENDING,
  TaskStatus.MATCHED,
  TaskStatus.FLOATING,
  TaskStatus.CANCELLED,
  TaskStatus.EXPIRED,
  TaskStatus.CONVERTED,
];

/** Statuses eligible for manual re-matching */
const REMATCHABLE_STATUSES: TaskStatus[] = [
  TaskStatus.PENDING,
  TaskStatus.MATCHED,
  TaskStatus.FLOATING,
];

/** Statuses that the expiry job must NOT overwrite */
const TERMINAL_STATUSES: TaskStatus[] = [
  TaskStatus.CONVERTED,
  TaskStatus.CANCELLED,
  TaskStatus.EXPIRED,
];

// ─── Service ──────────────────────────────────────────────────────────────────

export class TaskService {
  /**
   * LocationService and TaskMatchingService are injected so tests can
   * supply mocks. All production callers use the module-level singletons.
   */
  constructor(
    private readonly locationService: LocationService = defaultLocationService,
    private readonly matchingService: TaskMatchingService = defaultTaskMatchingService,
  ) {}

  // ─── Core CRUD ───────────────────────────────────────────────────────────────

  /**
   * Creates a new task on behalf of a client and immediately triggers
   * provider matching.
   *
   * Enrichment:
   *   If the caller supplies a registeredLocation with only a ghanaPostGPS
   *   code and no coordinates, LocationService.enrichLocation() is called
   *   to fill in region, city, district, and GPS coordinates before the
   *   document is saved. This mirrors the address enrichment in
   *   ClientProfileService.addSavedAddress().
   *
   * Matching:
   *   Matching runs synchronously so the response includes the matched
   *   provider list. If matching throws (e.g. OSM timeout, empty region)
   *   the task is still created and returned — matching failure is
   *   non-blocking. The task will be in PENDING status and can be
   *   re-triggered via TaskService.triggerMatching().
   *
   * @param clientProfileId - ClientProfile._id (not User._id)
   * @param data            - Validated task creation payload
   */
  async createTask(
    clientProfileId: string,
    data: CreateTaskRequestBody,
  ): Promise<{ task: Task; matchingSummary?: MatchingSummary }> {
    if (!Types.ObjectId.isValid(clientProfileId)) {
      throw new Error("Invalid client profile ID");
    }

    // Verify the client profile exists
    const clientExists = await ClientProfileModel.countDocuments({
      _id: new Types.ObjectId(clientProfileId),
      isDeleted: false,
    });
    if (!clientExists) throw new Error("Client profile not found");

    // Validate category if provided
    if (data.category) {
      const catId = data.category.toString();
      if (!Types.ObjectId.isValid(catId)) throw new Error("Invalid category ID");
      const catExists = await CategoryModel.countDocuments({
        _id: new Types.ObjectId(catId),
        isActive: true,
        isDeleted: false,
      });
      if (!catExists) throw new Error("Category not found or inactive");
    }

    // Enrich registeredLocation if coordinates are missing
    const locationContext = structuredClone
      ? structuredClone(data.locationContext)
      : JSON.parse(JSON.stringify(data.locationContext));

    const regLoc = locationContext.registeredLocation;
    if (regLoc?.ghanaPostGPS && !regLoc.gpsCoordinates) {
      const enriched = await this.locationService.enrichLocation({
        ghanaPostGPS:   regLoc.ghanaPostGPS,
        nearbyLandmark: regLoc.nearbyLandmark,
        gpsCoordinates: regLoc.gpsCoordinates,
      } as LocationEnrichmentInput);

      if (enriched.success && enriched.location) {
        locationContext.registeredLocation = enriched.location;
      }
    }

    // Calculate expiry
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + DEFAULT_EXPIRY_DAYS);

    const task = new TaskModel({
      title:       data.title.trim(),
      description: data.description.trim(),
      category:    data.category
        ? new Types.ObjectId(data.category.toString())
        : undefined,
      tags:        (data.tags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean),
      clientId:    new Types.ObjectId(clientProfileId),
      locationContext,
      schedule:    data.schedule,
      estimatedBudget: data.estimatedBudget
        ? {
            ...data.estimatedBudget,
            currency: (data.estimatedBudget.currency ?? DEFAULT_CURRENCY).toUpperCase(),
          }
        : undefined,
      status:    TaskStatus.PENDING,
      expiresAt,
      viewCount: 0,
    });

    await task.save();

    // Trigger matching — non-blocking on failure
    try {
      const strategy = data.matchingStrategy ?? "intelligent";
      const { task: matched, summary } = await this.matchingService.runMatching(
        task as TaskDocument,
        strategy,
      );
      return { task: matched.toObject() as Task, matchingSummary: summary };
    } catch (matchError) {
      console.error(
        `[TaskService] Matching failed for task ${task._id}:`,
        matchError,
      );
      return { task: task.toObject() as Task };
    }
  }

  /**
   * Fetches a single task by its _id.
   *
   * populate: true loads:
   *   - category (catName, slug)
   *   - clientId UserProfile (bio, mobileNumber)
   *   - matchedProviders' ProviderProfile documents (businessName, locationData,
   *     serviceOfferings, providerContactInfo)
   */
  async getTaskById(
    taskId: string,
    populate: boolean = false,
  ): Promise<Task | null> {
    if (!Types.ObjectId.isValid(taskId)) throw new Error("Invalid task ID");

    const query = TaskModel.findOne({
      _id: new Types.ObjectId(taskId),
      isDeleted: false,
    });

    if (populate) {
      query
        .populate("category", "catName slug")
        .populate("clientId", "bio mobileNumber profilePictureId")
        .populate({
          path:   "matchedProviders.providerId",
          select: "businessName locationData providerContactInfo serviceOfferings",
          populate: {
            path:   "serviceOfferings",
            select: "title slug isActive servicePricing",
          },
        });
    }

    return (await query.lean()) as Task | null;
  }

  /**
   * Returns a paginated list of tasks for a specific client.
   * Most recent first.
   */
  async getTasksByClient(
    clientProfileId: string,
    options: {
      status?: TaskStatus;
      limit?: number;
      skip?: number;
    } = {},
  ): Promise<{ tasks: Task[]; total: number; hasMore: boolean }> {
    if (!Types.ObjectId.isValid(clientProfileId)) {
      throw new Error("Invalid client profile ID");
    }

    const { status, limit = 20, skip = 0 } = options;
    const query: Record<string, any> = {
      clientId: new Types.ObjectId(clientProfileId),
      isDeleted: false,
    };
    if (status) query.status = status;

    const [tasks, total] = await Promise.all([
      TaskModel.find(query)
        .populate("category", "catName slug")
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean(),
      TaskModel.countDocuments(query),
    ]);

    return {
      tasks: tasks as Task[],
      total,
      hasMore: skip + tasks.length < total,
    };
  }

  /**
   * Updates mutable task fields for a task owned by a specific client.
   *
   * Only allowed while the task is in EDITABLE_STATUSES (PENDING, MATCHED,
   * FLOATING). Tasks that are already REQUESTED or ACCEPTED cannot be edited
   * because a provider has been engaged.
   *
   * Immutable fields (clientId, locationContext, status, matching outputs)
   * are stripped before the write.
   *
   * Re-triggers intelligent matching whenever content-affecting fields change
   * (title, description, or estimatedBudget) so the matched provider list
   * stays current. Matching failure is non-blocking.
   */
  async updateTask(
    taskId: string,
    clientProfileId: string,
    updates: UpdateTaskRequestBody,
  ): Promise<{ task: Task; matchingSummary?: MatchingSummary }> {
    if (!Types.ObjectId.isValid(taskId)) throw new Error("Invalid task ID");
    if (!Types.ObjectId.isValid(clientProfileId)) {
      throw new Error("Invalid client profile ID");
    }

    const task = (await TaskModel.findOne({
      _id: new Types.ObjectId(taskId),
      clientId: new Types.ObjectId(clientProfileId),
      isDeleted: false,
    })) as TaskDocument | null;

    if (!task) throw new Error("Task not found");

    if (!EDITABLE_STATUSES.includes(task.status)) {
      throw new Error(
        `Cannot update a task with status: ${task.status}. ` +
        `Only tasks in ${EDITABLE_STATUSES.join(", ")} may be edited.`,
      );
    }

    // Strip fields that must not change after creation
    const {
      locationContext: _loc,
      ...safeUpdates
    } = updates as Record<string, any>;

    if (safeUpdates.title)       safeUpdates.title       = safeUpdates.title.trim();
    if (safeUpdates.description) safeUpdates.description = safeUpdates.description.trim();
    if (safeUpdates.tags) {
      safeUpdates.tags = safeUpdates.tags
        .map((t: string) => t.toLowerCase().trim())
        .filter(Boolean);
    }
    if (safeUpdates.estimatedBudget?.currency) {
      safeUpdates.estimatedBudget.currency =
        safeUpdates.estimatedBudget.currency.toUpperCase();
    }

    Object.assign(task, safeUpdates);
    await task.save();

    // Re-match when content-affecting fields changed
    const contentChanged =
      updates.title !== undefined ||
      updates.description !== undefined ||
      updates.estimatedBudget !== undefined;

    if (contentChanged) {
      try {
        const { task: matched, summary } = await this.matchingService.runMatching(
          task,
          "intelligent",
        );
        return { task: matched.toObject() as Task, matchingSummary: summary };
      } catch (matchError) {
        console.error(`[TaskService] Re-matching failed for task ${task._id}:`, matchError);
      }
    }

    return { task: task.toObject() as Task };
  }

  /**
   * Soft-deletes a task.
   *
   * Tasks in REQUESTED or ACCEPTED status must be cancelled before deletion —
   * a provider is engaged and the deletion would leave them without feedback.
   * Only DELETABLE_STATUSES are permitted.
   */
  async deleteTask(
    taskId: string,
    deletedBy?: string,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(taskId)) throw new Error("Invalid task ID");

    const task = (await TaskModel.findOne({
      _id: new Types.ObjectId(taskId),
      isDeleted: false,
    })) as TaskDocument | null;

    if (!task) throw new Error("Task not found");

    if (!DELETABLE_STATUSES.includes(task.status)) {
      throw new Error(
        `Cannot delete a task with status: ${task.status}. ` +
        `Cancel the task first.`,
      );
    }

    await task.softDelete(
      deletedBy ? new Types.ObjectId(deletedBy) : undefined,
    );
    return true;
  }

  /**
   * Restores a previously soft-deleted task.
   * The restored task retains its original status — the caller may want
   * to check whether it needs re-matching.
   */
  async restoreTask(taskId: string): Promise<Task | null> {
    if (!Types.ObjectId.isValid(taskId)) throw new Error("Invalid task ID");

    const task = (await TaskModel.findOne(
      { _id: new Types.ObjectId(taskId), isDeleted: true },
      null,
      { includeSoftDeleted: true },
    )) as TaskDocument | null;

    if (!task) throw new Error("Deleted task not found");

    await task.restore();
    return (await TaskModel.findById(taskId).lean()) as Task | null;
  }

  // ─── Status Transitions ───────────────────────────────────────────────────────

  /**
   * Cancels a task.
   *
   * Clients cancel their own tasks via ActorRole.CUSTOMER.
   * Admins can cancel any task via ActorRole.ADMIN.
   * Provider-side cancellation should go through BookingService.cancel().
   *
   * Terminal statuses (CONVERTED, EXPIRED, CANCELLED) cannot be re-cancelled.
   */
  async cancelTask(
    taskId: string,
    options: {
      reason?: string;
      cancelledBy?: ActorRole;
      actorId?: string;
    } = {},
  ): Promise<Task | null> {
    if (!Types.ObjectId.isValid(taskId)) throw new Error("Invalid task ID");

    const task = (await TaskModel.findOne({
      _id: new Types.ObjectId(taskId),
      isDeleted: false,
    })) as TaskDocument | null;

    if (!task) throw new Error("Task not found");

    const { reason, cancelledBy = ActorRole.CUSTOMER } = options;

    await task.cancelTask(reason, cancelledBy);
    return task.toObject() as Task;
  }

  /**
   * Transitions a MATCHED task to FLOATING, opening it to all providers
   * in the vicinity rather than just the matched subset.
   *
   * Used when the client reviews the matched list and decides to cast a
   * wider net, or when matched providers do not respond within a threshold.
   */
  async makeTaskFloating(taskId: string): Promise<Task | null> {
    if (!Types.ObjectId.isValid(taskId)) throw new Error("Invalid task ID");

    const task = (await TaskModel.findOne({
      _id: new Types.ObjectId(taskId),
      isDeleted: false,
    })) as TaskDocument | null;

    if (!task) throw new Error("Task not found");

    await task.makeFloating();
    return task.toObject() as Task;
  }

  /**
   * Marks a single task as EXPIRED.
   * The task must not already be in a terminal status.
   * Called by the expiry cron job when processing individual tasks.
   */
  async expireTask(taskId: string): Promise<Task | null> {
    if (!Types.ObjectId.isValid(taskId)) throw new Error("Invalid task ID");

    const updated = await TaskModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(taskId),
        isDeleted: false,
        status: { $nin: TERMINAL_STATUSES },
      },
      { status: TaskStatus.EXPIRED },
      { new: true },
    ).lean();

    return updated as Task | null;
  }

  /**
   * Batch-expires all tasks whose expiresAt timestamp has passed.
   * Should be invoked by a scheduled job (e.g. every hour).
   *
   * Returns the number of tasks that were transitioned to EXPIRED.
   * Uses updateMany to avoid loading documents into memory.
   */
  async expireOverdueTasks(): Promise<number> {
    const result = await TaskModel.updateMany(
      {
        isDeleted: false,
        expiresAt: { $lte: new Date() },
        status:    { $nin: TERMINAL_STATUSES },
      },
      { status: TaskStatus.EXPIRED },
    );
    return result.modifiedCount;
  }

  // ─── Provider Interactions ────────────────────────────────────────────────────

  /**
   * Records a provider's interest in a task.
   *
   * Only valid while the task is FLOATING or MATCHED — the provider must be
   * visible in the task's context before they can express interest.
   *
   * Verifies the provider profile exists to prevent phantom interest entries.
   * The model method enforces idempotency (duplicate interest is rejected).
   */
  async expressProviderInterest(
    taskId: string,
    providerProfileId: string,
    message?: string,
  ): Promise<Task | null> {
    if (!Types.ObjectId.isValid(taskId))            throw new Error("Invalid task ID");
    if (!Types.ObjectId.isValid(providerProfileId)) throw new Error("Invalid provider profile ID");

    const [task, providerExists] = await Promise.all([
      TaskModel.findOne({ _id: new Types.ObjectId(taskId), isDeleted: false }),
      ProviderProfileModel.countDocuments({
        _id: new Types.ObjectId(providerProfileId),
        isDeleted: false,
      }),
    ]);

    if (!task)           throw new Error("Task not found");
    if (!providerExists) throw new Error("Provider profile not found");

    await (task as TaskDocument).addProviderInterest(
      new Types.ObjectId(providerProfileId),
      message?.trim(),
    );
    return (task as TaskDocument).toObject() as Task;
  }

  /**
   * Removes a provider's previously expressed interest from a task.
   * Can be called by the provider themselves or by an admin.
   */
  async withdrawProviderInterest(
    taskId: string,
    providerProfileId: string,
  ): Promise<Task | null> {
    if (!Types.ObjectId.isValid(taskId))            throw new Error("Invalid task ID");
    if (!Types.ObjectId.isValid(providerProfileId)) throw new Error("Invalid provider profile ID");

    const task = (await TaskModel.findOne({
      _id: new Types.ObjectId(taskId),
      isDeleted: false,
    })) as TaskDocument | null;

    if (!task) throw new Error("Task not found");

    await task.removeProviderInterest(new Types.ObjectId(providerProfileId));
    return task.toObject() as Task;
  }

  /**
   * The client selects a specific provider for their task.
   *
   * The provider can be any active provider — they do not have to be in the
   * matchedProviders list. This allows clients to request a provider they
   * already know (e.g. from their favourites list).
   *
   * Ownership is verified: only the task's owning client can request a provider.
   * The task transitions to REQUESTED status.
   */
  async requestProvider(
    taskId: string,
    clientProfileId: string,
    providerProfileId: string,
    message?: string,
  ): Promise<Task | null> {
    if (!Types.ObjectId.isValid(taskId))            throw new Error("Invalid task ID");
    if (!Types.ObjectId.isValid(clientProfileId))   throw new Error("Invalid client profile ID");
    if (!Types.ObjectId.isValid(providerProfileId)) throw new Error("Invalid provider profile ID");

    const [task, providerExists] = await Promise.all([
      TaskModel.findOne({
        _id:      new Types.ObjectId(taskId),
        clientId: new Types.ObjectId(clientProfileId),
        isDeleted: false,
      }),
      ProviderProfileModel.countDocuments({
        _id: new Types.ObjectId(providerProfileId),
        isDeleted: false,
      }),
    ]);

    if (!task)           throw new Error("Task not found or you do not own this task");
    if (!providerExists) throw new Error("Provider profile not found");

    await (task as TaskDocument).requestProvider(
      new Types.ObjectId(providerProfileId),
      message?.trim(),
    );
    return (task as TaskDocument).toObject() as Task;
  }

  /**
   * A provider accepts or rejects a task request directed at them.
   *
   * accept: transitions the task to ACCEPTED.
   * reject: reverts the task to FLOATING so the client can select again.
   *
   * The model enforces that only the requestedProvider can accept.
   */
  async providerRespondToTask(
    taskId: string,
    providerProfileId: string,
    action: "accept" | "reject",
    message?: string,
  ): Promise<Task | null> {
    if (!Types.ObjectId.isValid(taskId))            throw new Error("Invalid task ID");
    if (!Types.ObjectId.isValid(providerProfileId)) throw new Error("Invalid provider profile ID");

    const task = (await TaskModel.findOne({
      _id: new Types.ObjectId(taskId),
      isDeleted: false,
    })) as TaskDocument | null;

    if (!task) throw new Error("Task not found");

    const providerObjId = new Types.ObjectId(providerProfileId);

    if (action === "accept") {
      await task.acceptTask(providerObjId, message?.trim());
    } else {
      await task.rejectTask(providerObjId, message?.trim());
    }

    return task.toObject() as Task;
  }

  // ─── Conversion to Booking ────────────────────────────────────────────────────

  /**
   * Marks a task as CONVERTED after a booking has been created from it.
   *
   * Called by BookingService once the booking document is confirmed persisted —
   * never called directly by route handlers. This maintains a clean reference
   * between the two documents and prevents the task from appearing in
   * active / floating listings after the booking exists.
   *
   * Accepts ACCEPTED or MATCHED tasks (MATCHED covers the case where the
   * booking is created immediately without a full request/accept cycle).
   */
  async convertToBooking(
    taskId: string,
    bookingId: string,
  ): Promise<Task | null> {
    if (!Types.ObjectId.isValid(taskId))    throw new Error("Invalid task ID");
    if (!Types.ObjectId.isValid(bookingId)) throw new Error("Invalid booking ID");

    // Verify the booking document actually exists before stamping its ID onto
    // the task. A missing booking here indicates a caller bug or a race
    // condition in the booking creation pipeline — fail loudly rather than
    // storing a dangling reference.
    const bookingExists = await BookingModel.countDocuments({
      _id:       new Types.ObjectId(bookingId),
      isDeleted: false,
    });
    if (!bookingExists) throw new Error("Booking not found");

    const convertible: TaskStatus[] = [TaskStatus.ACCEPTED, TaskStatus.MATCHED];

    const updated = await TaskModel.findOneAndUpdate(
      {
        _id:      new Types.ObjectId(taskId),
        isDeleted: false,
        status:   { $in: convertible },
      },
      {
        status:               TaskStatus.CONVERTED,
        convertedToBookingId: new Types.ObjectId(bookingId),
        convertedAt:          new Date(),
      },
      { new: true, runValidators: true },
    ).lean();

    if (!updated) {
      throw new Error(
        `Task not found or not in a convertible state. ` +
        `Task must be in ${convertible.join(" or ")} status.`,
      );
    }

    return updated as Task;
  }

  // ─── Matching ─────────────────────────────────────────────────────────────────

  /**
   * Manually re-triggers provider matching for a task.
   *
   * Use cases:
   *   - Initial matching failed (e.g. temporary OSM outage)
   *   - Task content was edited outside of updateTask() (admin correction)
   *   - New providers have registered in the task's area since creation
   *
   * Only tasks in REMATCHABLE_STATUSES (PENDING, MATCHED, FLOATING) can be
   * re-matched. Tasks that are already REQUESTED, ACCEPTED, or terminal cannot
   * have their matched provider list re-written.
   */
  async triggerMatching(
    taskId: string,
    strategy: "intelligent" | "location-only" = "intelligent",
  ): Promise<{ task: Task; summary: MatchingSummary }> {
    if (!Types.ObjectId.isValid(taskId)) throw new Error("Invalid task ID");

    const task = (await TaskModel.findOne({
      _id: new Types.ObjectId(taskId),
      isDeleted: false,
    })) as TaskDocument | null;

    if (!task) throw new Error("Task not found");

    if (!REMATCHABLE_STATUSES.includes(task.status)) {
      throw new Error(
        `Cannot re-trigger matching for a task with status: ${task.status}. ` +
        `Only tasks in ${REMATCHABLE_STATUSES.join(", ")} can be re-matched.`,
      );
    }

    const { task: matched, summary } = await this.matchingService.runMatching(
      task,
      strategy,
    );

    return { task: matched.toObject() as Task, summary };
  }

  // ─── Discovery Queries ────────────────────────────────────────────────────────

  /**
   * Returns tasks currently in FLOATING status — visible to all providers
   * in the region as open opportunities.
   *
   * Filtered by region, city, and/or category. Used by the provider's
   * "find tasks" feed.
   */
  async getFloatingTasks(
    filters: {
      region?: string;
      city?: string;
      categoryId?: string;
    } = {},
    pagination: { limit?: number; skip?: number } = {},
  ): Promise<{ tasks: Task[]; total: number; hasMore: boolean }> {
    const { limit = 20, skip = 0 } = pagination;

    const query: Record<string, any> = {
      status:    TaskStatus.FLOATING,
      isDeleted: false,
    };

    if (filters.region) {
      query["locationContext.registeredLocation.region"] = filters.region.trim();
    }
    if (filters.city) {
      query["locationContext.registeredLocation.city"] = filters.city.trim();
    }
    if (filters.categoryId && Types.ObjectId.isValid(filters.categoryId)) {
      query.category = new Types.ObjectId(filters.categoryId);
    }

    const [tasks, total] = await Promise.all([
      TaskModel.find(query)
        .populate("category", "catName slug")
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean(),
      TaskModel.countDocuments(query),
    ]);

    return {
      tasks: tasks as Task[],
      total,
      hasMore: skip + tasks.length < total,
    };
  }

  /**
   * Returns tasks where the given provider appears in the matchedProviders
   * array. Used by the provider dashboard to surface pending opportunities.
   *
   * Only MATCHED and FLOATING tasks are returned — once a task is REQUESTED
   * or beyond, it is no longer an "opportunity" for this provider.
   */
  async getMatchedTasksForProvider(
    providerProfileId: string,
    options: { limit?: number; skip?: number } = {},
  ): Promise<{ tasks: Task[]; total: number; hasMore: boolean }> {
    if (!Types.ObjectId.isValid(providerProfileId)) {
      throw new Error("Invalid provider profile ID");
    }

    const { limit = 20, skip = 0 } = options;

    const query = {
      "matchedProviders.providerId": new Types.ObjectId(providerProfileId),
      status:    { $in: [TaskStatus.MATCHED, TaskStatus.FLOATING] },
      isDeleted: false,
    };

    const [tasks, total] = await Promise.all([
      TaskModel.find(query)
        .populate("category", "catName slug")
        .sort({ "matchedProviders.matchScore": -1, createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean(),
      TaskModel.countDocuments(query),
    ]);

    return {
      tasks: tasks as Task[],
      total,
      hasMore: skip + tasks.length < total,
    };
  }

  /**
   * Returns REQUESTED tasks directed at a specific provider.
   * Used by the provider to see tasks awaiting their accept/reject decision.
   */
  async getPendingRequestsForProvider(
    providerProfileId: string,
    options: { limit?: number; skip?: number } = {},
  ): Promise<{ tasks: Task[]; total: number; hasMore: boolean }> {
    if (!Types.ObjectId.isValid(providerProfileId)) {
      throw new Error("Invalid provider profile ID");
    }

    const { limit = 20, skip = 0 } = options;

    const query = {
      "requestedProvider.providerId": new Types.ObjectId(providerProfileId),
      status:    TaskStatus.REQUESTED,
      isDeleted: false,
    };

    const [tasks, total] = await Promise.all([
      TaskModel.find(query)
        .populate("category", "catName slug")
        .populate("clientId", "bio mobileNumber profilePictureId")
        .sort({ "requestedProvider.requestedAt": 1 }) // oldest request first
        .limit(limit)
        .skip(skip)
        .lean(),
      TaskModel.countDocuments(query),
    ]);

    return {
      tasks: tasks as Task[],
      total,
      hasMore: skip + tasks.length < total,
    };
  }

  /**
   * Returns tasks where the given provider has expressed interest.
   * Useful for the provider to track their pending interest applications.
   */
  async getTasksWithProviderInterest(
    providerProfileId: string,
    options: { limit?: number; skip?: number } = {},
  ): Promise<{ tasks: Task[]; total: number; hasMore: boolean }> {
    if (!Types.ObjectId.isValid(providerProfileId)) {
      throw new Error("Invalid provider profile ID");
    }

    const { limit = 20, skip = 0 } = options;

    const query = {
      "interestedProviders.providerId": new Types.ObjectId(providerProfileId),
      isDeleted: false,
    };

    const [tasks, total] = await Promise.all([
      TaskModel.find(query)
        .populate("category", "catName slug")
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean(),
      TaskModel.countDocuments(query),
    ]);

    return {
      tasks: tasks as Task[],
      total,
      hasMore: skip + tasks.length < total,
    };
  }

  /**
   * Full-text search across task title, description, and tags.
   * Uses the MongoDB text index defined on the TaskModel schema.
   *
   * Supports optional filters for status, category, region, and client.
   */
  async searchTasks(
    searchTerm: string,
    filters: {
      status?: TaskStatus;
      categoryId?: string;
      region?: string;
      clientId?: string;
    } = {},
    pagination: { limit?: number; skip?: number } = {},
  ): Promise<{ tasks: Task[]; total: number; hasMore: boolean }> {
    if (!searchTerm?.trim()) throw new Error("Search term is required");

    const { limit = 20, skip = 0 } = pagination;

    const query: Record<string, any> = {
      $text:     { $search: searchTerm.trim() },
      isDeleted: false,
    };

    if (filters.status) query.status = filters.status;
    if (filters.categoryId && Types.ObjectId.isValid(filters.categoryId)) {
      query.category = new Types.ObjectId(filters.categoryId);
    }
    if (filters.region) {
      query["locationContext.registeredLocation.region"] = filters.region.trim();
    }
    if (filters.clientId && Types.ObjectId.isValid(filters.clientId)) {
      query.clientId = new Types.ObjectId(filters.clientId);
    }

    const [tasks, total] = await Promise.all([
      TaskModel.find(query)
        .sort({ score: { $meta: "textScore" } })
        .limit(limit)
        .skip(skip)
        .lean(),
      TaskModel.countDocuments(query),
    ]);

    return {
      tasks: tasks as Task[],
      total,
      hasMore: skip + tasks.length < total,
    };
  }

  /**
   * Returns the list of providers who have expressed interest in a task,
   * with their ProviderProfile documents populated.
   *
   * Should only be surfaced to the task's owning client or an admin.
   */
  async getInterestedProviders(taskId: string): Promise<{
    providers: Array<{
      expressedAt: Date;
      message?: string;
      [key: string]: any;
    }>;
    task: Pick<Task, "_id" | "status" | "title">;
  }> {
    if (!Types.ObjectId.isValid(taskId)) throw new Error("Invalid task ID");

    const task = await TaskModel.findOne({
      _id: new Types.ObjectId(taskId),
      isDeleted: false,
    })
      .populate({
        path:   "interestedProviders.providerId",
        select: "businessName locationData providerContactInfo serviceOfferings",
        populate: {
          path:   "serviceOfferings",
          select: "title slug isActive",
        },
      })
      .lean();

    if (!task) throw new Error("Task not found");

    const providers = (task.interestedProviders ?? []).map((entry: any) => ({
      ...(entry.providerId ?? {}),
      expressedAt: entry.expressedAt,
      message:     entry.message,
    }));

    return {
      providers,
      task: {
        _id:    task._id,
        status: task.status,
        title:  task.title,
      },
    };
  }

  /**
   * Retrieves the matched provider results for a specific task with full
   * provider documents attached — ready for the client to review and
   * select a provider.
   *
   * Providers are returned in descending matchScore order (already stored
   * that way) with their distance attached if the task has GPS coordinates.
   */
  async getMatchedProviders(taskId: string): Promise<{
    matchedProviders: any[];
    matchingCriteria: Task["matchingCriteria"];
    task: Pick<Task, "_id" | "status" | "title" | "matchingAttemptedAt">;
  }> {
    if (!Types.ObjectId.isValid(taskId)) throw new Error("Invalid task ID");

    const task = await TaskModel.findOne({
      _id: new Types.ObjectId(taskId),
      isDeleted: false,
    })
      .populate({
        path:   "matchedProviders.providerId",
        select: "businessName locationData providerContactInfo serviceOfferings businessGalleryImages",
        populate: [
          { path: "serviceOfferings", select: "title slug isActive servicePricing" },
          { path: "businessGalleryImages", select: "url thumbnailUrl" },
        ],
      })
      .lean();

    if (!task) throw new Error("Task not found");

    return {
      matchedProviders: task.matchedProviders ?? [],
      matchingCriteria: task.matchingCriteria,
      task: {
        _id:                 task._id,
        status:              task.status,
        title:               task.title,
        matchingAttemptedAt: task.matchingAttemptedAt,
      },
    };
  }

  /**
   * Increments the view count for a task (e.g. when the task detail page loads).
   * Fire-and-forget — never throws, never awaited at the call site.
   */
  async incrementViewCount(taskId: string): Promise<void> {
    if (!Types.ObjectId.isValid(taskId)) return;
    await TaskModel.findOneAndUpdate(
      { _id: new Types.ObjectId(taskId), isDeleted: false },
      { $inc: { viewCount: 1 } },
    ).catch(() => {
      // Intentionally silent — view count loss on failure is acceptable
    });
  }

  // ─── Activity Summary ─────────────────────────────────────────────────────────

  /**
   * Returns a compact activity summary for a client — used by the client
   * dashboard to render task counts without loading full documents.
   */
  async getClientTaskSummary(clientProfileId: string): Promise<{
    totalTasks: number;
    activeTasks: number;
    convertedTasks: number;
    cancelledTasks: number;
    expiredTasks: number;
  }> {
    if (!Types.ObjectId.isValid(clientProfileId)) {
      throw new Error("Invalid client profile ID");
    }

    const clientObjectId = new Types.ObjectId(clientProfileId);

    const [total, active, converted, cancelled, expired] = await Promise.all([
      TaskModel.countDocuments({ clientId: clientObjectId, isDeleted: false }),
      TaskModel.countDocuments({
        clientId:  clientObjectId,
        isDeleted: false,
        status:    {
          $in: [
            TaskStatus.PENDING,
            TaskStatus.MATCHED,
            TaskStatus.FLOATING,
            TaskStatus.REQUESTED,
            TaskStatus.ACCEPTED,
          ],
        },
      }),
      TaskModel.countDocuments({
        clientId: clientObjectId, isDeleted: false, status: TaskStatus.CONVERTED,
      }),
      TaskModel.countDocuments({
        clientId: clientObjectId, isDeleted: false, status: TaskStatus.CANCELLED,
      }),
      TaskModel.countDocuments({
        clientId: clientObjectId, isDeleted: false, status: TaskStatus.EXPIRED,
      }),
    ]);

    return {
      totalTasks:     total,
      activeTasks:    active,
      convertedTasks: converted,
      cancelledTasks: cancelled,
      expiredTasks:   expired,
    };
  }

  // ─── Admin Operations ─────────────────────────────────────────────────────────

  /**
   * Returns a paginated list of all tasks across all clients.
   * Used by the admin dashboard.
   */
  async getAllTasks(
    pagination: { limit: number; skip: number },
    filters: {
      status?: TaskStatus;
      clientId?: string;
      includeDeleted?: boolean;
    } = {},
  ): Promise<{ tasks: Task[]; total: number; hasMore: boolean }> {
    const { limit, skip } = pagination;
    const { status, clientId, includeDeleted = false } = filters;

    const query: Record<string, any> = includeDeleted ? {} : { isDeleted: false };
    if (status) query.status = status;
    if (clientId && Types.ObjectId.isValid(clientId)) {
      query.clientId = new Types.ObjectId(clientId);
    }

    const queryOptions = includeDeleted ? { includeSoftDeleted: true } : {};

    const [tasks, total] = await Promise.all([
      TaskModel.find(query, null, queryOptions)
        .populate("category", "catName slug")
        .populate("clientId", "bio mobileNumber")
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean(),
      TaskModel.countDocuments(query),
    ]);

    return {
      tasks: tasks as Task[],
      total,
      hasMore: skip + tasks.length < total,
    };
  }

  /**
   * Platform-wide or per-client task statistics.
   * Pass clientId to scope to a single client's tasks (provider dashboard, etc.).
   * Omit for a system-wide admin overview.
   */
  async getTaskStats(clientId?: string): Promise<{
    totalTasks: number;
    pendingTasks: number;
    matchedTasks: number;
    floatingTasks: number;
    requestedTasks: number;
    acceptedTasks: number;
    convertedTasks: number;
    cancelledTasks: number;
    expiredTasks: number;
    deletedTasks: number;
    matchingSuccessRate: number;
  }> {
    const base: Record<string, any> = clientId
      ? { clientId: new Types.ObjectId(clientId) }
      : {};

    const [
      total,
      pending,
      matched,
      floating,
      requested,
      accepted,
      converted,
      cancelled,
      expired,
      deleted,
    ] = await Promise.all([
      TaskModel.countDocuments({ ...base, isDeleted: false }),
      TaskModel.countDocuments({ ...base, isDeleted: false, status: TaskStatus.PENDING }),
      TaskModel.countDocuments({ ...base, isDeleted: false, status: TaskStatus.MATCHED }),
      TaskModel.countDocuments({ ...base, isDeleted: false, status: TaskStatus.FLOATING }),
      TaskModel.countDocuments({ ...base, isDeleted: false, status: TaskStatus.REQUESTED }),
      TaskModel.countDocuments({ ...base, isDeleted: false, status: TaskStatus.ACCEPTED }),
      TaskModel.countDocuments({ ...base, isDeleted: false, status: TaskStatus.CONVERTED }),
      TaskModel.countDocuments({ ...base, isDeleted: false, status: TaskStatus.CANCELLED }),
      TaskModel.countDocuments({ ...base, isDeleted: false, status: TaskStatus.EXPIRED }),
      TaskModel.countDocuments({ ...base, isDeleted: true }),
    ]);

    // Tasks that moved past PENDING without staying stuck = matching success
    const matchedOrBeyond = matched + floating + requested + accepted + converted;
    const matchingSuccessRate =
      total > 0
        ? parseFloat(((matchedOrBeyond / total) * 100).toFixed(2))
        : 0;

    return {
      totalTasks:         total,
      pendingTasks:       pending,
      matchedTasks:       matched,
      floatingTasks:      floating,
      requestedTasks:     requested,
      acceptedTasks:      accepted,
      convertedTasks:     converted,
      cancelledTasks:     cancelled,
      expiredTasks:       expired,
      deletedTasks:       deleted,
      matchingSuccessRate,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * Shared TaskService instance.
 * Import this in route handlers and controllers — do not instantiate TaskService
 * directly in application code.
 *
 * In tests, construct a fresh instance with mocked dependencies:
 *   new TaskService(mockLocationService, mockMatchingService)
 */
export const taskService = new TaskService();