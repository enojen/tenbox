# named-literal-unions

A union of two or more string literals is the whole right side of a type alias, or the type of a
const object: `type JobStatus = "success" | "failure"`, or `JOB_STATUS` with
`(typeof JOB_STATUS)[keyof typeof JOB_STATUS]`. Not inline in a property, a parameter, a return
type or a type argument (`status: "success" | "failure"`). The keys of `Pick` and `Omit` are
not values and stay inline.

Why: an inline union has no name the code can import, narrow to or search for, and the same set
of values gets typed twice and drifts apart. Asked for in the review of TEN-535.
