// models/category.model.ts
import { Schema, model, Model, Query } from "mongoose";
import { CategoryDocument } from "../../types/category.types";

const categorySchema = new Schema<CategoryDocument>(
  {
    catName: {
      type: String,
      required: [true, "Category name is required"],
      trim: true,
      maxlength: [100, "Category name cannot exceed 100 characters"],
    },
    catDesc: {
      type: String,
      required: [true, "Category description is required"],
      trim: true,
      maxlength: [500, "Category description cannot exceed 500 characters"],
    },
    catCoverId: {
      type: Schema.Types.ObjectId,
      ref: "File",
      default: null,
    },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: function (tags: string[]) {
          return tags.length <= 20;
        },
        message: "Cannot have more than 20 tags",
      },
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    parentCategoryId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      default: null,
      index: true,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      required: false,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    lastModifiedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: function (_doc, ret) {
        return ret;
      },
    },
    toObject: {
      virtuals: true,
    },
  }
);

// Indexes for performance
categorySchema.index({ catName: "text", catDesc: "text" });
categorySchema.index({ slug: 1, isDeleted: 1 });
categorySchema.index({ parentCategoryId: 1, isActive: 1, isDeleted: 1 });

// Virtual for subcategories
categorySchema.virtual("subcategories", {
  ref: "Category",
  localField: "_id",
  foreignField: "parentCategoryId",
  match: { isDeleted: false, isActive: true },
});

// Virtual for services
categorySchema.virtual("services", {
  ref: "Service",
  localField: "_id",
  foreignField: "categoryId",
  match: { isDeleted: false, isActive: true },
});

// Pre-validate middleware to generate slug before validation
categorySchema.pre("validate", async function (next) {
  // Only generate slug if it doesn't exist and catName is provided
  if (!this.slug && this.catName) {
    const baseSlug = this.catName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    let slug = baseSlug;
    let counter = 1;

    // Cast this.constructor so TS knows it has .findOne()
    const Category = this.constructor as typeof CategoryModel;

    // Check for existing slugs
    while (await Category.findOne({ slug, _id: { $ne: this._id } })) {
      slug = `${baseSlug}-${counter++}`;
    }

    this.slug = slug;
  }
});

// Instance methods
categorySchema.methods.softDelete = function (
  deletedBy?: Schema.Types.ObjectId
) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  if (deletedBy) {
    this.deletedBy = deletedBy;
  }
  return this.save();
};

categorySchema.methods.restore = function () {
  this.isDeleted = false;
  this.deletedAt = null;
  this.deletedBy = null;
  return this.save();
};

// Interface for model with static methods
interface CategoryModelStatics extends Model<CategoryDocument> {
  findActive(): Query<CategoryDocument[], CategoryDocument>;
  findTopLevel(): Query<CategoryDocument[], CategoryDocument>;
  findNotDeleted(): Query<CategoryDocument[], CategoryDocument>;
}

// Static methods
categorySchema.statics.findActive = function () {
  return this.find({ isDeleted: false, isActive: true });
};

categorySchema.statics.findTopLevel = function () {
  return this.find({
    isDeleted: false,
    isActive: true,
    parentCategoryId: null,
  });
};

categorySchema.statics.findNotDeleted = function () {
  return this.find({ isDeleted: false });
};

export const CategoryModel = model<CategoryDocument, CategoryModelStatics>(
  "Category",
  categorySchema
);