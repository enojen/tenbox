# named-parameter-types

A parameter has a named type. No `Omit<>`, `Pick<>` or indexed type (`Shape["a"]`) in a
parameter: declare `type Name = Shape["a"]` or an interface, and use the name. Return types and
type aliases may use them.

Why: a derived type in a signature hides the shape the caller must pass, and a shape used
twice drifts. Moved from the CLAUDE.md prose into a check in TEN-369.
