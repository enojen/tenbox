# pure-domain

No clock (`Date.now()`, `performance.now()`, `new Date()` without an argument), no randomness
(`Math.random()`, `crypto.getRandomValues`, `crypto.randomUUID`), no `process`, no `fetch` and
no `Bun.*` but `Bun.stripANSI` in `domain/`. `biome.json` also blocks the `node:fs`,
`node:fs/promises`, `node:os`, `node:child_process` and `node:net` imports there. The rule is
off for `*.test.ts` and for `domain/ids.ts`, which makes random ids.

Why: the domain is pure code. The same input gives the same output, so a test needs no fake
clock and no temp files. Read the clock or the disk in `cli/infra/` and pass the value in.
