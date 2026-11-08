"use client";

import ProblemCard from "@/components/ProblemCard";
import TutorChat from "@/components/TutorChat";
import type { TutorSession } from "@/hooks/useTutorSession";
import type { SessionInfo } from "@/lib/api";

const WELCOME =
  "Hi! I'm your tutor. Type your answer in the box above, or talk it through with me here. Tap Hint whenever you like.";

/** The problem card + tutor chat of the tutoring loop (used by / and /study). */
export default function TutorWorkspace({
  tutor,
  session,
  onNewChat,
  nudgeNote,
  showStates = true,
}: {
  tutor: TutorSession;
  session: SessionInfo | null;
  /** Omit to hide the chat's "New chat" button. */
  onNewChat?: () => Promise<void>;
  /** Why the tutor is checking in, shown small in the check-in bubble. */
  nudgeNote: string;
  /** false: no "tuned to your state" tags on the chat replies (study mode). */
  showStates?: boolean;
}) {
  const { active, finished } = tutor;
  return (
    <div className="workspace">
      {active ? (
        <ProblemCard
          key={active.uid}
          problem={active.problem}
          number={active.number}
          startedAt={active.startedAt}
          done={finished !== null}
          onAttempt={tutor.handleAttempt}
          onSkip={tutor.handleSkip}
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
        onNewChat={onNewChat}
        problem={active?.problem.text ?? ""}
        showExercise={false}
        welcome={WELCOME}
        nudge={tutor.nudge}
        nudgeNote={nudgeNote}
        nudgeContext={{ solution: active?.problem.solution, wrongAnswers: tutor.wrongAnswers }}
        onNudgeAnswer={tutor.handleNudgeAnswer}
        onReply={tutor.handleReply}
        onBusyChange={tutor.setChatBusy}
        showStates={showStates}
      />
    </div>
  );
}
