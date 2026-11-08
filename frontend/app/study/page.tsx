"use client";

// A/B study (between-subjects): consent → camera check → tutoring → done.
//
// The participant gets a code (LRN001…) when they agree; their group is drawn
// at that moment (balanced blocks of 4, see backend/src/allocation.ts) and is
// never shown. The tutoring is the main page's loop (useTutorSession) on a
// fixed task — the same 12 problems in the same order for everyone, ending
// after the last one or at the time limit (lib/studyTask.ts) — without
// anything that reveals the group or the inferred states; the adaptive group
// still gets the check-in bubbles, since they are the intervention. Each
// stage and the final status are stored with the participant, so the analysis
// can keep only status "completed".
//
// Researcher-only URL options:
//   ?test             test run: ST-code + isTest: true, with its own counter
//                     and group blocks, so it never uses up a real slot.
//   ?limit=<seconds>  shorter time limit (10–3600 s) to try the time-up
//                     ending; always a test run, so it can't touch real data.

import { useCallback, useEffect, useRef, useState } from "react";
import AiSparkle from "@/components/AiSparkle";
import DoneStep from "@/components/collect/DoneStep";
import SetupStep from "@/components/collect/SetupStep";
import ProblemResults from "@/components/results/ProblemResults";
import SessionCard from "@/components/SessionCard";
import StudyConsent from "@/components/study/StudyConsent";
import TutorWorkspace from "@/components/TutorWorkspace";
import WebcamFaceMesh from "@/components/WebcamFaceMesh";
import { useMouseTracking } from "@/hooks/useMouseTracking";
import { useSignalBatcher } from "@/hooks/useSignalBatcher";
import { useTutorSession } from "@/hooks/useTutorSession";
import {
  createStudyParticipant,
  finishStudyParticipant,
  setStudyStage,
  startStudySession,
  type SessionInfo,
} from "@/lib/api";
import { EyeAccumulator, type EyeSample } from "@/lib/eyeSignals";
import type { Features } from "@/lib/features";
import { STUDY_PROBLEMS, STUDY_TIME_LIMIT_MS } from "@/lib/studyTask";

type Step = "consent" | "camera" | "tutoring" | "done";
/** How the tutoring ended: every problem done, time limit reached, or "End session". */
type TutoringEnd = "all-done" | "time-up" | "ended-early";

/** Shown small in the check-in bubble (adaptive group). No model details in the study. */
const NUDGE_NOTE = "Based on your face and mouse signals over the last ~10 s.";

const END_TITLE: Record<TutoringEnd, string> = {
  "all-done": "That was the last problem",
  "time-up": "Time's up",
  "ended-early": "Ending the session",
};

const DONE_NOTE: Record<TutoringEnd, string> = {
  "all-done": `You worked through all ${STUDY_PROBLEMS.length} problems. Thank you for trying the tutor!`,
  "time-up": "Time was up before the last problem, and that's completely fine. Thank you for trying the tutor!",
  "ended-early": "You ended the session early; everything up to that point is saved. Thank you for taking part!",
};

