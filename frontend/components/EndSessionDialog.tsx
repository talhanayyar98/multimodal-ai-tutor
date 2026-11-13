"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * "End session?" as a real dialog instead of the browser's confirm box.
 * A native <dialog>: it dims the page, keeps keyboard focus inside and closes
 * on Esc or a click outside. "Keep going" is the default, so a stray Enter
 * never ends a session.
 */
export default function EndSessionDialog({
  open,
  busy = false,
  detail,
  onStay,
  onEnd,
}: {
  open: boolean;
  /** Ending is being saved: both buttons wait and the dialog stays open. */
  busy?: boolean;
  /** One line about where the learner is or what comes next. */
  detail?: ReactNode;
  onStay: () => void;
  onEnd: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      stayRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Esc belongs to this dialog while it is open: the tutor's check-in bubble
  // listens for Esc on the window and would count it as "no thanks".
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.stopPropagation();
    };
    dialog.addEventListener("keydown", onKey);
    return () => dialog.removeEventListener("keydown", onKey);
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby="end-dialog-title"
      aria-describedby="end-dialog-text"
      // Esc: stay, unless the ending is already being saved.
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      onClose={onStay}
      // The card fills the dialog, so a click on the dialog itself is a click on the dimmed page.
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onStay();
      }}
      data-testid="end-dialog"
    >
      <div className="dialog-card">
        <span className="dialog-icon" aria-hidden="true">
          👋
        </span>
        <h2 id="end-dialog-title">Wrapping up early?</h2>
        <p id="end-dialog-text">
          No problem at all, and thank you for the time you&apos;ve given. Everything you&apos;ve
          done so far is saved.
        </p>
        {detail && <p className="dialog-detail">{detail}</p>}
        <p className="dialog-note">Once you end, you can&apos;t come back to this session.</p>
        <div className="dialog-actions">
          <button
            ref={stayRef}
            type="button"
            className="btn btn-primary btn-lg"
            onClick={onStay}
            disabled={busy}
            data-testid="end-stay"
          >
            Keep going
          </button>
          <button
            type="button"
            className="btn btn-danger btn-lg"
            onClick={onEnd}
            disabled={busy}
            data-testid="end-confirm"
          >
            {busy ? "Ending…" : "End session"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
