"use client";

import { useEffect, useRef, useState } from "react";
import { postSignals, type ModelInfo } from "@/lib/api";
import { toVector, type Features } from "@/lib/features";

export const BATCH_INTERVAL_MS = 5000;

/**
 * Every 5 s, collects the current window's features and POSTs them to the backend.
 * `collectExtras` (optional, must be stable) adds per-window values that are
 * logged but not part of the model's feature vector. `onState` (optional)
 * hears every inferred state with its window's end time.
 */
export function useSignalBatcher(
  sessionId: string | null,
  collect: (windowSeconds: number) => Features,
  collectExtras?: () => Record<string, number>,
  onState?: (state: string, windowEnd: number) => void,
) {
  const [lastState, setLastState] = useState<string | null>(null);
  const [batchesSent, setBatchesSent] = useState(0);
  const [model, setModel] = useState<ModelInfo | null>(null);
  // A ref, so a new callback identity doesn't restart the 5-second timer.
  const onStateRef = useRef(onState);
  useEffect(() => {
    onStateRef.current = onState;
  });

  useEffect(() => {
    if (!sessionId) return;
    const interval = setInterval(async () => {
      const windowEnd = Date.now();
      const features = collect(BATCH_INTERVAL_MS / 1000);
      try {
        const { state, model } = await postSignals({
          sessionId,
          windowStart: windowEnd - BATCH_INTERVAL_MS,
          windowEnd,
          features,
          vector: toVector(features),
          extras: collectExtras?.(),
        });
        setLastState(state);
        setModel(model ?? null);
        setBatchesSent((n) => n + 1);
        onStateRef.current?.(state, windowEnd);
      } catch {
        // Backend unreachable — drop this window, the next one will retry.
      }
    }, BATCH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [sessionId, collect, collectExtras]);

  return { lastState, batchesSent, model };
}
