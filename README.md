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

Open http://localhost:3000, allow camera access, and solve problems. Each one
is drawn at random from a mixed bank (`frontend/lib/problems.ts`: arithmetic,
percentages, fractions, algebra, patterns, geometry, logic puzzles,
probability; warm-up → brain teaser) so that different states actually occur.
Signal batches leave every 5 s; the header shows the latest inferred state and
**Hint** fetches a hint.

- **Check-ins (adaptive group only):** when two readings in a row (≈10 s) say
  confused, bored or frustrated, the tutor offers help in a bubble above the
  chat input: a hint, a more interesting retelling, or small steps. On "yes",
  `POST /api/nudge` asks Gemini for that kind of help. Rules (cooldown, max per
  problem, expiry) are in `frontend/lib/nudges.ts`.
- **Results:** after each solved (or skipped) problem a dialog shows stars,
  points, the inferred state over time with hints and answers marked, the
  state mix before vs after the first hint, and a moment-by-moment table; then
  the next problem starts. Hints never cost points, so the score doesn't
  discourage accepting help.

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
| `POST /api/session` (backend) | new session → `{ sessionId, abGroup, mode, persisted }`. Body `{}`: demo session (main page, random group). `{ mode: "study", participantId }`: the study participant's fixed group (404 unknown participant, 409 once they finished, 503 without MongoDB). `{ mode: "pilot", participantId }`: pilot session (always `control`) |
| `POST /api/study/participants` | `{ consent: true, isTest? }` → `{ participantId, testForms: { pre, post } }` (LRN001…, ST001… for test runs); draws the participant's group and test order once (503 without MongoDB) |
| `POST /api/study/participants/:id/stage` | `{ stage: consent\|pretest\|camera\|tutoring\|posttest, note? }` → records reaching a later stage (same stage again is a no-op; going back or after finishing → 409) |
| `POST /api/study/participants/:id/test-answers` | `{ test: pre\|post, itemId, position, answer, dontKnow, correct, skill, mirrors, shownAt, answeredAt }` → one quiz answer (only at that test's stage, only items of the participant's form; a repeat of the same item is ignored) |
| `POST /api/study/participants/:id/finish` | `{ status: completed\|ended-early }` → final status (`completed` only from the last stage; 409 once finished) |
| `POST /api/participants`      | `{ consent, intake, environment, settings, isTest }` → `{ participantId, blockOrder }` |
| `POST /api/participants/:id/finish` | `{ status, post }` → marks the participant completed / ended early |
| `POST /api/self-report`       | `{ sessionId, state, promptedAt, answeredAt, blockId?, exerciseId? }` → one check-in label |
| `POST /api/exercise-events`   | `{ sessionId, type, t, … }` → one exercise event (pilot endpoints return 503 without MongoDB) |
| `POST /api/signals` (backend) | 5 s batch in, stored + forwarded to ML → `{ ok, state }`                                    |
| `GET /api/hint/:sessionId`    | ML state + Gemini hint → `{ hint, state, abGroup }` (`?problem=…`)                          |
| `POST /api/chat/:sessionId`   | `{ message, history, problem }` → state-conditioned tutor reply `{ reply, state, abGroup }` |
| `POST /api/nudge/:sessionId`  | `{ state: confused\|bored\|frustrated, problem, solution?, wrongAnswers? }` → help for an accepted check-in `{ reply, state }` (403 for control sessions; stored in `hints` with `kind: "nudge"`) |
| `POST /api/problem-events`    | `{ sessionId, type, t, problemId, … }` → main-page problem flow (shown, attempt, hint, chat, nudge-offered/accepted/dismissed/expired, nudge, solved, skipped, unfinished) into `problemevents`; 202 without MongoDB |
| `POST /infer` (ml-service)    | `{ features: number[][] }` → `{ state, probs }`                                             |

**A/B groups** — `adaptive`: the Gemini prompt includes the inferred cognitive
state, and check-ins are offered; `control`: the same prompt without any state
conditioning, no check-ins. Sessions, signal batches, and hints are all
persisted with their group.

**Session modes** — every session has a `mode`:

