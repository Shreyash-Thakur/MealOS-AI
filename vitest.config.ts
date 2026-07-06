import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", ".next", "tests/e2e/**"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/*.test.ts", "node_modules/**"],
      thresholds: {
        // Decision Engine has a hard ≥95% branch coverage requirement (M4 DoD).
        // Global threshold is set conservatively — individual file thresholds
        // are enforced in the test suite itself.
        lines: 70,
        branches: 70,
      },
    },
  },
  resolve: {
    alias: {
      "@/app": resolve(__dirname, "app"),
      "@/components": resolve(__dirname, "components"),
      "@/lib": resolve(__dirname, "lib"),
      "@/types": resolve(__dirname, "types"),
      "@/prisma": resolve(__dirname, "prisma"),
      "@": resolve(__dirname, "."),
    },
  },
});
