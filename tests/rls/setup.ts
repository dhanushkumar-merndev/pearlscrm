import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Loads `.env.local` then `.env` into `process.env` for the database test run.
 *
 * These tests talk to a real Supabase project, so they need real configuration.
 * Values already present in the environment win, so CI can supply its own
 * without a file on disk.
 */

const FILES = [".env.local", ".env"];

for (const file of FILES) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) continue;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index <= 0) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();

    if (!value) continue;
    if (process.env[key] !== undefined) continue;

    process.env[key] = value;
  }
}
