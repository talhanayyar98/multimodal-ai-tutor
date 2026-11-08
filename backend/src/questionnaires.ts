// Validation and scoring of the study's questionnaires (wording and order:
// frontend/lib/studyQuestionnaires.ts). Scores are computed here, not in the
// page, so every stored score follows the same rules.
import { SUS_ITEM_COUNT, TLX_SCALES } from "./models";

export type TlxScale = (typeof TLX_SCALES)[number];
export type TlxAnswers = Record<TlxScale, number>;

/**
 * Raw TLX (Hart, 2006): the six ratings, each 0–100 in steps of 5, and their
 * unweighted mean. Returns null if any rating is missing or off the scale.
 */
export function scoreTlx(raw: unknown): (TlxAnswers & { raw: number }) | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).length !== TLX_SCALES.length) return null;
  const out = {} as TlxAnswers;
  for (const scale of TLX_SCALES) {
    const v = r[scale];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 100 || v % 5 !== 0) return null;
    out[scale] = v;
  }
  const mean = TLX_SCALES.reduce((sum, s) => sum + out[s], 0) / TLX_SCALES.length;
  return { ...out, raw: Math.round(mean * 100) / 100 };
}

/**
 * SUS (Brooke, 1996): ten 1–5 answers. Odd items count (answer − 1), even
 * items (5 − answer); the sum × 2.5 gives 0–100. Returns null if any answer
 * is missing or off the scale.
 */
export function scoreSus(raw: unknown): { items: number[]; score: number } | null {
  if (!Array.isArray(raw) || raw.length !== SUS_ITEM_COUNT) return null;
  if (!raw.every((v) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5)) return null;
  const items = raw as number[];
  const sum = items.reduce((s, v, i) => s + (i % 2 === 0 ? v - 1 : 5 - v), 0);
  return { items, score: sum * 2.5 };
}
