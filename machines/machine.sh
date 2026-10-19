#!/usr/bin/env bash
# One task machine, one command: what .github/workflows/machine.yml runs on a GitHub runner
# and what machines/local.sh runs from your computer with the same secrets.
#
#   machines/machine.sh <task> start <project> <repo url> [title]  # volume + server, tenbox start
#   machines/machine.sh <task> build          # tenbox build on the live server, or a new one
#   machines/machine.sh <task> close [--force] # tenbox close, archive the task dir, destroy all
#   machines/machine.sh <task> down           # delete the server unless busy, keep the volume
#   machines/machine.sh <task> destroy        # delete server, volume and state without close
#
# The bucket holds the state, tasks/<task>.tfstate, the facts of the task that every run
# needs, tasks/<task>.json, and the archive of a closed task, archive/<task>-<time>.tar.gz.
#
# The bucket also holds the claude.ai login, login/credentials.json, uploaded by
# machines/login/ from your computer; a machine gets the copy of the moment, and no machine
# starts with a login whose refresh token has expired.
#
# Environment: HCLOUD_TOKEN, TENBOX_BUCKET, BUCKET_ACCESS_KEY, BUCKET_SECRET_KEY,
# MACHINE_GITHUB_TOKEN, MACHINE_SSH_KEY_FILE. Optional: TENBOX_BUCKET_LOCATION (hel1),
# TENBOX_BUCKET_ENDPOINT, NTFY_URL, TRACKER_API_KEY, SERVER_TYPES ("cx33 cx43 cx23").
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
task="${1:?task id}"
action="${2:?start | build | close | down | destroy}"
: "${HCLOUD_TOKEN:?}" "${TENBOX_BUCKET:?}" "${BUCKET_ACCESS_KEY:?}" "${BUCKET_SECRET_KEY:?}" \
  "${MACHINE_GITHUB_TOKEN:?}" "${MACHINE_SSH_KEY_FILE:?}"
location="${TENBOX_BUCKET_LOCATION:-hel1}"
endpoint="${TENBOX_BUCKET_ENDPOINT:-https://$location.your-objectstorage.com}"
bucket_url="${endpoint/:\/\//:\/\/$TENBOX_BUCKET.}"
server_types="${SERVER_TYPES:-cx33 cx43 cx23}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
facts="$work/facts.json"

# The bucket through curl; tofu reads the same keys and endpoint from the AWS variables.
export AWS_ACCESS_KEY_ID="$BUCKET_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$BUCKET_SECRET_KEY"
export AWS_REGION="$location" AWS_ENDPOINT_URL_S3="$endpoint"
object() { # <method> <key> [curl options]
  local method="$1" key="$2"
  shift 2
  curl -sS -f -X "$method" --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
    --aws-sigv4 "aws:amz:$location:s3" "$bucket_url/$key" "$@"
}
fetch_facts() { object GET "tasks/$task.json" -o "$facts" 2> /dev/null; }

# The login of the moment, from the bucket; refused when its refresh token has expired.
login="$work/credentials.json"
fetch_login() {
  object GET login/credentials.json -o "$login" 2> /dev/null \
    || { echo "no login in the bucket: run machines/login/install.sh on your computer" >&2; return 1; }
  local expiry
  expiry="$(jq -r '(.claudeAiOauth.refreshTokenExpiresAt // 0) / 1000 | floor' "$login")"
  if [ "$expiry" -le "$(date +%s)" ]; then
    echo "the claude.ai login expired on $(jq -rn "$expiry | todate"): run /login on your computer" >&2
    return 1
  fi
}

# The login is empty until boot() reads it: down and destroy need no server and no login.
export TF_VAR_task="$task" TF_VAR_hcloud_token="$HCLOUD_TOKEN" \
  TF_VAR_github_token="$MACHINE_GITHUB_TOKEN" TF_VAR_claude_credentials="" \
  TF_VAR_ntfy="${NTFY_URL:-}" TF_VAR_tracker_api_key="${TRACKER_API_KEY:-}"
cd "$here/tofu/task"
tofu init -input=false -reconfigure \
  -backend-config="bucket=$TENBOX_BUCKET" -backend-config="key=tasks/$task.tfstate" > /dev/null
