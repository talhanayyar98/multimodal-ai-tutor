"use client";

import { useEffect, useRef, useState } from "react";
import { fetchHint, sendChat, type ChatTurn } from "@/lib/api";

const PROBLEM =
  "A fair six-sided die is rolled twice. What is the probability that the sum of the two rolls is at least 10?";

const WELCOME =
  "Hey! I'm your tutor for this session. Read the exercise above and tell me how you'd start — or ask me anything. If you get stuck, tap ✦ Hint and I'll nudge you forward.";

type Role = "user" | "tutor" | "hint";

interface Message {
  id: number;
  role: Role;
  text: string;
  state?: string;
}

let nextId = 1; // module scope: ids stay unique across chat resets

export default function TutorChat({
  sessionId,
  abGroup,
  onNewChat,
}: {
  sessionId: string | null;
  abGroup: "adaptive" | "control" | null;
  onNewChat: () => Promise<void>;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // A (re)connected session starts a fresh conversation.
  useEffect(() => {
    if (sessionId) setMessages([{ id: nextId++, role: "tutor", text: WELCOME }]);
  }, [sessionId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

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
    setBusy(true);
    try {
      const res = await sendChat(sessionId, text, recentHistory(), PROBLEM);
      push("tutor", res.reply, res.state);
    } catch {
      push("tutor", "I couldn't reach the server just now — give it a second and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleHint() {
    if (!sessionId || busy) return;
    setBusy(true);
    try {
      const res = await fetchHint(sessionId, PROBLEM);
      push("hint", res.hint, res.state);
    } catch {
      push("tutor", "I couldn't fetch a hint just now — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  function handleReset() {
    setMessages([{ id: nextId++, role: "tutor", text: WELCOME }]);
  }

  async function handleNewChat() {
    setSwitching(true);
    try {
      await onNewChat(); // new sessionId re-seeds the conversation via the effect
    } finally {
      setSwitching(false);
    }
  }

  const ready = Boolean(sessionId);

  return (
    <section className="chat card">
      <div className="chat-head">
        <h2>
          <span className="gold">✦</span> Tutor chat
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
          <button
            className="btn btn-ghost btn-sm"
            data-testid="chat-new"
            onClick={handleNewChat}
            disabled={busy || switching}
            title="Start a completely new session (new A/B assignment, fresh signals)"
          >
            {switching ? "Starting…" : "+ New chat"}
          </button>
        </div>
      </div>

      <div className="exercise">
        <b>Exercise.</b> {PROBLEM}
      </div>

      <div className="chat-messages" data-testid="chat-messages">
        {messages.map((m) => (
          <div key={m.id} className="msg" data-role={m.role}>
            {m.role === "hint" && <span className="msg-tag">✦ hint</span>}
            {m.text}
            {m.state && abGroup === "adaptive" && (
              <span className="msg-meta">tuned to your state: {m.state}</span>
            )}
          </div>
        ))}
        {busy && (
          <div className="typing" aria-label="Tutor is typing">
            <span />
            <span />
            <span />
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="composer">
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
        <button
          className="btn btn-neon"
          data-testid="chat-hint"
          onClick={handleHint}
          disabled={!ready || busy}
          title="Get a hint for the exercise"
        >
          ✦ Hint
        </button>
        <button
          className="btn btn-gold"
          data-testid="chat-send"
          onClick={handleSend}
          disabled={!ready || busy || !input.trim()}
        >
          Send
        </button>
      </div>
    </section>
  );
}
