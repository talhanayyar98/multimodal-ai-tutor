// Copies the MediaPipe wasm runtime out of node_modules and downloads the
// FaceLandmarker model into public/, so the app serves everything same-origin.
// Browser extensions (CORS rewriters, VPN proxies) can mangle cross-origin CDN
// fetches — a corrupted wasm/model loads far enough to init, then aborts at
// the first detect call. Same-origin assets are out of their reach.
// Runs automatically via the frontend "postinstall" script.

import { cpSync, existsSync, mkdirSync, statSync, unlinkSync, createWriteStream } from "node:fs";
import { get } from "node:https";
import path from "node:path";

const root = process.cwd();
const wasmSrc = path.join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const outDir = path.join(root, "public", "mediapipe");
const wasmOut = path.join(outDir, "wasm");
const modelOut = path.join(outDir, "face_landmarker.task");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

mkdirSync(wasmOut, { recursive: true });
cpSync(wasmSrc, wasmOut, { recursive: true });
console.log(`[mediapipe-assets] wasm runtime copied to ${path.relative(root, wasmOut)}`);

if (existsSync(modelOut) && statSync(modelOut).size > 1_000_000) {
  console.log("[mediapipe-assets] face_landmarker.task already present — skipping download");
} else {
  console.log("[mediapipe-assets] downloading face_landmarker.task…");
  await new Promise((resolve, reject) => {
    const file = createWriteStream(modelOut);
    get(MODEL_URL, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`model download failed: HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", reject);
  }).catch((err) => {
    if (existsSync(modelOut)) unlinkSync(modelOut);
    console.error(`[mediapipe-assets] ${err.message} — retry with: npm run postinstall`);
    process.exit(1);
  });
  console.log(`[mediapipe-assets] model saved to ${path.relative(root, modelOut)}`);
}