| Mode    | Where       | Group                                   | Participant |
| ------- | ----------- | --------------------------------------- | ----------- |
| `demo`  | `/`         | coin flip per session ("New chat" re-draws) | none — never analysed |
| `study` | `/study`    | fixed per participant (between-subjects) | LRN001… in `studyparticipants` |
| `pilot` | `/collect`  | always `control`                        | P001… in `participants` |

Study groups use **permuted blocks of 4** (`backend/src/allocation.ts`): each run
of 4 participants holds 2 adaptive + 2 control in random order, stored in
`allocationblocks` when the block's first participant joins. The groups never
differ by more than 2, and the next assignment can't be guessed. Test runs
(ST-codes) have their own counter and blocks, so they never use up a real slot.
Study participants live in their own collection so `train.py` (which reads
`participants`) can never train on them.

Sessions stored before modes existed (no `mode` field) are read as `demo`.

## The A/B study (`/study`)

**http://localhost:3000/study** is the participant flow: consent → pre-test →
camera check → tutoring → post-test → done (about 35 minutes). The camera
check sits right before the tutoring so the camera keeps running into it.
Researcher-only URL options:

- `?test`: your own trial runs (ST001… codes, `isTest: true`).
- `?limit=<seconds>`: a shorter time limit (10–3600 s) to try the time-up
  ending. Always a test run, so it can't shorten a real participant's session.

What the study page does:

- **Codes:** the participant code (LRN001, LRN002, …) is created when they
  agree on the consent screen, and their group and test order are drawn at
  that moment. No names and no background questions.
- **Pre-/post-test** (`frontend/lib/studyTests.ts`) for learning gain: two
  matched forms, A and B, of 8 questions. Each question mirrors one tutoring
  problem where help is actually needed (#5–#12: algebra, fractions, discount,
  triangle, pairs, bat-and-ball, doubling, Monty Hall) with different numbers
  and story; the warm-ups are left out (near ceiling). Half of each group does
  A before and B after, half the reverse (`testOrder` "AB" / "BA", balanced
  inside every allocation block), so form difficulty can't look like a group
  effect. The tests sit outside the intervention: identical for both groups,
  no tutor, no hints, no feedback, no going back, no time limit; "I don't
  know" moves on and counts as not correct. Scored with the tutoring's answer
  checker (decimal commas like `0,917` work; fractions have explicit
  tolerances). Each answer is stored in `testanswers` (raw answer, correct,
  time on the question, the skill and the tutoring problem it mirrors, so a
  check-in on that problem can be linked to its test item); the participant
  keeps a `pretest` / `posttest` summary (`form`, `answered`, `correct`,
  `dontKnow`), recounted from `testanswers` after every answer.
