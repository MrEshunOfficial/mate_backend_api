import express, { NextFunction, Request, Response } from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import { connectDB, disconnectDB } from "./database/connectToDatabase";
import {
  CloudinaryConfigService,
  initCloudinaryService,
} from "./config/cloudinary.config";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const isDevelopment = process.env.NODE_ENV !== "production";
const PAYLOAD_LIMIT = "10mb";

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(
  cors({
    origin: isDevelopment ? "http://localhost:3000" : process.env.CLIENT_URL,
    credentials: true,
  })
);

app.use(express.json({ limit: PAYLOAD_LIMIT }));
app.use(express.urlencoded({ limit: PAYLOAD_LIMIT, parameterLimit: 50000 }));
app.use(cookieParser());

// Public read-only static access — no auth required
app.use("/uploads/public", express.static("uploads/public"));

// ─── Routes ───────────────────────────────────────────────────────────────────
// Mount your routers here, e.g.:
// app.use("/api/auth", authRouter);

// ─── Error Middleware ─────────────────────────────────────────────────────────

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (isDevelopment) {
    console.error(err.stack);
  }

  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      success: false,
      message: "File too large. Maximum file size is 10MB.",
      error: "FILE_TOO_LARGE",
    });
  }

  if (err.message?.includes("File type")) {
    return res.status(400).json({
      success: false,
      message: err.message,
      error: "INVALID_FILE_TYPE",
    });
  }

  if (err.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message: "Request payload too large. Please use a smaller image (max 10MB).",
      error: "PAYLOAD_TOO_LARGE",
    });
  }

  if (err.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON data.",
      error: "INVALID_JSON",
    });
  }

  res.status(err.status ?? 500).json({
    success: false,
    message: "Something went wrong.",
    ...(isDevelopment && { error: err.message }),
  });
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────

let cloudinaryService: CloudinaryConfigService;

async function startServer(): Promise<void> {
  await connectDB();
  cloudinaryService = initCloudinaryService();

  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} [${isDevelopment ? "development" : "production"}]`);
  });

  // ─── Graceful Shutdown ───────────────────────────────────────────────────────

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`${signal} received — shutting down gracefully`);

    server.close(async (err) => {
      if (err) {
        console.error("Error closing HTTP server:", err);
        process.exit(1);
      }

      await disconnectDB();
      process.exit(0);
    });

    // Force-kill if graceful shutdown takes too long
    setTimeout(() => {
      console.error("Graceful shutdown timed out — forcing exit");
      process.exit(1);
    }, 10_000);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    shutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
    shutdown("unhandledRejection");
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

export { app, cloudinaryService };