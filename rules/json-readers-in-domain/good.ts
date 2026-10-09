declare function readProofs(text: string, file: string): string[];

export function samples(text: string): string[] {
  return readProofs(text, "proofs.json");
}
