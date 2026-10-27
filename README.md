<p align="center">
  <img src="docs/tenbox-icon.svg" width="96" height="96" alt="Tenbox">
</p>

# Tenbox

Tenbox runs one tracker task through plan, build, check, review and merge with
[Claude Code](https://docs.claude.com/en/docs/claude-code) workflows and subagents.
Claude Code does the agents; Tenbox adds four roles, three workflows, a task layout on disk and
a small CLI for the steps an agent should not improvise.

> Early and changing fast. Interfaces and file formats may break between commits.

## Why Tenbox

**Many tasks at once.** Each task gets its own worktree, branch and background Claude Code
session, so you start the next task while the last one builds. `tenbox list` shows them all,
and an ntfy notification reaches your phone only when a task needs you. Inside one task, the
groups of parts that do not depend on each other build in parallel, each group as its own PR.
Tasks can also run as Jobs on a Kubernetes cluster instead of your computer.

**Proof, not claims.** Every part starts with a test that fails before the code is written;
the build records that test and its failure as the part's proof. A reviewer marks a change of
behaviour without a proof as unproven. Checks compare against a baseline from `main`: a failure
that was already there does not block the task, and a new one cannot hide.

## Requirements

Bun, git, the GitHub CLI (`gh`) and Claude Code, on macOS or Linux. A Linear or ClickUp
tracker is optional.

## Install

```sh
git clone https://github.com/enojen/tenbox.git ~/wt/tenbox/main
cd ~/wt/tenbox/main
bun install
bun link            # puts `tenbox` on your PATH
tenbox install      # links agents/, workflows/ and skills/ into ~/.claude/
```

## Usage

Add a `tenbox.yaml` to the project you work on:

```yaml
base: main
setup: bun install
checks:
  types: bunx tsc --noEmit
  unit: bun test
```

Then run one task:

```sh
tenbox start TEN-1 --title "Add rate limits"   # worktree, branch, and a planner in the background
tenbox plan show TEN-1                          # read the plan
tenbox approve TEN-1
tenbox build TEN-1                              # build, check and review rounds
tenbox pr TEN-1 --ready                         # push and open the PR
tenbox close TEN-1                              # after the merge: clean up, set the tracker to done
```

Every command prints JSON on stdout and human text on stderr.

### From Claude Code

`tenbox install` also links the `tenbox` skill, so Claude Code in any project knows Tenbox.
Ask it in plain words, for example "start TEN-1 with tenbox". The skill reads the commands
from the tenbox you have installed, so it never goes out of date.

## Documentation

- [`docs/reference.md`](docs/reference.md): every command, workflow, role and file, as built today.
- [`docs/design.md`](docs/design.md): the target design for later phases.

## Roadmap

- Cards: one model for questions, answers, reviews and PR comments.
- Adaptive flow: a plan lens, a code skeleton before the bodies, the task kind in stats.
- Machines: tasks run as Jobs on a Kubernetes cluster, checks as their own Jobs.
- Server: events from the CLI, task numbers computed on the server.
- Later: sandbox and QA (the Try phase), `tenbox rebase`, the live pane and the panel.

## License

[Apache 2.0](LICENSE)
