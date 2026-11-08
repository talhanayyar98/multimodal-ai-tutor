import { dbReady } from "./db";
import { Session } from "./models";
import * as store from "./store";

/**
 * The participant code to store with a session's data, so everything can be
 * fetched by code. Demo sessions have none, even if an old record carries one.
 */
export function participantOf(session: store.SessionInfo | null): string | undefined {
  return session && session.mode !== "demo" ? session.participantId : undefined;
}

/** In-memory cache first, then MongoDB (sessions survive a backend restart). */
export async function findSession(sessionId: string): Promise<store.SessionInfo | null> {
  const cached = store.getSession(sessionId);
  if (cached) return cached;
  if (!dbReady()) return null;
  const doc = await Session.findOne({ sessionId }).lean();
  if (!doc) return null;
  const session: store.SessionInfo = {
    sessionId: doc.sessionId,
    abGroup: doc.abGroup as store.AbGroup,
    // No mode: stored before modes existed, by the main page.
    mode: (doc.mode as store.SessionMode | undefined) ?? "demo",
    participantId: doc.participantId ?? undefined,
    createdAt: doc.createdAt,
  };
  store.rememberSession(session);
  return session;
}
