import path from "node:path";
import type { NextConfig } from "next";

const developmentScriptPolicy =
  process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
const workspaceRoot = path.resolve(__dirname, "../..");

// Deliberately NOT `output: "export"`. The previous prototype was a static
// export, which is precisely why it could not have a backend.
const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    // pnpm keeps Next in the monorepo's virtual store. Without an explicit
    // workspace root, Turbopack stops at apps/web and cannot resolve it.
    root: workspaceRoot,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // geolocation is allowed for this origin only: the driver page has an
          // opt-in "Share my position" control, and the browser still asks. With
          // `geolocation=()` the control could never work.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
          {
            key: "Content-Security-Policy",
            value:
              `default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob: https:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'${developmentScriptPolicy}; connect-src 'self' https: wss:`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
