import type { Features } from "./features";

// Same-origin by default: /api/* is proxied to the backend by the rewrite in
// next.config.ts. Set NEXT_PUBLIC_BACKEND_URL to call the backend directly.
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "";

export interface SessionInfo {
  sessionId: string;
  abGroup: "adaptive" | "control";
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

export async function startSession(): Promise<SessionInfo> {
  return parse(await fetch(`${BACKEND_URL}/api/session`, { method: "POST" }));
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
