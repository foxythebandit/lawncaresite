import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import kit from "./eslint.kit.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...kit,
  { files: ["tests/**"], rules: { "no-console": "off" } },
  // Hits that were here before lint ran in CI. Warnings in these files only, so the app stays
  // unchanged; the same mistake in any other file is still an error.
  {
    files: [
      "app/actions/get-parcel.ts",
      "app/admin/jobs/page.tsx",
      "app/portal/layout.tsx",
      "app/portal/login/page.tsx",
      "app/portal/page.tsx",
      "components/MapQuoteBuilder.tsx",
      "components/Nav.tsx",
    ],
    rules: {
      "@next/next/no-html-link-for-pages": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react/no-unescaped-entities": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
