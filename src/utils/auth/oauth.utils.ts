// utils/oauth.utils.ts
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";

// Interface for verified OAuth user data
export interface VerifiedOAuthUser {
  id: string;
  email: string;
  name: string;
  avatar?: string | null;
  emailVerified: boolean;
}

// Google OAuth verification
export const verifyGoogleToken = async (
  idToken: string
): Promise<VerifiedOAuthUser> => {
  try {
    // Ensure we have the Google Client ID
    if (!process.env.GOOGLE_CLIENT_ID) {
      throw new Error("GOOGLE_CLIENT_ID environment variable is not set");
    }

    console.log(
      "Verifying Google token with Client ID:",
      process.env.GOOGLE_CLIENT_ID
    );

    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (!payload) {
      throw new Error("Invalid Google token - no payload");
    }

    if (!payload.email) {
      throw new Error("No email found in Google token");
    }

    if (!payload.email_verified) {
      throw new Error("Google email is not verified");
    }

    console.log("Google token verified successfully for:", payload.email);

    return {
      id: payload.sub!,
      email: payload.email,
      name: payload.name || "Google User",
      avatar: payload.picture || null,
      emailVerified: payload.email_verified || false,
    };
  } catch (error) {
    console.error("Google token verification failed:", error);
    throw new Error(
      `Google token verification failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
};

// Apple OAuth verification with proper key verification
export const verifyAppleToken = async (
  idToken: string
): Promise<VerifiedOAuthUser> => {
  try {
    // Ensure we have the Apple Client ID
    if (!process.env.APPLE_CLIENT_ID) {
      throw new Error("APPLE_CLIENT_ID environment variable is not set");
    }

    // Apple's public key endpoint
    const client = jwksClient({
      jwksUri: "https://appleid.apple.com/auth/keys",
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 600000, // 10 minutes
    });

    // Decode token header to get the key ID
    const decoded = jwt.decode(idToken, { complete: true });

    if (!decoded || typeof decoded === "string") {
      throw new Error("Invalid Apple token format");
    }

    const { header } = decoded;

    if (!header.kid) {
      throw new Error("No key ID found in Apple token header");
    }

    // Get the signing key
    const key = await client.getSigningKey(header.kid);
    const signingKey = key.getPublicKey();

    // Verify the token
    const verifiedPayload = jwt.verify(idToken, signingKey, {
      algorithms: ["RS256"],
      audience: process.env.APPLE_CLIENT_ID, // Your Apple service ID
      issuer: "https://appleid.apple.com",
    }) as any;

    if (!verifiedPayload.email) {
      throw new Error("No email found in Apple token");
    }

    console.log(
      "Apple token verified successfully for:",
      verifiedPayload.email
    );

    return {
      id: verifiedPayload.sub,
      email: verifiedPayload.email,
      name: verifiedPayload.name || "Apple User",
      avatar: null,
      emailVerified:
        verifiedPayload.email_verified === "true" ||
        verifiedPayload.email_verified === true,
    };
  } catch (error) {
    console.error("Apple token verification failed:", error);
    throw new Error(
      `Apple token verification failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
};

