# Sagax harness server — hosted/self-hosted tenant image.
#
# Two stages: build the renderer + the self-contained server bundle, then ship
# only those artifacts on a slim Node runtime. Distroless is not a fit: the
# engine CLIs need git, Hermes needs a Python venv, Chrome needs GTK/X11
# libraries, and the healthcheck uses curl. The runtime stays Debian slim,
# upgrades its packages at build, overlays patched transitive deps, and drops
# npm after install. The server keeps binding 127.0.0.1 inside the container
# (the loopback-trust invariant is the auth model); deploy/docker-compose.yml
# puts Caddy in the same network namespace to terminate TLS and authentication
# at the edge.
#
#   docker build -t openmausbot .                                   (full engine set: the production default)
#   docker build --build-arg ENGINE_SET=none --build-arg SAGAX_REQUIRE_ENGINES=0 -t openmausbot .
#                                                                   (public image, no engine CLI)
#   docker build --build-arg ENGINE_SET="claude codex grok" --build-arg SAGAX_REQUIRE_ENGINES=0 -t openmausbot .
#
# /run/sagax-sandboxd: the provisioner's shared key (docs/user-sandbox.md);
# an empty named volume mounted there inherits this owner.
#
# HOME is the /data volume, so engine CLI logins (~/.claude, ~/.codex, ...) and
# Sagax's own state (/data/.openmausbot, kept for existing volumes) persist across container restarts.
#
# A plain `docker run` of either image wants `--init --shm-size=512m`, as the
# compose files set: the bots' browsers leave exited processes for an init to
# collect, and Chrome needs shared memory (docs/browser-packaging.md, "Process
# hygiene").

# node:24-trixie-slim as of 2026-10-06 (Node 24.21.0). Rebuild to pick a
# newer tag; apt-get upgrade still applies Debian patches on top.
FROM node:24-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66 AS build
WORKDIR /src
# pinned to package.json#packageManager; corepack is being removed from Node
RUN npm install -g pnpm@10.34.6
# The image never runs Electron, so skip its ~100MB postinstall download.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# every workspace member's manifest must exist before install resolves the lockfile
COPY apps/docs/package.json ./apps/docs/package.json
COPY cloudflare/control-plane/package.json ./cloudflare/control-plane/package.json
# package.json's `prepare` runs during install. The script itself is written to
# no-op without a .git (it exits 0 here), but node still has to be able to LOAD
# it, and .dockerignore keeps .git out — so copy it in before install or the
# whole build dies on MODULE_NOT_FOUND.
COPY scripts/install-git-hooks.mjs ./scripts/install-git-hooks.mjs
RUN pnpm install --frozen-lockfile
COPY . .
# The Data engine's native modules (DuckDB, resvg; server/data/engine.ts),
# staged like the desktop app's extraResources for this image's own
# architecture (amd64 or arm64), at one path the runtime stage copies.
RUN arch="$(node -p 'process.arch === "arm64" ? "arm64" : "x64"')" \
  && node --input-type=module -e "import { stageDuckdb } from './scripts/prepare-duckdb.mjs'; await stageDuckdb({ root: process.cwd(), targets: [{ platform: 'linux', arch: '$arch' }] });" \
  && mv "dist-native/duckdb/linux-$arch" dist-native/duckdb/linux \
  && chmod -R go-w dist-native/duckdb
# Tailcat 0.7.0 for the technician side. One arch-independent path for the
# runtime stage. The container does not download it again.
RUN node scripts/prepare-tailcat.mjs --current \
  && arch="$(node -p 'process.arch')" \
  && mkdir -p dist-native/tailcat/linux \
  && cp "dist-native/tailcat/linux-${arch}/tailcat" dist-native/tailcat/linux/tailcat \
  && chmod 0755 dist-native/tailcat/linux/tailcat
RUN pnpm build:server && pnpm exec vite build

