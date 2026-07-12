import type { NextConfig } from "next";

// Proxy /api/* through the Next server to the backend, so the browser only
// ever makes same-origin requests: no CORS preflights for extensions to
// mangle, and no localhost vs 127.0.0.1 resolution surprises (macOS AirPlay
// answers on ::1:5000).
const BACKEND_URL = process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:5000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
};

export default nextConfig;
