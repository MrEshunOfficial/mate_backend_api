import { Router } from "express";
import {
  // CRUD
  createService,
  updateService,
  deleteService,
  togglePrivateStatus,
  updateCoverImage,
  removeCoverImage,
  bulkUpdateServices,

  // Retrieval
  getServiceById,
  getServiceBySlug,
  getActiveServices,
  getServicesByProvider,
  getServicesByCategory,
  searchServices,
  getCompleteService,
  getAutoActivationStatus,
  serviceExists,
  isSlugAvailable,

  // Admin
  getAllServices,
  getPendingServices,
  approveService,
  rejectService,
  processScheduledActivations,
  restoreService,
  permanentlyDeleteService,
  getServiceStats,
} from "../../controllers/services/service.controller";

import {   requireAdmin,
  requireSuperAdmin,
  requireVerification, authenticateToken } from "../../middleware/auth/auth.middleware";

const router = Router();

// ─── Admin Sub-Router ─────────────────────────────────────────────────────────
//
// Mounted before parameterised /:id routes so Express does not treat
// the literal segment "admin" as a MongoDB ObjectId.

const adminRouter = Router();
router.use("/admin", authenticateToken, requireAdmin, adminRouter);

// ── Listing & Stats ──────────────────────────────────────────────────────────
adminRouter.get("/all",     getAllServices);      // GET  /services/admin/all?page&limit&includeDeleted
adminRouter.get("/pending", getPendingServices);  // GET  /services/admin/pending?page&limit
adminRouter.get("/stats",   getServiceStats);     // GET  /services/admin/stats?providerId

// ── Scheduled Activation (manual trigger / debug) ────────────────────────────
adminRouter.post("/process-activations", processScheduledActivations); // POST /services/admin/process-activations

// ── Bulk Update ───────────────────────────────────────────────────────────────
adminRouter.patch("/bulk", bulkUpdateServices); // PATCH /services/admin/bulk

// ── Per-service Moderation ────────────────────────────────────────────────────
adminRouter.post("/:id/approve", approveService);   // POST /services/admin/:id/approve
adminRouter.post("/:id/reject",  rejectService);    // POST /services/admin/:id/reject  — body: { reason }
adminRouter.post("/:id/restore", restoreService);   // POST /services/admin/:id/restore
adminRouter.delete(
  "/:id/permanent",
  requireSuperAdmin,
  permanentlyDeleteService                          // DELETE /services/admin/:id/permanent
);

// ─── Static / Named Public Routes ─────────────────────────────────────────────
//
// Registered before /:id so Express does not greedily consume these
// literal path segments as ObjectId parameters.

router.get("/search",             searchServices);        // GET /services/search?q=...
router.get("/slug/:slug",         getServiceBySlug);      // GET /services/slug/:slug?details=true
router.get("/category/:categoryId", getServicesByCategory); // GET /services/category/:categoryId?page&limit
router.get("/check/exists/:id",   serviceExists);         // GET /services/check/exists/:id
router.get("/check/slug",         isSlugAvailable);       // GET /services/check/slug?slug=...&excludeId=

// ─── Authenticated Routes ─────────────────────────────────────────────────────

router.get(
  "/provider/:providerId",
  authenticateToken,
  getServicesByProvider               // GET /services/provider/:providerId?includeInactive&page&limit
);

router.post(
  "/",
  authenticateToken,
  requireVerification,
  createService                       // POST /services
);

router.put(
  "/:id",
  authenticateToken,
  requireVerification,
  updateService                       // PUT /services/:id
);

router.delete(
  "/:id",
  authenticateToken,
  deleteService                       // DELETE /services/:id  (soft delete)
);

router.patch(
  "/:id/privacy",
  authenticateToken,
  togglePrivateStatus                 // PATCH /services/:id/privacy
);

router.patch(
  "/:id/cover",
  authenticateToken,
  updateCoverImage                    // PATCH /services/:id/cover  — body: { coverImageId }
);

router.delete(
  "/:id/cover",
  authenticateToken,
  removeCoverImage                    // DELETE /services/:id/cover
);

router.get(
  "/:id/activation-status",
  authenticateToken,
  getAutoActivationStatus             // GET /services/:id/activation-status
);

// ─── Parameterised Public Routes ──────────────────────────────────────────────
//
// Kept last so named routes above take precedence.

router.get("/",            getActiveServices);  // GET /services?page&limit
router.get("/:id",         getServiceById);     // GET /services/:id?details=true
router.get("/:id/details", getCompleteService); // GET /services/:id/details


export default router;