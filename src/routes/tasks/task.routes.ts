import { Router } from "express";
import {
  getAllTasks,
  getTaskStats,
  expireOverdueTasks,
  getFloatingTasks,
  searchTasks,
  getTasksByClient,
  getClientTaskSummary,
  getMatchedTasksForProvider,
  getPendingRequestsForProvider, // ← comes from task.controller, not SR controller
  getTasksWithProviderInterest,
  createTask, // ← comes from task.controller, not node-cron
  getTaskById,
  updateTask,
  deleteTask,
  cancelTask,
  makeTaskFloating,
  convertToBooking,
  expireTask,
  restoreTask,
  triggerMatching,
  getMatchedProviders,
  getInterestedProviders,
  expressProviderInterest,
  withdrawProviderInterest,
  requestProvider,
  providerRespondToTask,
  getAcceptedTasksForProvider,
} from "../../controllers/tasks/task.controller";
import {
  authenticateToken,
  requireVerification,
  requireAdmin,
} from "../../middleware/auth/auth.middleware";
import {
  requireCustomerOrProvider,
  requireProvider,
  requireCustomer,
} from "../../middleware/role/role.middleware";

const router = Router();

// ─── All routes require authentication + verified email ───────────────────────
router.use(authenticateToken, requireVerification);

// ─── Admin Routes (defined first to prevent :taskId param conflicts) ──────────

/**
 * GET /api/tasks/admin/all
 * Query: status?, clientId?, includeDeleted?, limit?, skip?
 *
 * Platform-wide paginated list of all tasks. Admin only.
 */
router.get("/admin/all", requireAdmin, getAllTasks);

/**
 * GET /api/tasks/admin/stats
 * Query: clientId? (optional)
 *
 * Platform-wide or per-client task statistics. Admin only.
 */
router.get("/admin/stats", requireAdmin, getTaskStats);

/**
 * POST /api/tasks/admin/expire-overdue
 *
 * Batch-expires all tasks whose expiresAt has passed.
 * Intended for cron job invocation (e.g. every hour). Admin only.
 */
router.post("/admin/expire-overdue", requireAdmin, expireOverdueTasks);

// ─── Discovery / Feed Routes (static segments before :taskId param) ───────────

/**
 * GET /api/tasks/floating
 * Query: region?, city?, categoryId?, limit?, skip?
 *
 * Public floating task feed — visible to all providers in the region.
 * Also accessible to customers (e.g. to see what's on the market).
 */
router.get("/floating", requireCustomerOrProvider, getFloatingTasks);

/**
 * GET /api/tasks/search
 * Query: q (required), status?, categoryId?, region?, clientId?, limit?, skip?
 *
 * Full-text search across task title, description, and tags.
 */
router.get("/search", requireCustomerOrProvider, searchTasks);

// ─── Client-scoped Routes ─────────────────────────────────────────────────────

/**
 * GET /api/tasks/client/:clientProfileId
 * Query: status?, limit?, skip?
 *
 * Paginated list of tasks belonging to a specific client.
 */
router.get(
  "/client/:clientProfileId",
  requireCustomerOrProvider,
  getTasksByClient,
);

/**
 * GET /api/tasks/client/:clientProfileId/summary
 *
 * Compact task counts for the client dashboard header.
 * Accessible to the owning client or admin.
 */
router.get(
  "/client/:clientProfileId/summary",
  requireCustomerOrProvider,
  getClientTaskSummary,
);

// ─── Provider-scoped Discovery Routes ────────────────────────────────────────

/**
 * GET /api/tasks/provider/:providerProfileId/matched
 * Query: limit?, skip?
 *
 * Tasks where the provider appears in the matchedProviders array (MATCHED + FLOATING).
 * Provider's opportunities feed.
 */
router.get(
  "/provider/:providerProfileId/matched",
  requireProvider,
  getMatchedTasksForProvider,
);

/**
 * GET /api/tasks/provider/:providerProfileId/requests
 * Query: limit?, skip?
 *
 * REQUESTED tasks directed at the provider — their decision inbox.
 * Sorted oldest-first (FIFO).
 */
router.get(
  "/provider/:providerProfileId/requests",
  requireProvider,
  getPendingRequestsForProvider,
);

/**
 * GET /api/tasks/provider/:providerProfileId/interested
 * Query: limit?, skip?
 *
 * Tasks where the provider has previously expressed interest.
 */
router.get(
  "/provider/:providerProfileId/interested",
  requireProvider,
  getTasksWithProviderInterest,
);

router.get(
  "/provider/:providerProfileId/accepted",
  requireProvider,
  getAcceptedTasksForProvider,
);

// ─── Core CRUD ────────────────────────────────────────────────────────────────

