"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import type { Intake } from "@/lib/api";
import { ChoiceField, InputQuestion, ScaleField, type QuestionState } from "./fields";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon } from "./icons";

type Key = keyof Intake;
type Draft = Partial<Omit<Intake, "age">> & { age?: string };

// Grouped by topic so each screen reads as one short conversation:
// basics → studies & prior knowledge → the conditions of this session.
const SECTIONS: { title: string; blurb: string; keys: Key[] }[] = [
  {
    title: "About you",
    blurb: "Two quick basics. Your name is not asked or stored.",
    keys: ["age", "gender"],
  },
  {
    title: "Your background",
    blurb: "What you study, and how familiar probability, math and English feel to you.",
    keys: ["studyLevel", "field", "probabilityBackground", "mathConfidence", "englishComfort"],
  },
  {
    title: "Right now",
    blurb: "Your setup today. This helps us read the camera and mouse data correctly.",
    keys: ["vision", "pointerDevice", "alertness"],
  },
];

const ALL_KEYS = SECTIONS.flatMap((s) => s.keys);

function isValidAge(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") return false;
  const age = Number(raw);
  return Number.isInteger(age) && age >= 18 && age <= 99;
}

function isAnswered(key: Key, d: Draft): boolean {
  if (key === "age") return isValidAge(d.age);
  if (key === "field") return !!d.field?.trim();
  return d[key] !== undefined;
}

