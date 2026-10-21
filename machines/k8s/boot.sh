#!/usr/bin/env bash
# The box's main process. Reads the task from the machine env (TENBOX_TASK, TENBOX_PROJECT,
# TENBOX_REPO, TENBOX_CMD) and the secrets from the app (GITHUB_TOKEN, TRACKER_API_KEY,
# NTFY_URL, CLAUDE_CREDENTIALS), prepares the volume at /home/tenzel and runs the tenbox
# command in the foreground, as tenzel, in the project's main checkout. The container lives
# as long as the command and exits with its exit code. The output is also in
# /var/log/tenbox-run.log.
set -euo pipefail
: "${TENBOX_TASK:?}" "${TENBOX_PROJECT:?}" "${TENBOX_REPO:?}" "${TENBOX_CMD:?}"
: "${GITHUB_TOKEN:?}" "${CLAUDE_CREDENTIALS:?}"

home=/home/tenzel
main="$home/wt/$TENBOX_PROJECT/main"
worktree="$home/wt/$TENBOX_PROJECT/$TENBOX_TASK"

as_tenzel() { sudo -u tenzel -H env HOME="$home" PATH=/usr/local/bin:/usr/bin:/bin "$@"; }
log() { echo "tenbox-boot: $*"; }

# 1. The volume: a new volume is owned by root and empty.
prepare_home() {
  chown tenzel:tenzel "$home"
  for dir in wt .tenbox .claude; do
    install -d -o tenzel -g tenzel "$home/$dir"
  done
  cp /etc/skel/.bashrc "$home/.bashrc" 2> /dev/null || true
}

# 2. claude: the login, Remote Control on, and no first-run questions for the three folders.
setup_claude() {
  install -o tenzel -g tenzel -m 600 /dev/null "$home/.claude/.credentials.json"
  printf '%s' "$CLAUDE_CREDENTIALS" > "$home/.claude/.credentials.json"
  if [ ! -f "$home/.claude/settings.json" ]; then
    echo '{ "remoteControlAtStartup": true }' > "$home/.claude/settings.json"
    chown tenzel:tenzel "$home/.claude/settings.json"
  fi
  jq -n --arg main "$main" --arg wt "$worktree" --arg repo /opt/tenbox \
    '{ hasCompletedOnboarding: true, theme: "dark",
       projects: ([$main, $wt, $repo] | map({ (.): { hasTrustDialogAccepted: true } }) | add) }' \
    > "$home/.claude.json"
  chown tenzel:tenzel "$home/.claude.json"
}

# 3. GitHub: gh and git push use the token; commits carry the token owner's name.
setup_github() {
  as_tenzel gh auth login --with-token <<< "$GITHUB_TOKEN"
  as_tenzel gh auth setup-git
  local login id name
  read -r login id name < <(as_tenzel gh api user --jq '[.login, .id, (.name // .login)] | @tsv')
  as_tenzel git config --global user.name "$name"
  as_tenzel git config --global user.email "$id+$login@users.noreply.github.com"
}

# 4. The project: clone once (the volume keeps it), write tenbox.local.yaml anew every boot.
setup_project() {
  if [ ! -d "$main/.git" ]; then
    as_tenzel mkdir -p "$(dirname "$main")"
    as_tenzel git clone --quiet "$TENBOX_REPO" "$main"
  fi
  local manifest="$main/tenbox.local.yaml"
  install -m 600 -o tenzel -g tenzel /dev/null "$manifest"
  [ -z "${TRACKER_API_KEY:-}" ] || printf 'tracker:\n  api_key: "%s"\n' "$TRACKER_API_KEY" >> "$manifest"
  [ -z "${NTFY_URL:-}" ] || printf 'notify:\n  ntfy: "%s"\n' "$NTFY_URL" >> "$manifest"
  [ -s "$manifest" ] || rm -f "$manifest"
}

# 5. tenbox: link agents/ and workflows/ into ~/.claude/.
install_tenbox() {
  (cd /opt/tenbox && as_tenzel tenbox install > /dev/null)
}

log "image: $(cat /etc/tenbox-image.json)"
prepare_home
setup_claude
setup_github
setup_project
install_tenbox

# The secrets now live in their files; the tenbox command does not get them in its env.
unset GITHUB_TOKEN CLAUDE_CREDENTIALS TRACKER_API_KEY NTFY_URL
log "ready at $(date -u +%FT%TZ)"

install -m 644 /dev/null /var/log/tenbox-run.log
set +e
sudo -u tenzel -H env HOME="$home" PATH=/usr/local/bin:/usr/bin:/bin \
  bash -c "cd '$main' && $TENBOX_CMD" 2>&1 < /dev/null | tee -a /var/log/tenbox-run.log
status="${PIPESTATUS[0]}"
log "command ended with exit code $status"
exit "$status"
