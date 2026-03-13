import { Types, HydratedDocument } from "mongoose";
import { BaseEntity, SoftDeletable } from "./base.types";
type Service = any;

// SoftDeletable covers isDeleted / deletedAt / deletedBy — not redeclared here
export interface Category extends BaseEntity, SoftDeletable {
  catName: string;
  catDesc: string;
  catCoverId?: Types.ObjectId;
  tags?: string[];
  isActive: boolean;
  parentCategoryId?: Types.ObjectId;
  slug: string;
  createdBy?: Types.ObjectId;
  lastModifiedBy?: Types.ObjectId;
}

export interface CategoryWithServices extends Category {
  services?: Service[];
  servicesCount?: number;
  popularServices?: Service[];
  subcategories?: CategoryWithServices[];
}

export type CategoryDocument = HydratedDocument<
  Category,
  {
    softDelete(deletedBy?: Types.ObjectId): Promise<CategoryDocument>;
    restore(): Promise<CategoryDocument>;
  },
  {
    subcategories?: Category[];
    services?: Service[];
  }
>;

export interface CategoryObject extends Category {
  subcategories?: CategoryObject[];
  services?: Service[];
}

