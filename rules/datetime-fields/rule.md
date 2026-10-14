# datetime-fields

In an object property named `at`, `deadline` or `<name>At` (`createdAt`, `mergedAt`), the zod
schema is `z.iso.datetime()`, not `z.string()` with any chain (`z.string().nullish()`). Other
property names may use `z.string()`.

Why: a time field read as a plain string lets any text through, and the code that compares or
sorts the time fails later. Tenbox writes times with `toISOString()`, so the stricter schema
reads every file it writes. Asked for in the review of TEN-388; added in TEN-398.
