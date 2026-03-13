
import { TaskStatusHandler }               from "./handlers/status.handler";
import { TaskProviderInteractionHandler }  from "./handlers/provider-interaction.handler";
import { TaskMatchingHandler }             from "./handlers/matching.handler";
import { TaskDiscoveryHandler }            from "./handlers/discovery.handler";
import { TaskAdminHandler }                from "./handlers/admin.handler";
import { TaskCRUDHandler } from "./handlers/crud.handler";

/**
 * Task Controller
 *
 * Delegates HTTP requests to specialised handler classes:
 *   TaskCRUDHandler                 — create, getById, getByClient, update, delete, restore
 *   TaskStatusHandler               — cancel, float, expire (single + batch), convertToBooking
 *   TaskProviderInteractionHandler  — expressInterest, withdrawInterest, requestProvider, providerRespond
 *   TaskMatchingHandler             — triggerMatching, getMatchedProviders, getInterestedProviders
 *   TaskDiscoveryHandler            — floating feed, matched for provider, pending requests,
 *                                     interested tasks, full-text search
 *   TaskAdminHandler                — getAllTasks, getTaskStats, getClientTaskSummary
 */
export class TaskController {
  private crudHandler:                 TaskCRUDHandler;
  private statusHandler:               TaskStatusHandler;
  private providerInteractionHandler:  TaskProviderInteractionHandler;
  private matchingHandler:             TaskMatchingHandler;
  private discoveryHandler:            TaskDiscoveryHandler;
  private adminHandler:                TaskAdminHandler;

  // ─── CRUD ─────────────────────────────────────────────────────────────────
  public createTask;
  public getTaskById;
  public getTasksByClient;
  public updateTask;
  public deleteTask;
  public restoreTask;

  // ─── Status ───────────────────────────────────────────────────────────────
  public cancelTask;
  public makeTaskFloating;
  public expireTask;
  public expireOverdueTasks;
  public convertToBooking;

  // ─── Provider Interactions ────────────────────────────────────────────────
  public expressProviderInterest;
  public withdrawProviderInterest;
  public requestProvider;
  public providerRespondToTask;

  // ─── Matching ─────────────────────────────────────────────────────────────
  public triggerMatching;
  public getMatchedProviders;
  public getInterestedProviders;

  // ─── Discovery ────────────────────────────────────────────────────────────
  public getFloatingTasks;
  public getMatchedTasksForProvider;
  public getPendingRequestsForProvider;
  public getTasksWithProviderInterest;
  public searchTasks;

  // ─── Admin ────────────────────────────────────────────────────────────────
  public getAllTasks;
  public getTaskStats;
  public getClientTaskSummary;

  constructor() {
    this.crudHandler                = new TaskCRUDHandler();
    this.statusHandler              = new TaskStatusHandler();
    this.providerInteractionHandler = new TaskProviderInteractionHandler();
    this.matchingHandler            = new TaskMatchingHandler();
    this.discoveryHandler           = new TaskDiscoveryHandler();
    this.adminHandler               = new TaskAdminHandler();

    // CRUD
    this.createTask       = this.crudHandler.createTask;
    this.getTaskById      = this.crudHandler.getTaskById;
    this.getTasksByClient = this.crudHandler.getTasksByClient;
    this.updateTask       = this.crudHandler.updateTask;
    this.deleteTask       = this.crudHandler.deleteTask;
    this.restoreTask      = this.crudHandler.restoreTask;

    // Status
    this.cancelTask         = this.statusHandler.cancelTask;
    this.makeTaskFloating   = this.statusHandler.makeTaskFloating;
    this.expireTask         = this.statusHandler.expireTask;
    this.expireOverdueTasks = this.statusHandler.expireOverdueTasks;
    this.convertToBooking   = this.statusHandler.convertToBooking;

    // Provider Interactions
    this.expressProviderInterest  = this.providerInteractionHandler.expressProviderInterest;
    this.withdrawProviderInterest = this.providerInteractionHandler.withdrawProviderInterest;
    this.requestProvider          = this.providerInteractionHandler.requestProvider;
    this.providerRespondToTask    = this.providerInteractionHandler.providerRespondToTask;

    // Matching
    this.triggerMatching       = this.matchingHandler.triggerMatching;
    this.getMatchedProviders   = this.matchingHandler.getMatchedProviders;
    this.getInterestedProviders = this.matchingHandler.getInterestedProviders;

    // Discovery
    this.getFloatingTasks              = this.discoveryHandler.getFloatingTasks;
    this.getMatchedTasksForProvider    = this.discoveryHandler.getMatchedTasksForProvider;
    this.getPendingRequestsForProvider = this.discoveryHandler.getPendingRequestsForProvider;
    this.getTasksWithProviderInterest  = this.discoveryHandler.getTasksWithProviderInterest;
    this.searchTasks                   = this.discoveryHandler.searchTasks;

    // Admin
    this.getAllTasks          = this.adminHandler.getAllTasks;
    this.getTaskStats         = this.adminHandler.getTaskStats;
    this.getClientTaskSummary = this.adminHandler.getClientTaskSummary;
  }
}

// ─── Singleton + Named Exports ────────────────────────────────────────────────

// Arrow-function methods on class instances are bound to their handler instance
// at construction time, so direct destructuring is safe — no extra .bind() needed.
const taskController = new TaskController();

export const {
  // CRUD
  createTask,
  getTaskById,
  getTasksByClient,
  updateTask,
  deleteTask,
  restoreTask,

  // Status
  cancelTask,
  makeTaskFloating,
  expireTask,
  expireOverdueTasks,
  convertToBooking,

  // Provider Interactions
  expressProviderInterest,
  withdrawProviderInterest,
  requestProvider,
  providerRespondToTask,

  // Matching
  triggerMatching,
  getMatchedProviders,
  getInterestedProviders,

  // Discovery
  getFloatingTasks,
  getMatchedTasksForProvider,
  getPendingRequestsForProvider,
  getTasksWithProviderInterest,
  searchTasks,

  // Admin
  getAllTasks,
  getTaskStats,
  getClientTaskSummary,
} = taskController;

export default TaskController;