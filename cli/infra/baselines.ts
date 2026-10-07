import path from "node:path";
import { type Baseline, type FailureLine, failureLine } from "../domain/failures.ts";
import type { BaselineMeta, BaselineStore } from "../ports.ts";
import { files } from "./files.ts";

const render = (lines: FailureLine[]): string => (lines.length ? `${lines.join("\n")}\n` : "");
const parse = (text: string): FailureLine[] => text.split("\n").filter((l) => l.length > 0).map(failureLine);
const renderMeta = (sha: string, m: BaselineMeta): string => `sha=${sha}\ndate=${m.date}\ncmd=${m.cmd}\nexit_code=${m.exit_code}\n`;

/** `<root>/<project>/<check>/<sha>.txt` plus `<sha>.meta`: the devbox `wtbase` layout. */
export function fileBaselineStore(root: string): BaselineStore {
  const dir = (project: string, check: string) => path.join(root, project, check);
  const txt = (project: string, check: string, sha: string) => path.join(dir(project, check), `${sha}.txt`);
  const meta = (project: string, check: string, sha: string) => path.join(dir(project, check), `${sha}.meta`);

  const find = async (project: string, check: string, sha: string): Promise<Baseline | null> => {
    const text = await files.read(txt(project, check, sha));
    return text === null ? null : { sha, lines: parse(text) };
  };

  return {
    find,
    async newest(project, check) {
      const d = dir(project, check);
      let newest: { sha: string; mtime: number } | null = null;
      for (const f of await files.list(d)) {
        if (!f.endsWith(".txt")) continue;
        const mtime = await files.mtime(path.join(d, f));
        if (!newest || mtime > newest.mtime) newest = { sha: path.basename(f, ".txt"), mtime };
      }
      return newest ? find(project, check, newest.sha) : null;
    },
    async save(project, check, baseline, info) {
      await files.write(txt(project, check, baseline.sha), render(baseline.lines));
      await files.write(meta(project, check, baseline.sha), renderMeta(baseline.sha, info));
    },
  };
}
