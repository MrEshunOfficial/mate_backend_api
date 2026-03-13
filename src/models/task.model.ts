// models/task.model.ts
import mongoose, { Schema, model, Model, HydratedDocument } from "mongoose";
import { ActorRole } from "../types/base.types";
import { Task, TaskMethods, TaskPriority, TaskStatus, ProviderMatchResult, TaskModel as ITaskModel } from "../types/tasks.types";


type TaskDocument = HydratedDocument<Task, TaskMethods>;

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const coordinatesSchema = new Schema(
  {
    latitude:  { type: Number, required: true },
    longitude: { type: Number, required: true },
  },
  { _id: false }
);

const userLocationSchema = new Schema(
  {
    ghanaPostGPS:      { type: String, required: true, trim: true },
    nearbyLandmark:    { type: String, trim: true },
    region:            { type: String, trim: true },
    city:              { type: String, trim: true },
    district:          { type: String, trim: true },
    locality:          { type: String, trim: true },
    streetName:        { type: String, trim: true },
    houseNumber:       { type: String, trim: true },
    gpsCoordinates:    { type: coordinatesSchema },
    isAddressVerified: { type: Boolean, default: false },
    sourceProvider: {
      type: String,
      enum: ["openstreetmap", "google", "ghanapost"],
    },
    createdAt: { type: Date },
    updatedAt: { type: Date },
  },
  { _id: false }
);

const gpsLocationSchema = new Schema(
  {
    latitude:   { type: Number, required: true },
    longitude:  { type: Number, required: true },
    accuracy:   { type: Number },
    capturedAt: { type: Date, required: true },
  },
  { _id: false }
);

// Task evaluates BOTH location sources during matching; nearest radius wins.
const taskLocationContextSchema = new Schema(
  {
    registeredLocation:  { type: userLocationSchema, required: true },
    gpsLocationAtPosting: { type: gpsLocationSchema },
    activeRadiusKm:      { type: Number, min: 0 },
  },
  { _id: false }
);

const scheduleSchema = new Schema(
  {
    priority: {
      type: String,
      enum: {
        values: Object.values(TaskPriority),
        message: "Invalid task priority",
      },
      required: true,
      default: TaskPriority.MEDIUM,
    },
    preferredDate:  { type: Date },
    flexibleDates:  { type: Boolean, default: false },
    timeSlot: {
      start: { type: String },
      end:   { type: String },
    },
  },
  { _id: false }
);

const estimatedBudgetSchema = new Schema(
  {
    min:      { type: Number, min: 0 },
    max:      { type: Number, min: 0 },
    currency: { type: String, required: true, uppercase: true, trim: true },
  },
  { _id: false }
);

// Score breakdown stored per ProviderMatchResult
const scoreBreakdownSchema = new Schema(
  {
    titleScore:       { type: Number, default: 0 },
    descriptionScore: { type: Number, default: 0 },
    tagScore:         { type: Number, default: 0 },
    categoryScore:    { type: Number, default: 0 },
    locationScore:    { type: Number, default: 0 },
    pricingScore:     { type: Number, default: 0 },
  },
  { _id: false }
);

const providerMatchResultSchema = new Schema(
  {
    providerId:      { type: Schema.Types.ObjectId, ref: "ProviderProfile", required: true },
    matchScore:      { type: Number, required: true },
    matchedServices: [{ type: Schema.Types.ObjectId, ref: "Service" }],
    matchReasons:    [{ type: String }],
    distance:        { type: Number },
    scoreBreakdown:  { type: scoreBreakdownSchema },
  },
  { _id: false }
);

const matchingCriteriaSchema = new Schema(
  {
    useLocationOnly: { type: Boolean, required: true, default: false },
    searchTerms:     [{ type: String }],
    categoryMatch:   { type: Boolean, default: false },
    budgetRange: {
      min:      { type: Number },
      max:      { type: Number },
      currency: { type: String },
    },
    radiusUsedKm:        { type: Number },
    locationSourceUsed: {
      type: String,
      enum: ["registered", "gps", "both"],
    },
  },
  { _id: false }
);

const interestedProviderSchema = new Schema(
  {
    providerId:  { type: Schema.Types.ObjectId, ref: "ProviderProfile", required: true },
    expressedAt: { type: Date, required: true },
    message:     { type: String, trim: true },
  },
  { _id: false }
);

