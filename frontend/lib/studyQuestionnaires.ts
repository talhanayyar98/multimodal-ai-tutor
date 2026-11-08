// The study's questionnaires about the tutoring, shown right after it (before
// the post-test, so how the quiz went can't colour the ratings). Scored by the
// backend (backend/src/questionnaires.ts). Frozen like the problems and tests.

// ---------- NASA-TLX, raw version (Hart & Staveland, 1988; Hart, 2006) ----------
// Six scales, 0–100 in steps of 5 (21 points, as on the paper form). No
// pairwise weighting: the raw score is the mean of the six. Wording follows the
// official paper-and-pencil form; "the task" is spelled out as the tutoring.
// Performance runs from "Perfect" (0) to "Failure" (100), like the original, so
// higher always means more workload.

/** Must match TLX_SCALES in backend/src/models.ts. */
export type TlxScaleKey = "mental" | "physical" | "temporal" | "performance" | "effort" | "frustration";

export interface TlxScale {
  key: TlxScaleKey;
  title: string;
  question: string;
  low: string;
  high: string;
}

export const TLX_SCALES: readonly TlxScale[] = [
  { key: "mental", title: "Mental demand", question: "How mentally demanding was the task?", low: "Very low", high: "Very high" },
  { key: "physical", title: "Physical demand", question: "How physically demanding was the task?", low: "Very low", high: "Very high" },
  { key: "temporal", title: "Temporal demand", question: "How hurried or rushed was the pace of the task?", low: "Very low", high: "Very high" },
  {
    key: "performance",
    title: "Performance",
    question: "How successful were you in accomplishing what you were asked to do?",
    low: "Perfect",
    high: "Failure",
  },
  {
    key: "effort",
    title: "Effort",
    question: "How hard did you have to work to accomplish your level of performance?",
    low: "Very low",
    high: "Very high",
  },
  {
    key: "frustration",
    title: "Frustration",
    question: "How insecure, discouraged, irritated, stressed, and annoyed were you?",
    low: "Very low",
    high: "Very high",
  },
];

/** The 21 points of a TLX scale. */
export const TLX_STEPS = Array.from({ length: 21 }, (_, i) => i * 5);

// ---------- SUS (Brooke, 1996) ----------
// The ten standard items, 1 = strongly disagree … 5 = strongly agree, in the
// standard order (odd items positive, even items negative). Two documented,
// score-neutral wording changes: "this system" → "the AI tutor", and item 8's
// "cumbersome" → "awkward" for non-native English speakers (Finstad, 2006;
// Bangor, Kortum & Miller, 2008).

export const SUS_ITEMS: readonly string[] = [
  "I think that I would like to use the AI tutor frequently.",
  "I found the AI tutor unnecessarily complex.",
  "I thought the AI tutor was easy to use.",
  "I think that I would need the support of a technical person to be able to use the AI tutor.",
  "I found the various functions in the AI tutor were well integrated.",
  "I thought there was too much inconsistency in the AI tutor.",
  "I would imagine that most people would learn to use the AI tutor very quickly.",
  "I found the AI tutor very awkward to use.",
  "I felt very confident using the AI tutor.",
  "I needed to learn a lot of things before I could get going with the AI tutor.",
];
