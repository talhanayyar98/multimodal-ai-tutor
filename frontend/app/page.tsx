"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TutorChat from "@/components/TutorChat";
import WebcamFaceMesh from "@/components/WebcamFaceMesh";
import { useMouseTracking } from "@/hooks/useMouseTracking";
import { useSignalBatcher } from "@/hooks/useSignalBatcher";
import { startSession, type SessionInfo } from "@/lib/api";
import { EyeAccumulator, type EyeSample } from "@/lib/eyeSignals";
import type { Features } from "@/lib/features";

function stateLabel(state: string | null): string {
  if (!state) return "Analyzing signals…";
  if (state === "unknown") return "State unknown";
  return state.charAt(0).toUpperCase() + state.slice(1);
}

export default function Home() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const eyeAcc = useRef<EyeAccumulator | null>(null);
  if (!eyeAcc.current) eyeAcc.current = new EyeAccumulator();
  const mouseAcc = useMouseTracking();

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

  const { lastState, batchesSent } = useSignalBatcher(session?.sessionId ?? null, collect);

  return (
    <main className="page">
      <header className="header">
        <div className="brand">
          <h1>Multimodal Adaptive AI Tutor</h1>
          <p className="sub">MSc thesis prototype · University of Jyväskylä</p>
        </div>
        <div className="badges">
          <span
            className="badge badge-state"
            data-state={lastState ?? "unknown"}
            title="Cognitive state inferred by the LSTM from webcam + mouse signals, updated every 5 s"
          >
            <i className="dot" /> {stateLabel(lastState)}
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
              {session.abGroup === "adaptive" ? "✦ Adaptive tutoring" : "Standard tutoring"}
            </span>
          )}
          <span className="badge" title="5-second multimodal signal windows sent to the backend">
            ⟲ {batchesSent} windows sent
          </span>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="columns">
        <TutorChat
          sessionId={session?.sessionId ?? null}
          abGroup={session?.abGroup ?? null}
          onNewChat={handleNewChat}
        />
        <aside className="sidebar">
          <WebcamFaceMesh onSample={handleEyeSample} />
          <p className="note">
            Webcam (FaceMesh) and mouse signals are batched every 5 s and classified into a
            cognitive state{session ? ` · session ${session.sessionId.slice(0, 8)}` : ""}.
          </p>
        </aside>
      </div>
    </main>
  );
}
