// Every line marked "lint:" must be reported by the rule.
declare function parseObject(text: string): Record<string, unknown> | undefined;
declare function parseJson(text: string): unknown;

export function samples(text: string): unknown {
  const object = parseObject(text); // lint: JSON reader outside domain
  return parseJson(text) ?? object; // lint: JSON reader outside domain
}
