#!/usr/bin/env bash
# Runs once per boot from cloud-init, as root. Mounts the task volume, gives tenzel the
# login and the GitHub token, clones the project on the first run and starts the tenbox
# command. Output: journalctl -u cloud-final and /var/log/tenbox-run.log.
set -euo pipefail

cfg=/etc/tenbox-machine.json
task="$(jq -r .task "$cfg")"
project="$(jq -r .project "$cfg")"
repo="$(jq -r .repo "$cfg")"
volume="$(jq -r .volume "$cfg")"
cmd="$(jq -r .cmd "$cfg")"
ntfy="$(jq -r .ntfy "$cfg")"
git_name="$(jq -r .git_name "$cfg")"
git_email="$(jq -r .git_email "$cfg")"
home=/home/tenzel
secrets=/root/tenbox-secrets
as_tenzel() { sudo -u tenzel -H "$@"; }

# The volume is attached after the server exists; wait for it, format it once, mount it.
dev="/dev/disk/by-id/scsi-0HC_Volume_$volume"
for _ in $(seq 1 90); do [ -e "$dev" ] && break; sleep 2; done
[ -e "$dev" ] || { echo "volume $volume not attached"; exit 1; }
blkid "$dev" > /dev/null 2>&1 || mkfs.ext4 -q -L tenbox-task "$dev"
mkdir -p /mnt/task
mountpoint -q /mnt/task || mount "$dev" /mnt/task
mkdir -p /mnt/task/wt /mnt/task/.tenbox /mnt/task/.claude
chown tenzel:tenzel /mnt/task /mnt/task/wt /mnt/task/.tenbox /mnt/task/.claude

# What must survive the server lives on the volume; the home directory only points there.
for dir in wt .tenbox .claude; do
  [ -L "$home/$dir" ] || rm -rf "${home:?}/$dir"
  ln -sfn "/mnt/task/$dir" "$home/$dir"
  chown -h tenzel:tenzel "$home/$dir"
done

# claude: the login copy, Remote Control on, the worktrees trusted, no first-run questions.
install -o tenzel -g tenzel -m 600 "$secrets/claude-credentials.json" /mnt/task/.claude/.credentials.json
if [ ! -f /mnt/task/.claude/settings.json ]; then
  echo '{ "remoteControlAtStartup": true }' > /mnt/task/.claude/settings.json
  chown tenzel:tenzel /mnt/task/.claude/settings.json
fi
main="$home/wt/$project/main"
worktree="$home/wt/$project/$task"
# claude keys trust by the real path, so the /mnt/task paths are trusted as well as the links.
real_main="/mnt/task/wt/$project/main"
real_worktree="/mnt/task/wt/$project/$task"
jq -n --arg main "$main" --arg wt "$worktree" --arg rmain "$real_main" --arg rwt "$real_worktree" --arg repo "$home/tenbox" \
  '{ hasCompletedOnboarding: true, theme: "dark",
     projects: ([$main, $wt, $rmain, $rwt, $repo] | map({ (.): { hasTrustDialogAccepted: true } }) | add) }' \
  > "$home/.claude.json"
chown tenzel:tenzel "$home/.claude.json"

# gh and git as tenzel.
as_tenzel gh auth login --with-token < "$secrets/github-token"
as_tenzel gh auth setup-git
as_tenzel git config --global user.name "$git_name"
as_tenzel git config --global user.email "$git_email"
shred -u "$secrets"/*

# The project: cloned on the first run of this task, kept on the volume after that.
if [ ! -d "$main/.git" ]; then
  as_tenzel mkdir -p "$(dirname "$main")"
  as_tenzel git clone --quiet "$repo" "$main"
fi
if [ -n "$ntfy" ]; then
  printf 'notify:\n  ntfy: "%s"\n' "$ntfy" > "$main/tenbox.local.yaml"
  chown tenzel:tenzel "$main/tenbox.local.yaml"
fi
(cd "$home/tenbox" && as_tenzel tenbox install > /dev/null)

# The tenbox command, detached from cloud-init so its claude session outlives this script.
install -o tenzel -g tenzel -m 644 /dev/null /var/log/tenbox-run.log
systemd-run --unit tenbox-run --uid tenzel --gid tenzel --working-directory "$main" \
  --setenv HOME="$home" --setenv PATH=/usr/local/bin:/usr/bin:/bin -p KillMode=process \
  bash -c "$cmd >> /var/log/tenbox-run.log 2>&1"
echo "tenbox-run started: $cmd"
