import type { EyeFeatures } from "./features";

export interface GazePoint {
  x: number;
  y: number;
}

export interface EyeSample {
  faceDetected: boolean;
  /** 0 = fully closed, 1 = fully open — eyelid distance (eye-aspect-ratio), normalized. */
  eyeOpenness: number;
  /** Iris center offset from the outer eye corner (landmarks 33 / 263), in units of eye width. */
  irisLeft: GazePoint | null;
  irisRight: GazePoint | null;
  /** Iris position inside the eye's bounding box, -1..1 per axis (0 = looking straight ahead). */
  gazeLeft: GazePoint | null;
  gazeRight: GazePoint | null;
  /** Nose-tip position in normalized image coordinates. */
  nose: GazePoint | null;
}

const BLINK_THRESHOLD = 0.3;

/** Aggregates per-frame FaceMesh samples into per-window eye features. */
export class EyeAccumulator {
  private frames = 0;
  private faceFrames = 0;
  private opennessSum = 0;
  private blinkCount = 0;
  private eyesClosed = false;
  // Combined (both-eye average) gaze samples, used for the dispersion feature.
  private gazeX: number[] = [];
  private gazeY: number[] = [];
  // Per-eye gaze samples, averaged into the gazeLeft*/gazeRight* features.
  private gazeLX: number[] = [];
  private gazeLY: number[] = [];
  private gazeRX: number[] = [];
  private gazeRY: number[] = [];
  private lastNose: GazePoint | null = null;
  private noseTravel = 0;

  add(sample: EyeSample): void {
    this.frames += 1;
    if (!sample.faceDetected) {
      this.eyesClosed = false;
      this.lastNose = null;
      return;
    }
    this.faceFrames += 1;
    this.opennessSum += sample.eyeOpenness;

    const closed = sample.eyeOpenness < BLINK_THRESHOLD;
    if (closed && !this.eyesClosed) this.blinkCount += 1;
    this.eyesClosed = closed;

    if (sample.gazeLeft) {
      this.gazeLX.push(sample.gazeLeft.x);
      this.gazeLY.push(sample.gazeLeft.y);
    }
    if (sample.gazeRight) {
      this.gazeRX.push(sample.gazeRight.x);
      this.gazeRY.push(sample.gazeRight.y);
    }
    const eyes = [sample.gazeLeft, sample.gazeRight].filter((g): g is GazePoint => g !== null);
    if (eyes.length > 0) {
      this.gazeX.push(eyes.reduce((acc, g) => acc + g.x, 0) / eyes.length);
      this.gazeY.push(eyes.reduce((acc, g) => acc + g.y, 0) / eyes.length);
    }

    if (sample.nose) {
      if (this.lastNose) {
        this.noseTravel += Math.hypot(
          sample.nose.x - this.lastNose.x,
          sample.nose.y - this.lastNose.y,
        );
      }
      this.lastNose = sample.nose;
    }
  }

  /** Returns the window's eye features and resets for the next window. */
  flush(windowSeconds: number): EyeFeatures {
    const features: EyeFeatures = {
      facePresence: this.frames > 0 ? this.faceFrames / this.frames : 0,
      avgEyeOpenness: this.faceFrames > 0 ? this.opennessSum / this.faceFrames : 0,
      blinkRate: this.blinkCount / windowSeconds,
      gazeDispersion: std(this.gazeX) + std(this.gazeY),
      gazeLeftX: mean(this.gazeLX),
      gazeLeftY: mean(this.gazeLY),
      gazeRightX: mean(this.gazeRX),
      gazeRightY: mean(this.gazeRY),
      headMovement: this.noseTravel,
    };
    this.frames = 0;
    this.faceFrames = 0;
    this.opennessSum = 0;
    this.blinkCount = 0;
    this.gazeX = [];
    this.gazeY = [];
    this.gazeLX = [];
    this.gazeLY = [];
    this.gazeRX = [];
    this.gazeRY = [];
    this.noseTravel = 0;
    return features;
  }
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length);
}
