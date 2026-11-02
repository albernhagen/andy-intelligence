import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // template/ is linted in the repos it is copied into (its own tsconfig would confuse this one).
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.gen.ts", "infra/**", "template/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // template/starter has its own tsconfig; pin the root so typescript-eslint doesn't guess.
    languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly" } },
  },
  {
    files: ["platform/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", Buffer: "readonly" } },
  },
);
