# Machines

Each Tenbox task runs on its own short-lived cloud machine: compute per run, disk per task.
The target design is in [`docs/design.md`](../docs/design.md), section "Machines". This
directory holds what exists today.

## The image: `packer/`

One Hetzner Cloud snapshot that every task machine and every CI runner will boot from. It
holds Ubuntu 24.04, bun, git, gh, claude and this repo at `/home/tenzel/tenbox` with its
dependencies installed; `tenbox` and `claude` are on the PATH of every user. No secrets, no
login, no ssh keys: those come at boot.

Build it from your computer:

```
export HCLOUD_TOKEN=...            # a read-write Hetzner Cloud API token
machines/packer/build.sh [branch]  # default: the current branch; needs packer
```

`build.sh` bundles this repo at the branch (`git bundle`, committed work only), uploads the
bundle and runs Packer on a temporary `cx23` in `hel1`. The snapshot is named
`tenbox-image-<date>` and labelled `tenbox-image=true`, `tenbox-ref=<commit>`, so a
module can pick the newest one. The versions that went in are in `/etc/tenbox-image.json`
on the image. Every merge to main runs `.github/workflows/image.yml`, which builds `main` with
`build.sh` (secret `HCLOUD_TOKEN`), so a new server boots from the newest image; run it by hand
(`gh workflow run image.yml`) when claude or bun should move. After a build of `main`,
`build.sh` deletes the snapshots labelled `tenbox-image=true` beyond the newest `KEEP_IMAGES`
(default 3, at least 1); a build of another branch deletes nothing.

Users and paths on the image:

| What | Where |
|---|---|
| user | `tenzel`, passwordless sudo |
| this repo | `/home/tenzel/tenbox`, origin set to GitHub |
| bun | `/usr/local/bin/bun` |
| tenbox | `/usr/local/bin/tenbox`, runs `cli/main.ts` with bun |
| claude | `/home/tenzel/.local/bin/claude`, linked from `/usr/local/bin/claude` |
| watchdog | `/usr/local/bin/tenbox-watchdog`, `tenbox-watchdog.timer` |

## The task module: `tofu/task/`

One Tenbox task on Hetzner Cloud: a 10 GB volume `tenbox-<task>` that lives from start to
close, and a server `tenbox-<task>` (`hel1`) that exists while `up` is true, with one IPv4
and no IPv6 (Hetzner counts every primary IP against one project limit). The server
boots from the newest snapshot labelled `tenbox-image=true` and gets cloud-init user data:
the machine facts (`/etc/tenbox-machine.json`: task, project, repo, volume, the tenbox
command, the ntfy URL, the control repo), the GitHub token, the claude.ai login copy from
the bucket, the tracker key, the current watchdog script and `tenbox-boot.sh`. For now the secrets travel
in user data; the boot script shreds them once gh and claude have them. Root may log in
with the ssh keys named in `ssh_keys`: yours (`tenzel`) and the workflow's
(`tenbox-machine`).