FROM node:24-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66
# Install Chrome's Trixie libraries directly (Debian 13 renamed several with
# a t64 suffix for its 64-bit time_t transition): agent-browser --with-deps
# invokes sudo even as root, and this image deliberately does not ship sudo.
# git + curl: agent CLIs shell out to git; curl backs the healthcheck
# openssh-client: `tailcat ssh` and `tailcat cp` exec the system ssh client
# (tailcat is its ProxyCommand), so a Tailcat remote session's shell,
# inventory, screen and files need it on the server.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends ca-certificates curl git openssh-client \
    libstdc++6 \
    python3.13=3.13.5-2+deb13u5 python3.13-venv=3.13.5-2+deb13u5 \
    libxcb-shm0 libx11-xcb1 libx11-6 libxcb1 libxext6 libxrandr2 \
    libxcomposite1 libxcursor1 libxdamage1 libxfixes3 libxi6 libgtk-3-0t64 \
    libpangocairo-1.0-0 libpango-1.0-0 libatk1.0-0t64 libcairo-gobject2 \
    libcairo2 libgdk-pixbuf-2.0-0 libxrender1 libasound2t64 libfreetype6 \
    libfontconfig1 libdbus-1-3 libnss3 libnss3-tools libnspr4 \
    libatk-bridge2.0-0t64 libdrm2 libxkbcommon0 libatspi2.0-0t64 libcups2t64 \
    libxshmfence1 libgbm1 fonts-noto-color-emoji fonts-noto-cjk fonts-freefont-ttf \
  && ln -sfn /usr/bin/python3.13 /usr/local/bin/python3 \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --home-dir /data --shell /bin/bash maus \
  && install -d -o maus -g maus -m 0750 /run/sagax-sandboxd
WORKDIR /app
# The engine CLIs, pinned in ONE place: engines.lock.json (versions, npm
# packages, native downloads with their SHA-256, the Python engine's source
# archive). scripts/install-engines.mjs installs the selection, checks that
# each one starts (`<cli> --version`) and writes the manifest the server's
# startup self-check reads (server/engines-self-check.ts). Before the app's
# own files so a code change does not reinstall the engines.
#   ENGINE_SET      all (default). none and an empty value install nothing.
#                   On 2026-10-12 a build that left this unset shipped
#                   pulsa-bot-server:main-example1 with engineSet none and
#                   installed []. open keeps redistributable engines; a list
#                   of ids installs those. An empty --build-arg ENGINE_SET=
#                   overrides this default, so SAGAX_REQUIRE_ENGINES=1 (also
#                   the default) fails that build instead of publishing it.
#   ENGINES         legacy override: npm specs installed instead of the lock's
#                   npm engines ("none" drops them). A non-empty value with
#                   the require flag fails the build when it drops an engine.
#   NATIVE_ENGINES  legacy override: native engine ids of the lock (grok,
#                   cursor) instead of the selected ones ("none" drops them).
# Proprietary CLIs (Claude Code, Droid, Cursor) ship in this image because
# the organization server is the image this file builds. A public opt-out
# is ENGINE_SET=none and SAGAX_REQUIRE_ENGINES=0. docs/custom-engines.md.
# ENV copies the ARGs into the RUN environment. The installer reads them
# from the environment; a RUN line that never mentions $ENGINE_SET does not
# otherwise see a build-arg the builder failed to export.
ARG ENGINE_SET=all
ARG ENGINES=""
ARG NATIVE_ENGINES=""
ARG SAGAX_REQUIRE_ENGINES=1
COPY engines.lock.json scripts/install-engines.mjs scripts/engine-image-gate.mjs scripts/harden-image-deps.mjs scripts/hermes-python.mjs /app/engines/
ENV ENGINE_SET=${ENGINE_SET} \
    ENGINES=${ENGINES} \
    NATIVE_ENGINES=${NATIVE_ENGINES} \
    SAGAX_REQUIRE_ENGINES=${SAGAX_REQUIRE_ENGINES}
