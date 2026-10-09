import path from "node:path";
import { z } from "zod";
import { badPlanError } from "./errors/tasks.ts";
import { issueLines, parseObject } from "./utils.ts";

const text = z.string().min(1);

/** `plan.json` in a `.tenbox/` folder: the validated planner result. */
export const planFile = (dir: string): string => path.join(dir, "plan.json");

/** `id` is the two-digit part number of the part file, `01`. */
export const PlanPartSchema = z.object({ id: text, difficulty: z.enum(["easy", "hard"]) });

const QuestionSchema = z.object({
  kind: z.enum(["technical", "product", "contract", "risk"]),
  text,
  blocking: z.boolean(),
});

/** What the planner returns and `tenbox plan done` saves. */
const PlanResultSchema = z.object({
  summary: z.string(),
  estimated_lines: z.number().int().nonnegative(),
  parts: z.array(PlanPartSchema),
  criteria: z.array(z.string()),
  lenses: z.array(z.enum(["security", "contract"])),
  questions: z.array(QuestionSchema),
});

export type PlanResult = z.infer<typeof PlanResultSchema>;

/** The plan result in the text; `bad-plan` when it is not a JSON object or does not match the schema. */
export function parsePlan(planText: string): PlanResult {
  const parsed = PlanResultSchema.safeParse(parseObject(planText));
  if (!parsed.success) throw badPlanError(issueLines(parsed.error));
  return parsed.data;
}

/** The plan result in the text; null when it is not valid. */
export function readPlan(planText: string): PlanResult | null {
  const parsed = PlanResultSchema.safeParse(parseObject(planText));
  return parsed.success ? parsed.data : null;
}
