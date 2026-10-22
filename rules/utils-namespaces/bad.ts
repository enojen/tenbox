// Every line marked "lint:" must be reported by the rule.
export function trimmed(text: string): string { // lint: loose function export
  return text.trim();
}
export const unique = <T>(items: T[]): T[] => [...new Set(items)]; // lint: loose arrow export
export const MS_PER_SECOND = 1000; // lint: loose constant export
export const time = { now: (): number => 0 }; // lint: namespace name is not plural
const local = 1;
export { local }; // lint: export list