RUN node /app/engines/install-engines.mjs --lock /app/engines/engines.lock.json --manifest /app/engines/manifest.json \
  && node /app/engines/harden-image-deps.mjs --root /opt/sagax-engines --root /usr/local/lib/node_modules \
  && npm cache clean --force \
  && rm -rf /root/.npm /root/.cache /tmp/*
# Captured before the ENV clear. An ENV of the same name overrides an ARG in
# later instructions, and the label must still say which set was installed.
ARG SAGAX_ENGINE_SET=${ENGINE_SET}
ENV ENGINE_SET= \
    ENGINES= \
    NATIVE_ENGINES= \
    SAGAX_REQUIRE_ENGINES=
# The bots' browser (docs/plans/browser-engine.md): the pinned agent-browser
# and Chrome for Testing, so a server bot can browse. Pin here and in
# server/browser-engine-release.ts together. linux64 and linux-arm64 both
# publish a zip; the 0.38.2 installer still refuses linux-arm64, so the
# image downloads that zip itself. Do not fall back to the Debian browser.
# chrome-launch-check starts Chrome as agent-browser does and fails the build
# on a crash handler FATAL or a missing DevToolsActivePort (`--version` never
# spawns chrome_crashpad_handler: the 0.5.2 image passed it with that helper
# not executable).
COPY scripts/chrome-linux-arch.mjs scripts/install-chrome-for-testing.mjs scripts/chrome-launch-check.mjs /app/engines/
ARG AGENT_BROWSER_VERSION=0.38.2
RUN npm install -g agent-browser@${AGENT_BROWSER_VERSION} \
  && HOME=/opt/openmausbot-browser node /app/engines/install-chrome-for-testing.mjs \
  && ln -s /opt/openmausbot-browser/.agent-browser/browsers/chrome-*/chrome /opt/openmausbot-browser/chrome \
  && test ! -e /usr/bin/chromium \
  && test -x /opt/openmausbot-browser/chrome \
  && /opt/openmausbot-browser/chrome --headless --disable-gpu --no-sandbox --version \
  && node /app/engines/chrome-launch-check.mjs /opt/openmausbot-browser/chrome \
  && agent-browser --version
# Overlay again after agent-browser, then drop the npm CLI and the Node
# image's Yarn (only the installer used them), docs, and apt indexes. Node
# stays; engines and the bundled server do not call npm or yarn at runtime.
RUN node /app/engines/harden-image-deps.mjs --root /opt/sagax-engines --root /usr/local/lib/node_modules \
  && apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get autoremove -y --purge \
  && rm -rf /var/lib/apt/lists/* /usr/share/doc /usr/share/man /usr/share/info \
  && npm cache clean --force \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/lib/node_modules/corepack /usr/local/bin/corepack \
    /opt/yarn-v1.22.22 /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    /root/.npm /root/.cache /tmp/*
# DuckDB and resvg change on a version bump, not per commit: beneath the app files.
COPY --from=build --chown=maus:maus /src/dist-native/duckdb/linux ./duckdb
COPY --from=build --chmod=0755 /src/dist-native/tailcat/linux/tailcat /usr/local/bin/tailcat
# The app itself last: a code change rebuilds only these layers.
COPY --from=build --chown=maus:maus /src/dist-server ./dist-server
COPY --from=build --chown=maus:maus /src/dist ./dist
# Licence terms and notices ship with the code (T3 Code, MIT: the bots' browser egress gate).
COPY --from=build --chown=maus:maus /src/NOTICE /src/LICENSE ./licenses/
COPY --from=build --chown=maus:maus /src/third_party/t3-code/LICENSE ./licenses/t3-code-LICENSE.txt
# Keep the baked-in browser outside both root's private home and /data,
# which may be an existing mounted volume. Session state still lives in HOME.
#  SAGAX_DUCKDB_DIR: the DuckDB binding tree the server requires (no node_modules here).
ENV HOME=/data \
    AGENT_BROWSER_EXECUTABLE_PATH=/opt/openmausbot-browser/chrome \
    SAGAX_DUCKDB_DIR=/app/duckdb \
    OMB_DATA_DIR=/data/.openmausbot \
    OMB_STATIC_DIR=/app/dist \
    OMB_PORT=8799 \
    OMB_WEBHOOK_PORT=8800 \
    SAGAX_ENGINES_MANIFEST=/app/engines/manifest.json \
    NODE_ENV=production
VOLUME ["/data"]
# Declared after the engine install so a new commit does not rebuild it.
ARG SAGAX_COMMIT_SHA=
ARG SAGAX_BUILD_TIME=
LABEL org.opencontainers.image.revision="${SAGAX_COMMIT_SHA}" \
      org.opencontainers.image.created="${SAGAX_BUILD_TIME}" \
      io.sagax.engine-set="${SAGAX_ENGINE_SET}"
USER maus
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -sf http://127.0.0.1:8799/api/health | grep -q openmausbot || exit 1
CMD ["node", "dist-server/index.js"]
