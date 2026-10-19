#!/usr/bin/env bash
# This repo at /home/tenzel/tenbox from the uploaded bundle, its dependencies, the tenbox and
# claude commands for every user, and /etc/tenbox-image.json with what went in.
set -euo pipefail

git clone --quiet --branch "$TENBOX_BRANCH" /tmp/tenbox.bundle /home/tenzel/tenbox
git -C /home/tenzel/tenbox remote set-url origin git@github.com:enojen/tenbox.git
chown -R tenzel:tenzel /home/tenzel/tenbox
sudo -u tenzel -H bash -c 'cd ~/tenbox && bun install --frozen-lockfile'

cat > /usr/local/bin/tenbox <<'WRAP'
#!/bin/sh
exec /usr/local/bin/bun /home/tenzel/tenbox/cli/main.ts "$@"
WRAP
chmod 755 /usr/local/bin/tenbox

sudo -u tenzel -H bash -c "curl -fsSL https://claude.ai/install.sh | bash -s '$CLAUDE_CHANNEL'"
ln -s /home/tenzel/.local/bin/claude /usr/local/bin/claude

jq -n \
  --arg built "$BUILT" \
  --arg branch "$TENBOX_BRANCH" \
  --arg ref "$TENBOX_REF" \
  --arg bun "$(bun --version)" \
  --arg gh "$(gh --version | head -1)" \
  --arg claude "$(sudo -u tenzel -H claude --version)" \
  '{ built: $built, tenbox: { branch: $branch, ref: $ref }, bun: $bun, gh: $gh, claude: $claude }' \
  > /etc/tenbox-image.json
cat /etc/tenbox-image.json
