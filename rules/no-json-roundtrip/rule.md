# no-json-roundtrip

No `JSON.parse(JSON.stringify(x))`. Copy a value with `structuredClone(x)`.

Why: the round-trip drops `undefined`, dates and maps without a sign, so the copy can differ
from the original. `structuredClone` keeps them. Added in TEN-375.
