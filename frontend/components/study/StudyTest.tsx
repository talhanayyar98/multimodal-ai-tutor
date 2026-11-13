"use client";

// The pre- or post-test of the study: one question at a time, no tutor, no
// hints, no feedback on correctness, no going back, no time limit. Each
// answer is stored before the next question appears; "I don't know" moves on
// and counts as not correct. Identical for both groups.

import { useEffect, useRef, useState } from "react";
import {
  ArrowRightIcon,
  ChatIcon,
  ClockIcon,
  ExitIcon,
  PencilIcon,
  TargetIcon,
} from "@/components/collect/icons";
import { postTestAnswer } from "@/lib/api";
import { scoreTestAnswer, type TestItem } from "@/lib/studyTests";

type Phase = "intro" | "question" | "finishing";

const FORMAT_HINT = "Whole numbers, fractions (3/8), decimals or % all work.";

export default function StudyTest({
  test,
  items,
  participantId,
  onDone,
  onEndSession,
}: {
  test: "pre" | "post";
  items: readonly TestItem[];
  participantId: string;
  /** Every answer is stored; save the next step. Throwing shows a "Try again". */
  onDone: () => Promise<void>;
  onEndSession: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownAt = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const item = items[index];

  // Each question's clock starts when it appears.
  useEffect(() => {
    if (phase !== "question") return;
    shownAt.current = Date.now();
    setInput("");
    setInvalid(false);
    setError(null);
    inputRef.current?.focus({ preventScroll: true });
  }, [phase, index]);

  async function finish() {
    setPhase("finishing");
    setError(null);
    try {
      await onDone();
    } catch (err) {
      setError(`Could not save your progress (${(err as Error).message}). Please tell the researcher.`);
    }
  }

  async function answer(dontKnow: boolean) {
    if (saving || !item) return;
    let correct = false;
    if (!dontKnow) {
      const score = scoreTestAnswer(item, input);
      if (score === null) {
        setInvalid(true);
        return;
      }
      correct = score;
    }
    setSaving(true);
    setError(null);
    try {
      await postTestAnswer(participantId, {
        test,
        itemId: item.id,
        skill: item.skill,
        mirrors: item.mirrors,
        position: index + 1,
        answer: dontKnow ? "" : input.trim(),
        dontKnow,
        correct,
        shownAt: shownAt.current,
        answeredAt: Date.now(),
      });
    } catch (err) {
      setError(`Your answer could not be saved (${(err as Error).message}). Please try again, or tell the researcher.`);
      return;
    } finally {
      setSaving(false);
    }
    if (index + 1 < items.length) setIndex(index + 1);
    else void finish();
  }

  const pre = test === "pre";

  return (
    <section className="card collect-card study-test" data-testid={`${test}test`} data-phase={phase}>
      {phase === "intro" && (
        <>
          <span className="card-icon" data-tone="task" aria-hidden="true">
            <PencilIcon size={22} />
          </span>
          <p className="eyebrow">{pre ? "Before the tutoring" : "After the tutoring"}</p>
          <h2>{pre ? "A short quiz" : "One more short quiz"}</h2>
          <p className="lead">
            {pre
              ? `${items.length} questions, one at a time. This shows what you already know, so please answer on your own.`
              : `${items.length} questions like the ones in the first quiz, with different numbers. Please answer on your own.`}
          </p>
          <ul className="study-test-rules">
            <li>
              <TargetIcon size={16} />
              <span>No tutor and no hints, and you won&apos;t see whether you were right.</span>
            </li>
            <li>
              <ChatIcon size={16} />
              <span>Not sure? Press &ldquo;I don&apos;t know&rdquo;. That is completely fine.</span>
            </li>
            <li>
              <ClockIcon size={16} />
              <span>
                There is no time limit. Pen and paper are fine; please don&apos;t use a calculator.
              </span>
            </li>
          </ul>
          <div className="collect-actions">
            <button className="btn btn-primary btn-lg" onClick={() => setPhase("question")} data-testid="test-start">
              Start the quiz <ArrowRightIcon size={15} />
            </button>
          </div>
        </>
      )}

      {phase === "question" && item && (
        <>
          <div className="quiz-head">
            <p className="eyebrow" data-testid="test-progress">
              Question {index + 1} of {items.length}
            </p>
            <span>{pre ? "Quiz 1" : "Quiz 2"}</span>
          </div>
          {/* Answered questions all look the same: the quiz gives no feedback on correctness. */}
          <div className="progress-segments" aria-hidden="true">
            {items.map((it, i) => (
              <span key={it.id} data-status={i < index ? "done" : i === index ? "current" : "upcoming"} />
            ))}
          </div>
          <p className="problem-text" data-testid="test-question">
            {item.text}
          </p>
          <form
            className="answer-row"
            onSubmit={(e) => {
              e.preventDefault();
              void answer(false);
            }}
          >
            <input
              ref={inputRef}
              className="answer-input"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setInvalid(false);
              }}
              placeholder="Your answer"
              aria-label="Your answer"
              autoComplete="off"
              spellCheck={false}
              disabled={saving}
              data-testid="test-input"
            />
            <button
              type="submit"
              className="btn btn-check"
              disabled={saving || !input.trim()}
              data-testid="test-next"
            >
              {index + 1 < items.length ? "Next" : "Finish"} <ArrowRightIcon size={14} />
            </button>
          </form>
          <div className="problem-foot">
            <p className="answer-feedback" data-kind={invalid ? "invalid" : "idle"} role="status" aria-live="polite">
              {invalid ? "Please type a number (like 42, 3/8 or 0.375), or press “I don't know”." : FORMAT_HINT}
            </p>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void answer(true)}
              disabled={saving}
              data-testid="test-dont-know"
            >
              I don&apos;t know
            </button>
          </div>
        </>
      )}

      {phase === "finishing" && (
        <>
          <h2>{pre ? "Quiz done" : "Last quiz done"}</h2>
          <p>{error ? "Your progress could not be saved yet." : "Saving…"}</p>
          {error && (
            <div className="collect-actions">
              <button className="btn btn-primary" onClick={() => void finish()} data-testid="test-retry">
                Try again
              </button>
            </div>
          )}
        </>
      )}

      {error && phase !== "finishing" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {phase !== "finishing" && (
        <div className="study-test-end">
          <button className="btn btn-ghost btn-sm end-session" onClick={onEndSession} data-testid="end-session">
            <ExitIcon size={13} /> End session
          </button>
        </div>
      )}
    </section>
  );
}
