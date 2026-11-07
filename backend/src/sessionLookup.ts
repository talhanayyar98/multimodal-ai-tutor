import { dbReady } from "./db";
import { Session } from "./models";
import * as store from "./store";

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
    mode: (doc.mode as store.SessionMode | undefined) ?? "study",
    participantId: doc.participantId ?? undefined,
    createdAt: doc.createdAt,
  };
  store.rememberSession(session);
  return session;
}
