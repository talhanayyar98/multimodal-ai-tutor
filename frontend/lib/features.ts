// Canonical feature-vector contract. The order below must match FEATURE_DIM
// checks in backend/src/routes.ts and ml-service/model.py.
export const FEATURE_ORDER = [
  "facePresence", // fraction of frames with a detected face (0–1)
  "avgEyeOpenness", // mean eyelid openness from eye-aspect-ratio (0–1)
  "blinkRate", // blinks per second
  "gazeDispersion", // std of iris-based gaze (x + y) — visual scanning vs fixation
  "gazeLeftX", // mean left-iris position in the eye box, -1..1 (uncalibrated)
  "gazeLeftY",
  "gazeRightX", // mean right-iris position in the eye box, -1..1 (uncalibrated)
  "gazeRightY",
  "headMovement", // nose-tip travel in normalized image units
  "mouseTravel", // cursor distance in px
  "mouseSpeedMean", // mean cursor speed in px/s
  "clickCount", // mouse-down events in the window
  "idleRatio", // fraction of the window with no mouse movement (0–1)
] as const;

export type FeatureName = (typeof FEATURE_ORDER)[number];
export type Features = Record<FeatureName, number>;

export type EyeFeatures = Pick<
  Features,
  | "facePresence"
  | "avgEyeOpenness"
  | "blinkRate"
  | "gazeDispersion"
  | "gazeLeftX"
  | "gazeLeftY"
  | "gazeRightX"
  | "gazeRightY"
  | "headMovement"
>;
export type MouseFeatures = Pick<
  Features,
  "mouseTravel" | "mouseSpeedMean" | "clickCount" | "idleRatio"
>;

export function toVector(features: Features): number[] {
  return FEATURE_ORDER.map((name) => features[name]);
}
