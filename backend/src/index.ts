import "dotenv/config";
import cors from "cors";
import express from "express";
import { connectDb } from "./db";
import { pilotRouter } from "./pilotRoutes";
import { router } from "./routes";

// Bind 127.0.0.1, not 0.0.0.0: macOS AirPlay Receiver occupies *:5000, but a
// loopback-specific bind on the same port still succeeds.
const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 5000);

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/api", router);
app.use("/api", pilotRouter);
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

async function main(): Promise<void> {
  await connectDb();
  const server = app.listen(PORT, HOST, () => {
    console.log(`[backend] listening on http://${HOST}:${PORT}`);
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `[backend] port ${PORT} is already in use — is a previous dev stack still running? ` +
          `(kill it, or set PORT in backend/.env)`,
      );
      // Exit instead of throwing: tsx watch would otherwise keep a zombie
      // watcher alive with no listener, which looks like a running backend.
      process.exit(1);
    }
    throw err;
  });
}

void main();
