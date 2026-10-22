declare const claudeFiles: {
  find(schema: unknown, file: string): Promise<unknown>;
  findLines(schema: unknown, file: string): Promise<unknown[] | null>;
};
declare const files: { list(dir: string): Promise<string[]> };

export async function samples(file: string): Promise<unknown> {
  const names = await files.list(file);
  const lines = await claudeFiles.findLines(names, file);
  const value = await claudeFiles.find(names, file);
  return lines ?? value;
}
