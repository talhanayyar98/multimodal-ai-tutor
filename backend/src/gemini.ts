import { ApiError, GoogleGenAI } from "@google/genai";
import type { AbGroup } from "./store";

// Override with GEMINI_MODEL in backend/.env (gemini-2.5-flash is closed to new API users).
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

// ---------- calling Gemini, with one retry and a "busy" fallback ----------

/** Replies normally take 9–14 s (thinking model); a call still running after this is given up. */
const ATTEMPT_TIMEOUT_MS = 25_000;
/** Pause before the single retry. */
const RETRY_PAUSE_MS = 1_500;
/** Only a quick failure is retried: after a slow one the student has waited long enough. */
const RETRY_WITHIN_MS = 10_000;
/** Overloaded (503), rate-limited (429) or a passing server error: worth one more try. */
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * What the tutor says when Gemini can't answer (overloaded, rate-limited, timed out,
 * no key). The same words in both A/B groups and no mention of the inferred state, so
 * a failure never gives away or changes the condition. Stored with `fallback: true`,
 * so the analysis can leave these out of the help a learner actually received.
 */
export const BUSY_TEXT = {
  hint: "Sorry, I'm a little overloaded right now and couldn't come up with a hint. Give me a few seconds, then tap Hint again.",
  chat: "Sorry, I'm a little overloaded right now and couldn't answer that. Give me a few seconds, then send your message again.",
  nudge: "Sorry, I'm a little overloaded right now and couldn't put that together. Give me a few seconds, then tap Hint and I'll try again.",
} as const;
type ReplyKind = keyof typeof BUSY_TEXT;

export interface TutorText {
  text: string;
  /** true: Gemini failed and `text` is the BUSY_TEXT notice, not real help. */
  fallback: boolean;
}

class EmptyReplyError extends Error {
  constructor() {
    super("empty reply");
  }
}

let client: GoogleGenAI | null = null;
let warnedNoKey = false;

async function askGemini(kind: ReplyKind, prompt: string): Promise<TutorText> {
  const busy: TutorText = { text: BUSY_TEXT[kind], fallback: true };
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    if (!warnedNoKey) console.warn("[gemini] GEMINI_API_KEY is not set: every tutor reply will be the busy notice");
    warnedNoKey = true;
    return busy;
  }
  client ??= new GoogleGenAI({ apiKey });
  const started = Date.now();
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await client.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: { abortSignal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) },
      });
      const text = res.text?.trim();
      if (!text) throw new EmptyReplyError();
      return { text, fallback: false };
    } catch (err) {
      const retry = attempt === 1 && isTransient(err) && Date.now() - started < RETRY_WITHIN_MS;
      console.warn(
        `[gemini] ${kind} attempt ${attempt} failed after ${Date.now() - started} ms (${describe(err)})` +
          (retry ? ", retrying" : ", sending the busy notice"),
      );
      if (!retry) return busy;
      await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS));
    }
  }
}

function isTransient(err: unknown): boolean {
  if (err instanceof ApiError) return TRANSIENT_STATUS.has(err.status);
  if (err instanceof EmptyReplyError) return true;
  const name = (err as Error)?.name;
  // Our own timeout: already slow, so not retried. Anything else is a network hiccup.
  return name !== "TimeoutError" && name !== "AbortError";
}

function describe(err: unknown): string {
  if (err instanceof ApiError) return `HTTP ${err.status}: ${err.message.slice(0, 160)}`;
  const e = err as Error;
  const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
  return timedOut ? `no reply within ${ATTEMPT_TIMEOUT_MS / 1000} s` : String(e?.message ?? err);
}

// ---------- hints (the Hint button) ----------

export interface HintContext {
  state: string;
  abGroup: AbGroup;
  problem?: string;
}

export function generateHint(ctx: HintContext): Promise<TutorText> {
  return askGemini("hint", buildPrompt(ctx));
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

// ---------- chat ----------

export interface ChatTurn {
  role: "student" | "tutor";
  text: string;
}

export interface ChatContext extends HintContext {
  history: ChatTurn[];
  message: string;
}

export function generateChatReply(ctx: ChatContext): Promise<TutorText> {
  return askGemini("chat", buildChatPrompt(ctx));
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

// ---------- proactive check-ins ("nudges", adaptive group only) ----------

/** Must match NUDGE_STATES in frontend/lib/nudges.ts. */
export const NUDGE_STATES = ["confused", "bored", "frustrated"] as const;
export type NudgeState = (typeof NUDGE_STATES)[number];

export interface NudgeContext {
  /** The state the tutor noticed and offered help for. */
  state: NudgeState;
  problem: string;
  /** The worked solution, so the help is correct; never shown to the student by the model. */
  solution?: string;
  /** The student's wrong answers so far. */
  wrongAnswers: string[];
}

// What the student said yes to, per state (see NUDGE_COPY in frontend/lib/nudges.ts).
const NUDGE_STYLE: Record<NudgeState, string> = {
  confused:
    "They seem confused, and they said yes when you offered a hint. Give ONE clear hint in at most " +
    "three short sentences: name the key idea in plain words, then suggest one concrete next step " +
    "they can do right now.",
  bored:
    "They seem bored, and they said yes when you offered to make the problem more interesting. " +
    "Retell the same problem as a short, vivid scenario (for example a heist, a video game, a sports " +
    "final, a space mission or a cooking show — pick one that suits it), keeping exactly the same " +
    "numbers and maths, and end with a playful one-line challenge to solve it. At most four short sentences.",
  frustrated:
    "They seem frustrated, and they said yes when you offered to go step by step. Start with one " +
    "short, warm, genuine sentence of encouragement, then break the problem into two or three small " +
    "numbered steps and walk them through only the first step. Leave the remaining steps for them.",
};

export function generateNudge(ctx: NudgeContext): Promise<TutorText> {
  return askGemini("nudge", buildNudgePrompt(ctx));
}

function buildNudgePrompt({ state, problem, solution, wrongAnswers }: NudgeContext): string {
  const lines = [
    `You are a friendly tutor inside an intelligent tutoring system. Webcam and mouse signals ` +
      `suggested that the student needs support, so you checked in with them. ${NUDGE_STYLE[state]}`,
    ``,
    `Problem: "${problem}"`,
  ];
  if (wrongAnswers.length > 0) {
    lines.push(`Their wrong answers so far: ${wrongAnswers.join(", ")}. If one reveals a misconception, gently address it.`);
  }
  if (solution) {
    lines.push(`Worked solution, for your reference only. Never reveal the final answer or give it away: ${solution}`);
  }
  lines.push(
    ``,
    `Rules: never state the final answer. Speak directly to the student. Plain text only: no markdown, ` +
      `no headings, no asterisks. Keep it short and friendly.`,
  );
  return lines.join("\n");
}
