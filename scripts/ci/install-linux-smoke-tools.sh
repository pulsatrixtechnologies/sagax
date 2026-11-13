#!/usr/bin/env bash
# The package validation and native smoke tools of a Linux package job
# (ci.yml package-linux, package-linux.yml, release.yml): one script, so a
# package fetch that fails once is tried again in every job that needs them.
#
# One failed fetch must not end the job, and a resolver that stops answering
# must not eat it whole (#3672): in November 2026 one push run failed on
# "Temporary failure resolving" and a nightly run spent its 25 minutes here,
# about 20 seconds per package per mirror. apt retries each fetch, each
# attempt is bounded, and the script tries three times with a pause; the
# calling step's own cap bounds the rest.
set -u
packages=(at-spi2-core dbus-x11 desktop-file-utils libxi6 libxkbcommon0 openbox squashfs-tools x11-utils xdotool xvfb)
apt=(-o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30)
for attempt in 1 2 3; do
  sudo dpkg --configure -a || true
  if timeout 90 sudo apt-get "${apt[@]}" update && timeout 150 sudo apt-get "${apt[@]}" install -y "${packages[@]}"; then
    exit 0
  fi
  echo "::warning::Package install attempt $attempt of 3 failed; trying again."
  sudo resolvectl flush-caches || true
  sleep $((attempt * 15))
done
echo "::error::The smoke tools could not be installed after three attempts (package mirror or name resolution)."
exit 1
