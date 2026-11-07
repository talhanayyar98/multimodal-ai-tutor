// Endpoints for the /collect pilot: participants, check-in labels and
// exercise events. Everything here needs MongoDB — pilot data that isn't
// persisted is useless, so these fail loudly (503) instead of degrading.
import { Router, type Response } from "express";
import { dbReady } from "./db";
import {
  Counter,
  EXERCISE_EVENT_TYPES,
  ExerciseEvent,
  Participant,
  SELF_REPORT_STATES,
  SelfReport,
  STAGE_IDS,
} from "./models";
import { findSession } from "./sessionLookup";

export const pilotRouter = Router();

// Balanced Latin square (Williams design): each block appears once in every
// position and follows every other block exactly once across 4 participants,
// so a state is never tied to "early" or "late" in the session.
const BLOCK_ORDERS = [
  ["routine", "practice", "challenge", "puzzles"],
  ["practice", "puzzles", "routine", "challenge"],
  ["puzzles", "challenge", "practice", "routine"],
  ["challenge", "routine", "puzzles", "practice"],
];

const INTAKE_CHOICES = {
  gender: ["woman", "man", "non-binary", "prefer-not"],
  studyLevel: ["bachelor", "master", "phd", "not-student", "other"],
  probabilityBackground: ["none", "school", "university"],
  vision: ["none", "glasses", "contacts"],
  pointerDevice: ["mouse", "trackpad", "other"],
} as const;

