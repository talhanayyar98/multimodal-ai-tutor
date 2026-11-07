"use client";

import { useEffect, useRef, useState } from "react";
import { postSelfReport, type SelfReportState } from "@/lib/api";
import { PROBE_JITTER_FRACTION } from "@/lib/pilot";

const OPTIONS: { state: SelfReportState; label: string; hint: string }[] = [
  { state: "engaged", label: "Engaged", hint: "Focused and working on it" },
  { state: "confused", label: "Confused", hint: "Unsure what to do or what something means" },
  { state: "bored", label: "Bored", hint: "Not interested, my mind is wandering" },
  { state: "frustrated", label: "Frustrated", hint: "Stuck or annoyed" },
  { state: "neutral", label: "None of these", hint: "No strong feeling either way" },
];

// A click or Enter in the first moments after the pop-up appears was almost
// always aimed at the page underneath — don't record it as an answer.
const ARM_DELAY_MS = 700;

/**
 * Pilot-mode experience-sampling pop-up: every ~intervalS seconds asks the
 * learner which state they are in and stores the answer as a training label.
 */
export default function SelfReportProbe({
  sessionId,
  intervalS,
  onSaved,
  onError,
}: {
  sessionId: string;
  intervalS: number;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [promptedAt, setPromptedAt] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const [cycle, setCycle] = useState(0); // bumped after each answer to schedule the next check-in
  const answeredRef = useRef<number | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Schedule the next check-in, timed from the previous answer (or session start).
  useEffect(() => {
    setPromptedAt(null);
    const jitter = (Math.random() * 2 - 1) * PROBE_JITTER_FRACTION;
    const timer = setTimeout(() => setPromptedAt(Date.now()), intervalS * (1 + jitter) * 1000);
    return () => clearTimeout(timer);
  }, [sessionId, intervalS, cycle]);

  // On open: pull focus out of the chat box (so in-flight typing can't land
  // anywhere) and only accept answers after a short delay.
  useEffect(() => {
    if (promptedAt === null) return;
    setArmed(false);
    dialogRef.current?.focus();
    const timer = setTimeout(() => setArmed(true), ARM_DELAY_MS);
    return () => clearTimeout(timer);
  }, [promptedAt]);

  function answer(state: SelfReportState) {
    if (promptedAt === null || !armed || answeredRef.current === promptedAt) return;
    answeredRef.current = promptedAt;
    const report = { sessionId, state, promptedAt, answeredAt: Date.now() };
    setCycle((c) => c + 1); // close right away; saving happens in the background
    postSelfReport(report).then(onSaved, (err: Error) =>
      onError(`Check-in was not saved (${err.message}). Is MongoDB running?`),
    );
  }

  if (promptedAt === null) return null;

  return (
    <div className="probe-backdrop">
      <div
        ref={dialogRef}
        className="probe card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="probe-title"
        aria-describedby="probe-question"
        tabIndex={-1}
        data-testid="self-report"
      >
        <h2 id="probe-title">Quick check-in</h2>
        <p id="probe-question">Right now, which best describes how you feel about the task?</p>
        <div className="probe-options">
          {OPTIONS.map((o) => (
            <button
              key={o.state}
              className="probe-option"
              data-state={o.state}
              data-testid={`self-report-${o.state}`}
              disabled={!armed}
              onClick={() => answer(o.state)}
            >
              <span className="probe-label">{o.label}</span>
              <span className="probe-hint">{o.hint}</span>
            </button>
          ))}
        </div>
        <p className="probe-foot">There are no right or wrong answers — just pick what fits best.</p>
      </div>
    </div>
  );
}
