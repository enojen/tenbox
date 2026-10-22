# json-readers-in-domain

No `jsons.parse(...)`, `jsons.check(...)` or `jsons.checkLines(...)` call outside `domain/`. Read a
Tenbox file with a `read*` function in `domain/` that checks its shape (for example
`readProofs`). The rule is off in `domain/`, in `cli/infra/` (a tool's output format lives there;
Claude Code's files go through `claudeFiles` in `cli/infra/claude/`), in `cli/test/` and for
`*.test.ts`.

Why: a parse without a shape check lets unchecked data into the code. One reader per file
keeps the shape and its errors in one place.
