# utils-namespaces

`domain/utils.ts` exports only namespace objects with a plural name (`export const strings =
{ ... }`) and types. No loose function, constant, class or export list. The rule is on only
for `domain/utils.ts`.

Why: a call reads as `strings.isNotBlank(x)` or `durations.minutesBetween(a, b)`, so the name
says what kind of value it works on. The plural follows the module names of `application/`
and does not clash with local names like `text` or `json`.
