import { Request, Response } from "express";
import { authService, getUserResponse } from "../../service/auth/auth.service";
import { SystemRole } from "../../types/base.types";
import { AuthenticatedRequest, AuthResponse, SignupRequestBody, LoginRequestBody, VerifyEmailRequestBody, ResendVerificationRequestBody, ResetPasswordRequestBody, UpdatePasswordRequestBody } from "../../types/user.types";
import { generateTokenAndSetCookie } from "../../utils/auth/generateTokenAndSetCookies";

// ─── Response Helpers ─────────────────────────────────────────────────────────

const sendError = (res: Response, status: number, message: string) =>
  res.status(status).json({ success: false, message });

const sendSuccess = (
  res: Response,
  status: number,
  message: string,
  data?: Record<string, unknown>
) => res.status(status).json({ success: true, message, ...data });

const validateRequired = (
  fields: Record<string, unknown>,
  res: Response
): boolean => {
  const [key, value] = Object.entries(fields).find(([, v]) => !v) ?? [];
  if (key !== undefined) {
    sendError(res, 400, `${key} is required`);
    return false;
  }
  return true;
};

const validatePassword = (password: string, res: Response): boolean => {
  if (password.length < 6) {
    sendError(res, 400, "Password must be at least 6 characters long");
    return false;
  }
  return true;
};

// ─── Admin Checks ─────────────────────────────────────────────────────────────
const guardAdmin = (req: AuthenticatedRequest, res: Response): boolean => {
  const role = req.user?.systemRole;
  if (role !== SystemRole.ADMIN && role !== SystemRole.SUPER_ADMIN) {
    sendError(res, 403, "Admin access required");
    return false;
  }
  return true;
};

const guardSuperAdmin = (req: AuthenticatedRequest, res: Response): boolean => {
  if (req.user?.systemRole !== SystemRole.SUPER_ADMIN) {
    sendError(res, 403, "Super admin access required");
    return false;
  }
  return true;
};

// ─── Error Mapping ────────────────────────────────────────────────────────────

const SERVICE_ERRORS: Record<string, { status: number; message: string }> = {
  USER_EXISTS:                { status: 400, message: "User already exists" },
  INVALID_CREDENTIALS:        { status: 400, message: "Invalid email or password" },
  EMAIL_NOT_VERIFIED:         { status: 401, message: "Please verify your email before logging in" },
  INVALID_TOKEN:              { status: 400, message: "Invalid or expired token" },
  EMAIL_ALREADY_VERIFIED:     { status: 400, message: "Email is already verified" },
  OAUTH_NO_VERIFICATION:      { status: 400, message: "This account doesn't require email verification" },
  EMAIL_SEND_FAILED:          { status: 500, message: "Failed to send email" },
  OAUTH_NO_PASSWORD:          { status: 400, message: "This account uses OAuth and doesn't have a password to reset" },
  OAUTH_NO_PASSWORD_CHANGE:   { status: 400, message: "Password change is not available for OAuth accounts" },
  INVALID_CURRENT_PASSWORD:   { status: 400, message: "Current password is incorrect" },
  USER_NOT_FOUND:             { status: 404, message: "User not found" },
  DELETED_ACCOUNT_NOT_FOUND:  { status: 404, message: "Deleted account not found" },
  DELETED_USER_NOT_FOUND:     { status: 404, message: "Deleted user not found" },
  INVALID_ROLE:               { status: 400, message: "Invalid system role" },
};

// ─── Async Wrapper ────────────────────────────────────────────────────────────

// Catches service errors and maps them to HTTP responses so each handler stays
// focused on the happy path.
const handleAsync =
  (fn: (req: any, res: Response) => Promise<void>) =>
  async (req: Request, res: Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (error: any) {
      console.error("Controller error:", error);

      const mapped = SERVICE_ERRORS[error.message];
      if (mapped) {
        if (error.message === "EMAIL_NOT_VERIFIED") {
          res.status(mapped.status).json({
            success: false,
            message: mapped.message,
            requiresVerification: true,
            email: error.email,
          });
          return;
        }
        sendError(res, mapped.status, mapped.message);
        return;
      }

      sendError(res, 500, "Internal server error");
    }
  };

// ─── Authentication ───────────────────────────────────────────────────────────

export const signup = handleAsync(
  async (req: Request<{}, AuthResponse, SignupRequestBody>, res: Response<AuthResponse>) => {
    const { name, email, password } = req.body;

    if (!validateRequired({ name, email, password }, res) || !validatePassword(password, res))
      return;

    const user = await authService.signup({ name, email, password });

    const token = generateTokenAndSetCookie(res, user._id.toString(), {
      systemRole: user.systemRole,
      isEmailVerified: user.isEmailVerified,
    });

    sendSuccess(res, 201, "User created successfully", {
      user: getUserResponse(user),
      token,
    });
  }
);

export const login = handleAsync(
  async (req: Request<{}, AuthResponse, LoginRequestBody>, res: Response<AuthResponse>) => {
    const { email, password } = req.body;

    if (!validateRequired({ email, password }, res)) return;

    const user = await authService.login({ email, password });

    const token = generateTokenAndSetCookie(res, user._id.toString(), {
      systemRole: user.systemRole,
      isEmailVerified: user.isEmailVerified,
    });

    sendSuccess(res, 200, "Login successful", {
      user: getUserResponse(user),
      token,
    });
  }
);

export const logout = handleAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    if (req.userId) await authService.logout(req.userId);
    res.clearCookie("token");
    sendSuccess(res, 200, "Logout successful");
  }
);

// ─── Email Verification ───────────────────────────────────────────────────────

