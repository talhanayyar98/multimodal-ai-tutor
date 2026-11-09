"use client";

// Small form building blocks shared by the intake and end-of-session surveys.
// Every question shows a numbered marker that turns into a check once answered;
// the first open question is highlighted, and unanswered ones turn red after a
// "Next" click so it's obvious what is still missing.

import { useState, type ReactNode } from "react";
import { CheckIcon } from "./icons";

export type QuestionState = "idle" | "active" | "answered" | "missing";

export interface ChoiceOption<T> {
  value: T;
  label: string;
}

export function Marker({ n, state }: { n?: number; state: QuestionState }) {
  if (n === undefined) return null;
  return (
    <span className="q-mark" data-state={state} aria-hidden="true">
      {state === "answered" ? <CheckIcon size={13} /> : n}
    </span>
  );
}

export function Missing({ state, text }: { state: QuestionState; text: string }) {
  if (state !== "missing") return null;
  return <p className="q-missing">{text}</p>;
}

/** Shell for questions with a text/number input (a <label> wraps the input). */
export function InputQuestion({
  n,
  state = "idle",
  legend,
  hint,
  missingText = "Please fill this in.",
  children,
}: {
  n?: number;
  state?: QuestionState;
  legend: string;
  hint?: string;
  missingText?: string;
  children: ReactNode;
}) {
  return (
    <div className="field q" data-state={state}>
      <label>
        <span className="legend">
          <Marker n={n} state={state} />
          {legend}
        </span>
        {children}
      </label>
      {hint && <p className="field-hint">{hint}</p>}
      <Missing state={state} text={missingText} />
    </div>
  );
}

/** A single-choice question rendered as a row of pill-shaped radio buttons. */
export function ChoiceField<T extends string | number>({
  name,
  legend,
  options,
  value,
  onChange,
  hint,
  n,
  state = "idle",
}: {
  name: string;
  legend: string;
  options: ChoiceOption<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  hint?: string;
  n?: number;
  state?: QuestionState;
}) {
  return (
    <fieldset className="field q" data-state={state}>
      <legend>
        <Marker n={n} state={state} />
        {legend}
      </legend>
      <div className="pills">
        {options.map((o) => (
          <label key={String(o.value)} className="pill" data-checked={value === o.value}>
            <input
              type="radio"
              name={name}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              data-testid={`${name}-${o.value}`}
            />
            {o.label}
          </label>
        ))}
      </div>
      {hint && <p className="field-hint">{hint}</p>}
      <Missing state={state} text="Please pick one." />
    </fieldset>
  );
}

/** A 1–5 rating shown as a segmented meter with labelled endpoints. */
export function ScaleField({
  name,
  legend,
  low,
  high,
  value,
  onChange,
  n,
  state = "idle",
  cumulative = true,
}: {
  name: string;
  legend: string;
  low: string;
  high: string;
  value: number | undefined;
  onChange: (value: number) => void;
  n?: number;
  state?: QuestionState;
  /** true: a meter that fills up to the choice (amounts). false: only the chosen box lights up (agree/disagree). */
  cumulative?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const lit = (k: number, upTo: number | null | undefined) =>
    upTo !== null && upTo !== undefined && (cumulative ? k <= upTo : k === upTo);

  return (
    <fieldset className="field q" data-state={state}>
      <legend>
        <Marker n={n} state={state} />
        {legend}
      </legend>
      <div className="scale" onMouseLeave={() => setHover(null)}>
        <div className="scale-steps">
          {[1, 2, 3, 4, 5].map((k) => (
            <label
              key={k}
              className="scale-step"
              data-on={lit(k, value)}
              data-preview={lit(k, hover)}
              data-checked={value === k}
              onMouseEnter={() => setHover(k)}
            >
              <input
                type="radio"
                name={name}
                checked={value === k}
                onChange={() => onChange(k)}
                aria-label={k === 1 ? `1 (${low})` : k === 5 ? `5 (${high})` : String(k)}
                data-testid={`${name}-${k}`}
              />
              {k}
            </label>
          ))}
        </div>
        <div className="scale-ends" aria-hidden="true">
          <span>{low}</span>
          <span>{high}</span>
        </div>
      </div>
      <Missing state={state} text="Please pick a number from 1 to 5." />
    </fieldset>
  );
}
