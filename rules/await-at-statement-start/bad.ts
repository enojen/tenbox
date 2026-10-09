// Every line marked "lint:" must be reported by the rule.
declare function f(value?: unknown): Promise<unknown>;
declare function expect(value: unknown): { toBe(other: unknown): void };
declare const x: Promise<unknown[]>;
declare const a: unknown;

export async function samples(): Promise<void> {
  expect(await f()).toBe(a); // lint: await inside an argument
  f(await x); // lint: await inside an argument
  const spread = [...(await x)]; // lint: await inside a spread
  const right = a ?? (await x); // lint: await on the right of ??
  const left = (await x) ?? a; // lint: await on the left of ??
  if (await x) { // lint: await inside a condition
    return;
  }
  const literal = { a: await x }; // lint: await inside an object literal
  console.log(spread, right, left, literal);
}
