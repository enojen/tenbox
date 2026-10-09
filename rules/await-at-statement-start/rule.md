# await-at-statement-start

`await` only at the start of a statement or as the whole right side of an assignment:
`const x = await f();`, `x = await f();`, `await f();`, and `return await f();` (needed inside
`try`). Never inside an argument, a condition,
an object literal, a spread or either side of `??`: name the awaited value first.

Why: an `await` buried in an expression hides the order of the side effects, and a failing
`expect(await f())` points at the matcher, not at the call. Reviewers missed
`expect(await …)` in TB-5, TB-6 and all four tasks of the 2026-10-09 series; a prompt forgets,
a check does not (TEN-328).
