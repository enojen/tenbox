# no-caught-error-in-tests

A test does not take the caught error out of a catch: no `return error`, no `thrown = error`
and no `.catch((e) => e)`. Assert on the throw itself:
`expect(() => f()).toThrow(expect.objectContaining({ code }))` or
`await expect(promise).rejects.toMatchObject({ code })`. A catch that returns or assigns a
constant is fine. `biome.json` turns the rule on for `**/*.test.ts` only.

Why: if the call does not throw, the saved value stays empty and the test can pass or fail
far from the cause. `toThrow` and `rejects` fail at the call. Added in TEN-375.
