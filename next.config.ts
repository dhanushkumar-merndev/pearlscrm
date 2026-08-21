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
  /*
   * Next's development server prints each Server Function call with its
   * serialized arguments, which puts credentials in the terminal:
   *
   *   ƒ signIn({"email":"…","password":"…"})
   *
   * `signIn` and `createUser` both take a password, so this logging is turned
   * off rather than relying on nobody reading the scrollback. Incoming request
   * logging is kept — it carries only a method, path and duration. Set
   * `logging: false` here to silence that too.
   */
  logging: { serverFunctions: false },
};

export default nextConfig;
