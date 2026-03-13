import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Types } from "mongoose";
import { applySuperAdminProperties, isSuperAdminEmail } from "../../utils/auth/auth.controller.utils";
import { getVerificationEmailTemplate, getResetPasswordEmailTemplate } from "../../utils/auth/useEmailTemplates";
import { AuthProvider, SystemRole } from "../../types/base.types";
import { IUserDocument, SignupRequestBody, LoginRequestBody, VerifyEmailRequestBody, ResendVerificationRequestBody, ResetPasswordRequestBody, UpdatePasswordRequestBody } from "../../types/user.types";
import { User } from "../../models/auth/auth.model";
import { sendEmail } from "../../utils/auth/sendEmail";

// ─── Response Shape ───────────────────────────────────────────────────────────
export const getUserResponse = (user: IUserDocument) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  systemRole: user.systemRole,
  isEmailVerified: user.isEmailVerified,
  authProvider: user.authProvider,
  profileId: user.profileId ?? null,
  lastLogin: user.security?.lastLogin ?? null,
  createdAt: user.createdAt,
});

// ─── Internal Utilities ───────────────────────────────────────────────────────

const updateSecurity = (user: IUserDocument, updates: Partial<typeof user.security>) => {
  if (!user.security) (user as any).security = {};
  Object.assign(user.security, updates);
};

// ─── Auth Service ─────────────────────────────────────────────────────────────

export class AuthService {
  // ── Authentication ──────────────────────────────────────────────────────────

  async signup(data: SignupRequestBody): Promise<IUserDocument> {
    const { name, email, password } = data;

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) throw new Error("USER_EXISTS");

    const hashedPassword = await bcrypt.hash(password, 12);
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const isSuper = isSuperAdminEmail(email);

    const newUser = new User({
      name: name.trim(),
      email: email.toLowerCase(),
      password: hashedPassword,
      authProvider: AuthProvider.CREDENTIALS,
      verificationToken,
      verificationExpires: new Date(Date.now() + 60 * 60 * 1_000),
      security: { lastLogin: new Date() },
    });

    if (isSuper) {
      applySuperAdminProperties(newUser);
      newUser.verificationToken = undefined;
      newUser.verificationExpires = undefined;
    }

    await newUser.save();

    if (!isSuper) {
      try {
        await sendEmail({
          to: email,
          subject: "Verify Your Email Address",
          html: getVerificationEmailTemplate(name, verificationToken),
        });
      } catch (emailError) {
        console.error("Failed to send verification email:", emailError);
        // Non-fatal — user was created successfully
      }
    }

