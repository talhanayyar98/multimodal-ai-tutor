"use client";

import { useEffect, useRef, useState } from "react";
import AiSparkle from "@/components/AiSparkle";
import { ArrowRightIcon } from "@/components/collect/icons";
import NudgeBubble from "@/components/NudgeBubble";
import { fetchHint, fetchNudge, sendChat, type ChatTurn } from "@/lib/api";
import { NUDGE_COPY, type NudgeOffer } from "@/lib/nudges";

const PROBLEM =
  "A fair six-sided die is rolled twice. What is the probability that the sum of the two rolls is at least 10?";

const WELCOME =
  "Hey! I'm your tutor for this session. Read the exercise above and tell me how you'd start — or ask me anything. If you get stuck, tap Hint and I'll nudge you forward.";

// Used where the exercise is shown outside the chat (the /collect pilot).
const WELCOME_EXTERNAL_EXERCISE =
  "I'm your tutor. Stuck or unsure about the current question? Ask me anything, or tap Hint for a nudge.";

type Role = "user" | "tutor" | "hint";
type Pending = "chat" | "hint" | "nudge" | null;

interface Message {
  id: number;
  role: Role;
  text: string;
  state?: string;
  /** Label above a hint bubble (default "Hint"). */
  tag?: string;
  /** A "tutor busy / unreachable, try again" note rather than tutoring. */
  notice?: boolean;
  /** Left out of the history sent to Gemini: notices, and a message that got no answer. */
  offRecord?: boolean;
}

let nextId = 1; // module scope: ids stay unique across chat resets

/**
 * Fades a reply in word by word, the way AI assistants "write" their answers.
 * The words are laid out from the start (only their opacity animates), so the
 * bubble has its final size immediately and auto-scroll stays correct.
 */
function RevealText({ text }: { text: string }) {
  const parts = text.split(/(\s+)/);
  const wordCount = parts.filter((p) => p.trim() !== "").length;
  const stepMs = Math.min(38, 1500 / Math.max(1, wordCount)); // whole reply in ≤ ~1.5 s
  let i = 0;
  return (
    <>
      {parts.map((part, k) =>
        part.trim() === "" ? (
          part
        ) : (
          <span key={k} className="word" style={{ animationDelay: `${Math.round(i++ * stepMs)}ms` }}>
            {part}
          </span>
        ),
      )}
    </>
  );
}

