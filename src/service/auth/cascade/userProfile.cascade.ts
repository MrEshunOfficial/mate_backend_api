/**
 * Cascade: UserProfile
 * Tier: HARD_DELETE — PII, no reason to retain after account deletion.
 *
 * Replace the import + deleteMany call with your actual UserProfile model.
 */

import ProfileModel from "../../../models/profiles/base.profile.model";
import { cascadeRegistry } from "../../../registry/cascade.registry";
import { DeletionTier } from "../../../types/account-deletion.types";

cascadeRegistry.register({
  collection: "userProfiles",
  tier:       DeletionTier.HARD_DELETE,

  async execute({ userId }) {
    const result = await ProfileModel.deleteMany({ userId });
    return { recordsAffected: result.deletedCount };

    // ── stub — remove once model is wired ──
    // console.warn("[cascade:userProfiles] stub — wire real model");
    // return { recordsAffected: 0 };
  },
});