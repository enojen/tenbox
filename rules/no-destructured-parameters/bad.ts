// Every line marked "lint:" must be reported by the rule.
interface Input {
  a: string;
  b: number;
}

export function spread({ a, b }: Input): string { // lint: destructured parameter
  return `${a}${b}`;
}
export async function later({ a }: Input): Promise<string> { // lint: destructured parameter
  return a;
}
export const arrow = ({ b }: Input): number => b; // lint: destructured parameter
