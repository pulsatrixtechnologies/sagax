# sagax-run: the image of a cloud agent run's Pod (cloud agents spec,
# section 4.3). The person's sandbox image (deploy/sandbox/Dockerfile: tools,
# Xvnc, browser) plus the engine CLIs pinned by engines.lock.json (Claude Code
# and Codex) plus the runner (server/sagax-runner.ts), which is the Pod's only
# process. The provisioner (server/sandboxd-runs-spec.ts) runs it as uid 1000,
# read-only root, no capabilities, with /workspace (volume), /tmp and
# /dev/shm writable, and names no command: the entrypoint below is the run.
#
# Build locally only, never pushed by a script (scripts/build-run-image.sh):
#   docker build -f deploy/sandbox/Dockerfile -t sagax-sandbox:local .
#   docker build -f deploy/run/Dockerfile -t sagax-run:local .
# The base is a build argument so a publish pins the sandbox by digest:
#   --build-arg SANDBOX_IMAGE=<registry>/sagax-sandbox:<tag>@sha256:<digest>
# Publishing (registry, signature, scan, admission.allowedImages) is an
# operator step, outside this file.
#
# Engines: Claude Code is not redistributable (engines.lock.json), so this
# image is built for your own servers only, like the organization image.
ARG SANDBOX_IMAGE=sagax-sandbox:local

# node:24-trixie-slim as of 2026-10-06 (the server image's pin).
FROM node:24-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66 AS build
WORKDIR /src
RUN npm install -g pnpm@10.34.6
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/docs/package.json ./apps/docs/package.json
COPY cloudflare/control-plane/package.json ./cloudflare/control-plane/package.json
COPY scripts/install-git-hooks.mjs ./scripts/install-git-hooks.mjs
RUN pnpm install --frozen-lockfile
COPY . .
# The bundled server tree: sagax-runner.js and the helpers the drivers spawn
# beside it (permission-proxy.js, hooks/omb-hook.js, ...).
RUN pnpm build:server

# The engine CLIs, from the lock only: the same installer, hashes and
# start check as the server image (scripts/install-engines.mjs).
FROM node:24-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66 AS engines
COPY engines.lock.json scripts/install-engines.mjs scripts/engine-image-gate.mjs scripts/harden-image-deps.mjs scripts/hermes-python.mjs /app/engines/
ENV ENGINE_SET="claude codex" \
    SAGAX_REQUIRE_ENGINES=0
RUN node /app/engines/install-engines.mjs --lock /app/engines/engines.lock.json --manifest /app/engines/manifest.json \
  && node /app/engines/harden-image-deps.mjs --no-venv --root /usr/local/lib/node_modules \
  && test -x /usr/local/bin/claude && test -x /usr/local/bin/codex \
  && npm cache clean --force \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/lib/node_modules/corepack /usr/local/bin/corepack \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg /root/.npm /root/.cache /tmp/*

FROM ${SANDBOX_IMAGE}
USER 0:0
# Node 24 for the runner and the engines (the sandbox's Debian node stays
# in /usr/bin for the person's own tools; /usr/local/bin comes first).
COPY --from=engines /usr/local/bin/node /usr/local/bin/node
COPY --from=engines /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=engines /app/engines/manifest.json /opt/sagax-runner/engines-manifest.json
COPY --from=build /src/dist-server /opt/sagax-runner/dist-server
# The engines' commands, linked from their packages' own "bin" entries (what
# npm install -g wrote in the engines stage).
RUN set -eux; \
    export HOME=/tmp; \
    for spec in "@anthropic-ai/claude-code claude" "@openai/codex codex"; do \
      set -- $spec; \
      target="$(/usr/local/bin/node -e 'const [pkg, name] = process.argv.slice(1); const p = require(`/usr/local/lib/node_modules/${pkg}/package.json`); console.log(typeof p.bin === "string" ? p.bin : p.bin[name]);' "$1" "$2")"; \
      ln -sfn "/usr/local/lib/node_modules/$1/${target#./}" "/usr/local/bin/$2"; \
    done; \
    /usr/local/bin/node --version; \
    /usr/local/bin/claude --version; \
    /usr/local/bin/codex --version; \
    test -x /usr/local/bin/tailcat; \
    /usr/local/bin/tailcat version | grep -F v0.7.0; \
    find /usr/local /opt/sagax-runner -xdev -type f -perm /6000 -exec chmod a-s {} + ; \
    chmod -R go-w /opt/sagax-runner; \
    rm -rf /tmp/* /tmp/.[!.]* 2>/dev/null || true
# Everything the run writes lives in /workspace (the run's volume) or the
# memory-backed /dev/shm: nothing under / is written, so the provisioner's
# readOnlyRootFilesystem holds.
ENV HOME=/workspace \
    LANG=C.UTF-8 \
    SAGAX_ENVIRONMENT=cloud-run \
    SAGAX_ENGINES_MANIFEST=/opt/sagax-runner/engines-manifest.json \
    SAGAX_RUNNER_STATE=/workspace/.sagax-runner \
    PX_SECRETS_DIR=/dev/shm/px-secrets \
    NODE_ENV=production
WORKDIR /workspace
USER 1000:1000
LABEL com.pulsatrix.sagax.run.image="1" \
      io.sagax.engine-set="claude codex"
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/node", "/opt/sagax-runner/dist-server/sagax-runner.js"]
