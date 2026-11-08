"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, ClockIcon } from "@/components/collect/icons";
import { formatClock } from "@/lib/problemReport";
import { DIFFICULTY_LABEL, isCorrect, readAnswer, TOPIC_GLYPH, type Problem } from "@/lib/problems";

const RETRY_LINES = [
  "Not quite. Give it another go!",
  "Hmm, not that one. Have another look.",
  "Close? Try again.",
  "Not yet. The tutor below can give you a nudge.",
];

type Feedback = { kind: "wrong" | "invalid" | "correct"; text: string } | null;

/** The current problem: statement, answer box (or options), timer and skip. */
export default function ProblemCard({
  problem,
  number,
  startedAt,
  done,
  onAttempt,
  onSkip,
}: {
  problem: Problem;
  /** 1-based position in the session. */
  number: number;
  startedAt: number;
  /** Solved or skipped: the card freezes. */
  done: boolean;
  onAttempt: (answer: string, correct: boolean) => void;
  onSkip: () => void;
}) {
  const [input, setInput] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [wrong, setWrong] = useState(0);
  const [wrongChoices, setWrongChoices] = useState<number[]>([]);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [now, setNow] = useState(startedAt);
  const answerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const solved = feedback?.kind === "correct";
  const locked = done || solved;

  useEffect(() => {
    if (locked) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [locked]);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!confirmSkip) return;
    const timer = setTimeout(() => setConfirmSkip(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmSkip]);

  function shake() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    answerRef.current?.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-7px)" },
        { transform: "translateX(6px)" },
        { transform: "translateX(-4px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 380, easing: "ease-out" },
    );
  }

  function wrongAnswer() {
    setFeedback({ kind: "wrong", text: RETRY_LINES[wrong % RETRY_LINES.length] });
    setWrong((n) => n + 1);
    shake();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (locked || !input.trim()) return;
    const value = readAnswer(input);
    if (value === null) {
      setFeedback({
        kind: "invalid",
        text: "Couldn't read that. Try a number like 42, a fraction like 3/8 or a decimal like 0.375.",
      });
      return;
    }
    const correct = isCorrect(problem, value);
    onAttempt(input.trim(), correct);
    if (correct) setFeedback({ kind: "correct", text: "Correct!" });
    else {
      wrongAnswer();
      inputRef.current?.select();
    }
  }

  function choose(index: number) {
    if (locked || problem.answer.kind !== "choice" || wrongChoices.includes(index)) return;
    const correct = index === problem.answer.correct;
    onAttempt(problem.answer.options[index], correct);
    if (correct) setFeedback({ kind: "correct", text: "Correct!" });
    else {
      setWrongChoices((w) => [...w, index]);
      wrongAnswer();
    }
  }

  const choice = problem.answer.kind === "choice" ? problem.answer : null;

  return (
    <section
      className="card problem-card"
      data-difficulty={problem.difficulty}
      data-solved={solved}
      aria-labelledby="problem-text"
      data-testid="problem-card"
    >
      <div className="problem-head">
        <span className="problem-topic">
          <span className="problem-glyph" aria-hidden="true">
            {TOPIC_GLYPH[problem.topic]}
          </span>
          {problem.topic}
        </span>
        <span className="problem-level" data-difficulty={problem.difficulty}>
          {DIFFICULTY_LABEL[problem.difficulty]}
        </span>
        <span className="problem-meta">
          <span>Problem {number}</span>
          <span className="problem-timer" title="Time on this problem">
            <ClockIcon size={13} /> {formatClock(now - startedAt)}
          </span>
        </span>
      </div>

      <p id="problem-text" className="problem-text" data-testid="problem-text">
        {problem.text}
      </p>

      <div ref={answerRef} className="problem-answer">
        {choice ? (
          <div className="answer-choices" role="group" aria-label="Answer options">
            {choice.options.map((option, i) => (
              <button
                key={option}
                type="button"
                className="answer-choice"
                data-wrong={wrongChoices.includes(i)}
                data-correct={solved && i === choice.correct}
                disabled={locked || wrongChoices.includes(i)}
                onClick={() => choose(i)}
                data-testid={`answer-choice-${i}`}
              >
                {option}
              </button>
            ))}
          </div>
        ) : (
          <form className="answer-row" onSubmit={submit}>
            <input
              ref={inputRef}
              className="answer-input"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (feedback?.kind === "invalid") setFeedback(null);
              }}
              placeholder="Your answer"
              aria-label="Your answer"
              autoComplete="off"
              spellCheck={false}
              readOnly={locked}
              data-testid="answer-input"
            />
            <button
              type="submit"
              className="btn btn-check"
              disabled={locked || !input.trim()}
              data-testid="answer-check"
            >
              <CheckIcon size={15} /> Check
            </button>
          </form>
        )}
      </div>

      <div className="problem-foot">
        <p className="answer-feedback" data-kind={feedback?.kind ?? "idle"} role="status" aria-live="polite">
          {feedback?.text ??
            (choice ? "Pick the answer you think is right." : "Whole numbers, fractions (3/8), decimals or % all work.")}
        </p>
        {!locked && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            data-confirm={confirmSkip}
            onClick={() => (confirmSkip ? onSkip() : setConfirmSkip(true))}
            data-testid="problem-skip"
          >
            {confirmSkip ? "Sure? Show the answer" : "Skip"}
          </button>
        )}
      </div>
    </section>
  );
}
