// services/profiles/core/profile.scaffolding.service.ts
import { Types } from "mongoose";
import ClientProfileModel from "../../models/profiles/client.profile.model";
import DomainProfileModel from "../../models/profiles/domain.profile.model";
import ProviderProfileModel from "../../models/profiles/provider.profile.model";
import { UserRole } from "../../types/base.types";
import { DomainProfile } from "../../types/profiles/base.profile";


// ─── Output Types ─────────────────────────────────────────────────────────────

export interface ScaffoldResult {
  /**
   * The DomainProfile link record that was created.
   * Carries userId, profileId, role, and isActive: true.
   */
  domainProfile: DomainProfile;

  /**
   * The _id of the role-specific profile document that was created —
   * either ClientProfile._id or ProviderProfile._id depending on role.
   * Stored as profileId on the DomainProfile.
   */
  domainProfileId: Types.ObjectId;

  /**
   * Indicates whether this is a brand new scaffold or a reactivation
   * of a previously deactivated profile from an earlier role stint.
   *
   * "created"     — first time this user has held this role
   * "reactivated" — user previously held this role; their old domain profile
   *                 was found and reactivated (role-specific data is preserved)
   */
  action: "created" | "reactivated";
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * ProfileScaffoldingService
 *
 * Single source of truth for creating the domain profile chain:
 *   UserProfile → DomainProfile → ClientProfile | ProviderProfile
 *
 * Called by two paths:
 *   1. UserProfileService.createProfile()
 *      — when a user sets their initial role at signup.
 *        Without this call, a user who signs up directly as a provider
 *        would have a UserProfile with role: "service_provider" but no
 *        ProviderProfile or DomainProfile backing it.
 *
 *   2. RoleTransitionService._applyTransition()
 *      — when a user switches from one role to another. The previous
 *        role's DomainProfile is deactivated first, then this method
 *        creates or reactivates the target role's chain.
 *
 * Both paths produce identical results — the scaffolded chain is the
 * same regardless of how the user arrived at this role.
 *
 * Only the minimum required fields are set on the role-specific profile.
 * All onboarding fields (contact info, location, etc.) are filled in
 * separately during the onboarding flow.
 */
export class ProfileScaffoldingService {

  /**
   * Creates or reactivates the full domain profile chain for a given role.
   *
   * Reactivation path:
   *   If the user previously held this role (e.g. they were a provider,
   *   switched to customer, and are switching back), their old DomainProfile
   *   record is found (even if soft-deleted) and reactivated. The role-specific
   *   profile document (ProviderProfile / ClientProfile) and all its data are
   *   preserved — the user picks up where they left off.
   *
   * Creation path:
   *   If no prior DomainProfile exists for this role, a fresh role-specific
   *   profile document and DomainProfile link are created.
   *
   * @param userId          - string form of the User._id (from JWT / session)
   * @param userObjectId    - pre-cast Types.ObjectId of the same userId
   * @param userProfileId   - _id of the owning UserProfile document
   * @param role            - the role being scaffolded
   */
  async scaffoldDomainProfile(
    userId: string,
    userObjectId: Types.ObjectId,
    userProfileId: Types.ObjectId,
    role: UserRole
  ): Promise<ScaffoldResult> {

    // ── Check for an existing DomainProfile for this role ────────────────────
    // includeSoftDeleted: true — we want to reactivate even if it was
    // previously soft-deleted (e.g. from an account restoration flow)
    const existing = await DomainProfileModel.findByUserAndRole(userId, role);

    if (existing) {
      return this._reactivate(existing);
    }

    return this._create(userObjectId, userProfileId, role);
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Reactivation path — user previously held this role.
   * Restores the DomainProfile to active without touching the role-specific
   * profile document (ProviderProfile / ClientProfile). All their prior data
   * (business name, location, services, etc.) is preserved exactly as they
   * left it.
   */
  private async _reactivate(
    existing: Awaited<ReturnType<typeof DomainProfileModel.findByUserAndRole>>
  ): Promise<ScaffoldResult> {
    existing!.isActive      = true;
    existing!.activatedAt   = new Date();
    existing!.deactivatedAt = null as any;

    // If the DomainProfile was soft-deleted, restore it too
    if (existing!.isDeleted) {
      existing!.isDeleted = false;
      existing!.deletedAt = undefined as any;
      existing!.deletedBy = undefined as any;
    }

    await existing!.save();

    return {
      domainProfile:   existing!.toObject() as DomainProfile,
      domainProfileId: existing!.profileId as Types.ObjectId,
      action:          "reactivated",
    };
  }

  /**
   * Creation path — first time this user has held this role.
   * Creates a minimal role-specific profile document and the DomainProfile
   * link record.
   */
  private async _create(
    userObjectId: Types.ObjectId,
    userProfileId: Types.ObjectId,
    role: UserRole
  ): Promise<ScaffoldResult> {
    const domainProfileId = await this._createRoleSpecificProfile(
      userProfileId,
      role
    );

    const domainProfile = await DomainProfileModel.create({
      userId:      userObjectId,
      profileId:   domainProfileId,
      role,
      isActive:    true,
      activatedAt: new Date(),
    });

    return {
      domainProfile:   domainProfile.toObject() as DomainProfile,
      domainProfileId,
      action:          "created",
    };
  }

  /**
   * Creates the role-specific profile document and returns its _id.
   *
   * Only minimum required fields are set — all optional onboarding fields
   * (providerContactInfo, locationData, clientContactInfo, etc.) are left
   * unset intentionally. Setting them here would cause required-field
   * validation errors on fields the user hasn't had a chance to fill in yet.
   *
   * The application layer (ProviderProfileService, ClientProfileService)
   * enforces completeness separately via isProfileLive() and similar gates.
   */
  private async _createRoleSpecificProfile(
    userProfileId: Types.ObjectId,
    role: UserRole
  ): Promise<Types.ObjectId> {
    if (role === UserRole.CUSTOMER) {
      const clientProfile = await ClientProfileModel.create({
        profile:    userProfileId,
        isVerified: false,
        // clientContactInfo — filled during customer onboarding
      });
      return clientProfile._id as Types.ObjectId;
    }

    // UserRole.PROVIDER
    const providerProfile = await ProviderProfileModel.create({
      profile:               userProfileId,
      isCompanyTrained:      false,
      isAlwaysAvailable:     false,
      requireInitialDeposit: false,
      // providerContactInfo, locationData — filled during provider onboarding
    });
    return providerProfile._id as Types.ObjectId;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * Shared instance imported by UserProfileService and RoleTransitionService.
 * Both services call scaffoldDomainProfile() — never the private helpers.
 */
export const profileScaffoldingService = new ProfileScaffoldingService();