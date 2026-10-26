# The tenbox box image for a Kubernetes pod (TEN-460): Ubuntu, bun, Node 24, gh, claude, this
# repo at /opt/tenbox. /home/tenbox is the task volume.
# Build it with the box workflow, or by hand (machines/README.md): the context is
# machines/k8s and holds only the git bundle.
FROM ubuntu:24.04
ARG CLAUDE_CHANNEL=latest
ARG TENBOX_BRANCH=main
ARG TENBOX_REF=unknown
ENV DEBIAN_FRONTEND=noninteractive DISABLE_AUTOUPDATER=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git gnupg jq sudo unzip openssh-client procps \
  && install -d -m 755 /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y --no-install-recommends gh \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Node 24 for Node projects; corepack gives each project the pnpm or yarn of its packageManager.
RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
       | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
  && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" \
       > /etc/apt/sources.list.d/nodesource.list \
  && apt-get update && apt-get install -y --no-install-recommends nodejs \
  && apt-get clean && rm -rf /var/lib/apt/lists/* \
  && corepack enable && node --version

RUN useradd --create-home --shell /bin/bash tenbox \
  && echo 'tenbox ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/tenbox && chmod 440 /etc/sudoers.d/tenbox

RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash && bun --version

# claude for every user: installed into /opt/claude, readable by all, no self-update.
RUN mkdir -p /opt/claude && HOME=/opt/claude bash -c "curl -fsSL https://claude.ai/install.sh | bash -s '$CLAUDE_CHANNEL'" \
  && chmod -R a+rX /opt/claude && ln -s /opt/claude/.local/bin/claude /usr/local/bin/claude \
  && claude --version

COPY .build/tenbox.bundle /tmp/tenbox.bundle
RUN git clone --quiet --branch "$TENBOX_BRANCH" /tmp/tenbox.bundle /opt/tenbox \
  && git -C /opt/tenbox remote set-url origin https://github.com/enojen/tenbox.git \
  && rm /tmp/tenbox.bundle && chown -R tenbox:tenbox /opt/tenbox \
  && cd /opt/tenbox && sudo -u tenbox -H bun install --frozen-lockfile \
  && printf '#!/bin/sh\nexec /usr/local/bin/bun /opt/tenbox/cli/main.ts "$@"\n' > /usr/local/bin/tenbox \
  && chmod 755 /usr/local/bin/tenbox \
  && install -m 755 /opt/tenbox/machines/k8s/boot.sh /usr/local/bin/tenbox-boot \
  && jq -n --arg branch "$TENBOX_BRANCH" --arg ref "$TENBOX_REF" --arg bun "$(bun --version)" --arg gh "$(gh --version | head -1)" \
       --arg node "$(node --version)" --arg claude "$(claude --version)" \
       '{ tenbox: { branch: $branch, ref: $ref }, bun: $bun, gh: $gh, node: $node, claude: $claude }' \
       > /etc/tenbox-image.json

CMD ["/usr/local/bin/tenbox-boot"]
