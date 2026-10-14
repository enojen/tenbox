# no-inline-cast

No `x as T`. Narrow with a type guard, annotate the variable, or call the branded type's
constructor. A branded type has one constructor, the only place with `as`: `domain/ids.ts`
and `domain/failures.ts` are excluded in `biome.json`. `as const` is allowed only as the whole
initializer of a module-level `const`: `export const SIGNALS = ["SIGINT"] as const;`. Inside an
expression or a function, give the value a declared type or a return type instead.

Why: a cast tells the compiler to stop checking, so a wrong shape reaches run time. An inline
`as const` hides a type that the signature should name. Moved from the CLAUDE.md prose into a
check in TEN-328; `as const` narrowed to module-level constants in TEN-398.
