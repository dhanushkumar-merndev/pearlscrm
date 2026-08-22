import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Database-backed RLS tests, kept out of `pnpm test`.
 *
 * The unit suite must stay hermetic — no network, no credentials — so these run
 * under their own config and their own script. They are read-only and safe to
 * point at a populated project; see `tests/rls/anon-deny.test.ts`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/rls/**/*.test.ts"],
    setupFiles: ["tests/rls/setup.ts"],
    // A denied round trip to Supabase is still a round trip.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
