#!/usr/bin/env bash
# Runs the task module by hand, before machine.yml exists (TEN-420).
#
#   machines/tofu/task.sh <task> up <project> <repo url> "<tenbox command>"
#   machines/tofu/task.sh <task> down            # delete the server, keep the volume
#   machines/tofu/task.sh <task> destroy         # delete the volume too (after close)
#   machines/tofu/task.sh <task> output
#
# Reads: ~/.config/tenbox/hcloud-token, ~/.config/tenbox/github-token,
# ~/.claude/.credentials.json, git user.name and user.email, and notify.ntfy from the
# tenbox repo's tenbox.local.yaml. State: machines/tofu/.build/<task>.tfstate (gitignored).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
task="${1:?task id}"
action="${2:?up | down | destroy | output}"
mkdir -p "$here/.build"
state="$here/.build/$task.tfstate"
vars="$here/.build/$task.tfvars.json"

export TF_VAR_hcloud_token TF_VAR_github_token TF_VAR_claude_credentials
TF_VAR_hcloud_token="$(tr -d '\n' < ~/.config/tenbox/hcloud-token)"
TF_VAR_github_token="$(tr -d '\n' < ~/.config/tenbox/github-token)"
TF_VAR_claude_credentials="$(cat ~/.claude/.credentials.json)"

if [ "$action" = up ]; then
  project="${3:?project name}"; repo="${4:?repo url}"; cmd="${5:?tenbox command}"
  ntfy="$(grep -A2 '^notify:' "$here/../../tenbox.local.yaml" 2>/dev/null | grep -o 'https://ntfy[^" ]*' || true)"
  jq -n --arg task "$task" --arg project "$project" --arg repo "$repo" --arg cmd "$cmd" --arg ntfy "$ntfy" \
    --arg git_name "$(git config user.name)" --arg git_email "$(git config user.email)" \
    '{ task: $task, project: $project, repo: $repo, cmd: $cmd, ntfy: $ntfy, git_name: $git_name, git_email: $git_email }' \
    > "$vars"
fi
[ -f "$vars" ] || { echo "no $vars: run up first" >&2; exit 1; }

cd "$here/task"
[ -d .terraform ] || tofu init -input=false > /dev/null
case "$action" in
  up)      tofu apply -auto-approve -input=false -state="$state" -var-file="$vars" -var up=true ;;
  down)    tofu apply -auto-approve -input=false -state="$state" -var-file="$vars" -var up=false ;;
  destroy) tofu destroy -auto-approve -input=false -state="$state" -var-file="$vars" && rm -f "$vars" ;;
  output)  tofu output -state="$state" -json ;;
  *)       echo "unknown action $action" >&2; exit 2 ;;
esac