/** Background questions. Answers go to MongoDB under the participant code — no name. */
export default function IntakeForm({ onSubmit }: { onSubmit: (intake: Intake) => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>({});
  const [sectionIndex, setSectionIndex] = useState(0);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [showMissing, setShowMissing] = useState(false);
  const [nudge, setNudge] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);

  const section = SECTIONS[sectionIndex];
  const isLast = sectionIndex === SECTIONS.length - 1;
  const answeredHere = section.keys.filter((k) => isAnswered(k, draft)).length;
  const firstOpen = section.keys.find((k) => !isAnswered(k, draft));

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function stateOf(key: Key): QuestionState {
    if (isAnswered(key, draft)) return "answered";
    if (showMissing) return "missing";
    return key === firstOpen ? "active" : "idle";
  }

  function goTo(index: number) {
    setDirection(index > sectionIndex ? "forward" : "back");
    setSectionIndex(index);
    setShowMissing(false);
    setError(null);
  }

  // New section: move focus to its heading (for keyboard / screen-reader users)
  // and bring the top of the card back into view.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
    if ((formRef.current?.getBoundingClientRect().top ?? 0) < 0) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [sectionIndex]);

  // "Next" with gaps: scroll to the first missing question and focus it.
  useEffect(() => {
    if (!nudge) return;
    const el = formRef.current?.querySelector<HTMLElement>('[data-state="missing"]');
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.querySelector<HTMLElement>("input")?.focus({ preventScroll: true });
  }, [nudge]);

  function validate(): Intake | string {
    const missing = ALL_KEYS.find((k) => !isAnswered(k, draft));
    if (missing) return "Please answer every question.";
    return {
      age: Number(draft.age),
      field: draft.field!.trim(),
      gender: draft.gender!,
      studyLevel: draft.studyLevel!,
      probabilityBackground: draft.probabilityBackground!,
      mathConfidence: draft.mathConfidence!,
      englishComfort: draft.englishComfort!,
      vision: draft.vision!,
      pointerDevice: draft.pointerDevice!,
      alertness: draft.alertness!,
    };
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (firstOpen) {
      setShowMissing(true);
      setNudge((n) => n + 1);
      return;
    }
    if (!isLast) {
      goTo(sectionIndex + 1);
      return;
    }
    const result = validate();
    if (typeof result === "string") {
      setError(result);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(result);
    } catch (err) {
      setError(`Could not start the session: ${(err as Error).message}. Please tell the researcher.`);
      setBusy(false);
    }
  }

  const n = (key: Key) => ALL_KEYS.indexOf(key) + 1;

  function renderQuestion(key: Key) {
    switch (key) {
      case "age":
        return (
          <InputQuestion
            key={key}
            n={n(key)}
            state={stateOf(key)}
            legend="How old are you?"
            missingText="Please enter your age as a whole number from 18 to 99."
          >
            <span className="input-suffix">
              <input
                className="text-input text-input-short"
                type="number"
                inputMode="numeric"
                min={18}
                max={99}
                value={draft.age ?? ""}
                onChange={(e) => set("age", e.target.value)}
                data-testid="intake-age"
              />
              <span>years</span>
            </span>
          </InputQuestion>
        );
      case "gender":
        return (
          <ChoiceField
            key={key}
            n={n(key)}
            state={stateOf(key)}
            name="gender"
            legend="What is your gender?"
            options={[
              { value: "woman", label: "Woman" },
              { value: "man", label: "Man" },
              { value: "non-binary", label: "Non-binary" },
              { value: "prefer-not", label: "Prefer not to say" },
            ]}
            value={draft.gender}
            onChange={(v) => set("gender", v)}
          />
        );
      case "studyLevel":
        return (
          <ChoiceField
            key={key}
            n={n(key)}
            state={stateOf(key)}
            name="studyLevel"
            legend="What are you currently studying?"
            options={[
              { value: "bachelor", label: "Bachelor's" },
              { value: "master", label: "Master's" },
              { value: "phd", label: "PhD" },
              { value: "not-student", label: "Not a student" },
              { value: "other", label: "Other" },
            ]}
            value={draft.studyLevel}
            onChange={(v) => set("studyLevel", v)}
          />
        );
      case "field":
        return (
          <InputQuestion
            key={key}
            n={n(key)}
            state={stateOf(key)}
            legend={
              draft.studyLevel === "not-student"
                ? "What is your field of work?"
                : "What is your field of study or work?"
            }
            missingText="Please enter your field — a word or two is enough."
          >
            <input
              className="text-input"
              type="text"
              maxLength={80}
              placeholder="e.g. Computer Science, Biology, Economics"
              value={draft.field ?? ""}
              onChange={(e) => set("field", e.target.value)}
              data-testid="intake-field"
            />
          </InputQuestion>
        );
      case "probabilityBackground":
        return (
          <ChoiceField
            key={key}
            n={n(key)}
            state={stateOf(key)}
            name="probabilityBackground"
            legend="Have you studied probability before?"
            options={[
              { value: "none", label: "No" },
              { value: "school", label: "Yes, at school" },
              { value: "university", label: "Yes, at university" },
            ]}
            value={draft.probabilityBackground}
            onChange={(v) => set("probabilityBackground", v)}
          />
        );
      case "mathConfidence":
        return (
          <ScaleField
            key={key}
            n={n(key)}
            state={stateOf(key)}
            name="mathConfidence"
            legend="How confident are you with math?"
            low="not at all"
            high="very confident"
            value={draft.mathConfidence}
            onChange={(v) => set("mathConfidence", v)}
          />
        );
      case "englishComfort":
        return (
          <ScaleField
            key={key}
            n={n(key)}
            state={stateOf(key)}
            name="englishComfort"
            legend="How comfortable are you reading English?"
            low="not at all"
            high="completely"
            value={draft.englishComfort}
            onChange={(v) => set("englishComfort", v)}
          />
        );
      case "vision":
        return (
          <ChoiceField
            key={key}
            n={n(key)}
            state={stateOf(key)}
            name="vision"
            legend="Are you wearing glasses or contact lenses right now?"
            options={[
              { value: "none", label: "No" },
              { value: "glasses", label: "Glasses" },
              { value: "contacts", label: "Contact lenses" },
            ]}
            value={draft.vision}
            onChange={(v) => set("vision", v)}
            hint="Glasses change how the camera sees your eyes."
          />
        );
      case "pointerDevice":
        return (
          <ChoiceField
            key={key}
            n={n(key)}
            state={stateOf(key)}
            name="pointerDevice"
            legend="What are you using to move the pointer?"
            options={[
              { value: "mouse", label: "Mouse" },
              { value: "trackpad", label: "Trackpad" },
              { value: "other", label: "Other" },
            ]}
            value={draft.pointerDevice}
            onChange={(v) => set("pointerDevice", v)}
          />
        );
      case "alertness":
        return (
          <ScaleField
            key={key}
            n={n(key)}
            state={stateOf(key)}
            name="alertness"
            legend="How alert do you feel right now?"
            low="very tired"
            high="very alert"
            value={draft.alertness}
            onChange={(v) => set("alertness", v)}
          />
        );
    }
  }

  return (
    <form
      ref={formRef}
      className="card collect-card intake"
      onSubmit={handleSubmit}
      noValidate
      data-testid="intake"
    >
      <ol className="section-tabs" aria-label="Question sections">
        {SECTIONS.map((s, i) => {
          const status = i < sectionIndex ? "done" : i === sectionIndex ? "current" : "upcoming";
          return (
            <li key={s.title}>
              <button
                type="button"
                className="section-tab"
                data-status={status}
                disabled={status === "upcoming" || busy}
                aria-current={status === "current" ? "step" : undefined}
                onClick={() => goTo(i)}
                title={status === "done" ? `Back to “${s.title}”` : undefined}
                style={
                  status === "current"
                    ? ({ "--fill": answeredHere / section.keys.length } as CSSProperties)
                    : undefined
                }
              >
                <span className="section-tab-bar" />
                <span className="section-tab-label">
                  {status === "done" && <CheckIcon size={12} />}
                  {s.title}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div key={sectionIndex} className="section-body" data-direction={direction}>
        <p className="eyebrow">
          Section {sectionIndex + 1} of {SECTIONS.length}
        </p>
        <h2 ref={headingRef} tabIndex={-1}>
          {section.title}
        </h2>
        <p className="muted section-blurb">{section.blurb}</p>

        {section.keys.map(renderQuestion)}
      </div>

      {error && <p className="error">{error}</p>}
      <div className="collect-actions intake-actions">
        {sectionIndex > 0 && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => goTo(sectionIndex - 1)}
            disabled={busy}
            data-testid="intake-back"
          >
            <ArrowLeftIcon size={15} /> Back
          </button>
        )}
        <span className="answered-count" aria-live="polite">
          {answeredHere} of {section.keys.length} answered
        </span>
        <button
          className="btn btn-gold btn-lg"
          type="submit"
          disabled={busy}
          data-testid={isLast ? "intake-submit" : "intake-next"}
        >
          {isLast ? (busy ? "Starting…" : "Continue to camera check") : `Next: ${SECTIONS[sectionIndex + 1].title}`}
          {!busy && <ArrowRightIcon size={15} />}
        </button>
      </div>
    </form>
  );
}
