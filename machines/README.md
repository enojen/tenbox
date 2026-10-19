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
on the image. Rebuild when claude, bun or tenbox should move; old snapshots can be deleted in
the Hetzner console.

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
close, and a server `tenbox-<task>` (`cx33`, `hel1`) that exists while `up` is true. The
server boots from the newest snapshot labelled `tenbox-image=true` and gets cloud-init user
data: the machine facts (`/etc/tenbox-machine.json`), the GitHub token, the claude.ai login
copy and `tenbox-boot.sh`. For now the secrets travel in user data; the boot script shreds
them once gh and claude have them.

`tenbox-boot.sh` runs once per boot as root: waits for the volume, formats it on the first
run, mounts it on `/mnt/task` and points `~tenzel/wt`, `~tenzel/.tenbox` and `~tenzel/.claude`
there; writes the login, `remoteControlAtStartup`, and trust for the main checkout and the
task worktree; logs gh in; clones the project into `~/wt/<project>/main` on the first run;
writes `tenbox.local.yaml` with the ntfy URL; runs `tenbox install`; then starts the tenbox
command as a transient systemd unit `tenbox-run`, so its claude session outlives cloud-init.
Output: `journalctl -u cloud-final`, `/var/log/tenbox-run.log`.

Until `machine.yml` exists (TEN-421), `tofu/task.sh` runs the module from your computer
with local state under `machines/tofu/.build/`:

```
machines/tofu/task.sh DEMO-3 up tenbox-demo https://github.com/enojen/tenbox-demo.git \
  "tenbox start DEMO-3 --title 'Add a /version route'"
machines/tofu/task.sh DEMO-3 down      # server gone, volume stays
machines/tofu/task.sh DEMO-3 up ...    # next run: same volume, new server
machines/tofu/task.sh DEMO-3 destroy   # after close: volume gone too
```

It reads `~/.config/tenbox/hcloud-token`, `~/.config/tenbox/github-token`,
`~/.claude/.credentials.json`, your git name and email, and `notify.ntfy` from this repo's
`tenbox.local.yaml`. It needs `tofu` on the PATH.

## The watchdog: `watchdog/`

A systemd timer runs `tenbox-watchdog` every minute from two minutes after boot. It lists
tenzel's claude sessions with `claude agents --json`, counts the ones that still work
(`status: busy` or `state: working`) and logs how long the machine has been idle
(`journalctl -u tenbox-watchdog`). Five idle minutes (`IDLE_MINUTES`) log "ready to go
down". Today it only logs; asking the control plane to delete the machine is TEN-421. When
`claude agents` cannot run, the machine counts as busy.
