// Endpoints for the /study A/B study. A study participant gets a code and a
// group once; every session they start (POST /api/session with mode "study")
// then uses that group. Progress is tracked per participant: the furthest
// stage reached (with timestamps) and a status, so the analysis can keep only
// status "completed". Everything here needs MongoDB (503 otherwise): study
// data that can't be tied to its participant and group is useless.
import { Router, type Response } from "express";
import { assignGroup } from "./allocation";
import { dbReady } from "./db";
import { Counter, STUDY_STAGES, StudyParticipant, TESTS, TestAnswer, type StudyStage } from "./models";
import { scoreSus, scoreTlx } from "./questionnaires";

export const studyRouter = Router();

const LAST_STAGE = STUDY_STAGES[STUDY_STAGES.length - 1];

studyRouter.post("/study/participants", async (req, res) => {
  if (!requireDb(res)) return;
  const { consent, isTest } = req.body ?? {};
  if (consent !== true) {
    res.status(400).json({ error: "consent is required" });
    return;
  }

  // Test runs get their own ST-codes, counter and allocation blocks, so they
  // never shift the real participants' (LRN) numbering or group balance.
  const test = isTest === true;
  let participantId: string;
  let testForms: { pre: string; post: string };
  try {
    const counter = await Counter.findOneAndUpdate(
      { _id: test ? "study-test-participant" : "study-participant" },
      { $inc: { seq: 1 } },
      { upsert: true, new: true },
    );
    const seq = counter.seq;
    participantId = `${test ? "ST" : "LRN"}${String(seq).padStart(3, "0")}`;
    const { abGroup, testOrder, block } = await assignGroup(seq, test);
    testForms = { pre: testOrder[0], post: testOrder[1] };
    const now = new Date();
    await StudyParticipant.create({
      participantId,
      seq,
      isTest: test,
      abGroup,
      allocationBlock: block,
      testOrder,
      pretest: { form: testForms.pre, answered: 0, correct: 0, dontKnow: 0 },
      posttest: { form: testForms.post, answered: 0, correct: 0, dontKnow: 0 },
      stage: "consent",
      progress: [{ stage: "consent", at: now }],
      consentAt: now,
    });
  } catch (err) {
    console.warn("[db] failed to store study participant:", (err as Error).message);
    res.status(500).json({ error: "participant not stored" });
    return;
  }
  // The group is deliberately not returned here: the participant's sessions
  // carry it, and the study page never shows it. The test forms are needed to
  // show the right questions (and say nothing about the group).
  res.status(201).json({ participantId, testForms });
});