export default function StudyPage() {
  const [step, setStep] = useState<Step>("consent");
  const [isTest, setIsTest] = useState(false);
  const [timeLimitMs, setTimeLimitMs] = useState(STUDY_TIME_LIMIT_MS);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [starting, setStarting] = useState(false);
  const [tutoringStartedAt, setTutoringStartedAt] = useState<number | null>(null);
  const [tutoringEnd, setTutoringEnd] = useState<TutoringEnd | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const limitS = Number(q.get("limit"));
    const customLimit = q.has("limit") && Number.isFinite(limitS) && limitS >= 10 && limitS <= 3600;
    if (customLimit) setTimeLimitMs(limitS * 1000);
    setIsTest(q.has("test") || customLimit);
  }, []);

  // ---------- signals: face + mouse ----------

  const eyeAcc = useRef<EyeAccumulator | null>(null);
  if (!eyeAcc.current) eyeAcc.current = new EyeAccumulator();
  const mouseAcc = useMouseTracking();
  const faceSinceRef = useRef<number | null>(null);
  const lastSampleRef = useRef(0);

  const handleEyeSample = useCallback((sample: EyeSample) => {
    eyeAcc.current!.add(sample);
    const t = Date.now();
    lastSampleRef.current = t;
    if (!sample.faceDetected) faceSinceRef.current = null;
    else if (faceSinceRef.current === null) faceSinceRef.current = t;
  }, []);

  const getFaceStreakMs = useCallback(() => {
    const t = Date.now();
    if (faceSinceRef.current === null || t - lastSampleRef.current > 1000) return 0;
    return t - faceSinceRef.current;
  }, []);

  const collect = useCallback(
    (windowSeconds: number): Features => ({
      ...eyeAcc.current!.flush(windowSeconds),
      ...mouseAcc.current.flush(windowSeconds),
    }),
    [mouseAcc],
  );

  // Problems, signal windows and their logging run only while the tutoring is on.
  const tutoringActive = step === "tutoring" && tutoringEnd === null;
  const tutor = useTutorSession(tutoringActive ? session : null, {
    showStates: false,
    sequence: STUDY_PROBLEMS,
  });
  useSignalBatcher(tutoringActive ? (session?.sessionId ?? null) : null, collect, undefined, tutor.handleState);

  // Drop whatever the accumulators gathered before the tutoring (consent,
  // camera check), so the first stored window covers only its own 5 s.
  useEffect(() => {
    if (!tutoringActive) return;
    eyeAcc.current!.flush(5);
    mouseAcc.current.flush(5);
  }, [tutoringActive, mouseAcc]);

  // A reload would lose the session (the participant would stay "in-progress") — ask first.
  const recording = step === "camera" || step === "tutoring";
  useEffect(() => {
    if (!recording) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [recording]);

  // ---------- steps ----------

  async function handleAgree() {
    setStarting(true);
    setError(null);
    try {
      // A retry after a failed start keeps the code that was already created.
      let pid = participantId;
      if (!pid) {
        pid = (await createStudyParticipant(isTest)).participantId;
        setParticipantId(pid);
      }
      setSession(await startStudySession(pid));
      await setStudyStage(pid, "camera");
      setStep("camera");
    } catch (err) {
      setError(`Could not start the session (${(err as Error).message}). Please tell the researcher.`);
    } finally {
      setStarting(false);
    }
  }

  async function handleCameraDone(reason: "face-ok" | "skipped") {
    if (!participantId) return;
    setError(null);
    try {
      await setStudyStage(participantId, "tutoring", reason);
      setTutoringStartedAt(Date.now());
      setStep("tutoring");
    } catch (err) {
      setError(`Could not save your progress (${(err as Error).message}). Please tell the researcher.`);
    }
  }

  async function saveEnd(how: TutoringEnd) {
    if (!participantId) return;
    setSaving(true);
    setError(null);
    try {
      await finishStudyParticipant(participantId, how === "ended-early" ? "ended-early" : "completed");
      setStep("done");
    } catch (err) {
      setError(`Could not save the end of your session (${(err as Error).message}). Please tell the researcher.`);
    } finally {
      setSaving(false);
    }
  }

  // Ends the tutoring exactly once, however it ends.
  const ended = useRef(false);
  function endTutoring(how: TutoringEnd) {
    if (ended.current) return;
    ended.current = true;
    tutor.endRun(); // logs an open problem as "unfinished" while the session is still attached
    setTutoringEnd(how);
    void saveEnd(how);
  }
  // The timer below must call the latest endTutoring (it reads the current check-in).
  const endTutoringRef = useRef(endTutoring);
  endTutoringRef.current = endTutoring;

  // Time limit, counted from the first problem. No countdown is shown.
  useEffect(() => {
    if (!tutoringActive || tutoringStartedAt === null) return;
    const left = timeLimitMs - (Date.now() - tutoringStartedAt);
    const timer = setTimeout(() => endTutoringRef.current("time-up"), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [tutoringActive, tutoringStartedAt, timeLimitMs]);

  function handleEndEarly() {
    if (window.confirm("End the session now? Everything so far is kept.")) endTutoring("ended-early");
  }

  return (
    <main className="page home study" data-step={step}>
      <header className="header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <AiSparkle size={22} />
          </span>
          <div>
            <h1>
              Multimodal Adaptive <span className="ai-text">AI Tutor</span>
            </h1>
            <p className="sub">MSc thesis study · University of Jyväskylä</p>
          </div>
        </div>
        <div className="badges">
          {isTest && (
            <span className="badge badge-test" title="Test run: stored with an ST-code and isTest: true">
              Test run
            </span>
          )}
          {participantId && (
            <span className="badge" data-testid="participant-code">
              Participant {participantId}
            </span>
          )}
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {step === "consent" && <StudyConsent busy={starting} onAgree={handleAgree} />}

      {recording && (
        <div className="columns">
          {step === "camera" ? (
            <div className="collect-main">
              <SetupStep getFaceStreakMs={getFaceStreakMs} onDone={handleCameraDone} />
            </div>
          ) : tutoringEnd ? (
            <div className="collect-main">
              <section className="card collect-card" data-testid="tutoring-end">
                <h2>{END_TITLE[tutoringEnd]}</h2>
                <p>{saving || !error ? "Saving your session…" : "Your session could not be saved yet."}</p>
                {error && !saving && (
                  <div className="collect-actions">
                    <button className="btn btn-gold" onClick={() => void saveEnd(tutoringEnd)} data-testid="save-retry">
                      Try again
                    </button>
                  </div>
                )}
              </section>
            </div>
          ) : (
            <TutorWorkspace tutor={tutor} session={session} nudgeNote={NUDGE_NOTE} showStates={false} />
          )}
          {/* Same position in both steps, so the camera keeps running from the check into the tutoring. */}
          <aside className="sidebar">
            <WebcamFaceMesh onSample={handleEyeSample} />
            <p className="note">
              The camera image stays on this computer — only numbers computed from it are saved.
            </p>
            {tutoringActive && (
              <>
                <SessionCard stats={tutor.stats} history={tutor.history} />
                <button
                  className="btn btn-ghost btn-sm end-session"
                  onClick={handleEndEarly}
                  data-testid="end-session"
                >
                  End session
                </button>
              </>
            )}
          </aside>
        </div>
      )}

      {tutoringActive && tutor.finished && (
        <ProblemResults
          key={tutor.finished.record.startedAt}
          record={tutor.finished.record}
          summary={tutor.finished.summary}
          session={tutor.stats}
          modelNote=""
          showStates={false}
          nextLabel={tutor.isLast ? "Finish" : "Next problem"}
          onNext={tutor.isLast ? () => endTutoring("all-done") : tutor.startProblem}
        />
      )}

      {step === "done" && (
        <DoneStep participantId={participantId} note={<p>{DONE_NOTE[tutoringEnd ?? "all-done"]}</p>} />
      )}
    </main>
  );
}
