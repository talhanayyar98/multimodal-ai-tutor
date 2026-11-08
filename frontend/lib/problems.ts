// Problem bank for the main tutor page (/).
//
// A deliberately mixed bag — arithmetic, percentages, fractions, algebra,
// patterns, geometry, logic puzzles and probability — from quick warm-ups to
// counter-intuitive brain teasers. The spread matters: easy items tend to bore,
// moderate ones to engage, trick questions to confuse and hard multi-step ones
// to frustrate, so a learner actually passes through different states.
// (The /collect pilot uses its own, probability-only bank in exercises.ts.)

import { isCorrectNumber, parseNumber, type Answer } from "./exercises";

export type Difficulty = "easy" | "medium" | "hard";

export type Topic =
  | "Arithmetic"
  | "Percentages"
  | "Fractions"
  | "Algebra"
  | "Patterns"
  | "Geometry"
  | "Logic"
  | "Probability";

export interface Problem {
  id: string;
  topic: Topic;
  difficulty: Difficulty;
  text: string;
  answer: Answer;
  /** How to print the answer when a decimal would be ugly, e.g. "13/12". */
  display?: string;
  /** Shown on the results screen. */
  solution: string;
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "Warm-up",
  medium: "Medium",
  hard: "Brain teaser",
};

/** Points for a 3-star solve; fewer stars earn a share of it. */
export const DIFFICULTY_POINTS: Record<Difficulty, number> = { easy: 10, medium: 20, hard: 30 };

export const TOPIC_GLYPH: Record<Topic, string> = {
  Arithmetic: "+",
  Percentages: "%",
  Fractions: "½",
  Algebra: "x",
  Patterns: "…",
  Geometry: "△",
  Logic: "?",
  Probability: "⚄",
};

// ---------- helpers ----------

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

export type NumberAnswer = Extract<Answer, { kind: "number" }>;

/** Whole-number answers must be exact (the default tolerance would accept 143 for 144). */
export const exact = (value: number): NumberAnswer => ({ kind: "number", value, tol: 1e-6 });
/** Money and other decimals: right to the cent. */
export const cents = (value: number): NumberAnswer => ({ kind: "number", value, tol: 0.005 });
/** Probabilities: the default tolerance, so 0.167 counts for 1/6. */
export const prob = (value: number): NumberAnswer => ({ kind: "number", value });
export const choice = (options: string[], correct: number): Answer => ({ kind: "choice", options, correct });

type Factory = () => Problem;
const fixed = (p: Problem): Factory => () => p;

// ---------- warm-ups ----------

const EASY: Factory[] = [
  () => {
    const a = randInt(24, 89);
    const b = randInt(13, 79);
    return {
      id: `add-${a}-${b}`,
      topic: "Arithmetic",
      difficulty: "easy",
      text: `What is ${a} + ${b}?`,
      answer: exact(a + b),
      solution: `${a} + ${b} = ${a + b}.`,
    };
  },
  () => {
    const a = randInt(4, 12);
    const b = randInt(3, 12);
    return {
      id: `times-${a}-${b}`,
      topic: "Arithmetic",
      difficulty: "easy",
      text: `What is ${a} × ${b}?`,
      answer: exact(a * b),
      solution: `${a} × ${b} = ${a * b}.`,
    };
  },
  () => {
    const a = randInt(120, 240);
    const b = randInt(25, 95);
    return {
      id: `sub-${a}-${b}`,
      topic: "Arithmetic",
      difficulty: "easy",
      text: `What is ${a} − ${b}?`,
      answer: exact(a - b),
      solution: `${a} − ${b} = ${a - b}.`,
    };
  },
  () => {
    const [p, n] = pick([
      [10, 70],
      [10, 250],
      [25, 80],
      [25, 120],
      [50, 64],
      [50, 230],
      [20, 45],
    ] as const);
    return {
      id: `percent-of-${p}-${n}`,
      topic: "Percentages",
      difficulty: "easy",
      text: `What is ${p}% of ${n}?`,
      answer: exact((p * n) / 100),
      solution: `${p}% means ${p}/100, so ${p}/100 × ${n} = ${(p * n) / 100}.`,
    };
  },
  () => {
    const s = randInt(2, 9);
    const d = randInt(3, 9);
    const terms = [0, 1, 2, 3].map((i) => s + i * d);
    return {
      id: `seq-arith-${s}-${d}`,
      topic: "Patterns",
      difficulty: "easy",
      text: `What number comes next? ${terms.join(", ")}, …`,
      answer: exact(s + 4 * d),
      solution: `Each number is ${d} more than the one before: ${terms[3]} + ${d} = ${s + 4 * d}.`,
    };
  },
  () => {
    const w = randInt(4, 15);
    const h = randInt(3, 12);
    return {
      id: `rect-perimeter-${w}-${h}`,
      topic: "Geometry",
      difficulty: "easy",
      text: `A rectangle is ${w} cm long and ${h} cm wide. What is its perimeter, in cm?`,
      answer: exact(2 * (w + h)),
      solution: `Perimeter = 2 × (length + width) = 2 × (${w} + ${h}) = ${2 * (w + h)} cm.`,
    };
  },
  () => {
    const h = pick([1.5, 2.5, 3.5, 4.5]);
    return {
      id: `minutes-in-${h}h`,
      topic: "Arithmetic",
      difficulty: "easy",
      text: `How many minutes are there in ${h} hours?`,
      answer: exact(h * 60),
      solution: `${h} × 60 = ${h * 60} minutes.`,
    };
  },
  () => {
    const r = randInt(1, 9);
    const b = randInt(1, 9);
    return {
      id: `marbles-${r}-${b}`,
      topic: "Probability",
      difficulty: "easy",
      text: `A bag has ${r} red and ${b} blue marbles. You pick one without looking. What is the probability that it is red?`,
      answer: prob(r / (r + b)),
      display: `${r}/${r + b}`,
      solution: `${r} of the ${r + b} marbles are red, so the probability is ${r}/${r + b}.`,
    };
  },
];

