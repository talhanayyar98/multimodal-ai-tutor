# Multimodal Adaptive AI Tutor

MSc thesis prototype (University of Jyväskylä): a tutoring UI that streams webcam
(MediaPipe FaceMesh) and mouse signals to a backend, classifies the learner's
cognitive-affective state with an LSTM, and adapts Gemini-generated hints to it.

```
┌────────────────────┐  5 s signal batches   ┌───────────────────┐   feature sequence   ┌───────────────────┐
│  frontend :3000    │ ────────────────────▶ │  backend :5000    │ ───────────────────▶ │  ml-service :8000 │
│  Next.js           │                       │  Express + Mongo  │ ◀─────────────────── │  FastAPI + LSTM   │
│  FaceMesh + mouse  │ ◀──────────────────── │  + Gemini hints   │    cognitive state   │  (placeholder)    │
└────────────────────┘    adaptive hints     └───────────────────┘                      └───────────────────┘
```

| Folder        | Stack                            | Port |
| ------------- | -------------------------------- | ---- |
| `frontend/`   | Next.js (TypeScript, App Router) | 3000 |
| `backend/`    | Node.js + Express (TypeScript)   | 5000 |
| `ml-service/` | Python + FastAPI + PyTorch       | 8000 |

## Prerequisites

- **Node.js ≥ 20** — this repo has an `.nvmrc`, so `nvm use` picks the right version
- **Python ≥ 3.10** (3.12 recommended; `python3.12` is preferred automatically if on PATH)
- **MongoDB** (optional) — without it the backend falls back to in-memory storage
- **Gemini API key** (optional) — without it hints are deterministic placeholders

## First-time setup

```bash
nvm use                # or otherwise make sure `node -v` is >= 20

# 1. Root tooling (concurrently)
npm install

# 2. All three services in one go...
npm run install:all

# ...or manually:
#   cd frontend   && npm install
#   cd backend    && npm install
#   cd ml-service && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt

# 3. Backend environment
cp backend/.env.example backend/.env
# then edit backend/.env: set MONGODB_URI and GEMINI_API_KEY (both optional)
```

## Run everything

```bash
npm run dev
```

This uses `concurrently` to start all three services:

- frontend → http://localhost:3000
- backend → http://127.0.0.1:5000
- ml-service → http://127.0.0.1:8000 (uses `ml-service/.venv/bin/uvicorn`, so the venv must exist)

Open http://localhost:3000, allow camera access, and work on the exercise.
Signal batches leave every 5 s; the header shows the latest inferred state and
"Get a hint" fetches a state-adapted hint.

> **macOS note:** AirPlay Receiver also listens on port 5000, which is why the
> backend binds `127.0.0.1` specifically (that coexists with AirPlay). If you
> still get a port conflict, set `PORT` in `backend/.env` and
> `BACKEND_INTERNAL_URL` for the frontend proxy.

**Same-origin by design:** the browser only ever talks to the Next server —
`/api/*` is proxied to the backend (rewrite in `frontend/next.config.ts`), and
the MediaPipe wasm runtime + FaceLandmarker model are served from
`frontend/public/mediapipe/` (populated automatically by the frontend
`postinstall` script). No cross-origin requests and no CDN fetches means
browser extensions (CORS rewriters, VPN proxies, ad blockers) cannot corrupt
the wasm/model or block API calls. Set `NEXT_PUBLIC_BACKEND_URL` only if you
want the browser to call the backend directly.

## Data flow

1. **frontend** — `WebcamFaceMesh` runs MediaPipe FaceLandmarker per frame
   (blink/gaze blendshapes + nose-tip landmark); `useMouseTracking` records
   cursor activity. `useSignalBatcher` aggregates both into a 13-dim feature
   vector every 5 s and POSTs it to `POST /api/signals`.
2. **backend** — validates the batch, stores it in MongoDB, keeps the last 12
   windows per session as the LSTM input sequence, and forwards them to the ML
   service. `GET /api/hint/:sessionId` re-infers the current state and asks
   Gemini for a hint conditioned on it (adaptive group) or not (control group).
3. **ml-service** — `POST /infer` feeds the `(1, seq_len, 13)` tensor through an
   **untrained** LSTM and returns one of `engaged | confused | bored | frustrated`
   with class probabilities. The classification is meaningless until real
   weights are dropped in — but the shapes and the wire format are final.

### Feature vector (order matters)

Defined in `frontend/lib/features.ts`; length is checked in
`backend/src/routes.ts` and `ml-service/model.py`.

