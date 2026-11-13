import { model, Schema } from "mongoose";
import type { AbGroup, SessionMode } from "./store";

const AB_GROUPS: AbGroup[] = ["adaptive", "control"];
export const SESSION_MODES: readonly SessionMode[] = ["demo", "study", "pilot"];

// The four model states plus "neutral" ("none of these fit"). Neutral reports
// are kept so the training step can decide whether to drop them.
export const SELF_REPORT_STATES = ["engaged", "confused", "bored", "frustrated", "neutral"] as const;
export type SelfReportState = (typeof SELF_REPORT_STATES)[number];

// Pilot (/collect) session stages. Each block is designed to make one state
// likely — routine → bored, practice → engaged, puzzles → confused,
// challenge → frustrated — but the labels themselves only come from self-reports.
// Must match StageId in frontend/lib/exercises.ts.
export const STAGE_IDS = ["warmup", "routine", "practice", "puzzles", "challenge"] as const;

export const EXERCISE_EVENT_TYPES = [
  "setup-done", // camera check passed (reason "face-ok") or skipped (reason "skipped")
  "stage-start",
  "shown", // an exercise appeared: text + expected answer (generated items differ per person)
  "attempt", // an answer was checked: answer + correct
  "skip",
  "timeout", // per-question time limit ran out (challenge block)
  "stage-end", // reason "time" (block time up) or "items" (ran out of questions)
  "tab-hidden",
  "tab-visible",
  "session-end", // reason "completed" or "ended-early"
] as const;

const SessionSchema = new Schema({
  sessionId: { type: String, required: true, unique: true },
  abGroup: { type: String, enum: AB_GROUPS, required: true },
  // Sessions stored before modes existed came from the main page, hence "demo".
  mode: { type: String, enum: SESSION_MODES, default: "demo" },
  participantId: { type: String, index: true },
  createdAt: { type: Date, default: Date.now },
});

const SignalBatchSchema = new Schema({
  sessionId: { type: String, required: true, index: true },
  // The session's participant (LRN…/ST… study, P…/T… pilot); unset for demo sessions.
  participantId: { type: String, index: true },
  windowStart: Number,
  windowEnd: Number,
  features: Schema.Types.Mixed,
  vector: { type: [Number], required: true },
  // Logged per window but not part of the model vector (yet): keyCount, deleteCount.
  extras: Schema.Types.Mixed,
  state: String,
  receivedAt: { type: Date, default: Date.now },
});

const HintSchema = new Schema({
  sessionId: { type: String, required: true, index: true },
  participantId: { type: String, index: true }, // unset for demo sessions
  text: { type: String, required: true },
  state: String,
  abGroup: { type: String, enum: AB_GROUPS },
  problem: String,
  // "manual": the Hint button. "nudge": help the learner accepted from a
  // state-triggered check-in (adaptive group only); `state` is the state it was offered for.
  kind: { type: String, enum: ["manual", "nudge"], default: "manual" },
  // true: Gemini failed and `text` is the "busy" notice (gemini.ts BUSY_TEXT), not real help.
  fallback: Boolean,
  createdAt: { type: Date, default: Date.now },
});

// Main-page (/) problem flow, for the A/B outcome analysis: time to solve,
// attempts, hints, and how check-in offers were answered.
export const PROBLEM_EVENT_TYPES = [
  "shown", // a problem appeared: text + expected answer
  "attempt", // answer + correct
  "hint", // the Hint button's reply arrived
  "chat", // a tutor chat reply arrived
  "nudge-offered", // the tutor noticed `state` and offered help (adaptive only)
  "nudge-accepted",
  "nudge-dismissed",
  "nudge-expired", // offer faded away unanswered
  "nudge", // the accepted check-in's help arrived
  "solved",
  "skipped",
  "unfinished", // /study: the tutoring ended (time limit or "End session") while this problem was open
] as const;

const ProblemEventSchema = new Schema({
  sessionId: { type: String, required: true, index: true },
  participantId: { type: String, index: true }, // unset for demo sessions
  abGroup: { type: String, enum: AB_GROUPS },
  type: { type: String, enum: PROBLEM_EVENT_TYPES, required: true },
  problemId: String,
  topic: String,
  difficulty: String,
  /** 1-based position of the problem in the session. */
  problemNo: Number,
  text: String,
  expected: String,
  answer: String,
  correct: Boolean,
  state: String,
  t: { type: Number, required: true }, // client epoch ms, same clock as the signal windows
  receivedAt: { type: Date, default: Date.now },
});

