import crypto from "node:crypto";
import { Router } from "express";
import { dbReady } from "./db";
import {
  generateChatReply,
  generateHint,
  generateNudge,
  NUDGE_STATES,
  type ChatTurn,
  type NudgeState,
} from "./gemini";
import { inferState, type ModelInfo } from "./ml";
import {
  ChatMessage,
  Hint,
  PROBLEM_EVENT_TYPES,
  ProblemEvent,
  Session,
  SESSION_MODES,
  SignalBatch,
  StudyParticipant,
} from "./models";
import { findSession } from "./sessionLookup";
import * as store from "./store";

// Must match FEATURE_ORDER in frontend/lib/features.ts and FEATURE_DIM in ml-service/model.py.
const FEATURE_DIM = 13;
const PARTICIPANT_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

export const router = Router();

// Body {} (or { mode: "demo" }): main page, random group, no participant.
// { mode: "study", participantId }: the study participant's fixed group.
// { mode: "pilot", participantId }: always control.
router.post("/session", async (req, res) => {
  const { mode = "demo", participantId } = req.body ?? {};
  if (!(SESSION_MODES as readonly unknown[]).includes(mode)) {
    res.status(400).json({ error: `mode must be one of: ${SESSION_MODES.join(", ")}` });
    return;
  }
  const sessionMode = mode as store.SessionMode;
  if (
    sessionMode !== "demo" &&
    (typeof participantId !== "string" || !PARTICIPANT_ID_RE.test(participantId))
  ) {
    res.status(400).json({
      error: `${sessionMode} sessions need a participantId of 1–32 letters, digits, '-' or '_'`,
    });
    return;
  }

  let abGroup: store.AbGroup;
  if (sessionMode === "study") {
    // Between-subjects: the group was drawn once, when the participant joined
    // (POST /api/study/participants), so a reload or a second session keeps it.
    if (!dbReady()) {
      res.status(503).json({ error: "MongoDB unavailable — study data is not being stored" });
      return;
    }
    const participant = await StudyParticipant.findOne({ participantId }, { abGroup: 1 }).lean();
    if (!participant) {
      res.status(404).json({ error: "unknown study participant" });
      return;
    }
    abGroup = participant.abGroup as store.AbGroup;
  } else if (sessionMode === "pilot") {
    // Pilot (labeling) sessions never adapt: the untrained model's state is
    // noise, and the self-reports must describe learners under unadapted tutoring.
    abGroup = "control";
  } else {
    abGroup = Math.random() < 0.5 ? "adaptive" : "control";
  }

  const session: store.SessionInfo = {
    sessionId: crypto.randomUUID(),
    abGroup,
    mode: sessionMode,
    participantId: sessionMode === "demo" ? undefined : participantId,
    createdAt: new Date(),
  };
  if (sessionMode === "study") {
    // A study session that isn't stored can't be linked to its participant later.
    try {
      await Session.create(session);
    } catch (err) {
      warnDb("study session")(err as Error);
      res.status(500).json({ error: "session not stored" });
      return;
    }
  } else if (dbReady()) {
    await Session.create(session).catch(warnDb("session"));
  }
  store.rememberSession(session);
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

// Help from a state-triggered check-in the learner said yes to. The client
// sends the state it offered help for (the one the learner saw), not a fresh
// inference, so the help matches the offer.
router.post("/nudge/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const { state, problem, solution, wrongAnswers } = req.body ?? {};
  if (
    !(NUDGE_STATES as readonly unknown[]).includes(state) ||
    typeof problem !== "string" ||
    !problem.trim() ||
    problem.length > 2000
  ) {
    res.status(400).json({
      error: `expected { state: ${NUDGE_STATES.join(" | ")}, problem: string, solution?: string, wrongAnswers?: string[] }`,
    });
    return;
  }
  const session = await findSession(sessionId);
  if (!session) {
    res.status(404).json({ error: "unknown session" });
    return;
  }
  // Check-ins react to the inferred state, so they are part of the adaptive condition only.
  if (session.abGroup !== "adaptive") {
    res.status(403).json({ error: "check-ins are only offered in the adaptive group" });
    return;
  }

  const reply = await generateNudge({
    state: state as NudgeState,
    problem: problem.trim(),
    solution: str(solution, 2000),
    wrongAnswers: Array.isArray(wrongAnswers)
      ? wrongAnswers
          .filter((a): a is string => typeof a === "string" && a.trim() !== "")
          .map((a) => a.trim().slice(0, 40))
          .slice(-5)
      : [],
  });

  if (dbReady()) {
    await Hint.create({
      sessionId,
      text: reply,
      state,
      abGroup: session.abGroup,
      problem: problem.trim(),
      kind: "nudge",
    }).catch(warnDb("nudge"));
  }
  res.json({ reply, state });
});

// Main-page problem flow. Best effort: without MongoDB the event is dropped (202).
router.post("/problem-events", async (req, res) => {
  const body = req.body ?? {};
  if (
    typeof body.sessionId !== "string" ||
    !(PROBLEM_EVENT_TYPES as readonly unknown[]).includes(body.type) ||
    typeof body.t !== "number" ||
    !(body.t > 1e12 && body.t < 1e13)
  ) {
    res.status(400).json({
      error: `expected { sessionId: string, type: ${PROBLEM_EVENT_TYPES.join(" | ")}, t: epoch ms }`,
    });
    return;
  }
  const session = await findSession(body.sessionId);
  if (!session) {
    res.status(404).json({ error: "unknown session" });
    return;
  }
  if (!dbReady()) {
    res.status(202).json({ stored: false });
    return;
  }
  await ProblemEvent.create({
    sessionId: body.sessionId,
    participantId: session.mode === "study" ? session.participantId : undefined,
    abGroup: session.abGroup,
    type: body.type,
    problemId: str(body.problemId, 64),
    topic: str(body.topic, 32),
    difficulty: str(body.difficulty, 16),
    problemNo: Number.isInteger(body.problemNo) && body.problemNo > 0 ? body.problemNo : undefined,
    text: str(body.text, 1000),
    expected: str(body.expected, 200),
    answer: str(body.answer, 200),
    correct: typeof body.correct === "boolean" ? body.correct : undefined,
    state: str(body.state, 16),
    t: body.t,
  }).catch(warnDb("problem event"));
  res.status(201).json({ stored: true });
});

function str(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.slice(0, max) : undefined;
}

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