    return newUser;
  }

  async login(data: LoginRequestBody): Promise<IUserDocument> {
    const { email, password } = data;

    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");

    if (!user || user.authProvider !== AuthProvider.CREDENTIALS || !user.password) {
      throw new Error("INVALID_CREDENTIALS");
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) throw new Error("INVALID_CREDENTIALS");

    // Super admins bypass email verification
    const isSuperAdmin = user.systemRole === SystemRole.SUPER_ADMIN;
    if (!user.isEmailVerified && !isSuperAdmin) {
      const err: any = new Error("EMAIL_NOT_VERIFIED");
      err.email = user.email;
      throw err;
    }

    updateSecurity(user, { lastLogin: new Date() });
    await user.save();

    return user;
  }

  async logout(userId: string): Promise<void> {
    try {
      const user = await User.findById(userId);
      if (user) {
        updateSecurity(user, { lastLoggedOut: new Date() });
        await user.save();
      }
    } catch (updateError) {
      console.error("Failed to update logout timestamp:", updateError);
      // Non-fatal — logout should still succeed
    }
  }

  // ── Email Verification ──────────────────────────────────────────────────────

  async verifyEmail(data: VerifyEmailRequestBody): Promise<IUserDocument> {
    const { token } = data;

    const user = await User.findOne({
      verificationToken: token,
      verificationExpires: { $gt: new Date() },
    }).select("+verificationToken +verificationExpires");

    if (!user) throw new Error("INVALID_TOKEN");

    user.isEmailVerified = true;
    user.verificationToken = undefined;
    user.verificationExpires = undefined;
    await user.save();

    return user;
  }

  async resendVerification(
    data: ResendVerificationRequestBody
  ): Promise<{ success: boolean; sent: boolean }> {
    const { email } = data;

    const user = await User.findOne({ email: email.toLowerCase() });

    // Silent success if user doesn't exist — prevents email enumeration
    if (!user) return { success: true, sent: false };

    if (user.isEmailVerified) throw new Error("EMAIL_ALREADY_VERIFIED");
    if (user.authProvider !== AuthProvider.CREDENTIALS) throw new Error("OAUTH_NO_VERIFICATION");

    const verificationToken = crypto.randomBytes(32).toString("hex");
    user.verificationToken = verificationToken;
    user.verificationExpires = new Date(Date.now() + 60 * 60 * 1_000);
    await user.save();

    try {
      await sendEmail({
        to: user.email,
        subject: "Verify Your Email Address",
        html: getVerificationEmailTemplate(user.name, verificationToken),
      });
      return { success: true, sent: true };
    } catch (emailError) {
      console.error("Failed to send verification email:", emailError);
      throw new Error("EMAIL_SEND_FAILED");
    }
  }

  // ── Password Management ─────────────────────────────────────────────────────

  async forgotPassword(
    data: ResetPasswordRequestBody
  ): Promise<{ success: boolean; sent: boolean }> {
    const { email } = data;

    const user = await User.findOne({ email: email.toLowerCase() });

    // Silent success if user doesn't exist — prevents email enumeration
    if (!user) return { success: true, sent: false };
    if (user.authProvider !== AuthProvider.CREDENTIALS) throw new Error("OAUTH_NO_PASSWORD");

    const resetToken = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1_000);
    await user.save();

    try {
      await sendEmail({
        to: user.email,
        subject: "Password Reset Request",
        html: getResetPasswordEmailTemplate(user.name, resetToken),
      });
      return { success: true, sent: true };
    } catch (emailError) {
      console.error("Failed to send reset email:", emailError);
      // Roll back the token so it cannot be used later
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();
      throw new Error("EMAIL_SEND_FAILED");
    }
  }

  async resetPassword(data: UpdatePasswordRequestBody): Promise<IUserDocument> {
    const { token, password } = data;

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() },
    }).select("+resetPasswordToken +resetPasswordExpires");

    if (!user) throw new Error("INVALID_TOKEN");

    user.password = await bcrypt.hash(password, 12);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    updateSecurity(user, { passwordChangedAt: new Date() });
    await user.save();

    return user;
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<IUserDocument> {
    const user = await User.findById(userId).select("+password");
    if (!user) throw new Error("USER_NOT_FOUND");
    if (user.authProvider !== AuthProvider.CREDENTIALS || !user.password) {
      throw new Error("OAUTH_NO_PASSWORD_CHANGE");
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) throw new Error("INVALID_CURRENT_PASSWORD");

    user.password = await bcrypt.hash(newPassword, 12);
    updateSecurity(user, { passwordChangedAt: new Date() });
    await user.save();

    return user;
  }

  // ── Token Management ────────────────────────────────────────────────────────

  async refreshToken(userId: string): Promise<IUserDocument> {
    const user = await User.findById(userId);
    if (!user) throw new Error("USER_NOT_FOUND");
    return user;
  }

  // ── Account Management ──────────────────────────────────────────────────────

  async deleteAccount(userId: string): Promise<IUserDocument> {
    const user = await User.findById(userId);
    if (!user) throw new Error("USER_NOT_FOUND");
    await user.softDelete();
    return user;
  }

  async restoreAccount(email: string): Promise<IUserDocument> {
    const user = await User.findOne(
      { email: email.toLowerCase() },
      null,
      { includeSoftDeleted: true }
    );

    if (!user || !user.isDeleted) throw new Error("DELETED_ACCOUNT_NOT_FOUND");

    await user.restore();
    return user;
  }

  async permanentlyDeleteAccount(userId: string): Promise<IUserDocument> {
    const user = await User.findById(userId, null, { includeSoftDeleted: true });
    if (!user) throw new Error("USER_NOT_FOUND");
    await user.deleteOne();
    return user;
  }

  // ── Admin Methods ───────────────────────────────────────────────────────────

  async getAllUsers(query: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    role?: string;
  }) {
    const { page = 1, limit = 10, search, status, role } = query;
    const skip = (Number(page) - 1) * Number(limit);

    const dbQuery: Record<string, any> = {};

    if (search) {
      dbQuery.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }
    if (status) dbQuery.status = status;
    if (role) dbQuery.systemRole = role;

    const [users, total] = await Promise.all([
      User.find(dbQuery)
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 }),
      User.countDocuments(dbQuery),
    ]);

    return {
      users,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    };
  }

  async updateUserRole(userId: string, systemRole: SystemRole): Promise<IUserDocument> {
    if (!Object.values(SystemRole).includes(systemRole)) {
      throw new Error("INVALID_ROLE");
    }

    const user = await User.findById(userId);
    if (!user) throw new Error("USER_NOT_FOUND");

    user.systemRole = systemRole;
    await user.save();

    return user;
  }

  async getUserById(userId: string): Promise<IUserDocument> {
    const user = await User.findById(userId);
    if (!user) throw new Error("USER_NOT_FOUND");
    return user;
  }

  async deleteUser(userId: string, adminId?: string): Promise<IUserDocument> {
    const user = await User.findById(userId);
    if (!user) throw new Error("USER_NOT_FOUND");

    // softDelete expects Types.ObjectId — convert from string here at the DB layer
    const adminObjectId = adminId ? new Types.ObjectId(adminId) : undefined;
    await user.softDelete(adminObjectId);

    return user;
  }

  async restoreUser(userId: string): Promise<IUserDocument> {
    const user = await User.findById(userId, null, { includeSoftDeleted: true });

    if (!user || !user.isDeleted) throw new Error("DELETED_USER_NOT_FOUND");

    await user.restore();
    return user;
  }
}

export const authService = new AuthService();