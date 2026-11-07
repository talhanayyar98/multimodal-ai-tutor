/**
 * Fills MongoDB with SYNTHETIC /collect pilot sessions — test participants
 * T004, T005, … up to T100 by default — so the training pipeline can be built
 * and debugged before real pilot data exists.
 *
 * Every document has exactly the shape the real /collect flow writes:
 * participants (consent, background answers, browser info, end survey),
 * sessions, 5-second signal windows (the 13-feature vector + keyboard counts),
 * check-in labels, exercise events, hints and chat messages. Exercises,
 * expected answers and correctness come from the real exercise bank and
 * answer checker in frontend/lib/exercises.ts.
 *
 * Underneath, every participant follows a hidden learning-state process:
 * routine blocks drift towards boredom, puzzles cause confusion, the timed
 * challenge causes frustration, failures push towards confusion/frustration.
 * Face and mouse features, answers, tutor use and check-in answers are drawn
 * from that state with per-person baselines, autocorrelated noise and noisy
 * self-reports.
 *
 * This is NOT real data: a model trained on it learns this generator's rules,
 * so it only validates the pipeline. Synthetic participants are stored with
 * `synthetic: true` (and `isTest: true`); exclude them with
 * { synthetic: { $ne: true } } once real data exists.
 *
 *   npm run seed:mock                          # T-codes up to T100
 *   npm run seed:mock -- --until 150           # more participants
 *   npm run seed:mock -- --reset               # replace earlier synthetic data
 *   npm run seed:mock -- --reset --until 0     # only delete synthetic data
 *   npm run seed:mock -- --seed 7              # other random draw (default 42)
 */

import "dotenv/config";
import mongoose from "mongoose";
import {
  createStageQueue,
  DEFAULT_BLOCK_SECONDS,
  expectedText,
  isCorrectNumber,
  parseNumber,
  stageSettings,
  type Exercise,
  type StageId,
} from "../../frontend/lib/exercises";
import { FEATURE_ORDER, type Features } from "../../frontend/lib/features";
import {
  ChatMessage,
  Counter,
  ExerciseEvent,
  Hint,
  Participant,
  SelfReport,
  Session,
  SignalBatch,
} from "../src/models";
import { BLOCK_ORDERS } from "../src/pilotRoutes";

// Mirrors frontend/components/SelfReportProbe.tsx (a React file, so not imported).
const PROBE_INTERVAL_S = 90;
const PROBE_JITTER = 0.15;
const ARM_DELAY_MS = 700;
const WINDOW_MS = 5000; // frontend/hooks/useSignalBatcher.ts
const BLOCK_MS = DEFAULT_BLOCK_SECONDS * 1000;
const COUNTER_ID = "test-participant";

// ---------- command line ----------

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const RESET = process.argv.includes("--reset");
const UNTIL = Number(argValue("until") ?? 100);
const SEED = Number(argValue("seed") ?? 42);

// ---------- seeded randomness ----------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);
// The exercise generators (routine items, shuffles) use Math.random — route
// them through the seeded generator too, so a seed reproduces the same data.
Math.random = rand;

const uniform = (a: number, b: number) => a + (b - a) * rand();
const randInt = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const chance = (p: number) => rand() < p;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];

function normal(mean = 0, sd = 1): number {
  const u = Math.max(rand(), 1e-12);
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

const lognormal = (median: number, sigma: number) => median * Math.exp(sigma * normal());

function poisson(lambda: number): number {
  if (lambda <= 0) return 0;
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rand();
  } while (p > limit);
  return k - 1;
}

function binomial(n: number, p: number): number {
  let k = 0;
  for (let i = 0; i < n; i++) if (rand() < p) k += 1;
  return k;
}

function weighted<K extends string>(weights: Record<K, number>): K {
  const entries = Object.entries(weights) as [K, number][];
  const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
  let r = rand() * total;
  for (const [key, w] of entries) {
    r -= Math.max(0, w);
    if (r < 0) return key;
  }
  return entries[entries.length - 1][0];
}

function weightedItem<T extends { w: number }>(items: readonly T[]): T {
  const total = items.reduce((sum, item) => sum + item.w, 0);
  let r = rand() * total;
  for (const item of items) {
    r -= item.w;
    if (r < 0) return item;
  }
  return items[items.length - 1];
}

