# The tenbox box image for a Kubernetes pod (TEN-460): Ubuntu, bun, gh, claude, this
# repo at /opt/tenbox. /home/tenzel is the task volume.
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

RUN useradd --create-home --shell /bin/bash tenzel \
  && echo 'tenzel ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/tenzel && chmod 440 /etc/sudoers.d/tenzel

RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash && bun --version

# claude for every user: installed into /opt/claude, readable by all, no self-update.
RUN mkdir -p /opt/claude && HOME=/opt/claude bash -c "curl -fsSL https://claude.ai/install.sh | bash -s '$CLAUDE_CHANNEL'" \
  && chmod -R a+rX /opt/claude && ln -s /opt/claude/.local/bin/claude /usr/local/bin/claude \
  && claude --version

COPY .build/tenbox.bundle /tmp/tenbox.bundle
RUN git clone --quiet --branch "$TENBOX_BRANCH" /tmp/tenbox.bundle /opt/tenbox \
  && git -C /opt/tenbox remote set-url origin https://github.com/enojen/tenbox.git \
  && rm /tmp/tenbox.bundle && chown -R tenzel:tenzel /opt/tenbox \
  && cd /opt/tenbox && sudo -u tenzel -H bun install --frozen-lockfile \
  && printf '#!/bin/sh\nexec /usr/local/bin/bun /opt/tenbox/cli/main.ts "$@"\n' > /usr/local/bin/tenbox \
  && chmod 755 /usr/local/bin/tenbox \
  && install -m 755 /opt/tenbox/machines/k8s/boot.sh /usr/local/bin/tenbox-boot \
  && jq -n --arg branch "$TENBOX_BRANCH" --arg ref "$TENBOX_REF" --arg bun "$(bun --version)" --arg gh "$(gh --version | head -1)" \
       --arg claude "$(claude --version)" '{ tenbox: { branch: $branch, ref: $ref }, bun: $bun, gh: $gh, claude: $claude }' \
       > /etc/tenbox-image.json

CMD ["/usr/local/bin/tenbox-boot"]
