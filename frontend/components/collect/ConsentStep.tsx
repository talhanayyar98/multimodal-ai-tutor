"use client";

import { useState, type ReactNode } from "react";
import {
  ArrowRightIcon,
  CameraIcon,
  ChatIcon,
  CheckIcon,
  ClockIcon,
  CrossIcon,
  ExitIcon,
  KeyboardIcon,
  MouseIcon,
  PulseIcon,
  ShieldIcon,
  TargetIcon,
  UserIcon,
} from "./icons";

export function Fact({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <div className="fact">
      <span className="fact-icon">{icon}</span>
      <span>
        <b className="fact-value">{value}</b>
        <span className="fact-label">{label}</span>
      </span>
    </div>
  );
}

export function Row({ icon, title, children }: { icon: ReactNode; title?: string; children: ReactNode }) {
  return (
    <li className="info-row">
      <span className="info-icon">{icon}</span>
      <span>
        {title && <b>{title} </b>}
        {children}
      </span>
    </li>
  );
}

export function AgreeCard({
  checked,
  onChange,
  testId,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <label className="agree-card" data-checked={checked}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
      />
      <span className="agree-box">{checked && <CheckIcon size={15} />}</span>
      <span>{children}</span>
    </label>
  );
}

// Placeholder wording: replace with (or align to) the consent form approved
// by your supervisor / the JYU ethics process before real participants use it.
export default function ConsentStep({ onAgree }: { onAgree: () => void }) {
  const [adult, setAdult] = useState(false);
  const [agree, setAgree] = useState(false);
  const ready = adult && agree;

  return (
    <section className="card collect-card consent" data-testid="consent">
      <p className="eyebrow">MSc thesis study · University of Jyväskylä</p>
      <h2 className="hero-title">Help train an adaptive AI tutor</h2>
      <p className="lead">
        This session is part of an MSc thesis at the University of Jyväskylä. You will solve
        probability questions for about 30 minutes, with an AI tutor you can chat with. About every
        90 seconds a short pop-up asks how you feel. Please answer it honestly — there are no right
        or wrong answers.
      </p>

      <div className="facts">
        <Fact icon={<ClockIcon />} value="~30 min" label="of probability questions" />
        <Fact icon={<PulseIcon />} value="Every ~90 s" label="a one-click check-in" />
        <Fact icon={<ShieldIcon />} value="No video" label="leaves this computer" />
      </div>

      <div className="consent-grid">
        <div className="info-box" data-tone="recorded">
          <h3>
            <CheckIcon size={16} /> What is recorded
          </h3>
          <p className="info-sub">
            Every 5 seconds, a few numbers computed from your webcam image, your mouse and your
            keyboard:
          </p>
          <ul>
            <Row icon={<CameraIcon />} title="Webcam:">
              whether a face is visible, how open your eyes are, blinks, gaze direction, head
              movement.
            </Row>
            <Row icon={<MouseIcon />} title="Mouse:">
              distance, speed, clicks, idle time.
            </Row>
            <Row icon={<KeyboardIcon />} title="Keyboard:">
              how many keys were pressed, not which ones.
            </Row>
          </ul>
          <p className="info-sub">Also:</p>
          <ul>
            <Row icon={<TargetIcon />}>
              Your answers to the questions, your check-in answers and your chat with the tutor.
            </Row>
            <Row icon={<UserIcon />}>
              A few background questions (age, field of study, …) — but not your name.
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
          Your data is stored under a participant code (for example P007), not your name. If you
          later want it deleted, give the researcher your code.
        </Row>
        <Row icon={<ExitIcon />}>
          Taking part is voluntary. You can stop at any time with “End session”.
        </Row>
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
          className="btn btn-primary btn-lg"
          disabled={!ready}
          onClick={onAgree}
          data-testid="consent-continue"
        >
          I agree — continue <ArrowRightIcon size={15} />
        </button>
        {!ready && <span className="muted action-hint">Tick both boxes to continue.</span>}
      </div>
    </section>
  );
}
