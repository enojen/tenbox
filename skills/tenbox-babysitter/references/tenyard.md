# The cluster

Read this before the first `tenbox machine run`.

## Capacity rule

Other work runs on the cluster too. A Job runs on a node the autoscaler adds. When the cloud
account is at its limit, no node comes and the pod stays `Pending`.

- After a `tenbox machine run`, see that the run started: `tenbox machine ls <id>`.
- A run whose box has not started after 5 minutes: Tenport does not show why a pod waits for a
  node, so read the pod's events with the kubeconfig of the user's computer
  (`kubectl -n tenbox describe pod <pod>`; read only). The signs are `FailedScheduling`,
  `NotTriggerScaleUp`, a max node group size, or a limit error of the cloud.
- Then start no new Job, do not try again, stop no other Job, and change no class and no node
  pool. Write `waiting: cluster capacity` in "Next step" of the lane file, show the user the pod name
  and the event line, and wait for their word.
- When a pod of another lane is `Pending` for the same reason, start no Job either.

## Traps

- A Job ends when its command ends and the claude sessions it started are idle for 1 minute; a
  command that starts no session ends at once. While a Job of the task runs, the next command
  fails with `machine-busy`. `--wait` ends when the Job ends, so run the commands of one task one
  after another with `--wait`.
- An out-of-memory end (exit 137, `OOMKilled`): do not change the class; tell the user.
- `archive-failed` (exit code 75): the object storage did not answer for minutes, and the command
  did not run or its state was not saved. Wait 10 minutes and run the same command once more; when
  it fails again, write `waiting: task archive` in "Next step" of the lane file and tell the user.
- Never force-push a PR branch and never rebase it by hand: `tenbox pr` takes main itself.
- The state of a task is in its task archive in the bucket: each run restores it and saves it
  again when it ends. There is no volume to read and no `kubectl exec`: read the state with
  tenbox commands through `tenbox machine run <id> -- tenbox status <id>` or `plan show`.
- The auto mode can refuse a command (a PR to ready, a close, a read of production). A refusal
  means stop: give the command to the user.
- Before the first task, `tenbox machine ls <id>` must answer for the lane's tasks. A start that stops for the GitHub App
  or a tracker 401 is not yours to repair: tell the user.
- You delete nothing on the cluster or in the bucket: a person deletes a task archive. The bucket
  deletes an archive 30 days after its last write.