export default function TutorChat({
  sessionId,
  abGroup,
  onNewChat,
  problem = PROBLEM,
  showExercise = true,
  className,
  welcome: welcomeOverride,
  nudge = null,
  nudgeNote = "",
  nudgeContext,
  onNudgeAnswer,
  onReply,
  onBusyChange,
  showStates = true,
}: {
  sessionId: string | null;
  abGroup: "adaptive" | "control" | null;
  /** Omit to hide the "New chat" button (e.g. when the page owns the session). */
  onNewChat?: () => Promise<void>;
  /** The exercise the tutor helps with; a new problem starts a fresh conversation. */
  problem?: string;
  /** false when the page displays the exercise itself. */
  showExercise?: boolean;
  className?: string;
  /** Replaces the opening message (keep it a stable string). */
  welcome?: string;
  /** A state-triggered check-in to show above the input (adaptive group, main page). */
  nudge?: NudgeOffer | null;
  /** Why the tutor is checking in, shown small in the bubble. */
  nudgeNote?: string;
  /** Sent with an accepted check-in so the help fits where the learner is. */
  nudgeContext?: { solution?: string; wrongAnswers: string[] };
  /** The learner answered the check-in; on yes the chat fetches the help itself. */
  onNudgeAnswer?: (offer: NudgeOffer, accepted: boolean) => void;
  /** A tutor reply arrived ("nudge" = help from an accepted check-in). */
  onReply?: (kind: "chat" | "hint" | "nudge", state?: string) => void;
  onBusyChange?: (busy: boolean) => void;
  /** false: no "tuned to your state" tags on replies (study mode). */
  showStates?: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const [switching, setSwitching] = useState(false);
  const [nudgeThinking, setNudgeThinking] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Bumped whenever the conversation restarts, so a reply that arrives for
  // the previous problem or session is dropped instead of landing in the new one.
  const conversation = useRef(0);
  const busy = pending !== null;

  const welcome = welcomeOverride ?? (showExercise ? WELCOME : WELCOME_EXTERNAL_EXERCISE);

  // A (re)connected session or a new exercise starts a fresh conversation.
  useEffect(() => {
    conversation.current++;
    setPending(null);
    if (sessionId) setMessages([{ id: nextId++, role: "tutor", text: welcome }]);
  }, [sessionId, problem, welcome]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending, nudge]);

  useEffect(() => {
    onBusyChange?.(busy);
    // Only report changes, not new callback identities.
  }, [busy]);

  function push(role: Role, text: string, state?: string, tag?: string): number {
    const id = nextId++;
    setMessages((m) => [...m, { id, role, text, state, tag }]);
    return id;
  }

  /**
   * The tutor couldn't help this time (Gemini busy, or the server unreachable).
   * Shown as a plain note, without a state tag, and not reported through
   * onReply, so it never counts as help the learner received.
   */
  function pushNotice(text: string) {
    setMessages((m) => [...m, { id: nextId++, role: "tutor", text, notice: true, offRecord: true }]);
  }

  /** The learner's message got no answer: keep it on screen, but don't send it to Gemini twice. */
  function markUnanswered(id: number, text: string) {
    setMessages((m) => m.map((msg) => (msg.id === id ? { ...msg, offRecord: true } : msg)));
    setInput((current) => current || text); // back in the box, so trying again is one tap
  }

  function recentHistory(): ChatTurn[] {
    return messages
      .filter((m) => !m.offRecord)
      .slice(-8)
      .map((m) => ({
        role: m.role === "user" ? ("student" as const) : ("tutor" as const),
        text: m.text,
      }));
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || !sessionId || busy) return;
    setInput("");
    const history = recentHistory();
    const sentId = push("user", text);
    setPending("chat");
    const conv = conversation.current;
    try {
      const res = await sendChat(sessionId, text, history, problem);
      if (conv !== conversation.current) return;
      if (res.fallback) {
        markUnanswered(sentId, text);
        pushNotice(res.reply);
        return;
      }
      push("tutor", res.reply, res.state);
      onReply?.("chat", res.state);
    } catch {
      if (conv !== conversation.current) return;
      markUnanswered(sentId, text);
      pushNotice("I couldn't reach the server just now. Give it a few seconds, then send your message again.");
    } finally {
      if (conv === conversation.current) setPending(null);
    }
  }

  async function handleHint() {
    if (!sessionId || busy) return;
    setPending("hint");
    const conv = conversation.current;
    try {
      const res = await fetchHint(sessionId, problem);
      if (conv !== conversation.current) return;
      if (res.fallback) {
        pushNotice(res.hint);
        return;
      }
      push("hint", res.hint, res.state);
      onReply?.("hint", res.state);
    } catch {
      if (conv !== conversation.current) return;
      pushNotice("I couldn't reach the server just now. Give it a few seconds, then tap Hint again.");
    } finally {
      if (conv === conversation.current) setPending(null);
    }
  }

  async function handleNudgeAnswer(accepted: boolean) {
    if (!nudge) return;
    const offer = nudge;
    onNudgeAnswer?.(offer, accepted);
    if (!accepted || !sessionId || busy) return;
    const copy = NUDGE_COPY[offer.state];
    push("user", copy.userSays);
    setNudgeThinking(copy.thinking);
    setPending("nudge");
    const conv = conversation.current;
    try {
      const res = await fetchNudge(sessionId, {
        state: offer.state,
        problem,
        solution: nudgeContext?.solution,
        wrongAnswers: nudgeContext?.wrongAnswers ?? [],
      });
      if (conv !== conversation.current) return;
      if (res.fallback) {
        pushNotice(res.reply);
        return;
      }
      push("hint", res.reply, offer.state, copy.tag);
      onReply?.("nudge", offer.state);
    } catch {
      if (conv !== conversation.current) return;
      pushNotice("I couldn't reach the server just now. Give it a few seconds, then tap Hint and I'll try again.");
    } finally {
      if (conv === conversation.current) setPending(null);
    }
  }

  function handleReset() {
    conversation.current++;
    setPending(null);
    setMessages([{ id: nextId++, role: "tutor", text: welcome }]);
  }

  async function handleNewChat() {
    if (!onNewChat) return;
    setSwitching(true);
    try {
      await onNewChat(); // new sessionId re-seeds the conversation via the effect
    } finally {
      setSwitching(false);
    }
  }

  const ready = Boolean(sessionId);

  return (
    <section className={`chat card${className ? ` ${className}` : ""}`}>
      <div className="chat-head">
        <h2>
          <span className="chat-head-mark" aria-hidden="true">
            <AiSparkle size={14} />
          </span>
          Tutor chat
        </h2>
        <div className="chat-actions">
          <button
            className="btn btn-ghost btn-sm"
            data-testid="chat-reset"
            onClick={handleReset}
            disabled={!ready || busy}
            title="Clear the conversation (your session stays the same)"
          >
            Reset chat
          </button>
          {onNewChat && (
            <button
              className="btn btn-ghost btn-sm"
              data-testid="chat-new"
              onClick={handleNewChat}
              disabled={busy || switching}
              title="Start a completely new session (new A/B assignment, fresh signals)"
            >
              {switching ? "Starting…" : "+ New chat"}
            </button>
          )}
        </div>
      </div>

      {showExercise && (
        <div className="exercise">
          <span className="exercise-label">Exercise</span>
          <p className="exercise-problem">{problem}</p>
        </div>
      )}

      <div className="chat-messages" data-testid="chat-messages">
        {messages.map((m) => (
          <div key={m.id} className="msg-row" data-role={m.role}>
            {m.role !== "user" && (
              <span className="msg-avatar" aria-hidden="true">
                <AiSparkle size={15} />
              </span>
            )}
            <div className="msg" data-role={m.role} data-notice={m.notice || undefined}>
              {m.notice && <span className="msg-notice-tag">Tutor busy</span>}
              {m.role === "hint" && (
                <span className="msg-tag">
                  <AiSparkle size={11} /> {m.tag ?? "Hint"}
                </span>
              )}
              {m.role === "user" ? m.text : <RevealText text={m.text} />}
              {m.state && abGroup === "adaptive" && showStates && (
                <span className="msg-meta">tuned to your state: {m.state}</span>
              )}
            </div>
          </div>
        ))}
        {pending && (
          <div className="msg-row" data-role={pending === "chat" ? "tutor" : "hint"}>
            <span className="msg-avatar" data-thinking="true" aria-hidden="true">
              <AiSparkle size={15} />
            </span>
            <div className="msg msg-thinking" data-kind={pending === "chat" ? "chat" : "hint"} role="status">
              <span className="thinking-label">
                {pending === "hint"
                  ? "Finding a hint for you…"
                  : pending === "nudge" && nudgeThinking
                    ? nudgeThinking
                    : "Thinking…"}
              </span>
              <span className="shimmer-line" />
              <span className="shimmer-line" />
              <span className="shimmer-line" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {nudge && <NudgeBubble key={nudge.id} offer={nudge} disabled={busy} note={nudgeNote} onAnswer={handleNudgeAnswer} />}

      <div className="composer">
        <div className="composer-box">
          <textarea
            data-testid="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={ready ? "Type your thinking or a question…" : "Connecting to your session…"}
            rows={1}
            disabled={!ready}
          />
          <div className="composer-actions">
            <button
              className="btn btn-ai"
              data-testid="chat-hint"
              data-loading={pending === "hint"}
              onClick={handleHint}
              disabled={!ready || busy}
              title="Get a hint for the exercise"
            >
              <AiSparkle size={14} /> Hint
            </button>
            <button
              className="btn btn-gold btn-send"
              data-testid="chat-send"
              onClick={handleSend}
              disabled={!ready || busy || !input.trim()}
            >
              Send <ArrowRightIcon size={14} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
