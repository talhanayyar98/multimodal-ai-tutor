"use client";

import { useEffect, useState } from "react";
import { postSignals } from "@/lib/api";
import { toVector, type Features } from "@/lib/features";

export const BATCH_INTERVAL_MS = 5000;

/**
 * Every 5 s, collects the current window's features and POSTs them to the backend.
 * `collectExtras` (optional, must be stable) adds per-window values that are
 * logged but not part of the model's feature vector.
 */
export function useSignalBatcher(
  sessionId: string | null,
  collect: (windowSeconds: number) => Features,
  collectExtras?: () => Record<string, number>,
) {
  const [lastState, setLastState] = useState<string | null>(null);
  const [batchesSent, setBatchesSent] = useState(0);

  useEffect(() => {
    if (!sessionId) return;
    const interval = setInterval(async () => {
      const windowEnd = Date.now();
      const features = collect(BATCH_INTERVAL_MS / 1000);
      try {
        const { state } = await postSignals({
          sessionId,
          windowStart: windowEnd - BATCH_INTERVAL_MS,
          windowEnd,
          features,
          vector: toVector(features),
          extras: collectExtras?.(),
        });
        setLastState(state);
        setBatchesSent((n) => n + 1);
      } catch {
        // Backend unreachable — drop this window, the next one will retry.
      }
    }, BATCH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [sessionId, collect, collectExtras]);

  return { lastState, batchesSent };
}
