"use client";

// NASA-TLX or SUS about the tutoring, on one page. Every item must be answered
// (nothing is pre-selected, so a default can't sneak in as an answer); a submit
// with gaps marks the missing ones and scrolls to the first. Identical for
// both groups. Wording: lib/studyQuestionnaires.ts; scoring: the backend.

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Marker, Missing, ScaleField, type QuestionState } from "@/components/collect/fields";
import { ArrowRightIcon, ExitIcon } from "@/components/collect/icons";
import { postQuestionnaire } from "@/lib/api";
import { SUS_ITEMS, TLX_SCALES, TLX_STEPS, type TlxScale } from "@/lib/studyQuestionnaires";

/** One NASA-TLX scale: 21 points from 0 to 100, the middle one marked, like the paper form. */
function TlxField({
  n,
  scale,
  value,
  onChange,
  state,
}: {
  n: number;
  scale: TlxScale;
  value: number | undefined;
  onChange: (value: number) => void;
  state: QuestionState;
}) {
  return (
    <fieldset className="field q tlx-field" data-state={state}>
      <legend>
        <Marker n={n} state={state} />
        {scale.title}
      </legend>
      <p className="tlx-question">{scale.question}</p>
      <div className="tlx-scale">
        <div className="tlx-steps">
          {TLX_STEPS.map((v) => (
            <label
              key={v}
              className="tlx-step"
              data-on={value !== undefined && v <= value}
              data-checked={value === v}
              data-mid={v === 50}
            >
              <input
                type="radio"
                name={`tlx-${scale.key}`}
                checked={value === v}
                onChange={() => onChange(v)}
                aria-label={`${scale.title}: ${v} of 100 (0 = ${scale.low}, 100 = ${scale.high})`}
                data-testid={`tlx-${scale.key}-${v}`}
              />
            </label>
          ))}
        </div>
        <div className="scale-ends" aria-hidden="true">
          <span>{scale.low}</span>
          <span>{scale.high}</span>
        </div>
      </div>
      <Missing state={state} text="Please click a point on the scale." />
    </fieldset>
  );
}

export default function StudyQuestionnaire({
  kind,
  participantId,
  onDone,
  onEndSession,
}: {
  kind: "tlx" | "sus";
  participantId: string;
  /** The answers are stored; save the next step. Throwing shows the error and keeps the answers. */
  onDone: () => Promise<void>;
  onEndSession: () => void;
}) {
  const [tlx, setTlx] = useState<Record<string, number>>({});
  const [sus, setSus] = useState<(number | undefined)[]>(() => SUS_ITEMS.map(() => undefined));
  const [showMissing, setShowMissing] = useState(false);
  const [jump, setJump] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownAt = useRef(Date.now());
  const formRef = useRef<HTMLFormElement>(null);

  const answered = kind === "tlx" ? TLX_SCALES.map((s) => tlx[s.key] !== undefined) : sus.map((v) => v !== undefined);
  const firstOpen = answered.indexOf(false);
  const stateOf = (i: number): QuestionState =>
    answered[i] ? "answered" : showMissing ? "missing" : i === firstOpen ? "active" : "idle";

  // A submit with gaps: bring the first missing item into view.
  useEffect(() => {
    if (!jump) return;
    const el = formRef.current?.querySelector<HTMLElement>('[data-state="missing"]');
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.querySelector<HTMLElement>("input")?.focus({ preventScroll: true });
  }, [jump]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (firstOpen !== -1) {
      setShowMissing(true);
      setJump((j) => j + 1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const answeredAt = Date.now();
      await postQuestionnaire(
        participantId,
        kind === "tlx"
          ? { kind, answers: tlx, shownAt: shownAt.current, answeredAt }
          : { kind, answers: sus as number[], shownAt: shownAt.current, answeredAt },
      );
      await onDone();
    } catch (err) {
      setError(`Could not save your answers (${(err as Error).message}). Please try again, or tell the researcher.`);
      setBusy(false);
    }
  }

  const left = answered.filter((a) => !a).length;

  return (
    <form
      ref={formRef}
      className="card collect-card study-questionnaire"
      onSubmit={handleSubmit}
      data-testid={`${kind}-form`}
      noValidate
    >
      {kind === "tlx" ? (
        <>
          <p className="eyebrow">About the tutoring · 1 of 2</p>
          <h2>How demanding was it?</h2>
          <p className="lead">
            Think about the problems you just solved with the AI tutor (not the quiz). For each of
            the six scales, click the point that best matches your experience.
          </p>
          <p className="muted section-blurb">
            Note: on <b>Performance</b> the left end means you did perfectly and the right end means
            you failed.
          </p>
          {TLX_SCALES.map((scale, i) => (
            <TlxField
              key={scale.key}
              n={i + 1}
              scale={scale}
              value={tlx[scale.key]}
              onChange={(v) => setTlx((t) => ({ ...t, [scale.key]: v }))}
              state={stateOf(i)}
            />
          ))}
        </>
      ) : (
        <>
          <p className="eyebrow">About the tutoring · 2 of 2</p>
          <h2>What did you think of the AI tutor?</h2>
          <p className="lead">
            Ten statements about the AI tutor you just used. For each one, pick how much you agree.
            Go with your first impression.
          </p>
          {SUS_ITEMS.map((text, i) => (
            <ScaleField
              key={i}
              n={i + 1}
              name={`sus-${i + 1}`}
              legend={text}
              low="Strongly disagree"
              high="Strongly agree"
              cumulative={false}
              value={sus[i]}
              onChange={(v) => setSus((s) => s.map((old, j) => (j === i ? v : old)))}
              state={stateOf(i)}
            />
          ))}
        </>
      )}

      <div className="answer-meter" data-complete={left === 0} aria-live="polite">
        <span
          className="answer-meter-bar"
          style={{ "--fill": (answered.length - left) / answered.length } as CSSProperties}
        />
        {left === 0 ? "All answered" : `${answered.length - left} of ${answered.length} answered`}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="collect-actions">
        <button className="btn btn-primary btn-lg" type="submit" disabled={busy} data-testid={`${kind}-submit`}>
          {busy ? "Saving…" : "Continue"} {!busy && <ArrowRightIcon size={15} />}
        </button>
        {showMissing && left > 0 && (
          <span className="muted action-hint" role="status">
            {left} still to answer.
          </span>
        )}
      </div>

      <div className="study-test-end">
        <button
          type="button"
          className="btn btn-ghost btn-sm end-session"
          onClick={onEndSession}
          data-testid="end-session"
        >
          <ExitIcon size={13} /> End session
        </button>
      </div>
    </form>
  );
}
