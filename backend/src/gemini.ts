import { GoogleGenAI } from "@google/genai";
import type { AbGroup } from "./store";

// Override with GEMINI_MODEL in backend/.env (gemini-2.5-flash is closed to new API users).
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

export interface HintContext {
  state: string;
  abGroup: AbGroup;
  problem?: string;
}

let client: GoogleGenAI | null = null;

export async function generateHint(ctx: HintContext): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return placeholderHint(ctx);
  try {
    client ??= new GoogleGenAI({ apiKey });
    const res = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: buildPrompt(ctx),
    });
    return res.text?.trim() || placeholderHint(ctx);
  } catch (err) {
    console.warn("[gemini] falling back to placeholder hint:", (err as Error).message);
    return placeholderHint(ctx);
  }
}

function buildPrompt({ state, abGroup, problem }: HintContext): string {
  const problemText = problem ?? "the exercise the student is currently working on";
  const base =
    `You are a tutor inside an intelligent tutoring system. The student is working on: ` +
    `"${problemText}". Reply with a single short hint (at most two sentences) that nudges ` +
    `the student forward without revealing the answer.`;
  if (abGroup === "control") return base;
  return (
    `${base} Multimodal signals classify the student's current cognitive-affective state as ` +
    `"${state}". Adapt the hint to that state: more scaffolding and reassurance if confused or ` +
    `frustrated, a more challenging nudge if engaged, an attention-grabbing reframe if bored.`
  );
}

function placeholderHint({ state, abGroup }: HintContext): string {
  const prefix = "(placeholder hint — set GEMINI_API_KEY for real ones)";
  return abGroup === "adaptive"
    ? `${prefix} You seem ${state}. Try re-reading the problem and writing down what is given and what is asked.`
    : `${prefix} Break the problem into smaller steps and solve them one at a time.`;
}

export interface ChatTurn {
  role: "student" | "tutor";
  text: string;
}

export interface ChatContext extends HintContext {
  history: ChatTurn[];
  message: string;
}

export async function generateChatReply(ctx: ChatContext): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return placeholderReply(ctx);
  try {
    client ??= new GoogleGenAI({ apiKey });
    const res = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: buildChatPrompt(ctx),
    });
    return res.text?.trim() || placeholderReply(ctx);
  } catch (err) {
    console.warn("[gemini] falling back to placeholder reply:", (err as Error).message);
    return placeholderReply(ctx);
  }
}

function buildChatPrompt({ state, abGroup, problem, history, message }: ChatContext): string {
  const problemText = problem ?? "the exercise the student is currently working on";
  const transcript = history
    .map((turn) => `${turn.role === "student" ? "Student" : "Tutor"}: ${turn.text}`)
    .join("\n");
  const stateLine =
    abGroup === "adaptive"
      ? ` Multimodal signals classify the student's current cognitive-affective state as "${state}" — ` +
        `adapt your tone and scaffolding to it (reassure if confused or frustrated, challenge if engaged, ` +
        `re-energize if bored).`
      : "";
  return (
    `You are a supportive tutor chatting with a student in an intelligent tutoring system. ` +
    `The student is working on: "${problemText}".${stateLine}\n\n` +
    `Conversation so far:\n${transcript}\nStudent: ${message}\n\n` +
    `Reply as the tutor in at most three sentences. Guide with questions and nudges; ` +
    `never reveal the final answer.`
  );
}

function placeholderReply({ state, abGroup, message }: ChatContext): string {
  const prefix = "(placeholder reply — set GEMINI_API_KEY for real ones)";
  const snippet = message.length > 60 ? `${message.slice(0, 60)}…` : message;
  return abGroup === "adaptive"
    ? `${prefix} You said: "${snippet}". You seem ${state} — let's take it one step at a time: what do you know for sure so far?`
    : `${prefix} You said: "${snippet}". Good thinking — what's the first fact from the problem statement you could build on?`;
}
