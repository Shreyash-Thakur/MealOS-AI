import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettierConfig,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // N10: Architectural invariant — lib/mcp/* and lib/youtube.ts may only be
  // imported from lib/agents/tool.ts. Any other file importing these is a
  // violation that would bypass the Tool Agent's normalisation and caching layer.
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["*/lib/mcp/*", "../mcp/*", "../../mcp/*", "../../../mcp/*"],
              message:
                "lib/mcp/* may only be imported from lib/agents/tool.ts (N10). " +
                "Use the Tool Agent as the sole intermediary to Swiggy MCP.",
            },
            {
              group: ["*/lib/youtube*", "../youtube*", "../../youtube*"],
              message:
                "lib/youtube.ts may only be imported from lib/agents/tool.ts (N10). " +
                "Use the Tool Agent as the sole intermediary to the YouTube API.",
            },
          ],
        },
      ],
    },
  },
  // Exempt lib/agents/tool.ts from the restriction — it IS the sole entry point.
  // Its unit tests must construct MCP mocks directly, so they share the exemption
  // (they use dynamic imports the rule cannot see anyway; listing them keeps the
  // exemption explicit rather than loophole-dependent).
  {
    files: ["lib/agents/tool.ts", "tests/agents/tool.test.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  // Exempt MCP unit tests — tests/mcp/* directly test the MCP layer and must
  // import it. This does not weaken the N10 architectural invariant because
  // production code paths are still fully restricted; only dedicated unit tests
  // for lib/mcp/* are allowed here.
  {
    files: ["tests/mcp/**/*.ts", "tests/mcp/**/*.tsx", "lib/mcp/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);

export default eslintConfig;
