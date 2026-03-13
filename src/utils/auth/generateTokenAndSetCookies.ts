import jwt from "jsonwebtoken";
import { Response } from "express";
import { SystemRole } from "../../types/base.types";

// ─── Token Payload ────────────────────────────────────────────────────────────

// Mirrors what is embedded in the JWT and decoded by auth middleware.
// isAdmin / isSuperAdmin were removed from IUser — derive from systemRole.
export interface TokenPayload {
  userId: string;
  systemRole: SystemRole;
  isEmailVerified: boolean;
}

// ─── Token Options ────────────────────────────────────────────────────────────

export interface TokenOptions {
  systemRole: SystemRole;
  isEmailVerified: boolean;
}

// ─── Generator ────────────────────────────────────────────────────────────────

export const generateTokenAndSetCookie = (
  res: Response,
  userId: string,
  options: TokenOptions
): string => {
  const payload: TokenPayload = {
    userId,
    systemRole: options.systemRole,
    isEmailVerified: options.isEmailVerified,
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET as string, {
    expiresIn: "7d",
  });

  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  return token;
};