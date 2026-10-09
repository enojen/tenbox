// Every line marked "lint:" must be reported by the rule.
const INDENT = 2;

export function samples(value: unknown): string[] {
  return [
    `${JSON.stringify(value, null, INDENT)}\n`, // lint: indented JSON.stringify
    JSON.stringify(value, undefined, "\t"), // lint: indented JSON.stringify
  ];
}
