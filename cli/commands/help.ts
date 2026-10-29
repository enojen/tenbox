import { usageError } from "../../domain/errors/usage.ts";
import { TASK_KINDS } from "../../domain/kinds.ts";

/** What `tenbox help <command>` prints and returns. */
export interface CommandHelp {
  ok: true;
  command: string;
  usage: string;
  help: string;
}

/** A command and its usage line, as `main.ts` lists them. */
interface HelpRequest {
  name: string;
  usage: string;
}

const TASK_DRAFT_HELP = `Flags:
  --title X, --why X, --what X, --done X   the four parts of the task text; all four are required
  --label L                                a label; repeat it for more
  --json '{ title, why, what, done, labels }'   the same as one JSON input, instead of the flags`;

/** The text of each command under its usage line; a command with no entry has no help. */
const COMMAND_TEXTS: Record<string, string> = {
  start: `Opens the task worktree and branch, the task dir and the background plan session.

Flags:
  --title "..."   the task title when the tracker has none
  --base <branch> the branch the task starts from; default the manifest base
  --kind K        the task kind: ${TASK_KINDS.join(", ")}
  --no-setup      skip the manifest setup command
  --no-claude     do not start the background session

Output: { ok, task, title, project, worktree, branch, base, created, task_md, setup, tracker, claude }
  claude.state is started, exists, skipped or unavailable.

Example:
  tenbox start TEN-301 --kind small`,

  check: `Runs the checks of the manifest in the task worktree and compares them with the baseline.

Flags:
  --group N       the group to check; default the task worktree
  --tier T        fast or full; default fast
  --round N       the round to write to; default the next one
  --base <branch> the baseline branch
  --timeout S     seconds per check; default 600

Output: { ok, task, round, worktree, commit, base, checks, summary, file, tier }
  ok is false when a check has a new failure; the exit code stays 0.

Example:
  tenbox check TEN-301 --tier full`,

  worktree: `Creates the worktree of a group above 1, or keeps the one that exists.

Flags:
  --group N   the group; required

Output: { ok, task, group, worktree, branch, created }

Example:
  tenbox worktree TEN-301 --group 2`,

  "merge-check": `Merges the open task PRs in a temporary worktree and runs the checks there.

Flags:
  --base <branch> the branch to merge into; default the manifest base

Output: { ok, base, prs, order, checks, summary }
  order lists the branches in merge order, lowest PR number first.

Example:
  tenbox merge-check`,

  close: `Cleans up a merged task: stops its session, writes stats, removes the worktrees and branches.

Flags:
  --force   close a task whose PR is not merged

Output: { ok, task, project, forced, pull, stats, session, worktree, branch, remote_branch, groups?, tracker, comment }

Example:
  tenbox close TEN-301`,

  pr: `Pushes each group of the task and creates or updates its PR with gh.

Flags:
  --ready   mark the PR ready for review; default draft
  --force   push with a force
  --wait    wait for the CI checks of each pushed group

Output: { ok, task, groups: [{ group, branch, state, pr, files?, ci? }] }
  pr is { number, url, draft } or null for a group that waits.

Example:
  tenbox pr TEN-301 --ready`,

  part: `Checks and records the last commit of one part: it exists, is on HEAD, is new and touches the part's files.

Input: the action done, then the task id.
Flags:
  --part NN     the part id; required
  --commit <sha>  the last commit of the part
  --since <sha>   the commit the part started after
  --group N     the group of the part

Output: { ok, task, part, commit }

Example:
  tenbox part done TEN-301 --part 01 --commit abc1234`,

  proof: `Records one proof by hand: the test that failed before the code.

Flags:
  --part NN    the part id
  --file F     the test file
  --test T     the test name
  --failure X  how it failed

Output: { ok, task, proof: { part, file, test, failure }, file }

Example:
  tenbox proof TEN-301 --part 01 --file cli/a.test.ts --test "it works" --failure "got 1, want 2"`,

  decide: `Saves answers and plan decision overrides in decisions.md and starts a new build.

Input (--json, required): a list of items, each one
  { question?, answer }       an answer, with the question it answers
  { decision, taken }         a plan decision title and its option, counted from 1
Flags:
  --no-build   save only; send no build prompt

Output: { ok, task, sent? }
  sent is the build prompt; missing with --no-build.

Example:
  tenbox decide TEN-301 --json '[{ "decision": "Storage", "taken": 2 }]'`,

  plan: `plan done saves the plan result as plan.json; plan show prints the plan for a person.

Input (plan done, --json, required): the plan result
  { kind, summary, estimated lines, parts, examples, decisions, lenses, questions, groups }

Output: plan done { ok, task, file }; plan show { ok, task, file, parts, examples, decisions, questions }

Example:
  tenbox plan show TEN-301`,

  build: `build sends /tenbox-build to a new background session; build done saves the build result.

Input (build done, --json, required): the build result
  { status, round, proofs, attention, nice-to-have, unproven }

Output: build { ok, task, sent }; build done { ok, task, file, findings, pr? }

Example:
  tenbox build TEN-301`,

  attach: `Opens the background session of the task in your terminal.

Output: { ok, task, session }

Example:
  tenbox attach TEN-301`,

  hook: `hook blocked runs as a Claude Code Notification hook: it sends a notification when the session waits on a permission prompt. It reads the hook JSON on stdin.

Output: { ok, task, sent }
  sent is false when no line went out; the exit code stays 0.

Example:
  tenbox hook blocked TEN-301`,

  wait: `Waits until the task files change, then prints what changed.

Flags:
  --for K     what to wait for: plan, build, round, decision or any; required
  --timeout S seconds to wait; default 600

Output: plan and build { ok, task, event, file }; round { ok, task, round, status, file }; decision and any { ok, task, event, file, decision }
  decision is the open decision card or null.

Example:
  tenbox wait TEN-301 --for plan`,

  answer: `Answers the open decision card with an option, and resumes the build.

Input: the option number, counted from 1, or --auto.
Flags:
  --auto   take the recommended option when the card deadline has passed

Output: { ok, task, ... } the chosen option and the resumed session; with --auto, state is answered or skipped.

Example:
  tenbox answer TEN-301 2`,

  approve: `Approves the plan after the same checks as plan done.

Output: { ok, task, file, at, sha }

Example:
  tenbox approve TEN-301`,

  approved: `Checks that the plan is approved and has not changed since.

Output: { ok, task, ... } the approval; a failure code when it is missing or old.

Example:
  tenbox approved TEN-301`,

  stats: `Prints the numbers, proofs and points of the task.

Output: { ok, task, source, runs, ... } source is stats.json after a close, else the live runs.

Example:
  tenbox stats TEN-301`,

  status: `Prints the status report of the task from its files, session and PR.

Output: { ok, task, status, round, parts, session, pr, check }

Example:
  tenbox status TEN-301`,

  list: `Lists the status report of every task worktree of the project.

Output: { ok, tasks: [status report] }

Example:
  tenbox list`,

  machine: `Runs a tenbox command of a task on the cluster, and manages its Jobs and volume.

Input: run takes the command after --: tenbox start, build or close.
Flags:
  --follow   with logs: keep the stream open
  --title X, --force   passed to the command after --

Output: run { ok, task, cmd, url }; stop { ok, task, stopped }; rm { ok, task, volume }; ls { ok, runs }; logs { ok, task, job, status }

Example:
  tenbox machine run TEN-301 -- tenbox build TEN-301`,

  task: `task new writes a task to the tracker of the project.

${TASK_DRAFT_HELP}

Output: { ok, task, url, created }
  created is false when an open task with the same title exists.

Example:
  tenbox task new --title "Fix X" --why "..." --what "..." --done "..."`,

  report: `Opens an issue about Tenbox itself.

${TASK_DRAFT_HELP}
  --repo R   the repository: tenbox or tenyard; default tenbox

Output: { ok, task, url, created }

Example:
  tenbox report --title "Bug" --why "..." --what "..." --done "..." --repo tenbox`,

  install: `Links agents, workflows and the skill of this checkout into ~/.claude/.

Output: { ok, claude_dir, links: [{ name, source, link, state }] }
  ok is false when a link was skipped; the exit code stays 0.

Example:
  tenbox install`,
};

/** The usage line and full help of one command; usage error when it has no text. */
export function commandHelp(request: HelpRequest): CommandHelp {
  const { name, usage } = request;
  const text = COMMAND_TEXTS[name];
  if (text === undefined) throw usageError(`no help for command: ${name}`);
  return { ok: true, command: name, usage, help: `${usage}\n\n${text}` };
}
