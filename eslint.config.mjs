// @ts-check
import tseslint from "typescript-eslint"

export default tseslint.config(
  { ignores: ["dist/", "coverage/"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Test files lean on non-null assertions for harness accessors; the
      // pattern is deliberate and locally total.
      "@typescript-eslint/no-non-null-assertion": "off",
      // `_`-prefixed params/vars are intentionally unused (placeholder args,
      // rest-sibling destructuring).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
)
