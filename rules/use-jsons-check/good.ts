declare const jsons: { check(schema: unknown, text: string): unknown };
declare const Plan: { safeParse(value: unknown): unknown };

export function samples(text: string, value: unknown): unknown[] {
  return [jsons.check(Plan, text), Plan.safeParse(value)];
}
