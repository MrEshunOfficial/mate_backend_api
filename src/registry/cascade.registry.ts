import { Types } from "mongoose";
import { DeletionTier, EntityDeletionResult } from "../types/account-deletion.types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CascadeContext {
  userId:               Types.ObjectId;
  anonymisedIdentifier: string; // e.g. "Deleted User #a3f9" — use this when anonymising
}

export interface CascadeHandler {
  collection: string;
  tier:       DeletionTier;
  execute:    (ctx: CascadeContext) => Promise<{ recordsAffected: number }>;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

/**
 * Central registry for all cascade deletion handlers.
 *
 * To add a new collection:
 *   1. Create  service/account-deletion/cascades/myModel.cascade.ts
 *   2. Add one line to  service/account-deletion/cascades/index.ts:
 *        import "./myModel.cascade";
 *   That's it — the pipeline picks it up automatically.
 */
class CascadeRegistry {
  private handlers: CascadeHandler[] = [];

  /**
   * Register a handler for a collection.
   * Call this once per collection, typically at module load time.
   */
  register(handler: CascadeHandler): void {
    const duplicate = this.handlers.find(
      (h) => h.collection === handler.collection
    );
    if (duplicate) {
      throw new Error(
        `[CascadeRegistry] Duplicate handler for collection "${handler.collection}"`
      );
    }
    this.handlers.push(handler);
  }

  getAll(): Readonly<CascadeHandler[]> {
    return this.handlers;
  }

  /**
   * Run every registered handler in order.
   * Failures are captured as EntityDeletionResult entries — the pipeline
   * never short-circuits so all collections are attempted regardless.
   */
  async runAll(ctx: CascadeContext): Promise<EntityDeletionResult[]> {
    const results: EntityDeletionResult[] = [];

    for (const handler of this.handlers) {
      try {
        const { recordsAffected } = await handler.execute(ctx);
        results.push({
          collection:      handler.collection,
          tier:            handler.tier,
          recordsAffected,
          status:          "success",
        });
      } catch (err: any) {
        results.push({
          collection:      handler.collection,
          tier:            handler.tier,
          recordsAffected: 0,
          status:          "failed",
          error:           err?.message ?? "Unknown error",
        });
      }
    }

    return results;
  }

  /** Derived counts used to build the deletion summary shown to the user. */
  getSummary() {
    return {
      hardDeleteCount: this.handlers.filter((h) => h.tier === DeletionTier.HARD_DELETE).length,
      anonymiseCount:  this.handlers.filter((h) => h.tier === DeletionTier.ANONYMISE).length,
      softDeleteCount: this.handlers.filter((h) => h.tier === DeletionTier.SOFT_DELETE).length,
    };
  }
}

export const cascadeRegistry = new CascadeRegistry();