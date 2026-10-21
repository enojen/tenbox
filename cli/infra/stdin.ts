/** What a hook command reads from Claude Code. */
export const stdin = {
  /** All of stdin as text; empty when none is attached. */
  read: (): Promise<string> => Bun.stdin.text(),
};
