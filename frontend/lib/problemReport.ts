// What happened during one problem, and the numbers on its results screen.

import type { Reading } from "./nudges";
import { DIFFICULTY_POINTS, type Problem } from "./problems";

/**
 * Display order of the model's states. Adjacent pairs pass the colour-vision
 * deficiency check (engaged ↔ frustrated, the red/green pair, are kept apart).
 */
export const STATE_ORDER = ["engaged", "bored", "confused", "frustrated"] as const;
export type ModelState = (typeof STATE_ORDER)[number];

export function isModelState(state: string): state is ModelState {
  return (STATE_ORDER as readonly string[]).includes(state);
}

export type TimelineEventType =
  | "attempt"
  | "hint" // the Hint button's reply arrived
  | "nudge" // help from an accepted check-in arrived
  | "chat" // a tutor chat reply arrived
  | "nudge-offered"
  | "nudge-accepted"
  | "nudge-dismissed"
  | "nudge-expired";

export interface TimelineEvent {
  /** Client epoch ms. */
  t: number;
  type: TimelineEventType;
  state?: string;
  answer?: string;
  correct?: boolean;
}

export interface ProblemRecord {
  problem: Problem;
  /** 1-based position in this session. */
  number: number;
  outcome: "solved" | "skipped";
  startedAt: number;
  endedAt: number;
  readings: Reading[];
  events: TimelineEvent[];
}

export interface Shares {
  /** Readings with a model state ("unknown" is left out). */
  total: number;
  counts: Record<ModelState, number>;
  top: ModelState | null;
}

export interface Comparison {
  kind: "help" | "halves";
  labels: [string, string];
  before: Shares;
  after: Shares;
}

export interface Summary {
  durationMs: number;
  attempts: number;
  wrong: number;
  hints: number;
  nudgesOffered: number;
  stars: 0 | 1 | 2 | 3;
  points: number;
  maxPoints: number;
  /** When the first hint (button or check-in) arrived. */
  firstHelpAt: number | null;
  comparison: Comparison | null;
  insights: string[];
}

export const isHelp = (e: TimelineEvent) => e.type === "hint" || e.type === "nudge";

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function formatSeconds(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : formatClock(ms);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function shares(readings: readonly Reading[]): Shares {
  const counts = Object.fromEntries(STATE_ORDER.map((s) => [s, 0])) as Record<ModelState, number>;
  let total = 0;
  for (const r of readings) {
    if (!isModelState(r.state)) continue;
    counts[r.state]++;
    total++;
  }
  let top: ModelState | null = null;
  for (const s of STATE_ORDER) if (counts[s] > 0 && (top === null || counts[s] > counts[top])) top = s;
  return { total, counts, top };
}

function compare(rec: ProblemRecord, firstHelpAt: number | null): Comparison | null {
  if (firstHelpAt !== null) {
    return {
      kind: "help",
      labels: ["Before help", "After help"],
      before: shares(rec.readings.filter((r) => r.t <= firstHelpAt)),
      after: shares(rec.readings.filter((r) => r.t > firstHelpAt)),
    };
  }
  const modelled = rec.readings.filter((r) => isModelState(r.state));
  if (modelled.length < 2) return null;
  const mid = rec.startedAt + (rec.endedAt - rec.startedAt) / 2;
  return {
    kind: "halves",
    labels: ["First half", "Second half"],
    before: shares(modelled.filter((r) => r.t <= mid)),
    after: shares(modelled.filter((r) => r.t > mid)),
  };
}

function starsFor(outcome: ProblemRecord["outcome"], wrong: number): Summary["stars"] {
  if (outcome === "skipped") return 0;
  if (wrong === 0) return 3;
  return wrong <= 2 ? 2 : 1;
}

export function summarize(rec: ProblemRecord): Summary {
  const attempts = rec.events.filter((e) => e.type === "attempt");
  const wrong = attempts.filter((e) => !e.correct).length;
  const help = rec.events.filter(isHelp);
  const offers = rec.events.filter((e) => e.type.startsWith("nudge-") && e.type !== "nudge-offered");
  const firstHelpAt = help[0]?.t ?? null;
  // Hints are free on purpose: costing points would discourage accepting help.
  const stars = starsFor(rec.outcome, wrong);
  const maxPoints = DIFFICULTY_POINTS[rec.problem.difficulty];
  const comparison = compare(rec, firstHelpAt);

  // In priority order: the check-in, how the state changed, the outcome, wrong answers.
  const insights: string[] = [];
  const firstAnswer = offers[0];
  if (firstAnswer) {
    const offered = rec.events.find((e) => e.type === "nudge-offered");
    const when = offered ? formatClock(offered.t - rec.startedAt) : "";
    const reaction =
      firstAnswer.type === "nudge-accepted"
        ? "you said yes"
        : firstAnswer.type === "nudge-dismissed"
          ? "you chose to keep going on your own"
          : "the offer went unanswered";
    insights.push(`At ${when} the tutor noticed you seemed ${firstAnswer.state ?? "stuck"}, and ${reaction}.`);
  }

  if (comparison) {
    const { before, after } = comparison;
    const [a, b] = comparison.kind === "help" ? ["before the hint", "after it"] : ["in the first half", "in the second"];
    if (before.total > 0 && after.total > 0 && before.top && after.top) {
      const eb = before.counts.engaged / before.total;
      const ea = after.counts.engaged / after.total;
      if (before.top !== after.top) {
        insights.push(`You were mostly ${before.top} ${a}, and mostly ${after.top} ${b}.`);
      } else if (ea - eb >= 0.15) {
        insights.push(`You were engaged ${pct(ea)} of the time ${b}, up from ${pct(eb)}.`);
      } else if (eb - ea >= 0.15) {
        insights.push(`You were engaged less ${b} (${pct(ea)}, down from ${pct(eb)}).`);
      } else {
        insights.push(`Your state stayed about the same: mostly ${after.top} throughout.`);
      }
    }
  }

  if (rec.outcome === "skipped") {
    insights.push("No worries, skipping is part of learning. Have a look at the solution, then try a fresh one.");
  } else if (firstHelpAt === null) {
    insights.push(
      wrong === 0
        ? "Solved on your own, first try, with no hints needed!"
        : `Solved on your own after ${plural(wrong, "wrong answer")}. Persistence pays off!`,
    );
  } else {
    insights.push(`You found the answer ${formatSeconds(rec.endedAt - firstHelpAt)} after the first hint.`);
  }

  if (firstHelpAt !== null && wrong > 0) {
    const before = attempts.filter((e) => !e.correct && e.t <= firstHelpAt).length;
    insights.push(`${plural(before, "wrong answer")} before the hint, ${wrong - before} after it.`);
  }

  return {
    durationMs: rec.endedAt - rec.startedAt,
    attempts: attempts.length,
    wrong,
    hints: help.length,
    nudgesOffered: rec.events.filter((e) => e.type === "nudge-offered").length,
    stars,
    points: Math.round((maxPoints * stars) / 3),
    maxPoints,
    firstHelpAt,
    comparison,
    insights,
  };
}

export interface HistoryEntry {
  outcome: ProblemRecord["outcome"];
  stars: Summary["stars"];
  points: number;
}

export function sessionStats(history: readonly HistoryEntry[]) {
  let streak = 0;
  for (let i = history.length - 1; i >= 0 && history[i].outcome === "solved"; i--) streak++;
  return {
    solved: history.filter((h) => h.outcome === "solved").length,
    points: history.reduce((sum, h) => sum + h.points, 0),
    streak,
  };
}
