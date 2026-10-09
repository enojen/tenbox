declare function expect(actual: unknown): { toBe(expected: unknown): void };
declare const ok: boolean;

declare const value: number;

expect(ok).toBe(true);
expect(value).toBe(1);
const picked = ok ? 1 : 0;
expect(picked).toBe(1);

export {};
