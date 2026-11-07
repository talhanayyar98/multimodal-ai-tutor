import crypto from "node:crypto";
import { Router } from "express";
import { dbReady } from "./db";
import { generateChatReply, generateHint, type ChatTurn } from "./gemini";
import { inferState } from "./ml";
import {
  ChatMessage,
  Hint,
  SELF_REPORT_STATES,
  SelfReport,
  Session,
  SignalBatch,
  type SelfReportState,
} from "./models";
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

router.post("/self-report", async (req, res) => {
  const { sessionId, state, promptedAt, answeredAt } = req.body ?? {};
  if (
    typeof sessionId !== "string" ||
    !SELF_REPORT_STATES.includes(state as SelfReportState) ||
    !isEpochMs(promptedAt) ||
    !isEpochMs(answeredAt) ||
    answeredAt < promptedAt
  ) {
    res.status(400).json({
      error:
        `expected { sessionId: string, state: ${SELF_REPORT_STATES.join(" | ")}, ` +
        "promptedAt: epoch ms, answeredAt: epoch ms >= promptedAt }",
    });
    return;
  }
  const session = await findSession(sessionId);
  if (!session) {
    res.status(404).json({ error: "unknown session" });
    return;
  }
  if (!dbReady()) {
    res.status(503).json({ error: "MongoDB unavailable — self-report not stored" });
    return;
  }
  try {
    await SelfReport.create({
      sessionId,
      participantId: session.participantId,
      state,
      promptedAt,
      answeredAt,
    });
  } catch (err) {
    console.warn("[db] failed to store self-report:", (err as Error).message);
    res.status(500).json({ error: "self-report not stored" });
    return;
  }
  res.status(201).json({ ok: true });
});

router.post("/signals", async (req, res) => {
  const { sessionId, windowStart, windowEnd, features, vector } = req.body ?? {};
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
  try {
    state = (await inferState(store.recentVectors(sessionId))).state;
  } catch (err) {
    console.warn("[signals] ML service unavailable:", (err as Error).message);
  }

  if (dbReady()) {
    await SignalBatch.create({ sessionId, windowStart, windowEnd, features, vector, state }).catch(
      warnDb("signal batch"),
    );
  }
  res.json({ ok: true, state });
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

async function findSession(sessionId: string): Promise<store.SessionInfo | null> {
  const cached = store.getSession(sessionId);
  if (cached) return cached;
  if (!dbReady()) return null;
  const doc = await Session.findOne({ sessionId }).lean();
  if (!doc) return null;
  const session: store.SessionInfo = {
    sessionId: doc.sessionId,
    abGroup: doc.abGroup as store.AbGroup,
    mode: (doc.mode as store.SessionMode | undefined) ?? "study",
    participantId: doc.participantId ?? undefined,
    createdAt: doc.createdAt,
  };
  store.rememberSession(session);
  return session;
}

// Client timestamps (Date.now()); rejects garbage like 0 or seconds-based values.
function isEpochMs(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 1e12 && value < 1e13;
}

function warnDb(what: string) {
  return (err: Error) => console.warn(`[db] failed to store ${what}:`, err.message);
}