| #   | Feature          | Description                                           |
| --- | ---------------- | ----------------------------------------------------- |
| 0   | `facePresence`   | fraction of frames with a detected face (0–1)         |
| 1   | `avgEyeOpenness` | mean eyelid openness from eye-aspect-ratio (0–1)      |
| 2   | `blinkRate`      | blinks per second (eyelid distance below threshold)   |
| 3   | `gazeDispersion` | std of iris-based gaze (x + y) — scanning vs fixation |
| 4   | `gazeLeftX`      | mean left-iris position in the eye box, -1..1         |
| 5   | `gazeLeftY`      | (uncalibrated gaze-direction estimate, per eye)       |
| 6   | `gazeRightX`     | mean right-iris position in the eye box, -1..1        |
| 7   | `gazeRightY`     |                                                       |
| 8   | `headMovement`   | nose-tip travel, normalized image units               |
| 9   | `mouseTravel`    | cursor distance (px)                                  |
| 10  | `mouseSpeedMean` | mean cursor speed (px/s)                              |
| 11  | `clickCount`     | mouse-down events in the window                       |
| 12  | `idleRatio`      | fraction of window without mouse movement (0–1)       |

Iris landmarks come from `face_landmarker.task` (478-point mesh with iris
refinement always enabled — indices 468/473 are the right/left iris centers).
Gaze is the iris position normalized inside the eye's corner-to-corner box
(landmarks 33/133 and 263/362), with no on-screen calibration.

## Pilot mode: collecting training labels

The LSTM needs ground-truth labels. Pilot sessions collect them with
experience-sampling check-ins:

```
http://localhost:3000/?pilot=P01            # P01 = participant id (letters, digits, - or _)
http://localhost:3000/?pilot=P01&probe=10   # 10 s check-ins — only for testing the pop-up
```

- About every 90 s (±15 % jitter, timed from the previous answer), a pop-up asks
  "which best describes how you feel about the task?" — *engaged, confused,
  bored, frustrated* or *none of these* (stored as `neutral`).
- Answers go to the `selfreports` collection with `participantId`,
  `promptedAt` and `answeredAt` (client epoch ms, the same clock as the signal
  windows' `windowStart`/`windowEnd`). A label is meant to be trained on the
  windows that ended **before** `promptedAt`, so answering the pop-up never
  leaks into its own input. Intervals under ~77 s make answering one check-in
  leak into the next label's 60 s input, so the badge tooltip marks them
  "testing only".
- Pilot sessions are always `control` (no state-conditioned tutoring — the
  model is still untrained) and stored with `mode: "pilot"`, so they can be
  excluded from the A/B analysis. The live state badge is hidden so it can't
  anchor the answers.
- MongoDB is required: the page shows a warning if the backend has no DB
  connection, and the header badge counts saved check-ins.

## API summary

| Endpoint                      | Description                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `POST /api/session` (backend) | new session, random A/B group → `{ sessionId, abGroup, mode, persisted }`; body `{ mode: "pilot", participantId }` for a pilot session |
| `POST /api/self-report`       | `{ sessionId, state, promptedAt, answeredAt }` → stores one check-in label (503 without MongoDB) |
| `POST /api/signals` (backend) | 5 s batch in, stored + forwarded to ML → `{ ok, state }`                                    |
| `GET /api/hint/:sessionId`    | ML state + Gemini hint → `{ hint, state, abGroup }` (`?problem=…`)                          |
| `POST /api/chat/:sessionId`   | `{ message, history, problem }` → state-conditioned tutor reply `{ reply, state, abGroup }` |
| `POST /infer` (ml-service)    | `{ features: number[][] }` → `{ state, probs }`                                             |

**A/B groups** — assigned randomly at session start. `adaptive`: the Gemini
prompt includes the inferred cognitive state; `control`: the same prompt without
any state conditioning. Sessions, signal batches, and hints are all persisted
with their group for later analysis.

## Graceful degradation

The end-to-end flow works before anything real is plugged in:

- no `GEMINI_API_KEY` → deterministic placeholder hints
- no MongoDB → in-memory sessions + signal buffers (nothing persisted)
- ml-service down → state falls back to `"unknown"`, hints still generate
- camera denied → eye features are zeros, mouse features still flow

## Swapping in the trained LSTM

1. Train `CognitiveStateLSTM` (see `ml-service/model.py`) — keep `FEATURE_DIM`,
   `STATES`, and the layer shapes, or update them consistently in all three
   services.
2. Save the weights: `torch.save(model.state_dict(), "weights.pt")`
3. Point the service at them: `MODEL_WEIGHTS=weights.pt npm run dev` (or export
   it before starting uvicorn).
