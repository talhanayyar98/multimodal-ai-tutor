// Exercise bank for the /collect pilot (probability).
//
// A session is a 2-question warm-up followed by four timed blocks. Each block
// is designed to make one learning state LIKELY (after D'Mello & Graesser's
// affect dynamics and the flow model of challenge vs. skill):
//
//   routine   — trivially easy and repetitive, endless   → boredom
//   practice  — moderate, matched to a non-expert         → engagement
//   puzzles   — counter-intuitive results (impasses)      → confusion
//   challenge — hard, multi-step, 2-minute limit per item → frustration
//
// The training labels never come from the block — only from the learner's
// own check-ins. The blocks just make sure every state actually occurs.
// Participants only ever see neutral names ("Part 2 of 4") so they aren't
// told how they "should" feel.

export type BlockId = "routine" | "practice" | "puzzles" | "challenge";
/** Must match STAGE_IDS in backend/src/models.ts. */
export type StageId = "warmup" | BlockId;

export type Answer =
  | { kind: "number"; value: number; tol?: number }
  | { kind: "choice"; options: string[]; correct: number };

export interface Exercise {
  id: string;
  text: string;
  answer: Answer;
  /** Shown after the item is answered, skipped or timed out. */
  solution: string;
}

interface StageDef {
  /** Neutral description shown on the stage's intro screen. */
  intro: string;
  items: Exercise[];
  /** Called once `items` run out, so the block can fill its whole duration. */
  generate?: () => Exercise;
  shuffle?: boolean;
  /** Per-question time limit in seconds. */
  perItemS?: number;
  /** Attempts for number answers (default unlimited). Choice answers always get one. */
  maxAttempts?: number;
  /** false = no block timer; the stage ends when its items run out. */
  timed: boolean;
}

export const DEFAULT_BLOCK_SECONDS = 7 * 60;