// One answered pre-/post-test question (scored by the page with the same
// checker as the tutoring; the raw answer is kept so it can be re-scored).
// Only accepted while the participant is at that test's stage. A repeated
// answer to the same question is ignored: the first one counts.
studyRouter.post("/study/participants/:participantId/test-answers", async (req, res) => {
  if (!requireDb(res)) return;
  const { participantId } = req.params;
  const b = req.body ?? {};
  const dontKnow = b.dontKnow === true;
  if (
    !(TESTS as readonly unknown[]).includes(b.test) ||
    typeof b.itemId !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(b.itemId) ||
    !Number.isInteger(b.position) ||
    b.position < 1 ||
    b.position > 50 ||
    typeof b.dontKnow !== "boolean" ||
    typeof b.correct !== "boolean" ||
    (dontKnow && b.correct) ||
    (!dontKnow && (typeof b.answer !== "string" || !b.answer.trim() || b.answer.length > 200)) ||
    !isEpochMs(b.shownAt) ||
    !isEpochMs(b.answeredAt) ||
    b.answeredAt < b.shownAt
  ) {
    res.status(400).json({
      error:
        "expected { test: pre | post, itemId, position, answer (unless dontKnow), dontKnow: boolean, " +
        "correct: boolean (false for dontKnow), skill?, mirrors?, shownAt, answeredAt >= shownAt }",
    });
    return;
  }
  const test = b.test as (typeof TESTS)[number];
  try {
    const participant = await StudyParticipant.findOne(
      { participantId },
      { status: 1, stage: 1, testOrder: 1 },
    ).lean();
    if (!participant) {
      res.status(404).json({ error: "unknown study participant" });
      return;
    }
    const stage = test === "pre" ? "pretest" : "posttest";
    if (participant.status !== "in-progress" || participant.stage !== stage) {
      res.status(409).json({ error: `not at the ${stage} (status ${participant.status}, stage ${participant.stage})` });
      return;
    }
    const form = participant.testOrder[test === "pre" ? 0 : 1];
    // Item ids are "<form>-<skill>" (frontend/lib/studyTests.ts): refuse a question from the other form.
    if (!b.itemId.startsWith(`${form}-`)) {
      res.status(400).json({ error: `${b.itemId} is not in form ${form}, this participant's ${test}-test` });
      return;
    }
    try {
      await TestAnswer.create({
        participantId,
        test,
        form,
        itemId: b.itemId,
        skill: text(b.skill, 32),
        mirrors: text(b.mirrors, 64),
        position: b.position,
        answer: dontKnow ? "" : b.answer.trim(),
        dontKnow,
        correct: dontKnow ? false : b.correct,
        shownAt: b.shownAt,
        answeredAt: b.answeredAt,
      });
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      res.json({ ok: true, duplicate: true }); // a retried request: the first answer counts
      return;
    }
    // Recount instead of incrementing, so the summary can't drift from the answers.
    const mine = { participantId, test };
    const [answered, correct, dontKnowCount] = await Promise.all([
      TestAnswer.countDocuments(mine),
      TestAnswer.countDocuments({ ...mine, correct: true }),
      TestAnswer.countDocuments({ ...mine, dontKnow: true }),
    ]);
    await StudyParticipant.updateOne(
      { participantId },
      { $set: { [`${stage}.answered`]: answered, [`${stage}.correct`]: correct, [`${stage}.dontKnow`]: dontKnowCount } },
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.warn("[db] failed to store test answer:", (err as Error).message);
    res.status(500).json({ error: "answer not stored" });
  }
});

// The participant reached a later stage of the flow. Re-sending the current
// stage is a no-op (e.g. a retried request); going back is refused.
studyRouter.post("/study/participants/:participantId/stage", async (req, res) => {
  if (!requireDb(res)) return;
  const { participantId } = req.params;
  const { stage, note } = req.body ?? {};
  if (!(STUDY_STAGES as readonly unknown[]).includes(stage)) {
    res.status(400).json({ error: `stage must be one of: ${STUDY_STAGES.join(", ")}` });
    return;
  }
  const earlier = STUDY_STAGES.slice(0, STUDY_STAGES.indexOf(stage as StudyStage));
  const entry = {
    stage,
    at: new Date(),
    ...(typeof note === "string" && note.trim() ? { note: note.trim().slice(0, 32) } : {}),
  };
  try {
    // One atomic update, so two racing requests can't both log the same stage.
    const updated = await StudyParticipant.findOneAndUpdate(
      { participantId, status: "in-progress", stage: { $in: earlier } },
      { $set: { stage }, $push: { progress: entry } },
    );
    if (updated) {
      res.json({ ok: true, stage });
      return;
    }
    const current = await StudyParticipant.findOne({ participantId }, { stage: 1, status: 1 }).lean();
    if (!current) {
      res.status(404).json({ error: "unknown study participant" });
    } else if (current.status !== "in-progress") {
      res.status(409).json({ error: `study participant already ${current.status}` });
    } else if (current.stage === stage) {
      res.json({ ok: true, stage });
    } else {
      res.status(409).json({ error: `cannot go back from "${current.stage}" to "${stage}"` });
    }
  } catch (err) {
    console.warn("[db] failed to update study stage:", (err as Error).message);
    res.status(500).json({ error: "stage not stored" });
  }
});

// A questionnaire about the tutoring (NASA-TLX or SUS), answered in full.
// Only accepted at that questionnaire's stage, and stored once: a repeat
// (e.g. a retried request) is ignored and the first answers count.
studyRouter.post("/study/participants/:participantId/questionnaire", async (req, res) => {
  if (!requireDb(res)) return;
  const { participantId } = req.params;
  const { kind, answers, shownAt, answeredAt } = req.body ?? {};
  const scored = kind === "tlx" ? scoreTlx(answers) : kind === "sus" ? scoreSus(answers) : null;
  if (!scored || !isEpochMs(shownAt) || !isEpochMs(answeredAt) || answeredAt < shownAt) {
    res.status(400).json({
      error:
        "expected { kind: tlx, answers: { mental, physical, temporal, performance, effort, frustration: 0–100 in steps of 5 } } " +
        "or { kind: sus, answers: ten whole numbers 1–5 }, plus shownAt, answeredAt >= shownAt",
    });
    return;
  }
  try {
    const updated = await StudyParticipant.findOneAndUpdate(
      { participantId, status: "in-progress", stage: kind, [`${kind}.answeredAt`]: { $exists: false } },
      { $set: { [kind]: { ...scored, shownAt, answeredAt } } },
    );
    if (updated) {
      res.status(201).json({ ok: true });
      return;
    }
    const current = await StudyParticipant.findOne({ participantId }, { status: 1, stage: 1, [kind]: 1 }).lean();
    if (!current) {
      res.status(404).json({ error: "unknown study participant" });
    } else if ((kind === "tlx" ? current.tlx?.answeredAt : current.sus?.answeredAt) !== undefined) {
      res.json({ ok: true, duplicate: true });
    } else {
      res.status(409).json({ error: `not at the ${kind} questionnaire (status ${current.status}, stage ${current.stage})` });
    }
  } catch (err) {
    console.warn("[db] failed to store questionnaire:", (err as Error).message);
    res.status(500).json({ error: "questionnaire not stored" });
  }
});

// "completed": went through the whole flow (only allowed from the last stage).
// "ended-early": pressed "End session" at any point. Either is final.
studyRouter.post("/study/participants/:participantId/finish", async (req, res) => {
  if (!requireDb(res)) return;
  const { participantId } = req.params;
  const { status } = req.body ?? {};
  if (status !== "completed" && status !== "ended-early") {
    res.status(400).json({ error: 'status must be "completed" or "ended-early"' });
    return;
  }
  try {
    const updated = await StudyParticipant.findOneAndUpdate(
      {
        participantId,
        status: "in-progress",
        ...(status === "completed" ? { stage: LAST_STAGE } : {}),
      },
      { $set: { status, finishedAt: new Date() } },
    );
    if (updated) {
      res.json({ ok: true, status });
      return;
    }
    const current = await StudyParticipant.findOne({ participantId }, { stage: 1, status: 1 }).lean();
    if (!current) {
      res.status(404).json({ error: "unknown study participant" });
    } else if (current.status === status) {
      res.json({ ok: true, status }); // a retried request
    } else if (current.status !== "in-progress") {
      res.status(409).json({ error: `study participant already ${current.status}` });
    } else {
      res.status(409).json({
        error: `cannot complete from stage "${current.stage}" (the last stage is "${LAST_STAGE}")`,
      });
    }
  } catch (err) {
    console.warn("[db] failed to finish study participant:", (err as Error).message);
    res.status(500).json({ error: "status not stored" });
  }
});

function requireDb(res: Response): boolean {
  if (dbReady()) return true;
  res.status(503).json({ error: "MongoDB unavailable — study data is not being stored" });
  return false;
}

// Client timestamps (Date.now()); rejects garbage like 0 or seconds-based values.
function isEpochMs(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 1e12 && value < 1e13;
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}
