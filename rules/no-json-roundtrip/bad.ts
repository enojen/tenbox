// Every line marked "lint:" must be reported by the rule.
declare const value: { a: number };

export const copy = JSON.parse(JSON.stringify(value)); // lint: json round-trip clone
export const nested = { inner: JSON.parse(JSON.stringify(value.a)) }; // lint: json round-trip clone
