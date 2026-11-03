# Perspicax infra: server environments on the production VM

Production deploys Sagax from the Perspicax repository (`<PERSPICAX_REPO>`). The infra
side of the per-person server environments (`docs/user-sandbox.md`) lives
there, on branch `feat/sagax-sandbox-infra`; the operator documentation is
`infra/README.md`, "Environnements serveur" (French). This file only records
the contract between the two repositories.

## What the Perspicax side does

- `infra/runtime/docker-compose.yml`: profile `pulsabot-sandbox` on top of
  `pulsabot`, with:
  - `sagax-sandboxd`: the Sagax image with `node dist-server/sandboxd.js`. It
    is the only container with `/var/run/docker.sock`, read-only, has no
    capabilities, has groups `SAGAX_DOCKER_GID` and 10002, and sits on the
    internal network `sagax-sandbox-control` only.
  - `sagax-sandbox-image`: pull only.
  - `pulsabot` gains `SAGAX_SANDBOXD_URL` (empty means no environments),
    `SAGAX_SANDBOXD_KEY_FILE=/run/secrets/sagax-sandboxd/key`,
    `SAGAX_SANDBOX_INSTANCE=<INSTANCE>`, the read-only key mount and the
    control network.

  The second profile lets a Sagax image without environments (an older tag,
  or `SAGAX_SANDBOX=off`) deploy without a crash-looping provisioner.
- **Shared key:** `<INSTALL_ROOT>/secrets/sagax-sandboxd/key`, 64 hex
  characters, generated once by `vm-bootstrap.sh`, `root:10002`, mode 0440,
  mounted read-only into both containers. The provisioner's
  `ensureSandboxdKey` reads an existing file and never rewrites it.
- **`build-push.sh`:** builds and pushes `sagax-sandbox:<PULSABOT_IMAGE_TAG>`
  from `deploy/sandbox/Dockerfile` when the checkout has it.
- **`deploy-vm.sh`:** checks the image exists in the ACR and passes
  `keep`, `off` or the image to the bootstrap.
- **`vm-bootstrap.sh`:**
  - **Preflight,** before anything changes: `iptables -S DOCKER-USER`; the
    pool `10.213.0.0/16` overlaps none of the VM's addresses, routes or
    Docker networks; 3 GiB free under `/var/lib/docker`.
  - **`.env`:** writes `SAGAX_SANDBOX_IMAGE`, `SAGAX_DOCKER_GID` (the
    socket's group) and `SAGAX_SANDBOXD_URL`.
  - **Pull, removal and health:** pulls both services, removes them when
    off, and waits for the provisioner's `egress policy enforced`.

## What Sagax must keep

- The provisioner entry `dist-server/sandboxd.js` and its environment
  variables (`server/sandbox/user-sandbox-spec.ts`).
- An existing key file is read, never replaced (`server/sandbox/sandboxd-auth.ts`).
- The image's `deploy/sandbox/Dockerfile` path.
- The labels `com.pulsatrix.sagax.sandbox.instance=<instance>` and
  `sagax-user=<key>` (the README's cleanup commands filter on them).
- The log line `egress policy enforced` (the bootstrap waits for it).

## Desktop in the server environment (Sagax PR feat/sandbox-desktop)

No Perspicax patch is needed for production: its compose does not pin any
`SAGAX_SANDBOX_*` limit (the defaults come from this code) and its Caddy
`reverse_proxy` passes WebSockets. The points below are what to check if a
deployment does pin them or filters the proxy. Nothing changes in the
security model: the sandbox spec, the egress helper and the provisioner's
mounts stay as they are.

1. **Image.** `build-push.sh` keeps building `deploy/sandbox/Dockerfile`; it
   now carries the desktop (Xvnc, openbox, xdotool, scrot, xterm, pcmanfm)
   and `/usr/local/bin/sagax-desktop`. About 397 MB, 38.5 MB more. Build both
   architectures as today. The bootstrap preflight's 3 GiB free under
   `/var/lib/docker` still holds.
2. **`sagax-sandboxd` environment** (`infra/runtime/docker-compose.yml`). The
   code defaults moved to a desktop per environment; if the compose or the
   bootstrap's `.env` pins the old values, change them (or drop them to take
   the defaults):

   | Variable | Old | New |
   |---|---|---|
   | `SAGAX_SANDBOX_MEMORY_MB` | 1024 | 1536 |
   | `SAGAX_SANDBOX_MAX_RUNNING` | 3 | 2 |
   | `SAGAX_SANDBOX_PIDS` | 256 | 512 |
   | `SAGAX_SANDBOX_TMP_MB` | 256 | 512 |

   A full house is then 2 x 1.5 GiB = 3 GiB on the 8 GiB VM, as before. A
   paused environment counts against `SAGAX_SANDBOX_MAX_RUNNING` (it keeps its
   memory). `mem_limit: 192m` on the provisioner stays: each live view is one
   spliced `docker exec` stream.
3. **Caddy.** The live view is a WebSocket on the Sagax origin:
   `GET /api/desktop-viewer/sandbox/me/websockify` (and the JSON
   `GET /api/desktop-viewer/sandbox/me`). Caddy's `reverse_proxy` passes
   WebSocket upgrades by default; check the Sagax site block:
   - no `path` matcher or `respond` that drops `/api/desktop-viewer/*`;
   - no `header_up -Connection` / `-Upgrade` and no `transport http {
     versions h2c }` on that upstream (an upgrade needs HTTP/1.1);
   - no `read_timeout` / `write_timeout` shorter than a working session on
     that upstream (the stream stays open while the person watches; Sagax
     closes it when the environment idles out, about 15 minutes);
   - keep `Origin` and `Host` as sent (the route refuses a cross-origin
     request).
   No new route to the provisioner or to any sandbox: the Sagax server reaches
   the VNC port through the provisioner on `sagax-sandbox-control`, as for
   every other call.
4. **Desktop app traffic.** The desktop app now posts coarse system facts to
   `POST /api/desktop-bridge/<id>/system` every 30 s and the Computer tab calls
   `POST /api/me/desktop-bridge/local-vm`; both are ordinary JSON calls on the
   Sagax origin.
5. **Health.** Unchanged: the bootstrap still waits for `egress policy
   enforced`. To check a deploy: open a bot's Computer tab as a member,
   "Afficher le bureau", then `docker ps --filter label=sagax-user` shows one
   container per person who opened it, and `docker stats` stays under 1.5 GiB
   each.
