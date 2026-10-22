# use-jsons-check

No `Schema.safeParse(jsons.parse(text))` and no `Schema.parse(jsons.parse(text))`. Check JSON
text against a schema with `jsons.check(schema, text)`, or `jsons.checkLines(schema, text)` for
JSON Lines.

Why: one call parses and checks, never throws and gives the issues as lines, so every reader
turns them into the same error: `bad-file`, `bad-input`, or the tool's own (`gh`, `claude`).
Nine readers had the two-step form before TEN-485.
