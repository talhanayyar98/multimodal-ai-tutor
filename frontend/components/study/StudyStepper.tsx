"use client";

import StepTrack, { type StepStatus, type TrackStep } from "@/components/StepTrack";

export type StudyStep = "consent" | "pretest" | "camera" | "tutoring" | "tlx" | "sus" | "posttest" | "done";

// What the participant sees: the two questionnaires are one step, "Your feedback".
const SHOWN = ["consent", "pretest", "camera", "tutoring", "feedback", "posttest"] as const;
type Shown = (typeof SHOWN)[number];

const LABEL: Record<Shown, string> = {
  consent: "Welcome",
  pretest: "Quiz 1",
  camera: "Camera check",
  tutoring: "Tutoring",
  feedback: "Your feedback",
  posttest: "Quiz 2",
};

// Rough minutes per step, only for the "about N min left" estimate. The
// tutoring's share is its time limit: an upper bound, not a countdown.
const QUIZ_MIN = 6;
const QUESTIONNAIRE_MIN = 2;
const FIXED_MIN = { consent: 2, pretest: QUIZ_MIN, camera: 1, posttest: QUIZ_MIN };

function shownStep(step: StudyStep): Shown | "done" {
  return step === "tlx" || step === "sus" ? "feedback" : step;
}

/**
 * Progress through the study session, identical for both groups. Like the
 * pilot's, it only changes at step boundaries (and from problem to problem),
 * so the tutoring still has no countdown.
 */
export default function StudyStepper({
  step,
  tutoringMinutes,
  problem,
  compact,
}: {
  step: StudyStep;
  /** The tutoring's time limit. */
  tutoringMinutes: number;
  /** The problem on screen during the tutoring. */
  problem: { number: number; total: number } | null;
  /** One slim row, while the participant is working with the tutor. */
  compact: boolean;
}) {
  const shown = shownStep(step);
  const current = shown === "done" ? SHOWN.length : SHOWN.indexOf(shown);

  const minutes = (id: Shown) =>
    id === "tutoring" ? tutoringMinutes : id === "feedback" ? 2 * QUESTIONNAIRE_MIN : FIXED_MIN[id];

  let remaining = 0;
  SHOWN.forEach((id, i) => {
    if (i > current) remaining += minutes(id);
    else if (i === current) remaining += step === "sus" ? QUESTIONNAIRE_MIN : minutes(id);
  });

  const summary =
    shown === "done"
      ? "All done. Thank you!"
      : remaining < 1
        ? "less than a minute left"
        : `about ${Math.round(remaining)} min left`;

  function meta(i: number, id: Shown): string {
    if (i < current) return "Done";
    if (i === current) {
      if (id === "tutoring" && problem) return `Problem ${problem.number} of ${problem.total}`;
      if (id === "feedback") return step === "tlx" ? "Part 1 of 2" : "Part 2 of 2";
    }
    if (id === "tutoring") return `up to ${Math.round(tutoringMinutes)} min`;
    return `~${Math.round(minutes(id))} min`;
  }

  const feedbackIndex = SHOWN.indexOf("feedback");
  const partStatus = (j: number): StepStatus =>
    current > feedbackIndex || (step === "sus" && j === 0)
      ? "done"
      : current === feedbackIndex && j === (step === "sus" ? 1 : 0)
        ? "current"
        : "upcoming";

  const steps: TrackStep[] = SHOWN.map((id, i) => ({
    id,
    label: LABEL[id],
    meta: meta(i, id),
    segments: id === "feedback" ? [{ status: partStatus(0) }, { status: partStatus(1) }] : undefined,
  }));

  return <StepTrack steps={steps} current={current} summary={summary} compact={compact} />;
}
