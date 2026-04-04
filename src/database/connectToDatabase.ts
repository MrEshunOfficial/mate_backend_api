import mongoose, { ConnectOptions } from "mongoose";

const MONGO_OPTIONS: ConnectOptions = {
  maxPoolSize: 50,
  minPoolSize: 5,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 30000,
  connectTimeoutMS: 10000,
  family: 4,
  retryWrites: true,
  w: "majority",
};

// Attach lifecycle listeners once at module load
mongoose.connection.on("error", (err: Error) => {
  process.emit("uncaughtException", err);
});

mongoose.connection.on("disconnected", () => {
  process.emit(
    "uncaughtException",
    new Error("MongoDB disconnected unexpectedly"),
  );
});

export const connectDB = async (): Promise<void> => {
  if (mongoose.connection.readyState === 1) return;

  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) {
    throw new Error("MONGO_URL environment variable is not defined");
  }

  // Let errors propagate — callers decide how to handle them
  await mongoose.connect(mongoUrl, MONGO_OPTIONS);
};

export const disconnectDB = async (): Promise<void> => {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.connection.close();
};
