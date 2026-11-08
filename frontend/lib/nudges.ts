// Proactive "the tutor noticed…" check-ins on the main page (adaptive group only).
//
// The state badge updates every 5 s. When the same kind of trouble shows up in
// two readings in a row (≈10 s) the tutor offers help that fits the state:
// a hint when confused, a more interesting take when bored, small steps when
// frustrated. Accepting asks Gemini for that kind of help (POST /api/nudge).

/** Must match NUDGE_STATES in backend/src/gemini.ts. */
export const NUDGE_STATES = ["confused", "bored", "frustrated"] as const;
export type NudgeState = (typeof NUDGE_STATES)[number];

export const NUDGE_RULES = {
  /** Readings in a row that must show trouble (5 s apart → ≈10 s). */
  consecutive: 2,
  /** No offer in the first seconds of a problem. */
  minProblemMs: 10_000,
  /** Quiet time after an offer was answered, or after any hint. */
  cooldownMs: 35_000,
  maxPerProblem: 3,
  /** An unanswered offer fades away after this long. */
  expireMs: 25_000,
};

export interface NudgeOffer {
  id: number;
  state: NudgeState;
  offeredAt: number;
}

export interface Reading {
  /** Client epoch ms at the end of the 5-second window. */
  t: number;
  state: string;
}

export function isNudgeState(state: string): state is NudgeState {
  return (NUDGE_STATES as readonly string[]).includes(state);
}

/**
 * The state to offer help for right now, or null. Only readings taken after
 * the problem started and after the last offer / hint count, so a "no thanks"
 * is never followed by an offer based on the same old readings.
 */
export function nudgeToOffer(
  readings: readonly Reading[],
  ctx: { startedAt: number; now: number; lastHelpAt: number | null; offersSoFar: number },
): NudgeState | null {
  if (ctx.offersSoFar >= NUDGE_RULES.maxPerProblem) return null;
  if (ctx.now - ctx.startedAt < NUDGE_RULES.minProblemMs) return null;
  if (ctx.lastHelpAt !== null && ctx.now - ctx.lastHelpAt < NUDGE_RULES.cooldownMs) return null;
  const since = Math.max(ctx.startedAt, ctx.lastHelpAt ?? 0);
  const fresh = readings.filter((r) => r.t > since).slice(-NUDGE_RULES.consecutive);
  if (fresh.length < NUDGE_RULES.consecutive || !fresh.every((r) => isNudgeState(r.state))) return null;
  return fresh[fresh.length - 1].state as NudgeState;
}

export const NUDGE_COPY: Record<
  NudgeState,
  { title: string; question: string; yes: string; no: string; userSays: string; tag: string; thinking: string }
> = {
  confused: {
    title: "You seem a little confused",
    question: "Want a hint to get unstuck?",
    yes: "Yes, give me a hint",
    no: "I'm okay",
    userSays: "Yes please, a hint would help.",
    tag: "Hint for you",
    thinking: "Finding a clear hint…",
  },
  bored: {
    title: "Feeling a bit bored?",
    question: "Should I make this one more interesting for you?",
    yes: "Yes, make it fun",
    no: "No thanks",
    userSays: "Sure, make it more interesting!",
    tag: "A fresh take",
    thinking: "Spicing it up…",
  },
  frustrated: {
    title: "This one looks tough",
    question: "Shall we break it into small steps together?",
    yes: "Yes, step by step",
    no: "I've got this",
    userSays: "Yes, let's go step by step.",
    tag: "Step by step",
    thinking: "Breaking it down…",
  },
};
