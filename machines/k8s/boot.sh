#!/usr/bin/env bash
# The box's main process. Reads the task from the machine env (TENBOX_TASK, TENBOX_PROJECT,
# TENBOX_REPO, TENBOX_CMD, and TENBOX_BASE, the project's base branch to check out) and the
# secrets from the app (GITHUB_TOKEN, PROJECT_GITHUB_TOKEN, TRACKER_API_KEY, NTFY_URL,
# CLAUDE_CREDENTIALS); PROJECT_GITHUB_TOKEN, the project's own token,
# wins over GITHUB_TOKEN, the shared one, when it is set and not empty. It prepares the volume
# at /home/tenbox and runs the tenbox command in the foreground, as tenbox, in the project's
# main checkout, with the project's variables from TENBOX_ENV (`machine.env` of tenbox.yaml as
# one JSON object). The command may
# leave a claude session behind (`tenbox start` and `tenbox build` do): the container then
# lives while that session works and ends once no session is left or the sessions have been
# idle for IDLE_MINUTES (a plan that waits for approval). Last it logs the peak RAM and the
# CPU time of the container. Exits with the command's exit code. The output is also in
# /var/log/tenbox-run.log.
set -euo pipefail
: "${TENBOX_TASK:?}" "${TENBOX_PROJECT:?}" "${TENBOX_REPO:?}" "${TENBOX_CMD:?}"
: "${GITHUB_TOKEN:?}" "${CLAUDE_CREDENTIALS:?}"
IDLE_MINUTES="${IDLE_MINUTES:-1}"
CHECK_SECONDS=30

home=/home/tenbox
main="$home/wt/$TENBOX_PROJECT/main"
worktree="$home/wt/$TENBOX_PROJECT/$TENBOX_TASK"

box_env=(HOME="$home" PATH=/usr/local/bin:/usr/bin:/bin USER=tenbox LOGNAME=tenbox SHELL=/bin/bash)
for name in HTTPS_PROXY HTTP_PROXY NO_PROXY; do
  if [ -n "${!name:-}" ]; then box_env+=("$name=${!name}" "${name,,}=${!name}"); fi
done
for name in NODE_USE_ENV_PROXY DISABLE_TELEMETRY DISABLE_ERROR_REPORTING; do
  if [ -n "${!name:-}" ]; then box_env+=("$name=${!name}"); fi
done
clean_env() { env -i "${box_env[@]}" "$@"; }
log() { echo "tenbox-boot: $*"; }

# 1. The volume: the pod's fsGroup gives a new, empty volume to the tenbox group.
prepare_home() {
  for dir in wt .tenbox .claude; do
    install -d "$home/$dir"
  done
  cp /etc/skel/.bashrc "$home/.bashrc" 2> /dev/null || true
}

# 2. claude: the login, Remote Control on, and no first-run questions for the three folders.
setup_claude() {
  install -m 600 /dev/null "$home/.claude/.credentials.json"
  printf '%s' "$CLAUDE_CREDENTIALS" > "$home/.claude/.credentials.json"
  if [ ! -f "$home/.claude/settings.json" ]; then
    echo '{ "remoteControlAtStartup": true }' > "$home/.claude/settings.json"
  fi
  jq -n --arg main "$main" --arg wt "$worktree" --arg repo /opt/tenbox \
    '{ hasCompletedOnboarding: true, theme: "dark",
       projects: ([$main, $wt, $repo] | map({ (.): { hasTrustDialogAccepted: true } }) | add) }' \
    > "$home/.claude.json"
}

# 3. GitHub: gh and git push use the token; commits carry the token owner's name.
setup_github() {
  clean_env gh auth login --with-token <<< "${PROJECT_GITHUB_TOKEN:-$GITHUB_TOKEN}"
  clean_env gh auth setup-git
  local login id name
  read -r login id name < <(clean_env gh api user --jq '[.login, .id, (.name // .login)] | @tsv')
  clean_env git config --global user.name "$name"
  clean_env git config --global user.email "$id+$login@users.noreply.github.com"
}

