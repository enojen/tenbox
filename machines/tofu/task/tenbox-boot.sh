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

# What must survive the server lives on the volume, bind-mounted into the home directory, so
# every path stays a real /home/tenzel path: git, claude's trust and its transcripts key by
# the real path, and a symlink would give them /mnt/task paths that tenbox does not know.
for dir in wt .tenbox .claude; do
  [ -L "$home/$dir" ] && rm "$home/$dir"
  mkdir -p "$home/$dir"
  mountpoint -q "$home/$dir" || mount --bind "/mnt/task/$dir" "$home/$dir"
  chown tenzel:tenzel "$home/$dir"
done

# claude: the login copy, Remote Control on, the worktrees trusted, no first-run questions.
install -o tenzel -g tenzel -m 600 "$secrets/claude-credentials.json" "$home/.claude/.credentials.json"
if [ ! -f "$home/.claude/settings.json" ]; then
  echo '{ "remoteControlAtStartup": true }' > "$home/.claude/settings.json"
  chown tenzel:tenzel "$home/.claude/settings.json"
fi
main="$home/wt/$project/main"
worktree="$home/wt/$project/$task"
jq -n --arg main "$main" --arg wt "$worktree" --arg repo "$home/tenbox" \
  '{ hasCompletedOnboarding: true, theme: "dark",
     projects: ([$main, $wt, $repo] | map({ (.): { hasTrustDialogAccepted: true } }) | add) }' \
  > "$home/.claude.json"
chown tenzel:tenzel "$home/.claude.json"

# gh and git as tenzel; the git identity is the token's GitHub user.
as_tenzel gh auth login --with-token < "$secrets/github-token"
as_tenzel gh auth setup-git
read -r login id name < <(as_tenzel gh api user --jq '[.login, .id, (.name // .login)] | @tsv')
as_tenzel git config --global user.name "$name"
as_tenzel git config --global user.email "$id+$login@users.noreply.github.com"
tracker_api_key="$(cat "$secrets/tracker-api-key")"
shred -u "$secrets"/*

# The project: cloned on the first run of this task, kept on the volume after that.
if [ ! -d "$main/.git" ]; then
  as_tenzel mkdir -p "$(dirname "$main")"
  as_tenzel git clone --quiet "$repo" "$main"
fi
# The project's local manifest layer: the tracker key and the ntfy URL.
local_manifest="$main/tenbox.local.yaml"
rm -f "$local_manifest"
if [ -n "$tracker_api_key" ]; then
  printf 'tracker:\n  api_key: "%s"\n' "$tracker_api_key" >> "$local_manifest"
fi
if [ -n "$ntfy" ]; then
  printf 'notify:\n  ntfy: "%s"\n' "$ntfy" >> "$local_manifest"
fi
[ ! -f "$local_manifest" ] || chown tenzel:tenzel "$local_manifest"
(cd "$home/tenbox" && as_tenzel tenbox install > /dev/null)

/usr/local/bin/tenbox-run "$cmd"
