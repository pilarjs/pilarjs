/** @type {import("eslint").Linter.Config} */
const path = require('node:path');
module.exports = {
  root: true,
  extends: ['@pilarjs/eslint-config/base.js'],
  parserOptions: {
    project: [path.resolve(__dirname, './tsconfig.json')],
  },
  rules: {
    'no-unused-vars': 'error',
  },
};
