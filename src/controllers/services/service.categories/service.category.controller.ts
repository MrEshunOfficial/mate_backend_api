// controllers/category.controller.ts

import { CategoryAdminHandler } from "./handlers/admin.handler";
import { CategoryCRUDHandler } from "./handlers/crud.handler";
import { CategoryRetrievalHandler } from "./handlers/retrieval.handler";

/**
 * Category Controller
 *
 * Handles HTTP requests for category management endpoints.
 * Delegates to specialized handler classes for better organization.
 */
export class CategoryController {
  private crudHandler: CategoryCRUDHandler;
  private retrievalHandler: CategoryRetrievalHandler;
  private adminHandler: CategoryAdminHandler;

  // CRUD Operations
  public createCategory;
  public updateCategory;
  public updateCoverImage;
  public deleteCategory;
  public restoreCategory;
  public permanentlyDeleteCategory;

  // Retrieval Operations
  public getCategoryById;
  public getCategoryBySlug;
  public getCompleteCategory;
  public getActiveCategories;
  public getTopLevelCategories;
  public getSubcategories;
  public getCategoryHierarchy;
  public searchCategories;
  public getCategoriesByTag;
  public getAllTags;

  // Admin Operations
  public getAllCategories;
  public getCategoryStats;
  public checkCategoryExists;
  public checkSlugAvailability;
  public getCategoryImageStatus;
  public repairCoverLinks;
  public bulkUpdateCategories;
  public toggleActiveStatus;

  constructor() {
    this.crudHandler = new CategoryCRUDHandler();
    this.retrievalHandler = new CategoryRetrievalHandler();
    this.adminHandler = new CategoryAdminHandler();

    // Bind CRUD handlers
    this.createCategory = this.crudHandler.createCategory.bind(
      this.crudHandler
    );
    this.updateCategory = this.crudHandler.updateCategory.bind(
      this.crudHandler
    );
    this.updateCoverImage = this.crudHandler.updateCoverImage.bind(
      this.crudHandler
    );
    this.deleteCategory = this.crudHandler.deleteCategory.bind(
      this.crudHandler
    );
    this.restoreCategory = this.crudHandler.restoreCategory.bind(
      this.crudHandler
    );
    this.permanentlyDeleteCategory =
      this.crudHandler.permanentlyDeleteCategory.bind(this.crudHandler);

    // Bind retrieval handlers
    this.getCategoryById = this.retrievalHandler.getCategoryById.bind(
      this.retrievalHandler
    );
    this.getCategoryBySlug = this.retrievalHandler.getCategoryBySlug.bind(
      this.retrievalHandler
    );
    this.getCompleteCategory = this.retrievalHandler.getCompleteCategory.bind(
      this.retrievalHandler
    );
    this.getActiveCategories = this.retrievalHandler.getActiveCategories.bind(
      this.retrievalHandler
    );
    this.getTopLevelCategories =
      this.retrievalHandler.getTopLevelCategories.bind(this.retrievalHandler);
    this.getSubcategories = this.retrievalHandler.getSubcategories.bind(
      this.retrievalHandler
    );
    this.getCategoryHierarchy = this.retrievalHandler.getCategoryHierarchy.bind(
      this.retrievalHandler
    );
    this.searchCategories = this.retrievalHandler.searchCategories.bind(
      this.retrievalHandler
    );
    this.getCategoriesByTag = this.retrievalHandler.getCategoriesByTag.bind(
      this.retrievalHandler
    );
    this.getAllTags = this.retrievalHandler.getAllTags.bind(
      this.retrievalHandler
    );

    // Bind admin handlers
    this.getAllCategories = this.adminHandler.getAllCategories.bind(
      this.adminHandler
    );
    this.getCategoryStats = this.adminHandler.getCategoryStats.bind(
      this.adminHandler
    );
    this.checkCategoryExists = this.adminHandler.checkCategoryExists.bind(
      this.adminHandler
    );
    this.checkSlugAvailability = this.adminHandler.checkSlugAvailability.bind(
      this.adminHandler
    );
    this.getCategoryImageStatus = this.adminHandler.getCategoryImageStatus.bind(
      this.adminHandler
    );
    this.repairCoverLinks = this.adminHandler.repairCoverLinks.bind(
      this.adminHandler
    );
    this.bulkUpdateCategories = this.adminHandler.bulkUpdateCategories.bind(
      this.adminHandler
    );
    this.toggleActiveStatus = this.adminHandler.toggleActiveStatus.bind(
      this.adminHandler
    );
  }
}

// Create and export a singleton instance
const categoryController = new CategoryController();

// Export individual handlers for use in routes
export const {
  // CRUD Operations
  createCategory,
  updateCategory,
  updateCoverImage,
  deleteCategory,
  restoreCategory,
  permanentlyDeleteCategory,

  // Retrieval Operations
  getCategoryById,
  getCategoryBySlug,
  getCompleteCategory,
  getActiveCategories,
  getTopLevelCategories,
  getSubcategories,
  getCategoryHierarchy,
  searchCategories,
  getCategoriesByTag,
  getAllTags,

  // Admin Operations
  getAllCategories,
  getCategoryStats,
  checkCategoryExists,
  checkSlugAvailability,
  getCategoryImageStatus,
  repairCoverLinks,
  bulkUpdateCategories,
  toggleActiveStatus,
} = categoryController;