function uuid(): string {
  const h = Array.from({ length: 32 }, () => Math.floor(rand() * 16).toString(16));
  h[12] = "4";
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

// ---------- participants ----------

type State = "engaged" | "confused" | "bored" | "frustrated" | "neutral";
const STATES: State[] = ["engaged", "confused", "bored", "frustrated", "neutral"];
type ByState = Record<State, number>;

const STUDY_FIELDS = [
  { name: "Computer Science", q: 0.85, w: 4 },
  { name: "Information Systems", q: 0.6, w: 3 },
  { name: "Mathematical Information Technology", q: 0.9, w: 1.5 },
  { name: "Software Engineering", q: 0.8, w: 1.5 },
  { name: "Cognitive Science", q: 0.6, w: 1.5 },
  { name: "Human-Computer Interaction", q: 0.55, w: 1 },
  { name: "Educational Technology", q: 0.5, w: 1 },
  { name: "Mathematics", q: 0.95, w: 1 },
  { name: "Statistics", q: 0.95, w: 0.7 },
  { name: "Physics", q: 0.9, w: 0.8 },
  { name: "Chemistry", q: 0.7, w: 0.7 },
  { name: "Economics", q: 0.7, w: 1 },
  { name: "Business Administration", q: 0.5, w: 1 },
  { name: "Psychology", q: 0.45, w: 1.5 },
  { name: "Educational Sciences", q: 0.3, w: 1.5 },
  { name: "Biology", q: 0.45, w: 1 },
  { name: "Sport and Health Sciences", q: 0.35, w: 1 },
  { name: "Social Sciences", q: 0.35, w: 1 },
  { name: "Languages and Communication", q: 0.15, w: 0.8 },
  { name: "Music", q: 0.2, w: 0.6 },
  { name: "History", q: 0.15, w: 0.5 },
  { name: "Journalism", q: 0.2, w: 0.5 },
];

const WORK_FIELDS = [
  { name: "Software development", q: 0.8, w: 3 },
  { name: "Data analysis", q: 0.85, w: 1.5 },
  { name: "Teaching", q: 0.4, w: 1.5 },
  { name: "Finance", q: 0.7, w: 1 },
  { name: "Project management", q: 0.45, w: 1 },
  { name: "Research assistant", q: 0.6, w: 1 },
  { name: "Marketing", q: 0.35, w: 1 },
  { name: "Nursing", q: 0.3, w: 0.8 },
  { name: "Graphic design", q: 0.2, w: 0.8 },
];

type Os = "mac" | "win" | "linux";

const BROWSERS: { w: number; os: Os; ua: string }[] = [
  { w: 36, os: "mac", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{v}.0.0.0 Safari/537.36" },
  { w: 13, os: "mac", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15" },
  { w: 4, os: "mac", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:158.0) Gecko/20100101 Firefox/158.0" },
  { w: 25, os: "win", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{v}.0.0.0 Safari/537.36" },
  { w: 9, os: "win", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{v}.0.0.0 Safari/537.36 Edg/{v}.0.0.0" },
  { w: 6, os: "win", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:158.0) Gecko/20100101 Firefox/158.0" },
  { w: 4, os: "linux", ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{v}.0.0.0 Safari/537.36" },
];

const SCREENS: Record<Os, [number, number, number][]> = {
  mac: [[1440, 900, 2], [1512, 982, 2], [1470, 956, 2], [1728, 1117, 2], [1680, 1050, 2], [1920, 1080, 1], [2560, 1440, 1]],
  win: [[1920, 1080, 1], [1536, 864, 1.25], [1366, 768, 1], [1920, 1200, 1], [2560, 1440, 1], [1280, 720, 1.5]],
  linux: [[1920, 1080, 1], [2560, 1440, 1]],
};

const LANGUAGES = { "en-US": 33, "en-GB": 20, "fi-FI": 26, "de-DE": 5, "fr-FR": 4, "es-ES": 4, "zh-CN": 4, "ru-RU": 4 };
const DECIMAL_COMMA = new Set(["fi-FI", "de-DE", "fr-FR", "es-ES", "ru-RU"]);

interface Profile {
  seq: number;
  participantId: string;
  blockOrder: string[];
  intake: {
    age: number;
    gender: string;
    studyLevel: string;
    field: string;
    probabilityBackground: string;
    mathConfidence: number;
    englishComfort: number;
    vision: string;
    pointerDevice: string;
    alertness: number;
  };
  environment: Record<string, string | number>;
  decimalComma: boolean;
  skill: number; // 0..1, drives correctness and time per question
  boredomProneness: number;
  frustrationProneness: number;
  labelNoise: number; // chance a check-in answer differs from the hidden state
  chatty: number; // how readily they ask the tutor
  tabHopper: number; // how readily they switch tabs
  awayFactor: number; // how often they look away from the screen
  cameraSkipped: boolean; // face tracking failed → eye features are zeros
  eye: {
    openBase: number;
    blinkFactor: number;
    dispFactor: number;
    headFactor: number;
    gaze: { lx: number; ly: number; rx: number; ry: number };
  };
  mouse: { activity: number; travel: number; speed: number };
  endEarly: { stageIndex: number; frac: number } | null;
  abandonsPost: boolean;
}

function makeEnvironment(): { env: Record<string, string | number>; os: Os; language: string } {
  const browser = weightedItem(BROWSERS);
  const ua = browser.ua.replaceAll("{v}", String(pick([155, 156, 156, 156])));
  const [screenW, screenH, dpr] = pick(SCREENS[browser.os]);
  const chrome = browser.os === "win" ? randInt(118, 136) : randInt(72, 106);
  const maximized = chance(0.65);
  const language = weighted(LANGUAGES);
  return {
    os: browser.os,
    language,
    env: {
      screenW,
      screenH,
      viewportW: maximized ? screenW : Math.round(screenW * uniform(0.72, 0.96)),
      viewportH: Math.round((screenH - chrome) * (maximized ? 1 : uniform(0.82, 1))),
      devicePixelRatio: dpr,
      userAgent: ua,
      timezone: "Europe/Helsinki",
      language,
    },
  };
}

function makeProfile(seq: number, participantId: string): Profile {
  const { env, os, language } = makeEnvironment();

  const studyLevel = weighted({ bachelor: 36, master: 40, phd: 10, "not-student": 11, other: 3 });
  const [ageLo, ageHi, ageMedian] = {
    bachelor: [19, 28, 22],
    master: [22, 38, 26],
    phd: [25, 45, 30],
    "not-student": [23, 55, 31],
    other: [20, 45, 27],
  }[studyLevel];
  const fieldDef = weightedItem(studyLevel === "not-student" ? WORK_FIELDS : STUDY_FIELDS);
  const q = fieldDef.q;
  const advanced = studyLevel === "master" || studyLevel === "phd" ? 0.15 : 0;
  const probabilityBackground = weighted({
    university: 0.08 + 0.6 * q + advanced,
    school: 0.55,
    none: 0.04 + 0.28 * (1 - q),
  });
  const bg = { none: 0, school: 0.35, university: 0.8 }[probabilityBackground];
  const mathConfidence = Math.round(clamp(1.2 + 2.4 * q + bg + normal(0, 0.65), 1, 5));
  const pointerDevice =
    os === "mac"
      ? weighted({ trackpad: 62, mouse: 35, other: 3 })
      : weighted({ mouse: 72, trackpad: 25, other: 3 });
  const vision = weighted({ none: 55, glasses: 34, contacts: 11 });
  const alertness = Number(weighted({ "1": 3, "2": 12, "3": 33, "4": 39, "5": 13 }));
  const englishComfort = Number(
    weighted(language.startsWith("en") ? { "5": 70, "4": 25, "3": 5, "2": 0 } : { "5": 30, "4": 42, "3": 22, "2": 6 }),
  );

  const skill = clamp(0.1 + 0.1 * (mathConfidence - 1) + 0.18 * bg + 0.15 * q + normal(0, 0.07), 0.05, 0.95);
  const glasses = vision === "glasses";
  const device = { mouse: [1, 1, 1], trackpad: [0.9, 0.75, 0.8], other: [0.95, 1, 1.1] }[pointerDevice] ?? [1, 1, 1];
  const blockOrder = BLOCK_ORDERS[(seq - 1) % BLOCK_ORDERS.length];

  let endEarly: Profile["endEarly"] = null;
  if (chance(0.07)) {
    const wanted = chance(0.6) ? "challenge" : "routine";
    endEarly = { stageIndex: blockOrder.indexOf(wanted) + 1, frac: uniform(0.25, 0.9) };
  }

  return {
    seq,
    participantId,
    blockOrder,
    intake: {
      age: Math.round(clamp(lognormal(ageMedian, 0.12), ageLo, ageHi)),
      gender: weighted({ woman: 46, man: 47, "non-binary": 3, "prefer-not": 4 }),
      studyLevel,
      field: fieldDef.name,
      probabilityBackground,
      mathConfidence,
      englishComfort,
      vision,
      pointerDevice,
      alertness,
    },
    environment: env,
    decimalComma: DECIMAL_COMMA.has(language),
    skill,
    boredomProneness: rand() ** 0.9,
    frustrationProneness: rand(),
    labelNoise: clamp(lognormal(0.14, 0.5), 0.03, 0.45),
    chatty: rand() ** 1.4,
    tabHopper: rand() ** 2,
    awayFactor: lognormal(1, 0.5),
    cameraSkipped: chance(0.02),
    eye: {
      openBase: uniform(0.985, 1.075) + 0.012 * (alertness - 3) - (glasses ? 0.02 : 0),
      blinkFactor: uniform(0.5, 1.6) * (glasses ? 0.8 : 1),
      dispFactor: uniform(0.7, 1.4) * (glasses ? 1.15 : 1),
      headFactor: uniform(0.7, 1.4),
      gaze: {
        lx: normal(0, 0.06),
        ly: normal(-0.34, 0.05),
        rx: normal(-0.06, 0.06),
        ry: normal(-0.26, 0.04),
      },
    },
    mouse: { activity: device[0], travel: device[1] * uniform(0.75, 1.3), speed: device[2] * uniform(0.75, 1.3) },
    endEarly,
    abandonsPost: chance(0.02),
  };
}

// ---------- the hidden learning state ----------

type Phase = "setup" | "intro" | StageId;

interface Ctx {
  phase: Phase;
  stageStart: number;
  stageLen: number;
  stageIndex: number;
  pressure: number; // recent failures / timeouts (decays per question)
  flow: number; // recent successes (decays per question)
}

/** Unnormalized chance of each state, given what the learner is doing. */
function targetWeights(p: Profile, c: Ctx, t: number): ByState {
  const frac = clamp((t - c.stageStart) / c.stageLen, 0, 1);
  const fatigue = 0.18 * c.stageIndex;
  const s = p.skill;
  const B = p.boredomProneness;
  const R = p.frustrationProneness;
  const P = c.pressure;
  const F = c.flow;
  switch (c.phase) {
    case "setup":
      return { engaged: 3, neutral: 4, confused: 0.5, bored: 0.3, frustrated: 0.1 };
    case "intro":
      return { engaged: 2, neutral: 3, confused: 0.3 + 0.3 * P, bored: 0.5 + fatigue + 0.5 * B, frustrated: 0.15 + 0.5 * P * R };
    case "warmup":
      return { engaged: 4.5, neutral: 3, confused: 0.5, bored: 0.4, frustrated: 0.1 };
    case "routine":
      return {
        engaged: 0.3 + 1.6 * (1 - frac) + 0.3 * F,
        neutral: 1.0,
        confused: 0.15 + 0.4 * P,
        bored: (0.8 + 4.0 * frac) * (0.5 + 1.2 * B) + fatigue,
        frustrated: 0.08 + 0.5 * P * R + 0.6 * frac * B * R,
      };
    case "practice":
      return {
        engaged: 3.2 * (0.4 + s) + 1.2 * F,
        neutral: 1,
        confused: 1.4 * (1.2 - s) + 1.2 * P,
        bored: 0.25 + 0.8 * frac * B * (0.5 + s) + 0.5 * fatigue,
        frustrated: 0.15 + 1.4 * P * R,
      };
    case "puzzles":
      return {
        engaged: 1.6 * (0.4 + s) + 1.6 * F,
        neutral: 0.6,
        confused: 3.4 * (1.25 - 0.5 * s) + 0.8 * P,
        bored: 0.2 + 0.5 * fatigue,
        frustrated: 0.3 + 1.2 * P * R,
      };
    case "challenge":
      return {
        engaged: 1.0 * (0.3 + s) + 1.6 * F,
        neutral: 0.4,
        confused: 1.8 * (1.1 - s) + 0.5 * P,
        bored: 0.15 + 0.4 * fatigue,
        frustrated: 2.2 * (1.15 - s) * (0.5 + R) + 1.8 * P,
      };
  }
}

const DWELL_MEDIAN_MS: ByState = { engaged: 45000, confused: 35000, bored: 60000, frustrated: 30000, neutral: 40000 };

const dwell = (state: State) => clamp(lognormal(DWELL_MEDIAN_MS[state], 0.45), 12000, 150000);

interface Span<T = undefined> {
  start: number;
  end: number;
  value: T;
}

class Latent {
  spans: Span<State>[] = [];
  state: State;
  private since: number;
  private until: number;

  constructor(
    private readonly profile: Profile,
    private readonly ctx: Ctx,
    t: number,
  ) {
    this.state = weighted(targetWeights(profile, ctx, t));
    this.since = t;
    this.until = t + dwell(this.state);
  }

  advanceTo(t: number): void {
    while (this.until <= t) this.resample(this.until, 2.2);
  }

  /** React to an event (an answer, a timeout, a new block) — maybe change state now. */
  nudge(t: number, probability: number): void {
    this.advanceTo(t);
    if (chance(probability)) this.resample(t, 1.2);
  }

  close(t: number): void {
    this.advanceTo(t);
    this.spans.push({ start: this.since, end: t, value: this.state });
  }

  at(t: number): State {
    let lo = 0;
    let hi = this.spans.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.spans[mid].end <= t) lo = mid + 1;
      else hi = mid;
    }
    return this.spans[lo]?.value ?? this.state;
  }

  private resample(t: number, stickiness: number): void {
    const w = targetWeights(this.profile, this.ctx, t);
    w[this.state] *= stickiness;
    const next = weighted(w);
    if (next !== this.state) {
      this.spans.push({ start: this.since, end: t, value: this.state });
      this.state = next;
      this.since = t;
    }
    this.until = t + dwell(next);
  }
}

// ---------- answers ----------

type NumberAnswer = Extract<Exercise["answer"], { kind: "number" }>;

/** p(correct on the first attempt) = a + b × skill. */
const EASE: Record<string, [number, number]> = {
  "warmup-coin": [0.95, 0.04],
  "warmup-die": [0.84, 0.14],
  "practice-ace-or-heart": [0.15, 0.6],
  "practice-two-red-no-replacement": [0.2, 0.6],
  "practice-at-least-one-six-2": [0.15, 0.6],
  "practice-coins-exactly-2-of-3": [0.3, 0.55],
  "practice-football-or-chess": [0.3, 0.55],
  "practice-expected-die": [0.45, 0.45],
  "practice-lock-code": [0.5, 0.4],
  "practice-arrange-abcd": [0.45, 0.45],
  "practice-four-heads": [0.45, 0.45],
  "practice-dice-doubles": [0.4, 0.5],
  "puzzle-monty-hall": [0.1, 0.4],
  "puzzle-disease-test": [0.03, 0.3],
  "puzzle-boy-girl": [0.12, 0.35],
  "puzzle-birthday-23": [0.25, 0.45],
  "puzzle-gamblers-fallacy": [0.75, 0.2],
  "puzzle-three-cards": [0.12, 0.35],
  "puzzle-three-dice-9-or-10": [0.3, 0.25],
  "puzzle-wait-for-six": [0.35, 0.45],
  "puzzle-socks": [0.55, 0.35],
  "puzzle-coin-sequences": [0.5, 0.4],
};

const STAGE_EASE: Record<StageId, [number, number]> = {
  warmup: [0.9, 0.08],
  routine: [0.88, 0.1],
  practice: [0.3, 0.55],
  puzzles: [0.2, 0.4],
  challenge: [0.05, 0.45],
};

const STATE_EASE: ByState = { engaged: 0.05, neutral: 0, confused: -0.08, bored: -0.05, frustrated: -0.1 };

/** Typical wrong answers for the fixed items (filtered through the real checker). */
const MISCONCEPTIONS: Record<string, string[]> = {
  "warmup-coin": ["1/3", "2"],
  "practice-dice-sum-7": ["1/12", "1/11", "7/36"],
  "practice-dice-sum-10-plus": ["3/36", "1/12", "3/11"],
  "practice-coins-exactly-2-of-3": ["2/3", "1/4", "1/2"],
  "practice-at-least-one-six-2": ["1/3", "2/6", "12/36"],
  "practice-two-red-no-replacement": ["9/25", "3/5", "6/25"],
  "practice-ace-or-heart": ["17/52", "1/52", "1/4"],
  "practice-dice-doubles": ["1/36", "1/12"],
  "practice-football-or-chess": ["30/30", "1", "18/30", "6/30"],
  "practice-expected-die": ["3", "4", "21"],
  "practice-lock-code": ["1/30", "1/100", "1/720"],
  "practice-arrange-abcd": ["16", "12", "4"],
  "practice-four-heads": ["1/8", "1/4", "4/16"],
  "puzzle-monty-hall": ["1/2", "0.5", "1/3", "50%"],
  "puzzle-disease-test": ["0.9", "90%", "0.81", "0.5", "0.09%"],
  "puzzle-boy-girl": ["1/2", "1/4", "0.5"],
  "puzzle-gamblers-fallacy": ["1/64", "1/128", "1/7"],
  "puzzle-three-cards": ["1/2", "1/3", "0.5"],
  "puzzle-wait-for-six": ["3", "3.5", "5"],
  "puzzle-socks": ["2", "11", "10"],
  "challenge-two-sixes-in-five": ["1/36", "0.0278", "2/5", "10/36"],
  "challenge-five-hearts": ["1/1024", "0.00098", "0.25", "5/52"],
  "challenge-pin-distinct": ["0.6", "0.7", "0.3024"],
  "challenge-birth-months-6": ["0.5", "6/12", "0.223"],
  "challenge-three-dice-sum-10": ["1/6", "6/216", "1/10"],
  "challenge-committee": ["0.5", "5/9", "10/84"],
  "challenge-eight-heads-of-ten": ["0.8", "3/10", "45/1024"],
  "challenge-at-least-one-red": ["0.4", "3/10", "1/6"],
  "challenge-two-aces": ["1/169", "8/52", "1/13"],
  "challenge-one-pair": ["0.5", "0.2", "1/13"],
  "challenge-true-false-guessing": ["0.7", "0.3", "120/1024"],
  "challenge-more-than-four-rolls": ["4/6", "1/6", "0.518"],
};

/** How often each wrong option is picked, by option index (the correct one gets 0). */
const CHOICE_WRONG: Record<string, number[]> = {
  "warmup-die": [0.6, 0.4, 0],
  "puzzle-birthday-23": [0.55, 0.3, 0, 0.15],
  "puzzle-three-dice-9-or-10": [0.45, 0, 0.55],
  "puzzle-coin-sequences": [0.35, 0.65, 0],
};

function toFraction(v: number, maxDen = 100000): { num: number; den: number } | null {
  let [h1, h0, k1, k0] = [1, 0, 0, 1];
  let x = v;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(x);
    [h1, h0] = [a * h1 + h0, h1];
    [k1, k0] = [a * k1 + k0, k1];
    if (k1 > maxDen) return null;
    if (Math.abs(h1 / k1 - v) < 1e-9) return { num: h1, den: k1 };
    x = 1 / (x - a);
    if (!Number.isFinite(x)) return null;
  }
  return null;
}

function hasOnlySmallFactors(n: number): boolean {
  for (const f of [2, 3, 5, 7, 11, 13, 17]) while (n % f === 0) n /= f;
  return n === 1;
}

const decimalText = (v: number) => String(Number(v >= 0.05 ? v.toFixed(3) : v.toPrecision(3)));
const percentText = (v: number) => `${Number((v * 100).toPrecision(3))}%`;

/** Fractions a person would write: the ones in the worked solution, plus the reduced form. */
function naturalFractions(item: Exercise, v: number): string[] {
  const out = new Set<string>();
  for (const m of item.solution.matchAll(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/g)) {
    const a = Number(m[1].replace(/,/g, ""));
    const b = Number(m[2].replace(/,/g, ""));
    if (b > 0 && Math.abs(a / b - v) < 1e-9) out.add(`${a}/${b}`);
  }
  const f = toFraction(v);
  if (f && f.den <= 10000 && hasOnlySmallFactors(f.den)) out.add(`${f.num}/${f.den}`);
  return [...out];
}

function checks(answer: NumberAnswer, text: string): boolean {
  const value = parseNumber(text);
  return value !== null && isCorrectNumber(answer, value);
}

function withLocale(text: string, decimalComma: boolean): string {
  return decimalComma && text.includes(".") && chance(0.4) ? text.replace(".", ",") : text;
}

function correctAnswerText(item: Exercise, decimalComma: boolean): string {
  const answer = item.answer as NumberAnswer;
  const v = answer.value;
  let options: { text: string; w: number }[];
  if (Number.isInteger(v) || v > 1) {
    options = [{ text: String(v), w: 1 }];
  } else {
    const fractions = naturalFractions(item, v);
    options = [
      ...fractions.map((text) => ({ text, w: 0.55 / fractions.length })),
      { text: decimalText(v), w: 0.3 },
      { text: percentText(v), w: 0.15 },
    ];
  }
  const valid = options.filter((o) => checks(answer, o.text));
  const text = valid.length ? weightedItem(valid).text : String(Number(v.toPrecision(4)));
  return withLocale(text, decimalComma);
}

/** Plausible mistakes for generated items, read from the item id. */
function generatedMistakes(item: Exercise, v: number): string[] {
  const id = item.id;
  const nums = (id.match(/\d+/g) ?? []).map(Number);
  if (id.startsWith("routine-marbles-")) {
    const [r, b] = nums;
    return [`${r}/${b}`, `${b}/${r + b}`];
  }
  if (id.startsWith("routine-die-greater-")) return [`${7 - nums[0]}/6`, `${nums[0]}/6`];
  if (id.startsWith("routine-spinner-")) return [`${Math.ceil(nums[0] / 2)}/${nums[0]}`, `1/${nums[0]}`, "1/2"];
  if (id.startsWith("routine-suit-")) return ["1/13", "1/52"];
  if (id.startsWith("routine-rank-")) return ["1/52", "13/52", "1/4"];
  if (id.startsWith("routine-two-")) return ["1/2", "1/8", "2/4"];
  if (id.startsWith("practice-gen-dice-sum-")) return ["1/11", `${nums[0]}/36`, "1/6"];
  if (id.startsWith("practice-gen-at-least-one-six-")) return [`${nums[0]}/6`, "1/6"];
  if (id.startsWith("practice-gen-coins-exactly-")) return [`${nums[0]}/4`, "1/16"];
  if (id.startsWith("practice-gen-two-blue-")) {
    const [r, b] = nums;
    return [decimalText((b / (r + b)) ** 2), `${b}/${r + b}`];
  }
  return genericMistakes(v);
}

function genericMistakes(v: number): string[] {
  if (Number.isInteger(v) || v > 1) {
    return [v - 1, v + 1, v * 2, Math.floor(v / 2)].filter((x) => x > 0).map(String);
  }
  const out = [decimalText(1 - v), decimalText(Math.min(1, v * 2)), decimalText(v / 2)];
  const f = toFraction(v, 10000);
  if (f) {
    out.push(`${f.num + 1}/${f.den}`, `${f.num}/${f.den + 1}`);
    if (f.num > 1) out.push(`${f.num - 1}/${f.den}`);
  }
  return out;
}

function wrongAnswerText(item: Exercise, decimalComma: boolean, tried: number[]): string {
  const answer = item.answer as NumberAnswer;
  const candidates = [...(MISCONCEPTIONS[item.id] ?? generatedMistakes(item, answer.value))];
  if (chance(0.2) || tried.length) candidates.push(...genericMistakes(answer.value));
  const wrong = candidates.filter((text) => {
    const value = parseNumber(text);
    return (
      value !== null &&
      !isCorrectNumber(answer, value) &&
      !tried.some((t) => Math.abs(t - value) < 1e-6)
    );
  });
  const text = wrong.length ? pick(wrong) : decimalText(answer.value * 1.5 + 0.05);
  return withLocale(text, decimalComma);
}

function wrongChoice(item: Exercise): number {
  const answer = item.answer as Extract<Exercise["answer"], { kind: "choice" }>;
  const weights = CHOICE_WRONG[item.id] ?? answer.options.map((_, i) => (i === answer.correct ? 0 : 1));
  return weightedItem(weights.map((w, i) => ({ w, i }))).i;
}

// ---------- tutor messages ----------

interface Topic {
  hints: string[];
  qa: { q: string; a: string }[];
}

const GENERIC_QA = [
  {
    q: "I'm stuck, where do I even start?",
    a: "Start by writing down what's random here and how many equally likely outcomes there are. Then count the ones that match what the question asks for.",
  },
  {
    q: "can you explain this more simply?",
    a: "Sure — ignore the numbers for a moment and describe in words which outcomes count as a success. Then we can count them together.",
  },
  {
    q: "is my answer close?",
    a: "Let's check it together: what did you count as the favourable outcomes, and what did you use as the total?",
  },
];

const TOPICS: Record<string, Topic> = {
  basic: {
    hints: [
      "Count the outcomes you want, then divide by the total number of equally likely outcomes.",
      "Write the probability as favourable outcomes over all possible outcomes — what are those two numbers here?",
    ],
    qa: [{ q: "do I just divide the two numbers?", a: "Almost — divide the number of outcomes you want by the total number of equally likely outcomes. What's the total here?" }],
  },
  diceSum: {
    hints: [
      "Picture a 6 × 6 grid of all pairs of rolls and mark the pairs with the sum you need.",
      "Order matters: (4, 6) and (6, 4) are different outcomes. How many pairs give each sum?",
    ],
    qa: [
      { q: "is (3,4) the same as (4,3)?", a: "No — imagine the dice have different colours. (3, 4) and (4, 3) are two separate outcomes out of 36." },
      { q: "how many outcomes are there in total?", a: "Each die has 6 faces, so there are 6 × 6 = 36 equally likely ordered pairs." },
    ],
  },
  complement: {
    hints: [
      "'At least one' is usually easier through the complement: what's the chance it never happens?",
      "Find the probability of the opposite event first, then subtract it from 1.",
    ],
    qa: [{ q: "why can't I just add the probabilities?", a: "Adding double-counts the cases where it happens more than once. Try the complement instead: what's the probability it doesn't happen at all?" }],
  },
  binomial: {
    hints: [
      "Count the sequences with exactly the number of successes you need, then divide by the total number of sequences.",
      "How many ways can you choose which tries are the successes? Combinations help here.",
    ],
    qa: [{ q: "do I need combinations for this?", a: "Yes — C(n, k) counts the ways to place k successes among n tries. Multiply it by the probability of one such sequence." }],
  },
  noReplacement: {
    hints: [
      "After the first draw there is one item fewer — the second probability changes.",
      "Multiply the probability of the first draw by the probability of the second, given the first.",
    ],
    qa: [{ q: "what does without replacement mean?", a: "The first item isn't put back, so the second draw has one item fewer — and one fewer of the kind you drew." }],
  },
  overlap: {
    hints: ["Be careful not to count the overlap twice.", "Add the two groups, then subtract what belongs to both."],
    qa: [{ q: "can I just add both numbers?", a: "Close! Some cases are in both groups and would be counted twice. Subtract the overlap once." }],
  },
  expected: {
    hints: [
      "Average the possible values, each weighted by its probability.",
      "If each try succeeds with probability p, how many tries would you expect on average?",
    ],
    qa: [{ q: "what is expected value exactly?", a: "It's the long-run average: multiply each outcome by its probability and add them up." }],
  },
  counting: {
    hints: ["Count the choices for each position and multiply them.", "Does order matter here? That decides between arrangements and combinations."],
    qa: [{ q: "when do I use combinations?", a: "If order doesn't matter — a committee, a hand of cards — use combinations. If it does — a code, a ranking — count arrangements." }],
  },
  bayes: {
    hints: [
      "Imagine 1000 people and count how many test positive in each group.",
      "Compare the sick people who test positive with everyone who tests positive.",
    ],
    qa: [{ q: "isn't it just 90%?", a: "90% is the chance of a positive test if you're sick. The question asks the reverse — try counting with 1000 people." }],
  },
  monty: {
    hints: [
      "How often is your first pick right — and does the host's choice change that?",
      "The host always opens a goat door. What happens in the 2/3 of games where your first pick was wrong?",
    ],
    qa: [{ q: "isn't it 50/50 once a door is open?", a: "It feels like it, but the host's choice isn't random — he never opens the car's door. Play it out for each place the car could be." }],
  },
  cases: {
    hints: [
      "List all the equally likely cases first, then cross out the ones the new information rules out.",
      "Which cases are still possible, and in how many of them does the event happen?",
    ],
    qa: [{ q: "why isn't it 1/2?", a: "Write out every equally likely case and remove the impossible ones. The cases that remain aren't split evenly the way intuition suggests." }],
  },
  birthday: {
    hints: [
      "Count pairs of people, not people — there are more pairs than you'd think.",
      "Find the probability that everyone is different, then use the complement.",
    ],
    qa: [{ q: "that seems like way too few people?", a: "It does! But 23 people form 253 different pairs, and every pair is a chance for a match." }],
  },
  independence: {
    hints: ["Does the coin remember earlier flips?", "Each flip is independent — look at one exact sequence at a time."],
    qa: [{ q: "after so many heads shouldn't tails be due?", a: "That's the gambler's fallacy — the coin has no memory, so every flip has the same probability as before." }],
  },
  pigeonhole: {
    hints: ["What's the worst case — how long can you avoid a match?", "How many socks could you draw without getting a pair?"],
    qa: [],
  },
  threeDice: {
    hints: [
      "Count the ordered outcomes for each sum, not just the combinations of numbers.",
      "A combination like (3, 3, 3) happens in only one order, but (1, 3, 6) in six.",
    ],
    qa: [{ q: "both have six combinations, so equal?", a: "Combinations with repeated numbers have fewer orderings. Count ordered outcomes out of 216." }],
  },
};

function topicFor(id: string): Topic {
  if (/monty/.test(id)) return TOPICS.monty;
  if (/disease/.test(id)) return TOPICS.bayes;
  if (/boy-girl|three-cards/.test(id)) return TOPICS.cases;
  if (/birthday|birth-months/.test(id)) return TOPICS.birthday;
  if (/gamblers|coin-sequences/.test(id)) return TOPICS.independence;
  if (/socks/.test(id)) return TOPICS.pigeonhole;
  if (/three-dice/.test(id)) return TOPICS.threeDice;
  if (/at-least-one|more-than-four|pin-distinct/.test(id)) return TOPICS.complement;
  if (/dice-sum|doubles/.test(id)) return TOPICS.diceSum;
  if (/no-replacement|two-red|two-blue|two-aces/.test(id)) return TOPICS.noReplacement;
  if (/ace-or-heart|football-or-chess/.test(id)) return TOPICS.overlap;
  if (/expected|wait-for-six/.test(id)) return TOPICS.expected;
  if (/arrange|lock-code|committee|five-hearts|one-pair/.test(id)) return TOPICS.counting;
  if (/coins|heads|two-sixes|true-false/.test(id)) return TOPICS.binomial;
  return TOPICS.basic;
}

// ---------- end survey ----------

const DISTRACTIONS = [
  "A bit of noise from the corridor.",
  "My phone buzzed a couple of times.",
  "Someone walked into the room once.",
  "Notifications on my laptop.",
  "Construction noise outside.",
  "I checked a message during one of the parts.",
  "My roommate was talking in the background.",
  "I was a little tired, otherwise nothing.",
];

const COMMENTS = {
  bored: [
    "The routine questions got repetitive quickly.",
    "One part was really monotonous, I started to drift off.",
  ],
  hard: [
    "The two-minute limit made the hard questions stressful.",
    "Some questions really needed a calculator.",
    "A worked example before the hard part would have helped.",
  ],
  tutor: ["The tutor hints were helpful.", "I liked being able to ask the tutor questions."],
  labels: [
    "I wasn't always sure which check-in option fit — often between confused and frustrated.",
    "Sometimes none of the check-in options really matched.",
  ],
  early: ["Had to stop early, sorry.", "The last part was too hard for me so I stopped."],
  general: [
    "The puzzles were fun, especially the game-show one.",
    "Interesting study, good luck with the thesis!",
    "The check-in pop-up sometimes interrupted my typing.",
    "Nice interface, easy to follow.",
    "I didn't realise at first that fractions could be typed.",
  ],
};

function postSurvey(p: Profile, endedEarly: boolean) {
  const post: { checkinFit: number; distractions?: string; comments?: string } = {
    checkinFit: Math.round(clamp(5.2 - 7 * p.labelNoise + normal(0, 0.5), 1, 5)),
  };
  if (chance(0.15 + 0.6 * p.tabHopper)) post.distractions = pick(DISTRACTIONS);
  else if (chance(0.15)) post.distractions = pick(["None.", "No", "Nothing really."]);
  const pool = [...COMMENTS.general];
  if (p.boredomProneness > 0.6) pool.push(...COMMENTS.bored, ...COMMENTS.bored);
  if (p.skill < 0.4) pool.push(...COMMENTS.hard, ...COMMENTS.hard);
  if (p.chatty > 0.5) pool.push(...COMMENTS.tutor);
  if (p.labelNoise > 0.22) pool.push(...COMMENTS.labels, ...COMMENTS.labels);
  if (endedEarly) pool.push(...COMMENTS.early, ...COMMENTS.early, ...COMMENTS.early);
  if (chance(endedEarly ? 0.7 : 0.35)) post.comments = pick(pool);
  return post;
}

// ---------- signal features ----------

const EYE = {
  open: { engaged: 0.015, confused: -0.035, bored: -0.085, frustrated: -0.02, neutral: 0 } as ByState,
  blinks: { engaged: 0.16, confused: 0.29, bored: 0.46, frustrated: 0.39, neutral: 0.25 } as ByState, // per 5 s
  disp: { engaged: 0.058, confused: 0.095, bored: 0.115, frustrated: 0.095, neutral: 0.068 } as ByState,
  head: { engaged: 0.024, confused: 0.038, bored: 0.06, frustrated: 0.07, neutral: 0.032 } as ByState,
  shift: { engaged: 0.04, confused: 0.055, bored: 0.13, frustrated: 0.14, neutral: 0.055 } as ByState, // posture change
  away: { engaged: 0.015, confused: 0.025, bored: 0.13, frustrated: 0.06, neutral: 0.03 } as ByState, // looks away
  gazeDy: { engaged: 0, confused: -0.02, bored: 0.05, frustrated: 0.01, neutral: 0 } as ByState,
  gazeSd: { engaged: 0.03, confused: 0.045, bored: 0.08, frustrated: 0.055, neutral: 0.035 } as ByState,
};

const MOUSE = {
  activity: { engaged: 0.26, confused: 0.18, bored: 0.06, frustrated: 0.45, neutral: 0.22 } as ByState,
  bucketPx: { engaged: 70, confused: 45, bored: 115, frustrated: 150, neutral: 60 } as ByState,
  speed: { engaged: 480, confused: 320, bored: 560, frustrated: 1350, neutral: 420 } as ByState,
  extraClicks: { engaged: 0.12, confused: 0.15, bored: 0.12, frustrated: 0.6, neutral: 0.1 } as ByState,
};

function overlap(spans: Span[], a: number, b: number): number {
  let total = 0;
  for (const s of spans) total += Math.max(0, Math.min(s.end, b) - Math.max(s.start, a));
  return total;
}

// ---------- one participant's session ----------

type Doc = Record<string, unknown>;

interface Simulated {
  participant: Doc;
  session: Doc;
  windows: Doc[];
  reports: Doc[];
  events: Doc[];
  hints: Doc[];
  chats: Doc[];
  stats: { attempts: Record<string, [number, number]>; endedEarly: boolean };
}

type Outcome = "correct" | "incorrect" | "skipped" | "timeout";
type ItemEnd = "next" | "time" | "early";

function simulate(p: Profile, createdAt: number): Simulated {
  const sessionId = uuid();
  const { participantId } = p;
  const sessionCreated = createdAt + randInt(10, 25);
  let now = sessionCreated;
  let context: { blockId?: StageId; exerciseId?: string } = {};
  let nextProbe: number | null = null;

  const clicks: number[] = [];
  const keys: { t: number; del: boolean }[] = [];
  const hidden: Span[] = [];
  const popups: Span[] = [];
  const tutorReading: Span[] = [];
  const reports: Doc[] = [];
  const events: Doc[] = [];
  const hints: Doc[] = [];
  const chats: Doc[] = [];
  const attempts: Record<string, [number, number]> = {};

  const ctx: Ctx = { phase: "setup", stageStart: now, stageLen: 60000, stageIndex: 0, pressure: 0, flow: 0 };
  const latent = new Latent(p, ctx, now);

  const setNow = (t: number) => {
    now = Math.max(now, t);
    latent.advanceTo(now);
  };

  const enter = (next: Partial<Ctx>) => {
    latent.advanceTo(now);
    Object.assign(ctx, next);
  };

  const log = (type: string, fields: Doc = {}, t = now) => {
    events.push({ sessionId, participantId, type, ...fields, t, receivedAt: new Date(t + randInt(5, 35)) });
  };

  const typeKeys = (from: number, duration: number, total: number, deletes: number) => {
    for (let i = 0; i < total; i++) {
      keys.push({ t: from + (duration * (i + 0.5)) / total, del: i < deletes });
    }
  };

  // ----- check-in pop-up (SelfReportProbe) -----

  const nextProbeFrom = (t: number) => t + Math.round(PROBE_INTERVAL_S * 1000 * (1 + uniform(-PROBE_JITTER, PROBE_JITTER)));

  const NEIGHBOURS: Record<State, State[]> = {
    engaged: ["neutral", "confused"],
    confused: ["frustrated", "engaged", "neutral"],
    bored: ["neutral", "frustrated"],
    frustrated: ["confused", "bored"],
    neutral: ["engaged", "bored"],
  };

  const selfReport = (truth: State): State => {
    if (!chance(p.labelNoise)) return truth;
    if (truth !== "neutral" && chance(0.35)) return "neutral";
    return pick(NEIGHBOURS[truth]);
  };

  const probe = () => {
    latent.advanceTo(now);
    const promptedAt = now;
    const slow = latent.state === "bored" || latent.state === "frustrated" ? 1.3 : 1;
    const answeredAt = promptedAt + Math.round(clamp(lognormal(2600 * slow, 0.5), ARM_DELAY_MS + 200, 20000));
    popups.push({ start: promptedAt, end: answeredAt, value: undefined });
    clicks.push(answeredAt);
    reports.push({
      sessionId,
      participantId,
      state: selfReport(latent.state),
      promptedAt,
      answeredAt,
      ...context,
      receivedAt: new Date(answeredAt + randInt(6, 40)),
    });
    setNow(answeredAt);
    nextProbe = nextProbeFrom(answeredAt);
  };

  /**
   * Spend `ms` doing something. A check-in pop-up that comes due pauses the
   * learner (the clock keeps running). Returns false if `deadline` passed first.
   */
  const act = (ms: number, deadline = Infinity): boolean => {
    let remaining = Math.max(0, Math.round(ms));
    for (;;) {
      if (now >= deadline) return false;
      const target = now + remaining;
      if (nextProbe !== null && nextProbe <= Math.min(target, deadline)) {
        remaining = Math.max(0, target - nextProbe);
        now = nextProbe;
        probe();
        continue;
      }
      if (target > deadline) {
        setNow(deadline);
        return false;
      }
      setNow(target);
      return true;
    }
  };

  // Leaving the tab (logged during the task only, like the real page).
  const HIDE: ByState = { bored: 0.35, neutral: 0.08, frustrated: 0.1, confused: 0.04, engaged: 0.03 };
  const maybeHideTab = (deadline: number) => {
    if (!chance(p.tabHopper * HIDE[latent.state])) return;
    const duration = clamp(lognormal(9000, 0.8), 1500, 90000);
    if (nextProbe !== null && nextProbe < now + duration + 1500) return;
    if (now + duration + 1000 >= deadline) return;
    log("tab-hidden", { ...context });
    hidden.push({ start: now, end: now + duration, value: undefined });
    setNow(now + duration);
    log("tab-visible", { ...context });
  };

  // ----- tutor chat / hint -----

  const askTutor = (item: Exercise, deadline: number): boolean => {
    const topic = topicFor(item.id);
    if (chance(0.55)) {
      if (!act(lognormal(3500, 0.5), deadline)) return false;
      clicks.push(now); // ✦ Hint
      if (!act(uniform(1800, 4500), deadline)) return false; // waiting for the model
      hints.push({ sessionId, text: pick(topic.hints), state: "unknown", abGroup: "control", problem: item.text, createdAt: new Date(now) });
      const read = lognormal(7000, 0.35);
      tutorReading.push({ start: now, end: now + read, value: undefined });
      return act(read, deadline);
    }
    const qa = pick(topic.qa.length && chance(0.75) ? topic.qa : GENERIC_QA);
    const typos = poisson(qa.q.length * 0.03);
    const total = qa.q.length + 2 * typos + 1;
    const duration = total * lognormal(210, 0.3);
    typeKeys(now, duration, total, typos);
    if (!act(duration, deadline)) return false;
    if (chance(0.3)) clicks.push(now); // Send (otherwise Enter)
    if (!act(uniform(2500, 6500), deadline)) return false;
    chats.push(
      { sessionId, role: "student", text: qa.q, state: "unknown", createdAt: new Date(now) },
      { sessionId, role: "tutor", text: qa.a, state: "unknown", createdAt: new Date(now) },
    );
    const read = lognormal(9000, 0.35);
    tutorReading.push({ start: now, end: now + read, value: undefined });
    return act(read, deadline);
  };

  // ----- one exercise -----

  const THINK_MS: Record<StageId, number> = { warmup: 14000, routine: 9500, practice: 42000, puzzles: 55000, challenge: 70000 };
  const ASK: ByState = { confused: 0.45, frustrated: 0.3, engaged: 0.1, neutral: 0.08, bored: 0.04 };
  const ASK_STAGE: Record<StageId, number> = { warmup: 0, routine: 0.05, practice: 0.8, puzzles: 1.2, challenge: 1 };
  const GIVE_UP: ByState = { frustrated: 0.12, bored: 0.1, confused: 0.04, engaged: 0.02, neutral: 0.03 };
  const SKIP_AFTER_WRONG: ByState = { frustrated: 0.3, bored: 0.25, confused: 0.08, engaged: 0.02, neutral: 0.05 };

  const thinkMs = (stage: StageId, item: Exercise, tries: number) => {
    const s = latent.state;
    const stateFactor = s === "confused" ? 1.3 : s === "frustrated" ? 0.9 : s === "bored" ? (stage === "routine" ? 0.7 : 0.85) : 1;
    const kind = item.answer.kind === "choice" ? 0.7 : 1;
    const retry = tries > 0 ? 0.45 : 1;
    return Math.max(2500, lognormal(THINK_MS[stage] * (1.35 - 0.6 * p.skill) * stateFactor * kind * retry, 0.45));
  };

  const pCorrect = (stage: StageId, item: Exercise, tries: number) => {
    const [a, b] = EASE[item.id] ?? STAGE_EASE[stage];
    let p0 = a + b * p.skill + STATE_EASE[latent.state] - (stage === "routine" && latent.state === "bored" ? 0.03 : 0);
    if (tries > 0) p0 = stage === "challenge" ? 0.1 + 0.6 * p0 : 0.15 + 0.7 * p0;
    return clamp(p0, 0.02, 0.99);
  };

  const runItem = (stage: StageId, item: Exercise, stageEnd: number, earlyAt: number): ItemEnd => {
    const settings = stageSettings(stage);
    context = { blockId: stage, exerciseId: item.id };
    log("shown", { blockId: stage, exerciseId: item.id, text: item.text, expected: expectedText(item.answer) });
    const itemEnd = settings.perItemS ? now + settings.perItemS * 1000 : Infinity;
    const hardStop = Math.min(stageEnd, earlyAt);
    const deadline = () => Math.min(hardStop, itemEnd);
    const maxAttempts = item.answer.kind === "choice" ? 1 : Math.min(settings.maxAttempts, 4);
    const stat = (attempts[stage] ??= [0, 0]);
    let tries = 0;
    let asked = false;
    let lastTyped = "";
    const tried: number[] = [];
    let outcome: Outcome | null = null;

    // A deadline passed: the block ended, the learner quit, or the question timed out.
    const onDeadline = (): ItemEnd | null => {
      if (now >= earlyAt) return "early";
      if (now >= stageEnd) return "time";
      const t = itemEnd + randInt(0, 249);
      log("timeout", { blockId: stage, exerciseId: item.id }, t);
      setNow(t);
      ctx.pressure += 1.2;
      latent.nudge(now, 0.5);
      outcome = "timeout";
      return null;
    };

    while (outcome === null) {
      if (!asked && stage !== "warmup" && chance(p.chatty * ASK[latent.state] * ASK_STAGE[stage] * (tries > 0 ? 1.5 : 1))) {
        asked = true;
        if (!askTutor(item, deadline())) {
          const end = onDeadline();
          if (end) return end;
          break;
        }
      }
      if (tries === 0 && (stage === "practice" || stage === "puzzles" || stage === "challenge") && chance(GIVE_UP[latent.state])) {
        if (!act(thinkMs(stage, item, 0) * 0.5, deadline())) {
          const end = onDeadline();
          if (end) return end;
          break;
        }
        clicks.push(now);
        log("skip", { blockId: stage, exerciseId: item.id });
        ctx.pressure += 0.5;
        outcome = "skipped";
        break;
      }
      if (!act(thinkMs(stage, item, tries), deadline())) {
        const end = onDeadline();
        if (end) return end;
        break;
      }

      const correct = chance(pCorrect(stage, item, tries));
      let answer: string;
      if (item.answer.kind === "choice") {
        answer = item.answer.options[correct ? item.answer.correct : wrongChoice(item)];
        clicks.push(now);
      } else {
        answer = correct ? correctAnswerText(item, p.decimalComma) : wrongAnswerText(item, p.decimalComma, tried);
        const value = parseNumber(answer);
        if (value !== null) tried.push(value);
        const typos = poisson(answer.length * 0.05);
        const deletes = lastTyped.length + typos;
        const enter = chance(0.45);
        const total = answer.length + typos + deletes + (enter ? 1 : 0);
        const duration = total * lognormal(230, 0.3);
        typeKeys(now - duration, duration, total, deletes);
        if (!enter) clicks.push(now); // Check button
        lastTyped = answer;
      }
      log("attempt", { blockId: stage, exerciseId: item.id, answer, correct });
      tries += 1;
      stat[0] += 1;
      if (correct) stat[1] += 1;

      if (correct) {
        ctx.flow += 1;
        latent.nudge(now, 0.3);
        outcome = "correct";
      } else {
        ctx.pressure += 1;
        latent.nudge(now, 0.45);
        if (tries >= maxAttempts) {
          outcome = "incorrect";
        } else if (tries >= 4 || chance(SKIP_AFTER_WRONG[latent.state] + 0.12 * (tries - 1))) {
          if (!act(uniform(800, 3000), deadline())) {
            const end = onDeadline();
            if (end) return end;
            break;
          }
          clicks.push(now);
          log("skip", { blockId: stage, exerciseId: item.id });
          ctx.pressure += 0.3;
          outcome = "skipped";
        }
      }
    }

    ctx.pressure *= 0.6;
    ctx.flow *= 0.6;
    maybeHideTab(hardStop);
    const reading = outcome === "correct" ? lognormal(3000, 0.5) : lognormal(8000, 0.5);
    if (!act(clamp(reading * (latent.state === "bored" ? 0.5 : 1), 1000, 30000), hardStop)) {
      return now >= earlyAt ? "early" : "time";
    }
    clicks.push(now); // Next question
    return "next";
  };

  // ----- the session -----

  // Camera check + check-in explanation (signals are already recorded).
  const setupMs = clamp(lognormal(p.cameraSkipped ? 45000 : 38000, 0.35), 15000, 150000);
  clicks.push(now + Math.min(setupMs - 3000, uniform(8000, 25000))); // practice check-in pick
  act(setupMs);
  clicks.push(now);
  log("setup-done", { reason: p.cameraSkipped ? "skipped" : "face-ok" });
  nextProbe = nextProbeFrom(now);

  const stages: StageId[] = ["warmup", ...(p.blockOrder as StageId[])];
  let endedEarly = false;
  let sessionEnd = now;

  stageLoop: for (let si = 0; si < stages.length; si++) {
    const stage = stages[si];
    enter({ phase: "intro", stageStart: now, stageLen: 15000, stageIndex: si, pressure: ctx.pressure * 0.3, flow: ctx.flow * 0.3 });
    context = {};
    act(clamp(lognormal(si === 0 ? 11000 : 8000, 0.4) * (latent.state === "bored" ? 0.7 : 1), 2500, 40000));
    maybeHideTab(Infinity);
    clicks.push(now); // Start

    const settings = stageSettings(stage);
    const stageStart = now;
    enter({ phase: stage, stageStart, stageLen: settings.timed ? BLOCK_MS : 40000 });
    latent.nudge(now, 0.5);
    log("stage-start", { blockId: stage });
    const stageEnd = settings.timed ? stageStart + BLOCK_MS : Infinity;
    const earlyAt = p.endEarly?.stageIndex === si ? stageStart + p.endEarly.frac * BLOCK_MS : Infinity;
    const queue = createStageQueue(stage);

    for (;;) {
      const item = queue();
      if (!item) {
        log("stage-end", { blockId: stage, reason: "items" });
        sessionEnd = now;
        context = {};
        break;
      }
      const end = runItem(stage, item, stageEnd, earlyAt);
      if (end === "early") {
        clicks.push(now); // End session (+ the confirm dialog, which blocks timers)
        setNow(now + uniform(1200, 3500));
        log("session-end", { reason: "ended-early", ...context });
        sessionEnd = now;
        endedEarly = true;
        break stageLoop;
      }
      if (end === "time") {
        const t = stageEnd + randInt(0, 249);
        log("stage-end", { blockId: stage, reason: "time" }, t);
        setNow(t);
        sessionEnd = t;
        context = {};
        break;
      }
    }
  }
  if (!endedEarly) log("session-end", { reason: "completed" }, sessionEnd);
  nextProbe = null;
  latent.close(Math.max(now, sessionEnd));

  // ----- 5-second signal windows, from session start to the end of the task -----

  const windows: Doc[] = [];
  const ar = { open: 0, disp: 0, head: 0, act: 0, speed: 0, gx: 0, gy: 0 };
  let wander = false;
  clicks.sort((a, b) => a - b);

  for (let end = sessionCreated + WINDOW_MS + randInt(20, 60); end <= sessionEnd; end += WINDOW_MS + randInt(-35, 40)) {
    const start = end - WINDOW_MS;
    for (const k of Object.keys(ar) as (keyof typeof ar)[]) ar[k] = 0.7 * ar[k] + 0.71 * normal();
    const state = latent.at(start + WINDOW_MS / 2);
    const visible = 1 - overlap(hidden, start, end) / WINDOW_MS;
    const popupFrac = overlap(popups, start, end) / WINDOW_MS;
    const tutorFrac = overlap(tutorReading, start, end) / WINDOW_MS;
    const nClicks = clicks.filter((t) => t >= start && t < end).length;
    const windowKeys = keys.filter((k) => k.t >= start && k.t < end);
    const elapsedMin = (start - sessionCreated) / 60000;

    // Face + eyes (EyeAccumulator: no frames while the tab is hidden).
    const eye = {
      facePresence: 0,
      avgEyeOpenness: 0,
      blinkRate: 0,
      gazeDispersion: 0,
      gazeLeftX: 0,
      gazeLeftY: 0,
      gazeRightX: 0,
      gazeRightY: 0,
      headMovement: 0,
    };
    if (!p.cameraSkipped && visible > 0) {
      const frames = Math.max(1, Math.round(visible * lognormal(112, 0.1)));
      const away = chance(EYE.away[state] * p.awayFactor) ? uniform(0.15, 1) : 0;
      const dropout = uniform(0, p.intake.vision === "glasses" ? 0.05 : 0.015);
      const faceFrames = Math.round(frames * clamp(1 - away - dropout, 0, 1));
      eye.facePresence = faceFrames / frames;
      if (faceFrames > 0) {
        const seen = faceFrames / frames;
        const blinks = poisson(EYE.blinks[state] * p.eye.blinkFactor * visible * seen);
        const raw = p.eye.openBase + EYE.open[state] - 0.0012 * elapsedMin + 0.025 * ar.open;
        let sum = 0;
        for (let i = 0; i < 24; i++) sum += clamp(raw + normal(0, 0.04), 0, 1);
        eye.avgEyeOpenness = clamp(sum / 24 - 0.012 * blinks, 0, 1);
        eye.blinkRate = blinks / (WINDOW_MS / 1000);
        eye.gazeDispersion =
          lognormal(EYE.disp[state] * p.eye.dispFactor, 0.3) * Math.exp(0.2 * ar.disp) + 0.05 * tutorFrac + 0.1 * away;
        const sd = EYE.gazeSd[state];
        const dx = 0.6 * sd * ar.gx + normal(0, 0.6 * sd) - 0.04 * tutorFrac;
        const dy = EYE.gazeDy[state] + 0.6 * sd * ar.gy + normal(0, 0.6 * sd) + 0.05 * tutorFrac;
        const g = p.eye.gaze;
        eye.gazeLeftX = clamp(g.lx + dx + normal(0, 0.012), -1, 1);
        eye.gazeLeftY = clamp(g.ly + dy + normal(0, 0.012), -1, 1);
        eye.gazeRightX = clamp(g.rx + dx + normal(0, 0.012), -1, 1);
        eye.gazeRightY = clamp(g.ry + dy + normal(0, 0.012), -1, 1);
        eye.headMovement =
          (lognormal(EYE.head[state] * p.eye.headFactor, 0.45) * Math.exp(0.25 * ar.head) +
            (chance(EYE.shift[state]) ? uniform(0.12, 0.6) : 0) +
            0.02 * popupFrac) *
          seen;
      }
    }

    // Mouse (MouseAccumulator: 10 buckets of 500 ms; nothing while hidden).
    const mouse = { mouseTravel: 0, mouseSpeedMean: 0, clickCount: 0, idleRatio: 1 };
    if (visible > 0) {
      wander = state === "bored" && chance(wander ? 0.65 : 0.3);
      const base = state === "bored" && wander ? 0.6 : MOUSE.activity[state];
      const typingFrac = Math.min(1, windowKeys.length / 22);
      const activity =
        base * p.mouse.activity * Math.exp(0.3 * ar.act) * (1 - 0.75 * typingFrac) * visible +
        0.07 * nClicks +
        0.25 * popupFrac +
        0.08 * tutorFrac;
      let buckets = binomial(10, clamp(activity, 0, 0.97));
      if (nClicks > 0 && buckets === 0 && chance(0.85)) buckets = 1;
      mouse.clickCount = nClicks + poisson(MOUSE.extraClicks[state] * visible);
      if (buckets > 0) {
        for (let i = 0; i < buckets; i++) mouse.mouseTravel += lognormal(MOUSE.bucketPx[state] * p.mouse.travel, 0.6);
        mouse.mouseSpeedMean = lognormal(MOUSE.speed[state] * p.mouse.speed, 0.4) * Math.exp(0.2 * ar.speed);
      }
      mouse.idleRatio = 1 - Math.min(1, buckets / 10);
    }

    const features: Features = { ...eye, ...mouse };
    windows.push({
      sessionId,
      windowStart: start,
      windowEnd: end,
      features,
      vector: FEATURE_ORDER.map((name) => features[name]),
      extras: { keyCount: windowKeys.length, deleteCount: windowKeys.filter((k) => k.del).length },
      state: "unknown", // what the backend stores when no model output is available
      receivedAt: new Date(end + randInt(12, 120)),
    });
  }

  // ----- participant record -----

  const finished = !p.abandonsPost;
  const finishedAt = sessionEnd + clamp(lognormal(55000, 0.4), 15000, 240000);
  const participant: Doc = {
    participantId,
    seq: p.seq,
    isTest: true,
    synthetic: true,
    status: finished ? (endedEarly ? "ended-early" : "completed") : "started",
    consentAt: new Date(createdAt - 2),
    intake: p.intake,
    environment: p.environment,
    settings: { probeIntervalS: PROBE_INTERVAL_S, blockSeconds: DEFAULT_BLOCK_SECONDS },
    blockOrder: p.blockOrder,
    createdAt: new Date(createdAt),
    ...(finished ? { post: postSurvey(p, endedEarly), finishedAt: new Date(finishedAt) } : {}),
  };

  return {
    participant,
    session: { sessionId, abGroup: "control", mode: "pilot", participantId, createdAt: new Date(sessionCreated) },
    windows,
    reports,
    events,
    hints,
    chats,
    stats: { attempts, endedEarly },
  };
}

// ---------- session times: weekdays 12 Oct – 6 Nov 2026, Helsinki office hours ----------

function schedule(count: number): number[] {
  const days: number[] = [];
  for (let d = Date.UTC(2026, 9, 12); d <= Date.UTC(2026, 10, 6); d += 86400000) {
    const weekday = new Date(d).getUTCDay();
    if (weekday >= 1 && weekday <= 5) days.push(d);
  }
  const perDay = days.map(() => Math.floor(count / days.length));
  for (let left = count - perDay.reduce((a, b) => a + b, 0); left > 0; left--) perDay[randInt(0, days.length - 1)] += 1;
  const starts: number[] = [];
  days.forEach((day, i) => {
    const utcOffsetH = day < Date.UTC(2026, 9, 25) ? 3 : 2; // EEST → EET on 25 Oct
    let minute = 8 * 60 + 45 + randInt(0, 50);
    for (let k = 0; k < perDay[i]; k++) {
      starts.push(day + (minute - utcOffsetH * 60) * 60000 + randInt(0, 59999));
      minute += randInt(48, 80);
    }
  });
  return starts;
}

// ---------- database ----------

async function resetSynthetic(): Promise<void> {
  const participants = await Participant.find({ synthetic: true }, { participantId: 1 }).lean();
  const ids = participants.map((d) => d.participantId);
  const sessions = await Session.find({ participantId: { $in: ids } }, { sessionId: 1 }).lean();
  const sessionIds = sessions.map((d) => d.sessionId);
  const bySession = { sessionId: { $in: sessionIds } };
  const removed = await Promise.all([
    SignalBatch.deleteMany(bySession),
    SelfReport.deleteMany(bySession),
    ExerciseEvent.deleteMany(bySession),
    Hint.deleteMany(bySession),
    ChatMessage.deleteMany(bySession),
    Session.deleteMany(bySession),
    Participant.deleteMany({ synthetic: true }),
  ]);
  // Continue the T-numbering after the remaining (real) test runs.
  const last = await Participant.findOne({ isTest: true }).sort({ seq: -1 }).lean();
  await Counter.updateOne({ _id: COUNTER_ID }, { $set: { seq: last?.seq ?? 0 } }, { upsert: true });
  console.log(
    `[reset] removed ${removed[6].deletedCount} synthetic participants, ${removed[5].deletedCount} sessions, ` +
      `${removed[0].deletedCount} windows, ${removed[1].deletedCount} check-ins, ${removed[2].deletedCount} events; ` +
      `test counter back at ${last?.seq ?? 0}`,
  );
}

function table(rows: string[][]): string {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  return rows.map((r) => r.map((cell, c) => cell.padStart(widths[c])).join("  ")).join("\n");
}

async function main(): Promise<void> {
  if (!Number.isInteger(UNTIL) || UNTIL < 0 || UNTIL > 999 || !Number.isFinite(SEED)) {
    throw new Error("--until must be a whole number from 0 to 999 (T-codes have three digits); --seed a number");
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set (backend/.env)");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });

  if (RESET) {
    await resetSynthetic();
  } else if (await Participant.exists({ synthetic: true })) {
    throw new Error("synthetic participants already exist — run with --reset to replace them");
  }

  const current = (await Counter.findById(COUNTER_ID).lean())?.seq ?? 0;
  const count = UNTIL - current;
  if (count <= 0) {
    console.log(`[seed] test counter is already at ${current} — nothing to add (use --until)`);
    await mongoose.disconnect();
    return;
  }
  console.log(`[seed] creating ${count} synthetic participants: T${String(current + 1).padStart(3, "0")}–T${String(UNTIL).padStart(3, "0")} (seed ${SEED})`);

  const starts = schedule(count);
  const labels: Record<string, Record<State, number>> = {};
  const accuracy: Record<string, [number, number]> = {};
  const totals = { windows: 0, reports: 0, events: 0, hints: 0, chats: 0, endedEarly: 0 };

  for (let i = 0; i < count; i++) {
    const counter = await Counter.findOneAndUpdate({ _id: COUNTER_ID }, { $inc: { seq: 1 } }, { upsert: true, new: true });
    const seq = counter.seq;
    const participantId = `T${String(seq).padStart(3, "0")}`;
    if (await Participant.exists({ participantId })) {
      console.warn(`[seed] ${participantId} already exists — skipped`);
      continue;
    }
    const sim = simulate(makeProfile(seq, participantId), starts[i]);
    await Participant.create(sim.participant);
    await Session.create(sim.session);
    await SignalBatch.insertMany(sim.windows);
    if (sim.reports.length) await SelfReport.insertMany(sim.reports);
    await ExerciseEvent.insertMany(sim.events);
    if (sim.hints.length) await Hint.insertMany(sim.hints);
    if (sim.chats.length) await ChatMessage.insertMany(sim.chats);

    totals.windows += sim.windows.length;
    totals.reports += sim.reports.length;
    totals.events += sim.events.length;
    totals.hints += sim.hints.length;
    totals.chats += sim.chats.length / 2;
    if (sim.stats.endedEarly) totals.endedEarly += 1;
    for (const r of sim.reports) {
      const block = (r.blockId as string | undefined) ?? "(between parts)";
      labels[block] ??= { engaged: 0, confused: 0, bored: 0, frustrated: 0, neutral: 0 };
      labels[block][r.state as State] += 1;
    }
    for (const [stage, [n, ok]] of Object.entries(sim.stats.attempts)) {
      accuracy[stage] ??= [0, 0];
      accuracy[stage][0] += n;
      accuracy[stage][1] += ok;
    }
    if ((i + 1) % 10 === 0 || i + 1 === count) console.log(`[seed] ${i + 1}/${count} — ${participantId}`);
  }

  console.log(
    `\n[seed] done: ${count} participants (${totals.endedEarly} ended early), ${totals.windows} signal windows, ` +
      `${totals.reports} check-ins, ${totals.events} exercise events, ${totals.hints} hints, ${totals.chats} chat exchanges\n`,
  );
  const order = ["warmup", "routine", "practice", "puzzles", "challenge", "(between parts)"];
  console.log("Check-in labels by block:");
  console.log(
    table([
      ["block", ...STATES, "correct attempts"],
      ...order
        .filter((b) => labels[b])
        .map((b) => {
          const acc = accuracy[b];
          return [b, ...STATES.map((s) => String(labels[b][s])), acc ? `${Math.round((100 * acc[1]) / acc[0])}%` : "–"];
        }),
    ]),
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("[seed] failed:", (err as Error).message);
  await mongoose.disconnect();
  process.exit(1);
});
