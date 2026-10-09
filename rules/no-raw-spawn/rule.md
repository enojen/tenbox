# no-raw-spawn

No `Bun.spawn(...)` and no `Bun.spawnSync(...)`. Run a process through the functions in
`cli/infra/processes.ts`. The rule is off in that file, in `cli/test/cli.ts` (it runs the real
CLI) and for `*.test.ts`: `server/` tests cannot import `cli/infra/`.

Why: starting a process has one place for its options, its output and its errors. A second
place drifts from the first.
