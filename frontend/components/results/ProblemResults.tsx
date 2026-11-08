"use client";

import { useEffect, useRef } from "react";
import AiSparkle from "@/components/AiSparkle";
import { ArrowRightIcon } from "@/components/collect/icons";
import { formatClock, isModelState, type ProblemRecord, type Summary } from "@/lib/problemReport";
import { answerText, DIFFICULTY_LABEL } from "@/lib/problems";
import ShareBars from "./ShareBars";
import StateTimeline, { STATE_LABEL } from "./StateTimeline";

const TITLES = ["Skipped, no problem", "You got there!", "Solved!", "Nailed it!"] as const;
const STAR = "M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z";

interface Row {
  t: number;
  what: string;
  state?: string;
}

function journey(rec: ProblemRecord, withStates: boolean): Row[] {
  const rows: Row[] = [{ t: rec.startedAt, what: "Problem started" }];
  if (withStates) {
    for (const r of rec.readings) rows.push({ t: r.t, what: "Signals read", state: r.state });
  }
  for (const e of rec.events) {
    switch (e.type) {
      case "attempt":
        rows.push({ t: e.t, what: `You answered ${e.answer}: ${e.correct ? "correct!" : "not quite"}` });
        break;
      case "hint":
        rows.push({ t: e.t, what: "Hint arrived (you tapped Hint)" });
        break;
      case "nudge":
        rows.push({ t: e.t, what: "Check-in help arrived" });
        break;
      case "chat":
        rows.push({ t: e.t, what: "The tutor replied in the chat" });
        break;
      case "nudge-offered":
        rows.push({ t: e.t, what: "The tutor noticed and offered help", state: e.state });
        break;
      case "nudge-accepted":
        rows.push({ t: e.t, what: "You said yes" });
        break;
      case "nudge-dismissed":
        rows.push({ t: e.t, what: "You said no thanks" });
        break;
      case "nudge-expired":
        rows.push({ t: e.t, what: "The offer faded away unanswered" });
        break;
    }
  }
  if (rec.outcome === "skipped") rows.push({ t: rec.endedAt, what: "You skipped" });
  return rows.sort((a, b) => a.t - b.t);
}

export default function ProblemResults({
  record,
  summary,
  session,
  modelNote,
  onNext,
  showStates = true,
  nextLabel = "Next problem",
}: {
  record: ProblemRecord;
  summary: Summary;
  session: { solved: number; points: number; streak: number };
  /** Which model the states come from, e.g. a demo model. */
  modelNote: string;
  onNext: () => void;
  /**
   * false (study mode): no state timeline, no state column, no model note.
   * Pair it with summarize(…, { states: false }) so the insights match.
   */
  showStates?: boolean;
  /** The button's label, e.g. "Finish" after the study's last problem. */
  nextLabel?: string;
}) {
  const nextRef = useRef<HTMLButtonElement>(null);
  const solved = record.outcome === "solved";
  const { problem } = record;

  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);

  const tiles = [
    { label: "Time", value: formatClock(summary.durationMs), sub: solved ? "to solve it" : "on this one" },
    {
      label: "Attempts",
      value: String(summary.attempts),
      sub: summary.attempts === 0 ? "none" : summary.wrong === 0 ? "first try!" : `${summary.wrong} not quite`,
    },
    {
      label: "Hints",
      value: String(summary.hints),
      sub:
        summary.nudgesOffered > 0
          ? `${summary.nudgesOffered} check-in${summary.nudgesOffered === 1 ? "" : "s"} offered`
          : "asking is free",
    },
    {
      label: "Session",
      value: `${session.points} pts`,
      sub: session.streak > 1 ? `${session.streak} in a row` : `${session.solved} solved`,
    },
  ];

  return (
    <div className="results-backdrop" data-testid="results">
      <section className="results card" role="dialog" aria-modal="true" aria-labelledby="results-title">
        <header className="results-hero" data-outcome={record.outcome}>
          {solved && (
            <div className="results-burst" aria-hidden="true">
              {Array.from({ length: 14 }, (_, i) => (
                <i key={i} style={{ "--i": i } as React.CSSProperties} />
              ))}
            </div>
          )}
          <div className="results-stars" role="img" aria-label={`${summary.stars} of 3 stars`}>
            {[1, 2, 3].map((n) => (
              <svg
                key={n}
                viewBox="0 0 24 24"
                width={n === 2 ? 46 : 36}
                height={n === 2 ? 46 : 36}
                data-earned={n <= summary.stars}
                style={{ animationDelay: `${120 + n * 140}ms` }}
              >
                <path d={STAR} />
              </svg>
            ))}
          </div>
          <h2 id="results-title">{TITLES[summary.stars]}</h2>
          <p className="results-sub">
            {solved && (
              <b className="results-points">
                +{summary.points} point{summary.points === 1 ? "" : "s"}
              </b>
            )}
            <span>
              Problem {record.number} · {problem.topic} · {DIFFICULTY_LABEL[problem.difficulty]}
            </span>
          </p>
        </header>

        <div className="results-tiles">
          {tiles.map((t) => (
            <div key={t.label} className="stat-tile">
              <span className="stat-label">{t.label}</span>
              <span className="stat-value">{t.value}</span>
              <span className="stat-sub">{t.sub}</span>
            </div>
          ))}
        </div>

        {summary.insights.length > 0 && (
          <section className="results-section" aria-labelledby="insights-title">
            <h3 id="insights-title">
              <AiSparkle size={14} /> What the tutor noticed
            </h3>
            <ul className="insights">
              {summary.insights.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </section>
        )}

        {showStates && (
          <section className="results-section" aria-labelledby="timeline-title">
            <h3 id="timeline-title">How you felt during the problem</h3>
            <StateTimeline
              startedAt={record.startedAt}
              endedAt={record.endedAt}
              readings={record.readings}
              events={record.events}
            />
          </section>
        )}

        {showStates && summary.comparison && (
          <section className="results-section" aria-labelledby="compare-title">
            <h3 id="compare-title">
              {summary.comparison.kind === "help" ? "Before vs after help" : "First half vs second half"}
            </h3>
            <ShareBars comparison={summary.comparison} />
          </section>
        )}

        <section className="results-section results-solution" aria-labelledby="solution-title">
          <h3 id="solution-title">{solved ? "How to solve it" : `The answer: ${answerText(problem)}`}</h3>
          <p>{problem.solution}</p>
        </section>

        <details className="results-table">
          <summary>Moment by moment</summary>
          <div className="results-table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">What happened</th>
                {showStates && <th scope="col">Your state</th>}
              </tr>
            </thead>
            <tbody>
              {journey(record, showStates).map((row, i) => (
                <tr key={i}>
                  <td>{formatClock(row.t - record.startedAt)}</td>
                  <td>{row.what}</td>
                  {showStates && (
                    <td>
                      {row.state &&
                        (isModelState(row.state) ? (
                          <span className="state-pill" data-state={row.state}>
                            <i className="dot" /> {STATE_LABEL[row.state]}
                          </span>
                        ) : (
                          row.state
                        ))}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </details>

        {showStates && (
          <p className="results-note">
            {modelNote} States are estimated from the last minute of webcam and mouse signals, so a
            change shows up with a short delay.
          </p>
        )}

        <footer className="results-foot">
          <button ref={nextRef} className="btn btn-next" onClick={onNext} data-testid="next-problem">
            {nextLabel} <ArrowRightIcon size={16} />
          </button>
        </footer>
      </section>
    </div>
  );
}
