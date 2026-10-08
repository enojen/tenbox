const SECTION_START = /^## /;

/** `<id> · <title>`, or just the id when the task has no title. */
export function prTitle(id: string, title: string | null): string {
  return title === null || title === "" ? id : `${id} · ${title}`;
}

/** The text under `## <heading>` up to the next `## `; null when missing or empty. */
export function planSection(planText: string, heading: string): string | null {
  const lines = planText.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => SECTION_START.test(line));
  const text = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  return text === "" ? null : text;
}

/** Risks and attention, Summary, Checks; a part with no text is left out. */
export function prBody(planText: string | null, checksSummary: string | null): string {
  const risks = planText === null ? null : planSection(planText, "Risks and attention");
  const summary = planText === null ? null : planSection(planText, "Summary");
  const parts = [
    risks === null ? null : `## Risks and attention\n\n${risks}`,
    summary === null ? null : `## Summary\n\n${summary}`,
    checksSummary === null || checksSummary === "" ? null : `## Checks\n\n${checksSummary}`,
  ];
  return parts.filter((part) => part !== null).join("\n\n");
}
