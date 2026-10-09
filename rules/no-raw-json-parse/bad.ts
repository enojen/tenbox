// Every line marked "lint:" must be reported by the rule.
export function samples(text: string): unknown {
  const value = JSON.parse(text); // lint: raw JSON.parse
  return JSON.parse(`${text}`, (_key, item) => item) ?? value; // lint: raw JSON.parse
}
