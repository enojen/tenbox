declare function f(value?: unknown): Promise<unknown>;
declare function expect(value: unknown): { toBe(other: unknown): void };
declare const x: Promise<unknown[]>;
declare const a: unknown;

export async function samples(): Promise<void> {
  const y = await f();
  await f();
  const items = await x;
  const value = items ?? a;
  expect(y).toBe(value);
  if (items) {
    return;
  }
  const literal = { a: items };
  console.log(literal);
}

export async function caught(): Promise<unknown> {
  try {
    return await f();
  } catch {
    return null;
  }
}
