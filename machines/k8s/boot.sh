#!/usr/bin/env bash
# The box's main process. Reads the task from the machine env (TENBOX_TASK, TENBOX_PROJECT,
# TENBOX_REPO, TENBOX_CMD) and the secrets from the app (GITHUB_TOKEN, TRACKER_API_KEY,
# NTFY_URL, CLAUDE_CREDENTIALS), prepares the volume at /home/tenbox and runs the tenbox
# command in the foreground, as tenbox, in the project's main checkout. The command may
# leave a claude session behind (`tenbox start` and `tenbox build` do): the container then
# lives while that session works and ends once no session is left or the sessions have been
# idle for IDLE_MINUTES (a plan that waits for approval). Exits with the command's exit
# code. The output is also in /var/log/tenbox-run.log.
set -euo pipefail
: "${TENBOX_TASK:?}" "${TENBOX_PROJECT:?}" "${TENBOX_REPO:?}" "${TENBOX_CMD:?}"
: "${GITHUB_TOKEN:?}" "${CLAUDE_CREDENTIALS:?}"
IDLE_MINUTES="${IDLE_MINUTES:-1}"
CHECK_SECONDS=30

home=/home/tenbox
main="$home/wt/$TENBOX_PROJECT/main"
worktree="$home/wt/$TENBOX_PROJECT/$TENBOX_TASK"

as_tenbox() { sudo -u tenbox -H env HOME="$home" PATH=/usr/local/bin:/usr/bin:/bin "$@"; }
log() { echo "tenbox-boot: $*"; }

# 1. The volume: a new volume is owned by root and empty.
prepare_home() {
  chown tenbox:tenbox "$home"
  for dir in wt .tenbox .claude; do
    install -d -o tenbox -g tenbox "$home/$dir"
  done
  cp /etc/skel/.bashrc "$home/.bashrc" 2> /dev/null || true
}

# 2. claude: the login, Remote Control on, and no first-run questions for the three folders.
setup_claude() {
  install -o tenbox -g tenbox -m 600 /dev/null "$home/.claude/.credentials.json"
  printf '%s' "$CLAUDE_CREDENTIALS" > "$home/.claude/.credentials.json"
  if [ ! -f "$home/.claude/settings.json" ]; then
    echo '{ "remoteControlAtStartup": true }' > "$home/.claude/settings.json"
    chown tenbox:tenbox "$home/.claude/settings.json"
  fi
  jq -n --arg main "$main" --arg wt "$worktree" --arg repo /opt/tenbox \
    '{ hasCompletedOnboarding: true, theme: "dark",
       projects: ([$main, $wt, $repo] | map({ (.): { hasTrustDialogAccepted: true } }) | add) }' \
    > "$home/.claude.json"
  chown tenbox:tenbox "$home/.claude.json"
}

# 3. GitHub: gh and git push use the token; commits carry the token owner's name.
setup_github() {
  as_tenbox gh auth login --with-token <<< "$GITHUB_TOKEN"
  as_tenbox gh auth setup-git
  local login id name
  read -r login id name < <(as_tenbox gh api user --jq '[.login, .id, (.name // .login)] | @tsv')
  as_tenbox git config --global user.name "$name"
  as_tenbox git config --global user.email "$id+$login@users.noreply.github.com"
}

# 4. The project: clone once (the volume keeps it), write tenbox.local.yaml anew every boot.
setup_project() {
  if [ ! -d "$main/.git" ]; then
    as_tenbox mkdir -p "$(dirname "$main")"
    as_tenbox git clone --quiet "$TENBOX_REPO" "$main"
  fi
  local manifest="$main/tenbox.local.yaml"
  install -m 600 -o tenbox -g tenbox /dev/null "$manifest"
  [ -z "${TRACKER_API_KEY:-}" ] || printf 'tracker:\n  api_key: "%s"\n' "$TRACKER_API_KEY" >> "$manifest"
  [ -z "${NTFY_URL:-}" ] || printf 'notify:\n  ntfy: "%s"\n' "$NTFY_URL" >> "$manifest"
  [ -s "$manifest" ] || rm -f "$manifest"
}

# 5. tenbox: link agents/ and workflows/ into ~/.claude/.
install_tenbox() {
  (cd /opt/tenbox && as_tenbox tenbox install > /dev/null)
}

# 6. After the command: stay while a claude session works.
sessions_json() { as_tenbox claude agents --json 2> /dev/null || echo "[]"; }
wait_for_sessions() {
  local idle=0 sessions working
  while :; do
    sessions="$(sessions_json)"
    if [ "$(printf '%s' "$sessions" | jq length)" -eq 0 ]; then
      log "no session left"
      return
    fi
    working="$(printf '%s' "$sessions" | jq '[.[] | select(.status == "busy" or .state == "working")] | length')"
    if [ "$working" -gt 0 ]; then idle=0; else idle=$((idle + 1)); fi
    if [ $((idle * CHECK_SECONDS)) -ge $((IDLE_MINUTES * 60)) ]; then
      log "sessions idle for $IDLE_MINUTES min"
      return
    fi
    sleep "$CHECK_SECONDS"
  done
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
sudo -u tenbox -H env HOME="$home" PATH=/usr/local/bin:/usr/bin:/bin \
  bash -c "cd '$main' && $TENBOX_CMD" 2>&1 < /dev/null | tee -a /var/log/tenbox-run.log
status="${PIPESTATUS[0]}"
log "command ended with exit code $status"
wait_for_sessions
exit "$status"
