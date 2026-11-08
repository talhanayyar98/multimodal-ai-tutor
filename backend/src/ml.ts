const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://127.0.0.1:8000";

/** Which model produced a prediction (ml-service/predictor.py). */
export interface ModelInfo {
  /** The training run's directory name, or "untrained". */
  name: string;
  /** What it was trained on: "synthetic" | "real"; null for the untrained placeholder. */
  data: string | null;
  trained: boolean;
}

export interface InferResult {
  state: string;
  probs: Record<string, number>;
  model?: ModelInfo;
}

export async function inferState(vectors: number[][]): Promise<InferResult> {
  const res = await fetch(`${ML_SERVICE_URL}/infer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ features: vectors }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`ML service responded ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as InferResult;
}