pilotRouter.post("/participants", async (req, res) => {
  if (!requireDb(res)) return;
  const { consent, intake, environment, settings, isTest } = req.body ?? {};
  if (consent !== true) {
    res.status(400).json({ error: "consent is required" });
    return;
  }
  const parsed = parseIntake(intake);
  if (typeof parsed === "string") {
    res.status(400).json({ error: parsed });
    return;
  }

  // Test runs get their own T-codes and counter, so they never shift the real
  // participants' numbering or their block-order rotation.
  const test = isTest === true;
  const counter = await Counter.findOneAndUpdate(
    { _id: test ? "test-participant" : "participant" },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  const seq = counter.seq;
  const participantId = `${test ? "T" : "P"}${String(seq).padStart(3, "0")}`;
  const blockOrder = BLOCK_ORDERS[(seq - 1) % BLOCK_ORDERS.length];

  try {
    await Participant.create({
      participantId,
      seq,
      isTest: test,
      consentAt: new Date(),
      intake: parsed,
      environment: parseEnvironment(environment),
      settings: {
        probeIntervalS: numberIn(settings?.probeIntervalS, 5, 900),
        blockSeconds: numberIn(settings?.blockSeconds, 10, 1800),
      },
      blockOrder,
    });
  } catch (err) {
    console.warn("[db] failed to store participant:", (err as Error).message);
    res.status(500).json({ error: "participant not stored" });
    return;
  }
  res.status(201).json({ participantId, blockOrder });
});

pilotRouter.post("/participants/:participantId/finish", async (req, res) => {
  if (!requireDb(res)) return;
  const { status, post } = req.body ?? {};
  if (status !== "completed" && status !== "ended-early") {
    res.status(400).json({ error: 'status must be "completed" or "ended-early"' });
    return;
  }
  const updated = await Participant.findOneAndUpdate(
    { participantId: req.params.participantId },
    {
      status,
      finishedAt: new Date(),
      post: {
        checkinFit: intIn(post?.checkinFit, 1, 5),
        distractions: text(post?.distractions, 1000),
        comments: text(post?.comments, 2000),
      },
    },
  );
  if (!updated) {
    res.status(404).json({ error: "unknown participant" });
    return;
  }
  res.json({ ok: true });
});

pilotRouter.post("/self-report", async (req, res) => {
  const { sessionId, state, promptedAt, answeredAt, blockId, exerciseId } = req.body ?? {};
  if (
    typeof sessionId !== "string" ||
    !(SELF_REPORT_STATES as readonly unknown[]).includes(state) ||
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
  if (!requireDb(res)) return;
  try {
    await SelfReport.create({
      sessionId,
      participantId: session.participantId,
      state,
      promptedAt,
      answeredAt,
      blockId: stageId(blockId),
      exerciseId: text(exerciseId, 64),
    });
  } catch (err) {
    console.warn("[db] failed to store self-report:", (err as Error).message);
    res.status(500).json({ error: "self-report not stored" });
    return;
  }
  res.status(201).json({ ok: true });
});

pilotRouter.post("/exercise-events", async (req, res) => {
  const body = req.body ?? {};
  if (
    typeof body.sessionId !== "string" ||
    !(EXERCISE_EVENT_TYPES as readonly unknown[]).includes(body.type) ||
    !isEpochMs(body.t)
  ) {
    res.status(400).json({
      error: `expected { sessionId: string, type: ${EXERCISE_EVENT_TYPES.join(" | ")}, t: epoch ms }`,
    });
    return;
  }
  const session = await findSession(body.sessionId);
  if (!session) {
    res.status(404).json({ error: "unknown session" });
    return;
  }
  if (!requireDb(res)) return;
  try {
    await ExerciseEvent.create({
      sessionId: body.sessionId,
      participantId: session.participantId,
      type: body.type,
      blockId: stageId(body.blockId),
      exerciseId: text(body.exerciseId, 64),
      text: text(body.text, 1000),
      expected: text(body.expected, 200),
      answer: text(body.answer, 200),
      correct: typeof body.correct === "boolean" ? body.correct : undefined,
      reason: text(body.reason, 32),
      t: body.t,
    });
  } catch (err) {
    console.warn("[db] failed to store exercise event:", (err as Error).message);
    res.status(500).json({ error: "event not stored" });
    return;
  }
  res.status(201).json({ ok: true });
});

// ---------- validation helpers ----------

type IntakeChoiceKey = keyof typeof INTAKE_CHOICES;

function parseIntake(raw: unknown): Record<string, string | number> | string {
  if (!raw || typeof raw !== "object") return "intake is required";
  const r = raw as Record<string, unknown>;
  const out: Record<string, string | number> = {};

  const age = intIn(r.age, 18, 99);
  if (age === undefined) return "intake.age must be a whole number from 18 to 99";
  out.age = age;

  for (const key of Object.keys(INTAKE_CHOICES) as IntakeChoiceKey[]) {
    const allowed = INTAKE_CHOICES[key] as readonly string[];
    if (typeof r[key] !== "string" || !allowed.includes(r[key] as string)) {
      return `intake.${key} must be one of: ${allowed.join(", ")}`;
    }
    out[key] = r[key] as string;
  }

  const field = text(r.field, 80)?.trim();
  if (!field) return "intake.field (field of study or work) is required";
  out.field = field;

  for (const key of ["mathConfidence", "englishComfort", "alertness"]) {
    const v = intIn(r[key], 1, 5);
    if (v === undefined) return `intake.${key} must be 1–5`;
    out[key] = v;
  }
  return out;
}

function parseEnvironment(raw: unknown): Record<string, string | number> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Record<string, string | number> = {};
  for (const key of ["screenW", "screenH", "viewportW", "viewportH", "devicePixelRatio"]) {
    const v = numberIn(r[key], 0, 20000);
    if (v !== undefined) out[key] = v;
  }
  for (const [key, max] of [
    ["userAgent", 400],
    ["timezone", 64],
    ["language", 32],
  ] as const) {
    const v = text(r[key], max);
    if (v) out[key] = v;
  }
  return out;
}

function requireDb(res: Response): boolean {
  if (dbReady()) return true;
  res.status(503).json({ error: "MongoDB unavailable — pilot data is not being stored" });
  return false;
}

// Client timestamps (Date.now()); rejects garbage like 0 or seconds-based values.
function isEpochMs(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 1e12 && value < 1e13;
}

function stageId(value: unknown): string | undefined {
  return (STAGE_IDS as readonly unknown[]).includes(value) ? (value as string) : undefined;
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

function numberIn(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
}

function intIn(value: unknown, min: number, max: number): number | undefined {
  const v = numberIn(value, min, max);
  return v !== undefined && Number.isInteger(v) ? v : undefined;
}
