const js = require("@eslint/js");
const globals = require("globals");
const prettier = require("eslint-config-prettier");

module.exports = [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "data/**",
      "backend/data/**",
      "*.min.js",
      "main.js",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    rules: {
      "no-constant-condition": "off",
      "no-empty": "warn",
      "no-prototype-builtins": "warn",
      "no-redeclare": "warn",
      "no-useless-escape": "off",
      "no-undef": "off",
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["src/**/*.js"],
    ignores: ["src/public/**/*.js"],
    languageOptions: {
      sourceType: "module",
    },
  },
  prettier,
];
