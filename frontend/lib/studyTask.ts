// The A/B study's tutoring task (/study): the same 12 problems, in the same
// order, for every participant — warm-ups first, brain teasers last. The
// tutoring ends after the last problem or when the time limit is reached,
// whichever comes first. Participants see their progress ("Problem 3 of 12")
// but no countdown, so there is no extra time pressure.
//
// Frozen on purpose: the main page's bank (problems.ts) draws random numbers
// and may keep changing, but every study participant must get exactly these
// problems. IDs match the bank's, so the same problem has the same id in demo
// and study data. Change this list only between studies, never during one.

import { cents, choice, exact, prob, type Problem } from "./problems";

export const STUDY_TIME_LIMIT_MIN = 20;
export const STUDY_TIME_LIMIT_MS = STUDY_TIME_LIMIT_MIN * 60_000;

export const STUDY_PROBLEMS: readonly Problem[] = [
  // ---------- warm-ups ----------
  {
    id: "add-47-38",
    topic: "Arithmetic",
    difficulty: "easy",
    text: "What is 47 + 38?",
    answer: exact(85),
    solution: "47 + 38 = 85.",
  },
  {
    id: "percent-of-25-120",
    topic: "Percentages",
    difficulty: "easy",
    text: "What is 25% of 120?",
    answer: exact(30),
    solution: "25% means 25/100, so 25/100 × 120 = 30.",
  },
  {
    id: "seq-arith-5-7",
    topic: "Patterns",
    difficulty: "easy",
    text: "What number comes next? 5, 12, 19, 26, …",
    answer: exact(33),
    solution: "Each number is 7 more than the one before: 26 + 7 = 33.",
  },
  {
    id: "marbles-3-5",
    topic: "Probability",
    difficulty: "easy",
    text: "A bag has 3 red and 5 blue marbles. You pick one without looking. What is the probability that it is red?",
    answer: prob(3 / 8),
    display: "3/8",
    solution: "3 of the 8 marbles are red, so the probability is 3/8.",
  },

  // ---------- medium ----------
  {
    id: "linear-4-7-8",
    topic: "Algebra",
    difficulty: "medium",
    text: "Solve for x: 4x + 7 = 39",
    answer: exact(8),
    solution: "Subtract 7 from both sides: 4x = 32. Divide by 4: x = 8.",
  },
  {
    id: "frac-add-1-3-3-4",
    topic: "Fractions",
    difficulty: "medium",
    text: "What is 1/3 + 3/4? (A fraction like 7/12 is fine.)",
    answer: prob(13 / 12),
    display: "13/12",
    solution: "Use a common denominator of 12: 4/12 + 9/12 = 13/12.",
  },
  {
    id: "discount-80-25",
    topic: "Percentages",
    difficulty: "medium",
    text: "A €80 jacket is 25% off. What is the sale price, in euros?",
    answer: cents(60),
    solution: "25% of €80 is €20, so you pay €80 − €20 = €60.",
  },
  {
    id: "triangle-65-48",
    topic: "Geometry",
    difficulty: "medium",
    text: "Two angles of a triangle are 65° and 48°. What is the third angle, in degrees?",
    answer: exact(67),
    solution: "The angles of a triangle add up to 180°: 180 − 65 − 48 = 67°.",
  },
  {
    id: "handshakes-8",
    topic: "Logic",
    difficulty: "medium",
    text: "8 people meet, and each person shakes hands once with every other person. How many handshakes happen?",
    answer: exact(28),
    solution: "Each of the 8 people shakes 7 hands, but that counts every handshake twice: 8 × 7 ÷ 2 = 28.",
  },

  // ---------- brain teasers ----------
  {
    id: "bat-and-ball",
    topic: "Logic",
    difficulty: "hard",
    text: "A bat and a ball cost €1.10 in total. The bat costs €1.00 more than the ball. How much does the ball cost, in euros?",
    answer: cents(0.05),
    solution: "If the ball costs b, the bat costs b + 1.00, so 2b + 1.00 = 1.10 and b = €0.05. (€0.10 is the tempting wrong answer: then the bat would cost €1.10 and the total €1.20.)",
  },
  {
    id: "lily-pads",
    topic: "Logic",
    difficulty: "hard",
    text: "A patch of lily pads doubles in size every day. It takes 48 days to cover the whole lake. How many days does it take to cover half the lake?",
    answer: exact(47),
    solution: "It doubles every day, so the day before the lake is fully covered — day 47 — it was half covered.",
  },
  {
    id: "monty-hall",
    topic: "Probability",
    difficulty: "hard",
    text: "A game show has 3 doors: a car behind one, goats behind the other two. You pick door 1. The host, who knows where the car is, opens door 3 to show a goat and lets you switch to door 2. If you switch, what is your probability of winning the car?",
    answer: prob(2 / 3),
    display: "2/3",
    solution: "Your first pick is right only 1/3 of the time. The host never opens the car's door, so the other 2/3 of the time the car is behind the door you can switch to. Switching wins 2/3 of the time.",
  },
];
