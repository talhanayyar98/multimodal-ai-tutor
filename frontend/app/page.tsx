"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AiSparkle from "@/components/AiSparkle";
import { CameraIcon, MouseIcon, PulseIcon, ShieldIcon } from "@/components/collect/icons";
import ProblemResults from "@/components/results/ProblemResults";
import SessionCard from "@/components/SessionCard";
import TutorWorkspace from "@/components/TutorWorkspace";
import WebcamFaceMesh from "@/components/WebcamFaceMesh";
import { useMouseTracking } from "@/hooks/useMouseTracking";
import { useSignalBatcher } from "@/hooks/useSignalBatcher";
import { useTutorSession } from "@/hooks/useTutorSession";
import { startSession, type ModelInfo, type SessionInfo } from "@/lib/api";
import { EyeAccumulator, type EyeSample } from "@/lib/eyeSignals";
import type { Features } from "@/lib/features";

function stateLabel(state: string | null): string {
  if (!state) return "Analyzing signals…";
  if (state === "unknown") return "State unknown";
  return state.charAt(0).toUpperCase() + state.slice(1);
}

/** Says which model the state badge comes from, so a demo model is never mistaken for a real one. */
function describeModel(model: ModelInfo | null, batchesSent: number) {
  if (batchesSent === 0) return { tag: null, short: "waiting for the first signals", long: "" };
  if (!model) {
    return { tag: null, short: "ML service not reachable", long: "The ML service is not reachable, so no state is inferred." };
  }
  if (!model.trained) {
    return {
      tag: "untrained",
      short: "untrained placeholder (states are not meaningful)",
      long: "Untrained placeholder model: these states are not meaningful yet.",
    };
  }
  if (model.data === "synthetic") {
    return {
      tag: "demo",
      short: "demo, trained on mock data",
      long: `Demo model trained on synthetic data (${model.name}), for testing the pipeline, not real accuracy.`,
    };
  }
  return { tag: null, short: "trained on pilot data", long: `Model trained on pilot data (${model.name}).` };
}

export default function Home() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const eyeAcc = useRef<EyeAccumulator | null>(null);
  if (!eyeAcc.current) eyeAcc.current = new EyeAccumulator();
  const mouseAcc = useMouseTracking();

  // Problems, check-ins, results and their logging (shared with /study).
  const tutor = useTutorSession(session);
  const { finished, history, stats } = tutor;

  const connect = useCallback(async () => {
    const s = await startSession();
    setSession(s);
    setError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tryConnect() {
      try {
        await connect();
      } catch {
        if (cancelled) return;
        // Backend may still be booting (tsx compile + Mongo connect) — keep retrying.
        setError("Backend not reachable yet — retrying every 3 s…");
        timer = setTimeout(tryConnect, 3000);
      }
    }
    void tryConnect();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [connect]);

  const handleNewChat = useCallback(async () => {
    try {
      await connect(); // fresh session: new id, new A/B assignment, empty signal buffer
    } catch {
      setError("Could not start a new session — backend unreachable.");
    }
  }, [connect]);

  // ---------- signals ----------

  const handleEyeSample = useCallback((sample: EyeSample) => {
    eyeAcc.current!.add(sample);
  }, []);

  const collect = useCallback(
    (windowSeconds: number): Features => ({
      ...eyeAcc.current!.flush(windowSeconds),
      ...mouseAcc.current.flush(windowSeconds),
    }),
    [mouseAcc],
  );

  const { lastState, batchesSent, model } = useSignalBatcher(
    session?.sessionId ?? null,
    collect,
    undefined,
    tutor.handleState,
  );
  const modelNote = describeModel(model, batchesSent);

  const adaptive = session?.abGroup === "adaptive";
  const nudgeNote = `Based on your face and mouse signals over the last ~10 s${
    modelNote.tag ? ` (${modelNote.tag} model)` : ""
  }.`;

  return (
    <main className="page home">
      <header className="header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <AiSparkle size={22} />
          </span>
          <div>
            <h1>
              Multimodal Adaptive <span className="ai-text">AI Tutor</span>
            </h1>
            <p className="sub">MSc thesis prototype · University of Jyväskylä</p>
          </div>
        </div>
        <div className="badges">
          <span
            className="badge badge-state"
            data-state={lastState ?? "unknown"}
            title={`Cognitive state inferred by the LSTM from the last minute of webcam + mouse signals, updated every 5 s. ${modelNote.long}`}
          >
            <i className="dot" /> {stateLabel(lastState)}
            {modelNote.tag && <span className="badge-tag">{modelNote.tag}</span>}
          </span>
          {session && (
            <span
              className="badge badge-group"
              data-group={session.abGroup}
              title={
                session.abGroup === "adaptive"
                  ? "A/B condition: tutor responses are tuned to your inferred cognitive state"
                  : "A/B condition: tutor responses ignore cognitive state (control)"
              }
            >
              {session.abGroup === "adaptive" && <AiSparkle size={12} />}
              {session.abGroup === "adaptive" ? "Adaptive tutoring" : "Standard tutoring"}
            </span>
          )}
          <span className="badge" title="5-second multimodal signal windows sent to the backend">
            <b className="badge-count">{batchesSent}</b> windows sent
          </span>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="columns">
        <TutorWorkspace tutor={tutor} session={session} onNewChat={handleNewChat} nudgeNote={nudgeNote} />
        <aside className="sidebar">
          <WebcamFaceMesh onSample={handleEyeSample} />
          <SessionCard stats={stats} history={history}>
            <p className="session-checkins" data-on={adaptive}>
              <AiSparkle size={12} />
              {session
                ? adaptive
                  ? "AI check-ins on: the tutor offers help when you seem stuck or bored."
                  : "AI check-ins off: standard tutoring doesn't react to your state."
                : "Connecting…"}
            </p>
          </SessionCard>
          <section className="card how-card" aria-labelledby="how-title">
            <h2 id="how-title">How this works</h2>
            <ul>
              <li>
                <span className="how-icon">
                  <CameraIcon size={15} />
                </span>
                <span>
                  <b>Face &amp; eyes</b> — openness, blinks, gaze and head movement
                </span>
              </li>
              <li>
                <span className="how-icon">
                  <MouseIcon size={15} />
                </span>
                <span>
                  <b>Mouse</b> — movement, speed, clicks and pauses
                </span>
              </li>
              <li>
                <span className="how-icon">
                  <PulseIcon size={15} />
                </span>
                <span>
                  <b>Every 5 s</b> these numbers are sent to estimate your learning state
                </span>
              </li>
              <li>
                <span className="how-icon">
                  <ShieldIcon size={15} />
                </span>
                <span>The camera image never leaves your browser</span>
              </li>
            </ul>
            <p className="how-session">
              Model: {modelNote.short}
              {session && ` · session ${session.sessionId.slice(0, 8)}`}
            </p>
          </section>
        </aside>
      </div>

      {finished && (
        <ProblemResults
          key={finished.record.startedAt}
          record={finished.record}
          summary={finished.summary}
          session={stats}
          modelNote={modelNote.long || "No model information yet."}
          onNext={tutor.startProblem}
        />
      )}
    </main>
  );
}
