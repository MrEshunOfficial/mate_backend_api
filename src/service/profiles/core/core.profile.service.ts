// services/profiles/user.profile.service.ts
import { Types } from "mongoose";
import ProfileModel from "../../../models/profiles/base.profile.model";
import { CreateProfileRequestBody, IUserProfile } from "../../../types/profiles/base.profile";
import { UpdateProfileRequestBody } from "../../../types/user.types";
import { MongoDBFileService } from "../../files/mongodb.file.service";
import { profilePictureConfig } from "../../../controllers/files/config/profilePicture.config";
import { profileScaffoldingService } from "../profileScafolding.service";


// FIX: ImageLinkingService removed.
//
// The previous implementation called imageLinkingService.linkOrphanedImage()
// in createProfile and restoreProfile. That method internally called
// EntityModel.findByIdAndUpdate(new Types.ObjectId(userId)), which looks up
// the profile where _id = userId. IUserProfile is keyed by userId not _id,
// so the update always silently failed — the profile picture never linked
// when the profile was created after the upload.
//
// The fix: use profilePictureConfig.linkFileToCreatedEntity directly, which
// calls ProfileModel.findOneAndUpdate({ userId }) — the correct lookup field.
//
// imageLinkingService.unlinkImage was correct (it used getEntityIdField to
// resolve "userId" for USER type) but is also replaced here for consistency
// with the config-driven approach.

export class UserProfileService {
  private fileService: MongoDBFileService;

  constructor() {
    this.fileService = new MongoDBFileService();
  }

  /**
   * Create a new user profile.
   *
   * Domain profile scaffolding:
   *   Immediately after the UserProfile document is written,
   *   profileScaffoldingService.scaffoldDomainProfile() is called to create
   *   the full chain:
   *
   *     UserProfile → DomainProfile → ClientProfile | ProviderProfile
   *
   *   This ensures that a user who picks their role at signup (e.g. signs up
   *   directly as a service_provider) has a fully backed profile chain without
   *   needing to go through the role transition flow.
   *
   *   Without this call, a directly-assigned role would leave the user with a
   *   UserProfile.role set but no DomainProfile or role-specific document — any
   *   downstream service that loads the provider/client profile would get null.
   *
   * Profile picture linking:
   *   After the profile document is written, attempts to link any profile picture
   *   that was uploaded before this profile existed. The picture file has
   *   entityId = userId already stamped (set at upload time in linked mode), so
   *   getFilesByEntity finds it immediately.
   */
  async createProfile(
    userId: string,
    profileData: CreateProfileRequestBody
  ): Promise<IUserProfile> {
    const existingProfile = await ProfileModel.findOne({
      userId: new Types.ObjectId(userId),
      isDeleted: false,
    });

    if (existingProfile) {
      throw new Error("Profile already exists for this user");
    }

    // 1. Create the UserProfile document
    const profile = await ProfileModel.create({
      userId: new Types.ObjectId(userId),
      ...profileData,
    });

    // 2. Scaffold the domain profile chain immediately.
    //    This is the single place that guarantees the invariant:
    //    "A UserProfile with a role always has a corresponding active
    //     DomainProfile and role-specific profile document."
    //
    //    RoleTransitionService enforces the same invariant when the user
    //    switches roles later — both paths delegate to the same scaffolding
    //    service so the behaviour is identical.
    await profileScaffoldingService.scaffoldDomainProfile(
      userId,
      new Types.ObjectId(userId),
      profile._id as Types.ObjectId,
      profileData.role
    );

    // 3. Link any profile picture that was uploaded before this profile existed.
    //    linkFileToCreatedEntity searches by entityId = userId (already set on
    //    the file record) and writes profilePictureId on the new document.
    //    The fileId param is unused for linked-mode configs — pass a placeholder.
    const linked = await profilePictureConfig.linkFileToCreatedEntity(
      new Types.ObjectId(), // unused for linked mode — entityId lookup is used instead
      userId,
      userId,
      this.fileService
    );

    if (linked) {
      // Return the refreshed document so profilePictureId is populated
      return (await ProfileModel.findById(profile._id))!;
    }

    return profile;
  }

  /**
   * Get user profile by userId.
   */
  async getProfileByUserId(
    userId: string,
    includeDetails = false
  ): Promise<IUserProfile | null> {
    if (includeDetails) {
      return ProfileModel.findWithDetails(userId);
    }
    return ProfileModel.findActiveByUserId(userId);
  }

