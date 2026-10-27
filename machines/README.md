# Machines

Each Tenbox task runs in a box: a pod of a Job on the cluster, one Job per command, one
volume per task. The target design is in [`docs/design.md`](../docs/design.md), section
"Machines". This directory holds what exists today: the box image (`k8s/`) and the login
sync (`login/`).

## The login: `login/`

Remote Control needs a claude.ai login; `claude setup-token` runs the model but Remote
Control refuses it, and a copy of `~/.claude/.credentials.json` works. `machines/login/install.sh`
installs a systemd user path unit on your computer that writes the file to the Secrets of the
box whenever it changes, and once right away; `/login` on your computer is all a new account
needs. It writes two Secrets in namespace `tenbox` of the cluster (`KUBECONFIG` from the env,
else `~/.kube/tenyard.yaml`; the API is open from the home IP only): `claude-credentials` key
`credentials.json` from `~/.claude/.credentials.json`, and `github-token` key `token` from
`~/.config/tenbox/github-token` without whitespace. It exits 1 when a Secret could not be
written. A change of the token needs `systemctl --user start tenbox-login-sync.service`; the
path unit watches only the login. The tracker key and the ntfy URL differ per project, so
`tenbox machine run` writes them (below).
Every Job reads the Secrets of the moment, so `tenbox machine run` refuses before the cluster
when the refresh token in `~/.claude/.credentials.json` has expired ("run /login on your
computer"). The access token lives hours and the refresh token days.

## Box image: `k8s/` (TEN-460)

The same box as a container image, for a Kubernetes pod: Ubuntu 24.04, bun, Node 24, gh,
claude and this repo at `/opt/tenbox`. Corepack is on, so `pnpm` and `yarn` are the version of the
project's `packageManager` field, downloaded on first use into the volume. The `box` workflow
(`.github/workflows/box.yml`) builds it on every push to main and pushes
`ghcr.io/enojen/tenbox-box:<sha>` and `:latest`; a manual run from another branch pushes
only `:<sha>` of that branch. It runs on `vars.BOX_RUNNER` (default `ubuntu-latest`) and logs
out of GHCR at the end, because the runner is shared. The package is private: log in to
pull, for example `gh auth token | docker login ghcr.io -u <user> --password-stdin`. The
image holds the repo's git history at `/opt/tenbox`, so the package must stay private. The
workflow is the only build script. `/etc/tenbox-image.json` in the image has `tenbox.ref`,
the sha.

To build by hand, from the repo root, with the committed work as a git bundle (so
untracked files stay out and `/opt/tenbox` is a clean git repo):

```
mkdir -p machines/k8s/.build && git bundle create machines/k8s/.build/tenbox.bundle main
docker build machines/k8s --build-arg TENBOX_BRANCH=main --build-arg TENBOX_REF=$(git rev-parse main) -t tenbox-box
```

The container runs `boot.sh`. It reads the task from the env (`TENBOX_TASK`, `TENBOX_PROJECT`,
`TENBOX_REPO`, `TENBOX_CMD`) and the secrets (`GITHUB_TOKEN`, `CLAUDE_CREDENTIALS`,
`TRACKER_API_KEY`, `NTFY_URL`), prepares the volume at `/home/tenbox`, then runs `TENBOX_CMD`
in the foreground as `tenbox` in the project's main checkout. `sudo` drops the rest of the env,
so the command gets only `HOME`, `PATH` and the project's variables: `TENBOX_ENV` holds
`machine.env` of `tenbox.yaml` as one JSON object, each key one variable; a key `HOME` or `PATH`
loses to the box's, and a `TENBOX_ENV` that is not JSON stops the boot. The command may leave a
claude session behind (`tenbox start` and `tenbox build` do): the container then lives while
that session works and ends once no session is left or the sessions have been idle for
`IDLE_MINUTES` (1; a plan that waits for approval). Last it logs one line with what the
container used from its boot on, `tenbox-boot: memory peak <MiB> MiB, cpu <s> s`, from
`memory.peak` and `cpu.stat` of its cgroup; the peak counts the file cache too, so the real need
is at most that. tenyard's resource classes come from these lines. It exits with the command's exit code. The output goes to stdout and to `/var/log/tenbox-run.log`.

On the cluster, `tenbox machine run <id> -- tenbox start|build|close <id>` starts the box. It
reads the kubeconfig (`$KUBECONFIG`, else
`~/.kube/config`), fills tenyard's `task/pvc.yaml` and `task/job.yaml` (from
`machine.template`, default `~/tenyard/task`) as tenyard `task/run.sh` does, with the resource
class from `task/classes.yaml` (`plan` for `start` and `close`, `machine.class` of
`tenbox.yaml` for `build`, default `build`), and posts the
volume `task-<id>` (kept when it exists) and the Job `task-<id>-<MMDD-HHMMSS>` to namespace
`tenbox` with `fetch`. Before them it writes the project Secret `project-<project id>`, which
the Job reads as `TRACKER_API_KEY` and `NTFY_URL`: `tracker_api_key`, the key this computer
uses for the project (`tracker.api_key` of `tenbox.local.yaml`, else `LINEAR_API_KEY` or
`CLICKUP_API_KEY`), and `ntfy_url` from `notify.ntfy`. A project without an `id` in its
`tenbox.yaml` is refused. It refuses with `machine-busy` while a Job of the task is active and
does not follow the log: `tenbox machine ls` lists the Jobs with their state. The Job and the
volume belong to [Tenyard](https://github.com/enojen/tenyard); tenbox keeps no copy of them.

After the close Job has ended (`tenbox machine ls`), `tenbox machine rm <id>` deletes the task's volume; it refuses with `machine-busy` while a Job of the task is active.
