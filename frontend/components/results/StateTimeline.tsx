"use client";

import { useState } from "react";
import { useElementWidth } from "@/hooks/useElementWidth";
import type { Reading } from "@/lib/nudges";
import {
  formatClock,
  isHelp,
  isModelState,
  STATE_ORDER,
  type ModelState,
  type TimelineEvent,
} from "@/lib/problemReport";

export const STATE_LABEL: Record<ModelState, string> = {
  engaged: "Engaged",
  bored: "Bored",
  confused: "Confused",
  frustrated: "Frustrated",
};

const GUTTER = 96; // lane labels
const RIGHT = 16;
const TOP = 28; // room for the hint labels
const LANE_H = 30;
const LANES_H = STATE_ORDER.length * LANE_H;
const AXIS = 46; // answer marks + time labels
const HEIGHT = TOP + LANES_H + AXIS;
const TICK_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 1200];
const SPARKLE = "M0-5c.2 2.6 2.4 4.8 5 5-2.6.2-4.8 2.4-5 5-.2-2.6-2.4-4.8-5-5 2.6-.2 4.8-2.4 5-5Z";

type Point = { t: number; state: ModelState };

/**
 * Swimlane chart: one row per state, a dot for every 5-second reading, joined
 * by a step line, with hints marked as vertical rules and answers along the
 * time axis. Hover, or focus and use the arrow keys, to read single points.
 */
