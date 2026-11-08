"use client";

import { useState } from "react";
import { AgreeCard, Fact, Row } from "@/components/collect/ConsentStep";
import {
  ArrowRightIcon,
  CameraIcon,
  ChatIcon,
  CheckIcon,
  CrossIcon,
  ExitIcon,
  MouseIcon,
  PulseIcon,
  ShieldIcon,
  TargetIcon,
} from "@/components/collect/icons";

// Placeholder wording: replace with (or align to) the consent form approved
// by your supervisor / the JYU ethics process before real participants use it.
// The participant code is only created once they agree.
export default function StudyConsent({
  busy,
  onAgree,
}: {
  /** Creating the participant: the button waits. */
  busy: boolean;
  onAgree: () => void;
}) {
  const [adult, setAdult] = useState(false);
  const [agree, setAgree] = useState(false);
  const ready = adult && agree;

  return (
    <section className="card collect-card consent" data-testid="consent">
      <p className="eyebrow">MSc thesis study · University of Jyväskylä</p>
      <h2 className="hero-title">Learn with an AI tutor</h2>
      <p className="lead">
        This session is part of an MSc thesis at the University of Jyväskylä. You will solve short
        maths and logic problems with an AI tutor that you can chat with and ask for hints. The
        study compares different versions of the tutor; which one you get is decided at random.
      </p>

      <div className="facts">
        <Fact icon={<TargetIcon />} value="Short problems" label="maths and logic" />
        <Fact icon={<ChatIcon />} value="AI tutor" label="chat and hints any time" />
        <Fact icon={<ShieldIcon />} value="No video" label="leaves this computer" />
      </div>

      <div className="consent-grid">
        <div className="info-box" data-tone="recorded">
          <h3>
            <CheckIcon size={16} /> What is recorded
          </h3>
          <p className="info-sub">Every 5 seconds, a few numbers computed from your webcam image and your mouse:</p>
          <ul>
            <Row icon={<CameraIcon />} title="Webcam:">
              whether a face is visible, how open your eyes are, blinks, gaze direction, head
              movement.
            </Row>
            <Row icon={<MouseIcon />} title="Mouse:">
              distance, speed, clicks, idle time.
            </Row>
          </ul>
          <p className="info-sub">Also:</p>
          <ul>
            <Row icon={<PulseIcon />}>
              Your answers, how long each problem took, the hints you asked for and your chat with
              the tutor.
            </Row>
          </ul>
        </div>

        <div className="info-box" data-tone="not-recorded">
          <h3>
            <CrossIcon size={16} /> What is not recorded
          </h3>
          <ul>
            <Row icon={<CameraIcon />}>
              No video, photos or audio. The camera image is processed on this computer and never
              sent anywhere.
            </Row>
            <Row icon={<ShieldIcon />}>Not your name: you get a participant code instead.</Row>
          </ul>
        </div>
      </div>

      <h3>Good to know</h3>
      <ul className="info-list">
        <Row icon={<ChatIcon />}>
          Your chat messages are sent to Google&apos;s Gemini AI to generate the tutor&apos;s
          replies, so please don&apos;t type personal information into the chat.
        </Row>
        <Row icon={<ShieldIcon />}>
          Your data is stored under a participant code (for example LRN007), not your name. If you
          later want it deleted, give the researcher your code.
        </Row>
        <Row icon={<ExitIcon />}>Taking part is voluntary. You can stop at any time.</Row>
      </ul>

      <div className="agree">
        <AgreeCard checked={adult} onChange={setAdult} testId="consent-adult">
          I am 18 or older.
        </AgreeCard>
        <AgreeCard checked={agree} onChange={setAgree} testId="consent-agree">
          I have read the above and agree to take part.
        </AgreeCard>
      </div>

      <div className="collect-actions">
        <button
          className="btn btn-gold btn-lg"
          disabled={!ready || busy}
          onClick={onAgree}
          data-testid="consent-continue"
        >
          {busy ? "Starting…" : "I agree — continue"} <ArrowRightIcon size={15} />
        </button>
        {!ready && <span className="muted action-hint">Tick both boxes to continue.</span>}
      </div>
    </section>
  );
}
