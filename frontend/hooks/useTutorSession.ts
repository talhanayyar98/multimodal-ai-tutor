"use client";

// The tutoring loop shared by the main page (/) and the A/B study (/study):
// random problems one after another, state readings per problem, the
// state-triggered check-ins (adaptive group only), the results after each
// problem, and logging of everything to `problemevents`.
//
// The page owns the camera, the mouse and the signal batcher; it passes every
// inferred state to `handleState`. A problem run starts whenever `session`
// becomes a (new) session, and stops logging when it becomes null.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { logProblemEvent, type ProblemEventBody, type SessionInfo } from "@/lib/api";
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

/** Pause between the "Correct!" moment and the results screen. */
const RESULTS_DELAY_MS = 1100;

export interface ActiveProblem {
  uid: number;
  /** 1-based position in this session. */
  number: number;
  problem: Problem;
  startedAt: number;
}

export interface TutorSessionOptions {
  /** false: the results leave out everything about inferred states (study mode). */
  showStates?: boolean;
  /**
   * A fixed list of problems, served in this order (study mode); none are
   * served after the last one. Omit for endless random problems (main page).
   */
  sequence?: readonly Problem[];
}

export function useTutorSession(
  session: SessionInfo | null,
  { showStates = true, sequence }: TutorSessionOptions = {},
) {
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
    // counter.number = problems started so far, so it indexes the next one.
    const problem = sequence ? sequence[counter.current.number] : nextProblem(recent.current);
    if (!problem) return; // the fixed sequence is used up
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
    const summary = summarize(record, { states: showStates });
    setHistory((h) => [...h, { outcome, stars: summary.stars, points: summary.points }]);
    setFinished({ record, summary });
  }

  // ---------- signals ----------

  const handleState = useCallback((state: string, windowEnd: number) => {
    const a = activeRef.current;
    // Windows that ended before this problem appeared belong to the previous one.
    if (!a || done.current || windowEnd <= a.startedAt) return;
    log.current.readings.push({ t: windowEnd, state });
    bumpLog();
  }, []);

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

  /**
   * The run is over (time limit or "End session"). A problem that is still
   * open is logged as "unfinished", and an open check-in as expired. Call it
   * before the session is taken away, so the events can still be logged.
   */
  function endRun() {
    const a = activeRef.current;
    if (!a || done.current) return;
    const t = Date.now();
    done.current = true;
    if (nudge) resolveNudge(nudge, "expired");
    logEvent({ type: "unfinished", t });
  }

  const wrongAnswers = log.current.events
    .filter((e) => e.type === "attempt" && !e.correct && e.answer)
    .map((e) => e.answer!);

  return {
    active,
    finished,
    history,
    stats: sessionStats(history),
    nudge,
    wrongAnswers,
    /** Length of the fixed sequence; null for endless random problems. */
    total: sequence ? sequence.length : null,
    /** The problem on screen is the sequence's last one. */
    isLast: sequence !== undefined && active !== null && active.number === sequence.length,
    endRun,
    /** Pass to useSignalBatcher's onState. Stable. */
    handleState,
    startProblem,
    handleAttempt,
    handleSkip,
    handleNudgeAnswer,
    handleReply,
    setChatBusy,
  };
}

export type TutorSession = ReturnType<typeof useTutorSession>;
