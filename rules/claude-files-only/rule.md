# claude-files-only

No `files.read(...)` in `cli/infra/claude/`. Read a file Claude Code writes with
`claudeFiles.find(schema, file)` or `claudeFiles.findLines(schema, file)`. The rule is off in
`claudeFiles.ts` itself, in `settings.ts` (Tenbox writes that file too, so a broken one is an
error) and for `*.test.ts`.

Why: Claude Code's files are not a public API and change between versions. One reader checks
each against a schema of the fields Tenbox reads and turns a broken file into null plus one
warning line, so a change in Claude Code never stops a tenbox command. Five readers parsed
these files by hand before TEN-486.
