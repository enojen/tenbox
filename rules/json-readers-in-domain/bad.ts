// Every line marked "lint:" must be reported by the rule.
declare const jsons: {
  parse(text: string): unknown;
  check(schema: unknown, text: string): unknown;
  checkLines(schema: unknown, text: string): unknown;
};

export function samples(text: string): unknown {
  const lines = jsons.checkLines(text, text); // lint: JSON reader outside domain
  const checked = jsons.check(lines, text); // lint: JSON reader outside domain
  return jsons.parse(text) ?? checked; // lint: JSON reader outside domain
}
