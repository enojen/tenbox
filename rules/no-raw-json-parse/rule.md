# no-raw-json-parse

No `JSON.parse(...)`. Call `jsons.parse` or `jsons.check` from `domain/utils.ts`. The rule
is off in `domain/utils.ts` and for `*.test.ts`.

Why: `JSON.parse` throws and returns `any`. `jsons.parse` returns `unknown`, or `undefined` for
text that is not JSON, so JSON is parsed in one place and every caller must check the value.