  /**
   * Get user profile by profile ID.
   */
  async getProfileById(
    profileId: string,
    includeDetails = false
  ): Promise<IUserProfile | null> {
    if (!Types.ObjectId.isValid(profileId)) {
      throw new Error("Invalid profile ID");
    }

    const query = ProfileModel.findOne({
      _id: new Types.ObjectId(profileId),
      isDeleted: false,
    });

    if (includeDetails) {
      query
        // IUser.name is the single name field — firstName/lastName don't exist
        .populate("userId", "name email")
        .populate("profilePictureId", "url thumbnailUrl uploadedAt");
    }

    return query;
  }

  /**
   * Update user profile by userId.
   *
   * Role is intentionally excluded from updates — changing role must go through
   * RoleTransitionService.execute() so that the domain profile chain is updated
   * atomically and an audit event is written.
   *
   * updatedAt is managed automatically by Mongoose { timestamps: true }.
   */
  async updateProfile(
    userId: string,
    updates: UpdateProfileRequestBody
  ): Promise<IUserProfile | null> {
    // Strip role from updates — must go through RoleTransitionService
    const { role: _role, ...safeUpdates } = updates as any;

    const profile = await ProfileModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId), isDeleted: false },
      safeUpdates,
      { new: true, runValidators: true }
    );

    if (!profile) {
      throw new Error("Profile not found");
    }

    return profile;
  }

  /**
   * Update profile by profile ID (admin path).
   * updatedAt is managed automatically by Mongoose { timestamps: true }.
   */
  async updateProfileById(
    profileId: string,
    updates: UpdateProfileRequestBody
  ): Promise<IUserProfile | null> {
    if (!Types.ObjectId.isValid(profileId)) {
      throw new Error("Invalid profile ID");
    }

    // Strip role from admin updates too — role changes always go through
    // RoleTransitionService regardless of who initiates them
    const { role: _role, ...safeUpdates } = updates as any;

    const profile = await ProfileModel.findOneAndUpdate(
      { _id: new Types.ObjectId(profileId), isDeleted: false },
      safeUpdates,
      { new: true, runValidators: true }
    );

    if (!profile) {
      throw new Error("Profile not found");
    }

    return profile;
  }

  /**
   * Soft delete user profile.
   * Unlinks the profile picture if one is set.
   */
  async deleteProfile(userId: string): Promise<boolean> {
    const profile = await ProfileModel.findOne({
      userId: new Types.ObjectId(userId),
      isDeleted: false,
    });

    if (!profile) {
      throw new Error("Profile not found");
    }

    if (profile.profilePictureId) {
      await profilePictureConfig.unlinkFromEntity(
        userId,
        profile.profilePictureId,
        userId
      );
    }

    await profile.softDelete();
    return true;
  }

  /**
   * Restore a soft-deleted profile.
   *
   * After the profile is restored, attempts to re-link any active profile
   * picture. The picture file retains its entityId = userId from the original
   * upload so getFilesByEntity can find it even after the profile was deleted.
   *
   * Domain profile chain:
   *   The DomainProfile and role-specific profile (ClientProfile /
   *   ProviderProfile) are NOT re-scaffolded here. They have their own
   *   soft-delete state and are managed independently. If the domain chain
   *   needs restoring, it should be done explicitly via the appropriate
   *   admin tooling or account restoration flow.
   */
  async restoreProfile(userId: string): Promise<IUserProfile | null> {
    const profile = await ProfileModel.findOne({
      userId: new Types.ObjectId(userId),
      isDeleted: true,
    });

    if (!profile) {
      throw new Error("Deleted profile not found");
    }

    await profile.restore();

    // Re-link picture after restore using the same path as createProfile.
    const linked = await profilePictureConfig.linkFileToCreatedEntity(
      new Types.ObjectId(), // unused for linked mode
      userId,
      userId,
      this.fileService
    );

    if (linked) {
      return ProfileModel.findById(profile._id);
    }

    return profile;
  }

  /**
   * Permanently delete profile (hard delete).
   * WARNING: This action cannot be undone.
   */
  async permanentlyDeleteProfile(userId: string): Promise<boolean> {
    const profile = await ProfileModel.findOne({
      userId: new Types.ObjectId(userId),
    });

    if (!profile) {
      throw new Error("Profile not found");
    }

    if (profile.profilePictureId) {
      await profilePictureConfig.unlinkFromEntity(
        userId,
        profile.profilePictureId,
        userId
      );
    }

    await ProfileModel.deleteOne({ _id: profile._id });
    return true;
  }

  /**
   * Update profile picture ID.
   * Pass null to clear the field.
   */
  async updateProfilePictureId(
    userId: string,
    profilePictureId: Types.ObjectId | null
  ): Promise<IUserProfile | null> {
    const updateData: Record<string, any> = {};

    if (profilePictureId === null) {
      updateData.$unset = { profilePictureId: 1 };
    } else {
      updateData.profilePictureId = profilePictureId;
    }

    return ProfileModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId), isDeleted: false },
      updateData,
      { new: true }
    );
  }

  /**
   * Get profile with complete details including the profile picture URL.
   */
  async getCompleteProfile(userId: string): Promise<{
    profile: IUserProfile | null;
    profilePicture?: {
      url: string;
      thumbnailUrl?: string;
      uploadedAt: Date;
    };
  }> {
    const profile = await ProfileModel.findActiveByUserId(userId);

    if (!profile) {
      return { profile: null };
    }

    if (profile.profilePictureId) {
      const file = await this.fileService.getFileById(
        profile.profilePictureId.toString()
      );

      if (file?.status === "active") {
        return {
          profile,
          profilePicture: {
            url: file.url,
            thumbnailUrl: file.thumbnailUrl,
            uploadedAt: file.uploadedAt,
          },
        };
      }
    }

    return { profile };
  }

  /**
   * Check if an active profile exists for a user.
   */
  async profileExists(userId: string): Promise<boolean> {
    const count = await ProfileModel.countDocuments({
      userId: new Types.ObjectId(userId),
      isDeleted: false,
    });
    return count > 0;
  }

  /**
   * Get multiple profiles by user IDs.
   */
  async getProfilesByUserIds(
    userIds: string[],
    includeDetails = false
  ): Promise<IUserProfile[]> {
    const objectIds = userIds.map((id) => new Types.ObjectId(id));

    const query = ProfileModel.find({
      userId: { $in: objectIds },
      isDeleted: false,
    });

    if (includeDetails) {
      query
        .populate("userId", "name email")
        .populate("profilePictureId", "url thumbnailUrl uploadedAt");
    }

    return query;
  }

  /**
   * Search profiles by bio content.
   */
  async searchProfilesByBio(
    searchTerm: string,
    limit = 20,
    skip = 0
  ): Promise<IUserProfile[]> {
    return ProfileModel.find({
      bio: { $regex: searchTerm, $options: "i" },
      isDeleted: false,
    })
      .limit(limit)
      .skip(skip)
      .populate("userId", "name email")
      .populate("profilePictureId", "url thumbnailUrl");
  }

  /**
   * Get profile statistics for a user.
   * Uses BaseEntity.updatedAt (from Mongoose timestamps) — lastModified was removed.
   */
  async getProfileStats(userId: string): Promise<{
    hasProfile: boolean;
    hasProfilePicture: boolean;
    profileCreatedAt?: Date;
    lastUpdatedAt?: Date;
    bioLength?: number;
  }> {
    const profile = await ProfileModel.findActiveByUserId(userId);

    if (!profile) {
      return { hasProfile: false, hasProfilePicture: false };
    }

    return {
      hasProfile:       true,
      hasProfilePicture: !!profile.profilePictureId,
      profileCreatedAt: profile.createdAt,
      lastUpdatedAt:    profile.updatedAt,
      bioLength:        profile.bio?.length ?? 0,
    };
  }

  /**
   * Validate a mobile number against the shared regex.
   */
  validateMobileNumber(mobileNumber: string): boolean {
    const phoneRegex = /^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,9}$/;
    return phoneRegex.test(mobileNumber);
  }

  /**
   * Get all profiles with pagination (admin).
   */
  async getAllProfiles(
    limit = 20,
    skip = 0,
    includeDeleted = false
  ): Promise<{ profiles: IUserProfile[]; total: number; hasMore: boolean }> {
    const filter = includeDeleted ? {} : { isDeleted: false };

    const [profiles, total] = await Promise.all([
      ProfileModel.find(filter)
        .limit(limit)
        .skip(skip)
        .populate("userId", "name email")
        .populate("profilePictureId", "url thumbnailUrl"),
      ProfileModel.countDocuments(filter),
    ]);

    return { profiles, total, hasMore: skip + profiles.length < total };
  }

  /**
   * Bulk update profiles by user IDs (admin).
   * Role is excluded — role changes must go through RoleTransitionService.
   */
  async bulkUpdateProfiles(
    userIds: string[],
    updates: UpdateProfileRequestBody
  ): Promise<{ modifiedCount: number }> {
    const objectIds = userIds.map((id) => new Types.ObjectId(id));

    // Strip role from bulk updates
    const { role: _role, ...safeUpdates } = updates as any;

    const result = await ProfileModel.updateMany(
      { userId: { $in: objectIds }, isDeleted: false },
      safeUpdates
    );

    return { modifiedCount: result.modifiedCount };
  }
}