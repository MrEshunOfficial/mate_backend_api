// controllers/handlers/crud.handler.ts
import { RequestHandler } from "express";
import { CategoryService } from "../../../../service/services/service.category.service";
import { VerifiedRequest } from "../../../../types/user.types";
import { handleError, getParam, validateObjectId } from "../../../../utils/auth/auth.controller.utils";

/**
 * Category CRUD Handler
 *
 * Handles Create, Update, and Delete operations for categories.
 *
 * All methods are typed as RequestHandler for Express router compatibility.
 * On protected routes, req is cast to VerifiedRequest internally — auth
 * middleware upstream guarantees userId and user are populated before the
 * handler is reached.
 */
export class CategoryCRUDHandler {
  private categoryService: CategoryService;

  constructor() {
    this.categoryService = new CategoryService();
  }

  /**
   * Create a new category
   * POST /api/categories
   */
  createCategory: RequestHandler = async (req, res) => {
    try {
      const { userId } = req as VerifiedRequest;
      const categoryData = req.body;

      if (!categoryData.catName?.trim()) {
        return res.status(400).json({
          success: false,
          message: "Category name is required",
        });
      }

      if (!categoryData.catDesc?.trim()) {
        return res.status(400).json({
          success: false,
          message: "Category description is required",
        });
      }

      const category = await this.categoryService.createCategory(
        categoryData,
        userId
      );

      return res.status(201).json({
        success: true,
        message: "Category created successfully",
        data: category,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) {
        return res.status(409).json({
          success: false,
          message: error.message,
        });
      }
      return handleError(res, error, "Failed to create category");
    }
  };

  /**
   * Update category
   * PUT /api/categories/:id
   */
  updateCategory: RequestHandler = async (req, res) => {
    try {
      const { userId } = req as VerifiedRequest;
      const id = getParam(req.params.id);
      const updates = req.body;

      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid category ID",
        });
      }

      // Remove protected fields
      delete updates._id;
      delete updates.createdAt;
      delete updates.createdBy;
      delete updates.deletedAt;
      delete updates.deletedBy;
      delete updates.isDeleted;

      const category = await this.categoryService.updateCategory(
        id,
        updates,
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
        message: "Category updated successfully",
        data: category,
      });
    } catch (error) {
      return handleError(res, error, "Failed to update category");
    }
  };

  /**
   * Update category cover image
   * PUT /api/categories/:id/cover-image
   */
  updateCoverImage: RequestHandler = async (req, res) => {
    try {
      const { userId } = req as VerifiedRequest;
      const id = getParam(req.params.id);
      const { catCoverId } = req.body;

      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid category ID",
        });
      }

      if (catCoverId && !validateObjectId(catCoverId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid cover image ID",
        });
      }

      const category = await this.categoryService.updateCoverImageId(
        id,
        catCoverId || null,
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
        message: "Cover image updated successfully",
        data: category,
      });
    } catch (error) {
      return handleError(res, error, "Failed to update cover image");
    }
  };

  /**
   * Soft delete category
   * DELETE /api/categories/:id
   */
  deleteCategory: RequestHandler = async (req, res) => {
    try {
      const { userId } = req as VerifiedRequest;
      const id = getParam(req.params.id);

      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid category ID",
        });
      }

      await this.categoryService.deleteCategory(id, userId);

      return res.status(200).json({
        success: true,
        message: "Category deleted successfully",
      });
    } catch (error) {
      return handleError(res, error, "Failed to delete category");
    }
  };

  /**
   * Restore soft deleted category
   * POST /api/categories/:id/restore
   */
  restoreCategory: RequestHandler = async (req, res) => {
    try {
      const id = getParam(req.params.id);

      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid category ID",
        });
      }

      const category = await this.categoryService.restoreCategory(id);

      if (!category) {
        return res.status(404).json({
          success: false,
          message: "Deleted category not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Category restored successfully",
        data: category,
      });
    } catch (error) {
      return handleError(res, error, "Failed to restore category");
    }
  };

  /**
   * Permanently delete category (hard delete)
   * DELETE /api/categories/:id/permanent
   */
  permanentlyDeleteCategory: RequestHandler = async (req, res) => {
    try {
      const id = getParam(req.params.id);

      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid category ID",
        });
      }

      await this.categoryService.permanentlyDeleteCategory(id);

      return res.status(200).json({
        success: true,
        message: "Category permanently deleted",
      });
    } catch (error) {
      return handleError(res, error, "Failed to permanently delete category");
    }
  };
}