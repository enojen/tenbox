# errors-from-domain

No `new TenboxError(...)` outside `domain/errors/`. Call a named function from
`domain/errors/<kind>.ts` instead. `biome.json` turns the rule off for `**/domain/errors/**`.

Why: one place holds every error code and message, so a code or a message changes in one file.
Moved from a convention into a check in TEN-372.
