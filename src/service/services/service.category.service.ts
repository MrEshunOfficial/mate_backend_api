// services/category.service.ts
import { Types } from "mongoose";
import { CategoryModel } from "../../models/service/categoryModel";
import { Category, CategoryDocument, CategoryObject } from "../../types/category.types";
import { MongoDBFileService } from "../files/mongodb.file.service";
import { FileEntityType } from "../../types/file.types";
import FileModel from "../../models/fileModel";
import { categoryCoverConfig } from "../../controllers/files/config/categoryCover.config";

// FIX: ImageLinkingService removed.
//
// It was used in two ways here, both broken:
//
//   1. The orphan query in createCategory used `entityId: { $exists: false }`.
//      If the file schema defines entityId with a default of null, the field
//      is present on every document as null and $exists: false never matches.
//      This is why the first category never linked its cover.
//
//   2. Both createCategory and updateCategory spread `...categoryData` /
//      `...updates` directly into the Mongoose call. If catCoverId was in the
//      body this set catCoverId on the category document, but the file record's
//      entityId was never stamped. getFilesByEntity(CATEGORY, categoryId) then
//      returned nothing for that category, silently breaking every subsequent
//      file operation (archive, restore, stats, optimized).
//
// The fix: strip catCoverId out of every Mongoose spread and route all cover
// linking exclusively through categoryCoverConfig.linkFileToCreatedEntity,
// which atomically stamps entityId on the file record AND sets catCoverId on
// the category document in one place.

export class CategoryService {
  private fileService: MongoDBFileService;

  constructor() {
    this.fileService = new MongoDBFileService();
  }