export default function StateTimeline({
  startedAt,
  endedAt,
  readings,
  events,
}: {
  startedAt: number;
  endedAt: number;
  readings: readonly Reading[];
  events: readonly TimelineEvent[];
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const points: Point[] = readings.filter((r): r is Point => isModelState(r.state));
  if (points.length === 0) {
    return (
      <p className="chart-empty">
        No state readings for this one: it was solved within the first 5-second window, or the ML
        service wasn&apos;t reachable.
      </p>
    );
  }

  const durS = Math.max(5, (endedAt - startedAt) / 1000);
  const plotW = Math.max(140, width - GUTTER - RIGHT);
  const x = (t: number) => GUTTER + Math.min(1, Math.max(0, (t - startedAt) / 1000 / durS)) * plotW;
  const laneY = (s: ModelState) => TOP + STATE_ORDER.indexOf(s) * LANE_H + LANE_H / 2;
  const axisY = TOP + LANES_H;

  // Each reading describes the 5 s before it: draw its level over that window.
  let path = `M${x(points[0].t - 5000)},${laneY(points[0].state)}H${x(points[0].t)}`;
  for (const p of points.slice(1)) path += `V${laneY(p.state)}H${x(p.t)}`;

  const maxTicks = Math.max(3, Math.min(7, Math.floor(plotW / 56)));
  const step = TICK_STEPS.find((s) => durS / s < maxTicks) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const ticks: number[] = [];
  for (let s = 0; s <= durS + 0.01; s += step) ticks.push(s);

  const helps = events.filter(isHelp);
  let lastLabelX = -Infinity;
  const helpMarks = helps.map((e) => {
    const hx = x(e.t);
    const showLabel = hx - lastLabelX > 64;
    if (showLabel) lastLabelX = hx;
    return { e, hx, showLabel };
  });
  const attempts = events.filter((e) => e.type === "attempt");

  const hovered = hover !== null ? points[hover] : null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setHover((h) => {
      const cur = h ?? (e.key === "ArrowLeft" ? points.length : -1);
      return Math.min(points.length - 1, Math.max(0, cur + (e.key === "ArrowLeft" ? -1 : 1)));
    });
  }

  const helpCount = helps.length;
  const ariaLabel =
    `Your state over ${formatClock(endedAt - startedAt)}: ${points.length} readings` +
    (helpCount ? `, ${helpCount} hint${helpCount === 1 ? "" : "s"}` : "") +
    ". Use the left and right arrow keys to step through the readings.";

  return (
    <div
      ref={ref}
      className="timeline"
      tabIndex={0}
      role="group"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      onBlur={() => setHover(null)}
      data-testid="state-timeline"
    >
      <svg width={width} height={HEIGHT} onPointerLeave={() => setHover(null)} aria-hidden="true">
        {/* lanes */}
        {STATE_ORDER.map((s, i) => (
          <g key={s}>
            <rect
              x={GUTTER}
              y={TOP + i * LANE_H}
              width={plotW}
              height={LANE_H}
              className="timeline-lane"
              data-odd={i % 2 === 1}
            />
            <circle cx={10} cy={laneY(s)} r={4.5} fill={`var(--state-${s})`} />
            <text x={22} y={laneY(s)} dy="0.35em" className="timeline-lane-label">
              {STATE_LABEL[s]}
            </text>
          </g>
        ))}
        <line x1={GUTTER} x2={GUTTER + plotW} y1={axisY} y2={axisY} className="timeline-axis" />

        {/* time ticks */}
        {ticks.map((s) => (
          <text key={s} x={x(startedAt + s * 1000)} y={axisY + 38} className="timeline-tick" textAnchor="middle">
            {formatClock(s * 1000)}
          </text>
        ))}

        {/* hints */}
        {helpMarks.map(({ e, hx, showLabel }) => (
          <g key={`${e.type}-${e.t}`} className="timeline-help">
            <line x1={hx} x2={hx} y1={TOP - 4} y2={axisY} />
            {showLabel && (
              <>
                <path d={SPARKLE} transform={`translate(${hx - 1}, ${TOP - 15})`} className="timeline-help-mark" />
                <text x={hx + 7} y={TOP - 15} dy="0.35em" className="timeline-help-label">
                  {e.type === "nudge" ? "Check-in" : "Hint"}
                </text>
              </>
            )}
          </g>
        ))}

        <path d={path} className="timeline-step" />

        {/* readings */}
        {points.map((p, i) => (
          <circle
            key={p.t}
            cx={x(p.t)}
            cy={laneY(p.state)}
            r={hover === i ? 7 : 5}
            fill={`var(--state-${p.state})`}
            className="timeline-dot"
          />
        ))}

        {/* answers */}
        {attempts.map((a) => (
          <g
            key={`a-${a.t}`}
            transform={`translate(${x(a.t)}, ${axisY + 14})`}
            className="timeline-attempt"
            data-correct={a.correct}
          >
            <circle r={8} />
            <path d={a.correct ? "M-3.5 0.2l2.3 2.3 4.6-4.8" : "M-2.8-2.8l5.6 5.6M2.8-2.8l-5.6 5.6"} />
          </g>
        ))}

        {/* hit areas: the whole column around each reading */}
        {points.map((p, i) => {
          const left = i === 0 ? GUTTER : (x(points[i - 1].t) + x(p.t)) / 2;
          const right = i === points.length - 1 ? GUTTER + plotW : (x(p.t) + x(points[i + 1].t)) / 2;
          return (
            <rect
              key={`hit-${p.t}`}
              x={left}
              y={TOP}
              width={Math.max(1, right - left)}
              height={LANES_H}
              fill="transparent"
              onPointerEnter={() => setHover(i)}
            />
          );
        })}
      </svg>

      <div className="timeline-tooltip-anchor" aria-live="polite">
        {hovered && (
          <div
            className="chart-tooltip"
            style={{ left: x(hovered.t), top: laneY(hovered.state) - 12 }}
            role="status"
          >
            <span className="chart-tooltip-key" style={{ background: `var(--state-${hovered.state})` }} />
            <b>{STATE_LABEL[hovered.state]}</b>
            <span>at {formatClock(hovered.t - startedAt)}</span>
          </div>
        )}
      </div>

      <ul className="timeline-legend" aria-hidden="true">
        <li>
          <span className="legend-dot" /> one reading every 5 s
        </li>
        {helpCount > 0 && (
          <li>
            <span className="legend-rule" /> hint arrived
          </li>
        )}
        {attempts.length > 0 && (
          <li>
            <span className="legend-attempt" data-correct="true" /> /{" "}
            <span className="legend-attempt" data-correct="false" /> your answers
          </li>
        )}
      </ul>
    </div>
  );
}
