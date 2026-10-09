import path from "node:path";
import { z } from "zod";
import { badBuildError } from "./errors/tasks.ts";
import { ProofSchema } from "./proof.ts";
import { issueLines, parseObject } from "./utils.ts";

/** `build.json` in a `.tenbox/` folder: the last build result. */
export const buildFile = (dir: string): string => path.join(dir, "build.json");

const UnprovenSchema = z.object({ part: z.string(), reason: z.string() });

/** What `/tenbox-build` returns and `tenbox build done` saves; other keys are kept. */
const BuildResultSchema = z.looseObject({
  status: z.enum(["ready-for-you", "needs-you", "failed", "not-approved"]),
  round: z.number().int().nonnegative(),
  proofs: z.array(ProofSchema),
  attention: z.array(z.string()),
  nice_to_have: z.array(z.string()),
  unproven: z.array(UnprovenSchema),
});

export type BuildResult = z.infer<typeof BuildResultSchema>;

/** A part a reviewer found without a proof; `part` is the `NN` of the part file name. */
export type Unproven = BuildResult["unproven"][number];

/** The build result in the text; `bad-build` when it is not a JSON object or does not match. */
export function parseBuild(text: string): BuildResult {
  const parsed = BuildResultSchema.safeParse(parseObject(text));
  if (!parsed.success) throw badBuildError(issueLines(parsed.error));
  return parsed.data;
}

/** The build result in the text; null when it is not valid. */
export function readBuild(text: string): BuildResult | null {
  const parsed = BuildResultSchema.safeParse(parseObject(text));
  return parsed.success ? parsed.data : null;
}