export const verifyEmail = handleAsync(
  async (req: Request<{}, AuthResponse, VerifyEmailRequestBody>, res: Response<AuthResponse>) => {
    const { token } = req.body;

    if (!validateRequired({ token }, res)) return;

    const user = await authService.verifyEmail({ token });
    sendSuccess(res, 200, "Email verified successfully", { user: getUserResponse(user) });
  }
);

export const resendVerification = handleAsync(
  async (
    req: Request<{}, AuthResponse, ResendVerificationRequestBody>,
    res: Response<AuthResponse>
  ) => {
    const { email } = req.body;

    if (!validateRequired({ email }, res)) return;

    await authService.resendVerification({ email });
    sendSuccess(
      res,
      200,
      "If the email exists and is unverified, a verification email has been sent"
    );
  }
);

// ─── Password Management ──────────────────────────────────────────────────────
export const forgotPassword = handleAsync(
  async (req: Request<{}, AuthResponse, ResetPasswordRequestBody>, res: Response<AuthResponse>) => {
    const { email } = req.body;

    if (!validateRequired({ email }, res)) return;

    await authService.forgotPassword({ email });
    sendSuccess(res, 200, "If the email exists, a reset link has been sent");
  }
);

export const resetPassword = handleAsync(
  async (
    req: Request<{}, AuthResponse, UpdatePasswordRequestBody>,
    res: Response<AuthResponse>
  ) => {
    const { token, password } = req.body;

    if (!validateRequired({ token, password }, res) || !validatePassword(password, res))
      return;

    await authService.resetPassword({ token, password });
    sendSuccess(res, 200, "Password reset successful");
  }
);

export const changePassword = handleAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const { currentPassword, newPassword } = req.body;

    if (
      !validateRequired({ currentPassword, newPassword }, res) ||
      !validatePassword(newPassword, res)
    )
      return;

    await authService.changePassword(req.userId!, currentPassword, newPassword);
    sendSuccess(res, 200, "Password changed successfully");
  }
);

// ─── Token Management ─────────────────────────────────────────────────────────

export const refreshToken = handleAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await authService.refreshToken(req.userId!);

    const token = generateTokenAndSetCookie(res, user._id.toString(), {
      systemRole: user.systemRole,
      isEmailVerified: user.isEmailVerified,
    });

    sendSuccess(res, 200, "Token refreshed successfully", {
      user: getUserResponse(user),
      token,
    });
  }
);

// ─── Account Management ───────────────────────────────────────────────────────

export const deleteAccount = handleAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    await authService.deleteAccount(req.userId!);
    res.clearCookie("token");
    sendSuccess(res, 200, "Account deleted successfully");
  }
);

export const restoreAccount = handleAsync(
  async (req: Request, res: Response) => {
    const { email } = req.body;

    if (!validateRequired({ email }, res)) return;

    const user = await authService.restoreAccount(email);
    sendSuccess(res, 200, "Account restored successfully", { user: getUserResponse(user) });
  }
);

export const permanentlyDeleteAccount = handleAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    await authService.permanentlyDeleteAccount(req.userId!);
    res.clearCookie("token");
    sendSuccess(res, 200, "Account permanently deleted");
  }
);

// ─── Verification Endpoint ────────────────────────────────────────────────────

// Called by other services to confirm a token is valid and the user exists.
// By the time this handler runs, authenticateToken has already validated the
// JWT and attached req.user.
export const verifyUser = handleAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      sendError(res, 401, "User not found");
      return;
    }

    sendSuccess(res, 200, "User verified successfully", {
      exists: true,
      userId: req.userId,
      user: {
        id: req.user._id,
        email: req.user.email,
        systemRole: req.user.systemRole,
        isEmailVerified: req.user.isEmailVerified,
      },
    });
  }
);

// ─── Admin Controllers ────────────────────────────────────────────────────────

export const getAllUsers = handleAsync(
  async (req: AuthenticatedRequest, res: Response) => {
    if (!guardAdmin(req, res)) return;

    const { page, limit, search, status, role } = req.query;
    const result = await authService.getAllUsers({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search: search as string | undefined,
      status: status as string | undefined,
      role: role as string | undefined,
    });

    sendSuccess(res, 200, "Users retrieved successfully", {
      users: result.users.map(getUserResponse),
      pagination: result.pagination,
    });
  }
);

export const updateUserRole = handleAsync(
  async (req: AuthenticatedRequest & { params: { userId: string } }, res: Response) => {
    const userId = req.params.userId;
    const { systemRole } = req.body;

    if (!userId || userId === "undefined") {
      sendError(res, 400, "Valid user ID is required");
      return;
    }

    if (!validateRequired({ systemRole }, res)) return;

    const user = await authService.updateUserRole(userId, systemRole);
    sendSuccess(res, 200, "User role updated successfully", { user: getUserResponse(user) });
  }
);

export const getUserById = handleAsync(
  async (req: AuthenticatedRequest & { params: { userId: string } }, res: Response) => {
    if (!guardAdmin(req, res)) return;

    const userId = req.params.userId;
    const user = await authService.getUserById(userId);
    sendSuccess(res, 200, "User retrieved successfully", { user: getUserResponse(user) });
  }
);

export const deleteUser = handleAsync(
  async (req: AuthenticatedRequest & { params: { userId: string } }, res: Response) => {
    if (!guardSuperAdmin(req, res)) return;

    const userId = req.params.userId;
    await authService.deleteUser(userId, req.userId);
    sendSuccess(res, 200, "User deleted successfully");
  }
);

export const restoreUser = handleAsync(
  async (req: AuthenticatedRequest & { params: { userId: string } }, res: Response) => {
    if (!guardSuperAdmin(req, res)) return;

    const userId = req.params.userId;
    const user = await authService.restoreUser(userId);
    sendSuccess(res, 200, "User restored successfully", { user: getUserResponse(user) });
  }
);