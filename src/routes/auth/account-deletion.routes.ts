import { Router } from "express";
import {
  requestDeletion,
  cancelDeletion,
  getDeletionStatus,
  getAdminReviewQueue,
  retryDeletion,
} from "../../controllers/auth/account-deletion.controller";
import {
  authenticateToken,
  requireAdmin,
  requireSuperAdmin,
} from "../../middleware/auth/auth.middleware";

const router = Router();

// ─── User routes ──────────────────────────────────────────────────────────────

// Request deletion — enters grace period
router.post("/",        authenticateToken, requestDeletion);

// Cancel while still in grace period
router.delete("/",      authenticateToken, cancelDeletion);

// Check current deletion event status
router.get("/status",   authenticateToken, getDeletionStatus);

// ─── Admin routes ─────────────────────────────────────────────────────────────

// View failed deletions that need manual review
router.get("/admin/review",              authenticateToken, requireAdmin,      getAdminReviewQueue);

// Manually retry a failed deletion pipeline
router.post("/admin/:eventId/retry",     authenticateToken, requireSuperAdmin,  retryDeletion);

export default router;