"use client";

import StepTrack, { type StepStatus, type TrackStep } from "@/components/StepTrack";

export type PhaseId = "consent" | "intake" | "setup" | "task" | "post";

const PHASES: { id: PhaseId; label: string }[] = [
  { id: "consent", label: "Consent" },
  { id: "intake", label: "About you" },
  { id: "setup", label: "Camera check" },
  { id: "task", label: "Questions" },
  { id: "post", label: "Wrap-up" },
];

// Rough minutes per phase, only used for the "about N min left" estimate.
const FIXED_MIN: Record<Exclude<PhaseId, "task">, number> = {
  consent: 2,
  intake: 2,
  setup: 1,
  post: 1,
};
const WARMUP_MIN = 2;

/**
 * Progress through the pilot session: five phases, with the warm-up + parts
 * shown as small segments under "Questions". It only changes at phase/part
 * boundaries, so it doesn't add a ticking clock to the exercises.
 */
export default function Stepper({
  step,
  stageIndex,
  stageCount,
  blockSeconds,
}: {
  step: PhaseId | "done";
  /** Index into [warm-up, ...blocks] of the stage on screen. */
  stageIndex: number;
  /** Warm-up + number of blocks. */
  stageCount: number;
  blockSeconds: number;
}) {
  const done = step === "done";
  const current = done ? PHASES.length : PHASES.findIndex((p) => p.id === step);
  const taskIndex = PHASES.findIndex((p) => p.id === "task");
  const blockCount = stageCount - 1;

  const stageMin = (i: number) => (i === 0 ? WARMUP_MIN : blockSeconds / 60);
  const stagesFrom = (from: number) => {
    let sum = 0;
    for (let i = from; i < stageCount; i++) sum += stageMin(i);
    return sum;
  };
  const phaseMin = (id: PhaseId) => (id === "task" ? stagesFrom(0) : FIXED_MIN[id]);

  let remaining = 0;
  PHASES.forEach((p, i) => {
    if (i > current) remaining += phaseMin(p.id);
    else if (i === current) remaining += p.id === "task" ? stagesFrom(stageIndex) : phaseMin(p.id);
  });

  const summary = done
    ? "All done. Thank you!"
    : remaining < 1
      ? "less than a minute left"
      : `about ${Math.round(remaining)} min left`;

  function meta(i: number, id: PhaseId): string {
    if (i < current) return "Done";
    if (id === "task") {
      if (i === current) return stageIndex === 0 ? "Warm-up" : `Part ${stageIndex} of ${blockCount}`;
      return `~${Math.round(phaseMin(id))} min`;
    }
    return `~${phaseMin(id)} min`;
  }

  const stageStatus = (j: number): StepStatus =>
    current > taskIndex || (current === taskIndex && j < stageIndex)
      ? "done"
      : current === taskIndex && j === stageIndex
        ? "current"
        : "upcoming";

  const steps: TrackStep[] = PHASES.map((p, i) => ({
    id: p.id,
    label: p.label,
    meta: meta(i, p.id),
    segments:
      p.id === "task"
        ? Array.from({ length: stageCount }, (_, j) => ({ status: stageStatus(j), short: j === 0 }))
        : undefined,
  }));

  return <StepTrack steps={steps} current={current} summary={summary} />;
}
