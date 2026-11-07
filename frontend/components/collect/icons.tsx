// Small stroke icons for the /collect flow (24×24 grid, inherit currentColor).

import type { ReactNode } from "react";

interface IconProps {
  size?: number;
  className?: string;
}

function Svg({ size = 18, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);

export const CrossIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Svg>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

export const ArrowLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Svg>
);

export const CameraIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H7l1.5-2h7L17 6h1.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
    <circle cx="12" cy="13" r="3.5" />
  </Svg>
);

export const MouseIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="3" width="12" height="18" rx="6" />
    <path d="M12 7v4" />
  </Svg>
);

export const KeyboardIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
    <path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9" />
  </Svg>
);

export const ChatIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 5h15a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-5 4v-4h-.5A1.5 1.5 0 0 1 3 14.5v-8A1.5 1.5 0 0 1 4.5 5z" />
  </Svg>
);

export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

export const ShieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.4-7.5 9.5-4.3-1.1-7.5-4.9-7.5-9.5V6z" />
    <path d="M9 12l2.2 2.2L15.5 10" />
  </Svg>
);

export const PulseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />
  </Svg>
);

export const PencilIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20l1-4.5L16 4.5l3.5 3.5L8.5 19z" />
    <path d="M13.5 7l3.5 3.5" />
  </Svg>
);

export const FractionIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 4v6M5.5 5.5L7 4" />
    <path d="M18 5L6 19" />
    <path d="M14 15a2 2 0 1 1 4 0c0 1.5-4 2.5-4 4h4" />
  </Svg>
);

export const TargetIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="0.6" fill="currentColor" />
  </Svg>
);

export const CopyIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </Svg>
);

export const UserIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="3.8" />
    <path d="M4.5 20c.8-3.8 3.8-6 7.5-6s6.7 2.2 7.5 6" />
  </Svg>
);

export const ExitIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5H14" />
    <path d="M10 12h10M16.5 8.5L20 12l-3.5 3.5" />
  </Svg>
);
