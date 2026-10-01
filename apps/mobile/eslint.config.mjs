import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Lint for the driver app.
 *
 * Non-type-aware on purpose: the type-checked rules need a second TS program
 * per run, and `pnpm typecheck` already covers this package with strict tsc.
 *
 * Two rules here are not style. no-console keeps a session token, a signature
 * or a photo payload out of the logs, which docs/CONVENTIONS.md forbids
 * outright -- src/platform/log.ts is the single exempt module and redacts.
 * no-restricted-globals catches web reflexes (localStorage, window) that
 * silently do nothing or throw on a device; this app's persistence is SQLite
 * and expo-secure-store.
 */
export default defineConfig([
  globalIgnores([".expo/**", "android/**", "ios/**", "dist/**"]),

  ...tseslint.configs.recommended,
  // configs.flat is the flat-config namespace; configs.recommended at the top
  // level is still eslintrc-shaped and ESLint 9 rejects it outright.
  reactHooks.configs.flat["recommended-latest"],

  {
    rules: {
      "no-console": "error",
      "no-restricted-globals": [
        "error",
        { name: "window", message: "No DOM here. Use React Native APIs." },
        { name: "document", message: "No DOM here. Use React Native APIs." },
        {
          name: "localStorage",
          message: "Use expo-secure-store for the token, SQLite for everything else.",
        },
        {
          name: "sessionStorage",
          message: "Use expo-secure-store for the token, SQLite for everything else.",
        },
      ],
      // An unused argument is often a half-finished handler; an _-prefixed one
      // is a deliberate signature match.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  {
    // metro.config.js is loaded by Metro as CommonJS, so require() is the only
    // thing that works there -- it is not an ES module and cannot be one while
    // the package stays type: commonjs (which Expo needs).
    files: ["*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },

  {
    // The one place allowed to write to the console. It redacts token,
    // signatureData and photoData before anything reaches it.
    files: ["src/platform/log.ts"],
    rules: { "no-console": "off" },
  },

  {
    // Tests run under Node, where console is the reporter's business and
    // fixtures legitimately need loose shapes.
    files: ["src/**/*.test.ts"],
    rules: { "no-console": "off", "@typescript-eslint/no-explicit-any": "off" },
  },
]);
