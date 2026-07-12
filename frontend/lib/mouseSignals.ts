import type { MouseFeatures } from "./features";

const BUCKET_MS = 500;

/** Aggregates mouse events into per-window features. */
export class MouseAccumulator {
  private travel = 0;
  private speedSum = 0;
  private speedSamples = 0;
  private clicks = 0;
  private activeBuckets = new Set<number>();
  private last: { x: number; y: number; t: number } | null = null;
  private windowStart = Date.now();

  move(x: number, y: number): void {
    const t = Date.now();
    if (this.last) {
      const distance = Math.hypot(x - this.last.x, y - this.last.y);
      const dt = (t - this.last.t) / 1000;
      this.travel += distance;
      if (dt > 0) {
        this.speedSum += distance / dt;
        this.speedSamples += 1;
      }
    }
    this.last = { x, y, t };
    this.activeBuckets.add(Math.floor((t - this.windowStart) / BUCKET_MS));
  }

  click(): void {
    this.clicks += 1;
  }

  /** Returns the window's mouse features and resets for the next window. */
  flush(windowSeconds: number): MouseFeatures {
    const totalBuckets = Math.max(1, Math.round((windowSeconds * 1000) / BUCKET_MS));
    const features: MouseFeatures = {
      mouseTravel: this.travel,
      mouseSpeedMean: this.speedSamples > 0 ? this.speedSum / this.speedSamples : 0,
      clickCount: this.clicks,
      idleRatio: 1 - Math.min(1, this.activeBuckets.size / totalBuckets),
    };
    this.travel = 0;
    this.speedSum = 0;
    this.speedSamples = 0;
    this.clicks = 0;
    this.activeBuckets.clear();
    this.windowStart = Date.now();
    return features;
  }
}
