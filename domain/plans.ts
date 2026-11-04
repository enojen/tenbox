import { z } from "zod";
import { badFileError, badInputError } from "./errors/index.ts";
import { noPlanError } from "./errors/plans.ts";
import { GroupSchema, groupIssues } from "./groups.ts";
import { DEFAULT_KIND, LensSchema, TaskKindSchema } from "./kinds.ts";
import { planMdFile } from "./taskDirs.ts";
import type { Task } from "./tasks.ts";
import { jsons } from "./utils.ts";

const text = z.string().min(1);

const GREP_WORD = /\bgrep\b/i;

/** An example names a behaviour, so its texts may not ask for a grep. */
const exampleText = text.superRefine((value, ctx) => {
  if (GREP_WORD.test(value))
    ctx.addIssue({
      code: "custom",
      message: `an example names a behaviour, not a grep: "${value}"`,
    });
});

/** The longest `plan.md` that `tenbox plan done` and `tenbox approve` accept. */
export const PLAN_MD_MAX_LINES = 60;

/** `id` is the two-digit part number of the part file, `01`. */
export const PlanPartSchema = z.object({
  id: text,
  difficulty: z.enum(["easy", "hard"]),
  /** Git pathspecs of the part's files; without them the whole worktree counts. */
  files: z.array(text).optional(),
});

export type PlanPart = z.infer<typeof PlanPartSchema>;

const QuestionSchema = z.object({
  kind: z.enum(["technical", "product", "contract", "risk"]),
  text,
  blocking: z.boolean(),
});

/** One before and after of a part; `title` names the worker test that proves it. */
export const ExampleSchema = z.object({
  part: text,
  title: exampleText,
  before: exampleText,
  after: exampleText,
});

/** One real choice of the plan: `taken` is the chosen option, counted from 1. */
const PlanDecisionSchema = z
  .object({
    title: text,
    options: z.array(text).min(2),
    taken: z.number().int().min(1),
    reason: text,
  })
  .refine((decision) => decision.taken <= decision.options.length, {
    path: ["taken"],
    message: "must be the number of one of the options",
  });

export type PlanDecision = z.infer<typeof PlanDecisionSchema>;

/** What the planner returns and `tenbox plan done` saves. */
const PlanResultSchema = z
  .object({
    summary: z.string(),
    estimated_lines: z.number().int().nonnegative(),
    parts: z.array(PlanPartSchema),
    examples: z.array(ExampleSchema),
    decisions: z.array(PlanDecisionSchema),
    lenses: z.array(LensSchema),
    questions: z.array(QuestionSchema),
    groups: z.array(GroupSchema).optional(),
    /** Missing in the plans written before kinds. */
    kind: TaskKindSchema.default(DEFAULT_KIND),
  })
  .superRefine((plan, ctx) => {
    const partIds = plan.parts.map((part) => part.id);
    plan.examples.forEach((example, index) => {
      if (partIds.includes(example.part)) return;
      const message = `the example "${example.title}" names part ${example.part}, which is not a plan part`;
      ctx.addIssue({ code: "custom", path: ["examples", index, "part"], message });
    });
    if (!plan.groups) return;
    for (const message of groupIssues(plan.groups, partIds)) {
      ctx.addIssue({ code: "custom", path: ["groups"], message });
    }
  });

export type PlanResult = z.infer<typeof PlanResultSchema>;

/** The plan result in `--json` input; `bad-input` when it is not JSON or does not match the schema. */
export function parsePlan(planText: string): PlanResult {
  const result = jsons.check(PlanResultSchema, planText);
  if (!result.ok) throw badInputError("the plan result", result.issues);
  return result.value;
}

/** The plan result in the text of `plan.json`; `bad-file` when it is not JSON or does not match the schema. */
export function readPlan(planText: string, file: string): PlanResult {
  const result = jsons.check(PlanResultSchema, planText);
  if (!result.ok) throw badFileError(file, result.issues);
  return result.value;
}

