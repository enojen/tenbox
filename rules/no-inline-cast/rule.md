# no-inline-cast

No `x as T`. Narrow with a type guard, annotate the variable, or call the branded type's
constructor. A branded type has one constructor, the only place with `as`: `domain/ids.ts`
and `domain/failures.ts` are excluded in `biome.json`. `as const` is allowed: it narrows a
literal, it does not widen.

Why: a cast tells the compiler to stop checking, so a wrong shape reaches run time. Moved
from the CLAUDE.md prose into a check in TEN-328.
