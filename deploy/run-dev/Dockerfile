# sagax-run-dev: the image of a coding run (cloud coding agents, gap I5).
# The run image (deploy/run/Dockerfile: sandbox tools, engines, runner) plus
# what a Pulsatrix repository builds with: Rust (Perspicax), Node and pnpm
# (Sagax, the web site), a headless Chromium for Playwright, sccache, mold,
# and the common merge gate (scripts/fast-gate.sh as /usr/local/bin/fast-gate).
#
# Rust builds are big and must stay fast (decision D3), so every cache lives
# on the run's build cache disk, kept between runs of the same person
# (SAGAX_RUNS_CACHE_ENABLED=1, docs/sandbox-kubernetes.md, "Build cache"):
#   /cache/sccache            compiled crates, shared by all environments
#   /cache/target/<env>       CARGO_TARGET_DIR, one per environment
#   /cache/cargo-home         the cargo registry and git sources
#   /cache/rustup             toolchains a repository pins (the image's linked)
#   /cache/pnpm-store, /cache/npm
# px-cache-init sets these and starts px-cache-gc (80 % -> 60 %), then execs
# the runner. Without a cache disk the same layout goes in $HOME/.px-cache.
#
# Build locally only, never pushed by a script (scripts/build-run-dev-image.sh):
#   docker build -f deploy/run/Dockerfile -t sagax-run:local .
#   docker build -f deploy/run-dev/Dockerfile -t sagax-run-dev:local .
# A publish pins the run image by digest (--build-arg RUN_IMAGE=...@sha256:)
# and adds this image's digest to runs.allowedImages: an operator step.
ARG RUN_IMAGE=sagax-run:local

FROM ${RUN_IMAGE}
USER 0:0

# The toolchain the Pulsatrix Rust repositories pin (rust-toolchain.toml).
ARG RUST_TOOLCHAIN=1.99.1
ARG RUSTUP_VERSION=1.28.2
ARG SCCACHE_VERSION=0.19.0
ARG SCCACHE_AMD64_SHA=aa73c7270c997894038c0d8f0d297865f57569e1687883322bc431713d4bb9dd
ARG SCCACHE_ARM64_SHA=3e47fc4a71b1ddd1b4294a0de9d34498922fdf41e3cd0bda5df3954e3d6deb9d
ARG PNPM_VERSION=10.34.6
# Sagax's package.json pin, so its own tests find their browser.
ARG PLAYWRIGHT_VERSION=1.55.1

ENV RUSTUP_HOME=/opt/rustup \
    CARGO_HOME=/opt/cargo \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright \
    PATH=/opt/cargo/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin

# C toolchain and linker (cc, mold through clang), the -sys crates' usual
# headers, then rustup with the pinned toolchain only (minimal profile).
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      build-essential clang mold pkg-config libssl-dev cmake protobuf-compiler; \
    rm -rf /var/lib/apt/lists/*; \
    case "$(dpkg --print-architecture)" in \
      amd64) triple=x86_64-unknown-linux-gnu; sc_arch=x86_64; sc_sha="$SCCACHE_AMD64_SHA" ;; \
      arm64) triple=aarch64-unknown-linux-gnu; sc_arch=aarch64; sc_sha="$SCCACHE_ARM64_SHA" ;; \
      *) echo "unsupported architecture" >&2; exit 1 ;; \
    esac; \
    curl -fsSLo /tmp/rustup-init "https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/${triple}/rustup-init"; \
    curl -fsSLo /tmp/rustup-init.sha256 "https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/${triple}/rustup-init.sha256"; \
    echo "$(cut -d' ' -f1 /tmp/rustup-init.sha256)  /tmp/rustup-init" | sha256sum -c -; \
    chmod +x /tmp/rustup-init; \
    /tmp/rustup-init -y --no-modify-path --profile minimal --default-toolchain "$RUST_TOOLCHAIN" -c rustfmt -c clippy; \
    rustc --version; cargo --version; \
    curl -fsSLo /tmp/sccache.tgz "https://github.com/mozilla/sccache/releases/download/v${SCCACHE_VERSION}/sccache-v${SCCACHE_VERSION}-${sc_arch}-unknown-linux-musl.tar.gz"; \
    echo "${sc_sha}  /tmp/sccache.tgz" | sha256sum -c -; \
    tar -xzf /tmp/sccache.tgz -C /tmp; \
    install -m 0755 "/tmp/sccache-v${SCCACHE_VERSION}-${sc_arch}-unknown-linux-musl/sccache" /usr/local/bin/sccache; \
    sccache --version; \
    rm -rf /tmp/rustup-init* /tmp/sccache* /opt/cargo/registry /opt/rustup/downloads /opt/rustup/tmp

# pnpm, then the headless Chromium for Playwright (its system libraries
# too), read-only under /opt/ms-playwright. Debian's npm builds them; the
# run image's /usr/local node runs them.
RUN set -eux; \
    export HOME=/tmp npm_config_cache=/tmp/npm; \
    /usr/bin/npm install -g --prefix /usr/local "pnpm@${PNPM_VERSION}"; \
    pnpm --version; \
    /usr/bin/npm exec --yes -- "playwright@${PLAYWRIGHT_VERSION}" install --with-deps --only-shell chromium; \
    test -n "$(ls -d /opt/ms-playwright/chromium_headless_shell-*)"; \
    chmod -R a+rX /opt/ms-playwright; \
    find / -xdev -type f -perm /6000 -exec chmod a-s {} + ; \
    rm -rf /var/lib/apt/lists/* /tmp/* /tmp/.[!.]* 2>/dev/null || true

COPY --chmod=0755 deploy/run-dev/px-cache-init /usr/local/bin/px-cache-init
COPY --chmod=0755 deploy/run-dev/px-cache-gc /usr/local/bin/px-cache-gc
COPY --chmod=0755 scripts/fast-gate.sh /usr/local/bin/fast-gate

# Defaults for every build in the run. px-cache-init moves CARGO_HOME,
# RUSTUP_HOME and the caches onto the cache disk at start.
# line-tables-only: backtraces keep their lines, the target is about 3x
# smaller than full debug info and links faster. No CARGO_INCREMENTAL:
# sccache refuses the variable; the dev profile keeps incremental for the
# workspace's own crates (built in the target) and sccache caches the rest.
ENV RUSTC_WRAPPER=/usr/local/bin/sccache \
    SCCACHE_IDLE_TIMEOUT=0 \
    CARGO_PROFILE_DEV_DEBUG=line-tables-only \
    CARGO_PROFILE_TEST_DEBUG=line-tables-only \
    CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=clang \
    CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=clang \
    CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS="-C link-arg=-fuse-ld=mold" \
    CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_RUSTFLAGS="-C link-arg=-fuse-ld=mold" \
    CARGO_NET_GIT_FETCH_WITH_CLI=true \
    PX_RUSTUP_SEED=/opt/rustup
USER 1000:1000
LABEL com.pulsatrix.sagax.run.image="1" \
      com.pulsatrix.sagax.run.dev="1"
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/px-cache-init", "/usr/local/bin/node", "/opt/sagax-runner/dist-server/sagax-runner.js"]
