import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
      }],
    },
  },
  {
    files: ["desktop/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Codacy auto-generated tool configs
    ".codacy/**",
    ".codacy-cli-v2/**",
    // Local scratch worktrees should not participate in root lint runs.
    ".worktrees/**",
    // Runtime/generated/project-local data that should never be linted.
    ".threados/**",
    "dist-desktop/**",
    "output/**",
    "logo-brand-assets/**",
    "node_modules.win-old/**",
    "docs/**",
    "public/**",
    "*.svg",
    "*.png",
  ]),
]);

export default eslintConfig;
