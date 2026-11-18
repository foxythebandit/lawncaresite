// Base lint rules for every app. Each eslint.config spreads this in: ...kit
// App-specific rules (like the admin client import rule) live in the app's own eslint.config.
// ESLint replaces a rule's options per file, so route files repeat the address selectors.

const ADDRESS = "\\.supabase\\.co|127\\.0\\.0\\.1:\\d{4,5}|localhost:5\\d{4}";
const WRITE = "CallExpression[callee.property.name=/^(insert|update|upsert|delete)$/]";
// Not **/*.test.*: ESLint lints every file a files pattern matches, and that one matches *.test.sql.
const TEST_FILES = "**/*.test.{js,jsx,mjs,cjs,ts,tsx,mts,cts}";
const addressRule = (selector) => ({ selector, message: "Read the Supabase address from env." });
const getRule = (selector) => ({ selector, message: "Routes that change data can't use GET." });

export const address = [
  addressRule(`Literal[value=/${ADDRESS}/]`),
  addressRule(`TemplateElement[value.raw=/${ADDRESS}/]`),
];
const getWrites = [
  getRule(`ExportNamedDeclaration > FunctionDeclaration[id.name='GET'] ${WRITE}`),
  getRule(`ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[id.name='GET'] ${WRITE}`),
];

export default [
  {
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
      "no-restricted-syntax": ["error", ...address],
    },
  },
  {
    files: ["**/route.ts"],
    rules: { "no-restricted-syntax": ["error", ...address, ...getWrites] },
  },
  {
    files: ["scripts/**", "supabase/functions/**", TEST_FILES],
    rules: { "no-console": "off" },
  },
  {
    files: [TEST_FILES, "tests/**"],
    rules: { "no-restricted-syntax": "off" },
  },
];
