const MS_PER_SECOND = 1000;

/** Strings: blank means empty or only whitespace. */
export const strings = {
  isNotBlank: (value: unknown): value is string => typeof value === "string" && value.trim() !== "",
};

export const durations = { MS_PER_SECOND };

export type Minutes = number;

export interface Checked<T> {
  ok: true;
  value: T;
}

export type Check<T> = Checked<T> | null;
