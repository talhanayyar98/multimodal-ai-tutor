"use client";

// A/B study (between-subjects):
//   consent → pre-test → camera check → tutoring → NASA-TLX → SUS → post-test → done.
//
// The participant gets a code (LRN001…) when they agree; their group and test
// order are drawn at that moment (balanced blocks of 4, see
// backend/src/allocation.ts). From then on the group is shown in the header
// as a read-only badge ("Group A · Adaptive tutor" / "Group B · Standard
// tutor"): it comes from the server and nothing on this page can change it.
// - Pre-/post-test (lib/studyTests.ts): two matched forms, A before and B
//   after or the reverse, balanced within each group. Outside the
//   intervention: no tutor, no feedback, identical for both groups.
// - Tutoring: the main page's loop (useTutorSession) on a fixed task — the
//   same 12 problems in the same order, ending after the last one or at the
//   time limit (lib/studyTask.ts) — without anything that reveals the
//   inferred states; the adaptive group still gets the check-in bubbles,
//   since they are the intervention. The camera check comes right before it,
//   so the camera keeps running from the check into the tutoring.
// - NASA-TLX (raw) and SUS about the tutoring (lib/studyQuestionnaires.ts),
//   right after it: TLX belongs right after the task, and neither rating
//   should be coloured by how the post-test went.
// Each stage and the final status are stored with the participant, so the
// analysis can keep only status "completed".
//
// Researcher-only URL options:
//   ?test             test run: ST-code + isTest: true, with its own counter
//                     and group blocks, so it never uses up a real slot.
//   ?limit=<seconds>  shorter time limit (10–3600 s) to try the time-up
//                     ending; always a test run, so it can't touch real data.

import { useCallback, useEffect, useRef, useState } from "react";
import AppHeader from "@/components/AppHeader";
import DoneStep from "@/components/collect/DoneStep";
import { ExitIcon, LockIcon, ShieldIcon } from "@/components/collect/icons";
import SetupStep from "@/components/collect/SetupStep";
import EndSessionDialog from "@/components/EndSessionDialog";
import ProblemResults from "@/components/results/ProblemResults";
import SessionCard from "@/components/SessionCard";
import StudyConsent from "@/components/study/StudyConsent";
import StudyQuestionnaire from "@/components/study/StudyQuestionnaire";
import StudyStepper from "@/components/study/StudyStepper";
import StudyTest from "@/components/study/StudyTest";
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
  type NewStudyParticipant,
  type SessionInfo,
} from "@/lib/api";
import { EyeAccumulator, type EyeSample } from "@/lib/eyeSignals";
import type { Features } from "@/lib/features";
import { STUDY_PROBLEMS, STUDY_TIME_LIMIT_MS } from "@/lib/studyTask";
import { TEST_FORMS } from "@/lib/studyTests";

type Step = "consent" | "pretest" | "camera" | "tutoring" | "tlx" | "sus" | "posttest" | "done";
/** How the tutoring ended: every problem done, time limit reached, or "End session". */
type TutoringEnd = "all-done" | "time-up" | "ended-early";

/** Shown small in the check-in bubble (adaptive group). No model details in the study. */
const NUDGE_NOTE = "Based on your face and mouse signals over the last ~10 s.";

/** How the header names the two groups. */
const GROUP: Record<SessionInfo["abGroup"], { letter: string; name: string }> = {
  adaptive: { letter: "A", name: "Adaptive tutor" },
  control: { letter: "B", name: "Standard tutor" },
};

const END_TITLE: Record<TutoringEnd, string> = {
  "all-done": "That was the last problem",
  "time-up": "Time's up",
  "ended-early": "Ending the session",
};

const DONE_NOTE = {
  "all-done": `You worked through all ${STUDY_PROBLEMS.length} problems and both quizzes. Thank you for trying the tutor!`,
  "time-up":
    "You finished both quizzes. Time ran out before the last problem, and that's completely fine. Thank you for trying the tutor!",
  "ended-early": "You ended the session early; everything up to that point is saved. Thank you for taking part!",
};

/** Where the participant is, for the "End session?" dialog (the tutoring adds its problem number). */
const WHERE: Partial<Record<Step, string>> = {
  pretest: "You're in the first quiz.",
  tlx: "You're on the feedback questions.",
  sus: "You're on the feedback questions.",
  posttest: "You're in the last quiz, the final step.",
};

