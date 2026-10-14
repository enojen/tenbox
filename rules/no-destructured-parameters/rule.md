# no-destructured-parameters

A function takes its parameter object whole and destructures it in the body:
`function f(input: Input) { const { a, b } = input; }`, not `function f({ a, b }: Input)`.
Array destructuring and destructuring in the body are free.

Why: the signature then shows one named parameter, the type stays next to the name the body
uses, and a long destructuring does not push the type off the signature line. Asked for in the
review of TEN-387.
