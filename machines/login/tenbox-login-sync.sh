#!/usr/bin/env bash
# Uploads ~/.claude/.credentials.json, the claude.ai login, to the bucket as login/credentials.json.
# tenbox-login-sync.path runs it whenever the file changes; machine.sh gives every machine the
# copy from the bucket. Reads ~/.config/tenbox/bucket, bucket-access-key, bucket-secret-key.
set -euo pipefail
config="$HOME/.config/tenbox"
line() { tr -d ' \n\r' < "$config/$1"; }
bucket="$(line bucket)"
location="${TENBOX_BUCKET_LOCATION:-hel1}"
file="$HOME/.claude/.credentials.json"
[ -s "$file" ] || { echo "no login at $file" >&2; exit 1; }
curl -sS -f --user "$(line bucket-access-key):$(line bucket-secret-key)" --aws-sigv4 "aws:amz:$location:s3" \
  -T "$file" "https://$bucket.$location.your-objectstorage.com/login/credentials.json"
echo "login uploaded to $bucket: $(jq -r '.claudeAiOauth.refreshTokenExpiresAt / 1000 | todate' "$file") refresh expiry"
