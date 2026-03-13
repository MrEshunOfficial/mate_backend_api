// routes/category.routes.ts
import { Router } from "express";
import { CategoryController } from "../../../controllers/services/service.categories/service.category.controller";
import { authenticateToken, requireAdmin } from "../../../middleware/auth/auth.middleware";

const router = Router();
const categoryController = new CategoryController();

/**
 * Category Routes
 *
 * Public routes (no authentication required):
 * - Browsing and viewing published categories
 * - Search and tag filtering
 * - Hierarchy and structure
 *
 * Admin routes (authentication + admin role required):
 * - All write operations (create, update, delete, restore)
 * - Utility and diagnostic endpoints
 * - Slug availability checks (prevents enumeration by unauthenticated clients)
 * - Category existence checks
 * - Statistics (exposes internal counts including soft-deleted records)
 * - Image status (debugging tool — not for public consumption)
 */

// ============================================================================
// PUBLIC ROUTES (No authentication required)
// ============================================================================

// Search and filtering — before parameterized routes to avoid /:id capture
router.get("/search", categoryController.searchCategories);
router.get("/tags", categoryController.getAllTags);
router.get("/tag/:tag", categoryController.getCategoriesByTag);

// Hierarchy and structure
router.get("/hierarchy", categoryController.getCategoryHierarchy);
router.get("/top-level", categoryController.getTopLevelCategories);
router.get("/active", categoryController.getActiveCategories);

// Slug lookup — public read only (not availability check)
router.get("/slug/:slug", categoryController.getCategoryBySlug);

// Public category viewing — by ID
router.get("/:id", categoryController.getCategoryById);
router.get("/:id/complete", categoryController.getCompleteCategory);
router.get("/:id/subcategories", categoryController.getSubcategories);

// ============================================================================
// ADMIN ROUTES (Authentication + admin role required)
// ============================================================================

// Statistics — exposes total, inactive, and soft-deleted counts
router.get(
  "/stats",
  authenticateToken,
  requireAdmin,
  categoryController.getCategoryStats
);

// Slug availability — prevents unauthenticated enumeration
router.get(
  "/slug/:slug/available",
  authenticateToken,
  requireAdmin,
  categoryController.checkSlugAvailability
);

// All categories including soft-deleted
router.get(
  "/admin/all",
  authenticateToken,
  requireAdmin,
  categoryController.getAllCategories
);

// Create category
router.post(
  "/new",
  authenticateToken,
  requireAdmin,
  categoryController.createCategory
);

// Bulk operations
router.put(
  "/bulk-update",
  authenticateToken,
  requireAdmin,
  categoryController.bulkUpdateCategories
);

// Repair operations
router.post(
  "/repair-cover-links",
  authenticateToken,
  requireAdmin,
  categoryController.repairCoverLinks
);

// Existence check — utility, not needed by public clients
router.get(
  "/:id/exists",
  authenticateToken,
  requireAdmin,
  categoryController.checkCategoryExists
);

// Image status — debugging tool, not for public consumption
router.get(
  "/:id/image-status",
  authenticateToken,
  requireAdmin,
  categoryController.getCategoryImageStatus
);

// Update category
router.put(
  "/:id",
  authenticateToken,
  requireAdmin,
  categoryController.updateCategory
);

// Soft delete
router.delete(
  "/:id",
  authenticateToken,
  requireAdmin,
  categoryController.deleteCategory
);

// Restore soft-deleted category
router.post(
  "/:id/restore",
  authenticateToken,
  requireAdmin,
  categoryController.restoreCategory
);

// Hard delete
router.delete(
  "/:id/permanent",
  authenticateToken,
  requireAdmin,
  categoryController.permanentlyDeleteCategory
);

// Cover image
router.put(
  "/:id/cover-image",
  authenticateToken,
  requireAdmin,
  categoryController.updateCoverImage
);

// Toggle active status
router.patch(
  "/:id/toggle-active",
  authenticateToken,
  requireAdmin,
  categoryController.toggleActiveStatus
);

export default router;