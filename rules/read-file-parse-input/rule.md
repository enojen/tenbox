# read-file-parse-input

A `read*` function reads a file and throws `badFileError`; a `parse*` function reads `--json`
or stdin input and throws `badInputError`. The rule reports a `read*` function that throws
`badInputError` and a `parse*` function that throws `badFileError`. It is on in `domain/`, not
for `*.test.ts`.

Why: the name says which error a caller gets: `bad-file` points at a file to fix, `bad-input`
at the command line. Set in TEN-485.
