/**
 * lib/repositories/index.ts
 * MealOS AI — Repository barrel export
 *
 * Re-exports every repository module. Callers may import from this barrel
 * (e.g. `import { findUserByClerkId } from '@/lib/repositories'`) or
 * directly from the per-aggregate module for cleaner import paths in
 * large service files.
 */

export * from "./userRepo";
export * from "./memoryFactRepo";
export * from "./situationRepo";
export * from "./recommendationRepo";
export * from "./userActionRepo";
