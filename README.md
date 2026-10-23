<p align="center">
  <img src="docs/tenbox-icon.svg" width="96" height="96" alt="Tenbox">
</p>

# Tenbox

Tenbox runs one tracker task through plan, build, check, review and merge with
[Claude Code](https://docs.claude.com/en/docs/claude-code) workflows and subagents.
Claude Code does the agents; Tenbox adds four roles, three workflows, a task layout on disk and
a small CLI for the steps an agent should not improvise.

> Early and changing fast. Interfaces and file formats may break between commits.

## Requirements

Bun, git, the GitHub CLI (`gh`) and Claude Code, on macOS or Linux. A Linear or ClickUp
tracker is optional.

## Install

```sh
git clone https://github.com/enojen/tenbox.git ~/wt/tenbox/main
cd ~/wt/tenbox/main
bun install
bun link            # puts `tenbox` on your PATH
tenbox install      # links agents/ and workflows/ into ~/.claude/
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

[MIT](LICENSE)
