"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import AiSparkle from "@/components/AiSparkle";
import { CameraIcon, MouseIcon, PulseIcon, ShieldIcon } from "@/components/collect/icons";
import ProblemCard from "@/components/ProblemCard";
import ProblemResults from "@/components/results/ProblemResults";
import TutorChat from "@/components/TutorChat";
import WebcamFaceMesh from "@/components/WebcamFaceMesh";
import { useMouseTracking } from "@/hooks/useMouseTracking";
import { useSignalBatcher } from "@/hooks/useSignalBatcher";
import {
  logProblemEvent,
  startSession,
  type ModelInfo,
  type ProblemEventBody,
  type SessionInfo,
} from "@/lib/api";
import { EyeAccumulator, type EyeSample } from "@/lib/eyeSignals";
import type { Features } from "@/lib/features";
import { NUDGE_RULES, nudgeToOffer, type NudgeOffer, type Reading } from "@/lib/nudges";
import {
  sessionStats,
  summarize,
  type HistoryEntry,
  type ProblemRecord,
  type Summary,
  type TimelineEvent,
} from "@/lib/problemReport";
import { answerText, nextProblem, type Problem } from "@/lib/problems";

const WELCOME =
  "Hi! I'm your tutor. Type your answer in the box above, or talk it through with me here. Tap Hint whenever you like.";

/** Pause between the "Correct!" moment and the results screen. */
const RESULTS_DELAY_MS = 1100;

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

interface ActiveProblem {
  uid: number;
  /** 1-based position in this session. */
  number: number;
  problem: Problem;
  startedAt: number;
}

