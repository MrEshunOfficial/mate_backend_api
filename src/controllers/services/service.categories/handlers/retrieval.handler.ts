// controllers/handlers/retrieval.handler.ts
import { RequestHandler } from "express";
import { CategoryService } from "../../../../service/services/service.category.service";
import { getParam, validateObjectId, handleError } from "../../../../utils/auth/auth.controller.utils";

/**
 * Category Retrieval Handler
 *
 * Handles read-only operations and queries for categories.
 * All endpoints are public — no authentication required.
 * All methods are typed as RequestHandler for Express router compatibility.
 */
export class CategoryRetrievalHandler {
  private categoryService: CategoryService;

  constructor() {
    this.categoryService = new CategoryService();
  }

  /**
   * Get category by ID
   * GET /api/categories/:id
   */
  getCategoryById: RequestHandler = async (req, res) => {
    try {
      const id = getParam(req.params.id);
      const includeDetails = req.query.includeDetails === "true";

      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid category ID",
        });
      }

      const category = await this.categoryService.getCategoryById(
        id,
        includeDetails
      );

      if (!category) {
        return res.status(404).json({
          success: false,
          message: "Category not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: category,
      });
    } catch (error) {
      return handleError(res, error, "Failed to get category");
    }
  };

  /**
   * Get category by slug
   * GET /api/categories/slug/:slug
   */
  getCategoryBySlug: RequestHandler = async (req, res) => {
    try {
      const slug = getParam(req.params.slug);
      const includeDetails = req.query.includeDetails === "true";

      if (!slug) {
        return res.status(400).json({
          success: false,
          message: "Slug is required",
        });
      }

      const category = await this.categoryService.getCategoryBySlug(
        slug,
        includeDetails
      );

      if (!category) {
        return res.status(404).json({
          success: false,
          message: "Category not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: category,
      });
    } catch (error) {
      return handleError(res, error, "Failed to get category");
    }
  };

  /**
   * Get complete category details including cover image URL
   * GET /api/categories/:id/complete
   */
  getCompleteCategory: RequestHandler = async (req, res) => {
    try {
      const id = getParam(req.params.id);

      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid category ID",
        });
      }

      const result = await this.categoryService.getCompleteCategory(id);

      if (!result.category) {
        return res.status(404).json({
          success: false,
          message: "Category not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      return handleError(res, error, "Failed to get complete category");
    }
  };

  /**
   * Get all active categories
   * GET /api/categories/active
   */
  getActiveCategories: RequestHandler = async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const skip = parseInt(req.query.skip as string) || 0;

      const result = await this.categoryService.getActiveCategories(
        limit,
        skip
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
      return handleError(res, error, "Failed to get active categories");
    }
  };

  /**
   * Get top-level categories (no parent)
   * GET /api/categories/top-level
   */
  getTopLevelCategories: RequestHandler = async (req, res) => {
    try {
      const includeSubcategories = req.query.includeSubcategories === "true";

      const categories = await this.categoryService.getTopLevelCategories(
        includeSubcategories
      );

      return res.status(200).json({
        success: true,
        data: categories,
      });
    } catch (error) {
      return handleError(res, error, "Failed to get top-level categories");
    }
  };

  /**
   * Get subcategories of a parent category
   * GET /api/categories/:id/subcategories
   */
  getSubcategories: RequestHandler = async (req, res) => {
    try {
      const id = getParam(req.params.id);

      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid category ID",
        });
      }

      const subcategories = await this.categoryService.getSubcategories(id);

      return res.status(200).json({
        success: true,
        data: subcategories,
      });
    } catch (error) {
      return handleError(res, error, "Failed to get subcategories");
    }
  };

  /**
   * Get category hierarchy (full tree structure)
   * GET /api/categories/hierarchy
   */
  getCategoryHierarchy: RequestHandler = async (_req, res) => {
    try {
      const hierarchy = await this.categoryService.getCategoryHierarchy();

      return res.status(200).json({
        success: true,
        data: hierarchy,
      });
    } catch (error) {
      return handleError(res, error, "Failed to get category hierarchy");
    }
  };

  /**
   * Search categories
   * GET /api/categories/search
   */
  searchCategories: RequestHandler = async (req, res) => {
    try {
      const { q, limit, skip, activeOnly } = req.query;

      if (!q || typeof q !== "string") {
        return res.status(400).json({
          success: false,
          message: "Search query is required",
        });
      }

      const limitNum = parseInt(limit as string) || 20;
      const skipNum = parseInt(skip as string) || 0;
      const activeOnlyBool = activeOnly !== "false";

      const result = await this.categoryService.searchCategories(
        q,
        limitNum,
        skipNum,
        activeOnlyBool
      );

      return res.status(200).json({
        success: true,
        data: result.categories,
        pagination: {
          total: result.total,
          limit: limitNum,
          skip: skipNum,
          hasMore: result.hasMore,
        },
      });
    } catch (error) {
      return handleError(res, error, "Failed to search categories");
    }
  };

  /**
   * Get categories by tag
   * GET /api/categories/tag/:tag
   */
  getCategoriesByTag: RequestHandler = async (req, res) => {
    try {
      const tag = getParam(req.params.tag);
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = parseInt(req.query.skip as string) || 0;

      if (!tag) {
        return res.status(400).json({
          success: false,
          message: "Tag is required",
        });
      }

      const result = await this.categoryService.getCategoriesByTag(
        tag,
        limit,
        skip
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
      return handleError(res, error, "Failed to get categories by tag");
    }
  };

  /**
   * Get all unique tags
   * GET /api/categories/tags
   */
  getAllTags: RequestHandler = async (_req, res) => {
    try {
      const tags = await this.categoryService.getAllTags();

      return res.status(200).json({
        success: true,
        data: tags,
      });
    } catch (error) {
      return handleError(res, error, "Failed to get tags");
    }
  };
}