export default function StudyPage() {
  const [step, setStep] = useState<Step>("consent");
  const [isTest, setIsTest] = useState(false);
  const [timeLimitMs, setTimeLimitMs] = useState(STUDY_TIME_LIMIT_MS);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [testForms, setTestForms] = useState<NewStudyParticipant["testForms"] | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [starting, setStarting] = useState(false);
  const [tutoringStartedAt, setTutoringStartedAt] = useState<number | null>(null);
  const [tutoringEnd, setTutoringEnd] = useState<TutoringEnd | null>(null);
  const [endedEarly, setEndedEarly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [endDialog, setEndDialog] = useState(false);
  const [ending, setEnding] = useState(false);
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
  // pre-test, camera check), so the first stored window covers only its own 5 s.
  useEffect(() => {
    if (!tutoringActive) return;
    eyeAcc.current!.flush(5);
    mouseAcc.current.flush(5);
  }, [tutoringActive, mouseAcc]);

  // A reload would lose the session (the participant would stay "in-progress") — ask first.
  const inProgress = step !== "consent" && step !== "done";
  useEffect(() => {
    if (!inProgress) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [inProgress]);

  // ---------- steps ----------

  async function handleAgree() {
    setStarting(true);
    setError(null);
    try {
      // A retry after a failed start keeps the code that was already created.
      let pid = participantId;
      if (!pid) {
        const created = await createStudyParticipant(isTest);
        pid = created.participantId;
        setParticipantId(pid);
        setTestForms(created.testForms);
      }
      setSession(await startStudySession(pid));
      await setStudyStage(pid, "pretest");
      setStep("pretest");
    } catch (err) {
      setError(`Could not start the session (${(err as Error).message}). Please tell the researcher.`);
    } finally {
      setStarting(false);
    }
  }

  // StudyTest shows its own "Try again" if this throws.
  async function handlePretestDone() {
    if (!participantId) return;
    await setStudyStage(participantId, "camera");
    setStep("camera");
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

  // After the tutoring: on to the questionnaires (the note says how the
  // tutoring ended), or straight to the end for "End session".
  async function saveTutoringEnd(how: TutoringEnd) {
    if (!participantId) return;
    setSaving(true);
    setError(null);
    try {
      if (how === "ended-early") {
        await finishStudyParticipant(participantId, "ended-early");
        setEndedEarly(true);
        setStep("done");
      } else {
        await setStudyStage(participantId, "tlx", how);
        setStep("tlx");
      }
    } catch (err) {
      setError(`Could not save your progress (${(err as Error).message}). Please tell the researcher.`);
    } finally {
      setSaving(false);
    }
  }

  // Ends the tutoring exactly once, however it ends.
  const ended = useRef(false);
  function endTutoring(how: TutoringEnd) {
    if (ended.current) return;
    ended.current = true;
    setEndDialog(false); // e.g. time ran out while "End session?" was open
    tutor.endRun(); // logs an open problem as "unfinished" while the session is still attached
    setTutoringEnd(how);
    void saveTutoringEnd(how);
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

  // The questionnaire shows the error (and keeps the answers) if these throw.
  async function handleTlxDone() {
    if (!participantId) return;
    await setStudyStage(participantId, "sus");
    setStep("sus");
  }

  async function handleSusDone() {
    if (!participantId) return;
    await setStudyStage(participantId, "posttest");
    setStep("posttest");
  }

  // StudyTest shows its own "Try again" if this throws.
  async function handlePosttestDone() {
    if (!participantId) return;
    await finishStudyParticipant(participantId, "completed");
    setStep("done");
  }

  // "End session" was confirmed in the dialog. The tutoring closes its run
  // first (and shows its own "saving" card); elsewhere the dialog waits.
  async function handleEndConfirmed() {
    if (tutoringActive) {
      endTutoring("ended-early");
      return;
    }
    if (!participantId || ending) return;
    setEnding(true);
    setError(null);
    try {
      await finishStudyParticipant(participantId, "ended-early");
      setEndedEarly(true);
      setStep("done");
    } catch (err) {
      setError(`Could not end the session (${(err as Error).message}). Please tell the researcher.`);
    } finally {
      setEnding(false);
      setEndDialog(false);
    }
  }

  const askToEnd = useCallback(() => setEndDialog(true), []);
  const stay = useCallback(() => setEndDialog(false), []);

  const withCamera = step === "camera" || step === "tutoring";
  const doneNote = endedEarly ? DONE_NOTE["ended-early"] : DONE_NOTE[tutoringEnd === "time-up" ? "time-up" : "all-done"];
  const group = session ? GROUP[session.abGroup] : null;
  const onProblem = tutoringActive && tutor.active && tutor.total ? { number: tutor.active.number, total: tutor.total } : null;
  const where = onProblem ? `You're on problem ${onProblem.number} of ${onProblem.total}.` : WHERE[step];

  return (
    <main className="page study" data-step={step} data-layout={withCamera ? "wide" : "narrow"}>
      <AppHeader subtitle="MSc thesis study · University of Jyväskylä">
        {isTest && (
          <span className="badge badge-test" title="Test run: stored with an ST-code and isTest: true">
            Test run
          </span>
        )}
        {participantId && (
          <span className="badge" title="Your participant code" data-testid="participant-code">
            Participant <b>{participantId}</b>
          </span>
        )}
        {session && group && (
          <span
            className="badge badge-group"
            data-group={session.abGroup}
            data-fixed="true"
            title="Your group was drawn at random when you joined. It stays the same for the whole session and can't be changed."
            data-testid="group-badge"
          >
            <span className="badge-group-letter" aria-hidden="true">
              {group.letter}
            </span>
            Group {group.letter} · {group.name}
            <LockIcon size={13} />
          </span>
        )}
      </AppHeader>

      {/* After "End session" there is no finished journey to show. */}
      {!(step === "done" && endedEarly) && (
        <StudyStepper
          step={step}
          tutoringMinutes={timeLimitMs / 60_000}
          problem={onProblem}
          compact={withCamera}
        />
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {step === "consent" && <StudyConsent busy={starting} onAgree={handleAgree} />}

      {step === "pretest" && participantId && testForms && (
        <StudyTest
          test="pre"
          items={TEST_FORMS[testForms.pre]}
          participantId={participantId}
          onDone={handlePretestDone}
          onEndSession={askToEnd}
        />
      )}

      {withCamera && (
        <div className="columns">
          {step === "camera" ? (
            <div className="collect-main">
              <SetupStep getFaceStreakMs={getFaceStreakMs} onDone={handleCameraDone} />
            </div>
          ) : tutoringEnd ? (
            <div className="collect-main">
              <section className="card collect-card" data-testid="tutoring-end">
                <p className="eyebrow">Tutoring finished</p>
                <h2>{END_TITLE[tutoringEnd]}</h2>
                <p>{saving || !error ? "Saving your session…" : "Your session could not be saved yet."}</p>
                {error && !saving && (
                  <div className="collect-actions">
                    <button
                      className="btn btn-primary"
                      onClick={() => void saveTutoringEnd(tutoringEnd)}
                      data-testid="save-retry"
                    >
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
              <ShieldIcon size={14} />
              <span>The camera image stays on this computer — only numbers computed from it are saved.</span>
            </p>
            {tutoringActive && (
              <>
                <SessionCard stats={tutor.stats} history={tutor.history} />
                <button className="btn btn-ghost btn-sm end-session" onClick={askToEnd} data-testid="end-session">
                  <ExitIcon size={13} /> End session
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

      {(step === "tlx" || step === "sus") && participantId && (
        <StudyQuestionnaire
          key={step}
          kind={step}
          participantId={participantId}
          onDone={step === "tlx" ? handleTlxDone : handleSusDone}
          onEndSession={askToEnd}
        />
      )}

      {step === "posttest" && participantId && testForms && (
        <StudyTest
          test="post"
          items={TEST_FORMS[testForms.post]}
          participantId={participantId}
          onDone={handlePosttestDone}
          onEndSession={askToEnd}
        />
      )}

      {step === "done" && <DoneStep participantId={participantId} note={<p>{doneNote}</p>} />}

      <EndSessionDialog
        open={endDialog}
        busy={ending}
        detail={where}
        onStay={stay}
        onEnd={() => void handleEndConfirmed()}
      />
    </main>
  );
}