const ChatMessageSchema = new Schema({
  sessionId: { type: String, required: true, index: true },
  participantId: { type: String, index: true }, // unset for demo sessions
  role: { type: String, enum: ["student", "tutor"], required: true },
  text: { type: String, required: true },
  state: String,
  // Tutor rows only: true when Gemini failed and `text` is the "busy" notice, not a real reply.
  fallback: Boolean,
  createdAt: { type: Date, default: Date.now },
});

// One answered check-in pop-up. promptedAt / answeredAt are client epoch ms —
// the same clock as SignalBatch.windowStart/windowEnd — so training can take
// exactly the windows that ended before the pop-up appeared.
const SelfReportSchema = new Schema({
  sessionId: { type: String, required: true, index: true },
  participantId: String,
  state: { type: String, enum: SELF_REPORT_STATES, required: true },
  promptedAt: { type: Number, required: true },
  answeredAt: { type: Number, required: true },
  // What the learner was doing when the pop-up appeared.
  blockId: String,
  exerciseId: String,
  receivedAt: { type: Date, default: Date.now },
});

// A pilot participant. Deliberately no name: the researcher keeps the
// code ↔ person mapping (e.g. on the signed consent forms), so this dataset is
// pseudonymous.
const ParticipantSchema = new Schema({
  participantId: { type: String, required: true, unique: true }, // P001… (T001… for test runs)
  seq: { type: Number, required: true },
  isTest: { type: Boolean, default: false },
  // Generated by scripts/seed-mock-pilot.ts, not a real person. Exclude with { synthetic: { $ne: true } }.
  synthetic: Boolean,
  status: { type: String, enum: ["started", "completed", "ended-early"], default: "started" },
  consentAt: { type: Date, required: true },
  intake: {
    age: Number,
    gender: String,
    studyLevel: String,
    field: String,
    probabilityBackground: String,
    mathConfidence: Number, // 1–5
    englishComfort: Number, // 1–5
    vision: String, // glasses / contacts change the eye features
    pointerDevice: String, // mouse vs trackpad changes the mouse features
    alertness: Number, // 1–5, at the start
  },
  environment: Schema.Types.Mixed, // browser, screen and window size, timezone
  settings: { probeIntervalS: Number, blockSeconds: Number },
  blockOrder: [String],
  post: { checkinFit: Number, distractions: String, comments: String },
  createdAt: { type: Date, default: Date.now },
  finishedAt: Date,
});

const ExerciseEventSchema = new Schema({
  sessionId: { type: String, required: true, index: true },
  participantId: { type: String, index: true },
  type: { type: String, enum: EXERCISE_EVENT_TYPES, required: true },
  blockId: String,
  exerciseId: String,
  text: String,
  expected: String,
  answer: String,
  correct: Boolean,
  reason: String,
  t: { type: Number, required: true }, // client epoch ms, same clock as the signal windows
  receivedAt: { type: Date, default: Date.now },
});

// The /study flow, in order. A participant only ever moves forward, and can
// only be marked "completed" after reaching the last stage.
// Must match StudyStage in frontend/lib/api.ts.
// The questionnaires come right after the tutoring, so they rate it while it
// is fresh and before the post-test can colour the ratings.
export const STUDY_STAGES = ["consent", "pretest", "camera", "tutoring", "tlx", "sus", "posttest"] as const;
export type StudyStage = (typeof STUDY_STAGES)[number];

// NASA-TLX, raw (unweighted) version: six 0–100 scales in steps of 5.
// `performance` runs from 0 = perfect to 100 = failure, like the original.
export const TLX_SCALES = ["mental", "physical", "temporal", "performance", "effort", "frustration"] as const;
export const SUS_ITEM_COUNT = 10;

// Pre-/post-test forms (frontend/lib/studyTests.ts): "AB" = form A before the
// tutoring and form B after it, "BA" the reverse. Balanced within each group
// by the allocation blocks (allocation.ts).
export const TEST_ORDERS = ["AB", "BA"] as const;
export type TestOrder = (typeof TEST_ORDERS)[number];
export const TESTS = ["pre", "post"] as const;

// "in-progress" until finished. Someone who closes the tab stays in-progress
// forever, so for the analysis: status "completed" (and isTest false).
export const STUDY_STATUSES = ["in-progress", "completed", "ended-early"] as const;

