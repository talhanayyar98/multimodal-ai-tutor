import crypto from "node:crypto";
import { Router } from "express";
import { dbReady } from "./db";
import { generateChatReply, generateHint, type ChatTurn } from "./gemini";
import { inferState, type ModelInfo } from "./ml";
import { ChatMessage, Hint, Session, SignalBatch } from "./models";
import { findSession } from "./sessionLookup";
import * as store from "./store";

// Must match FEATURE_ORDER in frontend/lib/features.ts and FEATURE_DIM in ml-service/model.py.
const FEATURE_DIM = 13;
const PARTICIPANT_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

export const router = Router();

router.post("/session", async (req, res) => {
  const { mode, participantId } = req.body ?? {};
  const pilot = mode === "pilot";
  if (pilot && (typeof participantId !== "string" || !PARTICIPANT_ID_RE.test(participantId))) {
    res.status(400).json({
      error: "pilot sessions need a participantId of 1–32 letters, digits, '-' or '_'",
    });
    return;
  }

  const session: store.SessionInfo = {
    sessionId: crypto.randomUUID(),
    // Pilot (labeling) sessions never adapt: the untrained model's state is
    // noise, and the self-reports must describe learners under unadapted tutoring.
    abGroup: pilot ? "control" : Math.random() < 0.5 ? "adaptive" : "control",
    mode: pilot ? "pilot" : "study",
    participantId: pilot ? participantId : undefined,
    createdAt: new Date(),
  };
  store.rememberSession(session);
  if (dbReady()) await Session.create(session).catch(warnDb("session"));
  res.status(201).json({
    sessionId: session.sessionId,
    abGroup: session.abGroup,
    mode: session.mode,
    participantId: session.participantId,
    // Pilot data is worthless unless it lands in MongoDB — the UI warns when it won't.
    persisted: dbReady(),
  });
});

router.post("/signals", async (req, res) => {
  const { sessionId, windowStart, windowEnd, features, vector, extras } = req.body ?? {};
  if (
    typeof sessionId !== "string" ||
    !Array.isArray(vector) ||
    vector.length !== FEATURE_DIM ||
    !vector.every((v) => typeof v === "number" && Number.isFinite(v))
  ) {
    res.status(400).json({
      error: `expected { sessionId: string, vector: number[${FEATURE_DIM}] }`,
    });
    return;
  }

  store.pushVector(sessionId, vector);

  let state = "unknown";
  let model: ModelInfo | null = null; // null = ML service unreachable
  try {
    const result = await inferState(store.recentVectors(sessionId));
    state = result.state;
    model = result.model ?? null;
  } catch (err) {
    console.warn("[signals] ML service unavailable:", (err as Error).message);
  }

  if (dbReady()) {
    await SignalBatch.create({
      sessionId,
      windowStart,
      windowEnd,
      features,
      vector,
      extras: numericRecord(extras),
      state,
    }).catch(warnDb("signal batch"));
  }
  res.json({ ok: true, state, model });
});

router.get("/hint/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const session = await findSession(sessionId);
  if (!session) {
    res.status(404).json({ error: "unknown session" });
    return;
  }

  const vectors = store.recentVectors(sessionId);
  let state = "unknown";
  if (vectors.length > 0) {
    try {
      state = (await inferState(vectors)).state;
    } catch (err) {
      console.warn("[hint] ML service unavailable:", (err as Error).message);
    }
  }

  const problem = typeof req.query.problem === "string" ? req.query.problem : undefined;
  const hint = await generateHint({ state, abGroup: session.abGroup, problem });

  if (dbReady()) {
    await Hint.create({ sessionId, text: hint, state, abGroup: session.abGroup, problem }).catch(
      warnDb("hint"),
    );
  }
  res.json({ hint, state, abGroup: session.abGroup });
});

router.post("/chat/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const { message, history, problem } = req.body ?? {};
  if (typeof message !== "string" || !message.trim() || message.length > 2000) {
    res.status(400).json({ error: "expected a non-empty message of at most 2000 characters" });
    return;
  }
  const session = await findSession(sessionId);
  if (!session) {
    res.status(404).json({ error: "unknown session" });
    return;
  }

  const vectors = store.recentVectors(sessionId);
  let state = "unknown";
  if (vectors.length > 0) {
    try {
      state = (await inferState(vectors)).state;
    } catch (err) {
      console.warn("[chat] ML service unavailable:", (err as Error).message);
    }
  }

  const safeHistory: ChatTurn[] = Array.isArray(history)
    ? history
        .filter(
          (turn): turn is ChatTurn =>
            turn &&
            (turn.role === "student" || turn.role === "tutor") &&
            typeof turn.text === "string",
        )
        .slice(-10)
    : [];

  const reply = await generateChatReply({
    state,
    abGroup: session.abGroup,
    problem: typeof problem === "string" ? problem : undefined,
    history: safeHistory,
    message: message.trim(),
  });

  if (dbReady()) {
    await ChatMessage.insertMany([
      { sessionId, role: "student", text: message.trim(), state },
      { sessionId, role: "tutor", text: reply, state },
    ]).catch(warnDb("chat messages"));
  }
  res.json({ reply, state, abGroup: session.abGroup });
});

function warnDb(what: string) {
  return (err: Error) => console.warn(`[db] failed to store ${what}:`, err.message);
}

// Extra per-window signals that are logged but not (yet) part of the model
// vector, e.g. keyboard counts. Anything that isn't a small flat record of
// finite numbers is dropped.
function numericRecord(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(
    ([k, v]) => k.length <= 32 && typeof v === "number" && Number.isFinite(v),
  );
  return entries.length > 0 && entries.length <= 16 ? Object.fromEntries(entries) : undefined;
}
