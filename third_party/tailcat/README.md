# Tailcat

Sagax ships Tailcat 0.7.0 (https://github.com/tailscale/tailcat/releases/tag/v0.7.0) as a separate executable.

Linux and Windows binaries are the upstream release assets, checked by the SHA-256 pins in `scripts/prepare-tailcat.mjs`. macOS binaries are built from that tag (upstream publishes no darwin asset) with the flags in the same script. electron-builder signs them with the app.

License: BSD 3-Clause, `LICENSE` in this directory. Copyright (c) 2020 Tailscale Inc & contributors.
