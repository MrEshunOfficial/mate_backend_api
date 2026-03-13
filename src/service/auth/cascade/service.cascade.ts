/**
 * Cascade: Services
 * Tier: SOFT_DELETE — services may have bookings, reviews, and payments
 *                     attached. Soft-deleting preserves those relationships
 *                     while taking the service off the platform immediately.
 *
 * Coverage:
 *   - Services where the deleted user is the provider (via providerId lookup)
 *   - Services where the deleted user is submittedBy (catches edge cases where
 *     a service was submitted by the user but owned by a different profile)
 *
 * Side effects mirrored from ServiceService.deleteService():
 *   - scheduledActivationAt is cleared so a deleted service never auto-activates
 *   - isActive is forced false
 *
 * Note: ProviderProfile.serviceOfferings cleanup is handled by the
 * userProfile.cascade — that profile hard-delete removes the parent document,
 * so there is no dangling array to clean up here.
 */

import { DeletionTier } from "../../../types/account-deletion.types";
import { cascadeRegistry } from "../../../registry/cascade.registry";
import { ServiceModel } from "../../../models/service/serviceModel";           // ← uncomment
import ProviderProfileModel from "../../../models/profiles/provider.profile.model"; // ← uncomment

cascadeRegistry.register({
  collection: "Service",
  tier:       DeletionTier.SOFT_DELETE,

  async execute({ userId, anonymisedIdentifier }) {
    // ── Step 1: resolve all provider profile IDs owned by this user ──────────
    const providerProfiles = await ProviderProfileModel.find(
      { userId },
      { _id: 1 }
    ).lean();
    const providerProfileIds = providerProfiles.map((p) => p._id);

    // ── Step 2: soft-delete every service linked to those profiles ────────────
    const now = new Date();
    
    const result = await ServiceModel.updateMany(
      {
        $or: [
          { providerId: { $in: providerProfileIds } },
          { submittedBy: userId },
        ],
        isDeleted: false,
      },
      {
        $set: {
          isDeleted:   true,
          deletedAt:   now,
          deletedBy:   userId,
          isActive:    false,
          // Label the deleted-by with the anonymised identifier for audit clarity
          deletedByLabel: anonymisedIdentifier,
        },
        $unset: {
          scheduledActivationAt: 1, // cancel any pending auto-activation
        },
      }
    );
    
    return { recordsAffected: result.modifiedCount };
  },
});