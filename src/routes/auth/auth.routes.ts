import express from "express";
import {
  signup,
  login,
  logout,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  changePassword,
  refreshToken,
  deleteAccount,
  permanentlyDeleteAccount,
  restoreAccount,
  verifyUser,
  getAllUsers,
  getUserById,
  updateUserRole,
  deleteUser,
  restoreUser,
  permanentlyDeleteUser,
} from "../../controllers/auth/auth.controller";
import {
  authenticateToken,
  requireVerification,
  requireAdmin,
  requireSuperAdmin,
} from "../../middleware/auth/auth.middleware";
import { SystemRole } from "../../types/base.types";
import { AuthenticatedRequest } from "../../types/user.types";

const router = express.Router();

// ─── Public Auth ──────────────────────────────────────────────────────────────

router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", logout);

// ─── Email Verification ───────────────────────────────────────────────────────

router.post("/verify-email", verifyEmail);
router.post("/resend-verification", resendVerification);

// ─── Password Management ──────────────────────────────────────────────────────

router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/change-password", authenticateToken, changePassword);

// ─── Token Management ─────────────────────────────────────────────────────────

router.post("/refresh-token", authenticateToken, refreshToken);

// ─── Account Management ───────────────────────────────────────────────────────

router.delete("/account", authenticateToken, deleteAccount);
router.delete(
  "/account/permanent",
  authenticateToken,
  permanentlyDeleteAccount,
);
router.post("/restore-account", restoreAccount);

// ─── Current User ─────────────────────────────────────────────────────────────

router.get("/me", authenticateToken, (req, res) => {
  const authReq = req as AuthenticatedRequest;
  res.json({
    success: true,
    message: "User profile retrieved successfully",
    user: authReq.user,
    userId: authReq.userId,
  });
});

router.get("/status", authenticateToken, (req, res) => {
  const authReq = req as AuthenticatedRequest;
  res.json({
    success: true,
    isAuthenticated: true,
    userId: authReq.userId,
    systemRole: authReq.user?.systemRole,
  });
});

router.get("/verify-user", authenticateToken, verifyUser);

// ─── Access Verification ──────────────────────────────────────────────────────

router.get(
  "/verify-access/verified",
  authenticateToken,
  requireVerification,
  (req, res) => {
    const authReq = req as AuthenticatedRequest;
    res.json({
      success: true,
      message: "User has verified email access",
      verified: true,
      user: {
        id: authReq.user?._id,
        email: authReq.user?.email,
        isEmailVerified: authReq.user?.isEmailVerified,
      },
    });
  },
);

router.get(
  "/verify-access/admin",
  authenticateToken,
  requireAdmin,
  (req, res) => {
    const authReq = req as AuthenticatedRequest;
    res.json({
      success: true,
      message: "User has admin access",
      user: {
        id: authReq.user?._id,
        name: authReq.user?.name,
        email: authReq.user?.email,
        systemRole: authReq.user?.systemRole,
        isAdmin:
          authReq.user?.systemRole === SystemRole.ADMIN ||
          authReq.user?.systemRole === SystemRole.SUPER_ADMIN,
      },
    });
  },
);

router.get(
  "/verify-access/super-admin",
  authenticateToken,
  requireSuperAdmin,
  (req, res) => {
    const authReq = req as AuthenticatedRequest;
    res.json({
      success: true,
      message: "User has super admin access",
      user: {
        id: authReq.user?._id,
        name: authReq.user?.name,
        email: authReq.user?.email,
        systemRole: authReq.user?.systemRole,
        systemAdminName: authReq.user?.systemAdminName,
        isSuperAdmin: authReq.user?.systemRole === SystemRole.SUPER_ADMIN,
      },
    });
  },
);

// ─── Admin — User Management ──────────────────────────────────────────────────

router.get("/admin/users", authenticateToken, requireAdmin, getAllUsers);
router.get(
  "/admin/users/:userId",
  authenticateToken,
  requireAdmin,
  getUserById,
);

// ─── Super Admin — Privileged Operations ─────────────────────────────────────

router.patch(
  "/admin/users/:userId/role",
  authenticateToken,
  requireSuperAdmin,
  updateUserRole,
);
router.delete(
  "/admin/users/:userId",
  authenticateToken,
  requireSuperAdmin,
  deleteUser,
);
router.post(
  "/admin/users/:userId/restore",
  authenticateToken,
  requireSuperAdmin,
  restoreUser,
);

// NOTE: This route must be defined BEFORE the generic /:userId DELETE above so
// Express doesn't swallow "/permanent" as a userId. It is already fine here
// because "/permanent" is a distinct literal segment appended after /:userId.
router.delete(
  "/admin/users/:userId/permanent",
  authenticateToken,
  requireSuperAdmin,
  permanentlyDeleteUser,
);

// ─── Health Check ─────────────────────────────────────────────────────────────

router.get("/health", (_req, res) => {
  res.json({
    success: true,
    message: "Auth service is running",
    timestamp: new Date().toISOString(),
  });
});

export default router;
