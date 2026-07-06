/**
 * Runtime environment variable validation module.
 *
 * Throws immediately at module load time if any required variable is missing or
 * empty. This surfaces misconfiguration at boot rather than at the first
 * request that needs the variable — converting silent `undefined` surprises
 * into loud startup crashes that are trivially diagnosed.
 *
 * Import `env` wherever you need an env var. Never read `process.env` directly
 * in application code.
 *
 * @module lib/env
 */

/**
 * The set of environment variables required for MealOS to boot.
 * The list is the authoritative source: docs/BACKEND_DESIGN.md §1 + playbook M0 DoD.
 */
const REQUIRED_VARS = [
  "DATABASE_URL",
  "ANTHROPIC_API_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "YOUTUBE_API_KEY",
  "SWIGGY_MCP_MODE",
] as const;

type RequiredVar = (typeof REQUIRED_VARS)[number];

/** Typed record of validated environment variables. */
type Env = Record<RequiredVar, string>;

/**
 * Validates all required environment variables and returns them as a typed
 * record. Called once at module load; throws on the first missing variable.
 *
 * @returns Typed env object with all required variables guaranteed non-empty.
 * @throws {Error} If any required variable is absent or empty.
 */
function buildEnv(): Env {
  const missing: string[] = [];

  for (const key of REQUIRED_VARS) {
    const value = process.env[key];
    if (value === undefined || value.trim() === "") {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `[MealOS] Missing required environment variable${missing.length > 1 ? "s" : ""}:\n` +
        missing.map((k) => `  • ${k}`).join("\n") +
        "\n\nCopy .env.local.example to .env.local and fill in the missing values.",
    );
  }

  // Safe: the loop above guarantees every key is present and non-empty.
  return Object.fromEntries(
    REQUIRED_VARS.map((key) => [key, process.env[key] as string]),
  ) as Env;
}

/**
 * Validated environment variables for MealOS.
 *
 * All properties are guaranteed non-empty strings. If a required variable is
 * missing, this module throws at import time — the app will not start.
 *
 * @example
 * ```typescript
 * import { env } from '@/lib/env';
 * const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
 * ```
 */
export const env: Env = buildEnv();
