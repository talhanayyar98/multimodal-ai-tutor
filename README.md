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

## Collecting training data (`/collect`)

The LSTM needs ground-truth labels. The pilot page at
**http://localhost:3000/collect** collects them: one participant per browser
tab, about 35 minutes including the forms.

1. **Consent:** what is and isn't recorded (placeholder wording; replace it
   with your approved consent text).
2. **Background questions:** age, gender, studies, field, probability
   background, math confidence, English comfort, glasses/contacts, mouse vs
   trackpad, alertness. **No name.** The participant gets a code (P001, P002, …)
   and you keep the code ↔ person list yourself.
3. **Camera check:** waits until the face has been tracked for 3 s, and
   explains the check-in options.
4. **Exercises:** a 2-question warm-up, then four 7-minute probability blocks,
   each designed to make one state likely:

   | Block       | Questions                                    | Designed to bring out |
   | ----------- | -------------------------------------------- | --------------------- |
   | `routine`   | trivially easy, repetitive, endless          | boredom               |
   | `practice`  | moderate (dice sums, complements, …)         | engagement            |
   | `puzzles`   | counter-intuitive (Monty Hall, base rates, …) | confusion             |
   | `challenge` | hard multi-step, 2-min limit, 2 attempts     | frustration           |

   Labels come **only** from the check-ins, never from the block. Block order
   rotates through a balanced Latin square (participant 1, 2, 3, 4 each get a
   different order), so a state isn't tied to early or late in the session.
   Participants only see "Part 2 of 4". The tutor chat is available
   throughout, in `control` mode (no state conditioning).
5. **Check-ins:** about every 90 s (±15 %) a pop-up asks how they feel:
   engaged / confused / bored / frustrated / none of these (`neutral`).
6. **End survey:** how well the options fit (1–5), distractions, comments,
   then a debrief.

The exercise bank is in `frontend/lib/exercises.ts`; every answer key was
checked by brute-force enumeration.

**Researcher URL options:** `?test` marks a test run. `?probe=<s>` sets the
check-in interval and `?block=<s>` the block length. Any of the three gives
the participant a **T-code** (T001…) and `isTest: true`, on a separate
counter, so test runs never shift real participants' numbering or block
rotation. Example: `/collect?probe=10&block=20` runs the whole flow in about
2 minutes.

### What is stored (MongoDB, database `adaptive-tutor`)

| Collection       | One document per…       | Contents |
| ---------------- | ----------------------- | -------- |
| `participants`   | participant             | code, consent time, background answers, browser/screen info, block order, status (`completed` / `ended-early`), end-survey answers, `isTest` |
| `sessions`       | participant session     | `mode: "pilot"`, `abGroup: "control"`, `participantId` |
| `signalbatches`  | 5-second window         | the 13 face + mouse features (`vector`, same as the live model) + `extras: { keyCount, deleteCount }` (counts only, never the keys) |
| `selfreports`    | answered check-in       | state, `promptedAt`, `answeredAt`, and the block + exercise on screen |
| `exerciseevents` | thing that happened     | stage start/end, question shown (text + correct answer), each attempt (answer + correct), skip, timeout, tab hidden/visible, session end |
| `chatmessages`, `hints` | tutor message    | as in the main app |

No video, images or audio are stored. The camera image never leaves the
browser. All timestamps used for alignment (`windowStart`/`windowEnd`,
`promptedAt`, `t`) are client epoch ms on the same clock. A label is matched
to the windows that ended **before** its `promptedAt`, so answering the
pop-up never leaks into its own input.

> Before running real participants: the tutor chat goes through the Gemini
> API, and the free tier may not be used for EEA users. Enable billing on the
> key first.

### Synthetic pilot data (for building the training pipeline)

`backend/scripts/seed-mock-pilot.ts` fills the database with generated test
participants (T-codes, `isTest: true`, **`synthetic: true`**) in exactly the
shape `/collect` writes, so training code can be written before real
sessions exist. Each one runs the real session timeline with the real exercise
bank and answer checker. A hidden learning state drives the face/mouse
features, answers, tutor use and noisy check-ins. Routine drifts towards
bored, puzzles towards confused, and the timed challenge towards frustrated,
with per-person baselines.

```bash
cd backend
npm run seed:mock                        # T-codes up to T100 (default)
npm run seed:mock -- --until 150         # more participants
npm run seed:mock -- --reset             # replace earlier synthetic data
npm run seed:mock -- --reset --until 0   # delete synthetic data only
```

A model trained on this data only learns the generator's rules, so use it
to test the pipeline, not to report results. Exclude it from real training and
analysis with `{ synthetic: { $ne: true } }` on `participants`.

## API summary

| Endpoint                      | Description                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `POST /api/session` (backend) | new session, random A/B group → `{ sessionId, abGroup, mode, persisted }`; body `{ mode: "pilot", participantId }` for a pilot session (always `control`) |
| `POST /api/participants`      | `{ consent, intake, environment, settings, isTest }` → `{ participantId, blockOrder }` |
| `POST /api/participants/:id/finish` | `{ status, post }` → marks the participant completed / ended early |
| `POST /api/self-report`       | `{ sessionId, state, promptedAt, answeredAt, blockId?, exerciseId? }` → one check-in label |
| `POST /api/exercise-events`   | `{ sessionId, type, t, … }` → one exercise event (pilot endpoints return 503 without MongoDB) |
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
