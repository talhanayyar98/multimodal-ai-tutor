// Pilot (labeling) mode: open the app as /?pilot=P01 to collect self-report
// training labels for participant P01. Optional ?probe=<seconds> changes the
// check-in interval (short values are for testing the pop-up only).

export const DEFAULT_PROBE_INTERVAL_S = 90;
/** Each check-in's delay is the interval ± this fraction, so it can't be anticipated. */
export const PROBE_JITTER_FRACTION = 0.15;

// A label is trained on the 12 × 5 s windows that ended before its pop-up
// appeared. If check-ins come closer than 60 s + one window, the mouse
// movement and clicks spent answering the previous one leak into that input.
const SEQUENCE_S = 12 * 5;
const WINDOW_S = 5;

const PARTICIPANT_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

export interface PilotConfig {
  participantId: string;
  probeIntervalS: number;
}

export type PilotParse =
  | { kind: "none" }
  | { kind: "pilot"; config: PilotConfig }
  | { kind: "invalid"; reason: string };

export function readPilotConfig(search: string): PilotParse {
  const params = new URLSearchParams(search);
  const participantId = params.get("pilot");
  if (participantId === null) return { kind: "none" };
  if (!PARTICIPANT_ID_RE.test(participantId)) {
    return {
      kind: "invalid",
      reason: `Invalid participant id "${participantId}" — use 1–32 letters, digits, '-' or '_' (e.g. ?pilot=P01).`,
    };
  }
  const probe = params.get("probe");
  const probeIntervalS = probe === null ? DEFAULT_PROBE_INTERVAL_S : Number(probe);
  if (!Number.isFinite(probeIntervalS) || probeIntervalS < 5 || probeIntervalS > 900) {
    return { kind: "invalid", reason: `Invalid ?probe=${probe} — use seconds between 5 and 900.` };
  }
  return { kind: "pilot", config: { participantId, probeIntervalS } };
}

/** False when check-ins are close enough that answering one contaminates the next label's input. */
export function probeIntervalIsSafe(intervalS: number): boolean {
  return intervalS * (1 - PROBE_JITTER_FRACTION) >= SEQUENCE_S + WINDOW_S;
}
