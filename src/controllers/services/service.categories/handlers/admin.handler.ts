// controllers/handlers/admin.handler.ts
import { RequestHandler } from "express";
import { CategoryService } from "../../../../service/services/service.category.service";
import { VerifiedRequest } from "../../../../types/user.types";
import { handleError, getParam, validateObjectId } from "../../../../utils/auth/auth.controller.utils";

/**
 * Category Admin Handler
 *
 * Handles administrative operations for categories.
 *
 * All methods are typed as RequestHandler for Express router compatibility.
 * On mutating routes, req is cast to VerifiedRequest internally — auth
 * middleware upstream guarantees userId is populated before the handler runs.
 */
export class CategoryAdminHandler {
  private categoryService: CategoryService;

  constructor() {
    this.categoryService = new CategoryService();
  }

  /**
   * Get all categories (admin function)
   * GET /api/categories/admin/all
   */
  getAllCategories: RequestHandler = async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const skip = parseInt(req.query.skip as string) || 0;
      const includeDeleted = req.query.includeDeleted === "true";

      const result = await this.categoryService.getAllCategories(
        limit,
        skip,
        includeDeleted
      );

      return res.status(200).json({
        success: true,
        data: result.categories,
        pagination: {
          total: result.total,
          limit,
          skip,
          hasMore: result.hasMore,
        },
      });
    } catch (error) {
      return handleError(res, error, "Failed to get all categories");
    }
  };

  /**
   * Get category statistics
   * GET /api/categories/stats
   */
  getCategoryStats: RequestHandler = async (req, res) => {
    try {
      const { categoryId } = req.query;

      const stats = await this.categoryService.getCategoryStats(
        categoryId as string
      );

      return res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      return handleError(res, error, "Failed to get category statistics");
    }
  };

  /**
   * Check if category exists
   * GET /api/categories/:id/exists
   */
  checkCategoryExists: RequestHandler = async (req, res) => {
    try {
      const id = getParam(req.params.id);

      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid category ID",
        });
      }

      const exists = await this.categoryService.categoryExists(id);

      return res.status(200).json({
        success: true,
        data: { exists },
      });
    } catch (error) {
      return handleError(res, error, "Failed to check category existence");
    }
  };

  /**
   * Check if slug is available
   * GET /api/categories/slug/:slug/available
   */
  checkSlugAvailability: RequestHandler = async (req, res) => {
    try {
      const slug = getParam(req.params.slug);
      const { excludeCategoryId } = req.query;

      if (!slug) {
        return res.status(400).json({
          success: false,
          message: "Slug is required",
        });
      }

      const isAvailable = await this.categoryService.isSlugAvailable(
        slug,
        excludeCategoryId as string
      );

      return res.status(200).json({
        success: true,
        data: { available: isAvailable },
      });
    } catch (error) {
      return handleError(res, error, "Failed to check slug availability");
    }
  };

  /**
   * Get category image status (debugging tool)
   * GET /api/categories/:id/image-status
   */
  getCategoryImageStatus: RequestHandler = async (req, res) => {
    try {
      const id = getParam(req.params.id);

      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid category ID",
        });
      }

      const status = await this.categoryService.getCategoryImageStatus(id);

      return res.status(200).json({
        success: true,
        data: status,
      });
    } catch (error) {
      return handleError(res, error, "Failed to get image status");
    }
  };

  /**
   * Repair broken category cover image links
   * POST /api/categories/repair-cover-links
   */
  repairCoverLinks: RequestHandler = async (req, res) => {
    try {
      const { categoryId } = req.body;

      if (categoryId && !validateObjectId(categoryId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid category ID",
        });
      }

      const result = await this.categoryService.repairCategoryCoverLinks(
        categoryId
      );

      return res.status(200).json({
        success: true,
        message: "Cover image links repaired successfully",
        data: result,
      });
    } catch (error) {
      return handleError(res, error, "Failed to repair cover links");
    }
  };

  /**
   * Bulk update categories
   * PUT /api/categories/bulk-update
   */
  bulkUpdateCategories: RequestHandler = async (req, res) => {
    try {
      const { userId } = req as VerifiedRequest;
      const { categoryIds, updates } = req.body;

      if (!categoryIds || !Array.isArray(categoryIds)) {
        return res.status(400).json({
          success: false,
          message: "Category IDs array is required",
        });
      }

      if (!updates || typeof updates !== "object") {
        return res.status(400).json({
          success: false,
          message: "Updates object is required",
        });
      }

      const invalidIds = categoryIds.filter((id: string) => !validateObjectId(id));
      if (invalidIds.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid category IDs found",
          data: { invalidIds },
        });
      }

      const result = await this.categoryService.bulkUpdateCategories(
        categoryIds,
        updates,
        userId
      );

      return res.status(200).json({
        success: true,
        message: `${result.modifiedCount} categories updated successfully`,
        data: result,
      });
    } catch (error) {
      return handleError(res, error, "Failed to bulk update categories");
    }
  };

  /**
   * Toggle category active status
   * PATCH /api/categories/:id/toggle-active
   */
  toggleActiveStatus: RequestHandler = async (req, res) => {
    try {
      const { userId } = req as VerifiedRequest;
      const id = getParam(req.params.id);

      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid category ID",
        });
      }

      const category = await this.categoryService.toggleActiveStatus(
        id,
        userId
      );

      if (!category) {
        return res.status(404).json({
          success: false,
          message: "Category not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: `Category ${
          category.isActive ? "activated" : "deactivated"
        } successfully`,
        data: category,
      });
    } catch (error) {
      return handleError(res, error, "Failed to toggle category status");
    }
  };
}