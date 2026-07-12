import mongoose from "mongoose";

export async function connectDb(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn("[db] MONGODB_URI not set — running with in-memory storage only");
    return;
  }
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
    console.log("[db] connected to MongoDB");
  } catch (err) {
    console.warn(
      "[db] MongoDB unreachable — running with in-memory storage only:",
      (err as Error).message,
    );
  }
}

export function dbReady(): boolean {
  return mongoose.connection.readyState === 1;
}