export default function Home() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const eyeAcc = useRef<EyeAccumulator | null>(null);
  if (!eyeAcc.current) eyeAcc.current = new EyeAccumulator();
  const mouseAcc = useMouseTracking();

  // ---------- the current problem ----------
  const [active, setActive] = useState<ActiveProblem | null>(null);
  const [finished, setFinished] = useState<{ record: ProblemRecord; summary: Summary } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [nudge, setNudge] = useState<NudgeOffer | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  // The problem's log lives in a ref (callbacks that fire after an await must
  // not see stale state); `logVersion` re-renders when it grows.
  const log = useRef<{ readings: Reading[]; events: TimelineEvent[] }>({ readings: [], events: [] });
  const [logVersion, bumpLog] = useReducer((n: number) => n + 1, 0);
  const activeRef = useRef<ActiveProblem | null>(null);
  const sessionRef = useRef<SessionInfo | null>(null);
  const done = useRef(false); // solved or skipped: stop logging
  const nudgeMeta = useRef({ offers: 0, lastHelpAt: null as number | null, nextId: 1 });
  const counter = useRef({ uid: 0, number: 0 });
  const recent = useRef<Problem[]>([]);

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

  function logEvent(event: Omit<ProblemEventBody, "problemId" | "topic" | "difficulty" | "problemNo">) {
    const s = sessionRef.current;
    const a = activeRef.current;
    if (!s || !a) return;
    logProblemEvent(s.sessionId, {
      ...event,
      problemId: a.problem.id,
      topic: a.problem.topic,
      difficulty: a.problem.difficulty,
      problemNo: a.number,
    });
  }

  function addEvent(event: TimelineEvent) {
    log.current.events.push(event);
    bumpLog();
  }

  function startProblem() {
    const problem = nextProblem(recent.current);
    recent.current = [...recent.current, problem].slice(-20);
    const next: ActiveProblem = {
      uid: ++counter.current.uid,
      number: ++counter.current.number,
      problem,
      startedAt: Date.now(),
    };
    log.current = { readings: [], events: [] };
    done.current = false;
    nudgeMeta.current = { ...nudgeMeta.current, offers: 0, lastHelpAt: null };
    activeRef.current = next;
    setActive(next);
    setNudge(null);
    setFinished(null);
    bumpLog();
    logEvent({ type: "shown", t: next.startedAt, text: problem.text, expected: answerText(problem) });
  }

  // Every (new) session starts its own run of problems.
  useEffect(() => {
    sessionRef.current = session;
    if (!session) return;
    counter.current.number = 0;
    setHistory([]);
    startProblem();
  }, [session?.sessionId]);

  function finish(outcome: ProblemRecord["outcome"], endedAt: number) {
    const a = activeRef.current;
    if (!a) return;
    const record: ProblemRecord = {
      problem: a.problem,
      number: a.number,
      outcome,
      startedAt: a.startedAt,
      endedAt,
      readings: [...log.current.readings],
      events: [...log.current.events],
    };
    const summary = summarize(record);
    setHistory((h) => [...h, { outcome, stars: summary.stars, points: summary.points }]);
    setFinished({ record, summary });
  }

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

  const handleState = useCallback((state: string, windowEnd: number) => {
    const a = activeRef.current;
    // Windows that ended before this problem appeared belong to the previous one.
    if (!a || done.current || windowEnd <= a.startedAt) return;
    log.current.readings.push({ t: windowEnd, state });
    bumpLog();
  }, []);

  const { lastState, batchesSent, model } = useSignalBatcher(
    session?.sessionId ?? null,
    collect,
    undefined,
    handleState,
  );
  const modelNote = describeModel(model, batchesSent);

  // ---------- check-ins (adaptive group only) ----------

  function resolveNudge(offer: NudgeOffer, outcome: "accepted" | "dismissed" | "expired") {
    setNudge((cur) => (cur?.id === offer.id ? null : cur));
    const t = Date.now();
    nudgeMeta.current.lastHelpAt = t;
    const type = `nudge-${outcome}` as const;
    addEvent({ t, type, state: offer.state });
    logEvent({ type, t, state: offer.state });
  }

  // Re-checked whenever a reading arrives (every 5 s) or the chat goes idle.
  useEffect(() => {
    const a = activeRef.current;
    if (!a || session?.abGroup !== "adaptive" || done.current || nudge || chatBusy) return;
    const now = Date.now();
    const state = nudgeToOffer(log.current.readings, {
      startedAt: a.startedAt,
      now,
      lastHelpAt: nudgeMeta.current.lastHelpAt,
      offersSoFar: nudgeMeta.current.offers,
    });
    if (!state) return;
    nudgeMeta.current.offers++;
    setNudge({ id: nudgeMeta.current.nextId++, state, offeredAt: now });
    addEvent({ t: now, type: "nudge-offered", state });
    logEvent({ type: "nudge-offered", t: now, state });
  }, [logVersion, chatBusy, nudge, session?.abGroup]);

  useEffect(() => {
    if (!nudge) return;
    const timer = setTimeout(() => resolveNudge(nudge, "expired"), NUDGE_RULES.expireMs);
    return () => clearTimeout(timer);
  }, [nudge]);

  function handleNudgeAnswer(offer: NudgeOffer, accepted: boolean) {
    resolveNudge(offer, accepted ? "accepted" : "dismissed");
  }

  function handleReply(kind: "chat" | "hint" | "nudge", state?: string) {
    if (done.current) return;
    const t = Date.now();
    if (kind !== "chat") nudgeMeta.current.lastHelpAt = t;
    addEvent({ t, type: kind, state });
    logEvent({ type: kind, t, state });
  }

  // ---------- answering ----------

  function handleAttempt(answer: string, correct: boolean) {
    const a = activeRef.current;
    if (!a || done.current) return;
    const t = Date.now();
    addEvent({ t, type: "attempt", answer, correct });
    logEvent({ type: "attempt", t, answer, correct });
    if (!correct) return;
    done.current = true;
    if (nudge) resolveNudge(nudge, "expired");
    logEvent({ type: "solved", t });
    setTimeout(() => {
      if (activeRef.current?.uid === a.uid) finish("solved", t);
    }, RESULTS_DELAY_MS);
  }

  function handleSkip() {
    if (!activeRef.current || done.current) return;
    const t = Date.now();
    done.current = true;
    if (nudge) resolveNudge(nudge, "expired");
    logEvent({ type: "skipped", t });
    finish("skipped", t);
  }

  const wrongAnswers = log.current.events
    .filter((e) => e.type === "attempt" && !e.correct && e.answer)
    .map((e) => e.answer!);
  const stats = sessionStats(history);
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
        <div className="workspace">
          {active ? (
            <ProblemCard
              key={active.uid}
              problem={active.problem}
              number={active.number}
              startedAt={active.startedAt}
              done={finished !== null}
              onAttempt={handleAttempt}
              onSkip={handleSkip}
            />
          ) : (
            <section className="card problem-card problem-loading" aria-busy="true">
              <span className="shimmer-line" />
              <span className="shimmer-line" />
              <p>Getting your first problem ready…</p>
            </section>
          )}
          <TutorChat
            className="workspace-chat"
            sessionId={session?.sessionId ?? null}
            abGroup={session?.abGroup ?? null}
            onNewChat={handleNewChat}
            problem={active?.problem.text ?? ""}
            showExercise={false}
            welcome={WELCOME}
            nudge={nudge}
            nudgeNote={nudgeNote}
            nudgeContext={{ solution: active?.problem.solution, wrongAnswers }}
            onNudgeAnswer={handleNudgeAnswer}
            onReply={handleReply}
            onBusyChange={setChatBusy}
          />
        </div>
        <aside className="sidebar">
          <WebcamFaceMesh onSample={handleEyeSample} />
          <section className="card session-card" aria-labelledby="session-title">
            <h2 id="session-title">Your session</h2>
            <div className="session-stats">
              <div>
                <b>{stats.points}</b>
                <span>points</span>
              </div>
              <div>
                <b>{stats.solved}</b>
                <span>solved</span>
              </div>
              <div>
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
            <p className="session-checkins" data-on={adaptive}>
              <AiSparkle size={12} />
              {session
                ? adaptive
                  ? "AI check-ins on: the tutor offers help when you seem stuck or bored."
                  : "AI check-ins off: standard tutoring doesn't react to your state."
                : "Connecting…"}
            </p>
          </section>
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
          onNext={startProblem}
        />
      )}
    </main>
  );
}
