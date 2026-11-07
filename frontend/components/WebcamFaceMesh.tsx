"use client";

import { useEffect, useRef, useState } from "react";
import type { FaceLandmarker, FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import type { EyeSample } from "@/lib/eyeSignals";

// Served same-origin from public/mediapipe/ (populated by the frontend
// postinstall script) so browser extensions and VPN proxies can never mangle
// the wasm runtime or the model the way they can with cross-origin CDN fetches.
const WASM_BASE_URL = "/mediapipe/wasm";
const MODEL_URL = "/mediapipe/face_landmarker.task";

// Canonical indices in the 478-point face mesh. face_landmarker.task ships
// with iris refinement built in (the tasks-vision equivalent of the legacy
// face_mesh `refineLandmarks: true`), so points 468–477 are always present:
// 468 = right iris center (ring 469–472), 473 = left iris center (474–477).
// "Left"/"right" are the subject's left/right, not the mirrored preview's.
const LM = {
  noseTip: 1,
  right: { outer: 33, inner: 133, upperLid: 159, lowerLid: 145, iris: 468 },
  left: { outer: 263, inner: 362, upperLid: 386, lowerLid: 374, iris: 473 },
} as const;

const LANDMARK_COUNT_WITH_IRIS = 478;
const OPEN_EAR = 0.3; // typical eye-aspect-ratio when the eye is fully open

type Delegate = "CPU" | "GPU";

// MediaPipe's wasm runtime prints informational TensorFlow Lite messages
// ("INFO: Created TensorFlow Lite XNNPACK delegate for CPU.") to stderr, which
// lands in console.error. Next.js's dev overlay then reports an "issue" whose
// code frame points at detectForVideo on every page load, even though nothing
// failed. Demote exactly those lines to console.info; real errors pass through.
declare global {
  interface Window {
    __tfliteInfoFilterInstalled?: boolean;
  }
}

const TFLITE_INFO_RE = /^INFO: (Created TensorFlow Lite|Initialized TensorFlow Lite)/;

if (typeof window !== "undefined" && !window.__tfliteInfoFilterInstalled) {
  window.__tfliteInfoFilterInstalled = true; // survive HMR without double-wrapping
  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && TFLITE_INFO_RE.test(args[0])) {
      console.info(...args);
      return;
    }
    originalError(...args);
  };
}

// The MediaPipe wasm runtime tolerates neither concurrent initialization (React
// Strict Mode runs effects twice in dev, racing two graph inits) nor being
// closed while a detect call is in flight — both abort inside detectForVideo.
// So the landmarker is created once per page load and shared by every mount.
let landmarkerPromise: Promise<FaceLandmarker> | null = null;
let landmarkerDelegate: Delegate | null = null;

function getLandmarker(delegate: Delegate): Promise<FaceLandmarker> {
  if (!landmarkerPromise || landmarkerDelegate !== delegate) {
    landmarkerDelegate = delegate;
    landmarkerPromise = (async () => {
      const { FilesetResolver, FaceLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
      return FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
      });
    })();
    landmarkerPromise.catch(() => {
      landmarkerPromise = null; // failed init (e.g. offline) may be retried on remount
    });
  }
  return landmarkerPromise;
}

type Status = "loading" | "running" | "paused" | "camera-denied" | "error";

