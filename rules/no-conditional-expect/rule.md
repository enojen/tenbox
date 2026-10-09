# no-conditional-expect

No `expect(a ? b : c)`. A ternary inside `expect` lets the test pick what it checks. Assert
the value you expect, or one `expect` for each case. `biome.json` turns the rule on for
`**/*.test.ts` only.

Why: the test then passes on both branches, so a wrong branch can hide. Added in TEN-375.
