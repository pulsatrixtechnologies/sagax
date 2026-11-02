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
# xdotool and scrot for computer use, a light gradient background
# (hsetroot), a bottom dock (Plank, with xcompmgr for its transparency)
# holding Chromium, Files (Thunar) and Terminal (Xfce Terminal), and the
# Papirus icon theme so folders, terminal, browser and file types each have
# their own icon (an SVG theme: librsvg2-common is its loader, without it
# GTK falls back to the bare default icons). Nothing of it runs until a computer-use tool or the
# person's live view starts it.
ARG WITH_DESKTOP=1
# 2026-11-02: the everyday apps of that desktop, each the default for its
# files (deploy/sandbox/mimeapps.list): Ristretto (pictures), Parole and mpv
# (audio and video), LibreOffice Writer, Calc, Impress and Draw, Atril (PDF),
# Xarchiver (archives, also from Thunar's menu) and Mousepad (text).
# LibreOffice is most of the size; WITH_APPS=0 builds without them.
ARG WITH_APPS=1
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
        tigervnc-standalone-server tigervnc-tools openbox xdotool scrot fonts-dejavu-core hsetroot \
        dbus-x11 xdg-utils shared-mime-info desktop-file-utils \
        xfce4-terminal thunar thunar-archive-plugin tumbler plank xcompmgr papirus-icon-theme librsvg2-common; \
      # Papirus only (light): its dark and ePapirus variants are not used.
      rm -rf /usr/share/icons/Papirus-Dark /usr/share/icons/ePapirus /usr/share/icons/ePapirus-Dark; \
      gtk-update-icon-cache -q -f /usr/share/icons/Papirus 2>/dev/null || true; \
    fi; \
    if [ "$WITH_DESKTOP" = "1" ] && [ "$WITH_APPS" = "1" ]; then \
      apt-get install -y --no-install-recommends \
        ristretto parole gstreamer1.0-plugins-good gstreamer1.0-libav mpv \
        libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-draw libreoffice-gtk3 fonts-liberation \
        atril xarchiver 7zip mousepad; \
      rm -rf /usr/share/doc/* /usr/share/help/* /usr/share/gnome/help/* 2>/dev/null || true; \
    fi; \
    # A session bus wants a machine id; the root is read-only at run time.
    if command -v dbus-uuidgen >/dev/null 2>&1; then dbus-uuidgen --ensure=/etc/machine-id; fi; \
    rm -rf /var/lib/apt/lists/*; \
    groupadd --gid 1000 sandbox; \
    useradd --uid 1000 --gid 1000 --home-dir /workspace --no-create-home --shell /bin/bash sandbox; \
    install -d -o 1000 -g 1000 -m 0700 /workspace; \
    find / -xdev -type f -perm /6000 -exec chmod a-s {} + ; \
    rm -f /etc/sudoers 2>/dev/null || true

COPY --chmod=0755 deploy/sandbox/sagax-desktop /usr/local/bin/sagax-desktop
COPY --chmod=0755 deploy/sandbox/sagax-tailscale /usr/local/bin/sagax-tailscale
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
# Tailscale 1.104.4 static binaries for userspace joins inside the sandbox
# only (sagax-tailscale --tun=userspace-networking). Never on the node.
# Pins: archive + binary SHAs checked at build. DENY_HOSTS keeps 100.64/10
# blocked at the NetworkPolicy; apps reach the tailnet via local proxies.
ARG TAILSCALE_VERSION=1.104.4
ARG TAILSCALE_AMD64_SHA=624ea093d47d62cf56f17b8332d74b8decda4a1faa610ebc60a1de334b2b3dc9
ARG TAILSCALE_ARM64_SHA=a1c249ce6bdebef62e1ae3b997595555bce2ae4709bf95a718e9ca7a129dad7e
ARG TAILSCALE_AMD64_CLI_SHA=f27bd0ad0a9a04c23ae02aa8a5897cf7f99e4e5ae153c0e5f7000b122418c830
ARG TAILSCALE_AMD64_DAEMON_SHA=afc601d3c5be812105064eba11b64afa8928e983815bc47db218f25f3749c0c0
ARG TAILSCALE_ARM64_CLI_SHA=01c657aa13af9a13789aa5f5fa70327c200d5387f2ac8cf245ec73e213b15217
ARG TAILSCALE_ARM64_DAEMON_SHA=c8c80d2f0919eb48b0a86a9f1ddd2289d07ded51a886066db8059cd6461e5aa3
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) archive_sha="$TAILSCALE_AMD64_SHA"; cli_sha="$TAILSCALE_AMD64_CLI_SHA"; daemon_sha="$TAILSCALE_AMD64_DAEMON_SHA" ;; \
      arm64) archive_sha="$TAILSCALE_ARM64_SHA"; cli_sha="$TAILSCALE_ARM64_CLI_SHA"; daemon_sha="$TAILSCALE_ARM64_DAEMON_SHA" ;; \
      *) echo "tailscale has no build for $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://pkgs.tailscale.com/stable/tailscale_${TAILSCALE_VERSION}_${arch}.tgz" -o /tmp/tailscale.tgz; \
    echo "${archive_sha}  /tmp/tailscale.tgz" | sha256sum -c -; \
    tar -xzf /tmp/tailscale.tgz -C /tmp; \
    install -m 0755 "/tmp/tailscale_${TAILSCALE_VERSION}_${arch}/tailscale" /usr/local/bin/tailscale; \
    install -m 0755 "/tmp/tailscale_${TAILSCALE_VERSION}_${arch}/tailscaled" /usr/local/bin/tailscaled; \
    rm -rf /tmp/tailscale.tgz "/tmp/tailscale_${TAILSCALE_VERSION}_${arch}"; \
    echo "${cli_sha}  /usr/local/bin/tailscale" | sha256sum -c -; \
    echo "${daemon_sha}  /usr/local/bin/tailscaled" | sha256sum -c -; \
    /usr/local/bin/tailscale version | grep -F "${TAILSCALE_VERSION}"
COPY deploy/sandbox/openbox-menu.xml /etc/xdg/openbox/menu.xml
COPY deploy/sandbox/applications/ /usr/share/applications/
COPY deploy/sandbox/mimeapps.list /etc/xdg/mimeapps.list
COPY deploy/sandbox/mimeapps.list /usr/share/applications/mimeapps.list
COPY deploy/sandbox/gtk-settings.ini /etc/xdg/gtk-3.0/settings.ini
COPY deploy/sandbox/terminalrc /etc/xdg/xfce4/terminal/terminalrc
RUN update-desktop-database -q /usr/share/applications 2>/dev/null || true

ENV HOME=/workspace LANG=C.UTF-8 SAGAX_ENVIRONMENT=user-sandbox
WORKDIR /workspace
USER 1000:1000
LABEL com.pulsatrix.sagax.sandbox.image="1"
CMD ["sleep", "infinity"]
