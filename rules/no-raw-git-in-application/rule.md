# no-raw-git-in-application

No `git.run(...)` in `cli/application/`. Call a named function in `cli/infra/git.ts`. The rule
is off for `*.test.ts`: tests set up real repositories with raw git.

Why: git's command line is a tool format, and tool formats live in `infra/`. A named function
has one place to fix and one name to read. Moved from the CLAUDE.md prose into a check in
TEN-369.
