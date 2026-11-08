import type { Features } from "./features";

// Same-origin by default: /api/* is proxied to the backend by the rewrite in
// next.config.ts. Set NEXT_PUBLIC_BACKEND_URL to call the backend directly.
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "";

export interface SessionInfo {
  sessionId: string;
  abGroup: "adaptive" | "control";
  /** "demo": main page (/). "study": A/B study (/study). "pilot": data collection (/collect). */
  mode: "demo" | "study" | "pilot";
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
  /** What the learner was doing when the pop-up appeared. */
  blockId?: string;
  exerciseId?: string;
}

export interface SignalBatch {
  sessionId: string;
  windowStart: number;
  windowEnd: number;
  features: Features;
  vector: number[];
  /** Logged per window but not part of the model vector, e.g. keyboard counts. */
  extras?: Record<string, number>;
}

/** Which model produced the state (ml-service/predictor.py); null when the ML service is unreachable. */
export interface ModelInfo {
  /** The training run's directory name, or "untrained". */
  name: string;
  /** "synthetic" | "real"; null for the untrained placeholder. */
  data: string | null;
  trained: boolean;
}

export interface SignalsResponse {
  ok: boolean;
  state: string;
  model: ModelInfo | null;
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

export async function postSignals(batch: SignalBatch): Promise<SignalsResponse> {
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

// ---------- main page: check-ins + problem events ----------

export interface NudgeResponse {
  reply: string;
  state: string;
}

/** Help from a state-triggered check-in the learner accepted (adaptive group only). */
export async function fetchNudge(
  sessionId: string,
  body: { state: string; problem: string; solution?: string; wrongAnswers: string[] },
): Promise<NudgeResponse> {
  return parse(
    await fetch(`${BACKEND_URL}/api/nudge/${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** Must match PROBLEM_EVENT_TYPES in backend/src/models.ts. */
export type ProblemEventType =
  | "shown"
  | "attempt"
  | "hint"
  | "chat"
  | "nudge-offered"
  | "nudge-accepted"
  | "nudge-dismissed"
  | "nudge-expired"
  | "nudge"
  | "solved"
  | "skipped";

export interface ProblemEventBody {
  type: ProblemEventType;
  t: number;
  problemId: string;
  topic: string;
  difficulty: string;
  problemNo: number;
  text?: string;
  expected?: string;
  answer?: string;
  correct?: boolean;
  state?: string;
}

/** Fire and forget: logging must never get in the learner's way. */
export function logProblemEvent(sessionId: string, event: ProblemEventBody): void {
  void fetch(`${BACKEND_URL}/api/problem-events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, ...event }),
  }).catch(() => {});
}

// ---------- /study A/B study ----------

/** The /study flow in order. Must match STUDY_STAGES in backend/src/models.ts. */
export type StudyStage = "consent" | "camera" | "tutoring";

/** After consent: a new participant code (LRN001…, ST001… for test runs); the group is drawn server-side. */
export async function createStudyParticipant(isTest: boolean): Promise<{ participantId: string }> {
  return parse(
    await fetch(`${BACKEND_URL}/api/study/participants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consent: true, isTest }),
    }),
  );
}

/** A session in the participant's fixed group. */
export async function startStudySession(participantId: string): Promise<SessionInfo> {
  return parse(
    await fetch(`${BACKEND_URL}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "study", participantId }),
    }),
  );
}

/** The participant reached `stage`; `note` is a short detail, e.g. how the camera check ended. */
export async function setStudyStage(participantId: string, stage: StudyStage, note?: string): Promise<void> {
  await parse(
    await fetch(`${BACKEND_URL}/api/study/participants/${encodeURIComponent(participantId)}/stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage, note }),
    }),
  );
}

export async function finishStudyParticipant(
  participantId: string,
  status: "completed" | "ended-early",
): Promise<void> {
  await parse(
    await fetch(`${BACKEND_URL}/api/study/participants/${encodeURIComponent(participantId)}/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }),
  );
}

// ---------- /collect pilot ----------

export interface Intake {
  age: number;
  gender: "woman" | "man" | "non-binary" | "prefer-not";
  studyLevel: "bachelor" | "master" | "phd" | "not-student" | "other";
  field: string;
  probabilityBackground: "none" | "school" | "university";
  mathConfidence: number;
  englishComfort: number;
  vision: "none" | "glasses" | "contacts";
  pointerDevice: "mouse" | "trackpad" | "other";
  alertness: number;
}

export interface NewParticipant {
  consent: true;
  intake: Intake;
  environment: Record<string, string | number>;
  settings: { probeIntervalS: number; blockSeconds: number };
  isTest: boolean;
}

export interface ParticipantInfo {
  participantId: string;
  blockOrder: string[];
}

export async function createParticipant(body: NewParticipant): Promise<ParticipantInfo> {
  return parse(
    await fetch(`${BACKEND_URL}/api/participants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export interface PostSurvey {
  checkinFit?: number;
  distractions?: string;
  comments?: string;
}

export async function finishParticipant(
  participantId: string,
  status: "completed" | "ended-early",
  post: PostSurvey,
): Promise<void> {
  await parse(
    await fetch(`${BACKEND_URL}/api/participants/${encodeURIComponent(participantId)}/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, post }),
    }),
  );
}

export interface ExerciseEvent {
  type:
    | "setup-done"
    | "stage-start"
    | "shown"
    | "attempt"
    | "skip"
    | "timeout"
    | "stage-end"
    | "tab-hidden"
    | "tab-visible"
    | "session-end";
  blockId?: string;
  exerciseId?: string;
  text?: string;
  expected?: string;
  answer?: string;
  correct?: boolean;
  reason?: string;
}

export async function postExerciseEvent(
  sessionId: string,
  event: ExerciseEvent & { t: number },
): Promise<void> {
  await parse(
    await fetch(`${BACKEND_URL}/api/exercise-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, ...event }),
    }),
  );
}

