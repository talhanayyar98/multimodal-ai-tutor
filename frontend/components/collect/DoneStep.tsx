"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "./icons";

export default function DoneStep({ participantId }: { participantId: string | null }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!participantId) return;
    try {
      await navigator.clipboard.writeText(participantId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — the code is on screen, nothing else to do.
    }
  }

  return (
    <section className="card collect-card done-card" data-testid="done">
      <div className="done-badge" aria-hidden="true">
        <svg viewBox="0 0 52 52">
          <circle className="done-badge-circle" cx="26" cy="26" r="23" />
          <path className="done-badge-check" d="M15 27l7.5 7.5L37.5 19" />
        </svg>
      </div>
      <h2>Thank you!</h2>
      <p className="lead">You&apos;ve finished the session — your answers have been saved.</p>

      {participantId && (
        <div className="code-box">
          <span className="code-label">Your participant code</span>
          <b className="code-value">{participantId}</b>
          <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}

      <p>
        Your data is stored under this code, without your name. If you ever want it deleted, give
        this code to the researcher.
      </p>
      <p>
        Some parts were deliberately repetitive, very hard or under time pressure, to bring out
        different learning states. How many questions you got right doesn&apos;t matter at all —
        your honest check-ins are what make the data useful.
      </p>
      <p className="muted">You can close this tab now.</p>
    </section>
  );
}
