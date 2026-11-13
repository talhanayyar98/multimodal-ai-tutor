import type { ReactNode } from "react";
import AiSparkle from "@/components/AiSparkle";

/** The brand on the left and the page's status badges on the right (all three pages). */
export default function AppHeader({
  subtitle,
  children,
}: {
  /** The line under the title, e.g. "MSc thesis study · University of Jyväskylä". */
  subtitle: string;
  /** Badges. */
  children?: ReactNode;
}) {
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <AiSparkle size={22} />
        </span>
        <div>
          <h1>
            Multimodal Adaptive <span className="ai-text">AI Tutor</span>
          </h1>
          <p className="sub">{subtitle}</p>
        </div>
      </div>
      <div className="badges">{children}</div>
    </header>
  );
}
