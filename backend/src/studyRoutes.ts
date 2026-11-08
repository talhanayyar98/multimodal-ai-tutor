// Endpoints for the /study A/B study. A study participant gets a code and a
// group once; every session they start (POST /api/session with mode "study")
// then uses that group. Progress is tracked per participant: the furthest
// stage reached (with timestamps) and a status, so the analysis can keep only
// status "completed". Everything here needs MongoDB (503 otherwise): study
// data that can't be tied to its participant and group is useless.
import { Router, type Response } from "express";
import { assignGroup } from "./allocation";
import { dbReady } from "./db";
import { Counter, STUDY_STAGES, StudyParticipant, type StudyStage } from "./models";

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
  try {
    const counter = await Counter.findOneAndUpdate(
      { _id: test ? "study-test-participant" : "study-participant" },
      { $inc: { seq: 1 } },
      { upsert: true, new: true },
    );
    const seq = counter.seq;
    participantId = `${test ? "ST" : "LRN"}${String(seq).padStart(3, "0")}`;
    const { abGroup, block } = await assignGroup(seq, test);
    const now = new Date();
    await StudyParticipant.create({
      participantId,
      seq,
      isTest: test,
      abGroup,
      allocationBlock: block,
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
  // carry it, and the study page never shows it.
  res.status(201).json({ participantId });
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
