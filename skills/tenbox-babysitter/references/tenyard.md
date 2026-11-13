# The cluster

Read this before the first `tenbox machine run`.

## Capacity rule

Other work runs on the cluster too. A Job runs on a node the autoscaler adds. When the cloud
account is at its limit, no node comes and the pod stays `Pending`.

- After a `tenbox machine run`, see that the pod started.
- A pod that is `Pending` for more than 5 minutes: read its events
  (`kubectl -n tenbox describe pod <pod>`). The signs are `FailedScheduling`,
  `NotTriggerScaleUp`, a max node group size, or a limit error of the cloud.
- Then start no new Job, do not try again, stop no other Job, and change no class and no node
  pool. Set the task to `waiting: cluster capacity` in the lane file, show the user the pod name
  and the event line, and wait for their word.
- When a pod of another lane is `Pending` for the same reason, start no Job either.

## Traps

- A Job ends when its command ends and the claude sessions it started are idle for 1 minute; a
  command that starts no session ends at once. While a Job of the task runs, the next command
  fails with `machine-busy`. `--wait` ends when the Job ends, so run the commands of one task one
  after another with `--wait`.
- An out-of-memory end (exit 137, `OOMKilled`): do not change the class; tell the user.
- Never force-push a PR branch and never rebase it by hand: `tenbox pr` takes main itself.
- The state of a task is on its volume. Read it with tenbox commands (`status`, `plan show`).
  When a `kubectl exec` is the only way, run it as `env -u GITHUB_TOKEN kubectl exec ...` and do
  all the work in one command: a box that started no session ends seconds after its command.
- The auto mode can refuse a command (a PR to ready, a close, a read of production). A refusal
  means stop: give the command to the user.
- Before the first task, `tenbox machine ls` must answer. A start that stops for the GitHub App
  or a tracker 401 is not yours to repair: tell the user.
- Only `tenbox machine rm`, after the close Job, deletes a volume. A task that is closed without
  it leaves its volume.