`tenbox-boot.sh` runs once per boot as root: waits for the volume, formats it on the first
run, mounts it on `/mnt/task` and bind-mounts its `wt`, `.tenbox` and `.claude` onto
`~tenzel/wt`, `~tenzel/.tenbox` and `~tenzel/.claude`, so every path stays a real home path
(git, claude's trust and its transcripts key by the real path); writes the login,
`remoteControlAtStartup`, and trust for the main checkout and the task worktree; logs gh in
and takes the git identity from the token's GitHub user; clones the project into
`~/wt/<project>/main` on the first run; writes `tenbox.local.yaml` with the tracker key and
the ntfy URL; runs `tenbox install`; then starts the tenbox command with `tenbox-run`.
`tenbox-run.sh` (`/usr/local/bin/tenbox-run` on the machine) starts one tenbox command as
a transient systemd unit `tenbox-run-<time>`, as tenzel in the main checkout, so its claude
session outlives the caller: the boot script on a new server, `machine.sh` over ssh on a
live one. One unit per command: the claude session a command leaves behind keeps its unit
loaded, so a name is never reused; the newest is in `/run/tenbox-run.unit`. Output:
`journalctl -u cloud-final`, `/var/log/tenbox-run.log` (emptied for every command).

## The control plane: `machine.yml` and `machine.sh`

`.github/workflows/machine.yml` is the only place that holds the machine secrets. Start a
machine with `tenbox machine run <id> -- tenbox start|build|close <id>`. It runs
`gh workflow run machine.yml` and refuses with `no-login` or `login-expired` before gh runs.
What it runs is the same as these commands, which also work by hand (`down` has no
`tenbox machine run` form):

```
gh workflow run machine.yml -f task=TEN-301 -f cmd=start \
  -f project=tenbox -f repo=https://github.com/enojen/tenbox.git [-f title="..."]
gh workflow run machine.yml -f task=TEN-301 -f cmd=build   # on the live server, or a new one on the same volume
gh workflow run machine.yml -f task=TEN-301 -f cmd=down    # server gone, volume stays
gh workflow run machine.yml -f task=TEN-301 -f cmd=close   # after the PR is merged; -f force=true for an abandoned task
```

One run per task at a time (`concurrency`); a second one waits. The job runs
`machines/machine.sh <task> <cmd> ...` on a hosted runner, or on the self-hosted label in
the `MACHINE_RUNNER` variable when the hosted minutes are used up. What each command does:

| cmd | On the bucket | On Hetzner |
|---|---|---|
| `start` | writes `tasks/<task>.json` (project, repo) | volume + server, `tenbox start <task> [--title ...]` |
| `build` | reads it | server, `tenbox build <task>` |
| `down` | reads it | asks the live server `tenbox-watchdog busy` over ssh and keeps it while busy (`task <task> is busy on <ip>: <reason>; the server stays`, exit 0); else, or when it cannot be reached, deletes the server |
| `destroy` | reads it; deletes the state and the facts | deletes server and volume, no archive |
| `close` | reads it; archives `.tenbox/` from the volume to `archive/<task>-<time>.tar.gz`; deletes the state and the facts | server, `tenbox close <task> [--force]`, waits for it over ssh, then deletes server and volume |

"Server" means the task's live server when the state has one: `start`, `build` and `close`
then start their command over ssh with `tenbox-run`, after the command before it has
ended, and no `tofu apply` runs, so the server and its claude session stay. A `build`
within the five idle minutes after `start` keeps the machine; a `build` after the watchdog
took it down boots a new one.

The state is `tasks/<task>.tfstate` in the bucket (`backend "s3"`, Hetzner Object
Storage); `machine.sh` passes the bucket and the key at `tofu init` and talks to the bucket
with `curl --aws-sigv4`. A new server is tried as `cx33`, then `cx43`, then `cx23`
(`SERVER_TYPES`): hel1 runs out of the bigger ones, and `cpx*` cannot be ordered there.
`close` stops when `tenbox close` fails on the machine; the volume stays for a second try,
or for `destroy`, which deletes server, volume and state without an archive. A server is
shut down before it is deleted (`shutdown_before_deletion`): a plain delete is a power cut,
and what the volume got in the last half minute is lost.

Both `close` and `destroy` end in the same delete: `tofu destroy` runs again once, 60 seconds
after a failed first run (Hetzner may still hold a lock on the server). When the second
run fails too, `destroy` posts `<project> · <task> · failed · destroy left the volume, the
state and the facts → gh workflow run machine.yml -f task=<task> -f cmd=destroy` to
`NTFY_URL` and exits 1. What the failed run could not delete stays, and so do `tasks/<task>.tfstate`
and `tasks/<task>.json`; run `destroy` again to finish the job.

Secrets of this repo (Settings → Secrets and variables → Actions): `HCLOUD_TOKEN`,
`BUCKET_ACCESS_KEY`, `BUCKET_SECRET_KEY`, `MACHINE_GITHUB_TOKEN` (a fine-grained token that
reads and writes the projects and may run Actions in this repo: the watchdog calls
`machine.yml` with it), `MACHINE_SSH_KEY` (the private key of the Hetzner ssh key
`tenbox-machine`), and optional `NTFY_URL` and `TRACKER_API_KEY`. Variables:
`TENBOX_BUCKET` (the bucket name), optional `TENBOX_BUCKET_LOCATION` (`hel1`) and
`MACHINE_RUNNER`.

`machines/local.sh` runs the same `machine.sh` from your computer, against the same
bucket, with the secrets read from `~/.config/tenbox/` (`hcloud-token`, `github-token`,
`bucket`, `bucket-access-key`, `bucket-secret-key`), `~/.claude/.credentials.json`,
`~/.ssh/id_ed25519_tenbox_machine` and this repo's `tenbox.local.yaml`:

```
machines/local.sh DEMO-3 start tenbox-demo https://github.com/enojen/tenbox-demo.git "Add a /version route"
machines/local.sh DEMO-3 build
machines/local.sh DEMO-3 close --force
```

## The login: `login/`

Remote Control needs a claude.ai login; `claude setup-token` runs the model but Remote
Control refuses it, and a copy of `~/.claude/.credentials.json` works. The copy lives in the
bucket as `login/credentials.json`. `machines/login/install.sh` installs a systemd user path
unit on your computer that uploads the file whenever it changes, and uploads it once right
away; `/login` on your computer is all a new account needs. Every `start`, `build` and
`close` reads the copy of the moment and gives it to the machine in user data; when its
refresh token has expired, `machine.sh` stops before any server with "run /login on your
computer". The access token lives hours and the refresh token days; whether a refresh on a
machine breaks the login on your computer is being watched for a week from 2026-10-20.

## The watchdog: `watchdog/`

A systemd timer runs `tenbox-watchdog` every minute from two minutes after boot. The
machine counts as busy while a `tenbox-run-*` unit runs, while any tenbox
command runs (a long `tenbox check` through the runner), while `claude agents --json`
lists a session with `status: busy` or `state: working`, or when `claude agents` cannot
run. Five idle minutes (`IDLE_MINUTES`) make it run `gh workflow run machine.yml -f
cmd=down` in the control repo (`control` in `/etc/tenbox-machine.json`), as tenzel with the
machine's GitHub token; it asks again every ten minutes while the machine is still here.
`tenbox-watchdog busy` prints `busy: <reason>` and nothing when idle, without asking for down or
writing the state; `machine.sh down` runs it over ssh so a busy machine is not deleted. `down` keeps the server only when the output starts with `busy: `; any other output (an old watchdog, ssh errors, nothing) counts as idle. The
machine never deletes itself, so the state in the bucket stays true. Log:
`journalctl -u tenbox-watchdog`. The image carries a copy of the script; every boot
overwrites it with the one from `watchdog/`, so a change needs no new image.