export default function WebcamFaceMesh({
  onSample,
}: {
  onSample: (sample: EyeSample) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onSampleRef = useRef(onSample);
  onSampleRef.current = onSample;
  const [status, setStatus] = useState<Status>("loading");
  const [lastError, setLastError] = useState<string | null>(null);
  const [faceVisible, setFaceVisible] = useState(false);
  const [trackingOn, setTrackingOn] = useState(true);
  const faceVisibleRef = useRef(false);
  // If the wasm graph aborts mid-detection, we rebuild it from scratch once —
  // on the GPU delegate instead of XNNPACK/CPU — before declaring eye
  // tracking dead. Bumping `attempt` re-runs the effect.
  const [attempt, setAttempt] = useState(0);
  const retriedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let stream: MediaStream | null = null;
    let landmarker: FaceLandmarker | null = null;

    if (!trackingOn) {
      setStatus("paused");
      setFaceVisible(false);
      faceVisibleRef.current = false;
      return;
    }
    setStatus("loading");

    function recoverOrFail(err: unknown) {
      console.error("[webcam] FaceMesh detection failed:", err, {
        userAgent: navigator.userAgent,
        attempt,
      });
      setLastError(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      landmarkerPromise = null;
      try {
        landmarker?.close();
      } catch {
        // an aborted wasm instance may refuse to close — nothing left to free
      }
      if (!retriedRef.current) {
        retriedRef.current = true;
        console.warn("[webcam] rebuilding the FaceMesh pipeline once (GPU delegate)…");
        setStatus("loading");
        setAttempt((a) => a + 1);
      } else {
        setStatus("error");
      }
    }

    async function start() {
      try {
        landmarker = await getLandmarker(attempt === 0 ? "CPU" : "GPU");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720 },
        });
        const video = videoRef.current;
        if (cancelled || !video) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        setStatus("running");

        // Rasterize frames through a 2D canvas before detection: real cameras
        // (Continuity Camera in particular) deliver GPU-backed frames in
        // formats the wasm importer has aborted on; drawImage normalizes
        // everything to plain RGBA.
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("2D canvas context unavailable");

        let lastVideoTime = -1;
        let lastTimestamp = -1;
        const loop = () => {
          if (cancelled || !landmarker) return;
          const timestamp = performance.now();
          if (
            video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            video.videoWidth > 0 &&
            video.currentTime !== lastVideoTime &&
            timestamp > lastTimestamp // detectForVideo needs strictly increasing timestamps
          ) {
            lastVideoTime = video.currentTime;
            lastTimestamp = timestamp;
            let sample: EyeSample;
            try {
              if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
              }
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              sample = toEyeSample(landmarker.detectForVideo(canvas, timestamp));
            } catch (err) {
              // Never let a wasm hiccup crash the app: rebuild once, else stop
              // eye tracking while mouse features keep flowing (eyes stay zeros).
              recoverOrFail(err);
              return;
            }
            onSampleRef.current(sample);
            if (sample.faceDetected !== faceVisibleRef.current) {
              faceVisibleRef.current = sample.faceDetected;
              setFaceVisible(sample.faceDetected);
            }
          }
          rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "NotAllowedError") {
          console.error("[webcam] camera permission denied:", err);
          setStatus("camera-denied");
        } else {
          recoverOrFail(err);
        }
      }
    }

    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((track) => track.stop());
      // The shared landmarker intentionally stays alive for the next mount.
    };
  }, [attempt, trackingOn]);

  const statusText: Record<Status, string> = {
    loading: "Starting FaceMesh…",
    running: faceVisible ? "Eye tracking active" : "Looking for your face…",
    paused: "Eye tracking paused — features are zeros",
    "camera-denied": "Camera denied — eye features are zeros",
    // The raw MediaPipe error can be dozens of lines; it's in the console and the tooltip.
    error: "Face tracking failed — eye features are zeros",
  };
  const statusTitle = status === "error" ? (lastError ?? undefined) : undefined;

  return (
    <div className="webcam card" data-tracked={status === "running" && faceVisible}>
      <div className="webcam-frame">
        <video ref={videoRef} muted playsInline className="webcam-video" />
        {status === "running" && (
          <>
            <span className="webcam-chip webcam-live">
              <span className="dot" />
              live
            </span>
            <span className="webcam-chip webcam-face" data-on={faceVisible} data-testid="webcam-face">
              {faceVisible ? "Face locked" : "No face"}
            </span>
          </>
        )}
        {status !== "running" && (
          <div className="webcam-overlay" title={statusTitle}>
            {statusText[status]}
          </div>
        )}
      </div>
      <div className="webcam-bar">
        <span data-testid="webcam-status" title={statusTitle}>
          {statusText[status]}
        </span>
        <button
          className="btn btn-ghost btn-sm"
          data-testid="webcam-toggle"
          onClick={() => setTrackingOn((on) => !on)}
          title={trackingOn ? "Stop the camera and eye tracking" : "Restart the camera and eye tracking"}
        >
          {trackingOn ? "Pause" : "Resume"}
        </button>
      </div>
    </div>
  );
}

