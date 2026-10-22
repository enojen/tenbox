// Every line marked "lint:" must be reported by the rule.
declare const files: { read(file: string): Promise<string | null> };

export async function samples(file: string): Promise<unknown> {
  const text = await files.read(file); // lint: raw read of a Claude Code file
  const lines = await files.read(`${file}.jsonl`); // lint: raw read of a Claude Code file
  return text ?? lines;
}