// ---------- medium ----------

const MEDIUM: Factory[] = [
  () => {
    const a = randInt(12, 29);
    const b = randInt(11, 19);
    return {
      id: `mul2-${a}-${b}`,
      topic: "Arithmetic",
      difficulty: "medium",
      text: `What is ${a} × ${b}? (No calculator!)`,
      answer: exact(a * b),
      solution: `Split it up: ${a} × ${b} = ${a} × 10 + ${a} × ${b - 10} = ${a * 10} + ${a * (b - 10)} = ${a * b}.`,
    };
  },
  () => {
    const a = randInt(2, 15);
    const b = randInt(2, 9);
    const c = randInt(2, 9);
    const e = randInt(2, 6);
    const d = e * randInt(2, 8);
    const value = a + b * c - d / e;
    return {
      id: `ops-${a}-${b}-${c}-${d}-${e}`,
      topic: "Arithmetic",
      difficulty: "medium",
      text: `What is ${a} + ${b} × ${c} − ${d} ÷ ${e}?`,
      answer: exact(value),
      solution: `Multiply and divide first: ${b} × ${c} = ${b * c} and ${d} ÷ ${e} = ${d / e}. Then ${a} + ${b * c} − ${d / e} = ${value}.`,
    };
  },
  () => {
    const x = randInt(2, 12);
    const a = randInt(2, 9);
    const b = randInt(1, 20);
    return {
      id: `linear-${a}-${b}-${x}`,
      topic: "Algebra",
      difficulty: "medium",
      text: `Solve for x: ${a}x + ${b} = ${a * x + b}`,
      answer: exact(x),
      solution: `Subtract ${b} from both sides: ${a}x = ${a * x}. Divide by ${a}: x = ${x}.`,
    };
  },
  () => {
    const price = pick([40, 60, 80, 120, 150]);
    const off = pick([15, 20, 25, 30, 35]);
    const sale = (price * (100 - off)) / 100;
    return {
      id: `discount-${price}-${off}`,
      topic: "Percentages",
      difficulty: "medium",
      text: `A €${price} jacket is ${off}% off. What is the sale price, in euros?`,
      answer: cents(sale),
      solution: `${off}% of €${price} is €${(price * off) / 100}, so you pay €${price} − €${(price * off) / 100} = €${sale}.`,
    };
  },
  () => {
    const [b, d] = pick([
      [2, 3],
      [3, 4],
      [2, 5],
      [4, 6],
      [3, 5],
      [4, 5],
    ] as const);
    const a = 1;
    const c = randInt(1, d - 1);
    const num = a * d + c * b;
    const den = b * d;
    const g = gcd(num, den);
    return {
      id: `frac-add-${a}-${b}-${c}-${d}`,
      topic: "Fractions",
      difficulty: "medium",
      text: `What is ${a}/${b} + ${c}/${d}? (A fraction like 7/12 is fine.)`,
      answer: prob(num / den),
      display: `${num / g}/${den / g}`,
      solution: `Use a common denominator of ${den}: ${a * d}/${den} + ${c * b}/${den} = ${num}/${den}${g > 1 ? ` = ${num / g}/${den / g}` : ""}.`,
    };
  },
  () => {
    const s = randInt(2, 5);
    const r = pick([2, 3]);
    const terms = [0, 1, 2, 3].map((i) => s * r ** i);
    return {
      id: `seq-geo-${s}-${r}`,
      topic: "Patterns",
      difficulty: "medium",
      text: `What number comes next? ${terms.join(", ")}, …`,
      answer: exact(s * r ** 4),
      solution: `Each number is ${r} times the one before: ${terms[3]} × ${r} = ${s * r ** 4}.`,
    };
  },
  () => {
    const a = randInt(35, 80);
    const b = randInt(30, 75);
    return {
      id: `triangle-${a}-${b}`,
      topic: "Geometry",
      difficulty: "medium",
      text: `Two angles of a triangle are ${a}° and ${b}°. What is the third angle, in degrees?`,
      answer: exact(180 - a - b),
      solution: `The angles of a triangle add up to 180°: 180 − ${a} − ${b} = ${180 - a - b}°.`,
    };
  },
  () => {
    const d = pick([150, 175, 200, 225, 250]);
    return {
      id: `train-speed-${d}`,
      topic: "Arithmetic",
      difficulty: "medium",
      text: `A train travels ${d} km in 2 hours 30 minutes. What is its average speed, in km/h?`,
      answer: exact(d / 2.5),
      solution: `2 hours 30 minutes is 2.5 hours, so ${d} ÷ 2.5 = ${d / 2.5} km/h.`,
    };
  },
  () => {
    const n = randInt(6, 12);
    return {
      id: `handshakes-${n}`,
      topic: "Logic",
      difficulty: "medium",
      text: `${n} people meet, and each person shakes hands once with every other person. How many handshakes happen?`,
      answer: exact((n * (n - 1)) / 2),
      solution: `Each of the ${n} people shakes ${n - 1} hands, but that counts every handshake twice: ${n} × ${n - 1} ÷ 2 = ${(n * (n - 1)) / 2}.`,
    };
  },
  () => {
    const x = randInt(3, 15);
    const result = x + 3;
    return {
      id: `think-of-a-number-${x}`,
      topic: "Algebra",
      difficulty: "medium",
      text: `I think of a number, double it, add 6, then halve the result. I end up with ${result}. What was my number?`,
      answer: exact(x),
      solution: `Work backwards: double ${result} to get ${2 * result}, subtract 6 to get ${2 * x}, halve it: ${x}.`,
    };
  },
  fixed({
    id: "fibonacci",
    topic: "Patterns",
    difficulty: "medium",
    text: "What number comes next? 1, 1, 2, 3, 5, 8, 13, …",
    answer: exact(21),
    solution: "Each number is the sum of the two before it: 8 + 13 = 21.",
  }),
  fixed({
    id: "pronic-sequence",
    topic: "Patterns",
    difficulty: "medium",
    text: "What number comes next? 2, 6, 12, 20, 30, …",
    answer: exact(42),
    solution: "The gaps grow by 2 each time (4, 6, 8, 10, …), so the next gap is 12: 30 + 12 = 42. (They are 1×2, 2×3, 3×4, …)",
  }),
  fixed({
    id: "power-of-two",
    topic: "Arithmetic",
    difficulty: "medium",
    text: "What is 2 to the power of 10?",
    answer: exact(1024),
    solution: "2, 4, 8, 16, 32, 64, 128, 256, 512, 1024 — ten doublings.",
  }),
  fixed({
    id: "ages",
    topic: "Algebra",
    difficulty: "medium",
    text: "A mother and her daughter are 50 years old in total. In 5 years, the mother will be 3 times as old as the daughter. How old is the daughter now?",
    answer: exact(10),
    solution: "Call the daughter's age d. Then the mother is 50 − d, and 50 − d + 5 = 3(d + 5). So 55 − d = 3d + 15, 4d = 40, d = 10.",
  }),
  fixed({
    id: "hexagon-angles",
    topic: "Geometry",
    difficulty: "medium",
    text: "What do the interior angles of a hexagon (6 sides) add up to, in degrees?",
    answer: exact(720),
    solution: "A hexagon splits into 4 triangles from one corner: 4 × 180° = 720°.",
  }),
  fixed({
    id: "dice-sum-7",
    topic: "Probability",
    difficulty: "medium",
    text: "Two fair dice are rolled. What is the probability that the sum is 7?",
    answer: prob(6 / 36),
    display: "1/6",
    solution: "6 of the 36 equally likely pairs sum to 7: (1,6), (2,5), (3,4), (4,3), (5,2), (6,1). So 6/36 = 1/6.",
  }),
];

