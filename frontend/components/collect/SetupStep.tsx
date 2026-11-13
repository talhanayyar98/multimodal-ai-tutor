"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CHECKIN_OPTIONS } from "@/components/SelfReportProbe";
import type { SelfReportState } from "@/lib/api";
import { ArrowRightIcon, ChatIcon, CheckIcon, FractionIcon, PencilIcon, TargetIcon } from "./icons";

const FACE_LOCK_MS = 3000; // face tracked continuously this long = camera check passed
const SKIP_OFFER_MS = 20000; // offer to continue without face tracking after this
const RING_C = 2 * Math.PI * 15; // circumference of the progress ring (r = 15)

function SetupItem({
  n,
  done,
  title,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="setup-item" data-done={done}>
      <span className="setup-num" aria-hidden="true">
        {done ? <CheckIcon size={15} /> : n}
      </span>
      <div className="setup-body">
        <h3>{title}</h3>
        {children}
      </div>
    </li>
  );
}

function Tip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="tip">
      <span className="tip-icon">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

/**
 * Camera check, before the exercises start. The pilot (/collect) also
 * explains and practises the self-report check-ins; the study (/study,
 * `probeIntervalS` omitted) has none, so that part is left out.
 */
export default function SetupStep({
  getFaceStreakMs,
  probeIntervalS,
  onDone,
}: {
  getFaceStreakMs: () => number;
  /** Self-report interval of the pilot; omit for the study (no self-reports). */
  probeIntervalS?: number;
  onDone: (reason: "face-ok" | "skipped") => void;
}) {
  const pilot = probeIntervalS !== undefined;
  const [faceOk, setFaceOk] = useState(false);
  const [lock, setLock] = useState(0); // 0..1 progress towards FACE_LOCK_MS
  const [elapsed, setElapsed] = useState(0);
  const [practice, setPractice] = useState<SelfReportState | null>(null);

  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      const streak = getFaceStreakMs();
      if (streak >= FACE_LOCK_MS) setFaceOk(true); // latches: a later blink-out is fine
      setLock(Math.min(1, streak / FACE_LOCK_MS));
      setElapsed(Date.now() - start);
    }, 250);
    return () => clearInterval(timer);
  }, [getFaceStreakMs]);

  const progress = faceOk ? 1 : lock;
  const status = faceOk
    ? "Your face is being tracked."
    : lock > 0
      ? "Face found — hold still for a moment…"
      : "Waiting for the camera to find your face…";
  const practiced = CHECKIN_OPTIONS.find((o) => o.state === practice);

  return (
    <section className="card collect-card setup" data-testid="setup">
      <p className="eyebrow">Almost ready</p>
      <h2>Before you start</h2>

      <ol className="setup-list">
        <SetupItem n={1} done={faceOk} title="Camera check">
          <p>
            Sit the way you normally would when studying, with your face visible in the camera
            preview. Keep the lighting as it is for the whole session.
          </p>
          <div className="face-lock" data-ok={faceOk}>
            <svg className="face-ring" viewBox="0 0 36 36" aria-hidden="true">
              <circle className="face-ring-track" cx="18" cy="18" r="15" />
              <circle
                className="face-ring-fill"
                cx="18"
                cy="18"
                r="15"
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - progress)}
              />
            </svg>
            <span className="face-ring-icon">{faceOk ? <CheckIcon size={16} /> : null}</span>
            <p className="setup-status" data-ok={faceOk} data-testid="setup-status" aria-live="polite">
              {status}
            </p>
          </div>
          {!faceOk && elapsed >= SKIP_OFFER_MS && (
            <p className="muted setup-help">
              Not finding you? Face the screen, move a little closer and make sure there is light in
              front of you rather than behind you.
            </p>
          )}
        </SetupItem>

        {pilot && (
        <SetupItem n={2} done={practice !== null} title="Check-ins">
          <p>
            About every {probeIntervalS} seconds this question pops up:{" "}
            <i>“Right now, which best describes how you feel about the task?”</i> Pick whatever fits
            best at that moment. It is completely fine — and genuinely useful — to say you are
            bored, confused or frustrated.
          </p>
          <div className="practice">
            <p className="practice-q">Try it once — this practice answer is not saved:</p>
            <div className="practice-options">
              {CHECKIN_OPTIONS.map((o) => (
                <button
                  key={o.state}
                  type="button"
                  className="probe-option practice-option"
                  data-state={o.state}
                  data-picked={practice === o.state}
                  aria-pressed={practice === o.state}
                  onClick={() => setPractice(o.state)}
                  data-testid={`practice-${o.state}`}
                >
                  <span className="probe-label">{o.label}</span>
                  <span className="probe-hint">{o.hint}</span>
                </button>
              ))}
            </div>
            {practiced && (
              <p className="practice-ok" aria-live="polite">
                <CheckIcon size={14} /> That&apos;s all a check-in takes — one click, then you&apos;re
                back to the questions.
              </p>
            )}
          </div>
        </SetupItem>
        )}

        <SetupItem n={pilot ? 3 : 2} done={false} title={pilot ? "During the questions" : "While you work"}>
          <div className="tips">
            <Tip icon={<ChatIcon />}>Work as you normally would and ask the tutor whenever you like.</Tip>
            <Tip icon={<PencilIcon />}>Pen and paper are fine, but please stay on this page.</Tip>
            <Tip icon={<FractionIcon />}>
              Don&apos;t use a calculator — answers can be typed as fractions like 3/8.
            </Tip>
            <Tip icon={<TargetIcon />}>
              {pilot ? (
                <>
                  Some questions are easy, some are very hard; how many you get right doesn&apos;t
                  matter.
                </>
              ) : (
                <>Some problems are easy, some are tricky. Do your best; skipping one is fine too.</>
              )}
            </Tip>
          </div>
        </SetupItem>
      </ol>

      <div className="collect-actions">
        <button
          className="btn btn-primary btn-lg"
          disabled={!faceOk}
          onClick={() => onDone("face-ok")}
          data-testid="setup-start"
        >
          {pilot ? "Start the questions" : "Start"} <ArrowRightIcon size={15} />
        </button>
        {!faceOk && elapsed < SKIP_OFFER_MS && (
          <span className="muted action-hint">Unlocks once the camera has found your face.</span>
        )}
        {!faceOk && elapsed >= SKIP_OFFER_MS && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => onDone("skipped")}
            data-testid="setup-skip"
            title="Only if the researcher says so — the session will have no face data"
          >
            Camera not working? Continue without it
          </button>
        )}
      </div>
    </section>
  );
}
