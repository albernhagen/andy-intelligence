# Local test bed for the build run's sandbox (AI-58; runbook agent-runs.md §9a). Mirrors the
# GitHub-hosted runner where it matters to Claude Code's sandbox: Ubuntu 24.04, user `runner`
# (uid 1001) with passwordless sudo, the checkout at /home/runner/work/<repo>/<repo>, runner temp
# at /home/runner/work/_temp, Node and pnpm in the tool cache, and the pinned Claude Code.
FROM ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852

ARG NODE_VERSION=24.22.2
ARG NODE_SHA256_X64=48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75
ARG NODE_SHA256_ARM64=eb187837a2230d4047161ac0be008584e16b46f726e9c9490ee35dc6b17d9ba8
ARG PNPM_VERSION=10.28.0
# The version claude-code-action installed in the live runs (agent job log, 2026-11-07).
ARG CLAUDE_CODE_VERSION=2.1.312

RUN apt-get update -qq \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
    bubblewrap socat git curl ca-certificates sudo xz-utils util-linux jq gawk openssl \
  && rm -rf /var/lib/apt/lists/*

RUN set -eu; \
  case "$(uname -m)" in \
    x86_64) arch=x64; sum="$NODE_SHA256_X64" ;; \
    aarch64) arch=arm64; sum="$NODE_SHA256_ARM64" ;; \
    *) echo "unsupported arch" >&2; exit 1 ;; \
  esac; \
  dir="/opt/hostedtoolcache/node/$NODE_VERSION/$arch"; mkdir -p "$dir"; \
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$arch.tar.xz" -o /tmp/node.tar.xz; \
  echo "$sum  /tmp/node.tar.xz" | sha256sum -c -; \
  tar -xJf /tmp/node.tar.xz -C "$dir" --strip-components=1; rm /tmp/node.tar.xz; \
  ln -s "$dir" /opt/hostedtoolcache/node/current

ENV PATH=/opt/hostedtoolcache/node/current/bin:/opt/hostedtoolcache/setup-pnpm/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# pnpm where the workflow's pnpm/action-setup puts it (dest: the tool cache, AI-51); Claude Code
# outside /home, readable but not writable by the sandbox.
RUN npm install --silent --prefix /opt/hostedtoolcache/setup-pnpm "pnpm@$PNPM_VERSION" \
  && npm install --silent -g "@anthropic-ai/claude-code@$CLAUDE_CODE_VERSION" \
  && claude --version

RUN userdel -r ubuntu 2>/dev/null || true; \
  useradd -m -u 1001 -s /bin/bash runner \
  && echo 'runner ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/runner && chmod 0440 /etc/sudoers.d/runner \
  && mkdir -p /home/runner/work/_temp && chown -R runner:runner /home/runner/work

COPY lab.sh /usr/local/bin/sandbox-lab
RUN chmod 0755 /usr/local/bin/sandbox-lab
ENTRYPOINT ["/usr/local/bin/sandbox-lab"]