// ---------- brain teasers ----------

const HARD: Factory[] = [
  fixed({
    id: "bat-and-ball",
    topic: "Logic",
    difficulty: "hard",
    text: "A bat and a ball cost €1.10 in total. The bat costs €1.00 more than the ball. How much does the ball cost, in euros?",
    answer: cents(0.05),
    solution: "If the ball costs b, the bat costs b + 1.00, so 2b + 1.00 = 1.10 and b = €0.05. (€0.10 is the tempting wrong answer: then the bat would cost €1.10 and the total €1.20.)",
  }),
  fixed({
    id: "widgets",
    topic: "Logic",
    difficulty: "hard",
    text: "If 5 machines take 5 minutes to make 5 widgets, how many minutes would 100 machines take to make 100 widgets?",
    answer: exact(5),
    solution: "Each machine makes one widget in 5 minutes. 100 machines working at the same time make 100 widgets in those same 5 minutes.",
  }),
  fixed({
    id: "lily-pads",
    topic: "Logic",
    difficulty: "hard",
    text: "A patch of lily pads doubles in size every day. It takes 48 days to cover the whole lake. How many days does it take to cover half the lake?",
    answer: exact(47),
    solution: "It doubles every day, so the day before the lake is fully covered — day 47 — it was half covered.",
  }),
  fixed({
    id: "up-down-20",
    topic: "Percentages",
    difficulty: "hard",
    text: "A price goes up by 20%, then the new price goes down by 20%. Compared with the original price, the final price is…",
    answer: choice(["The same", "4% lower", "4% higher", "2% lower"], 1),
    solution: "Take €100: +20% gives €120, and −20% of €120 is €24, leaving €96. That is 4% lower than where it started.",
  }),
  fixed({
    id: "round-trip-speed",
    topic: "Logic",
    difficulty: "hard",
    text: "You drive to a town at 60 km/h and come straight back along the same road at 40 km/h. What is your average speed for the whole trip, in km/h?",
    answer: exact(48),
    solution: "Pick a distance, say 120 km each way: 2 h there, 3 h back, so 240 km in 5 h = 48 km/h. (Not 50 — you spend longer at the slower speed.)",
  }),
  fixed({
    id: "monty-hall",
    topic: "Probability",
    difficulty: "hard",
    text: "A game show has 3 doors: a car behind one, goats behind the other two. You pick door 1. The host, who knows where the car is, opens door 3 to show a goat and lets you switch to door 2. If you switch, what is your probability of winning the car?",
    answer: prob(2 / 3),
    display: "2/3",
    solution: "Your first pick is right only 1/3 of the time. The host never opens the car's door, so the other 2/3 of the time the car is behind the door you can switch to. Switching wins 2/3 of the time.",
  }),
  fixed({
    id: "sum-1-to-100",
    topic: "Arithmetic",
    difficulty: "hard",
    text: "What is 1 + 2 + 3 + … + 99 + 100?",
    answer: exact(5050),
    solution: "Pair the ends: 1 + 100, 2 + 99, 3 + 98, … — 50 pairs that each make 101. 50 × 101 = 5050.",
  }),
  fixed({
    id: "clock-angle-3-15",
    topic: "Geometry",
    difficulty: "hard",
    text: "What is the angle, in degrees, between the hour hand and the minute hand of a clock at 3:15?",
    answer: { kind: "number", value: 7.5, tol: 0.01 },
    solution: "The minute hand points at 3. But in 15 minutes the hour hand has moved a quarter of the way from 3 to 4, which is a quarter of 30°: 7.5°.",
  }),
  fixed({
    id: "count-sevens",
    topic: "Logic",
    difficulty: "hard",
    text: "If you write out every whole number from 1 to 100, how many times do you write the digit 7?",
    answer: exact(20),
    solution: "As the last digit: 7, 17, 27, …, 97 — 10 times. As the tens digit: 70–79 — 10 more (77 counts in both). 20 in total.",
  }),
  fixed({
    id: "snail-well",
    topic: "Logic",
    difficulty: "hard",
    text: "A snail is at the bottom of a 10 m well. Every day it climbs up 3 m, and every night it slips back 2 m. On which day does it reach the top?",
    answer: exact(8),
    solution: "It gains 1 m per day, so after 7 days it is at 7 m. On day 8 it climbs 3 m and reaches the top before it can slip back.",
  }),
  fixed({
    id: "reverse-discount",
    topic: "Percentages",
    difficulty: "hard",
    text: "After a 20% discount, a shirt costs €25. What was the original price, in euros?",
    answer: cents(31.25),
    solution: "€25 is 80% of the original price, so the original was €25 ÷ 0.8 = €31.25. (Adding 20% back to €25 gives €30, which is wrong.)",
  }),
  fixed({
    id: "boy-girl",
    topic: "Probability",
    difficulty: "hard",
    text: "A family has two children, and each child is equally likely to be a boy or a girl. You learn that at least one of them is a boy. What is the probability that both are boys?",
    answer: prob(1 / 3),
    display: "1/3",
    solution: "The equally likely families are BB, BG, GB and GG. 'At least one boy' rules out only GG, leaving three, and only one of them (BB) has two boys: 1/3.",
  }),
  fixed({
    id: "birthday-23",
    topic: "Probability",
    difficulty: "hard",
    text: "23 people are in a room. Roughly what is the probability that at least two of them share a birthday?",
    answer: choice(["About 6%", "About 25%", "About 50%", "About 90%"], 2),
    solution: "Think in pairs, not people: 23 people make 253 pairs. 1 − (365 × 364 × … × 343) / 365²³ ≈ 0.507, just over 50%.",
  }),
  fixed({
    id: "chessboard-squares",
    topic: "Geometry",
    difficulty: "hard",
    text: "How many squares of any size (1×1, 2×2, … up to 8×8) are there on a chessboard?",
    answer: exact(204),
    solution: "There are 8² squares of size 1×1, 7² of size 2×2, … and 1² of size 8×8: 64 + 49 + 36 + 25 + 16 + 9 + 4 + 1 = 204.",
  }),
];

