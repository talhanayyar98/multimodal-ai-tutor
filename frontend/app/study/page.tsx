"use client";

// A/B study (between-subjects): consent → camera check → tutoring → done.
//
// The participant gets a code (LRN001…) when they agree; their group is drawn
// at that moment (balanced blocks of 4, see backend/src/allocation.ts) and is
// never shown. The tutoring is the main page's loop (useTutorSession) without
// anything that reveals the group or the inferred states; the adaptive group
// still gets the check-in bubbles, since they are the intervention. Each
// stage and the final status are stored with the participant, so the analysis
// can keep only status "completed".
//
// Researcher-only URL option:
//   ?test   test run: ST-code + isTest: true, with its own counter and group
//           blocks, so it never uses up a real participant's slot.

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

type Step = "consent" | "camera" | "tutoring" | "done";

/** Shown small in the check-in bubble (adaptive group). No model details in the study. */
const NUDGE_NOTE = "Based on your face and mouse signals over the last ~10 s.";

export default function StudyPage() {
  const [step, setStep] = useState<Step>("consent");
  const [isTest, setIsTest] = useState(false);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [starting, setStarting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsTest(new URLSearchParams(window.location.search).has("test"));
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

  // Problems, signal windows and their logging run only during the tutoring.
  const tutoring = step === "tutoring";
  const tutor = useTutorSession(tutoring ? session : null, { showStates: false });
  useSignalBatcher(tutoring ? (session?.sessionId ?? null) : null, collect, undefined, tutor.handleState);

  // Drop whatever the accumulators gathered before the tutoring (consent,
  // camera check), so the first stored window covers only its own 5 s.
  useEffect(() => {
    if (!tutoring) return;
    eyeAcc.current!.flush(5);
    mouseAcc.current.flush(5);
  }, [tutoring, mouseAcc]);

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
      setStep("tutoring");
    } catch (err) {
      setError(`Could not save your progress (${(err as Error).message}). Please tell the researcher.`);
    }
  }

  async function handleFinish() {
    if (!participantId || finishing) return;
    if (!window.confirm("Finish the session? You can't come back to it afterwards.")) return;
    setFinishing(true);
    setError(null);
    try {
      await finishStudyParticipant(participantId, "completed");
      setStep("done");
    } catch (err) {
      setError(`Could not save the end of your session (${(err as Error).message}). Please tell the researcher.`);
    } finally {
      setFinishing(false);
    }
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
          ) : (
            <TutorWorkspace tutor={tutor} session={session} nudgeNote={NUDGE_NOTE} showStates={false} />
          )}
          {/* Same position in both steps, so the camera keeps running from the check into the tutoring. */}
          <aside className="sidebar">
            <WebcamFaceMesh onSample={handleEyeSample} />
            <p className="note">
              The camera image stays on this computer — only numbers computed from it are saved.
            </p>
            {tutoring && (
              <>
                <SessionCard stats={tutor.stats} history={tutor.history} />
                <button
                  className="btn btn-ghost btn-sm end-session"
                  onClick={handleFinish}
                  disabled={finishing}
                  data-testid="finish-session"
                >
                  {finishing ? "Saving…" : "Finish session"}
                </button>
              </>
            )}
          </aside>
        </div>
      )}

      {tutoring && tutor.finished && (
        <ProblemResults
          key={tutor.finished.record.startedAt}
          record={tutor.finished.record}
          summary={tutor.finished.summary}
          session={tutor.stats}
          modelNote=""
          showStates={false}
          onNext={tutor.startProblem}
        />
      )}

      {step === "done" && (
        <DoneStep participantId={participantId} note={<p>Thank you for trying the tutor!</p>} />
      )}
    </main>
  );
}
