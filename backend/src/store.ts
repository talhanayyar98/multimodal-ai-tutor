export type AbGroup = "adaptive" | "control";
// "study": a real A/B session. "pilot": a labeling session that collects
// self-reports as training data — always control, excluded from the A/B analysis.
export type SessionMode = "study" | "pilot";

export interface SessionInfo {
  sessionId: string;
  abGroup: AbGroup;
  mode: SessionMode;
  /** Set for pilot sessions; lets training split train/test by person, not by window. */
  participantId?: string;
  createdAt: Date;
}

// In-memory session cache and per-session ring buffer of recent feature
// vectors. The ring buffer is the LSTM input sequence; it also lets the whole
// pipeline run when MongoDB is unavailable.
const MAX_RECENT_WINDOWS = 12; // 12 windows × 5 s = one minute of context

const sessions = new Map<string, SessionInfo>();
const recentBySession = new Map<string, number[][]>();

export function rememberSession(session: SessionInfo): void {
  sessions.set(session.sessionId, session);
}

export function getSession(sessionId: string): SessionInfo | undefined {
  return sessions.get(sessionId);
}

export function pushVector(sessionId: string, vector: number[]): void {
  const recent = recentBySession.get(sessionId) ?? [];
  recent.push(vector);
  if (recent.length > MAX_RECENT_WINDOWS) recent.shift();
  recentBySession.set(sessionId, recent);
}

export function recentVectors(sessionId: string): number[][] {
  return recentBySession.get(sessionId) ?? [];
}
