// utils/emailTemplates.ts
export const getVerificationEmailTemplate = (
  name: string,
  token: string
): string => {
  const verificationUrl = `${process.env.CLIENT_URL}/verify-email?token=${token}`;

  return `
    <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
      <h2 style="color: #333;">Welcome to Our Platform, ${name}!</h2>
      <p>Thank you for signing up. Please verify your email address by clicking the button below:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${verificationUrl}"
           style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
          Verify Email Address
        </a>
      </div>
      <p>Or copy and paste this link in your browser:</p>
      <p style="word-break: break-all; color: #007bff;">${verificationUrl}</p>
      <p><small>This verification link will expire in 1 hour.</small></p>
    </div>
  `;
};

export const getResetPasswordEmailTemplate = (
  name: string,
  token: string
): string => {
  const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${token}`;

  return `
    <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
      <h2 style="color: #333;">Password Reset Request</h2>
      <p>Hi ${name},</p>
      <p>You requested a password reset. Click the button below to reset your password:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${resetUrl}"
           style="background-color: #dc3545; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
          Reset Password
        </a>
      </div>
      <p>Or copy and paste this link in your browser:</p>
      <p style="word-break: break-all; color: #dc3545;">${resetUrl}</p>
      <p><small>This reset link will expire in 1 hour. If you didn't request this, please ignore this email.</small></p>
    </div>
  `;
};