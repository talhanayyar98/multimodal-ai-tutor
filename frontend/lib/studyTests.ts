// Pre- and post-test of the A/B study (/study): learning gain on what the
// tutoring practises. Two matched forms, A and B. Each participant does one
// before the tutoring and the other after it; which comes first ("AB" / "BA")
// is balanced within each group by the backend's allocation blocks.
//
// Design:
// - Each question mirrors one of the 8 tutoring problems where help is
//   actually needed (lib/studyTask.ts #5–#12): same skill and structure,
//   different numbers and story. The warm-ups are left out (near ceiling).
// - Forms A and B ask the same skills in the same order with matched
//   difficulty, and their answers differ, so nothing carries over.
// - No question equals a tutoring problem, so the post-test can't be passed by
//   remembering a tutoring answer.
// - The tests sit outside the intervention: identical for both groups, no
//   tutor, no hints, no check-ins, no feedback, no going back, no time limit.
//   "I don't know" is allowed and scored as not correct.
// - Scored with the tutoring's answer checker (readAnswers + isCorrectNumber);
//   fractions get explicit tolerances so near-misses like 0.91 for 9/10 fail.
//
// Frozen on purpose, like the problem set: change it only between studies.

import { isCorrectNumber } from "./exercises";
import { cents, exact, readAnswers, type NumberAnswer } from "./problems";

export type TestForm = "A" | "B";

export interface TestItem {
  /** Unique across both forms, e.g. "A-fractions". */
  id: string;
  skill: string;
  /** The tutoring problem (lib/studyTask.ts id) this question mirrors. */
  mirrors: string;
  text: string;
  answer: NumberAnswer;
}

/** A fraction answer: decimals within `tol` count too (0.917 for 11/12). */
const fraction = (value: number, tol: number): NumberAnswer => ({ kind: "number", value, tol });

export const TEST_FORMS: Record<TestForm, readonly TestItem[]> = {
  A: [
    {
      id: "A-algebra",
      skill: "algebra",
      mirrors: "linear-4-7-8",
      text: "Solve for x: 5x + 4 = 39",
      answer: exact(7),
    },
    {
      id: "A-fractions",
      skill: "fractions",
      mirrors: "frac-add-1-3-3-4",
      text: "What is 1/4 + 2/3? (A fraction like 7/12 is fine.)",
      answer: fraction(11 / 12, 0.005),
    },
    {
      id: "A-discount",
      skill: "discount",
      mirrors: "discount-80-25",
      text: "A €40 T-shirt is 35% off. What is the sale price, in euros?",
      answer: cents(26),
    },
    {
      id: "A-triangle",
      skill: "triangle",
      mirrors: "triangle-65-48",
      text: "Two angles of a triangle are 72° and 57°. What is the third angle, in degrees?",
      answer: exact(51),
    },
    {
      id: "A-pairs",
      skill: "pairs",
      mirrors: "handshakes-8",
      text: "In a chess club, each of 7 players plays every other player exactly once. How many games are played?",
      answer: exact(21),
    },
    {
      id: "A-bat-ball",
      skill: "bat-ball",
      mirrors: "bat-and-ball",
      text: "A notebook and a pencil cost €2.40 in total. The notebook costs €2.00 more than the pencil. How much does the pencil cost, in euros?",
      answer: cents(0.2),
    },
    {
      id: "A-doubling",
      skill: "doubling",
      mirrors: "lily-pads",
      text: "The bacteria in a jar double in number every minute. The jar is full after 60 minutes. After how many minutes was it half full?",
      answer: exact(59),
    },
    {
      id: "A-monty-hall",
      skill: "monty-hall",
      mirrors: "monty-hall",
      text: "There are 3 boxes and a prize is in one of them. You choose box 1. The host, who knows where the prize is, opens box 3, which is empty, and offers you box 2 instead. If you stay with box 1, what is your probability of winning the prize?",
      answer: fraction(1 / 3, 0.005),
    },
  ],
  B: [
    {
      id: "B-algebra",
      skill: "algebra",
      mirrors: "linear-4-7-8",
      text: "Solve for x: 6x + 9 = 63",
      answer: exact(9),
    },
    {
      id: "B-fractions",
      skill: "fractions",
      mirrors: "frac-add-1-3-3-4",
      text: "What is 2/5 + 1/2? (A fraction like 7/12 is fine.)",
      answer: fraction(9 / 10, 0.002),
    },
    {
      id: "B-discount",
      skill: "discount",
      mirrors: "discount-80-25",
      text: "A €60 pair of shoes is 15% off. What is the sale price, in euros?",
      answer: cents(51),
    },
    {
      id: "B-triangle",
      skill: "triangle",
      mirrors: "triangle-65-48",
      text: "Two angles of a triangle are 38° and 85°. What is the third angle, in degrees?",
      answer: exact(57),
    },
    {
      id: "B-pairs",
      skill: "pairs",
      mirrors: "handshakes-8",
      text: "9 teams play in a league, and every team plays every other team exactly once. How many matches are played?",
      answer: exact(36),
    },
    {
      id: "B-bat-ball",
      skill: "bat-ball",
      mirrors: "bat-and-ball",
      text: "A coffee and a cookie cost €3.20 together. The coffee costs €3.00 more than the cookie. How much does the cookie cost, in euros?",
      answer: cents(0.1),
    },
    {
      id: "B-doubling",
      skill: "doubling",
      mirrors: "lily-pads",
      text: "A patch of moss doubles in size every week. It covers the whole wall after 12 weeks. After how many weeks did it cover half the wall?",
      answer: exact(11),
    },
    {
      id: "B-monty-hall",
      skill: "monty-hall",
      mirrors: "monty-hall",
      text: "There are 3 cups and a ball is under one of them. You point to cup 1. The person who hid the ball, and knows where it is, lifts cup 2 to show it is empty and offers you cup 3 instead. If you switch to cup 3, what is your probability of finding the ball?",
      answer: fraction(2 / 3, 0.005),
    },
  ],
};

/** null: the input isn't a number (ask again); otherwise whether it is correct under any reading. */
export function scoreTestAnswer(item: TestItem, raw: string): boolean | null {
  const values = readAnswers(raw);
  return values.length === 0 ? null : values.some((value) => isCorrectNumber(item.answer, value));
}
