# Sagax server environment ("user-sandbox"): the image of each person's
# isolated Linux environment on an organization server (docs/user-sandbox.md).
#
#   docker build -f deploy/sandbox/Dockerfile -t sagax-sandbox:local .
#   docker buildx build --platform linux/amd64,linux/arm64 \
#     -f deploy/sandbox/Dockerfile -o type=oci,dest=dist/sagax-sandbox.oci .
#   (scripts/build-sandbox-image.sh; it never pushes)
#
# The provisioner (server/sandboxd.ts) runs it read-only, as uid 1000, with no
# capabilities, no new privileges, Docker's default seccomp and AppArmor
# profiles, its own network and its own /workspace volume. Nothing here is
# setuid: the setuid and setgid bits are stripped at the end.
#
# iptables ships here only for the provisioner's one-shot egress policy helper
# (host network, NET_ADMIN); a sandbox itself never has NET_ADMIN, so the
# binary is inert there.
FROM debian:trixie-slim

ARG WITH_BROWSER=1
# The on-demand desktop (docs/user-sandbox.md, "Desktop"): Xvnc (an X server
# with a VNC server bound to 127.0.0.1 inside the sandbox only), openbox,
# xdotool and scrot for computer use, xterm and pcmanfm, a background
# (hsetroot) and a launcher bar (tint2). Nothing of it runs
# until a computer-use tool or the person's live view starts it.
ARG WITH_DESKTOP=1
# gh, node and npm: the person's GitHub connection (Settings > Mes connexions
# writes gh's hosts.yml and git's credentials into /workspace) and the MCP
# servers a person runs here themselves (npx ...; server/sandbox-stdio-mcp.ts).
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      bash ca-certificates coreutils curl git jq less procps python3 python3-venv \
      unzip xz-utils zip file iptables tini gh nodejs npm; \
    if [ "$WITH_BROWSER" = "1" ]; then \
      apt-get install -y --no-install-recommends chromium fonts-noto-color-emoji fonts-freefont-ttf; \
    fi; \
    if [ "$WITH_DESKTOP" = "1" ]; then \
      apt-get install -y --no-install-recommends \
        tigervnc-standalone-server tigervnc-tools openbox xdotool scrot xterm pcmanfm fonts-dejavu-core \
        tint2 hsetroot; \
    fi; \
    rm -rf /var/lib/apt/lists/*; \
    groupadd --gid 1000 sandbox; \
    useradd --uid 1000 --gid 1000 --home-dir /workspace --no-create-home --shell /bin/bash sandbox; \
    install -d -o 1000 -g 1000 -m 0700 /workspace; \
    find / -xdev -type f -perm /6000 -exec chmod a-s {} + ; \
    rm -f /etc/sudoers 2>/dev/null || true

COPY --chmod=0755 deploy/sandbox/sagax-desktop /usr/local/bin/sagax-desktop
# Tailcat 0.7.0. The running sandbox is read-only and has no sudo, so the
# binary has to be in the image. Sagax also looks at /usr/local/bin when
# the process PATH is only the system directories. Pins: scripts/prepare-tailcat.mjs.
ARG TAILCAT_VERSION=0.7.0
ARG TAILCAT_AMD64_SHA=23c0b1887a5ec422f0d18a9c52b4f5357815febdaae738a1eb54036d10bd9ee6
ARG TAILCAT_ARM64_SHA=bbb1ab50f24f00effe1e1fd86d0501803fb80793a90785a2a16ff3428f03d8ef
ARG TAILCAT_AMD64_BIN_SHA=75da81231e01f2a52005f26f4eca6df4bce71cb694a42fa467a30e93c3d7a5b9
ARG TAILCAT_ARM64_BIN_SHA=1f8e877f9080ab0436eaf2bb0d0712f190f56d30d3e78ece8d0680b280f1f955
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) archive_sha="$TAILCAT_AMD64_SHA"; binary_sha="$TAILCAT_AMD64_BIN_SHA" ;; \
      arm64) archive_sha="$TAILCAT_ARM64_SHA"; binary_sha="$TAILCAT_ARM64_BIN_SHA" ;; \
      *) echo "tailcat has no build for $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/tailscale/tailcat/releases/download/v${TAILCAT_VERSION}/tailcat_${TAILCAT_VERSION}_linux_${arch}.tar.gz" -o /tmp/tailcat.tgz; \
    echo "${archive_sha}  /tmp/tailcat.tgz" | sha256sum -c -; \
    tar -xzf /tmp/tailcat.tgz -C /usr/local/bin tailcat; \
    chmod 0755 /usr/local/bin/tailcat; \
    rm -f /tmp/tailcat.tgz; \
    echo "${binary_sha}  /usr/local/bin/tailcat" | sha256sum -c -; \
    /usr/local/bin/tailcat version | grep -F "v${TAILCAT_VERSION}"
COPY deploy/sandbox/openbox-menu.xml /etc/xdg/openbox/menu.xml
COPY deploy/sandbox/tint2rc /etc/xdg/sagax/tint2rc
COPY deploy/sandbox/applications/ /usr/share/sagax/applications/

ENV HOME=/workspace LANG=C.UTF-8 SAGAX_ENVIRONMENT=user-sandbox
WORKDIR /workspace
USER 1000:1000
LABEL com.pulsatrix.sagax.sandbox.image="1"
CMD ["sleep", "infinity"]
