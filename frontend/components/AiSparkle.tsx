import { useId } from "react";

/** Four-point "AI" sparkle filled with the --ai-1 → --ai-2 → --ai-3 gradient. */
export default function AiSparkle({ size = 16, className }: { size?: number; className?: string }) {
  // useId() contains characters that are awkward inside url(#…); keep only safe ones.
  const gradientId = `ai-sparkle-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--ai-1)" }} />
          <stop offset="0.55" style={{ stopColor: "var(--ai-2)" }} />
          <stop offset="1" style={{ stopColor: "var(--ai-3)" }} />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradientId})`}
        d="M12 2c.5 5.3 4.7 9.5 10 10-5.3.5-9.5 4.7-10 10-.5-5.3-4.7-9.5-10-10 5.3-.5 9.5-4.7 10-10Z"
      />
    </svg>
  );
}
