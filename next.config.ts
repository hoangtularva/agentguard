import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every screen renders live security data per request; the previous (non-Cache-Components)
  // model with request-time APIs is simpler and sufficient. See docs/DECISIONS.md (D-08).
  output: "standalone",
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