// A participant of the A/B study (/study). Kept apart from the pilot's
// `participants` on purpose: train.py reads that collection, and study
// participants must never end up in the training data. Like the pilot, no
// names: LRN001… (ST001… for researcher test runs).
const StudyParticipantSchema = new Schema({
  participantId: { type: String, required: true, unique: true },
  seq: { type: Number, required: true },
  isTest: { type: Boolean, default: false },
  // Between-subjects: fixed for the whole study, every session of this participant uses it.
  abGroup: { type: String, enum: AB_GROUPS, required: true },
  // The allocation block the group was drawn from (see allocation.ts), for auditing.
  allocationBlock: { type: Number, required: true },
  testOrder: { type: String, enum: TEST_ORDERS, required: true },
  // Score summaries, recounted from `testanswers` after every answer (that
  // collection is the source of truth). `answered` includes "I don't know".
  pretest: { form: String, answered: Number, correct: Number, dontKnow: Number },
  posttest: { form: String, answered: Number, correct: Number, dontKnow: Number },
  // Questionnaires about the tutoring, stored once. Times are client epoch ms.
  // tlx.raw = mean of the six scales (Raw TLX, 0–100, higher = more workload).
  tlx: {
    mental: Number,
    physical: Number,
    temporal: Number,
    performance: Number,
    effort: Number,
    frustration: Number,
    raw: Number,
    shownAt: Number,
    answeredAt: Number,
  },
  // sus.items = the ten 1–5 answers in item order; sus.score = standard SUS 0–100.
  sus: { items: { type: [Number], default: undefined }, score: Number, shownAt: Number, answeredAt: Number },
  status: { type: String, enum: STUDY_STATUSES, default: "in-progress" },
  // The furthest stage reached, and when each stage was reached (where people drop out).
  stage: { type: String, enum: STUDY_STAGES, default: "consent" },
  // `note`: a short detail, e.g. "face-ok" / "skipped" for how the camera check ended.
  progress: [{ _id: false, stage: { type: String, enum: STUDY_STAGES }, at: Date, note: String }],
  consentAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
  finishedAt: Date,
});

// The shuffled group order for one block of BLOCK_SIZE consecutive study
// participants (see allocation.ts). _id "study-<n>", or "study-test-<n>" for
// test runs. Drawn once, when the block's first participant joins.
// `testOrders[i]` belongs to the same slot as `groups[i]`.
const AllocationBlockSchema = new Schema({
  _id: { type: String, required: true },
  groups: { type: [String], required: true },
  testOrders: { type: [String], required: true },
  createdAt: { type: Date, default: Date.now },
});

// One answered pre-/post-test question. No feedback is ever shown, and one
// answer per question: the first one stored counts.
const TestAnswerSchema = new Schema({
  participantId: { type: String, required: true, index: true },
  test: { type: String, enum: TESTS, required: true },
  form: { type: String, enum: ["A", "B"], required: true },
  itemId: { type: String, required: true },
  // The skill, and the tutoring problem (lib/studyTask.ts) this question mirrors.
  skill: String,
  mirrors: String,
  /** 1-based position in the test. */
  position: Number,
  answer: String, // exactly as typed; empty for "I don't know"
  dontKnow: { type: Boolean, required: true },
  correct: { type: Boolean, required: true },
  shownAt: { type: Number, required: true }, // client epoch ms
  answeredAt: { type: Number, required: true },
  receivedAt: { type: Date, default: Date.now },
});
TestAnswerSchema.index({ participantId: 1, test: 1, itemId: 1 }, { unique: true });

// Atomic sequence numbers for participant codes: "participant" and
// "test-participant" (pilot), "study-participant" and "study-test-participant" (study).
const CounterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

export const Session = model("Session", SessionSchema);
export const SignalBatch = model("SignalBatch", SignalBatchSchema);
export const Hint = model("Hint", HintSchema);
export const ProblemEvent = model("ProblemEvent", ProblemEventSchema);
export const ChatMessage = model("ChatMessage", ChatMessageSchema);
export const SelfReport = model("SelfReport", SelfReportSchema);
export const Participant = model("Participant", ParticipantSchema);
export const ExerciseEvent = model("ExerciseEvent", ExerciseEventSchema);
export const StudyParticipant = model("StudyParticipant", StudyParticipantSchema);
export const AllocationBlock = model("AllocationBlock", AllocationBlockSchema);
export const TestAnswer = model("TestAnswer", TestAnswerSchema);
export const Counter = model("Counter", CounterSchema);