/**
 * POST /api/tasks
 * Body: CreateTaskRequestBody
 *
 * Creates a task and immediately triggers provider matching.
 * Matching failure is non-blocking — the task is still created.
 * Customer role required.
 */
router.post("/", requireCustomer, createTask);

/**
 * GET /api/tasks/:taskId
 * Query: populate? ("true")
 *
 * Fetches a task by its _id. Also fires a non-blocking view count increment.
 */
router.get("/:taskId", requireCustomerOrProvider, getTaskById);

/**
 * PATCH /api/tasks/:taskId
 * Body: UpdateTaskRequestBody
 *
 * Updates mutable task fields. Re-triggers matching when content changes.
 * Only allowed in PENDING, MATCHED, or FLOATING status.
 * The owning client must be authenticated.
 */
router.patch("/:taskId", requireCustomer, updateTask);

/**
 * DELETE /api/tasks/:taskId
 *
 * Soft-deletes a task. REQUESTED and ACCEPTED tasks must be cancelled first.
 */
router.delete("/:taskId", requireCustomerOrProvider, deleteTask);

// ─── Status Transition Routes ─────────────────────────────────────────────────

/**
 * POST /api/tasks/:taskId/cancel
 * Body: { reason?, cancelledBy? }
 *
 * Cancels a task. Clients cancel their own; admins can cancel any task.
 */
router.post("/:taskId/cancel", requireCustomerOrProvider, cancelTask);

/**
 * POST /api/tasks/:taskId/float
 *
 * Transitions a MATCHED task to FLOATING — opens it to all nearby providers.
 * The owning client or admin may call this.
 */
router.post("/:taskId/float", requireCustomer, makeTaskFloating);

/**
 * POST /api/tasks/:taskId/convert
 * Body: { bookingId }
 *
 * Admin endpoint to reconcile drift — marks a task CONVERTED and links it to a booking.
 * In normal flow this is called internally by BookingService.
 * Admin only.
 */
router.post("/:taskId/convert", requireAdmin, convertToBooking);

/**
 * POST /api/tasks/:taskId/expire
 *
 * Marks a single task as EXPIRED. Admin/ops action for individual expiry.
 * Bulk expiry uses POST /admin/expire-overdue.
 * Admin only.
 */
router.post("/:taskId/expire", requireAdmin, expireTask);

/**
 * POST /api/tasks/:taskId/restore
 *
 * Restores a soft-deleted task. Admin only.
 */
router.post("/:taskId/restore", requireAdmin, restoreTask);

// ─── Matching Routes ──────────────────────────────────────────────────────────

/**
 * POST /api/tasks/:taskId/match
 * Query: strategy? ("intelligent" | "location-only")
 *
 * Manually re-triggers provider matching.
 * Only valid for PENDING, MATCHED, or FLOATING tasks.
 */
router.post("/:taskId/match", requireCustomerOrProvider, triggerMatching);

/**
 * GET /api/tasks/:taskId/matched-providers
 *
 * Returns the matched provider list with populated ProviderProfile documents.
 * Accessible to the owning client and admins.
 */
router.get(
  "/:taskId/matched-providers",
  requireCustomerOrProvider,
  getMatchedProviders,
);

/**
 * GET /api/tasks/:taskId/interested-providers
 *
 * Returns providers who have expressed interest in the task.
 * Only the owning client and admins should access this.
 */
router.get(
  "/:taskId/interested-providers",
  requireCustomer,
  getInterestedProviders,
);

// ─── Provider Interaction Routes ──────────────────────────────────────────────

/**
 * POST /api/tasks/:taskId/interest
 * Body: { message? }
 *
 * Provider expresses interest in a FLOATING or MATCHED task.
 * Idempotent — duplicate interest entries are rejected at the model layer.
 */
router.post("/:taskId/interest", requireProvider, expressProviderInterest);

/**
 * DELETE /api/tasks/:taskId/interest
 *
 * Provider withdraws previously expressed interest.
 */
router.delete("/:taskId/interest", requireProvider, withdrawProviderInterest);

/**
 * POST /api/tasks/:taskId/request-provider
 * Body: { providerId, message? }
 *
 * Client selects a specific provider for their task → task transitions to REQUESTED.
 * The provider can be anyone active — not limited to the matchedProviders list.
 * Customer role required (owning client only).
 */
router.post("/:taskId/request-provider", requireCustomer, requestProvider);

/**
 * POST /api/tasks/:taskId/respond
 * Body: { action: "accept" | "reject", message? }
 *
 * Provider accepts or rejects a REQUESTED task directed at them.
 * accept → ACCEPTED | reject → FLOATING (reverts so client can re-select)
 * Provider role required.
 */
router.post("/:taskId/respond", requireProvider, providerRespondToTask);

export default router;
