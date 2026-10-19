#!/usr/bin/env bash
# Builds the tenbox machine image on Hetzner Cloud.
#
#   HCLOUD_TOKEN=... machines/packer/build.sh [branch]
#
# The image gets this repo at <branch> (default: the current branch) as a git bundle, so only
# committed work goes in and no GitHub token is needed. Prints the snapshot at the end.
set -euo pipefail
cd "$(dirname "$0")"
: "${HCLOUD_TOKEN:?set HCLOUD_TOKEN to a read-write Hetzner Cloud API token}"

branch="${1:-$(git rev-parse --abbrev-ref HEAD)}"
sha="$(git rev-parse "refs/heads/$branch")"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "note: uncommitted changes are not part of the image; it gets $branch at ${sha:0:7}" >&2
fi

mkdir -p .build
git bundle create .build/tenbox.bundle "refs/heads/$branch"

packer init .
packer build -var "tenbox_branch=$branch" -var "tenbox_ref=$sha" .
# Keep the newest KEEP_IMAGES snapshots labelled tenbox-image=true and delete the rest.
# The image is built by now, so a pruning failure is only a note. In a `||` context set -e is
# off, hence the explicit `|| return 1`.
prune() {
  local keep="${KEEP_IMAGES:-3}"
  local api="${HCLOUD_API_URL:-https://api.hetzner.cloud/v1/images}"
  local auth="Authorization: Bearer $HCLOUD_TOKEN"
  local list old_ids id
  list="$(curl -fsS -H "$auth" \
    "$api?type=snapshot&label_selector=tenbox-image%3Dtrue&sort=created:desc&per_page=50")" || return 1
  old_ids="$(jq -r --argjson keep "$keep" '.images[$keep:][].id' <<<"$list")" || return 1
  for id in $old_ids; do
    echo "deleting old image $id" >&2
    curl -fsS -X DELETE -H "$auth" "$api/$id" >/dev/null || return 1
  done
}
prune || echo "note: could not prune old images; the new image is built" >&2