/** `plan.md` (null when missing) of the `.tenbox/` folder `dir`. */
export interface PlanMd {
  dir: string;
  planMd: string | null;
}

/** Checks `plan.md` as `tenbox plan done` and `tenbox approve` do: `no-plan` when missing, `bad-file` over the limit. */
export function checkPlanMd(texts: PlanMd): void {
  if (texts.planMd === null) throw noPlanError(texts.dir);
  const lines = lineCount(texts.planMd);
  if (lines > PLAN_MD_MAX_LINES) {
    throw badFileError(planMdFile(texts.dir), [
      `${lines} lines; the limit is ${PLAN_MD_MAX_LINES}`,
    ]);
  }
}

/** A last line without a newline counts too. */
function lineCount(content: string): number {
  if (content === "") return 0;
  const lines = content.split("\n");
  return content.endsWith("\n") ? lines.length - 1 : lines.length;
}

const INDENT = "  ";
const TAKEN_MARK = "* ";

/** The plan as text lines: parts, examples, decisions with the taken option, questions. */
export function planLines(plan: PlanResult): string[] {
  return [
    ...section(
      "Parts",
      plan.parts.map((part) => [`${part.id} (${part.difficulty})`]),
    ),
    ...section("Examples", plan.examples.map(exampleLines)),
    ...section("Decisions", plan.decisions.map(decisionLines)),
    ...section("Questions", plan.questions.map(questionLines)),
  ];
}

type Example = z.infer<typeof ExampleSchema>;
export type Question = z.infer<typeof QuestionSchema>;

/** A heading, then each entry indented; `none` for no entry. */
function section(heading: string, entries: string[][]): string[] {
  const lines = entries.length === 0 ? ["none"] : entries.flat();
  return [heading, ...lines.map((line) => INDENT + line)];
}

function exampleLines(example: Example): string[] {
  return [
    `${example.part} · ${example.title}`,
    ...labelled(`${INDENT}before: `, example.before),
    ...labelled(`${INDENT}after: `, example.after),
  ];
}

/** The label before the first line; the next lines line up under the first. */
function labelled(label: string, value: string): string[] {
  const pad = " ".repeat(label.length);
  return value.split("\n").map((line, index) => (index === 0 ? label : pad) + line);
}

function decisionLines(decision: PlanDecision): string[] {
  const options = decision.options.map((option, index) => {
    const number = index + 1;
    if (number !== decision.taken) return `${INDENT}${INDENT}${number}. ${option}`;
    return `${INDENT}${TAKEN_MARK}${number}. ${option} (taken)`;
  });
  return [decision.title, ...options, `${INDENT}reason: ${decision.reason}`];
}

function questionLines(question: Question): string[] {
  const blocking = question.blocking ? "(blocking) " : "";
  return [`[${question.kind}] ${blocking}${question.text}`];
}

/** The part id and file name of the one part of a `docs` task. */
const DOCS_PART_ID = "01";
export const DOCS_PART_FILE = "01-docs.md";

/** The plan result of a `docs` task: one easy part, no examples, no decisions, no questions. */
export function docsPlanOf(t: Task): PlanResult {
  return {
    kind: "docs",
    summary: t.title,
    estimated_lines: 0,
    parts: [{ id: DOCS_PART_ID, difficulty: "easy" }],
    examples: [],
    decisions: [],
    lenses: [],
    questions: [],
  };
}

/** `plan.md` of a `docs` task: the title and the task text. */
export function renderDocsPlanMd(t: Task): string {
  return `# ${t.id} · ${t.title}\n\n${t.description.trim() || t.title}\n`;
}

/** The part file of a `docs` task. */
export function renderDocsPart(): string {
  return `# ${DOCS_PART_ID} · docs\nstatus: todo\nfiles: the documentation files the task names\nacceptance:\n- the change the task text asks for is in the docs\nresult:\n`;
}