# 4. The project: clone once (the volume keeps it), write tenbox.local.yaml anew every boot.
setup_project() {
  if [ ! -d "$main/.git" ]; then
    mkdir -p "$(dirname "$main")"
    clean_env git clone --quiet ${TENBOX_BASE:+--branch "$TENBOX_BASE"} "$TENBOX_REPO" "$main"
  elif [ -n "${TENBOX_BASE:-}" ]; then
    clean_env git -C "$main" fetch --quiet origin "$TENBOX_BASE"
    clean_env git -C "$main" checkout --quiet "$TENBOX_BASE"
  fi
  if [ -n "${TENBOX_BASE:-}" ] && ! clean_env git -C "$main" ls-files --error-unmatch tenbox.yaml > /dev/null 2>&1; then
    log "tenbox.yaml is not tracked in the main checkout on base $TENBOX_BASE"
    exit 1
  fi
  local manifest="$main/tenbox.local.yaml"
  install -m 600 /dev/null "$manifest"
  [ -z "${TRACKER_API_KEY:-}" ] || printf 'tracker:\n  api_key: "%s"\n' "$TRACKER_API_KEY" >> "$manifest"
  [ -z "${NTFY_URL:-}" ] || printf 'notify:\n  ntfy: "%s"\n' "$NTFY_URL" >> "$manifest"
  [ -s "$manifest" ] || rm -f "$manifest"
}

# 5. tenbox: link agents/ and workflows/ into ~/.claude/.
install_tenbox() {
  (cd /opt/tenbox && clean_env tenbox install > /dev/null)
}

# 6. The project's variables as NAME=VALUE words for env. They come before HOME and PATH, so
#    those two stay the box's.
project_env=()
read_project_env() {
  mapfile -d '' -t project_env < <(
    jq -j '(. // {}) | to_entries[] | "\(.key)=\(.value)\u0000"' <<< "${TENBOX_ENV:-null}"
  )
  wait $!
}

# 7. After the command: stay while a claude session works: its status is busy. A resumed session
#    can keep state working after its turn ended, so state does not count.
sessions_json() { clean_env claude agents --json 2> /dev/null || echo "[]"; }
wait_for_sessions() {
  local idle=0 sessions working
  while :; do
    sessions="$(sessions_json)"
    if [ "$(printf '%s' "$sessions" | jq length)" -eq 0 ]; then
      log "no session left"
      return
    fi
    working="$(printf '%s' "$sessions" | jq '[.[] | select(.status == "busy")] | length')"
    if [ "$working" -gt 0 ]; then idle=0; else idle=$((idle + 1)); fi
    if [ $((idle * CHECK_SECONDS)) -ge $((IDLE_MINUTES * 60)) ]; then
      log "sessions idle for $IDLE_MINUTES min"
      return
    fi
    sleep "$CHECK_SECONDS"
  done
}

# 8. What the box used, for the resource classes of tenyard: the peak RAM, the CPU time, the peak of
#    processes and threads, and the OOM kills of its cgroup, from the boot to now.
log_usage() {
  local cgroup=/sys/fs/cgroup peak cpu pids oom
  peak="$(cat "$cgroup/memory.peak" 2> /dev/null)" || { log "no memory.peak in $cgroup"; return; }
  cpu="$(awk '$1 == "usage_usec" { print int($2 / 1000000) }' "$cgroup/cpu.stat")"
  pids="$(cat "$cgroup/pids.peak" 2> /dev/null)"
  oom="$(awk '$1 == "oom_kill" { print $2 }' "$cgroup/memory.events" 2> /dev/null)"
  log "memory peak $((peak / 1048576)) MiB, cpu $cpu s, pids peak ${pids:-?}, oom_kill ${oom:-0}"
}

# 9. The logins live only as long as the run: the volume outlives it.
remove_logins() {
  rm -f "$home/.claude/.credentials.json" "$home/.config/gh/hosts.yml" "$main/tenbox.local.yaml"
}

log "image: $(cat /etc/tenbox-image.json)"
trap remove_logins EXIT
trap 'exit 143' TERM INT
prepare_home
setup_claude
setup_github
setup_project
install_tenbox
read_project_env

# The secrets now live in their files; the tenbox command does not get them in its env.
unset GITHUB_TOKEN PROJECT_GITHUB_TOKEN CLAUDE_CREDENTIALS TRACKER_API_KEY NTFY_URL
log "ready at $(date -u +%FT%TZ)"

: > /var/log/tenbox-run.log
set +e
env -i "${project_env[@]}" "${box_env[@]}" bash -c "cd '$main' && $TENBOX_CMD" 2>&1 < /dev/null | tee -a /var/log/tenbox-run.log
status="${PIPESTATUS[0]}"
log "command ended with exit code $status"
wait_for_sessions
log_usage
exit "$status"
