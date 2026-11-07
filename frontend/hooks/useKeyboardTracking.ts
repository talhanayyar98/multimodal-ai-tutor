"use client";

import { useEffect, useRef } from "react";
import { KeyboardAccumulator } from "@/lib/keyboardSignals";

/** Tracks window-level key presses into a KeyboardAccumulator (counts only). */
export function useKeyboardTracking() {
  const accRef = useRef<KeyboardAccumulator | null>(null);
  if (!accRef.current) accRef.current = new KeyboardAccumulator();

  useEffect(() => {
    const acc = accRef.current!;
    const onKey = (e: KeyboardEvent) => acc.key(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return accRef as React.RefObject<KeyboardAccumulator>;
}
