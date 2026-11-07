"use client";

// Pilot data collection: consent → background questions → camera check →
// warm-up + four exercise blocks with check-in pop-ups → end survey.
// Every 5 s the same 13 face + mouse features the live tutor uses are stored,
// plus keyboard counts; the check-ins are the training labels.
//
// Researcher-only URL options (any of them marks the participant as a test run
// with a T-code, so it's easy to exclude):
//   ?test               test run with normal timings
//   ?probe=<seconds>    check-in interval (default 90)
//   ?block=<seconds>    length of each block (default 420)

import { useCallback, useEffect, useRef, useState } from "react";
import ConsentStep from "@/components/collect/ConsentStep";
import DoneStep from "@/components/collect/DoneStep";
import ExerciseRunner from "@/components/collect/ExerciseRunner";
import IntakeForm from "@/components/collect/IntakeForm";
import PostSurvey from "@/components/collect/PostSurvey";
import SetupStep from "@/components/collect/SetupStep";
import Stepper from "@/components/collect/Stepper";
import SelfReportProbe, { DEFAULT_PROBE_INTERVAL_S } from "@/components/SelfReportProbe";
import TutorChat from "@/components/TutorChat";
import WebcamFaceMesh from "@/components/WebcamFaceMesh";
import { useKeyboardTracking } from "@/hooks/useKeyboardTracking";
import { useMouseTracking } from "@/hooks/useMouseTracking";
import { useSignalBatcher } from "@/hooks/useSignalBatcher";
import {
  createParticipant,
  finishParticipant,
  postExerciseEvent,
  startSession,
  type ExerciseEvent,
  type Intake,
  type PostSurvey as PostSurveyAnswers,
  type SessionInfo,
} from "@/lib/api";
import { EyeAccumulator, type EyeSample } from "@/lib/eyeSignals";
import {
  DEFAULT_BLOCK_SECONDS,
  STAGES,
  type BlockId,
  type Exercise,
  type StageId,
} from "@/lib/exercises";
import type { Features } from "@/lib/features";

type Step = "consent" | "intake" | "setup" | "task" | "post" | "done";

interface Settings {
  probeIntervalS: number;
  blockSeconds: number;
  isTest: boolean;
}

function readSettings(search: string): Settings {
  const q = new URLSearchParams(search);
  const probe = numberParam(q.get("probe"), 5, 900);
  const block = numberParam(q.get("block"), 10, 1800);
  return {
    probeIntervalS: probe ?? DEFAULT_PROBE_INTERVAL_S,
    blockSeconds: block ?? DEFAULT_BLOCK_SECONDS,
    isTest: q.has("test") || probe !== null || block !== null,
  };
}

function numberParam(raw: string | null, min: number, max: number): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function isBlockId(value: string): value is BlockId {
  return value !== "warmup" && value in STAGES;
}

