import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * Clinical images are served through short-lived presigned Tigris URLs via
   * plain <img> tags. The Next.js image optimizer (sharp) is not used and its
   * native binaries cannot run inside the Cloudflare Workers bundle, so it is
   * disabled and excluded from the server trace.
   */
  images: { unoptimized: true },
  /*
   * sharp's native binaries cannot be bundled into the Cloudflare Workers
   * runtime, and no code path needs it (image optimization is disabled above).
   */
  serverExternalPackages: ["sharp"],
  /*
   * Stop Next.js output tracing from copying sharp (and its platform native
   * binaries) into the standalone server bundle used by the Cloudflare build.
   */
  outputFileTracingExcludes: {
    "*": ["**/sharp/**", "**/@img/**"],
  },
};

export default nextConfig;
