"use client";

import { useEffect } from "react";
import AiSparkle from "@/components/AiSparkle";
import { NUDGE_COPY, NUDGE_RULES, type NudgeOffer } from "@/lib/nudges";

/**
 * The tutor speaking up: "You seem a little confused. Want a hint?". Sits just
 * above the chat input; a thin bar shows how long until the offer fades away.
 */
export default function NudgeBubble({
  offer,
  disabled,
  note,
  onAnswer,
}: {
  offer: NudgeOffer;
  /** True while another tutor reply is on its way. */
  disabled: boolean;
  /** Why the tutor thinks so (shown small, for transparency). */
  note: string;
  onAnswer: (accepted: boolean) => void;
}) {
  const copy = NUDGE_COPY[offer.state];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onAnswer(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAnswer]);

  return (
    <div
      className="nudge"
      data-state={offer.state}
      role="region"
      aria-label="The tutor is checking in"
      aria-live="polite"
      data-testid="nudge"
    >
      <span className="nudge-avatar" aria-hidden="true">
        <AiSparkle size={18} />
      </span>
      <div className="nudge-body">
        <p className="nudge-title">
          {copy.title}
          <span className="nudge-chip" data-state={offer.state}>
            <i className="dot" /> {offer.state}
          </span>
        </p>
        <p className="nudge-question">{copy.question}</p>
        <div className="nudge-actions">
          <button
            type="button"
            className="btn btn-nudge-yes"
            onClick={() => onAnswer(true)}
            disabled={disabled}
            data-testid="nudge-yes"
          >
            <AiSparkle size={13} /> {copy.yes}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onAnswer(false)}
            data-testid="nudge-no"
          >
            {copy.no}
          </button>
        </div>
        <p className="nudge-why">{note}</p>
      </div>
      <span
        className="nudge-countdown"
        aria-hidden="true"
        style={{ animationDuration: `${NUDGE_RULES.expireMs}ms` }}
      />
    </div>
  );
}
