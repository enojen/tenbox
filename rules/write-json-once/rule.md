# write-json-once

No `JSON.stringify` with three arguments (an indent). Write a JSON file with `files.writeJson`
in `cli/infra/files.ts`. The rule is off in that file and in `cli/main.ts`, which prints the
JSON result. `JSON.stringify(value)` with one argument is allowed.

Why: indent and trailing newline are one decision. Seven copies of it drift.
