"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ExerciseEvent } from "@/lib/api";
import {
  createStageQueue,
  expectedText,
  isCorrectNumber,
  parseNumber,
  STAGES,
  stageSettings,
  type BlockId,
  type Exercise,
  type StageId,
} from "@/lib/exercises";
import { ArrowRightIcon, CheckIcon } from "./icons";

type Outcome = "correct" | "incorrect" | "skipped" | "timeout";

const OUTCOME_TEXT: Record<Outcome, string> = {
  correct: "✓ Correct",
  incorrect: "✗ Not quite — here is the solution",
  skipped: "Skipped — here is the solution",
  timeout: "⏱ Time's up — here is the solution",
};

/**
 * Runs the warm-up and the four blocks: intro screen → questions until the
 * block's time is up (or it runs out of questions) → next block. Every step is
 * reported through `onEvent` so the data can be lined up with the signals.
 */
export default function ExerciseRunner({
  blockOrder,
  blockSeconds,
  onEvent,
  onItem,
  onStage,
  onFinished,
}: {
  blockOrder: BlockId[];
  blockSeconds: number;
  onEvent: (event: ExerciseEvent) => void;
  /** The exercise currently on screen (null between stages). */
  onItem: (stage: StageId | null, item: Exercise | null) => void;
  /** Index into [warm-up, ...blockOrder] of the stage on screen (for the progress stepper). */
  onStage?: (index: number) => void;
  onFinished: () => void;
}) {
  const stages = useMemo<StageId[]>(() => ["warmup", ...blockOrder], [blockOrder]);
  const [stageIndex, setStageIndex] = useState(0);
  const [running, setRunning] = useState(false); // false = the stage's intro screen
  const [item, setItem] = useState<Exercise | null>(null);
  const [itemNo, setItemNo] = useState(0);
  const [input, setInput] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [stageEndsAt, setStageEndsAt] = useState<number | null>(null);
  const [itemEndsAt, setItemEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const queueRef = useRef<(() => Exercise | null) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const stage = stages[stageIndex];
  const settings = stageSettings(stage);
  const blockCount = stages.length - 1;
  const stageTitle = stage === "warmup" ? "Warm-up" : `Part ${stageIndex} of ${blockCount}`;

  useEffect(() => {
    onStage?.(stageIndex);
    // Only report actual stage changes, not new callback identities.
  }, [stageIndex]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [running]);

  // Block time up → next stage; per-question time up → show the solution.
  useEffect(() => {
    if (!running) return;
    if (stageEndsAt !== null && now >= stageEndsAt) {
      endStage("time");
      return;
    }
    if (item && outcome === null && itemEndsAt !== null && now >= itemEndsAt) {
      setOutcome("timeout");
      onEvent({ type: "timeout", blockId: stage, exerciseId: item.id });
    }
    // Re-checked on every tick; the handlers read the current render's state.
  }, [now]);

  useEffect(() => {
    if (item?.answer.kind === "number") inputRef.current?.focus();
  }, [item]);

  function showNext() {
    const next = queueRef.current?.() ?? null;
    if (!next) {
      endStage("items");
      return;
    }
    setItem(next);
    setItemNo((n) => n + 1);
    setInput("");
    setAttempts(0);
    setChosen(null);
    setFeedback(null);
    setOutcome(null);
    setItemEndsAt(settings.perItemS ? Date.now() + settings.perItemS * 1000 : null);
    onItem(stage, next);
    onEvent({
      type: "shown",
      blockId: stage,
      exerciseId: next.id,
      text: next.text,
      expected: expectedText(next.answer),
    });
  }

  function startStage() {
    queueRef.current = createStageQueue(stage);
    setRunning(true);
    setItemNo(0);
    setNow(Date.now());
    setStageEndsAt(settings.timed ? Date.now() + blockSeconds * 1000 : null);
    onEvent({ type: "stage-start", blockId: stage });
    showNext();
  }

  function endStage(reason: "time" | "items") {
    onEvent({ type: "stage-end", blockId: stage, reason });
    onItem(null, null);
    setRunning(false);
    setItem(null);
    setItemEndsAt(null);
    setStageEndsAt(null);
    if (stageIndex + 1 >= stages.length) onFinished();
    else setStageIndex(stageIndex + 1);
  }

  function submitNumber() {
    if (!item || outcome || item.answer.kind !== "number") return;
    const value = parseNumber(input);
    if (value === null) {
      setFeedback("Couldn't read that. Type a fraction (3/8), a decimal (0.375) or a percent (37.5%).");
      return;
    }
    const correct = isCorrectNumber(item.answer, value);
    const used = attempts + 1;
    setAttempts(used);
    onEvent({ type: "attempt", blockId: stage, exerciseId: item.id, answer: input.trim(), correct });
    if (correct) {
      setOutcome("correct");
    } else if (used >= settings.maxAttempts) {
      setOutcome("incorrect");
    } else {
      const left = settings.maxAttempts - used;
      setFeedback(
        Number.isFinite(left)
          ? `Not quite. ${left} attempt${left === 1 ? "" : "s"} left.`
          : "Not quite. Try again, skip, or ask the tutor.",
      );
    }
  }

  function chooseOption(index: number) {
    if (!item || outcome || item.answer.kind !== "choice") return;
    const correct = index === item.answer.correct;
    setChosen(index);
    onEvent({
      type: "attempt",
      blockId: stage,
      exerciseId: item.id,
      answer: item.answer.options[index],
      correct,
    });
    setOutcome(correct ? "correct" : "incorrect");
  }

  function skip() {
    if (!item || outcome) return;
    onEvent({ type: "skip", blockId: stage, exerciseId: item.id });
    setOutcome("skipped");
  }

  if (!running || !item) {
    const duration =
      blockSeconds >= 60 ? `about ${Math.round(blockSeconds / 60)} minutes` : `${blockSeconds} seconds`;
    return (
      <section className="card collect-card stage-intro" data-testid="stage-intro">
        {stageIndex > 0 && (
          <p className="stage-done">
            <CheckIcon size={14} /> {stageIndex === 1 ? "Warm-up" : `Part ${stageIndex - 1}`} done
            {stageIndex < blockCount && ` · ${blockCount - stageIndex + 1} parts to go`}
            {stageIndex === blockCount && " · last part!"}
          </p>
        )}
        <p className="eyebrow">{stage === "warmup" ? "Get comfortable" : "Up next"}</p>
        <h2>{stageTitle}</h2>
        <p className="lead">{STAGES[stage].intro}</p>
        {stage !== "warmup" && <p className="muted">This part takes {duration}.</p>}
        <div className="collect-actions">
          <button className="btn btn-gold btn-lg" onClick={startStage} data-testid="stage-start">
            {stage === "warmup" ? "Start the warm-up" : "Start"} <ArrowRightIcon size={15} />
          </button>
        </div>
      </section>
    );
  }

  const stageLeft = stageEndsAt !== null ? Math.max(0, stageEndsAt - now) : null;
  const itemLeft = itemEndsAt !== null && outcome === null ? Math.max(0, itemEndsAt - now) : null;
  const choice = item.answer.kind === "choice" ? item.answer : null;

  return (
    <section className="card collect-card exercise-card" data-testid="exercise" data-stage={stage}>
      <div className="exercise-head">
        <span>
          {stageTitle} · Question {itemNo}
        </span>
        {stageLeft !== null && <span className="muted">{formatMs(stageLeft)} left in this part</span>}
      </div>

      {itemLeft !== null && (
        <div className="item-timer" data-low={itemLeft < 20000} data-testid="item-timer">
          ⏱ {formatMs(itemLeft)} for this question
        </div>
      )}

      <p className="exercise-text" data-testid="exercise-text">
        {item.text}
      </p>

      {choice ? (
        <div className="choice-list">
          {choice.options.map((option, i) => (
            <button
              key={option}
              className="choice"
              data-chosen={chosen === i}
              data-correct={outcome !== null && i === choice.correct}
              disabled={outcome !== null}
              onClick={() => chooseOption(i)}
              data-testid={`choice-${i}`}
            >
              {option}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="answer-row">
            <input
              ref={inputRef}
              className="text-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNumber();
              }}
              disabled={outcome !== null}
              placeholder="Your answer, e.g. 3/8"
              aria-label="Your answer"
              data-testid="answer-input"
            />
            <button
              className="btn btn-gold"
              onClick={submitNumber}
              disabled={outcome !== null || !input.trim()}
              data-testid="answer-check"
            >
              Check
            </button>
          </div>
          <p className="field-hint">Fraction (3/8), decimal (0.375) or percent (37.5%).</p>
        </>
      )}

      {feedback && outcome === null && (
        <p className="feedback" data-testid="feedback">
          {feedback}
        </p>
      )}

      {outcome ? (
        <div className="result" data-outcome={outcome} data-testid="result">
          <b>{OUTCOME_TEXT[outcome]}</b>
          <p>{item.solution}</p>
          <button className="btn btn-neon" onClick={showNext} data-testid="next">
            Next question →
          </button>
        </div>
      ) : (
        <div className="exercise-actions">
          <button className="btn btn-ghost btn-sm" onClick={skip} data-testid="skip">
            Skip this question
          </button>
        </div>
      )}
    </section>
  );
}

function formatMs(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