- **Same task for everyone** (`frontend/lib/studyTask.ts`): the same 12
  problems in the same order, with fixed numbers: 4 warm-ups, 5 medium,
  3 brain teasers. The tutoring ends after the last problem or after
  **20 minutes**, whichever comes first. Participants see "Problem 3 of 12"
  but no countdown, to avoid extra time pressure. The list is frozen
  (separate from the demo's random bank); change it only between studies.
- **Tutoring:** the same problem loop as `/` (`frontend/hooks/useTutorSession.ts`),
  but nothing reveals the group or the inferred states: no state/group badges,
  no "New chat", no state chart in the results, no "tuned to your state" tags.
  The adaptive group still gets the check-in bubbles; they are the intervention.
- **Ending the tutoring:** after problem 12 the results button says "Finish".
  At the time limit, or when the participant presses "End session", a problem
  that is still open is logged as `unfinished` (and an open check-in as
  `nudge-expired`). Last problem or time limit → the post-test, whose
  `progress` entry notes `all-done` or `time-up`; finishing the post-test →
  `completed`. "End session" (in the tutoring or in either quiz) →
  `ended-early`, with no post-test.
- **Progress:** each participant has a `status` (`in-progress` → `completed`
  or `ended-early`), the furthest `stage` reached, and a `progress` log of
  when each stage was reached (`tutoring` notes whether the camera check passed
  or was skipped, `posttest` how the tutoring ended). Someone who closes the
  tab stays `in-progress`. Stages only move forward, and `completed` is only
  accepted from the last stage (`posttest`).
- **Everything by code:** `testanswers`, `signalbatches`, `problemevents`,
  `hints` and `chatmessages` carry the `participantId`, so
  `{ participantId: "LRN007" }` finds all of one person's data.
- **For the analysis:** keep `studyparticipants` with `status: "completed"` and
  `isTest: false`. Keep the others in the database too: a different drop-out
  rate per group is worth reporting.

The consent text is a placeholder until the supervisor / JYU ethics process
approves it (`frontend/components/study/StudyConsent.tsx`).

## Graceful degradation

The end-to-end flow works before anything real is plugged in:

- no `GEMINI_API_KEY` → deterministic placeholder hints
- no MongoDB → in-memory sessions + signal buffers (nothing persisted)
- ml-service down → state falls back to `"unknown"`, hints still generate
- camera denied → eye features are zeros, mouse features still flow

## Training the model

`ml-service/train.py` trains `CognitiveStateLSTM` on the `/collect` check-ins.
It is a separate command, run when there is new data: `npm run dev` never trains,
it only loads the run named by `MODEL_RUN` (below). A run takes about 30 s on the
synthetic data.

```bash
npm run train -- --data synthetic   # generated test participants: pipeline check only
npm run train                       # real participants (P-codes): the default
```

- **Examples:** one example per check-in. The input is the 12 windows (one
  minute × 13 features) that ended before the pop-up; the label is the state the
  person reported. `neutral` answers are dropped.
- **Preprocessing** (`ml-service/preprocess.py`): log1p on mouse travel, speed
  and clicks, then standardization with the training set's mean/std.
- **Training:** Adam with class-weighted cross-entropy. Training stops early on
  the macro-F1 of held-out participants.
- **Evaluation:** 5-fold cross-validation split by participant, so every score
  comes from people the model never saw. In each fold about a fifth of the people
  are test people; 15% of the rest are validation people (only used to decide when
  to stop) and the model learns from the remaining ones. It is compared with three
  baselines: always guessing the most common state, guessing from the session
  part, and logistic regression on the minute's averages.
- **Final model:** the same recipe on all participants (15% of them as
  validation people, nobody held out for testing). This is the model the app loads.
- **Settings:** folds, validation share, epochs, patience, batch size and
  learning rate are constants at the top of `train.py`.
- **Output:** `ml-service/runs/<time>-<data>/` with `model.pt`, `scaler.json`,
  `metrics.json`, `report.md`, `dataset.npz`, `cv_predictions.npz` and
  `report.html`. The same seed gives the same results.
- **Report page:** `report.html` is a self-contained page (opens offline) that
  shows the run visually: the data, who trains / validates / tests in each fold,
  the training curves, the scores against the baselines, the confusion matrix and
  single check-ins with the model's four probabilities. It is built by
  `ml-service/visualize.py` from `ml-service/report_template.html`; to rebuild it
  for a run: `cd ml-service && .venv/bin/python visualize.py runs/<run>`.

### Using a trained model in the app

The ML service runs the model set by `MODEL_RUN`, a run directory from
`train.py`. It is read from the environment or from `ml-service/.env` (see
`ml-service/.env.example`):

```bash
# ml-service/.env
MODEL_RUN=runs/20261108-132029-synthetic
```

- **Restart needed:** restart the service after changing it (`--reload` only watches `.py` files).
- **Preprocessing:** `model.pt` is always loaded together with its `scaler.json` and applied with the same
  preprocessing as in training (last 12 windows, log1p, standardization).
- **Fails loudly:** missing files, a different feature order, states or layer shapes, or the
  old `MODEL_WEIGHTS` setting stop the service at startup instead of producing wrong predictions.
- **Unset:** the untrained placeholder runs (its states are meaningless).
- **Model info:** `/health` and every `/infer` response include `model: { name, data, trained }`.
  The main page shows it: a **DEMO** tag on the state badge for a model
  trained on synthetic data, **UNTRAINED** for the placeholder, and a "Model:"
  line in the "How this works" card.
