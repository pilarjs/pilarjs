// @ts-check

/** @type {import("@ianvs/prettier-plugin-sort-imports").PrettierConfig} */
module.exports = {
  endOfLine: "lf",
  tabWidth: 2,
  printWidth: 80,
  useTabs: false,
  trailingComma: "es5",
  singleQuote: false,
  proseWrap: "always",
  semi: true,
  plugins: ["@ianvs/prettier-plugin-sort-imports"],
  importOrder: ["", "^[./]"],
  importOrderParserPlugins: ["typescript", "jsx", "decorators-legacy"],
  importOrderTypeScriptVersion: "5.0.0",
};
