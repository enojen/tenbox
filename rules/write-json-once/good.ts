export function samples(value: unknown): string[] {
  return [JSON.stringify(value), JSON.stringify(value, (_key, item) => item)];
}
