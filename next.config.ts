import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  reactStrictMode: true,
  async rewrites() {
    const apiOrigin = process.env.CARENOTE_API_ORIGIN;
    return process.env.NODE_ENV === "development" && apiOrigin
      ? [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }]
      : [];
  },
};

export default nextConfig;
