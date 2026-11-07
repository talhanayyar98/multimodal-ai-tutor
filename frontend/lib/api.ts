import type { Features } from "./features";

// Same-origin by default: /api/* is proxied to the backend by the rewrite in
// next.config.ts. Set NEXT_PUBLIC_BACKEND_URL to call the backend directly.
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "";

export interface SessionInfo {
  sessionId: string;
  abGroup: "adaptive" | "control";
  mode: "study" | "pilot";
  participantId?: string;
  /** false when the backend has no MongoDB — nothing from the session is saved. */
  persisted: boolean;
}

/** The four model states plus "neutral" — must match SELF_REPORT_STATES in backend/src/models.ts. */
export type SelfReportState = "engaged" | "confused" | "bored" | "frustrated" | "neutral";

export interface SelfReport {
  sessionId: string;
  state: SelfReportState;
  /** Client epoch ms, same clock as SignalBatch.windowStart/windowEnd. */
  promptedAt: number;
  answeredAt: number;
}

export interface SignalBatch {
  sessionId: string;
  windowStart: number;
  windowEnd: number;
  features: Features;
  vector: number[];
}

export interface HintResponse {
  hint: string;
  state: string;
  abGroup: "adaptive" | "control";
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function startSession(pilot?: { participantId: string }): Promise<SessionInfo> {
  return parse(
    await fetch(`${BACKEND_URL}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pilot ? { mode: "pilot", participantId: pilot.participantId } : {}),
    }),
  );
}

export async function postSelfReport(report: SelfReport): Promise<void> {
  await parse(
    await fetch(`${BACKEND_URL}/api/self-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    }),
  );
}

export async function postSignals(batch: SignalBatch): Promise<{ ok: boolean; state: string }> {
  return parse(
    await fetch(`${BACKEND_URL}/api/signals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    }),
  );
}

export async function fetchHint(sessionId: string, problem: string): Promise<HintResponse> {
  return parse(
    await fetch(`${BACKEND_URL}/api/hint/${sessionId}?problem=${encodeURIComponent(problem)}`),
  );
}

export interface ChatTurn {
  role: "student" | "tutor";
  text: string;
}

export interface ChatResponse {
  reply: string;
  state: string;
  abGroup: "adaptive" | "control";
}

export async function sendChat(
  sessionId: string,
  message: string,
  history: ChatTurn[],
  problem: string,
): Promise<ChatResponse> {
  return parse(
    await fetch(`${BACKEND_URL}/api/chat/${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, problem }),
    }),
  );
}
