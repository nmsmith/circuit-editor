module.exports = {
   root: true,
   env: {
      browser: true,
   },
   parser: "@typescript-eslint/parser",
   parserOptions: {
      ecmaVersion: 2019,
      sourceType: "module",
   },
   plugins: ["svelte3", "@typescript-eslint"],
   extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
   overrides: [
      {
         files: ["*.svelte"],
         processor: "svelte3/svelte3",
      },
   ],
   ignorePatterns: ["electron.cjs", "preload.cjs"],
   rules: {
      "no-shadow": "error",
      "prefer-const": "off",
      "no-undef": "off",
      "no-empty": "off",
      "no-inner-declarations": "off",
      "no-redeclare": "off",
      "no-debugger": "warn",
      "no-unreachable": "warn",
      "no-constant-condition": "warn",
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-extra-semi": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/ban-types": "off",
   },
   settings: {
      "svelte3/ignore-warnings": (warning) =>
         warning.code === "missing-declaration",
      "svelte3/typescript": true,
   },
}
