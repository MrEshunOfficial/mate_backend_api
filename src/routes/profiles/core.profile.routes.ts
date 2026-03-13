// routes/profiles/userProfile.route.ts
import { Router } from "express";
import {
  // CRUD
  createProfile,
  updateMyProfile,
  updateProfileById,
  deleteMyProfile,
  restoreMyProfile,
  permanentlyDeleteProfile,
  // Retrieval
  getMyProfile,
  getCompleteProfile,
  getProfileByUserId,
  getProfileById,
  searchProfiles,
  getProfilesByUserIds,
  getMyProfileStats,
  // Admin
  getAllProfiles,
  checkProfileExists,
  bulkUpdateProfiles,
  // Role Transition
  validateTransition,
  executeTransition,
  getTransitionHistory,
}  from "../../controllers/profiles/base.user/base.user.controller";
import { authenticateToken, requireAdmin } from "../../middleware/auth/auth.middleware";

const router = Router();

/**
 * Public/User Routes
 * These routes require authentication but are accessible to all authenticated users
 */

// Check if profile exists for current user
router.get("/exists", authenticateToken, checkProfileExists);

// Get current user's profile
router.get("/me", authenticateToken, getMyProfile);

// Get complete profile with picture details
router.get("/me/complete", authenticateToken, getCompleteProfile);

// Get current user's profile statistics
router.get("/me/stats", authenticateToken, getMyProfileStats);

// Create a new profile for current user
router.post("/", authenticateToken, createProfile);

// Update current user's profile
router.patch("/me", authenticateToken, updateMyProfile);

// Soft delete current user's profile
router.delete("/me", authenticateToken, deleteMyProfile);

// Restore current user's soft deleted profile
router.post("/me/restore", authenticateToken, restoreMyProfile);

// Search profiles by bio (authenticated users only)
router.get("/search", authenticateToken, searchProfiles);

// Get multiple profiles by user IDs (batch operation)
router.post("/batch", authenticateToken, getProfilesByUserIds);

/**
 * Role Transition Routes
 * Authenticated users only — dry-run validate before executing
 */

// Dry-run: check eligibility without committing any changes
// GET /api/profiles/role-transition/validate?toRole=customer
router.get("/role-transition/validate", authenticateToken, validateTransition);

// Execute the role transition (requires acknowledgedDataHandling: true in body)
// POST /api/profiles/role-transition
router.post("/role-transition", authenticateToken, executeTransition);

// Get current user's role transition history
// GET /api/profiles/role-transition/history
router.get("/role-transition/history", authenticateToken, getTransitionHistory);

/**
 * Admin Routes
 * These routes require admin or super admin privileges
 * Note: requireAdmin checks for both isAdmin and isSuperAdmin
 */

// Get all profiles with pagination (admin only)
router.get("/", authenticateToken, requireAdmin, getAllProfiles);

// Bulk update profiles (admin only)
router.patch("/bulk", authenticateToken, requireAdmin, bulkUpdateProfiles);

// Get profile by user ID (admin only)
router.get("/user/:userId", authenticateToken, requireAdmin, getProfileByUserId);

// Get profile by profile ID (admin only)
router.get("/:profileId", authenticateToken, requireAdmin, getProfileById);

// Update profile by profile ID (admin only)
router.patch("/:profileId", authenticateToken, requireAdmin, updateProfileById);

// Permanently delete profile (admin only)
router.delete("/:userId/permanent", authenticateToken, requireAdmin, permanentlyDeleteProfile);

export default router;