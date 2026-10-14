# named-union-members

A union member is a named type or a literal: `Ok | Failed | "skipped" | null`. No inline object
type (`Ok | { ok: false }`) and no intersection (`A | (B & C)`) as a member: declare the member as
an interface or a type alias and use its name.

Why: an unnamed member has no name the code can narrow to, import or talk about, and the same
shape gets written twice. Asked for in the review of TEN-388; added in TEN-398.
