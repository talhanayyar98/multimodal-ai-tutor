"use client";

import { useState } from "react";
import { useElementWidth } from "@/hooks/useElementWidth";
import { STATE_ORDER, type Comparison, type ModelState, type Shares } from "@/lib/problemReport";
import { STATE_LABEL } from "./StateTimeline";

const LABEL_W = 104;
const GAP = 2;
// Text inside a fill: white, except on the light orange of "confused".
const INK: Record<ModelState, string> = {
  engaged: "#ffffff",
  bored: "#ffffff",
  confused: "#1c2033",
  frustrated: "#ffffff",
};

/** Rough text width at 12px semibold, to decide whether a label fits its block. */
const textW = (s: string) => s.length * 7 + 14;

/** Two 100% bars (before vs after help, or first vs second half) split by state. */
export default function ShareBars({ comparison }: { comparison: Comparison }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [readout, setReadout] = useState<string | null>(null);
  const barW = Math.max(120, width - LABEL_W);
  const rows: [string, Shares][] = [
    [comparison.labels[0], comparison.before],
    [comparison.labels[1], comparison.after],
  ];

  return (
    <div ref={ref} className="share-bars" data-testid="share-bars">
      {rows.map(([label, sh]) => {
        const present = STATE_ORDER.filter((s) => sh.counts[s] > 0);
        const usable = barW - GAP * Math.max(0, present.length - 1);
        return (
          <div key={label} className="share-row">
            <span className="share-label">
              {label}
              <small>{sh.total === 0 ? "no readings" : `${sh.total} reading${sh.total === 1 ? "" : "s"}`}</small>
            </span>
            {sh.total === 0 ? (
              <div className="share-empty">
                {comparison.kind === "help" ? "Solved before the next reading" : "Not enough readings"}
              </div>
            ) : (
              <div className="share-bar" role="list" aria-label={`${label} by state`}>
                {present.map((s) => {
                  const share = sh.counts[s] / sh.total;
                  const pct = `${Math.round(share * 100)}%`;
                  const full = `${STATE_LABEL[s]} ${pct}`;
                  const px = usable * share;
                  const text = px >= textW(full) ? full : px >= textW(pct) ? pct : "";
                  const detail = `${label}: ${STATE_LABEL[s]}, ${sh.counts[s]} of ${sh.total} readings (${pct})`;
                  return (
                    <div
                      key={s}
                      role="listitem"
                      tabIndex={0}
                      className="share-block"
                      style={{ flexGrow: sh.counts[s], background: `var(--state-${s})`, color: INK[s] }}
                      aria-label={detail}
                      onPointerEnter={() => setReadout(detail)}
                      onPointerLeave={() => setReadout(null)}
                      onFocus={() => setReadout(detail)}
                      onBlur={() => setReadout(null)}
                    >
                      {text}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <div className="share-foot">
        <ul className="share-legend" aria-hidden="true">
          {STATE_ORDER.map((s) => (
            <li key={s}>
              <span className="legend-swatch" style={{ background: `var(--state-${s})` }} />
              {STATE_LABEL[s]}
            </li>
          ))}
        </ul>
        <span className="share-readout" aria-live="polite">
          {readout}
        </span>
      </div>
    </div>
  );
}
