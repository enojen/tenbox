# Tenbox

Tenbox runs one tracker task through plan, build, check, review and merge with Claude Code
workflows and custom subagents. It is a thin layer: Claude Code does the agents and the
orchestration; Tenbox adds the roles, two workflows, a task layout on disk and a small CLI
for the steps an agent should not improvise.

This README describes what is built and how it runs today. Every statement here must be
true of the code. The target design (sandbox, QA, parallel workers, the panel) is in
[`docs/design.md`](docs/design.md); it describes later phases, not today's behaviour.

**Status**: phase 1 is done; phase 2 has `tenbox close`, `tenbox pr`, `/tenbox-close` and
`tenbox merge-check`. See [Roadmap](#roadmap).

## How a task runs today

```
tenbox start TEN-301              worktree ~/wt/<project>/TEN-301, branch feat/TEN-301, .tenbox/task.md (a link to the task dir),
                                  claude --bg in the task worktree, started with /tenbox-plan TEN-301
  /tenbox-plan TEN-301            planner writes plan.md, parts, questions.md     👤 you read it
tenbox approve TEN-301            record the approval: the time and the sha of plan.md  👤 you approve
tenbox build TEN-301              starts claude --bg in the task worktree with /tenbox-build and the plan as JSON
tenbox attach TEN-301             open the newest background session of the task in this terminal
  /tenbox-build {...}             rounds of build + tenbox check (by the worker) → review;
                                  tenbox build done checks the end, and a ready-for-you end opens the draft PR
  review the diff by hand
tenbox pr TEN-301 [--ready] [--force] [--wait]
                                  push the branch, create or update the PR (by hand, or for --ready)
  merge on GitHub (squash)        👤 you merge
/tenbox-close TEN-301             in a claude session in the main checkout: one runner step, tenbox close TEN-301
  tenbox close TEN-301            pull the base in the main checkout, write stats.json in the task dir, stop the task's background sessions,
                                  remove worktree and local branch, delete the remote branch, set the tracker to done
```

`/tenbox-plan` and `/tenbox-build` run in a background `claude` session (`claude --bg`) in the
task worktree: `tenbox start` starts one with `/tenbox-plan`, and `tenbox build` starts a new
one with `/tenbox-build`. Both return at once. `--allowedTools Workflow` lets the session start
the workflow without a prompt. `tenbox attach <id>` opens the newest one; `claude agents` lists
them. `claude --bg` refuses a workspace that Claude Code does not trust; a task worktree of a
trusted repository is trusted. Both also pass a `Notification` hook for permission prompts
(`--settings`), so a session that waits for you sends the `blocked` notification. A headless `claude -p` run stops at the workflow approval. To send review feedback into a new build,
add `feedback` to the args that `tenbox build` sends:
`/tenbox-build { "task": "TEN-301", "parts": [...], "lenses": [...], "feedback": "..." }`.

## The CLI: `tenbox`

TypeScript on Bun. Every command prints one JSON document on stdout; human text goes to
stderr. A failure prints `{ "ok": false, "error", "code" }` and exits 1, or 2 for a usage
error. `TENBOX_DEBUG=1` logs every spawned command and prints stacks.

| Command | Does |
|---|---|
| `tenbox start <id> [--title "..."] [--base <branch>] [--no-setup] [--no-claude]` | Task worktree and branch from the base, the task dir `~/.tenbox/<project id>/<id>/` with `task.md` (with the tracker's comments) and `task.json` from the tracker (or from `--title`), `parts/` and `rounds/`, `project.json` `{ id, name }` in the project folder, and `.tenbox` in the worktree as an absolute symlink to the task dir (kept when it exists, also a real `.tenbox/` directory of an older task), the manifest `setup` command, tracker status to in progress. Then, in the task worktree, `claude --bg --model <model> --add-dir <task dir> --settings <blocked hook JSON> -n <names.session> --allowedTools Workflow -- "/tenbox-plan <id>"`, so the plan starts at once and `.tenbox` needs no permission prompt; the `--settings` JSON holds the `blocked` hook (see `tenbox hook`). `claude` in the output holds `session` (the `-n` name) and `state`: `started`; `exists` when `claude agents` lists a background session in the task worktree (none is started); `skipped` with `--no-claude`; `unavailable` without `claude` in `PATH`. When `claude --bg` fails, such as on an untrusted workspace, start fails with `claude` (exit 1) and Claude Code's message. Sets `worktree.baseRef: head` in the main checkout's `.claude/settings.local.json`. Writes `id:` to the main checkout's `tenbox.yaml` when it is missing. Before it creates the worktree, start checks that `tenbox.yaml` is committed on the base and has no local changes; otherwise it fails with `manifest-not-committed` (exit 1) and says to commit `tenbox.yaml` on the base, so a new id also needs a commit before the next start. Safe to run twice |
| `tenbox part done <id> --part NN [--commit <sha>] [--since <sha>] [--group N]` | Checks the commit a worker returns for a part before its check. Exits 0 and prints `{ ok, task, part, commit }` (full sha) when the commit exists, is on `HEAD`, is after `--since` (default: the merge-base of `HEAD` and the manifest base), changes a file of the part's `files` list in `plan.json` (a part without `files` covers the whole worktree), and nothing in those files is staged or unstaged. Otherwise `part-not-committed` (exit 1, naming the file for a dirty one); a part not in `plan.json` gives `unknown-part`. `--group N` runs in the group worktree |
| `tenbox worktree <id> --group N` | Makes the worktree of group `N` from `plan.json`, or finds it. Group 1 is the task worktree on the task branch. Group N > 1 gets `~/wt/<project>/<id>-N` on `<task branch>-N` (`feat/<id>-N`): a group with no `needs` starts from the manifest base; otherwise it starts from the branch of its first need and the branches of the other needs are merged in. `.tenbox` links to the task dir, `setup` runs, and `.tenbox/groups/N/group.json` `{ start }` keeps the start commit. Prints `{ ok, task, group, worktree, branch, created }`; a second run prints `created: false`. A group that `plan.json` does not list gives `unknown-group` (exit 1); a merge conflict gives `merge-conflict` (exit 1, with the files) and removes the worktree and branch again. When the group branch already exists without a worktree, it is reused with its commits and `group.json` `start` is the commit of the first need (or the base), so only its own commits are replayed later. A missing `--group` is a usage error (exit 2) |
| `tenbox check <id> [--group N] [--tier fast\|full] [--round N] [--base <branch>] [--timeout 600]` | Runs the manifest checks of one tier (default `fast`) in the task worktree and keeps only new failures (see below). A check with a new failure runs once more; a new failure the second run does not repeat is `flaky`: it is listed in the check's `flaky` array (always present) and does not fail the check. With `--group N` (above 1) it runs in the worktree of group `N` (made when missing) and writes to `.tenbox/groups/N/rounds/R/`, with rounds counted per group; `--group 1` is the task. Writes `.tenbox/rounds/N/checks.json` (`checks-full.json` for `full`) and `checks/<name>.log`; without `--round`, `fast` takes the next free round and `full` the newest one (1 when there is none). The result has `tier`. `--tier full` with no `full` checks prints `ok: true` with `checks: []`; any other tier is a usage error (exit 2) |
| `tenbox approve <id>` | Refuses a task with no `.tenbox/plan.md` (`no-plan`, exit 1). Writes `.tenbox/approved.json` `{ at, plan_sha }`: the ISO time and the SHA-256 hex of `plan.md`. A second run overwrites it. Prints `{ ok, task, file, at, plan_sha }`. `tenbox approved` reads it |
| `tenbox approved <id>` | Checks the approval, as `tenbox build` does before it sends the build. Fails with `not-approved` (exit 1) when `.tenbox/approved.json` is missing, and with `plan-changed` (exit 1) when the SHA-256 of `plan.md` differs from `plan_sha`; both errors name `tenbox approve <id>`. Prints `{ ok, task, file, at, plan_sha }` |
| `tenbox build <id>` | Checks the approval as `tenbox approved` does (`not-approved`, `plan-changed`, exit 1), then reads `.tenbox/plan.json` (missing or not valid: `no-plan`, exit 1) and runs `claude --bg` in the task worktree as `tenbox start` does (with the same `--settings` hook), with `/tenbox-build <args>`: `<args>` is one line of JSON, `{ task, parts, lenses, groups }` with the `parts`, `lenses` and `groups` of `plan.json` (no `groups` key when the plan has none); an unapproved or changed plan starts nothing. It returns before the workflow ends. A background session of the task worktree that works (`state: working` in `claude agents --json`; a `blocked` session waits for a person, as a planner does after its plan, and does not count) gives `session-busy` (exit 1), naming `tenbox attach <id>`, and starts nothing. A failed `claude --bg` gives `claude` (exit 1) with Claude Code's message. Prints `{ ok, task, sent }` |
| `tenbox attach <id>` | Lists the sessions with `claude agents --json --cwd <task worktree>` and runs `claude attach <id>` in this terminal for the newest background session whose `cwd` is the task worktree. Prints `{ ok, task, session }` after you leave the session. Without one it fails with `no-session` (exit 1), naming `tenbox build <id>`. Tenbox stores no session id |
| `tenbox hook blocked <id>` | Run by Claude Code, not by hand: the `Notification` hook (matcher `permission_prompt`) that `tenbox start` and `tenbox build` pass to `claude --bg` with `--settings`, so a session that waits on a permission prompt tells you. Reads the hook input JSON on stdin (`message`), finds the task worktree and sends one `blocked` notification. A `tenbox answer` resume passes no `--settings` (any other flag starts a copy of the session); the session keeps the hook it was started with. Always exits 0, so the hook never blocks the session; prints `{ ok, task, sent }`, with `sent: false` and one stderr line when stdin is not a JSON object, the task has no worktree or no line went out (no `notify.ntfy`). Any other name than `blocked` gives `usage` (exit 2) |
| `tenbox plan done <id> --json '<result>'` | Run by `/tenbox-plan` through the runner; by hand only when the plan was made without the workflow. Validates the planner result with zod and writes it to `.tenbox/plan.json`, then sends the `plan-ready` notification. A result that is not JSON, or has a wrong `estimated_lines` (a whole number), a part without `id`, a `difficulty` other than `easy` or `hard`, a criterion with the word `grep` (any case; the message names the criterion), or `groups` that break the group rules (see Task files, `plan.json`), gives `bad-plan` (exit 1) and writes nothing; a missing `--json` or another sub-command gives `usage` (exit 2). Prints `{ ok, task, file }` |
| `tenbox build done <id> --json '<result>'` | Run by `/tenbox-build` through the runner at every end status. Validates the build result with zod. A `ready-for-you` result is then checked before anything is written, for each group of `plan.json` (a plan without groups is group 1): the highest round's `checks.json` of the group must have run at the group worktree's `HEAD` (else `checks-stale`, exit 1, as `tenbox pr` gives it) and have `ok: true` (else `check-failed`, exit 1, with the check summary in the message). Then it runs the `full` tier as `tenbox check <id> --group N --tier full` does, in the current round (`rounds/N/checks-full.json`), for each group whose recipe `tier` is `full`, or for group 1 of a plan without groups; new failures give `check-failed` (exit 1). A `check-failed` error has `details: { group, tier }`. `needs-you` and `failed` results skip these checks. The result is then written to `.tenbox/build.json`; its `proofs` are appended to `.tenbox/proofs.json`. A second run keeps the earlier `unproven` items first; `status`, `round`, `attention` and `nice_to_have` are the new ones. A result that is not JSON, or has an unknown `status`, a `round` that is not a whole number, a proof with a blank field, or a decision card whose `recommended` is not the number of one of its options or whose `kind` is missing or unknown, gives `bad-build` (exit 1) and writes nothing; a missing `--json` gives `usage` (exit 2). A result with a decision card (`decision: { title, options, recommended, reason, auto, kind }`, `recommended` counted from 1; `kind` is `migration`, `data-delete`, `feature-delete`, `contract`, `paid-service`, `locked-file`, `scope` or `other`) gets `deadline`: the call time + 30 minutes when `auto` is true and the kind is not never-auto, else `null`. A `needs-you` card with `auto: true` and a kind other than the six never-auto ones (all but `scope` and `other`) also starts `tenbox answer <id> --auto` in the background (tenbox itself, in its own process group, with its output appended to `.tenbox/auto-answer.log`), so the card gets an answer with no human command. A written `ready-for-you` result then opens the PR as `tenbox pr <id>` does with no flag (a draft, no CI wait) and adds its JSON as `pr`; when that throws, `pr` is `{ ok: false, error }` and the exit code stays 0. Prints `{ ok, task, file }`, and `pr` for `ready-for-you` |
| `tenbox answer <id> <n>` | Answers the decision card of a `needs-you` `build.json` with option `n` (counted from 1) and resumes the build run that asked it. Appends the note `- <card title> Answer: <n>. <option>` to `.tenbox/decisions.md`, writes `answered: { option, at, auto: false }` into `build.json`, finds the newest `tenbox-build` run of the task worktree in Claude Code's session files (`<run id>.json`: run id, script path, args; the session folder is the full session id), stops the task's background sessions and runs `claude --bg --resume <session id> -- "<prompt>"` in the task worktree, with no other flag (any other flag starts a copy of the session). The prompt asks for the Workflow tool with that script path, `resumeFromRunId` and the run's args plus `answer: { round, part, option, text }`; args that are JSON text, as `tenbox build` sends them, are parsed back into their object first, so the run keeps its `parts`, `lenses` and `groups`. Fails, before it writes anything, with `no-decision` (exit 1) when `build.json` has no `needs-you` card, `answered` (exit 1) when the card is answered, `no-run` (exit 1) without a `tenbox-build` run, and `usage` (exit 2) when `n` is not the number of an option. When `claude` fails (`claude` or `no-command`, exit 1), `build.json` is written back without `answered`, so the same answer can be given again; `decisions.md` keeps one line for it. Prints `{ ok, task, option, run, session }` |
| `tenbox answer <id> --auto` | Automatic continue, started by `tenbox build done`. Reads `build.json`; when it holds an unanswered `needs-you` card with `auto: true`, it waits until the card's `deadline`, looking at `build.json` once a second, then answers with the recommended option as `tenbox answer <id> <n>` does: the `decisions.md` note ends with `(auto: no answer in 30 min)` and `answered` has `auto: true`. Prints `{ ok, task, state: "answered", option, run, session }`. A card with `auto: false`, a card of a never-auto kind, an answered card (also one a person answers while it waits) and a card that a newer `tenbox build done` replaced (its `deadline` differs) change nothing: it prints `{ ok, task, state: "skipped" }`. Never auto: a card of kind `migration`, `data-delete`, `feature-delete`, `contract`, `paid-service` or `locked-file` (`NEVER_AUTO` in `domain/answers.ts`) gets `deadline: null` and no timer, and `--auto` skips it even with `auto: true`; the worker picks the kind (`agents/worker.md`) |
| `tenbox wait <id> --for plan\|build\|round\|decision\|any [--timeout 600]` | `plan` and `build`: checks once a second for `.tenbox/plan.json` or `.tenbox/build.json` and prints `{ ok, task, file }` as soon as it exists (an earlier `build.json` makes it return at once). `round`: notes the `rounds/N/checks.json` files and the text of `build.json` at the start and returns at the first change: `{ ok, task, round, status, file }` with `status: "running"` and the new round's `checks.json`, or the `status` and `round` of a `build.json` that is written or changed. `decision`: returns `{ ok, task, event: "decision", file, decision }` when `build.json` is `needs-you` with a card that has no `answered` (checked at once and then every second; an answered card does not count, so the wait is safe after `tenbox answer`). `any`: returns the same shape with `event` `decision` (as above), `build` (a `build.json` written after the command started) or `plan` (a `plan.json` written after the command started), in that order when several are true; `decision` is the card or `null`. It uses the file modification time like `round`, so a `plan.json` or `build.json` from before the command does not end it. Fails with `wait-timeout` (exit 1) after `--timeout` seconds; a missing or other `--for` gives `usage` (exit 2) |
| `tenbox pr <id> [--ready] [--force] [--wait]` | `tenbox build done` opens the draft PR of a ready build the same way; run it by hand for `--ready` or after a failed run. Opens one PR per group of `plan.json` (a plan without groups is one group 1). A group whose needs are all merged (each need's PR is `MERGED`) is pushed, then its PR is created (a draft unless `--ready`) or updated; a group with needs and no PR yet waited for them: it is first rebased onto the base (`git fetch`, then `git rebase --onto origin/<base> <start>` with `start` from `.tenbox/groups/<N>/group.json`, which then holds the new base), so only its own commits stay, and pushed with `--force-with-lease`; a conflict aborts the rebase, gives the group `conflict` with `files`, pushes nothing for it, and the other groups go on; a group with an unmerged need gets `waiting` and nothing is pushed for it; a group whose own PR is already `MERGED` gets `merged` and is left alone. A dirty worktree or a branch with no commits ahead of the base is refused. A group whose latest round's `checks.json` was not run at the group worktree's `HEAD` (or that has none) is refused with `checks-stale` (exit 1, nothing pushed; the message says to run `tenbox check`); `--force` skips that guard. `--wait` then polls `gh pr checks <number>` every 10 s for each group that was created or updated, up to 30 minutes, and adds `ci: { state, checks: [{ name, state, time, url }] }` to it; `state` is `pass`, `fail` or `none` (no checks reported 2 minutes after the push). A `fail` or `cancel` check exits 1 with `ci-failed`, and a CI still pending at the deadline with `ci-timeout`; both carry the whole result in `details`. Without `--wait` there is no `ci` key and no `gh pr checks` call. The body starts with the line `tenbox: <id> group <N>`, then the group's latest checks summary and the whole `plan.md` folded. The title is `<id> · <group name>` (a plan without groups: `<id> · <title>` from `task.json`). A PR is found by that body line (`gh pr list --state all --search`, then an exact line match), else by its branch, which finds PRs opened before the line. Prints `{ ok, task, groups: [{ group, branch, state, pr }] }`; `state` is `created`, `updated`, `waiting`, `merged` or `conflict` (with `files`, the conflicted files), and `pr` is `{ number, url, draft }`, or null for a waiting or conflicted group with no PR. Tenbox never merges a PR: a person merges it on GitHub |
| `tenbox merge-check [--base <branch>]` | Run in the project. Runs `git fetch origin`, lists the open PRs into the base whose head branch fits `names.branch` (others are left out), and merges `origin/<branch>` of each onto `origin/<base>` in a temporary detached worktree, lowest PR number first. Then it runs `setup` and every check of both tiers there and judges them as `tenbox check` does: only new failures against the baseline fail a check (it writes no log files). The worktree is removed on every way out. With no open task PR it prints `ok: true` with empty lists. A failed `setup` gives `setup` (exit 1). A conflict gives `merge-conflict` (exit 1) with `{ base, prs, order, conflict: { branch, files } }` in `details`; a new failure gives `new-failures` (exit 1) with the whole result in `details`. Prints `{ ok, base: { ref, sha }, prs: [{ number, branch }], order, checks, summary }`. It never pushes and never moves a local branch |
| `tenbox close <id> [--force]` | Refuses, before it changes anything: a run from inside the task worktree (`in-task-worktree`, also with `--force`, because the close removes that directory), a dirty worktree (`dirty`), a branch not merged into the base (`unmerged`) and a PR merged as a merge commit whose branch head is not in `origin/<base>` (`merge-commit`: the merge commit has two parents, a squash or rebase merge has one; after a `git fetch origin` in the main checkout the head must be an ancestor of `origin/<base>`, and a failed fetch keeps the refusal; the message says why and that the work must be pushed to the base or the fetch fixed; an accepted merge commit is closed like a squash merge, with the pull and the remote branch delete). `--force` skips the last three. "Merged" comes from `gh pr view`: the PR is `MERGED` and the branch head is the PR head; an `OPEN` or `CLOSED` PR is not merged. Without a PR, or without `gh`, a test merge into the base decides, and one stderr line says so. When GitHub says `MERGED` (not with `--force`, not after the test merge), the close also runs `git pull --ff-only origin <base>` in the main checkout before the stats, only when that checkout has the base checked out (`pull: { base, state }`: `pulled`, `skipped` or `failed: <reason>`; a failed pull does not stop the close), and after the tracker step deletes `origin/<branch>` (`remote_branch: { name, state }`: `deleted`, `skipped` when it is already gone or not asked, or `failed: <reason>`). Writes `stats.json` in the task dir (it stays, with the other task files), stops every background session of the task worktree with `claude stop`, not `claude rm`, so the transcripts stay for `tenbox stats` (`session: { state }`: `stopped`, `skipped` with no session, no worktree or no `claude` in `PATH`; a session that `claude agents --json` lists without a `pid`, as after a reboot of the machine, has no process any more and counts as no session for `close`, `build` and `attach`, or `failed: <reason>` when `claude` fails; the close goes on), removes the worktree and the local branch, sets the tracker to done, then posts one cost comment to the task: `<total> min, <k>k tokens, <n> rounds` (total minutes, output tokens of all agents in thousands, number of rounds), `comment: { state }` with `posted`, `skipped` (tracker `none`, or no `stats.json` written) or `failed: <reason>`; a failed comment does not stop the close. The `Tracker` port has `comment` (Linear `commentCreate`, ClickUp `POST /task/{id}/comment`). A step with nothing to do is skipped. For a task with groups in `plan.json`, the close finds the PR of each group above 1 by its `tenbox: <id> group N` body line (else by the branch name), so a head branch that does not fit `names.branch` is still found; every group must be merged at its branch head and have a clean worktree, else `unmerged` (exit 1) names the first group that is not (`group N (<branch>)`) and nothing changes. It then removes each group worktree and its local branch before the task worktree, and deletes each group's remote branch like the task's (`groups: [{ group, worktree, branch, remote_branch }]`, only for a task with groups). `--force` skips these checks too. A `proofs.json` that is not a JSON array of valid proofs gives `bad-proofs` before anything changes |
| `tenbox proof <id> --part NN --file F --test T --failure X` | For a person who works by hand, outside `/tenbox-build`, and wants that proof counted at close; workers return proofs in their result and do not call it. Appends one proof `{ part, file, test, failure }`, each field trimmed, to `.tenbox/proofs.json`. Every flag is required and not blank (else `usage`, exit 2); `--part` must be the `NN` of a file in `.tenbox/parts/` (else `unknown-part`, exit 1); a `proofs.json` that is not a JSON array of valid proofs gives `bad-proofs`, exit 1, and nothing is written |
| `tenbox decide <id> --json '[{ question?, answer }]' [--no-build]` | Records the answers to a plan. Each item with a `question` appends `- <question line without its checkbox and "(blocking) ">` and `  Answer: <answer>` to `.tenbox/decisions.md` (created when missing) and ticks that line of `.tenbox/questions.md` (`- [ ] ` becomes `- [x] `). An item without `question` is a note: it appends `- <answer>`. A `question` matches the one line that starts with `- [ ] ` or `- [x] ` and contains the trimmed text; no line or more than one gives `unknown-question` (exit 1) and nothing is written, also when other items are valid. An entry already in `decisions.md` is not added again, so a second run changes no byte. A `--json` that is not an array of items with a non-blank `answer` gives `bad-decisions` (exit 1); a missing `--json` gives `usage` (exit 2); these start no build. After the answers are written it sends the build like `tenbox build` (`claude --bg` with `/tenbox-build <args>` in the task worktree), so one command per decision is enough; `--no-build` only records. The errors of `tenbox build` (`not-approved`, `plan-changed`, `no-plan`, `session-busy`, `claude`) come after the answers are written (exit 1), and a rerun adds nothing and sends the build again. Prints `{ ok, task, file, added, ticked, sent }`, with `file` the path of `decisions.md` and `sent` the prompt (`/tenbox-build <args>`; no `sent` key with `--no-build`) |
| `tenbox machine run <id> -- tenbox start\|build\|close <id> [--title X \| --force]` | Starts one `machine.yml` run with `gh workflow run machine.yml -f task=<id> -f cmd=<cmd>` in the tenbox checkout the CLI runs from, and prints `{ ok, task, cmd, url }` with the run URL `gh` printed (`null` if it printed none). Only `start`, `build` and `close` of the same id are allowed, after `--`; anything else (another id or command, no `--`, an unknown flag) is `usage` (exit 2) before `gh` runs. `start` adds `-f project=<project name of the current directory> -f repo=<origin URL of its main checkout> -f title=<--title>`; `close --force` adds `-f force=true`. Before `gh` it reads `refreshTokenExpiresAt` in `<claude dir>/.credentials.json` (the expiry only, never a token): a missing file is `no-login` and an expired refresh token is `login-expired`, both exit 1 and asking for `/login` on this computer, and `gh` is not called. On macOS the login lives in the Keychain, so there is no file and the command refuses with `no-login` |
| `tenbox machine ls` | Prints `{ ok, runs: [{ id, title, status, conclusion, url, created }] }` from `gh run list --workflow machine.yml` |
| `tenbox stats <id>` | Prints `{ ok, task, source, runs, rounds, roles, models }`: minutes and tokens per round (`{ round, minutes, calls, input, output, cache_write, cache_read }`), calls and tokens per role and per model. `source` is `stats.json` when the task dir has a `stats.json` of schema 5 or 6 (after `tenbox close`), else `sessions`: the `wf_*.json` run files and the `agent-<agentId>.jsonl` transcripts in Claude Code's session files for the task worktree. A run file with no `workflow_agent` entries (Claude Code 2.1.303 writes none) gets its agents the same way, from its run dir, with `finished: true`; `tokens` and `tool_calls` are then null. A run with no run file (its session ended before the run did) is counted too: its agents come from `journal.jsonl` (one per `started` line), `agent-<agentId>.meta.json` (role) and the transcript (model, first and last timestamp as start and length; no phase, tokens or tool calls), its workflow from the script name in `workflows/scripts/`; a run with no script or no timestamp is skipped. `runs` lists the runs oldest first as `{ workflow, started, finished }`, `finished: false` for such a run; from a `stats.json` it is the `runs` saved by `tenbox close`, `null` for schema 5, which has none. A `calls` is one assistant message id; a message on several lines counts once, with the tokens of its last line. `round` comes from the agent label `round N: ...` and counts across the build runs in start order (the second run's `round 1` is round 4 after a run of three rounds); agents with no round label (plan, approval, record build) have `round: null`, listed last. A round's minutes run from its first agent start to its last agent end. Without `stats.json` and without session files it fails with `no-stats`; with only a `stats.json` of an older schema (4 or less, no token numbers) it fails with `old-stats`. The transcript format is not a public API; only `cli/infra/claude/sessionFiles.ts` and `transcripts.ts` read it |
| `tenbox status <id>` | Where one task stands, read from its files, its background session and its PR. Prints `{ ok, task, title, status, round, approved, parts, session, pr, checks }`. `status`: the `status` of `.tenbox/task.json` (`started`, `plan-ready`, `approved`, `building`, the `build.json` status, `closed`; see `task.json` below), null without the file. `round`: the newest `rounds/N`, else the `round` of `build.json`, else `null`. `parts`: `{ todo, doing, done, blocked }`, counted from the `status:` line of each part file (a missing or other value counts as `todo`). `session`: `{ state }`, the `state` of the newest background session of the task worktree in `claude agents --json` (`working`, `blocked`, `done`), `none` without one, `unavailable` without `claude` in `PATH`, or `failed: <reason>`. `pr`: `{ number, url, draft }` or `null`, also when `gh` is missing or fails (one stderr line). `checks`: `{ round, ok, summary }` of the newest round that has a `checks.json`, else `null`. A task with no worktree gives `no-worktree` (exit 1) |
| `tenbox list` | Run in the project. Prints `{ ok, tasks }`: the status report of `tenbox status` for every task worktree `~/wt/<project>/<id>` that has a `.tenbox` directory, ordered by id. `main` and the group worktrees (`<id>-N` next to `<id>`) are left out. Also one line per task on stderr: `<id> · <status> · round <n or -> · parts <done>/<all> · session <state> · PR <#n or ->`. With no task worktree it prints `tasks: []`. It asks `gh` and `claude` once per task, all tasks at the same time |
| `tenbox install` | Symlinks every file of `agents/` and `workflows/` into `~/.claude/`, from the main checkout of the Tenbox repo, also when run from a task worktree; outside a git checkout it fails with `no-repo`. Never overwrites a foreign file |

The base is the manifest `base`, `main` by default; `--base` overrides it for `start` and
`check`. Task ids are letters, digits, `_` and `-`.

**New failures only.** A check fails only on failure lines that the base commit does not
already have. The failure lines of the base (the baseline) are kept per project, check and
commit under `~/wt/.baselines/`. `tenbox check` uses the baseline of the base commit, else
the newest one it has. With none at all, it runs the check once in the main checkout when
that sits at the base commit, and saves the result. Without any baseline, every failure
line is new.

**Flaky.** A check with a new failure runs once more. A new failure line that is missing from the
second run is flaky: it does not fail the check and is listed in `flaky` in the result and in
`summary`. A line in the second run stays a new failure. A check with no new failure runs once.
The check log holds both outputs. The CI workflow runs `bun test` itself, not `tenbox check`, so
it has no rerun.

**`stats.json`** (in the task dir): timeline, minutes per step (plan, wait for approval,
build, review, wait for merge), plan difficulty and estimated lines (from `plan.json`, null without it), the title (from `task.json`), rounds, review counts, code
lines, and each workflow agent with its model, seconds, tokens, `round` and usage (`calls`,
`input`, `output`, `cache_write`, `cache_read`, summed from its transcript; null without one), and
`runs` (`{ workflow, started, finished }` per workflow run, `finished: false` for a run with no run file; null without session files). It also holds the worker
`proofs` (part, test file, test name, failure text) and `points` per part. Proofs come from
`proofs.json` (`tenbox proof` and `tenbox build done`); a part file's Markdown text gives none.
The review counts (`must_fix` 0 only for `ready-for-you`, `nice_to_have`, `attention`) and the
`unproven` items come from `build.json`; without it `review` is null. Claude Code session
files give only times, agents and tokens. `proofs[].part` and `points[].part` hold the part number (`01`, not
`01-users`). The same part number, test file and test name counts once, the first one.
Points: +1 per distinct proof, -1 per `unproven` item in `build.json`, at most one per part per build round.
The reviewer's sentences are not kept.
`minutes.review` is the end of the last build run to the PR's creation; `minutes.wait_merge` is
the PR's creation to its merge. Both come from the one `gh pr view` call of the close and are null
without a PR and with `--force`. The time from the merge to the close is not kept. Schema 4.
`code` leaves out generated files: those marked `linguist-generated` in `.gitattributes`. To
mark a new one, add a line such as `bun.lock linguist-generated`; GitHub folds it in PR diffs too.

| Variable | Does |
|---|---|
| `TENBOX_HOME` | Where task dirs are kept; default `~/.tenbox` |
| `TENBOX_WT_ROOT` | The worktree root; default `~/wt` |
| `WTBASE_DIR` | Where baselines are kept; default `<worktree root>/.baselines` |
| `WTBASE_PATTERN` | The failure pattern when the manifest has none |
| `CLAUDE_CONFIG_DIR` | Where `tenbox install` links to; default `~/.claude` |
| `LINEAR_API_KEY` | The Linear key when the manifest has no `tracker.api_key` |
| `CLICKUP_API_KEY` | The ClickUp key when the manifest has no `tracker.api_key` |
| `TENBOX_DEBUG` | `1` logs spawned commands and prints stacks |

## The workflows: `workflows/`

Plain JavaScript Claude Code workflows, linked by `tenbox install`.

**`/tenbox-plan <id>`**, or `{ task, deep: true }` to run the planner on the strongest
model. One planner reads the task and the code and writes `.tenbox/plan.md`, one part file
per part and `questions.md`. It returns the summary, the estimated lines, the parts (`id` and
`difficulty`), acceptance criteria, the extra review lenses and the questions. A runner then
saves the result with `tenbox plan done`; the workflow adds its JSON as `recorded`.

**`/tenbox-build <args>`**: `tenbox build <id>` sends the args as one line of JSON,
`{ task, parts, lenses, groups }` from `plan.json`; the object may also have `feedback`,
`maxRounds` (default 3) and `answer`. The workflow parses args that are a string starting with
`{`. Args without a `parts` list, such as a task id alone, throw an error that names
`tenbox build <id>`; `tenbox build` checks the approval before it sends. Then each round:

1. **Build**: round 1 takes the parts and the extra lenses from the args; a later round asks
   the planner for the parts still to build and the done parts the feedback asks to change. One
   worker per part, one after another, in the task worktree. A part of `plan.json` has no goal
   in the prompt: the worker reads its part file. A part marked `hard` gets the strong model.
   A blocked worker ends the run with `needs-you`, its `part` and its decision card
   (`decision`, see `tenbox answer`). With `answer: { round, part, option, text }` in the args
   (`tenbox answer` resumes the run so), only the worker of that round and part gets the
   chosen option in its prompt; every earlier agent returns from the resume cache.
2. **Commit and checks**: the worker prompt names two commands. `tenbox part done <id>
   --part NN --commit <hash>` (with `--since` the checks commit of the scope's last green part,
   none before the first, and `--group N` in a group) verifies the worker's last commit; the
   worker runs it and returns its JSON as `partDone` (`{ ok, commit, error }`); a result with
   no `commit` did not run and counts as refused. Then `tenbox check <id>` (the `fast` tier);
   later workers of the round get `--round <N>`, with `N` from the first check's JSON. The
   worker runs it after its commit and returns its JSON as `checks`
   (`{ ok, commit, round, file, summary }`); a check with no `commit` or `file` did not run
   and counts as red. On a refused commit or a red check the same worker runs once more in
   the same round, with the error or the check summary in its prompt; the prompt tells it to
   set `status: todo` in its part file first. A second refusal or red check ends the round with
   no review, and the next round's feedback is `part NN: <error or summary>`. When every part passes, the last part check feeds the review. With no
   part listed, one runner runs `tenbox check <id>` before the review.
3. **Review**: the `base` lens always runs; `security` and `contract` run when the plan
   asks for them. Any `must_fix` item becomes the next round's feedback. A reviewer
   returns at most 3 `nice_to_have` items, each a concrete failure. In a feedback round
   the reviewer reads only `git diff <commit>..HEAD`, where `<commit>` is the checks
   commit of the last reviewed round. A round with no `must_fix` item ends `ready-for-you`.

Every end status runs `tenbox build done` through one runner (`record build`); for
`ready-for-you` it checks the latest `checks.json`, runs the `full` tier and opens the draft PR
(see `tenbox build done`). So a one-part plan with green checks and clean reviews runs one
worker, one reviewer per lens and one runner. When `tenbox build done` refuses a
`ready-for-you` result with `check-failed` from the `full` tier (`details.tier: "full"`), the
group in `details.group` runs one more round with the error message as feedback, and the end
goes to `tenbox build done` again; with no round left the build ends `failed` with that
message as `feedback`. Any other
refusal of `ready-for-you` is recorded by a second `tenbox build done` as `failed`, with the
refusal message as `feedback`. The workflow returns the result below with the same keys for
every status (`status`, `round`, `proofs`, `attention`, `nice_to_have`, `unproven`) and the
last `tenbox build done` JSON as `recorded` (with `pr` for an accepted `ready-for-you`; the
result has no top-level `pr`). `failed` gives `round`, the last round. It returns
`ready-for-you` with the attention and nice-to-have lists of all reviewed
rounds (`attention` holds one item per hunk, merged across lenses and rounds by one `reviewer` agent, `merge attention`, that
keeps an earlier round's item only while its hunk is in the last round's diff; with no items there is no merge agent, and
a reply that does not come back leaves the raw items), `needs-you`, or `failed` with the last feedback after the last round. Every result,
`needs-you` too, also has `unproven`: the reviewers' items from all rounds, one per part
per round. It also has `proofs`: the worker proofs `{ part, file, test, failure }` from all
rounds; `tenbox close` counts them (see `stats.json`).

**Groups.** With `groups` in the args, each group runs its own rounds, and groups whose needs
do not wait for each other run in parallel. A group starts when every group in its `needs`
ends `ready-for-you`; a group whose need ends `needs-you` or `failed` starts nothing. Group 1
works in the task worktree; a group above 1 first has a runner run
`tenbox worktree <id> --group N` (`round 1: gN worktree`). Then its rounds run as above, with
these changes: labels are `round R: gN ...` (`round 1: g2 03`); round 1 builds the parts of
the args that are in the group's `parts`, and a later round asks the planner for the parts of
that group only; the worker and reviewer prompts of a group above 1 name the group worktree;
the check command is `tenbox check <id> --group N`; the workers get the recipe `model` and
`effort`; and the extra lenses are the recipe `lenses`. The run ends `needs-you` when a group
needs you, with the round, part and card of the lowest such group; else `failed` when a group
failed, with each failed group's feedback (`group N: ...`); else `ready-for-you`. Its `round`
is the highest round of the groups.

**`/tenbox-close <id>`**. Run it in a `claude` session in the main checkout, after you squash
merged the PR on GitHub. One runner runs `tenbox close <id>` and the workflow adds its JSON as
`closed`. It returns `{ status: "closed", closed }` when the close worked, `{ status: "refused",
closed }` when `tenbox close` refused before it changed anything (`unmerged`, `merge-commit`,
`in-task-worktree`, `dirty`), and `{ status: "failed", closed }` for any other error.

## Roles: `agents/`

| Role | Model | Does |
|---|---|---|
| planner | opus | Writes the plan, the parts and the questions; writes only under `.tenbox/` |
| worker | sonnet | Builds one part with its tests, proves each change of behaviour with a test that fails first, runs the checks, commits, fills the part file |
| reviewer | sonnet | Reviews the diff through one lens; returns `must_fix`, `nice_to_have`, `attention`, `unproven`; never edits |
| runner | sonnet | Runs one `tenbox` command and returns its JSON unchanged |

## Task files: `.tenbox/`

The files live in the task dir `~/.tenbox/<project id>/<id>/`. The task worktree has `.tenbox`, a
symlink to it, excluded from git (pattern `.tenbox`, no slash, so it matches a link):

```
.tenbox/
├ task.md          tenbox start: id, title, tracker, url, description, then `## Comments` (tracker comments, oldest first)
├ task.json        tenbox start: id, title, status, tracker, url (null without one)
│                  `status`: started (tenbox start), plan-ready (plan done), approved (approve), building (approved,
│                  answer), the build.json status (build done), closed (close; the task dir stays). A failing command keeps it
├ plan.md          planner: summary, approach, parts, acceptance criteria, risks, size
├ plan.json        tenbox plan done: the validated planner result, read by close. Its optional
│                  `groups` key lists the groups: `{ id, name, parts, needs, recipe }`. The ids
│                  are 1..n in order; every part is in exactly one group; `needs` holds smaller
│                  ids only; `recipe` is `{ model, effort, lenses, tier }`. A bad value is `bad-plan`
├ build.json       tenbox build done: the last build result, read by close; tenbox answer adds answered
├ approved.json    tenbox approve: { at, plan_sha } of the approved plan
├ questions.md     planner: open questions by kind (product, technical, contract, risk)
├ decisions.md     tenbox decide and tenbox answer: answers and notes; every agent reads it first
├ auto-answer.log  the output of the background tenbox answer --auto
├ parts/01-x.md    one per part: status, files, acceptance, result
├ proofs.json      tenbox proof: the proofs recorded by hand, a JSON array
├ groups/N/        groups above 1: group.json { start } (tenbox worktree) and rounds/R/ (tenbox check --group N)
└ rounds/N/
  ├ checks.json    tenbox check (fast tier)
  ├ checks-full.json  tenbox check --tier full
  └ checks/*.log   the output of each check
```

`tenbox close` keeps the task dir, adds `stats.json` to it and removes the worktree, so `.tenbox` goes with the worktree.

## The manifest: `tenbox.yaml`

```yaml
id: k7f3qa                       # 6 characters, a-z and 0-9; tenbox start adds it when missing; only in tenbox.yaml
project: tenbox                  # optional; default: the main checkout's directory name, or its parent's when it is `main`
base: main                       # optional: the branch tasks start from and merge into
setup: bun install               # optional: runs in a new task worktree
checks:                          # name: command; tenbox check runs them all (the fast tier)
  types: bunx tsc --noEmit
  unit: bun test cli domain
# checks:                        # or two tiers: fast every round, full once at the close of a round
#   fast: { types: bunx tsc --noEmit, unit: bun test cli domain }
#   full: { e2e: bun test e2e }  # a name in both tiers is an error
model: sonnet                    # optional: the --model of the task's claude session; default sonnet
failure_pattern: "..."           # optional: a regex for a failure line; the default knows bun, vitest, jest and tsc
tracker: { kind: linear }        # none (default), linear or clickup; api_key here or LINEAR_API_KEY / CLICKUP_API_KEY
# tracker: { kind: clickup, statuses: { in_progress: "doing", done: "complete" } }   # optional status names
notify: { ntfy: "https://ntfy.example.com/my-private-topic" }   # optional; without it nothing is sent
names: { branch: "feat/{id}", session: "tenbox-{id}" }   # optional; these are the defaults; session is the claude -n name; an unknown key such as the old tmux is an error
```

**Notifications.** With `notify.ntfy` (a topic URL, `<server>/<topic>`) Tenbox publishes one text
line as ntfy JSON (`POST <server>` with `{ topic, message }`) when a person must act, and only then:
`<project> · <task id> · <state> · <detail> → <next command>`. The body also has `click`, the
session link `https://claude.ai/code/<bridgeSessionId>`, so a tap opens the task's session. It
comes from the `<claude dir>/sessions/*.json` file with the newest `startedAt` whose `cwd` is the
real path of the task worktree and that has a `bridgeSessionId`, read at each send (a resumed
session gives its new link); without such a file there is no `click` key. The file format is not
a public API; only `cli/infra/claude/sessionLinks.ts` reads it. The states:

| State | When | Detail | Next command |
|---|---|---|---|
| `needs-you` | `tenbox build done` with status `needs-you` | the decision card title | `tenbox answer <id> <recommended option>`; `tenbox attach <id>` without a card |
| `ready-for-you` | `tenbox build done` with status `ready-for-you` | the round and the attention, nice-to-have and unproven counts; the draft PR is open | `tenbox pr <id> --ready` |
| `failed` | `tenbox build done` with status `failed` | none | `tenbox attach <id>` |
| `check-failed` | `tenbox check` with a new failure | the checks, the count and the round; `the build goes on` while there is no `build.json` | `tenbox attach <id>` |
| `pr-opened` | `tenbox pr` creates the PR (an update sends nothing) | the PR URL | `tenbox close <id>` |
| `plan-ready` | `tenbox plan done` saves a valid plan | `parts <n>, open questions <m> (<b> blocking)` | `tenbox approve <id>` |
| `blocked` | the task's background session waits on a permission prompt (`tenbox hook blocked`) | the message of the prompt, else `permission prompt` | `tenbox attach <id>` |

A failed send is one stderr line (`notification not sent: ...`); the command's JSON and exit
code stay the same. The line holds the task id and the decision card title: use a private
topic. Desktop notifications do not exist; the manifest has no `desktop` key.

Layers, later ones win: `tenbox.yaml` (task worktree, else main checkout), then
`tenbox.local.yaml` in the main checkout, then in the task worktree, then
`.tenbox/override.yaml`. Keys of later phases are dropped without an error.

## Tracker

`none`: the task comes from `tenbox start --title`, and status changes are skipped.
`linear`: `tenbox start` reads the issue over Linear's GraphQL API and sets it to in
progress; `tenbox close` sets it to done.
`clickup`: the same over ClickUp's REST API v2, with the native task id (custom task ids such
as `WAG-12` are not supported). The statuses differ per list. In progress is the status named "in progress" and done is the
one named "done" (ignoring case). A project can name them with `tracker.statuses`
(`in_progress`, `done`). A name the list lacks is an error that lists the list's statuses and
shows the setting. `tenbox start` and `tenbox close` print the real status name in `status`
(or `skipped`, or `failed: <reason>`).

The `Tracker` port has `comments`: `tenbox start` appends the comments of a tracker task to `task.md`
under `## Comments`, oldest first, each as `### <author> · <date>` and its body (top-level
comments, one page: Linear 250, ClickUp 25 newest; `none` and `--title` have none, and a task
without comments gets no section). A failed read fails the start.

## Repository layout

```
domain/       pure code: ids, failure lines, manifest schema, stats, events, the Tracker port
cli/          the tenbox CLI; entry cli/main.ts (layers: see CLAUDE.md)
  commands/     one file per CLI command
  application/  use cases
  infra/        git, gh, shell, files, env, baselines on disk, claude/ (Claude Code), tracker/ adapters
  test/         temporary projects and the CLI runner for tests
server/       the HTTP server (Hono); entry server/main.ts (`bun run server/main.ts`), loopback only.
              SIGINT or SIGTERM lets open requests finish, closes the database and exits 0
  routes/       `GET /health` returns 200 `{"ok":true}`; `GET /openapi.json` is the OpenAPI 3.1
                document built from the zod route schemas; `GET /docs` is Swagger UI. Every
                other path needs `Authorization: Bearer <token>` of a known user. Every error
                is an RFC 9457 problem, `application/problem+json`:
                `{ type: "about:blank", title, status, detail, code }`. No token: 401
                `unauthorized`; with a token, an unknown path is 404 `not-found`; any other
                error is 500 and its message goes to stderr, not to the client
  application/  organizations, users and projects: the rules (a GitHub name once; a project id once; the user, the
                membership and the token in one transaction)
  commands/     `tenbox-server user add --name <n> --github <g> --org <o> [--email <e>]
                [--type admin|member]` (default `member`) finds or makes the organization,
                makes the user and prints `{ ok, user, organization, type, token }` on stdout.
                The `tbx_` token is shown once; only its SHA-256 hash is stored. The same
                `--github` again exits 1 with `code: "user-exists"`. A lost token cannot be
                shown again: delete the user row (its memberships go with it) and add the
                user again.
                `tenbox-server project add --id <id> --name <n> --repo <r> --org <o>` (all four
                required; the id is 6 characters, a-z and 0-9) finds or makes the organization,
                adds the project and prints `{ ok, project, organization }`. The same `--id`
                again exits 1 with `code: "project-exists"`
  infra/        env (`TENBOX_SERVER_PORT`, default 4300; `TENBOX_SERVER_DB`, default
                `~/.tenbox-server/server.db`; Bun reads `.env`), the token maker
    db/           the SQLite database with drizzle: `schema.ts` (`organizations`, `users`,
                  `memberships`, `projects`) and `migrations/`. Opening the database applies the new
                  migrations. After a change to `schema.ts`, run
                  `bunx drizzle-kit generate --name <what>` and commit the new migration
    repositories/ data access per table, no rules: `find...`, `insert`
agents/       planner.md, worker.md, reviewer.md, runner.md
workflows/    tenbox-plan.js, tenbox-build.js, tenbox-close.js
machines/     the machine image (Packer), the task module (OpenTofu), machine.sh and the watchdog;
              see machines/README.md
docs/         design.md (the target design), flow page and mockups
```

CI (`.github/workflows/ci.yml`) runs the typecheck, the tests and knip on each pull request, on our own
Linux runner (label `tenbox-ci`).

## Machines: `machines/`

Tasks run on short-lived cloud machines, one per task, instead of your computer. What exists
today: the image they boot from, built with Packer after every merge to main (the newest three are kept); the OpenTofu module that gives one task its
volume and server; the control plane, `.github/workflows/machine.yml` with `cmd` start, build,
close or down, which runs `machines/machine.sh` with the state in a bucket; and the watchdog
that asks that workflow for `down` after five idle minutes; and the login sync, which keeps a
copy of your claude.ai login in the bucket for the machines and writes the Secrets of the box in namespace `tenbox`: `claude-credentials` (`credentials.json`, from `~/.claude/.credentials.json`), `github-token` (`token`, from `~/.config/tenbox/github-token`), `tracker` (`api_key`) and `ntfy` (`url`), the last two from `tracker.api_key` and `notify.ntfy` of `tenbox.local.yaml`. Start a run with `gh workflow run
machine.yml -f task=TEN-301 -f cmd=build`, or `tenbox machine run TEN-301 -- tenbox build
TEN-301`, which first checks that your claude.ai login has not expired; `tenbox machine ls` lists the runs. `machines/k8s/` is the box image for containers: the `box` workflow pushes it to the private `ghcr.io/enojen/tenbox-box` (`:latest` and `:<sha>`) on every merge to main. The line between the two repositories: what is inside the box (this image) belongs to Tenbox; where and how the box runs (the cluster, the Job, the volume) belongs to [Tenyard](https://github.com/enojen/tenyard). See
[`machines/README.md`](machines/README.md).

## Roadmap

1. **Done**: roles, `/tenbox-plan`, `/tenbox-build` with Build, Checks and Review,
   `tenbox start`, `check`, `install`.
2. **Done**: `tenbox close`, `tenbox pr`, `tenbox merge-check`, `/tenbox-close`, the ClickUp
   adapter.
3. **Now**: machines. The image, the task module, the control plane and the login sync are
   built, and `tenbox machine run` starts the runs; next ephemeral CI runners.
4. Later, see [`docs/design.md`](docs/design.md): the full manifest and the sandbox, the
   Try phase with QA, fakes from API docs, the live pane, the panel.
