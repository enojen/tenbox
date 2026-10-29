# no-indexed-access-types

No indexed access type such as `Result["status"]`, `List[number]` or
`z.infer<typeof Schema>["items"][number]`. Name the type, or the schema of the inner part, and
use that name: `JobStatus`, `z.infer<typeof ItemSchema>`. The type of a const object or a
const array stays allowed, because it has no other way to be written:
`(typeof JOB_STATUS)[keyof typeof JOB_STATUS]`, `(typeof PART_STATUSES)[number]`.

Why: an indexed access hides a shape inside another one; it has no name the code can import or
search for, and a reader must open the outer type to see it. Asked for in the review of TEN-535.
