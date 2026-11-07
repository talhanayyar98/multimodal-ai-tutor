import { model, Schema } from "mongoose";
import type { AbGroup, SessionMode } from "./store";

const AB_GROUPS: AbGroup[] = ["adaptive", "control"];
const SESSION_MODES: SessionMode[] = ["study", "pilot"];

// The four model states plus "neutral" ("none of these fit"). Neutral reports
// are kept so the training step can decide whether to drop them.
export const SELF_REPORT_STATES = ["engaged", "confused", "bored", "frustrated", "neutral"] as const;
export type SelfReportState = (typeof SELF_REPORT_STATES)[number];

const SessionSchema = new Schema({
  sessionId: { type: String, required: true, unique: true },
  abGroup: { type: String, enum: AB_GROUPS, required: true },
  mode: { type: String, enum: SESSION_MODES, default: "study" },
  participantId: { type: String, index: true },
  createdAt: { type: Date, default: Date.now },
});

const SignalBatchSchema = new Schema({
  sessionId: { type: String, required: true, index: true },
  windowStart: Number,
  windowEnd: Number,
  features: Schema.Types.Mixed,
  vector: { type: [Number], required: true },
  state: String,
  receivedAt: { type: Date, default: Date.now },
});

const HintSchema = new Schema({
  sessionId: { type: String, required: true, index: true },
  text: { type: String, required: true },
  state: String,
  abGroup: { type: String, enum: AB_GROUPS },
  problem: String,
  createdAt: { type: Date, default: Date.now },
});

const ChatMessageSchema = new Schema({
  sessionId: { type: String, required: true, index: true },
  role: { type: String, enum: ["student", "tutor"], required: true },
  text: { type: String, required: true },
  state: String,
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
  receivedAt: { type: Date, default: Date.now },
});

export const Session = model("Session", SessionSchema);
export const SignalBatch = model("SignalBatch", SignalBatchSchema);
export const Hint = model("Hint", HintSchema);
export const ChatMessage = model("ChatMessage", ChatMessageSchema);
export const SelfReport = model("SelfReport", SelfReportSchema);