apply() { tofu apply -auto-approve -input=false -var-file="$facts" "$@"; }

live_ip() { tofu output -json server 2> /dev/null | jq -r '.ip // empty' || true; }

remote() { # <command on the server, as root>
  ssh -i "$MACHINE_SSH_KEY_FILE" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR -o ConnectTimeout=10 "root@$ip" "$@"
}
wait_for_boot() {
  for _ in $(seq 1 30); do remote true 2> /dev/null && break; sleep 5; done
  remote true 2> /dev/null || { echo "cannot reach $ip over ssh" >&2; return 1; }
  remote cloud-init status --wait > /dev/null || { remote journalctl -u cloud-final --no-pager; return 1; }
}
wait_for_run() { while remote systemctl is-active --quiet "'tenbox-run-*'"; do sleep 10; done; }

# A new server with the tenbox command, trying the server types in order: hel1 runs out of some.
boot() { # <tenbox command>
  local type log="$work/apply.log"
  fetch_login
  TF_VAR_claude_credentials="$(cat "$login")"
  for type in $server_types; do
    if apply -var up=true -var "cmd=$1" -var "server_type=$type" 2>&1 | tee "$log"; then
      ip="$(live_ip)"
      return 0
    fi
    grep -q resource_unavailable "$log" || return 1
    echo "no $type in $location, trying the next type" >&2
  done
  echo "no server type available: $server_types" >&2
  return 1
}

# The tenbox command on the task's live server when the state has one, after the command
# before it: no tofu apply, the server and its session stay. Else on a new server.
up() { # <tenbox command>
  ip="$(live_ip)"
  [ -n "$ip" ] || { boot "$1"; return; }
  echo "task $task has a live server, $ip: running there" >&2
  wait_for_boot
  wait_for_run
  remote tenbox-run "$(printf %q "$1")"
}

start() {
  local project="${1:-}" repo="${2:-}" title="${3:-}" command="tenbox start $task"
  [ -n "$project" ] && [ -n "$repo" ] || { echo "start needs the project and the repo url" >&2; exit 2; }
  [ -z "$title" ] || command="$command --title $(printf %q "$title")"
  jq -n --arg project "$project" --arg repo "$repo" '{ project: $project, repo: $repo }' > "$facts"
  object PUT "tasks/$task.json" -T "$facts"
  up "$command"
}

build() {
  fetch_facts || { echo "task $task was never started here" >&2; exit 1; }
  up "tenbox build $task"
}

down() {
  fetch_facts || { echo "task $task has no machine; nothing to take down" >&2; exit 0; }
  local answer
  ip="$(live_ip)"
  # Only a `busy: <reason>` line keeps the server: an old watchdog, ssh noise or no answer is idle.
  if [ -n "$ip" ] && answer="$(remote tenbox-watchdog busy 2> /dev/null)" && [[ "$answer" == "busy: "* ]]; then
    echo "task $task is busy on $ip: ${answer#busy: }; the server stays"
    exit 0
  fi
  apply -var up=false
}

# The way out when close fails on the machine: nothing is archived.
destroy() {
  fetch_facts || { echo "task $task has no machine; nothing to destroy" >&2; exit 0; }
  tofu destroy -auto-approve -input=false -var-file="$facts"
  object DELETE "tasks/$task.json"
  object DELETE "tasks/$task.tfstate"
}

# Close on the machine, keep what the volume holds, then delete server, volume and state.
close() { # [--force]
  fetch_facts || { echo "task $task was never started here" >&2; exit 1; }
  up "tenbox close $task ${1:-}"
  wait_for_boot
  wait_for_run
  remote cat /var/log/tenbox-run.log
  if remote systemctl is-failed --quiet "\$(cat /run/tenbox-run.unit)"; then
    echo "tenbox close failed on the machine; the volume stays" >&2
    exit 1
  fi
  remote tar -C /mnt/task -czf - .tenbox > "$work/archive.tar.gz"
  object PUT "archive/$task-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" -T "$work/archive.tar.gz"
  destroy
}

case "$action" in
  start) start "${3:-}" "${4:-}" "${5:-}" ;;
  build | down | destroy) "$action" ;;
  close) close "${3:-}" ;;
  *) echo "unknown command $action" >&2; exit 2 ;;
esac