const requestedProviderSchema = new Schema(
  {
    providerId:     { type: Schema.Types.ObjectId, ref: "ProviderProfile", required: true },
    requestedAt:    { type: Date, required: true },
    clientMessage:  { type: String, trim: true },
  },
  { _id: false }
);

const acceptedProviderSchema = new Schema(
  {
    providerId:      { type: Schema.Types.ObjectId, ref: "ProviderProfile", required: true },
    acceptedAt:      { type: Date, required: true },
    providerMessage: { type: String, trim: true },
  },
  { _id: false }
);

// ─── Main Schema ──────────────────────────────────────────────────────────────

const taskSchema = new Schema<Task, ITaskModel, TaskMethods>(
  {
    title: {
      type: String,
      required: [true, "title is required"],
      trim: true,
      maxlength: [200, "Title cannot exceed 200 characters"],
    },
    description: {
      type: String,
      required: [true, "description is required"],
      trim: true,
      maxlength: [5000, "Description cannot exceed 5000 characters"],
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      index: true,
    },
    tags: { type: [String], default: [] },

    clientId: {
      type: Schema.Types.ObjectId,
      ref: "UserProfile",
      required: [true, "clientId is required"],
      index: true,
    },

    locationContext: {
      type: taskLocationContextSchema,
      required: [true, "locationContext is required"],
    },

    schedule: {
      type: scheduleSchema,
      required: [true, "schedule is required"],
    },

    estimatedBudget: { type: estimatedBudgetSchema },

    status: {
      type: String,
      enum: {
        values: Object.values(TaskStatus),
        message: "Invalid task status",
      },
      default: TaskStatus.PENDING,
      index: true,
    },

    expiresAt: { type: Date, index: true },

    // Matching engine output
    matchedProviders:      { type: [providerMatchResultSchema], default: [] },
    matchingAttemptedAt:   { type: Date },
    matchingCriteria:      { type: matchingCriteriaSchema },

    // Provider interaction tracking
    interestedProviders: { type: [interestedProviderSchema], default: [] },
    requestedProvider:   { type: requestedProviderSchema },
    acceptedProvider:    { type: acceptedProviderSchema },

    // Conversion to booking
    convertedToBookingId: { type: Schema.Types.ObjectId, ref: "Booking", default: null },
    convertedAt:          { type: Date, default: null },

    // Cancellation
    cancelledAt:         { type: Date },
    cancellationReason:  { type: String, trim: true },
    cancelledBy: {
      type: String,
      enum: Object.values(ActorRole),
    },

    viewCount: { type: Number, default: 0 },

    // SoftDeletable
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt:  { type: Date, default: null },
    deletedBy:  { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    collection: "tasks",
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, any>) => {
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

taskSchema.index({ title: "text", description: "text", tags: "text" });
taskSchema.index({ clientId: 1, status: 1 });
taskSchema.index({ status: 1, isDeleted: 1 });
taskSchema.index({ status: 1, expiresAt: 1 });
taskSchema.index({ "matchedProviders.providerId": 1 });
taskSchema.index({ "requestedProvider.providerId": 1 });
taskSchema.index({ "acceptedProvider.providerId": 1 });
taskSchema.index({ category: 1, status: 1 });
taskSchema.index({ "schedule.preferredDate": 1 });
// Geospatial index for GPS-based matching
taskSchema.index(
  { "locationContext.gpsLocationAtPosting.latitude": 1, "locationContext.gpsLocationAtPosting.longitude": 1 },
  { sparse: true }
);

// ─── Pre-save Hook ────────────────────────────────────────────────────────────

taskSchema.pre("save", function (next) {
  if (this.isDeleted && !this.deletedAt) {
    this.deletedAt = new Date();
  }
  if (
    this.status === TaskStatus.CANCELLED &&
    !this.cancelledAt &&
    this.isModified("status")
  ) {
    this.cancelledAt = new Date();
  }
  next();
});

// Exclude soft-deleted records from all find queries by default.
taskSchema.pre(/^find/, function (this: mongoose.Query<any, any>, next) {
  const options = this.getOptions();
  if (!options.includeSoftDeleted) {
    this.find({ isDeleted: { $ne: true } });
  }
  next();
});

// ─── Instance Methods ─────────────────────────────────────────────────────────

taskSchema.methods.softDelete = function (
  this: TaskDocument,
  deletedBy?: mongoose.Types.ObjectId
): Promise<TaskDocument> {
  this.isDeleted = true;
  this.deletedAt = new Date();
  if (deletedBy) this.deletedBy = deletedBy;
  return this.save();
};

taskSchema.methods.restore = function (
  this: TaskDocument
): Promise<TaskDocument> {
  this.isDeleted = false;
  this.deletedAt = undefined as any;
  this.deletedBy = undefined as any;
  return this.save();
};

/**
 * Triggers provider matching. Delegates to the intelligent or
 * location-only strategy and persists the results on the document.
 *
 * The actual scoring logic lives in the matching service layer and calls
 * calculateIntelligentMatchScore / calculateLocationMatchScore below.
 * This method orchestrates the full cycle: score → persist → update status.
 */
taskSchema.methods.findMatches = async function (
  this: TaskDocument,
  strategy: "intelligent" | "location-only" = "intelligent"
): Promise<TaskDocument> {
  // Matching logic is injected at runtime by the task matching service.
  // This stub exists so route handlers can call task.findMatches() without
  // needing to import the service directly, keeping the model/service boundary intact.
  throw new Error(
    "findMatches must be bound by the task matching service before use. " +
    "Import and call TaskMatchingService.bindToModel() at startup."
  );
};

/**
 * Scores a single provider candidate against this task using the
 * full intelligent (title + description + tags + category + location + pricing)
 * weighting defined in TaskMatchingConfig.
 */
taskSchema.methods.calculateIntelligentMatchScore = function (
  this: TaskDocument,
  provider: any,
  services: any[]
): ProviderMatchResult {
  throw new Error(
    "calculateIntelligentMatchScore must be bound by the task matching service."
  );
};

/**
 * Scores a provider candidate using location proximity only.
 * Used as the fallback strategy when intelligent matching yields
 * fewer results than minimumMatchScore allows.
 */
taskSchema.methods.calculateLocationMatchScore = function (
  this: TaskDocument,
  provider: any
): ProviderMatchResult {
  throw new Error(
    "calculateLocationMatchScore must be bound by the task matching service."
  );
};

/**
 * Assembles the human-readable matchReasons array from raw score components.
 * Called by both intelligent and location-only strategies before persisting.
 */
taskSchema.methods.buildMatchReasons = function (
  this: TaskDocument,
  provider: any,
  services: any[],
  scores: any
): string[] {
  throw new Error(
    "buildMatchReasons must be bound by the task matching service."
  );
};

taskSchema.methods.makeFloating = function (
  this: TaskDocument
): Promise<TaskDocument> {
  if (this.status !== TaskStatus.MATCHED) {
    return Promise.reject(
      new Error(`Cannot make task floating from status: ${this.status}`)
    );
  }
  this.status = TaskStatus.FLOATING;
  return this.save();
};

taskSchema.methods.addProviderInterest = function (
  this: TaskDocument,
  providerId: mongoose.Types.ObjectId,
  message?: string
): Promise<TaskDocument> {
  const floatingStatuses: TaskStatus[] = [TaskStatus.FLOATING, TaskStatus.MATCHED];
  if (!floatingStatuses.includes(this.status)) {
    return Promise.reject(
      new Error(`Provider cannot express interest on a task with status: ${this.status}`)
    );
  }
  const alreadyInterested = this.interestedProviders?.some(
    (p) => p.providerId.toString() === providerId.toString()
  );
  if (alreadyInterested) {
    return Promise.reject(new Error("Provider has already expressed interest"));
  }
  if (!this.interestedProviders) this.interestedProviders = [];
  this.interestedProviders.push({ providerId, expressedAt: new Date(), message });
  return this.save();
};

taskSchema.methods.removeProviderInterest = function (
  this: TaskDocument,
  providerId: mongoose.Types.ObjectId
): Promise<TaskDocument> {
  if (this.interestedProviders) {
    this.interestedProviders = this.interestedProviders.filter(
      (p) => p.providerId.toString() !== providerId.toString()
    ) as any;
  }
  return this.save();
};

taskSchema.methods.requestProvider = function (
  this: TaskDocument,
  providerId: mongoose.Types.ObjectId,
  message?: string
): Promise<TaskDocument> {
  const requestable: TaskStatus[] = [
    TaskStatus.MATCHED,
    TaskStatus.FLOATING,
  ];
  if (!requestable.includes(this.status)) {
    return Promise.reject(
      new Error(`Cannot request a provider on a task with status: ${this.status}`)
    );
  }
  this.status = TaskStatus.REQUESTED;
  this.requestedProvider = {
    providerId,
    requestedAt:   new Date(),
    clientMessage: message,
  };
  return this.save();
};

taskSchema.methods.acceptTask = function (
  this: TaskDocument,
  providerId: mongoose.Types.ObjectId,
  message?: string
): Promise<TaskDocument> {
  if (this.status !== TaskStatus.REQUESTED) {
    return Promise.reject(
      new Error(`Cannot accept a task with status: ${this.status}`)
    );
  }
  if (this.requestedProvider?.providerId.toString() !== providerId.toString()) {
    return Promise.reject(new Error("Only the requested provider can accept this task"));
  }
  this.status = TaskStatus.ACCEPTED;
  this.acceptedProvider = {
    providerId,
    acceptedAt:      new Date(),
    providerMessage: message,
  };
  return this.save();
};

taskSchema.methods.rejectTask = function (
  this: TaskDocument,
  providerId: mongoose.Types.ObjectId,
  reason?: string
): Promise<TaskDocument> {
  if (this.status !== TaskStatus.REQUESTED) {
    return Promise.reject(
      new Error(`Cannot reject a task with status: ${this.status}`)
    );
  }
  // Revert to FLOATING so the client can request a different provider
  this.status           = TaskStatus.FLOATING;
  this.requestedProvider = undefined as any;
  return this.save();
};

taskSchema.methods.cancelTask = function (
  this: TaskDocument,
  reason?: string,
  cancelledBy?: ActorRole
): Promise<TaskDocument> {
  const terminal: TaskStatus[] = [
    TaskStatus.CONVERTED,
    TaskStatus.EXPIRED,
    TaskStatus.CANCELLED,
  ];
  if (terminal.includes(this.status)) {
    return Promise.reject(
      new Error(`Cannot cancel a task with status: ${this.status}`)
    );
  }
  this.status             = TaskStatus.CANCELLED;
  this.cancelledAt        = new Date();
  this.cancellationReason = reason;
  this.cancelledBy        = cancelledBy;
  return this.save();
};

// ─── Static Methods ───────────────────────────────────────────────────────────

taskSchema.statics.findActive = function () {
  return this.find({
    status: { $nin: [TaskStatus.EXPIRED, TaskStatus.CANCELLED, TaskStatus.CONVERTED] },
    isDeleted: false,
  });
};

taskSchema.statics.findByClient = function (clientId: string) {
  return this.find({ clientId, isDeleted: false }).sort({ createdAt: -1 });
};

taskSchema.statics.findByService = function (serviceId: string) {
  return this.find({
    "matchedProviders.matchedServices": new mongoose.Types.ObjectId(serviceId),
    isDeleted: false,
  });
};

taskSchema.statics.findFloatingTasks = function () {
  return this.find({ status: TaskStatus.FLOATING, isDeleted: false });
};

taskSchema.statics.findMatchedForProvider = function (providerId: string) {
  return this.find({
    "matchedProviders.providerId": new mongoose.Types.ObjectId(providerId),
    status: { $in: [TaskStatus.MATCHED, TaskStatus.FLOATING] },
    isDeleted: false,
  });
};

taskSchema.statics.findConverted = function (filters?: any) {
  const query: Record<string, any> = {
    status: TaskStatus.CONVERTED,
    isDeleted: false,
    ...filters,
  };
  return this.find(query);
};

taskSchema.statics.searchTasks = function (searchTerm: string, filters?: any) {
  const query: Record<string, any> = {
    $text: { $search: searchTerm },
    isDeleted: false,
    ...filters,
  };
  return this.find(query).sort({ score: { $meta: "textScore" } });
};

// ─── Model ────────────────────────────────────────────────────────────────────

export const TaskModel = model<Task, ITaskModel>(
  "Task",
  taskSchema
);

export default TaskModel;