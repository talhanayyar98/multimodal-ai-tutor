import { CheckIcon } from "@/components/collect/icons";

export type StepStatus = "done" | "current" | "upcoming";

export interface TrackStep {
  id: string;
  label: string;
  /** Small line under the label: "Done", "~5 min", "Part 2 of 4"… */
  meta: string;
  /** Sub-steps drawn as small segments under the step. */
  segments?: { status: StepStatus; short?: boolean }[];
}

/**
 * Session-wide progress as numbered dots joined by a line (the "where am I"
 * strip under the header of /study and /collect). It only changes at step
 * boundaries, so it never adds a ticking clock.
 */
export default function StepTrack({
  steps,
  current,
  summary,
  compact = false,
}: {
  steps: TrackStep[];
  /** Index of the step on screen; `steps.length` once everything is done. */
  current: number;
  /** Right-hand line, e.g. "about 12 min left". */
  summary: string;
  /** One slim row (dots only) for screens where the learner is working. */
  compact?: boolean;
}) {
  const done = current >= steps.length;
  return (
    <nav className="card stepper" aria-label="Session progress" data-compact={compact} data-testid="stepper">
      <div className="stepper-top">
        <span className="stepper-title">
          {done ? "Your session" : `Step ${current + 1} of ${steps.length}`}
        </span>
        <span className="stepper-summary" aria-live="polite">
          {!done && compact && (
            <>
              <b>{steps[current].label}</b> ·{" "}
            </>
          )}
          {summary}
        </span>
      </div>
      <ol className="stepper-track">
        {steps.map((s, i) => {
          const status: StepStatus = i < current ? "done" : i === current ? "current" : "upcoming";
          return (
            <li
              key={s.id}
              className="stepper-step"
              data-status={status}
              aria-current={status === "current" ? "step" : undefined}
              title={compact ? s.label : undefined}
            >
              <span className="stepper-dot">{status === "done" ? <CheckIcon size={15} /> : i + 1}</span>
              <span className="stepper-label">{s.label}</span>
              <span className="stepper-meta">{s.meta}</span>
              {s.segments && (
                <span className="stepper-segments" aria-hidden="true">
                  {s.segments.map((seg, j) => (
                    <span key={j} data-status={seg.status} data-short={seg.short} />
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
