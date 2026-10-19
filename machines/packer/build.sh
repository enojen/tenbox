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