interface Point {
  x: number;
  y: number;
}

interface EyeMetrics {
  /** Iris center offset from the outer corner, in units of eye width. */
  iris: Point;
  /** Iris position inside the eye's bounding box, clamped to -1..1 per axis. */
  gaze: Point;
  /** Eye aspect ratio: eyelid distance / eye width. */
  ear: number;
}

function eyeMetrics(
  landmarks: readonly Point[],
  eye: typeof LM.left | typeof LM.right,
): EyeMetrics | null {
  const outer = landmarks[eye.outer];
  const inner = landmarks[eye.inner];
  const upper = landmarks[eye.upperLid];
  const lower = landmarks[eye.lowerLid];
  const iris = landmarks[eye.iris];

  const width = Math.hypot(inner.x - outer.x, inner.y - outer.y);
  if (width < 1e-6) return null; // degenerate detection

  const ear = Math.hypot(upper.x - lower.x, upper.y - lower.y) / width;

  // Horizontal gaze: iris x normalized across the corner-to-corner span.
  const minX = Math.min(outer.x, inner.x);
  const maxX = Math.max(outer.x, inner.x);
  const gx = 2 * ((iris.x - minX) / (maxX - minX)) - 1;
  // Vertical gaze: iris y normalized between the eyelids. The lid gap is tiny
  // and collapses during blinks, so fall back to 0 when it's too small.
  const lidSpan = lower.y - upper.y;
  const gy = lidSpan > width * 0.12 ? 2 * ((iris.y - upper.y) / lidSpan) - 1 : 0;

  return {
    iris: { x: (iris.x - outer.x) / width, y: (iris.y - outer.y) / width },
    gaze: { x: clamp(gx), y: clamp(gy) },
    ear,
  };
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function toEyeSample(result: FaceLandmarkerResult): EyeSample {
  const landmarks = result.faceLandmarks[0];
  if (!landmarks) {
    return {
      faceDetected: false,
      eyeOpenness: 0,
      irisLeft: null,
      irisRight: null,
      gazeLeft: null,
      gazeRight: null,
      nose: null,
    };
  }

  const hasIris = landmarks.length >= LANDMARK_COUNT_WITH_IRIS;
  const left = hasIris ? eyeMetrics(landmarks, LM.left) : null;
  const right = hasIris ? eyeMetrics(landmarks, LM.right) : null;

  let eyeOpenness: number;
  if (left || right) {
    const ear = ((left?.ear ?? right!.ear) + (right?.ear ?? left!.ear)) / 2;
    eyeOpenness = Math.max(0, Math.min(1, ear / OPEN_EAR));
  } else {
    // Shouldn't happen with face_landmarker.task, but fall back to blendshapes.
    const scores = new Map(
      (result.faceBlendshapes[0]?.categories ?? []).map((c) => [c.categoryName, c.score]),
    );
    eyeOpenness = 1 - ((scores.get("eyeBlinkLeft") ?? 0) + (scores.get("eyeBlinkRight") ?? 0)) / 2;
  }

  return {
    faceDetected: true,
    eyeOpenness,
    irisLeft: left?.iris ?? null,
    irisRight: right?.iris ?? null,
    gazeLeft: left?.gaze ?? null,
    gazeRight: right?.gaze ?? null,
    nose: { x: landmarks[LM.noseTip].x, y: landmarks[LM.noseTip].y },
  };
}
