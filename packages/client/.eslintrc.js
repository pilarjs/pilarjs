/** @type {import("eslint").Linter.Config} */
const path = require("node:path");

module.exports = {
  root: true,
  extends: ["@pilarjs/eslint-config/base.js"],
  parserOptions: {
    project: [path.resolve(__dirname, "./tsconfig.json")],
  },
  rules: {
    // ----------------------------------------------------------------------
    // Overrides from default rule config used in all other projects!
    // ----------------------------------------------------------------------
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/unbound-method": "off",
  },
};
