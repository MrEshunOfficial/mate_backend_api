import { User } from "../../models/auth/auth.model";
import { AuthProvider, SystemRole } from "../../types/base.types";
import { IUserDocument, OAuthUserData } from "../../types/user.types";
import { applySuperAdminProperties, isSuperAdminEmail } from "../../utils/auth/auth.controller.utils";
import { verifyAppleToken, verifyGoogleToken } from "../../utils/auth/oauth.utils";
// ─── Result Types ─────────────────────────────────────────────────────────────

// isAdmin / isSuperAdmin removed from IUser — callers derive from systemRole.
export interface OAuthResult {
  user: {
    id: IUserDocument["_id"];
    name: string;
    email: string;
    systemRole: SystemRole;
    isEmailVerified: boolean;
    authProvider: AuthProvider;
    profileId: IUserDocument["profileId"];
  };
  hasProfile: boolean;
  isNewUser: boolean;
}

export interface LinkProviderResult {
  user: {
    id: IUserDocument["_id"];
    name: string;
    email: string;
    systemRole: SystemRole;
    isEmailVerified: boolean;
    authProvider: AuthProvider;
  };
}

// ─── OAuth Service ────────────────────────────────────────────────────────────

class OAuthService {
  // ── Token Verification ──────────────────────────────────────────────────────

  async verifyGoogleUser(idToken: string): Promise<OAuthUserData> {
    const googleUser = await verifyGoogleToken(idToken);

    return {
      email: googleUser.email,
      name: googleUser.name,
      avatar: googleUser.avatar ?? undefined,
      providerId: googleUser.id,
      // OAuthUserData.provider is typed as AuthProvider enum — not a plain string
      provider: AuthProvider.GOOGLE,
    };
  }

  async verifyAppleUser(
    idToken: string,
    appleUserData?: { name?: { firstName: string; lastName: string } }
  ): Promise<OAuthUserData> {
    const appleUser = await verifyAppleToken(idToken);

    const name = appleUserData?.name
      ? `${appleUserData.name.firstName} ${appleUserData.name.lastName}`.trim()
      : appleUser.name;

    return {
      email: appleUser.email,
      name,
      providerId: appleUser.id,
      provider: AuthProvider.APPLE,
    };
  }

  // ── OAuth Authentication ────────────────────────────────────────────────────

  async authenticateWithOAuth(
    provider: AuthProvider.GOOGLE | AuthProvider.APPLE,
    userData: OAuthUserData
  ): Promise<OAuthResult> {
    const isSuper = isSuperAdminEmail(userData.email);

    let user = await User.findOne({
      $or: [
        { email: userData.email },
        { authProvider: provider, authProviderId: userData.providerId },
      ],
    });

    let isNewUser = false;

    if (user) {
      // Existing credentials account — link OAuth provider
      if (user.authProvider === AuthProvider.CREDENTIALS) {
        user.authProvider = provider;
        user.authProviderId = userData.providerId;
        user.isEmailVerified = true;
      }

      if (isSuper && user.systemRole !== SystemRole.SUPER_ADMIN) {
        applySuperAdminProperties(user);
      }

      user.security = { ...user.security, lastLogin: new Date() };
      await user.save();
    } else {
      isNewUser = true;

      user = new User({
        name: userData.name,
        email: userData.email,
        authProvider: provider,
        authProviderId: userData.providerId,
        isEmailVerified: true, // OAuth users are always verified
        security: { lastLogin: new Date() },
      });

      if (isSuper) applySuperAdminProperties(user);

      await user.save();
    }

    return {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        systemRole: user.systemRole,
        isEmailVerified: user.isEmailVerified,
        authProvider: user.authProvider,
        profileId: user.profileId,
      },
      hasProfile: !!user.profileId,
      isNewUser,
    };
  }

  // ── Link Provider ───────────────────────────────────────────────────────────

  async linkProviderToUser(
    userId: string,
    provider: AuthProvider.GOOGLE | AuthProvider.APPLE,
    idToken: string
  ): Promise<LinkProviderResult> {
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");

    const providerUser =
      provider === AuthProvider.GOOGLE
        ? await verifyGoogleToken(idToken)
        : await verifyAppleToken(idToken);

    // Prevent linking a provider account that is already bound to another user
    const conflict = await User.findOne({
      authProvider: provider,
      authProviderId: providerUser.id,
      _id: { $ne: userId },
    });

    if (conflict) {
      throw new Error("This account is already linked to another user");
    }

    if (isSuperAdminEmail(user.email) && user.systemRole !== SystemRole.SUPER_ADMIN) {
      applySuperAdminProperties(user);
    }

    user.authProvider = provider;
    user.authProviderId = providerUser.id;
    user.isEmailVerified = true;

    await user.save();

    return {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        systemRole: user.systemRole,
        isEmailVerified: user.isEmailVerified,
        authProvider: user.authProvider,
      },
    };
  }
}

export const oAuthService = new OAuthService();