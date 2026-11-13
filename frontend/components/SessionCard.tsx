"use client";

import type { ReactNode } from "react";
import { CheckIcon, FlameIcon, StarIcon } from "@/components/collect/icons";
import type { HistoryEntry } from "@/lib/problemReport";

/** Points, solved, streak and stars per problem (used by / and /study). */
export default function SessionCard({
  stats,
  history,
  children,
}: {
  stats: { points: number; solved: number; streak: number };
  history: readonly HistoryEntry[];
  /** Extra lines under the stars, e.g. the main page's check-in status. */
  children?: ReactNode;
}) {
  return (
    <section className="card session-card" aria-labelledby="session-title">
      <h2 id="session-title">Your session</h2>
      <div className="session-stats">
        <div className="session-stat" data-stat="points">
          <StarIcon size={16} />
          <b>{stats.points}</b>
          <span>points</span>
        </div>
        <div className="session-stat" data-stat="solved">
          <CheckIcon size={16} />
          <b>{stats.solved}</b>
          <span>solved</span>
        </div>
        <div className="session-stat" data-stat="streak">
          <FlameIcon size={16} />
          <b>{stats.streak}</b>
          <span>streak</span>
        </div>
      </div>
      {history.length > 0 && (
        <ol className="session-history" aria-label="Stars per problem">
          {history.slice(-8).map((h, i) => (
            <li key={i} data-outcome={h.outcome} title={h.outcome === "skipped" ? "Skipped" : `${h.stars} of 3 stars`}>
              {h.outcome === "skipped" ? "–" : "★".repeat(h.stars)}
            </li>
          ))}
        </ol>
      )}
      {children}
    </section>
  );
}
