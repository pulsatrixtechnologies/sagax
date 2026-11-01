# sagax-sandboxd: the Kubernetes provisioner alone (2026-10-26, cold start).
#
# The provisioner ran from the whole server image (engines, Chrome
# libraries, Python: about 1.6 GB). When a stopped cluster starts, its
# system node is a new VM with an empty image cache, and that pull took
# 65 s of every cold start (docs/sandbox-kubernetes.md, "Cold start").
# The provisioner needs none of it: dist-server/sandboxd.js is one bundled
# file (scripts/bundle-server.mjs) that only needs Node. Same base pin as the
# server image, same user (maus, uid 1001, as sandboxd-deployment.yaml
# expects), same entry (`args: ["dist-server/sandboxd.js"]`).
#
#   docker build -f deploy/k8s/provisioner/Dockerfile -t sagax-sandboxd:local .
#
# Publishing (registry, signature, scan, admission.allowedImages, the
# Deployment's image) is an operator step, outside this file.
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
RUN pnpm build:server

FROM node:24-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66
RUN useradd --uid 1001 --create-home --home-dir /data --shell /usr/sbin/nologin maus \
  && install -d -o maus -g maus -m 0750 /run/sagax-sandboxd
WORKDIR /app
COPY --from=build --chown=maus:maus /src/dist-server/sandboxd.js ./dist-server/sandboxd.js
COPY --from=build --chown=maus:maus /src/NOTICE /src/LICENSE ./licenses/
USER maus
ENV NODE_ENV=production
CMD ["node", "dist-server/sandboxd.js"]
