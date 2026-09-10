import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Pin the React version: eslint-plugin-react's auto-detect calls
  // context.getFilename(), which ESLint 10 removed, and crashes every file.
  { settings: { react: { version: "19.2" } } },
  // A leading underscore marks a deliberately unused parameter.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Foundry deps (gitignored clones) ship their own eslint configs.
    "contracts/lib/**",
    // Design-handoff prototypes (Babel-rendered .jsx), not app source.
    "designs/**",
  ]),
]);

export default eslintConfig;
