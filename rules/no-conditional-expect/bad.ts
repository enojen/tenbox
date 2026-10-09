// Every line marked "lint:" must be reported by the rule.
declare function expect(actual: unknown): { toBe(expected: unknown): void };
declare const ok: boolean;

expect(ok ? 1 : 0).toBe(1); // lint: ternary inside expect
expect(ok ? "yes" : null).toBe("yes"); // lint: ternary inside expect

export {};