// ---------- helpers ----------

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffled<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function choose(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

const num = (value: number, tol?: number): Answer => ({ kind: "number", value, tol });
const round3 = (x: number) => Math.round(x * 1000) / 1000;

// ---------- warm-up ----------

const WARMUP: Exercise[] = [
  {
    id: "warmup-coin",
    text: "A fair coin is flipped once. What is the probability that it lands heads?",
    answer: num(1 / 2),
    solution: "Heads is one of two equally likely outcomes: 1/2.",
  },
  {
    id: "warmup-die",
    text: "A fair six-sided die is rolled once. Which is more likely: rolling a 6, or rolling a 1?",
    answer: { kind: "choice", options: ["Rolling a 6", "Rolling a 1", "They are equally likely"], correct: 2 },
    solution: "Every face of a fair die has the same probability, 1/6.",
  },
];

// ---------- routine (easy, repetitive, generated) ----------

const SUITS = ["heart", "spade", "club", "diamond"] as const;
const RANKS = [
  ["an ace", "ace"],
  ["a king", "king"],
  ["a queen", "queen"],
  ["a seven", "7"],
  ["a ten", "10"],
] as const;

function routineItem(): Exercise {
  switch (randInt(0, 5)) {
    case 0: {
      const r = randInt(1, 9);
      const b = randInt(1, 9);
      return {
        id: `routine-marbles-${r}-${b}`,
        text: `A bag contains ${r} red and ${b} blue marbles. One marble is drawn at random. What is the probability that it is red?`,
        answer: num(r / (r + b)),
        solution: `${r} of the ${r + b} marbles are red: ${r}/${r + b}.`,
      };
    }
    case 1: {
      const k = randInt(1, 5);
      return {
        id: `routine-die-greater-${k}`,
        text: `A fair six-sided die is rolled. What is the probability of rolling a number greater than ${k}?`,
        answer: num((6 - k) / 6),
        solution: `${6 - k} of the 6 faces are greater than ${k}: ${6 - k}/6.`,
      };
    }
    case 2: {
      const n = randInt(4, 12);
      const even = Math.floor(n / 2);
      return {
        id: `routine-spinner-${n}`,
        text: `A spinner has ${n} equal sections numbered 1 to ${n}. What is the probability that it lands on an even number?`,
        answer: num(even / n),
        solution: `${even} of the ${n} numbers are even: ${even}/${n}.`,
      };
    }
    case 3: {
      const suit = pick(SUITS);
      return {
        id: `routine-suit-${suit}`,
        text: `One card is drawn from a standard 52-card deck. What is the probability that it is a ${suit}?`,
        answer: num(13 / 52),
        solution: `13 of the 52 cards are ${suit}s: 13/52 = 1/4.`,
      };
    }
    case 4: {
      const [phrase, slug] = pick(RANKS);
      return {
        id: `routine-rank-${slug}`,
        text: `One card is drawn from a standard 52-card deck. What is the probability that it is ${phrase}?`,
        answer: num(4 / 52),
        solution: `There are 4 of each rank in the deck: 4/52 = 1/13.`,
      };
    }
    default: {
      const side = pick(["heads", "tails"] as const);
      return {
        id: `routine-two-${side}`,
        text: `A fair coin is flipped twice. What is the probability of getting ${side} both times?`,
        answer: num(1 / 4),
        solution: `1/2 × 1/2 = 1/4.`,
      };
    }
  }
}

// ---------- practice (moderate) ----------

const PRACTICE: Exercise[] = [
  {
    id: "practice-dice-sum-7",
    text: "Two fair dice are rolled. What is the probability that the sum is 7?",
    answer: num(6 / 36),
    solution: "6 of the 36 equally likely pairs sum to 7: (1,6), (2,5), (3,4), (4,3), (5,2), (6,1). So 6/36 = 1/6.",
  },
  {
    id: "practice-dice-sum-10-plus",
    text: "Two fair dice are rolled. What is the probability that the sum is at least 10?",
    answer: num(6 / 36),
    solution: "Sums of 10, 11 and 12 come from 3 + 2 + 1 = 6 of the 36 pairs: 6/36 = 1/6.",
  },
  {
    id: "practice-coins-exactly-2-of-3",
    text: "A fair coin is flipped 3 times. What is the probability of getting exactly 2 heads?",
    answer: num(3 / 8),
    solution: "There are 8 equally likely sequences; HHT, HTH and THH have exactly two heads: 3/8.",
  },
  {
    id: "practice-at-least-one-six-2",
    text: "A fair die is rolled twice. What is the probability of getting at least one 6?",
    answer: num(11 / 36),
    solution: "Use the complement: P(no 6) = (5/6)² = 25/36, so P(at least one 6) = 1 − 25/36 = 11/36.",
  },
  {
    id: "practice-two-red-no-replacement",
    text: "A bag has 3 red and 2 blue marbles. Two marbles are drawn without replacement. What is the probability that both are red?",
    answer: num(3 / 10),
    solution: "3/5 for the first red, then 2/4 for the second: 3/5 × 2/4 = 6/20 = 3/10.",
  },
  {
    id: "practice-ace-or-heart",
    text: "One card is drawn from a standard 52-card deck. What is the probability that it is an ace or a heart?",
    answer: num(16 / 52),
    solution: "13 hearts + 4 aces − 1 (the ace of hearts was counted twice) = 16 cards: 16/52 = 4/13.",
  },
  {
    id: "practice-dice-doubles",
    text: "Two fair dice are rolled. What is the probability that both show the same number?",
    answer: num(6 / 36),
    solution: "There are 6 doubles among the 36 pairs: 6/36 = 1/6.",
  },
  {
    id: "practice-football-or-chess",
    text: "In a class of 30 students, 18 play football, 12 play chess and 6 play both. A student is picked at random. What is the probability that they play football or chess?",
    answer: num(24 / 30),
    solution: "18 + 12 − 6 = 24 students play at least one of them: 24/30 = 4/5.",
  },
  {
    id: "practice-expected-die",
    text: "What is the expected (average) value of one roll of a fair six-sided die?",
    answer: num(3.5),
    solution: "(1 + 2 + 3 + 4 + 5 + 6) / 6 = 21/6 = 3.5.",
  },
  {
    id: "practice-lock-code",
    text: "A 3-digit lock code uses the digits 0–9, and digits may repeat. What is the probability of guessing the code on the first try?",
    answer: num(1 / 1000),
    solution: "There are 10 × 10 × 10 = 1000 possible codes: 1/1000.",
  },
  {
    id: "practice-arrange-abcd",
    text: "In how many different orders can the four letters A, B, C and D be arranged in a row?",
    answer: num(24),
    solution: "4 choices for the first place, 3 for the second, 2 for the third, 1 for the last: 4 × 3 × 2 × 1 = 24.",
  },
  {
    id: "practice-four-heads",
    text: "A fair coin is flipped 4 times. What is the probability that all four flips are heads?",
    answer: num(1 / 16),
    solution: "(1/2)⁴ = 1/16.",
  },
];

function practiceItem(): Exercise {
  switch (randInt(0, 3)) {
    case 0: {
      const k = pick([3, 4, 5, 6, 8, 9, 10, 11]);
      const ways = 6 - Math.abs(k - 7);
      return {
        id: `practice-gen-dice-sum-${k}`,
        text: `Two fair dice are rolled. What is the probability that the sum is exactly ${k}?`,
        answer: num(ways / 36),
        solution: `${ways} of the 36 equally likely pairs sum to ${k}: ${ways}/36.`,
      };
    }
    case 1: {
      const n = randInt(3, 4);
      const p = 1 - (5 / 6) ** n;
      return {
        id: `practice-gen-at-least-one-six-${n}`,
        text: `A fair die is rolled ${n} times. What is the probability of getting at least one 6?`,
        answer: num(p),
        solution: `Complement: 1 − (5/6)^${n} ≈ ${round3(p)}.`,
      };
    }
    case 2: {
      const k = randInt(1, 3);
      const ways = choose(4, k);
      return {
        id: `practice-gen-coins-exactly-${k}-of-4`,
        text: `A fair coin is flipped 4 times. What is the probability of getting exactly ${k} head${k === 1 ? "" : "s"}?`,
        answer: num(ways / 16),
        solution: `${ways} of the 16 equally likely sequences have exactly ${k} head${k === 1 ? "" : "s"}: ${ways}/16.`,
      };
    }
    default: {
      const r = randInt(2, 5);
      const b = randInt(2, 5);
      const n = r + b;
      return {
        id: `practice-gen-two-blue-${r}-${b}`,
        text: `A bag has ${r} red and ${b} blue marbles. Two marbles are drawn without replacement. What is the probability that both are blue?`,
        answer: num((b / n) * ((b - 1) / (n - 1))),
        solution: `${b}/${n} × ${b - 1}/${n - 1} = ${b * (b - 1)}/${n * (n - 1)}.`,
      };
    }
  }
}

// ---------- puzzles (counter-intuitive) ----------

const PUZZLES: Exercise[] = [
  {
    id: "puzzle-monty-hall",
    text: "A game show has 3 closed doors: a car is behind one, goats are behind the other two. You pick door 1. The host, who knows where the car is, always opens another door with a goat — this time door 3 — and offers you a switch to door 2. If you switch, what is your probability of winning the car?",
    answer: num(2 / 3),
    solution: "Your first pick is right only 1/3 of the time. The host never reveals the car, so in the other 2/3 of cases the car is behind the door you can switch to. Switching wins 2/3 of the time.",
  },
  {
    id: "puzzle-disease-test",
    text: "1% of people have a certain disease. A test is positive for 90% of people who have it, and (wrongly) positive for 9% of people who don't. You test positive. What is the probability that you actually have the disease?",
    answer: num((0.01 * 0.9) / (0.01 * 0.9 + 0.99 * 0.09)),
    solution: "Picture 1000 people: 10 are sick and 9 of them test positive; of the 990 healthy, about 89 test positive. Only 9 of the ~98 positives are sick: ≈ 0.092 (9.2%).",
  },
  {
    id: "puzzle-boy-girl",
    text: "A family has two children; each child is equally likely to be a boy or a girl. You learn that at least one of them is a boy. What is the probability that both are boys?",
    answer: num(1 / 3),
    solution: "The equally likely families are BB, BG, GB, GG. 'At least one boy' rules out only GG, leaving 3 — and just one of them (BB) has two boys: 1/3.",
  },
  {
    id: "puzzle-birthday-23",
    text: "23 people are in a room. Ignoring leap years and assuming every birthday is equally likely, roughly what is the probability that at least two of them share a birthday?",
    answer: { kind: "choice", options: ["About 6%", "About 25%", "About 50%", "About 90%"], correct: 2 },
    solution: "Think in pairs, not people: 23 people form 253 pairs. 1 − (365 × 364 × … × 343)/365²³ ≈ 0.507 — just over 50%.",
  },
  {
    id: "puzzle-gamblers-fallacy",
    text: "A fair coin has landed heads 6 times in a row. What is the probability that the next flip is heads?",
    answer: num(1 / 2),
    solution: "Flips are independent — the coin has no memory of earlier flips. It is still 1/2.",
  },
  {
    id: "puzzle-three-cards",
    text: "A hat holds three cards: one red on both sides, one white on both sides, and one red on one side and white on the other. You draw a card at random and put it on the table; its top side is red. What is the probability that its other side is red too?",
    answer: num(2 / 3),
    solution: "There are 3 red faces you could be looking at, all equally likely. Two of them belong to the red–red card, so the other side is red with probability 2/3.",
  },
  {
    id: "puzzle-three-dice-9-or-10",
    text: "Three fair dice are rolled. Which is more likely: a sum of 9, or a sum of 10?",
    answer: { kind: "choice", options: ["A sum of 9", "A sum of 10", "They are equally likely"], correct: 1 },
    solution: "Both sums can be made from six combinations of numbers, but those combinations have different numbers of orderings: 25 of the 216 outcomes give 9, while 27 give 10. So 10 is slightly more likely.",
  },
  {
    id: "puzzle-wait-for-six",
    text: "On average, how many times do you need to roll a fair die until the first 6 appears (counting the roll that shows the 6)?",
    answer: num(6),
    solution: "With a 1/6 chance of success on each roll, the expected waiting time is 1 ÷ (1/6) = 6 rolls.",
  },
  {
    id: "puzzle-socks",
    text: "A drawer holds 10 black and 10 white socks, all mixed up. In the dark, how many socks must you take out to be certain that you have a matching pair?",
    answer: num(3),
    solution: "There are only two colours, so among any 3 socks at least two must have the same colour.",
  },
  {
    id: "puzzle-coin-sequences",
    text: "A fair coin is flipped 6 times. Which exact sequence is more likely: HHHHHH, or HTHHTH?",
    answer: { kind: "choice", options: ["HHHHHH", "HTHHTH", "They are equally likely"], correct: 2 },
    solution: "Every specific sequence of 6 flips has the same probability, (1/2)⁶ = 1/64 — even one that looks 'too regular'.",
  },
];

// ---------- challenge (hard, timed) ----------

const CHALLENGE: Exercise[] = [
  {
    id: "challenge-two-sixes-in-five",
    text: "A fair die is rolled 5 times. What is the probability of getting exactly two 6s?",
    answer: num(1250 / 7776),
    solution: "C(5,2) × (1/6)² × (5/6)³ = 10 × 1/36 × 125/216 = 1250/7776 ≈ 0.161.",
  },
  {
    id: "challenge-five-hearts",
    text: "Five cards are dealt from a standard 52-card deck. What is the probability that all five are hearts? (Give at least 3 significant digits.)",
    answer: num(1287 / 2598960),
    solution: "C(13,5) / C(52,5) = 1287 / 2,598,960 ≈ 0.000495.",
  },
  {
    id: "challenge-pin-distinct",
    text: "A 4-digit PIN uses the digits 0–9, and digits may repeat. What is the probability that all four digits are different?",
    answer: num(5040 / 10000),
    solution: "10 × 9 × 8 × 7 = 5040 of the 10,000 possible PINs: 0.504.",
  },
  {
    id: "challenge-birth-months-6",
    text: "6 people are in a room, and each person's birth month is equally likely to be any of the 12 months. What is the probability that at least two of them share a birth month?",
    answer: num(1 - (12 * 11 * 10 * 9 * 8 * 7) / 12 ** 6),
    solution: "P(all different) = (12 × 11 × 10 × 9 × 8 × 7) / 12⁶ ≈ 0.223, so P(at least one shared month) ≈ 0.777.",
  },
  {
    id: "challenge-three-dice-sum-10",
    text: "Three fair dice are rolled. What is the probability that the sum is exactly 10?",
    answer: num(27 / 216),
    solution: "27 of the 216 equally likely outcomes sum to 10: 27/216 = 1/8.",
  },
  {
    id: "challenge-committee",
    text: "A committee of 3 is chosen at random from 5 women and 4 men. What is the probability that it has exactly 2 women?",
    answer: num(40 / 84),
    solution: "C(5,2) × C(4,1) / C(9,3) = 10 × 4 / 84 = 40/84 ≈ 0.476.",
  },
  {
    id: "challenge-eight-heads-of-ten",
    text: "A fair coin is flipped 10 times. What is the probability of getting at least 8 heads?",
    answer: num(56 / 1024),
    solution: "(C(10,8) + C(10,9) + C(10,10)) / 2¹⁰ = (45 + 10 + 1) / 1024 = 56/1024 ≈ 0.055.",
  },
  {
    id: "challenge-at-least-one-red",
    text: "A bag has 4 red and 6 blue marbles. Three marbles are drawn without replacement. What is the probability of drawing at least one red?",
    answer: num(1 - 20 / 120),
    solution: "Complement: all three blue = C(6,3) / C(10,3) = 20/120 = 1/6, so at least one red = 5/6 ≈ 0.833.",
  },
  {
    id: "challenge-two-aces",
    text: "Two cards are drawn without replacement from a standard 52-card deck. What is the probability that both are aces?",
    answer: num((4 / 52) * (3 / 51)),
    solution: "4/52 × 3/51 = 12/2652 = 1/221 ≈ 0.0045.",
  },
  {
    id: "challenge-one-pair",
    text: "A five-card poker hand is dealt from a standard deck. What is the probability that it contains exactly one pair (two cards of one rank, and three cards of three other, different ranks)?",
    answer: num(1098240 / 2598960),
    solution: "13 × C(4,2) × C(12,3) × 4³ = 1,098,240 such hands out of C(52,5) = 2,598,960 ≈ 0.423.",
  },
  {
    id: "challenge-true-false-guessing",
    text: "A quiz has 10 true/false questions. If you guess every answer at random, what is the probability of getting at least 7 right?",
    answer: num(176 / 1024),
    solution: "(C(10,7) + C(10,8) + C(10,9) + C(10,10)) / 2¹⁰ = (120 + 45 + 10 + 1) / 1024 = 176/1024 ≈ 0.172.",
  },
  {
    id: "challenge-more-than-four-rolls",
    text: "A die is rolled until the first 6 appears. What is the probability that this takes more than 4 rolls?",
    answer: num((5 / 6) ** 4),
    solution: "It takes more than 4 rolls exactly when the first 4 rolls are all not-6: (5/6)⁴ = 625/1296 ≈ 0.482.",
  },
];

// ---------- stages ----------

export const STAGES: Record<StageId, StageDef> = {
  warmup: {
    intro: "Two quick questions to get used to the format.",
    items: WARMUP,
    timed: false,
  },
  routine: {
    intro: "A series of short questions.",
    items: [],
    generate: routineItem,
    timed: true,
  },
  practice: {
    intro: "A set of questions. Ask the tutor whenever you like.",
    items: PRACTICE,
    generate: practiceItem,
    timed: true,
  },
  puzzles: {
    intro: "A set of probability puzzles. Ask the tutor whenever you like.",
    items: PUZZLES,
    shuffle: true,
    timed: true,
  },
  challenge: {
    intro: "In this part every question has a 2-minute time limit and two attempts.",
    items: CHALLENGE,
    shuffle: true,
    perItemS: 120,
    maxAttempts: 2,
    timed: true,
  },
};

export function stageSettings(stage: StageId) {
  const def = STAGES[stage];
  return { perItemS: def.perItemS, maxAttempts: def.maxAttempts ?? Infinity, timed: def.timed };
}

/** Returns a function yielding the stage's next exercise, or null when it has none left. */
export function createStageQueue(stage: StageId): () => Exercise | null {
  const def = STAGES[stage];
  const items = def.shuffle ? shuffled(def.items) : [...def.items];
  let i = 0;
  return () => {
    if (i < items.length) return items[i++];
    return def.generate ? def.generate() : null;
  };
}

// ---------- answer checking ----------

/**
 * Accepts fractions (3/8), decimals (0.375 or 0,375) and percents (37.5%).
 * Returns null if the input can't be read as a number.
 */
export function parseNumber(raw: string): number | null {
  let s = raw.trim().replace(/\s+/g, "").replace(",", ".");
  if (!s) return null;
  let scale = 1;
  if (s.endsWith("%")) {
    scale = 0.01;
    s = s.slice(0, -1);
  }
  const frac = /^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(s);
  let value: number;
  if (frac) {
    const denominator = Number(frac[2]);
    if (denominator === 0) return null;
    value = Number(frac[1]) / denominator;
  } else if (/^-?(\d+\.?\d*|\.\d+)$/.test(s)) {
    value = Number(s);
  } else {
    return null;
  }
  return value * scale;
}

// Answers ≥ 0.05 are accepted within ±0.002 (or 1%), so 0.167 counts for 1/6.
// Small answers need a relative tolerance, or 0 would count for 1/1000.
function tolerance(target: number): number {
  const a = Math.abs(target);
  return a >= 0.05 ? Math.max(0.002, 0.01 * a) : 0.03 * a;
}

export function isCorrectNumber(answer: Extract<Answer, { kind: "number" }>, value: number): boolean {
  return Math.abs(value - answer.value) <= (answer.tol ?? tolerance(answer.value));
}

/** Human-readable correct answer, as stored in the "shown" event. */
export function expectedText(answer: Answer): string {
  return answer.kind === "number"
    ? String(Number(answer.value.toPrecision(4)))
    : answer.options[answer.correct];
}
