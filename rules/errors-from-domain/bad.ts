// Every line marked "lint:" must be reported by the rule.
declare class TenboxError extends Error {
  constructor(message: string, code: string);
}

export function samples(): void {
  throw new TenboxError("git", "git failed"); // lint: error built outside domain/errors/
}

export function other(): TenboxError {
  return new TenboxError("tmux", "tmux failed"); // lint: error built outside domain/errors/
}