const POOL: Record<Difficulty, Factory[]> = { easy: EASY, medium: MEDIUM, hard: HARD };
const WEIGHTS: [Difficulty, number][] = [
  ["easy", 0.3],
  ["medium", 0.4],
  ["hard", 0.3],
];

function pickDifficulty(): Difficulty {
  let r = Math.random();
  for (const [d, w] of WEIGHTS) {
    if ((r -= w) < 0) return d;
  }
  return "medium";
}

/**
 * A random problem of random difficulty. Avoids repeating one of the recent
 * problems and, where possible, the previous problem's topic.
 */
export function nextProblem(recent: readonly Problem[] = []): Problem {
  const seen = new Set(recent.slice(-15).map((p) => p.id));
  const lastTopic = recent.at(-1)?.topic;
  let fallback: Problem | null = null;
  for (let tries = 0; tries < 40; tries++) {
    const p = pick(POOL[pickDifficulty()])();
    if (seen.has(p.id)) continue;
    fallback ??= p;
    if (p.topic !== lastTopic) return p;
  }
  return fallback ?? pick(POOL.medium)();
}

// ---------- answer checking ----------

/**
 * Every number the input can mean, most likely first; empty if it isn't a
 * number. Lenient on format: "x = 8", "€0.05", "7.5°", "48 km/h"; fractions,
 * decimals and percents work as in the pilot. A comma is a decimal comma
 * ("0,375", as in Finnish) unless it groups thousands ("5,050"). "1,083" is
 * genuinely ambiguous (1083 or 1.083), so it yields both readings; they differ
 * by a factor of 1000, so accepting either can't let a wrong answer through.
 */
