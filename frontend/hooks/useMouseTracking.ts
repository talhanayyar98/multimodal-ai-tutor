"use client";

import { useEffect, useRef } from "react";
import { MouseAccumulator } from "@/lib/mouseSignals";

/**
 * Tracks window-level mouse activity into a MouseAccumulator.
 * Call `.current.flush(windowSeconds)` to read and reset a window's features.
 */
export function useMouseTracking() {
  const accRef = useRef<MouseAccumulator | null>(null);
  if (!accRef.current) accRef.current = new MouseAccumulator();

  useEffect(() => {
    const acc = accRef.current!;
    const onMove = (e: MouseEvent) => acc.move(e.clientX, e.clientY);
    const onDown = () => acc.click();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
    };
  }, []);

  return accRef as React.RefObject<MouseAccumulator>;
}
