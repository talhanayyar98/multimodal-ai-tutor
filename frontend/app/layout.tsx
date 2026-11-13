import type { Metadata } from "next";
import "./globals.css";
import "./styles/tutor.css";
import "./styles/steps.css";
import "./styles/results.css";

export const metadata: Metadata = {
  title: "Multimodal Adaptive AI Tutor",
  description: "MSc thesis prototype — University of Jyväskylä",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
