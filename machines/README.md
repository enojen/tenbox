# Machines

Each Tenbox task runs in a box: a pod of a Job on the cluster, one Job per command, one
volume per task. The target design is in [`docs/design.md`](../docs/design.md), section
"Machines". This directory holds what exists today: the box image (`k8s/`), the login
sync (`login/`) and the server image (`server/`).

## The login: `login/`

Remote Control needs a claude.ai login; `claude setup-token` runs the model but Remote
Control refuses it, and a copy of `~/.claude/.credentials.json` works. `machines/login/install.sh`
installs a systemd user path unit on your computer that writes the file to the Secrets of the
box whenever it changes, and once right away; `/login` on your computer is all a new account
needs. It writes one Secret in namespace `tenbox` of the cluster (`KUBECONFIG` from the env,
else `~/.kube/tenyard.yaml`; the API is open from the home IP only): `claude-credentials` key
`credentials.json` from `~/.claude/.credentials.json`. It exits 1 when the Secret could not be
written. The shared `github-token` of the box is tenyard's, encrypted in its `secrets/`. The
tracker key and the ntfy URL differ per project, so `tenbox machine run` writes them (below).
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
`TENBOX_REPO`, `TENBOX_CMD`, and `TENBOX_BASE`, the `base` of the manifest) and the secrets (`GITHUB_TOKEN`, `CLAUDE_CREDENTIALS`,
`TRACKER_API_KEY`, `NTFY_URL`), prepares the volume at `/home/tenbox`, clones the project with `--branch $TENBOX_BASE` (on a kept
volume it fetches the base and checks it out; an unset `TENBOX_BASE` keeps the clone of the default
branch), stops with exit 1 and a log line naming the base when `tenbox.yaml` is not tracked in the
main checkout, then runs `TENBOX_CMD`
in the foreground in the project's main checkout. The whole container runs as `tenbox`, with no
root and no `sudo`; tenyard's Job gives a new volume to its group with `fsGroup`. `env -i` drops
the rest of the env, so the command gets only `HOME`, `PATH`, `USER`, `LOGNAME`, `SHELL`, the
egress settings the Job sets (`HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY`, each also in lowercase,
`NODE_USE_ENV_PROXY`, `DISABLE_TELEMETRY`, `DISABLE_ERROR_REPORTING`) and the
project's variables: `TENBOX_ENV` holds `machine.env` of `tenbox.yaml` as one JSON object, each
key one variable; a key named like one of the box's loses to the box's, and a `TENBOX_ENV` that is not JSON stops the boot. The command may leave a
claude session behind (`tenbox start` and `tenbox build` do): the container then lives while
that session works (its `status` in `claude agents --json` is `busy`) and ends once no session is
left or the sessions have been idle for `IDLE_MINUTES` (1; a plan that waits for approval). Only
the sessions of this run count: before the command the box keeps the `id` + `pid` key of each
session, and after it a session counts when its key is new or its status is `busy`. With no
counted session the box logs `no session of this run` and ends at once, so a short command such as
`tenbox status` does not wait for an old idle session on the volume. A
session resumed by `tenbox answer` can keep `state: working` after its turn ended, so `state` does
not count. Last it logs one line with what the
container used from its boot on, `tenbox-boot: memory peak <MiB> MiB, cpu <s> s, pids peak <n>, oom_kill <n>`, from
`memory.peak`, `cpu.stat`, `pids.peak` (processes and threads) and `memory.events` of its cgroup (`oom_kill` counts the processes the kernel killed at the memory limit: above 0, `tenbox machine ls` and `logs` show reason `OOMKilled` even when the container ended with exit 0); the peak counts the file cache too, so the real need
is at most that. tenyard's resource classes come from these lines. It exits with the command's exit code. The output goes to stdout and to `/var/log/tenbox-run.log`.
On exit, also after a SIGTERM (exit 143), it removes the logins from the volume:
`~/.claude/.credentials.json`, gh's `hosts.yml` and the main checkout's `tenbox.local.yaml`; the
next boot writes them again. A SIGKILL leaves them until that next boot.

On the cluster, `tenbox machine run <id> -- tenbox start|build|close <id>` starts the box. It
reads the kubeconfig (`$KUBECONFIG`, else
`~/.kube/config`), fills tenyard's `task/pvc.yaml` and `task/job.yaml` (from
`machine.template`, default `~/tenyard/task`), with the resource
class from `task/classes.yaml` (`machine.plan_class` for `start`, default `plan`; `plan` for `close`, `machine.class` of
`tenbox.yaml` for `build`, default `build`) and, for `build`, the services of
`machine.services` from `task/services/` (their sidecars and volumes; their env joins
`TENBOX_ENV`, where `machine.env` wins), and posts the
volume `task-<id>` (kept when it exists) and the Job `task-<id>-<MMDD-HHMMSS>` to namespace
`tenbox` with `fetch`. Before them it writes the project Secret `project-<project id>`, which
the Job reads as `TRACKER_API_KEY` and `NTFY_URL`: `tracker_api_key`, the key this computer
uses for the project (`tracker.api_key` of `tenbox.local.yaml`, else `LINEAR_API_KEY` or
`CLICKUP_API_KEY`) and `ntfy_url` from `notify.ntfy`. `GITHUB_TOKEN` is the run's placeholder,
which the server writes for the Job (empty when the GitHub App is not installed on the
repository, and the box then stops at start); the injector behind the egress proxy swaps it for
the run token on its way to GitHub. With `TENBOX_INJECTOR_CA`, the file of the injector's CA, the
box gives the command `SSL_CERT_FILE` and `GIT_SSL_CAINFO` (the system roots and that CA in one
file) and `NODE_EXTRA_CA_CERTS`. The box unsets the secrets before the command. Commits carry `TENBOX_GIT_NAME` and
`TENBOX_GIT_EMAIL` of the Job, else the name of the token's user. A project without an `id` in its
`tenbox.yaml` is refused. It refuses with `machine-busy` while a Job of the task is active and
does not follow the log: `tenbox machine ls` lists the Jobs with their state. The Job and the
volume belong to [Tenyard](https://github.com/enojen/tenyard); tenbox keeps no copy of them.

After the close Job has ended (`tenbox machine ls`), `tenbox machine rm <id>` deletes the task's volume; it refuses with `machine-busy` while a Job of the task is active.

## Server image: `server/`

The tenbox server (`server/main.ts`) as a container image: bun, the production dependencies,
`domain/` and `server/`, nothing else (no `.git`, no host `node_modules`). The `server` workflow
(`.github/workflows/server.yml`) builds it on every push to main and pushes
`ghcr.io/enojen/tenbox-server:<sha>` and `:latest`, then logs out of GHCR. The package is private.

To build by hand, from the repo root:

```
docker build -f machines/server/Dockerfile -t tenbox-server .
docker run -p 4300:4300 -v tenbox-data:/data tenbox-server
```

Env: `TENBOX_SERVER_HOST` (image default `0.0.0.0`), `TENBOX_SERVER_PORT` (`4300`),
`TENBOX_SERVER_DB` (`/data/server.db`). The volume is `/data`; it holds the database and the
backups. Tokens travel over plain HTTP, so keep the port inside the cluster.

Backup, inside the container: `tenbox-server backup --to /data/backups/<name>.db` writes a
consistent copy and refuses a file that exists. `tenbox-server` is on the PATH of the image.

What tenyard `install/` must hold for it: a Deployment (one replica, `/data` mounted), a volume
with reclaim policy Retain, a ClusterIP Service on port 4300, and a CronJob that runs the backup
daily on the same volume.
