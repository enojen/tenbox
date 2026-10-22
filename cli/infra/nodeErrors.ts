/** True when `e` is a Node error whose `code` is one of `codes`, such as `ENOENT`. */
export const hasErrorCode = (e: unknown, codes: readonly string[]): boolean =>
  e instanceof Error && "code" in e && codes.includes(String(e.code));
