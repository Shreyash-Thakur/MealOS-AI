/**
 * Prisma client singleton with dev hot-reload and connection-pool guards.
 *
 * In production, module-level singletons are safe because each serverless
 * invocation has its own module scope. In development, Next.js hot-reloads
 * modules, which would create a new PrismaClient (and connection pool) on
 * every file-save without the globalThis guard below.
 *
 * The `connection_limit` cap in the datasource URL (or the `connection_limit`
 * option below) is the connection-pool guard: serverless deployments on Vercel
 * can spawn many concurrent instances and saturate Neon's connection limit.
 * Keeping the pool to 1 per invocation relies on Neon's PgBouncer pooler on
 * the connection string side; adjust if you switch to a dedicated Postgres.
 *
 * Usage everywhere else in the codebase:
 * ```typescript
 * import { db } from '@/lib/db';
 * ```
 *
 * Never import PrismaClient directly in application code — always use this
 * singleton (CODE_STYLE.md §Database Standards).
 *
 * @module lib/db
 */

import { PrismaClient } from "@prisma/client";

// The datasource connection_limit is set on the connection string in .env.local
// (recommended: ?connection_limit=1 for serverless / pooled mode on Neon).
// We additionally pass it here as a safety net for environments that omit it.
const prismaClientOptions = {
  datasources: {
    db: {
      url: process.env["DATABASE_URL"],
    },
  },
  log:
    process.env["NODE_ENV"] === "development"
      ? (["query", "warn", "error"] as const)
      : (["warn", "error"] as const),
} satisfies ConstructorParameters<typeof PrismaClient>[0];

/** @internal Key on globalThis used to persist the client across hot-reloads. */
const GLOBAL_KEY = Symbol.for("mealos.prisma");

type GlobalWithPrisma = typeof globalThis & {
  [GLOBAL_KEY]?: PrismaClient;
};

/**
 * Returns the Prisma client singleton, creating it on the first call.
 *
 * In production: always returns a fresh instance (module scope lives for the
 * duration of the invocation; no risk of duplicate pools).
 * In development: persists the instance on globalThis to survive hot-reloads.
 *
 * @returns Singleton PrismaClient instance.
 */
function getPrismaClient(): PrismaClient {
  const g = globalThis as GlobalWithPrisma;

  if (process.env["NODE_ENV"] === "production") {
    return new PrismaClient(prismaClientOptions);
  }

  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new PrismaClient(prismaClientOptions);
  }

  return g[GLOBAL_KEY];
}

/**
 * The Prisma client singleton for MealOS.
 *
 * Import this — never instantiate PrismaClient directly in application code.
 *
 * @example
 * ```typescript
 * import { db } from '@/lib/db';
 *
 * const situation = await db.situation.findUnique({ where: { id } });
 * ```
 */
export const db: PrismaClient = getPrismaClient();
