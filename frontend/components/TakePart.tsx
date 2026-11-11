import Link from "next/link";
import { ArrowRightIcon, ClockIcon, PulseIcon, TargetIcon } from "@/components/collect/icons";

/** Strip under the main page's header: the two ways to take part in the research. */
export default function TakePart() {
  return (
    <section className="take-part" aria-labelledby="take-part-title">
      <div className="take-part-intro">
        <h2 id="take-part-title">Want to take part?</h2>
        <p>This page is a free demo. To help the research, pick one:</p>
      </div>
      <div className="take-part-links">
        <Link href="/collect" className="take-part-link" data-kind="collect">
          <span className="take-part-icon">
            <PulseIcon size={17} />
          </span>
          <span className="take-part-text">
            <b>Contribute data</b>
            <small>
              <ClockIcon size={12} /> ~30 min · helps train the model
            </small>
          </span>
          <ArrowRightIcon size={16} className="take-part-arrow" />
        </Link>
        <Link href="/study" className="take-part-link" data-kind="study">
          <span className="take-part-icon">
            <TargetIcon size={17} />
          </span>
          <span className="take-part-text">
            <b>Join the study</b>
            <small>
              <ClockIcon size={12} /> ~40 min · learn with the tutor
            </small>
          </span>
          <ArrowRightIcon size={16} className="take-part-arrow" />
        </Link>
      </div>
    </section>
  );
}
