// Endpoints for the /study A/B study. A study participant gets a code and a
// group once; every session they start (POST /api/session with mode "study")
// then uses that group. Everything here needs MongoDB (503 otherwise): study
// data that can't be tied to its participant and group is useless.
import { Router } from "express";
import { assignGroup } from "./allocation";
import { dbReady } from "./db";
import { Counter, StudyParticipant } from "./models";

export const studyRouter = Router();

studyRouter.post("/study/participants", async (req, res) => {
  if (!dbReady()) {
    res.status(503).json({ error: "MongoDB unavailable — study data is not being stored" });
    return;
  }
  const { consent, isTest } = req.body ?? {};
  if (consent !== true) {
    res.status(400).json({ error: "consent is required" });
    return;
  }

  // Test runs get their own ST-codes, counter and allocation blocks, so they
  // never shift the real participants' numbering or group balance.
  const test = isTest === true;
  let participantId: string;
  try {
    const counter = await Counter.findOneAndUpdate(
      { _id: test ? "study-test-participant" : "study-participant" },
      { $inc: { seq: 1 } },
      { upsert: true, new: true },
    );
    const seq = counter.seq;
    participantId = `${test ? "ST" : "S"}${String(seq).padStart(3, "0")}`;
    const { abGroup, block } = await assignGroup(seq, test);
    await StudyParticipant.create({
      participantId,
      seq,
      isTest: test,
      abGroup,
      allocationBlock: block,
      consentAt: new Date(),
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
