"use client";

import { useState, type FormEvent } from "react";
import type { PostSurvey as PostSurveyAnswers } from "@/lib/api";
import { InputQuestion, ScaleField } from "./fields";
import { ArrowRightIcon } from "./icons";

export default function PostSurvey({
  endedEarly,
  onSubmit,
}: {
  endedEarly: boolean;
  onSubmit: (answers: PostSurveyAnswers) => Promise<void>;
}) {
  const [checkinFit, setCheckinFit] = useState<number | undefined>();
  const [distractions, setDistractions] = useState("");
  const [comments, setComments] = useState("");
  const [showMissing, setShowMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!checkinFit) {
      setShowMissing(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        checkinFit,
        distractions: distractions.trim() || undefined,
        comments: comments.trim() || undefined,
      });
    } catch (err) {
      setError(`Could not save your answers: ${(err as Error).message}. Please tell the researcher.`);
      setBusy(false);
    }
  }

  return (
    <form className="card collect-card post" onSubmit={handleSubmit} data-testid="post-survey">
      <p className="eyebrow">{endedEarly ? "Wrap-up" : "You made it"}</p>
      <h2>{endedEarly ? "Session ended" : "All done — last three questions"}</h2>
      <p className="muted section-blurb">
        {endedEarly
          ? "Thanks for your time. Everything recorded so far is kept — just three quick questions."
          : "The questions are over. These last three take under a minute."}
      </p>

      <ScaleField
        n={1}
        state={checkinFit ? "answered" : showMissing ? "missing" : "active"}
        name="checkinFit"
        legend="How well did the check-in options describe how you actually felt?"
        low="not at all"
        high="very well"
        value={checkinFit}
        onChange={setCheckinFit}
      />

      <InputQuestion
        n={2}
        state={distractions.trim() ? "answered" : "idle"}
        legend="Did anything distract you during the session? (optional)"
      >
        <textarea
          className="text-input"
          rows={2}
          maxLength={1000}
          value={distractions}
          onChange={(e) => setDistractions(e.target.value)}
          placeholder="e.g. noise, phone, someone came in"
        />
      </InputQuestion>

      <InputQuestion
        n={3}
        state={comments.trim() ? "answered" : "idle"}
        legend="Any other comments? (optional)"
      >
        <textarea
          className="text-input"
          rows={3}
          maxLength={2000}
          value={comments}
          onChange={(e) => setComments(e.target.value)}
        />
      </InputQuestion>

      {error && <p className="error">{error}</p>}
      <div className="collect-actions">
        <button className="btn btn-gold btn-lg" type="submit" disabled={busy} data-testid="post-submit">
          {busy ? "Saving…" : "Finish"} {!busy && <ArrowRightIcon size={15} />}
        </button>
      </div>
    </form>
  );
}