export function readAnswers(raw: string): number[] {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^[a-z]\s*=\s*/, "").replace(/^day\s+/, "");
  s = s.replace(/[€$£°]/g, "");
  s = s.replace(/\s*(km\/h|kmh|cm|degrees?|deg|minutes?|mins?|days?|euros?|eur|handshakes?)$/, "").trim();
  // Thousands groups never start with 0, so "0,917" is always a decimal.
  const grouped = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) && !/^-?0/.test(s);
  if (!grouped) {
    const value = parseNumber(s);
    return value === null ? [] : [value];
  }
  const thousands = parseNumber(s.replace(/,/g, ""));
  const decimal = /^-?\d{1,3},\d{3}$/.test(s) ? parseNumber(s) : null; // one comma: maybe a decimal comma
  return [thousands, decimal].filter((v): v is number => v !== null);
}

/** The most likely number the input means, or null if it isn't a number. */
export function readAnswer(raw: string): number | null {
  return readAnswers(raw)[0] ?? null;
}

export function isCorrect(problem: Problem, value: number): boolean {
  return problem.answer.kind === "number" && isCorrectNumber(problem.answer, value);
}

/** Correct under any reading of the input (see readAnswers). */
export function isCorrectInput(problem: Problem, raw: string): boolean {
  return readAnswers(raw).some((value) => isCorrect(problem, value));
}

/** The correct answer as text, for logs and prompts. */
export function answerText(problem: Problem): string {
  if (problem.display) return problem.display;
  const a = problem.answer;
  return a.kind === "number" ? String(Number(a.value.toPrecision(6))) : a.options[a.correct];
}
