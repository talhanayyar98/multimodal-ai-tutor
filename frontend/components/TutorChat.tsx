"use client";

import { useEffect, useRef, useState } from "react";
import AiSparkle from "@/components/AiSparkle";
import { ArrowRightIcon } from "@/components/collect/icons";
import { fetchHint, sendChat, type ChatTurn } from "@/lib/api";

const PROBLEM =
  "A fair six-sided die is rolled twice. What is the probability that the sum of the two rolls is at least 10?";

const WELCOME =
  "Hey! I'm your tutor for this session. Read the exercise above and tell me how you'd start — or ask me anything. If you get stuck, tap Hint and I'll nudge you forward.";

// Used where the exercise is shown outside the chat (the /collect pilot).
const WELCOME_EXTERNAL_EXERCISE =
  "I'm your tutor. Stuck or unsure about the current question? Ask me anything, or tap Hint for a nudge.";

type Role = "user" | "tutor" | "hint";
type Pending = "chat" | "hint" | null;

interface Message {
  id: number;
  role: Role;
  text: string;
  state?: string;
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
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const [switching, setSwitching] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = pending !== null;

  const welcome = showExercise ? WELCOME : WELCOME_EXTERNAL_EXERCISE;

  // A (re)connected session or a new exercise starts a fresh conversation.
  useEffect(() => {
    if (sessionId) setMessages([{ id: nextId++, role: "tutor", text: welcome }]);
  }, [sessionId, problem, welcome]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  function push(role: Role, text: string, state?: string) {
    setMessages((m) => [...m, { id: nextId++, role, text, state }]);
  }

  function recentHistory(): ChatTurn[] {
    return messages.slice(-8).map((m) => ({
      role: m.role === "user" ? ("student" as const) : ("tutor" as const),
      text: m.text,
    }));
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || !sessionId || busy) return;
    setInput("");
    push("user", text);
    setPending("chat");
    try {
      const res = await sendChat(sessionId, text, recentHistory(), problem);
      push("tutor", res.reply, res.state);
    } catch {
      push("tutor", "I couldn't reach the server just now — give it a second and try again.");
    } finally {
      setPending(null);
    }
  }

  async function handleHint() {
    if (!sessionId || busy) return;
    setPending("hint");
    try {
      const res = await fetchHint(sessionId, problem);
      push("hint", res.hint, res.state);
    } catch {
      push("tutor", "I couldn't fetch a hint just now — try again in a moment.");
    } finally {
      setPending(null);
    }
  }

  function handleReset() {
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
            title="Clear the conversation, keep the same session and A/B group"
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
            <div className="msg" data-role={m.role}>
              {m.role === "hint" && (
                <span className="msg-tag">
                  <AiSparkle size={11} /> Hint
                </span>
              )}
              {m.role === "user" ? m.text : <RevealText text={m.text} />}
              {m.state && abGroup === "adaptive" && (
                <span className="msg-meta">tuned to your state: {m.state}</span>
              )}
            </div>
          </div>
        ))}
        {pending && (
          <div className="msg-row" data-role={pending === "hint" ? "hint" : "tutor"}>
            <span className="msg-avatar" data-thinking="true" aria-hidden="true">
              <AiSparkle size={15} />
            </span>
            <div className="msg msg-thinking" data-kind={pending} role="status">
              <span className="thinking-label">
                {pending === "hint" ? "Finding a hint for you…" : "Thinking…"}
              </span>
              <span className="shimmer-line" />
              <span className="shimmer-line" />
              <span className="shimmer-line" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

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
