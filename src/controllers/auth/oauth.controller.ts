import { Request, Response } from "express";
import { AppleAuthRequestBody, AuthenticatedRequest, AuthResponse, GoogleAuthRequestBody, LinkProviderRequestBody } from "../../types/user.types";
import { oAuthService } from "../../service/auth/oauth.service";
import { User } from "../../models/auth/auth.model";
import { AuthProvider } from "../../types/base.types";
import { generateTokenAndSetCookie } from "../../utils/auth/generateTokenAndSetCookies";

// ─── Google OAuth ─────────────────────────────────────────────────────────────

export const googleAuth = async (
  req: Request<{}, AuthResponse, GoogleAuthRequestBody>,
  res: Response<AuthResponse>
): Promise<void> => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      res.status(400).json({
        success: false,
        message: "Google ID token is required",
        error: "Missing required parameter: idToken",
      });
      return;
    }

    const userData = await oAuthService.verifyGoogleUser(idToken);
    const result = await oAuthService.authenticateWithOAuth(AuthProvider.GOOGLE, userData);

    // Re-fetch so the token payload is built from the persisted document
    const completeUser = await User.findById(result.user.id);

    if (!completeUser) {
      res.status(500).json({
        success: false,
        message: "User authentication failed",
        error: "User not found after creation",
      });
      return;
    }

    const token = generateTokenAndSetCookie(res, completeUser._id.toString(), {
      systemRole: completeUser.systemRole,
      isEmailVerified: completeUser.isEmailVerified,
    });

    res.status(200).json({
      success: true,
      message: "Google authentication successful",
      user: result.user as any,
      token,
      hasProfile: result.hasProfile,
      profile: null,
    });
  } catch (error) {
    console.error("Google auth error:", error);
    res.status(400).json({
      success: false,
      message: "Google authentication failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// ─── Apple OAuth ──────────────────────────────────────────────────────────────

export const appleAuth = async (
  req: Request<{}, AuthResponse, AppleAuthRequestBody>,
  res: Response<AuthResponse>
): Promise<void> => {
  try {
    const { idToken, user: appleUserData } = req.body;

    if (!idToken) {
      res.status(400).json({
        success: false,
        message: "Apple ID token is required",
        error: "Missing required parameter: idToken",
      });
      return;
    }

    const userData = await oAuthService.verifyAppleUser(idToken, appleUserData);
    const result = await oAuthService.authenticateWithOAuth(AuthProvider.APPLE, userData);

    const completeUser = await User.findById(result.user.id);

    if (!completeUser) {
      res.status(500).json({
        success: false,
        message: "User authentication failed",
        error: "User not found after creation",
      });
      return;
    }

    const token = generateTokenAndSetCookie(res, completeUser._id.toString(), {
      systemRole: completeUser.systemRole,
      isEmailVerified: completeUser.isEmailVerified,
    });

    res.status(200).json({
      success: true,
      message: "Apple authentication successful",
      user: result.user as any,
      token,
      hasProfile: result.hasProfile,
      profile: null,
    });
  } catch (error) {
    console.error("Apple auth error:", error);
    res.status(400).json({
      success: false,
      message: "Apple authentication failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// ─── Link Provider ────────────────────────────────────────────────────────────

export const linkProvider = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { provider, idToken }: LinkProviderRequestBody = req.body;
    const userId = req.userId;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
        error: "No user ID found in request",
      });
      return;
    }

    if (!provider || !idToken) {
      res.status(400).json({
        success: false,
        message: "Provider and ID token are required",
        error: "Missing required parameters",
      });
      return;
    }

    // LinkProviderRequestBody.provider is typed as AuthProvider.GOOGLE | AuthProvider.APPLE
    if (
      provider !== AuthProvider.GOOGLE &&
      provider !== AuthProvider.APPLE
    ) {
      res.status(400).json({
        success: false,
        message: "Invalid provider",
        error: "Supported providers are google and apple",
      });
      return;
    }

    const result = await oAuthService.linkProviderToUser(userId, provider, idToken);

    res.status(200).json({
      success: true,
      message: `${provider} account linked successfully`,
      user: result.user as any,
    });
  } catch (error) {
    console.error("Link provider error:", error);

    if (error instanceof Error) {
      if (error.message === "User not found") {
        res.status(404).json({
          success: false,
          message: "User not found",
          error: "User account does not exist",
        });
        return;
      }

      if (error.message === "This account is already linked to another user") {
        res.status(400).json({
          success: false,
          message: "This account is already linked to another user",
          error: "Provider account already in use",
        });
        return;
      }
    }

    res.status(500).json({
      success: false,
      message: "Failed to link provider account",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};