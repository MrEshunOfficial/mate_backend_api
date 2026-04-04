import { Types, Model, HydratedDocument } from "mongoose";
import { BaseEntity, SoftDeletable, ActorRole } from "./base.types";
import { TaskLocationContext } from "./location.types";

export enum TaskPriority {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
  URGENT = "URGENT",
}

export enum TaskStatus {
  PENDING = "PENDING", // created, awaiting matching
  MATCHED = "MATCHED", // providers matched by system
  FLOATING = "FLOATING", // open to all providers
  REQUESTED = "REQUESTED", // client selected a provider
  ACCEPTED = "ACCEPTED", // provider accepted — pending conversion
  CONVERTED = "CONVERTED", // converted to a Booking
  EXPIRED = "EXPIRED",
  CANCELLED = "CANCELLED",
}

// ─── Matching Types ───────────────────────────────────────────────────────────

export interface ProviderMatchResult {
  providerId: Types.ObjectId;
  matchScore: number;
  matchedServices: Types.ObjectId[];
  matchReasons: string[];
  distance?: number;
  scoreBreakdown?: {
    titleScore: number;
    descriptionScore: number;
    tagScore: number;
    categoryScore: number;
    locationScore: number;
    pricingScore: number; // aligned with TaskMatchingConfig.weights
  };
}

export interface TaskMatchingConfig {
  maxDistanceKm: number;
  prioritizeNearby: boolean;
  weights: {
    titleMatch: number;
    descriptionMatch: number;
    tagMatch: number;
    categoryMatch: number;
    locationProximity: number;
    pricingMatch: number; // pricing is a stated matching criterion
  };
  minimumMatchScore: number;
  maxProvidersToReturn: number;
  fallbackToLocationOnly: boolean;
  fallbackThreshold?: number;
}

// ─── Task Entity ──────────────────────────────────────────────────────────────

export interface Task extends BaseEntity, SoftDeletable {
  title: string;
  description: string;
  category?: Types.ObjectId;
  tags?: string[];

  clientId: Types.ObjectId;

  // Holds both location sources — matching evaluates both
  locationContext: TaskLocationContext;

  schedule: {
    priority: TaskPriority;
    preferredDate?: Date;
    flexibleDates?: boolean;
    timeSlot?: {
      start: string;
      end?: string;
    };
  };

  estimatedBudget?: {
    min?: number;
    max?: number;
    currency: string;
  };

  status: TaskStatus;
  expiresAt?: Date;

  matchedProviders?: ProviderMatchResult[];
  matchingAttemptedAt?: Date;
  matchingCriteria?: {
    useLocationOnly: boolean;
    searchTerms: string[];
    categoryMatch: boolean;
    budgetRange?: {
      min?: number;
      max?: number;
      currency: string;
    };
    radiusUsedKm?: number;
    locationSourceUsed?: "registered" | "gps" | "both";
  };

  interestedProviders?: Array<{
    providerId: Types.ObjectId;
    expressedAt: Date;
    message?: string;
  }>;

  requestedProvider?: {
    providerId: Types.ObjectId;
    requestedAt: Date;
    clientMessage?: string;
  };

  acceptedProvider?: {
    providerId: Types.ObjectId;
    acceptedAt: Date;
    providerMessage?: string;
  };

  convertedToBookingId?: Types.ObjectId;
  convertedAt?: Date;

  cancelledAt?: Date;
  cancellationReason?: string;
  cancelledBy?: ActorRole;

  viewCount: number;
}

// ─── Instance Methods ─────────────────────────────────────────────────────────

export interface TaskMethods {
  softDelete(
    deletedBy?: Types.ObjectId,
  ): Promise<HydratedDocument<Task, TaskMethods>>;
  restore(): Promise<HydratedDocument<Task, TaskMethods>>;
  findMatches(
    strategy?: "intelligent" | "location-only",
  ): Promise<HydratedDocument<Task, TaskMethods>>;
  calculateIntelligentMatchScore(
    provider: any,
    services: any[],
  ): ProviderMatchResult;
  calculateLocationMatchScore(provider: any): ProviderMatchResult;
  buildMatchReasons(provider: any, services: any[], scores: any): string[];
  makeFloating(): Promise<HydratedDocument<Task, TaskMethods>>;
  addProviderInterest(
    providerId: Types.ObjectId,
    message?: string,
  ): Promise<HydratedDocument<Task, TaskMethods>>;
  removeProviderInterest(
    providerId: Types.ObjectId,
  ): Promise<HydratedDocument<Task, TaskMethods>>;
  requestProvider(
    providerId: Types.ObjectId,
    message?: string,
  ): Promise<HydratedDocument<Task, TaskMethods>>;
  acceptTask(
    providerId: Types.ObjectId,
    message?: string,
  ): Promise<HydratedDocument<Task, TaskMethods>>;
  rejectTask(
    providerId: Types.ObjectId,
    reason?: string,
  ): Promise<HydratedDocument<Task, TaskMethods>>;
  cancelTask(
    reason?: string,
    cancelledBy?: ActorRole,
  ): Promise<HydratedDocument<Task, TaskMethods>>;
}

// ─── Static Methods ───────────────────────────────────────────────────────────

export interface TaskModel extends Model<Task, {}, TaskMethods> {
  findActive(): any;
  findByClient(clientId: string): any;
  findByService(serviceId: string): any;
  findFloatingTasks(): any;
  findMatchedForProvider(providerId: string): any;
  findConverted(filters?: any): any;
  searchTasks(searchTerm: string, filters?: any): any;
}

// ─── API Request / Response ───────────────────────────────────────────────────

export interface CreateTaskRequestBody {
  title: string;
  description: string;
  category?: Types.ObjectId | string;
  tags?: string[];
  locationContext: TaskLocationContext;
  schedule: {
    priority: TaskPriority;
    preferredDate?: Date;
    flexibleDates?: boolean;
    timeSlot?: { start: string; end: string };
  };
  estimatedBudget?: { min?: number; max?: number; currency?: string };
  matchingStrategy?: "intelligent" | "location-only";
}

export interface UpdateTaskRequestBody {
  title?: string;
  description?: string;
  locationContext?: Partial<TaskLocationContext>;
  schedule?: Partial<{
    priority: TaskPriority;
    preferredDate?: Date;
    flexibleDates?: boolean;
    timeSlot?: { start: string; end: string };
  }>;
  estimatedBudget?: { min?: number; max?: number; currency?: string };
}

export interface ExpressInterestRequestBody {
  taskId: string;
  message?: string;
}

export interface RequestProviderRequestBody {
  taskId: string;
  providerId: string;
  message?: string;
}

export interface ProviderResponseRequestBody {
  taskId: string;
  action: "accept" | "reject";
  message?: string;
}

export interface MatchingSummary {
  strategy: "intelligent" | "location-only";
  totalMatches: number;
  averageMatchScore: number;
  searchTermsUsed: string[];
  radiusUsedKm: number;
  locationSourceUsed: "registered" | "gps" | "both";
}

export interface TaskResponse {
  success: boolean;
  message: string;
  task?: Task;
  booking?: any;
  error?: string;
}

export interface TaskListResponse {
  success: boolean;
  message: string;
  tasks?: Task[] | Partial<Task>[];
  error?: string;
}

export interface TaskWithProvidersResponse {
  success: boolean;
  message: string;
  task?: Task;
  matchedProviders?: ProviderMatchResult[];
  matchingSummary?: MatchingSummary;
  error?: string;
}
