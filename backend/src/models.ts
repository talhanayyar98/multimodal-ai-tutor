import { model, Schema } from "mongoose";
import type { AbGroup } from "./store";

const AB_GROUPS: AbGroup[] = ["adaptive", "control"];

const SessionSchema = new Schema({
  sessionId: { type: String, required: true, unique: true },
  abGroup: { type: String, enum: AB_GROUPS, required: true },
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

export const Session = model("Session", SessionSchema);
export const SignalBatch = model("SignalBatch", SignalBatchSchema);
export const Hint = model("Hint", HintSchema);
export const ChatMessage = model("ChatMessage", ChatMessageSchema);