  /**
   * Create a new category.
   *
   * Cover image linking:
   *
   *   Case A — catCoverId provided in body (upload happened first, caller has fileId):
   *     linkFileToCreatedEntity stamps entityId on the file record and sets
   *     catCoverId on the category document.
   *
   *   Case B — no catCoverId in body (category created before upload, or orphan upload):
   *     We search for the most recent file uploaded by this user that has
   *     entityType:"category", label:"category_cover", and no entityId yet.
   *     We query for BOTH `entityId: null` and `entityId: { $exists: false }`
   *     because the schema may store the absent field as null or omit it entirely.
   *     If found, linkFileToCreatedEntity completes the link.
   */
  async createCategory(
    categoryData: Partial<Category>,
    createdBy?: string
  ): Promise<Category> {
    try {
      const { catName, slug, parentCategoryId } = categoryData;

      if (!catName?.trim()) {
        throw new Error("Category name is required");
      }

      const trimmedName = catName.trim();

      // 1. Check for duplicate NAME (including soft-deleted ones)
      const existingByName = await CategoryModel.findOne({
        catName: {
          $regex: `^${this.escapeRegex(trimmedName)}$`,
          $options: "i",
        },
      });

      if (existingByName) {
        if (existingByName.isDeleted) {
          throw new Error(
            `A deleted category with the name "${trimmedName}" exists. Please restore it or choose a different name.`
          );
        } else {
          throw new Error(
            `A category with the name "${trimmedName}" already exists. Please choose a different name.`
          );
        }
      }

      // 2. Check for duplicate SLUG (if provided)
      if (slug) {
        const trimmedSlug = slug.trim();
        const existingBySlug = await CategoryModel.findOne({ slug: trimmedSlug });

        if (existingBySlug) {
          if (existingBySlug.isDeleted) {
            throw new Error(
              `A deleted category with slug "${trimmedSlug}" exists. Please choose a different slug.`
            );
          } else {
            throw new Error(`Category with slug "${trimmedSlug}" already exists`);
          }
        }
      }

      // 3. Validate parent category if provided
      if (parentCategoryId) {
        const parentCategory = await CategoryModel.findOne({
          _id: parentCategoryId,
          isDeleted: false,
          isActive: true,
        });

        if (!parentCategory) {
          throw new Error("Parent category not found or inactive");
        }
      }

      // 4. Create the category document.
      //    catCoverId is intentionally excluded from the spread — it is set
      //    exclusively by linkFileToCreatedEntity below so that the file record's
      //    entityId is always stamped at the same time. Spreading catCoverId
      //    directly would set catCoverId on the category without touching the
      //    file record, breaking every subsequent file operation.
      const { catCoverId: coverId, ...categoryDataWithoutCover } = categoryData;

      const category = await CategoryModel.create({
        ...categoryDataWithoutCover,
        catName: trimmedName,
        slug: slug?.trim(),
        createdBy: createdBy ? new Types.ObjectId(createdBy) : undefined,
        lastModifiedBy: createdBy ? new Types.ObjectId(createdBy) : undefined,
      });

      // 5. Link the cover image.
      if (createdBy) {
        const categoryId = category._id.toString();

        if (coverId) {
          // Case A: caller provided the fileId from a prior upload
          await categoryCoverConfig.linkFileToCreatedEntity(
            new Types.ObjectId(coverId.toString()),
            categoryId,
            createdBy,
            this.fileService
          );
        } else {
          // Case B: search for an orphaned cover uploaded by this user.
          //
          // Query for both null and absent entityId — the schema may store
          // the missing field as null (explicit default) or omit it entirely
          // (no default). $exists: false alone misses the null case.
          const orphanedCover = await FileModel.findOne({
            uploaderId: new Types.ObjectId(createdBy),
            entityType: FileEntityType.CATEGORY,
            label: "category_cover",
            $or: [{ entityId: { $exists: false } }, { entityId: null }],
            status: "active",
          }).sort({ uploadedAt: -1 }); // newest first if multiple exist

          if (orphanedCover) {
            await categoryCoverConfig.linkFileToCreatedEntity(
              orphanedCover._id,
              categoryId,
              createdBy,
              this.fileService
            );
          }
        }

        // Re-fetch so the response reflects the updated catCoverId
        const linked = await CategoryModel.findById(category._id).lean();
        return linked as Category;
      }

      return category as Category;
    } catch (error) {
      if ((error as any).code === 11000) {
        const field = Object.keys((error as any).keyPattern || {})[0];
        if (field === "catName") {
          throw new Error(
            "A category with this name already exists. Please choose a different name."
          );
        } else if (field === "slug") {
          throw new Error("Category with this slug already exists");
        }
        throw new Error("Duplicate entry detected");
      }

      throw error instanceof Error
        ? error
        : new Error("Failed to create category");
    }
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Get category by ID
   */
  async getCategoryById(
    categoryId: string,
    includeDetails: boolean = false
  ): Promise<Category | null> {
    try {
      if (!Types.ObjectId.isValid(categoryId)) {
        throw new Error("Invalid category ID");
      }

      const query = CategoryModel.findOne({
        _id: new Types.ObjectId(categoryId),
        isDeleted: false,
      });

      if (includeDetails) {
        query
          .populate("parentCategoryId", "catName slug")
          .populate("catCoverId", "url thumbnailUrl uploadedAt")
          .populate("createdBy", "email name")
          .populate("lastModifiedBy", "email name")
          .populate({
            path: "subcategories",
            select: "catName slug catDesc isActive",
          })
          .populate({
            path: "services",
            select: "title slug isActive",
            options: { limit: 10 },
          });
      }

      return (await query.lean()) as Category | null;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get category by slug
   */
  async getCategoryBySlug(
    slug: string,
    includeDetails: boolean = false
  ): Promise<Category | null> {
    try {
      const query = CategoryModel.findOne({
        slug: slug.toLowerCase(),
        isDeleted: false,
      });

      if (includeDetails) {
        query
          .populate("parentCategoryId", "catName slug")
          .populate("catCoverId", "url thumbnailUrl uploadedAt")
          .populate({
            path: "subcategories",
            select: "catName slug catDesc isActive catCoverId",
            populate: {
              path: "catCoverId",
              select: "url thumbnailUrl",
            },
          })
          .populate({
            path: "services",
            select: "title slug isActive",
            options: { limit: 10 },
          });
      }

      return (await query.lean()) as Category | null;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get all active categories
   */
  async getActiveCategories(
    limit: number = 50,
    skip: number = 0
  ): Promise<{ categories: Category[]; total: number; hasMore: boolean }> {
    try {
      const [categories, total] = await Promise.all([
        CategoryModel.findActive()
          .limit(limit)
          .skip(skip)
          .populate("catCoverId", "url thumbnailUrl")
          .populate("parentCategoryId", "catName slug")
          .sort({ catName: 1 })
          .lean(),
        CategoryModel.countDocuments({ isDeleted: false, isActive: true }),
      ]);

      return {
        categories: categories as unknown as Category[],
        total,
        hasMore: skip + categories.length < total,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get top-level categories (no parent)
   */
  async getTopLevelCategories(
    includeSubcategories: boolean = false
  ): Promise<Category[]> {
    try {
      const query = CategoryModel.findTopLevel()
        .populate("catCoverId", "url thumbnailUrl")
        .sort({ catName: 1 });

      if (includeSubcategories) {
        query.populate({
          path: "subcategories",
          select: "catName slug catDesc isActive catCoverId",
          populate: {
            path: "catCoverId",
            select: "url thumbnailUrl",
          },
        });
      }

      return (await query.lean()) as unknown as Category[];
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get subcategories of a parent category
   */
  async getSubcategories(parentCategoryId: string): Promise<Category[]> {
    try {
      if (!Types.ObjectId.isValid(parentCategoryId)) {
        throw new Error("Invalid parent category ID");
      }

      return (await CategoryModel.find({
        parentCategoryId: new Types.ObjectId(parentCategoryId),
        isDeleted: false,
        isActive: true,
      })
        .populate("catCoverId", "url thumbnailUrl")
        .sort({ catName: 1 })
        .lean()) as Category[];
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update category.
   *
   * Cover image linking:
   *   catCoverId is stripped from the Mongoose update spread for the same
   *   reason as createCategory — direct spread sets catCoverId without
   *   stamping entityId on the file record.
   *   If catCoverId is present in updates, linkFileToCreatedEntity handles both.
   */
  async updateCategory(
    categoryId: string,
    updates: Partial<Category>,
    lastModifiedBy?: string
  ): Promise<Category | null> {
    try {
      if (!Types.ObjectId.isValid(categoryId)) {
        throw new Error("Invalid category ID");
      }

      if (updates.slug) {
        const existingCategory = await CategoryModel.findOne({
          slug: updates.slug,
          _id: { $ne: new Types.ObjectId(categoryId) },
          isDeleted: false,
        });

        if (existingCategory) {
          throw new Error("Category with this slug already exists");
        }
      }

      if (updates.parentCategoryId) {
        if (updates.parentCategoryId.toString() === categoryId) {
          throw new Error("Category cannot be its own parent");
        }

        const parentCategory = await CategoryModel.findOne({
          _id: updates.parentCategoryId,
          isDeleted: false,
          isActive: true,
        });

        if (!parentCategory) {
          throw new Error("Parent category not found or inactive");
        }

        const isCircular = await this.checkCircularReference(
          categoryId,
          updates.parentCategoryId.toString()
        );

        if (isCircular) {
          throw new Error("Cannot set parent: would create circular reference");
        }
      }

      // Strip catCoverId from the update — handled separately below
      const { catCoverId: coverId, ...updatesWithoutCover } = updates;

      const category = await CategoryModel.findOneAndUpdate(
        { _id: new Types.ObjectId(categoryId), isDeleted: false },
        {
          ...updatesWithoutCover,
          lastModifiedBy: lastModifiedBy
            ? new Types.ObjectId(lastModifiedBy)
            : undefined,
        },
        { new: true, runValidators: true }
      ).lean();

      if (!category) {
        throw new Error("Category not found");
      }

      // Link the new cover if provided
      if (coverId && lastModifiedBy) {
        await categoryCoverConfig.linkFileToCreatedEntity(
          new Types.ObjectId(coverId.toString()),
          categoryId,
          lastModifiedBy,
          this.fileService
        );

        // Re-fetch so the response reflects the updated catCoverId
        return (await CategoryModel.findById(categoryId).lean()) as Category | null;
      }

      return category as Category;
    } catch (error) {
      throw error;
    }
  }

  private async checkCircularReference(
    categoryId: string,
    potentialParentId: string
  ): Promise<boolean> {
    let currentId = potentialParentId;

    while (currentId) {
      if (currentId === categoryId) {
        return true;
      }

      const parent = await CategoryModel.findOne({
        _id: new Types.ObjectId(currentId),
        isDeleted: false,
      });

      if (!parent || !parent.parentCategoryId) {
        break;
      }

      currentId = parent.parentCategoryId.toString();
    }

    return false;
  }

  /**
   * Soft delete category.
   * Also soft deletes all subcategories recursively.
   */
  async deleteCategory(
    categoryId: string,
    deletedBy?: string
  ): Promise<boolean> {
    try {
      if (!Types.ObjectId.isValid(categoryId)) {
        throw new Error("Invalid category ID");
      }

      const category = (await CategoryModel.findOne({
        _id: new Types.ObjectId(categoryId),
        isDeleted: false,
      })) as CategoryDocument | null;

      if (!category) {
        throw new Error("Category not found");
      }

      const subcategoryIds = await this.getAllSubcategoryIds(categoryId);

      await Promise.all([
        category.softDelete(
          deletedBy ? new Types.ObjectId(deletedBy) : undefined
        ),
        ...subcategoryIds.map((id) =>
          CategoryModel.findByIdAndUpdate(id, {
            isDeleted: true,
            deletedAt: new Date(),
            deletedBy: deletedBy ? new Types.ObjectId(deletedBy) : undefined,
          })
        ),
      ]);

      return true;
    } catch (error) {
      throw error;
    }
  }

  private async getAllSubcategoryIds(
    parentId: string
  ): Promise<Types.ObjectId[]> {
    const subcategories = await CategoryModel.find({
      parentCategoryId: new Types.ObjectId(parentId),
      isDeleted: false,
    });

    let allIds: Types.ObjectId[] = subcategories.map((cat) => cat._id);

    for (const subcat of subcategories) {
      const childIds = await this.getAllSubcategoryIds(subcat._id.toString());
      allIds = allIds.concat(childIds);
    }

    return allIds;
  }

  /**
   * Restore soft deleted category
   */
  async restoreCategory(categoryId: string): Promise<Category | null> {
    try {
      if (!Types.ObjectId.isValid(categoryId)) {
        throw new Error("Invalid category ID");
      }

      const category = (await CategoryModel.findOne({
        _id: new Types.ObjectId(categoryId),
        isDeleted: true,
      })) as CategoryDocument | null;

      if (!category) {
        throw new Error("Deleted category not found");
      }

      if (category.parentCategoryId) {
        const parentCategory = await CategoryModel.findOne({
          _id: category.parentCategoryId,
          isDeleted: false,
          isActive: true,
        });

        if (!parentCategory) {
          throw new Error(
            "Cannot restore category: parent category is deleted or inactive"
          );
        }
      }

      await category.restore();

      return (await CategoryModel.findById(categoryId).lean()) as Category | null;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Permanently delete category (hard delete).
   * WARNING: This action cannot be undone.
   */
  async permanentlyDeleteCategory(categoryId: string): Promise<boolean> {
    try {
      if (!Types.ObjectId.isValid(categoryId)) {
        throw new Error("Invalid category ID");
      }

      const category = await CategoryModel.findById(categoryId);

      if (!category) {
        throw new Error("Category not found");
      }

      const activeSubcategories = await CategoryModel.countDocuments({
        parentCategoryId: new Types.ObjectId(categoryId),
        isDeleted: false,
      });

      if (activeSubcategories > 0) {
        throw new Error(
          "Cannot permanently delete category with active subcategories"
        );
      }

      await CategoryModel.deleteOne({ _id: category._id });

      return true;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update category cover image ID.
   *
   * Called by the updateCoverImage handler when the user explicitly sets or
   * clears catCoverId via PUT /api/categories/:id/cover-image.
   *
   * Linking routes through categoryCoverConfig.linkFileToCreatedEntity so
   * entityId is always stamped on the file record at the same time.
   */
  async updateCoverImageId(
    categoryId: string,
    catCoverId: Types.ObjectId | null,
    lastModifiedBy?: string
  ): Promise<Category | null> {
    try {
      if (!Types.ObjectId.isValid(categoryId)) {
        throw new Error("Invalid category ID");
      }

      if (catCoverId === null) {
        // Unlink — clear the field on the category document only.
        // The file record is left intact; use the cover-image delete endpoint
        // to remove the Cloudinary asset and MongoDB record.
        const category = await CategoryModel.findOneAndUpdate(
          { _id: new Types.ObjectId(categoryId), isDeleted: false },
          {
            $unset: { catCoverId: 1 },
            lastModifiedBy: lastModifiedBy
              ? new Types.ObjectId(lastModifiedBy)
              : undefined,
          },
          { new: true }
        ).lean();

        return category as Category | null;
      }

      const file = await this.fileService.getFileById(catCoverId.toString());
      if (!file) {
        throw new Error("Cover image file not found");
      }
      if (file.label !== "category_cover") {
        throw new Error("The provided file is not a category cover image");
      }

      const linked = await categoryCoverConfig.linkFileToCreatedEntity(
        catCoverId,
        categoryId,
        lastModifiedBy ?? "",
        this.fileService
      );

      if (!linked) {
        throw new Error("Failed to link cover image");
      }

      return (await CategoryModel.findById(categoryId).lean()) as Category | null;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get category with complete details including cover image URL
   */
  async getCompleteCategory(categoryId: string): Promise<{
    category: Category | null;
    coverImage?: {
      url: string;
      thumbnailUrl?: string;
      uploadedAt: Date;
    };
    parentCategory?: {
      id: Types.ObjectId;
      name: string;
      slug: string;
    };
    subcategoriesCount?: number;
    servicesCount?: number;
  }> {
    try {
      if (!Types.ObjectId.isValid(categoryId)) {
        throw new Error("Invalid category ID");
      }

      const category = await CategoryModel.findOne({
        _id: new Types.ObjectId(categoryId),
        isDeleted: false,
      })
        .populate("parentCategoryId", "catName slug")
        .populate("subcategories")
        .populate("services");

      if (!category) {
        return { category: null };
      }

      const categoryObj = category.toObject() as CategoryObject;
      const result: any = { category: categoryObj };

      if (categoryObj.catCoverId) {
        const file = await this.fileService.getFileById(
          categoryObj.catCoverId.toString()
        );

        if (file?.status === "active") {
          result.coverImage = {
            url: file.url,
            thumbnailUrl: file.thumbnailUrl,
            uploadedAt: file.uploadedAt,
          };
        }
      }

      if (categoryObj.parentCategoryId) {
        const parent = categoryObj.parentCategoryId as any;
        result.parentCategory = {
          id: parent._id,
          name: parent.catName,
          slug: parent.slug,
        };
      }

      result.subcategoriesCount = categoryObj.subcategories?.length ?? 0;
      result.servicesCount = categoryObj.services?.length ?? 0;

      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Search categories by name or description
   */
  async searchCategories(
    searchTerm: string,
    limit: number = 20,
    skip: number = 0,
    activeOnly: boolean = true
  ): Promise<{ categories: Category[]; total: number; hasMore: boolean }> {
    try {
      const query: any = {
        $text: { $search: searchTerm },
        isDeleted: false,
      };

      if (activeOnly) {
        query.isActive = true;
      }

      const [categories, total] = await Promise.all([
        CategoryModel.find(query)
          .limit(limit)
          .skip(skip)
          .populate("catCoverId", "url thumbnailUrl")
          .populate("parentCategoryId", "catName slug")
          .sort({ score: { $meta: "textScore" } })
          .lean(),
        CategoryModel.countDocuments(query),
      ]);

      return {
        categories: categories as Category[],
        total,
        hasMore: skip + categories.length < total,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get categories by tag
   */
  async getCategoriesByTag(
    tag: string,
    limit: number = 20,
    skip: number = 0
  ): Promise<{ categories: Category[]; total: number; hasMore: boolean }> {
    try {
      const query = {
        tags: { $in: [tag] },
        isDeleted: false,
        isActive: true,
      };

      const [categories, total] = await Promise.all([
        CategoryModel.find(query)
          .limit(limit)
          .skip(skip)
          .populate("catCoverId", "url thumbnailUrl")
          .populate("parentCategoryId", "catName slug")
          .sort({ catName: 1 })
          .lean(),
        CategoryModel.countDocuments(query),
      ]);

      return {
        categories: categories as Category[],
        total,
        hasMore: skip + categories.length < total,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get all unique tags from categories
   */
  async getAllTags(): Promise<string[]> {
    try {
      const categories = await CategoryModel.find(
        { isDeleted: false, isActive: true },
        { tags: 1 }
      ).lean();

      const tagsSet = new Set<string>();
      categories.forEach((category) => {
        category.tags?.forEach((tag) => tagsSet.add(tag));
      });

      return Array.from(tagsSet).sort();
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get category hierarchy (full tree structure)
   */
  async getCategoryHierarchy(): Promise<CategoryObject[]> {
    try {
      const topLevelCategories = await CategoryModel.findTopLevel()
        .populate("catCoverId", "url thumbnailUrl")
        .sort({ catName: 1 });

      const hierarchy = await Promise.all(
        topLevelCategories.map(async (category) => {
          const categoryObj = category.toObject() as CategoryObject;
          categoryObj.subcategories = await this.buildSubcategoryTree(
            category._id.toString()
          );
          return categoryObj;
        })
      );

      return hierarchy;
    } catch (error) {
      throw error;
    }
  }

  private async buildSubcategoryTree(
    parentId: string
  ): Promise<CategoryObject[]> {
    const subcategories = await CategoryModel.find({
      parentCategoryId: new Types.ObjectId(parentId),
      isDeleted: false,
      isActive: true,
    })
      .populate("catCoverId", "url thumbnailUrl")
      .sort({ catName: 1 });

    return await Promise.all(
      subcategories.map(async (subcat) => {
        const subcatObj = subcat.toObject() as CategoryObject;
        subcatObj.subcategories = await this.buildSubcategoryTree(
          subcat._id.toString()
        );
        return subcatObj;
      })
    );
  }

  /**
   * Get category statistics
   */
  async getCategoryStats(categoryId?: string): Promise<{
    totalCategories: number;
    activeCategories: number;
    inactiveCategories: number;
    deletedCategories: number;
    topLevelCategories: number;
    categoriesWithCover: number;
    averageSubcategoriesPerCategory: number;
  }> {
    try {
      const query: any = categoryId
        ? { _id: new Types.ObjectId(categoryId) }
        : {};

      const [
        totalCategories,
        activeCategories,
        inactiveCategories,
        deletedCategories,
        topLevelCategories,
        categoriesWithCover,
      ] = await Promise.all([
        CategoryModel.countDocuments({ ...query, isDeleted: false }),
        CategoryModel.countDocuments({ ...query, isDeleted: false, isActive: true }),
        CategoryModel.countDocuments({ ...query, isDeleted: false, isActive: false }),
        CategoryModel.countDocuments({ ...query, isDeleted: true }),
        CategoryModel.countDocuments({ ...query, isDeleted: false, parentCategoryId: null }),
        CategoryModel.countDocuments({ ...query, isDeleted: false, catCoverId: { $ne: null } }),
      ]);

      const categoriesWithSubcats = await CategoryModel.aggregate([
        { $match: { isDeleted: false } },
        {
          $lookup: {
            from: "categories",
            localField: "_id",
            foreignField: "parentCategoryId",
            as: "subcats",
          },
        },
        { $project: { subcatCount: { $size: "$subcats" } } },
        { $group: { _id: null, avgSubcats: { $avg: "$subcatCount" } } },
      ]);

      const averageSubcategoriesPerCategory =
        categoriesWithSubcats.length > 0
          ? categoriesWithSubcats[0].avgSubcats
          : 0;

      return {
        totalCategories,
        activeCategories,
        inactiveCategories,
        deletedCategories,
        topLevelCategories,
        categoriesWithCover,
        averageSubcategoriesPerCategory: parseFloat(
          averageSubcategoriesPerCategory.toFixed(2)
        ),
      };
    } catch (error) {
      throw error;
    }
  }

  async categoryExists(categoryId: string): Promise<boolean> {
    try {
      if (!Types.ObjectId.isValid(categoryId)) {
        return false;
      }

      const count = await CategoryModel.countDocuments({
        _id: new Types.ObjectId(categoryId),
        isDeleted: false,
      });

      return count > 0;
    } catch (error) {
      throw error;
    }
  }

  async isSlugAvailable(
    slug: string,
    excludeCategoryId?: string
  ): Promise<boolean> {
    try {
      const query: any = { slug: slug.toLowerCase(), isDeleted: false };

      if (excludeCategoryId && Types.ObjectId.isValid(excludeCategoryId)) {
        query._id = { $ne: new Types.ObjectId(excludeCategoryId) };
      }

      return (await CategoryModel.countDocuments(query)) === 0;
    } catch (error) {
      throw error;
    }
  }

  async bulkUpdateCategories(
    categoryIds: string[],
    updates: Partial<Category>,
    lastModifiedBy?: string
  ): Promise<{ modifiedCount: number }> {
    try {
      const objectIds = categoryIds.map((id) => new Types.ObjectId(id));

      const result = await CategoryModel.updateMany(
        { _id: { $in: objectIds }, isDeleted: false },
        {
          ...updates,
          lastModifiedBy: lastModifiedBy
            ? new Types.ObjectId(lastModifiedBy)
            : undefined,
        }
      );

      return { modifiedCount: result.modifiedCount };
    } catch (error) {
      throw error;
    }
  }

  async toggleActiveStatus(
    categoryId: string,
    lastModifiedBy?: string
  ): Promise<Category | null> {
    try {
      if (!Types.ObjectId.isValid(categoryId)) {
        throw new Error("Invalid category ID");
      }

      const category = (await CategoryModel.findOne({
        _id: new Types.ObjectId(categoryId),
        isDeleted: false,
      })) as CategoryDocument | null;

      if (!category) {
        throw new Error("Category not found");
      }

      category.isActive = !category.isActive;
      category.lastModifiedBy = lastModifiedBy
        ? new Types.ObjectId(lastModifiedBy)
        : undefined;

      await category.save();

      return category.toObject() as Category;
    } catch (error) {
      throw error;
    }
  }

  async getAllCategories(
    limit: number = 50,
    skip: number = 0,
    includeDeleted: boolean = false
  ): Promise<{ categories: Category[]; total: number; hasMore: boolean }> {
    try {
      const query: any = includeDeleted ? {} : { isDeleted: false };

      const [categories, total] = await Promise.all([
        CategoryModel.find(query)
          .limit(limit)
          .skip(skip)
          .populate("catCoverId", "url thumbnailUrl uploadedAt")
          .populate("parentCategoryId", "catName slug")
          .populate("createdBy", "email name")
          .populate("lastModifiedBy", "email name")
          .sort({ createdAt: -1 })
          .lean(),
        CategoryModel.countDocuments(query),
      ]);

      return {
        categories: categories as Category[],
        total,
        hasMore: skip + categories.length < total,
      };
    } catch (error) {
      throw error;
    }
  }
}