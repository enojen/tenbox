// Every line marked "lint:" must be reported by the rule.
declare const jsons: {
  parse(text: string): unknown;
};
declare const Plan: { safeParse(value: unknown): unknown; parse(value: unknown): unknown };

export function samples(text: string): unknown[] {
  return [
    Plan.safeParse(jsons.parse(text)), // lint: safeParse of parse
    Plan.parse(jsons.parse(text)), // lint: parse of parse
  ];
}
