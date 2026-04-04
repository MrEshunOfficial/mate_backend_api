import express, { NextFunction, Request, Response } from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import { connectDB, disconnectDB } from "./database/connectToDatabase";
import {
  CloudinaryConfigService,
  initCloudinaryService,
} from "./config/cloudinary.config";
import authRoutes from "./routes/auth/auth.routes";
import oauthRoutes from "./routes/auth/oauth.routes";
import filesRoutes from "./routes/files/profilePicture.routes";
import profileRoutes from "./routes/profiles/core.profile.routes";
import categoryCoverRoutes from "./routes/files/categoryCover.routes";
import serviceCategoryRoutes from "./routes/services/service.categories/service.category.routes";
import serviceCoverRoutes from "./routes/files/serviceCover.routes";
import serviceRoutes from "./routes/services/service.routes";
import { startDeletionScheduler } from "./jobs/accountDeletionJob";
import accountDeletionRoutes from "./routes/auth/account-deletion.routes";
import { startServiceActivationScheduler } from "./jobs/serviceActivationJob";
import providerProfileRoutes from "./routes/profiles/provider.profile.routes";
import providerImagesRoutes from "./routes/files/providerImages.routes";
import clientIdImageRoutes from "./routes/files/clientIdImage.routes";
import clientProfileRoutes from "./routes/profiles/client.profile.routes";
import taskRoutes from "./routes/tasks/task.routes";
import bookingRoutes from "./routes/booking/booking.routes";
import serviceRequestRoutes from "./routes/service-request/service-request.routes";
import taskAttachmentRoutes from "./routes/files/taskAttachment.routes";
import { taskMatchingService } from "./service/tasks/task.matching.service";
import bookingAttachmentRoutes from "./routes/files/bookingAttachment.routes";

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
  }),
);

app.use(express.json({ limit: PAYLOAD_LIMIT }));
app.use(express.urlencoded({ limit: PAYLOAD_LIMIT, parameterLimit: 50000 }));
app.use(cookieParser());

// Public read-only static access — no auth required
app.use("/uploads/public", express.static("uploads/public"));

// ─── Routes ───────────────────────────────────────────────────────────────────

// auth routes
app.use("/api/auth", authRoutes);
app.use("/api/oauth", oauthRoutes);
app.use("/api/account/deletion", accountDeletionRoutes);

// user profile routes
app.use("/api/profile", profileRoutes);
app.use("/api/profile-picture", filesRoutes);

// provider profile routes
app.use("/api/providers", providerProfileRoutes);
app.use("/api/provider-files", providerImagesRoutes);

// client profile routes
app.use("/api/client-files", clientIdImageRoutes);
app.use("/api/clients", clientProfileRoutes);

// category routes
app.use("/api/category", serviceCategoryRoutes);
app.use("/api/category-cover", categoryCoverRoutes);

// service routes
app.use("/api/services-cover", serviceCoverRoutes);
app.use("/api/services", serviceRoutes);

// marketplace routes
app.use("/api/service-requests", serviceRequestRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/tasks", taskRoutes);

// file attachment routes
app.use("/api/task-files", taskAttachmentRoutes);
app.use("/api/booking-files", bookingAttachmentRoutes);

// ─── Scheduled Jobs ───────────────────────────────────────────────────────────
startDeletionScheduler();
startServiceActivationScheduler();

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
      message:
        "Request payload too large. Please use a smaller image (max 10MB).",
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

  // Must run after DB connection — bindToModel registers Mongoose middleware
  // (change streams / post-save hooks) that require an active connection.
  taskMatchingService.bindToModel();
  cloudinaryService = initCloudinaryService();

  const server = app.listen(PORT, () => {
    console.log(
      `connection successful Server running on port ${PORT}, [${isDevelopment ? "development" : "production"}]`,
    );
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
