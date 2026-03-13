// backend/utils/sendEmail.ts
import { config } from "dotenv";

config();

// Validate environment variables
if (!process.env.MAILTRAP_TOKEN) {
  throw new Error("MAILTRAP_TOKEN is not set");
}

if (!process.env.MAILTRAP_ENDPOINT) {
  throw new Error("MAILTRAP_ENDPOINT is not set");
}

interface SendEmailOptions {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  category?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  // Dynamic import to handle CommonJS package
  const { MailtrapClient } = await import("mailtrap");
  
  const client = new MailtrapClient({
    token: process.env.MAILTRAP_TOKEN!,
  });

  const sender = {
    email: "hello@demomailtrap.com",
    name: "Mailtrap",
  };

  try {
    const recipients = [
      {
        email: options.to,
      },
    ];
    
    await client.send({
      from: sender,
      to: recipients,
      subject: options.subject,
      html: options.html,
      text: options.text,
      category: options.category || "Application Email",
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Email sending failed: ${error.message}`);
    }
    throw new Error("Email sending failed with unknown error");
  }
}