export default function CollectPage() {
  const [step, setStep] = useState<Step>("consent");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [blockOrder, setBlockOrder] = useState<BlockId[]>([]);
  const [stageIndex, setStageIndex] = useState(0);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [checkins, setCheckins] = useState(0);
  const [dataError, setDataError] = useState<string | null>(null);
  const [endedEarly, setEndedEarly] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const contextRef = useRef<{ blockId?: string; exerciseId?: string }>({});

  useEffect(() => {
    setSettings(readSettings(window.location.search));
  }, []);

  // ---------- signals: face + mouse (model features) and keyboard (extras) ----------

  const eyeAcc = useRef<EyeAccumulator | null>(null);
  if (!eyeAcc.current) eyeAcc.current = new EyeAccumulator();
  const mouseAcc = useMouseTracking();
  const keyAcc = useKeyboardTracking();
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
  const collectExtras = useCallback(() => keyAcc.current.flush(), [keyAcc]);

  const recording = step === "setup" || step === "task";
  useSignalBatcher(recording ? (session?.sessionId ?? null) : null, collect, collectExtras);

  // Drop whatever the accumulators gathered before recording began (consent
  // and form filling), so the first stored window covers only its own 5 s.
  useEffect(() => {
    if (!session) return;
    eyeAcc.current!.flush(5);
    mouseAcc.current.flush(5);
    keyAcc.current.flush();
  }, [session, mouseAcc, keyAcc]);

  // ---------- event logging ----------

  const reportDataError = useCallback((err: Error) => {
    setDataError(`Some data was not saved (${err.message}). Please tell the researcher.`);
  }, []);

  const logEvent = useCallback(
    (event: ExerciseEvent) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      postExerciseEvent(sessionId, { ...event, t: Date.now() }).catch(reportDataError);
    },
    [reportDataError],
  );

  // Leaving the tab during the questions is logged, so those windows can be cleaned out.
  useEffect(() => {
    if (step !== "task") return;
    const onVisibility = () =>
      logEvent({ type: document.hidden ? "tab-hidden" : "tab-visible", ...contextRef.current });
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [step, logEvent]);

  // A reload would lose the session — ask before leaving.
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

  async function handleIntake(intake: Intake) {
    if (!settings) throw new Error("page not ready");
    const participant = await createParticipant({
      consent: true,
      intake,
      environment: {
        userAgent: navigator.userAgent,
        screenW: window.screen.width,
        screenH: window.screen.height,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: navigator.language,
      },
      settings: { probeIntervalS: settings.probeIntervalS, blockSeconds: settings.blockSeconds },
      isTest: settings.isTest,
    });
    const order = participant.blockOrder.filter(isBlockId);
    if (order.length !== participant.blockOrder.length) {
      throw new Error(`unexpected block order ${participant.blockOrder.join(", ")}`);
    }
    const newSession = await startSession({ participantId: participant.participantId });
    if (!newSession.persisted) throw new Error("the backend has no database connection");

    sessionIdRef.current = newSession.sessionId;
    setParticipantId(participant.participantId);
    setBlockOrder(order);
    setSession(newSession);
    setStep("setup");
  }

  function handleSetupDone(reason: "face-ok" | "skipped") {
    logEvent({ type: "setup-done", reason });
    setStep("task");
  }

  const handleItem = useCallback((stage: StageId | null, item: Exercise | null) => {
    contextRef.current = { blockId: stage ?? undefined, exerciseId: item?.id };
    setProblem(item?.text ?? null);
  }, []);

  const finishTask = useCallback(
    (reason: "completed" | "ended-early") => {
      logEvent({ type: "session-end", reason, ...contextRef.current });
      contextRef.current = {};
      setEndedEarly(reason === "ended-early");
      setStep("post");
    },
    [logEvent],
  );

  function handleEndEarly() {
    if (window.confirm("End the session now? Everything recorded so far is kept.")) {
      finishTask("ended-early");
    }
  }

  async function handlePost(answers: PostSurveyAnswers) {
    if (!participantId) return;
    await finishParticipant(participantId, endedEarly ? "ended-early" : "completed", answers);
    setStep("done");
  }

  const getContext = useCallback(() => contextRef.current, []);
  const handleCheckinSaved = useCallback(() => setCheckins((n) => n + 1), []);

  return (
    <main className="page collect" data-layout={recording ? "wide" : "narrow"}>
      <header className="header">
        <div className="brand">
          <h1>Multimodal Adaptive AI Tutor</h1>
          <p className="sub">Data collection · MSc thesis study · University of Jyväskylä</p>
        </div>
        <div className="badges">
          {settings?.isTest && (
            <span className="badge badge-test" title="Test run: stored with a T-code and isTest: true">
              Test run
            </span>
          )}
          {participantId && (
            <span className="badge" data-testid="participant-code">
              Participant {participantId}
            </span>
          )}
          {step === "task" && (
            <span className="badge" data-testid="checkin-count">
              {checkins} check-in{checkins === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </header>

      <Stepper
        step={step}
        stageIndex={stageIndex}
        stageCount={1 + (blockOrder.length || Object.keys(STAGES).length - 1)}
        blockSeconds={settings?.blockSeconds ?? DEFAULT_BLOCK_SECONDS}
      />

      {dataError && <p className="error">{dataError}</p>}

      {step === "consent" && <ConsentStep onAgree={() => setStep("intake")} />}
      {step === "intake" && <IntakeForm onSubmit={handleIntake} />}

      {recording && session && settings && (
        <div className="columns">
          <div className="collect-main">
            {step === "setup" ? (
              <SetupStep
                getFaceStreakMs={getFaceStreakMs}
                probeIntervalS={settings.probeIntervalS}
                onDone={handleSetupDone}
              />
            ) : (
              <>
                <ExerciseRunner
                  blockOrder={blockOrder}
                  blockSeconds={settings.blockSeconds}
                  onEvent={logEvent}
                  onItem={handleItem}
                  onStage={setStageIndex}
                  onFinished={() => finishTask("completed")}
                />
                {problem && (
                  <TutorChat
                    sessionId={session.sessionId}
                    abGroup={session.abGroup}
                    problem={problem}
                    showExercise={false}
                    className="chat-compact"
                  />
                )}
              </>
            )}
          </div>
          {/* Same position in both steps, so the camera keeps running from setup into the task. */}
          <aside className="sidebar">
            <WebcamFaceMesh onSample={handleEyeSample} />
            <p className="note">
              The camera image stays on this computer — only numbers computed from it are saved.
            </p>
            {step === "task" && (
              <button
                className="btn btn-ghost btn-sm end-session"
                onClick={handleEndEarly}
                data-testid="end-session"
              >
                End session
              </button>
            )}
          </aside>
        </div>
      )}

      {step === "task" && session && settings && (
        <SelfReportProbe
          sessionId={session.sessionId}
          intervalS={settings.probeIntervalS}
          getContext={getContext}
          onSaved={handleCheckinSaved}
          onError={setDataError}
        />
      )}

      {step === "post" && <PostSurvey endedEarly={endedEarly} onSubmit={handlePost} />}

      {step === "done" && <DoneStep participantId={participantId} />}
    </main>
  );
}
