# Self-hosting the Sagax server

Run the harness server on an always-on Linux box (a VPS, a home server, a
Mac mini in a closet) and pair browsers, the desktop app, or phones with it.
The npm CLI supports a managed public tunnel, Tailscale, or your own proxy.

> **Security first:** by default a self-hosted server trusts loopback as its
> owner — any process that can reach `127.0.0.1:8799` has full control,
> including the shell your bots can use. A browser is the exception: even on
> this machine it signs in once (see [A browser signs in](#a-browser-signs-in)).
> **Never expose that port directly
> and never bind it to a public interface.** Reach it through an SSH tunnel, a
> private network you trust, or an authenticated remote path below. Requests
> through the managed tunnel or a correctly configured proxy require a paired
> session. If several people use one server, read
> [Loopback trust](#loopback-trust-owner-or-service) below.

Quickest with Docker: one line installs the public image and prints a
sign-in link ([Install the Sagax server in one line](install.md)).

Step by step, for a server you do not have yet: [Deploy Sagax on a
VPS](deploy-vps.md) walks through the three ways in (public address, own
domain, Tailscale), signing engines in, pairing, keeping it running,
updating and backups. This page is the reference behind it.

Updates without showing people errors: [Invisible deploys](zero-downtime-deploy.md)
(graceful shutdown, Caddy hold, calm client reconnect).

## What works headless (and what doesn't)

Runs fully on a server:

- every engine CLI (Claude, Codex, Grok, custom ACP engines — install and
  log them in **on the server**)
- chats, rooms, bot-to-bot coordination, routines (they keep running with
  every laptop on the planet closed — this is the point)
- connected apps / custom MCP servers, webhooks, Company Brain
- computer use on **cloud or container computers** (the bot's computer runs
  server-side anyway)
- text-to-speech (with a key), the web UI (the server serves it itself)

- a browser for bots, once the engine is installed on the server
  (`pnpm omb browser install`, or nothing to do in the Docker image,
  which ships it): each bot gets its own isolated, persistent session.
  Watching it live from the app is the next step (docs/plans/browser-engine.md).

Desktop-only for now (needs the Mac/Linux app):

- dictation/voice, controlling the host desktop

## Quickest: from a checkout with Node

On any machine with Node 24 or newer and pnpm (a VPS, a Mac mini, a
Raspberry Pi), build a checkout once, then start it:

```sh
git clone https://github.com/pulsatrixtechnologies/sagax && cd sagax
pnpm install && pnpm build
pnpm omb start
```

An npm package is planned; until it is published, the checkout is the
install. Run the `pnpm omb` commands below from that folder.

First launch asks you to choose AI access, connect an account or API key,
and choose the default model for new bots. Existing sign-ins can be reused;
Codex also offers device-code login for SSH. API-key connections currently
support chat, not agent tools or computer use. The [setup guide](cli-onboarding.md)
explains the choices, key storage, and how to run setup again safely.

It then starts the server and keeps your data in `~/.sagax`. If you
choose phone access, it prints a pairing link and QR code only after checking
the HTTPS connection. Choosing **Skip for now** keeps the workspace local-only
and creates no pairing invitation. Use `pnpm omb setup` to configure without starting, or
`pnpm omb serve` to start non-interactively with your existing config
(for services and scripts).

Sagax does not include engine CLIs (`claude`, `codex`, …); setup
can offer to install and sign in supported engines on this machine.
Run setup, engine authentication, and the server as the same unprivileged
operating-system user. Engine credentials live in that user's CLI-specific
directories, not all under `.openmausbot`.

For a Linux service, the [VPS guide](deploy-vps.md#before-you-start) shows the
account setup, engine installation, and browser dependency installation.
After installing browser libraries as administrator, also run
`pnpm omb browser install` as the service user so that user's browser
is present. Three ways to make the server reachable from elsewhere:

- **On your Tailscale network, no domain needed:**
  `pnpm omb serve --tailscale`. Tailscale terminates HTTPS with its
  own certificate and the link uses this machine's MagicDNS name, so only
  devices on your tailnet can reach it. Needs Tailscale signed in and HTTPS
  certificates enabled for the tailnet (admin console → DNS).
- **A public address, no domain, no proxy, no open port:**

  ```sh
  pnpm omb login          # once: an emailed code signs this machine in
  pnpm omb serve --tunnel
  ```

  `login` reserves an address like `https://c-….openmausbot.com` for this
  machine; `serve --tunnel` connects it through a Cloudflare tunnel (the same
  one the desktop app uses for its companion) and prints the pairing link at
  that address. The first run downloads `cloudflared` (pinned version and
  digest) into the data dir. Only traffic through the tunnel reaches the
  server, and it still has to pair: the tunnel lands on a separate listener
  the server treats as "through a proxy", never as the owner. `pnpm omb
  logout` releases the address. The account credentials live in
  `~/.sagax/tunnel-account.json` (mode 0600).
  Starting it from a fleet or a container, where nobody can type an emailed
  code? Set `SAGAX_INSTALLATION_CREDENTIAL` to the installation credential the
  fleet issued and skip `login`: the address and connector token are fetched
  at every start and nothing is written to disk. A rejected credential stops
  the start with a clear message rather than serving locally.
- **Your own domain, still one command:**

  ```sh
  pnpm omb serve --domain maus.example.com
  ```

  Point the domain's A record at this machine and open ports 80 and 443.
  The server downloads a pinned Caddy once into its data dir, writes the
  same Caddyfile the Docker stack uses, runs it as a child, and Caddy gets
  and renews the certificate from Let's Encrypt. On Linux, binding ports 80
  and 443 as a normal user needs one privilege grant; when Caddy reports the
  refusal, `serve` prints the exact `setcap` command to run once.
- **Behind your own proxy or domain:** `pnpm omb serve --public-url
  https://maus.example.com`, with the proxy rules from "Putting a proxy in
  front".

Later: `pnpm omb pair --label "Kitchen iPad"` for another device
(`--client` for one that may chat but not change settings), and
`pnpm omb sessions` to see or revoke them. `pnpm omb serve` is a
plain foreground process. For unattended use, follow the
[systemd example](deploy-vps.md#keep-it-running), which runs a checkout of a chosen
release directly. Restarting that service does not
pull or build a new release.

## Connect ChatGPT from the browser

A browser paired with Full access can connect an installed Codex CLI without opening a
terminal: **Settings → Engines → Codex → Connect ChatGPT**. OMB starts
`codex login --device-auth` on the server and shows a one-time code. Choose
**Open ChatGPT sign-in**, enter the code on OpenAI's page, and complete sign-in
with your own account. OMB checks for completion and refreshes the model list.
You can cancel or request a fresh code after it expires.

The server still needs Codex installed and runs it as the same operating-system
user as OMB. Your password never goes through OMB; Codex stores its credentials
on the server. Treat server access and backups as sensitive. Device-code login
may need enabling in ChatGPT security settings or by your workspace admin; see
[OpenAI's headless authentication guide](https://learn.chatgpt.com/docs/auth#login-on-headless-devices).
Subscription limits still apply. This browser flow is currently for Codex;
other providers retain their existing sign-in methods.

Once connected, Settings shows the account email when Codex can report it.
To switch accounts, open **Manage account and sign-in** under that line
and choose **Sign out of ChatGPT**: OMB runs `codex logout` on the server as
the same user and confirms with `codex login status`. New ChatGPT tasks need
a connected account. Stop running Codex tasks before switching: sign-out does
not cancel work already in progress. API-key logins are not removed by this
ChatGPT-specific action. A sign-in another browser is still completing is never
pulled away; finish or cancel it first.

## Connect a custom domain in Settings

For a self-hosted server, open **Settings → Remote access → Connect your
domain** from a browser paired with Full access. This is an address-setting and verification
flow, not a DNS or hosting service. Enter the domain to see a compact DNS record
with copy buttons for **Type**, **Name / Host**, and **Value / IP**. The full
hostname is shown; providers that already append the DNS zone need only the
relative name (or `@` at the zone root). Server/proxy instructions are under
**Advanced server setup**.

The IP comes from this server's network interfaces, never the browser, tunnel
hostname or an IP-echo service. Only a single unambiguous public IPv4 is shown.
For containers/NAT or hosts with multiple public addresses, an administrator can
set `SAGAX_PUBLIC_IPV4` to the public IPv4 of the HTTPS proxy and restart OMB.
This is a display hint, not proof of reachability; verification still checks
HTTPS and the workspace identity. If the IP is missing or invalid, the UI asks
for administrator help instead of inventing a DNS value.

To configure the connection:

1. Point your chosen name's DNS **A** record at the server's public IPv4 address.
   Add **AAAA** only when IPv6 routes to the same server.
2. Configure HTTPS with a reverse proxy such as Caddy. The Settings example uses
   your actual app and webhook ports; the [supplied Caddyfile](../deploy/Caddyfile)
   is the reference. Keep OMB listening on loopback, forward the original Host
   and proxy headers, and keep event streams unbuffered. Caddy needs incoming
   ports 80/443 for its usual certificate setup. For containers, follow the
   Docker recipe below so Caddy can reach the loopback listener.
3. Enter `bots.yourcompany.com` (or its bare `https://` origin) and choose
   **Connect domain**. OMB checks HTTPS and the workspace identity at that
   domain before saving it. An incorrect domain leaves the existing address
   unchanged.

The saved custom address takes precedence over the server's configured public
address for **new server pairing links**. Removing it restores that fallback
address, if any; neither action changes DNS, the proxy, bots, conversations, or
existing sessions. A different browser origin needs its own pairing, so keep
your original tab open until the new one works. The setting does not change
`SAGAX_WEBHOOK_PUBLIC_URL`, existing webhook URLs, or the desktop companion's
managed connection. This feature is for self-hosted servers, not the desktop
app's managed phone endpoint.

## Docker (with HTTPS on your own domain)

For a single rootless Podman engine running the server, Caddy, and per-bot
desktops, see the optional [Podman full-stack recipe](../deploy/podman/README.md)
for Windows/WSL2 and Linux x64. It is separate from the Docker deployment below.

For local Docker Desktop or private Tailscale access without a public domain,
use the [local Compose setup](../deploy/local/README.md). It defaults to
`http://localhost:8080` and supports optional `.env` overrides.

One tenant = one container for the server plus Caddy for HTTPS.
Requirements: Docker with Compose, a DNS name pointing at the machine, and
ports 80/443 open.

```sh
git clone https://github.com/pulsatrixtechnologies/sagax && cd sagax/deploy
cp .env.example .env            # set DOMAIN
docker compose up -d --build
```

The compose file builds the image from your checkout (the repository root is
the build context) and names it `sagax:local`. To stay on one release, check
out its tag before you build (`git checkout pulsa-v<version>`). Without a
checkout, the public prebuilt image `ghcr.io/pulsatrixtechnologies/sagax`
(amd64 and arm64, one per release) is what the one-line installer runs:
see [Install the Sagax server in one line](install.md).

Then sign the engine CLIs in **inside the container** (their logins live on
the `data` volume, so they survive restarts and image upgrades) and mint a
pairing code for your first device:

```sh
docker compose exec omb claude                       # each CLI you listed in ENGINES
docker compose exec omb node dist-server/openmausbot.js pair # prints a code, a link and a QR
```

Open the link (`https://<DOMAIN>/pair#code=…`) in a browser and it is
paired; see "Using it from your computer" for what a session is. Webhook
URLs (`https://<DOMAIN>/hooks/wh_…`) work without a session, and that is the
base the app prints on new hooks because the stack sets
`SAGAX_WEBHOOK_PUBLIC_URL` (when that is unset, the server falls back to
`SAGAX_PUBLIC_URL`, the same public origin).

What the stack does, so you can adapt it:

- [`Dockerfile`](../Dockerfile) builds the UI and the self-contained
  server bundle, and runs them as an unprivileged user with `HOME=/data`.
  A build with no engine arguments bakes every engine pinned in
  [`engines.lock.json`](../engines.lock.json) (`ENGINE_SET=all`). Leave
  `ENGINES` empty in `.env`: a non-empty value replaces the lock's npm
  engines. `ENGINE_SET=none` together with `SAGAX_REQUIRE_ENGINES=0` is the
  image with no engine CLI; see [Engines baked into a server image](custom-engines.md#engines-baked-into-a-server-image).
- [`deploy/docker-compose.yml`](../deploy/docker-compose.yml) runs Caddy
  **in the server's network namespace**, so Caddy reaches the server on
  `127.0.0.1` and the server never binds anything public.
- [`deploy/Caddyfile`](../deploy/Caddyfile) terminates TLS and forwards
  the real `Host` plus `X-Forwarded-For`/`X-Forwarded-Proto`; the server's
  own pairing is the login. A shared-password `basic_auth` block is there,
  commented out, if you want a second wall in front of pairing.

Upgrade with `git pull && docker compose up -d --build`. State (chats, routines,
engine logins, paired sessions) is on the `data` volume; back that up.

Server logs survive a container recreation on that same volume:
`<DATA_DIR>/server-log/` (`current.jsonl` and `previous.jsonl`, each capped at
2 MiB, redacted, 0600). The process also keeps a 2,000-line in-memory window
for `GET /api/org/admin/logs`. Stdout from the container runtime is separate
and can still rotate away with the old container; use the data-volume files
(or the admin Logs page) when you need history across a deploy. See
`server/server-log-ring.ts` and AGENTS.md ("Server log on disk").

A local build keeps the Chrome for Testing (and any `ENGINES`) it installed
first, because those layers sit beneath the app and stay cached across code
changes. To pick up the current ones, rebuild with a new tag:

```sh
docker compose build --build-arg CHROME_CACHE_TAG=$(date +%F) omb && docker compose up -d
```

## From source

Requirements: Node 24+, pnpm, and at least one agent CLI installed and
signed in on the server.

```sh
git clone https://github.com/pulsatrixtechnologies/sagax && cd sagax
pnpm install

# choose where data lives and start the server
SAGAX_DATA_DIR="$HOME/.openmausbot" SAGAX_PORT=8799 \
  node --experimental-strip-types server/index.ts
```

For something durable, let the CLI write the service for you:

```sh
pnpm omb service install --domain maus.example.com   # or --tunnel, --tailscale, or nothing
```

It renders a systemd unit (Linux) or a launchd agent (macOS) that runs the
same `serve …` with your options, restarts it if it stops, and,
for `--domain`, grants the unit the capability to bind ports 80 and 443
without root. The file is written next to your data and the two commands
that install and start it are printed (they need `sudo` on Linux).
`pnpm omb service uninstall` prints the reverse. The unit runs the CLI from
this checkout, so keep the folder in place (and build it again after a
`git pull`).

Engine CLIs read their logins from the service user's home: sign them in
from Settings → Engines (below), or as that user in a terminal, before you
rely on routines running unattended.

## Installing the engines without a terminal

Engines whose installer is an npm package (Claude Code, Codex, OpenCode,
MiniMax, pi) can be installed and updated from **Settings → Engines** when
npm is on the server's PATH. OMB runs `npm install -g` as its own user into
`<data dir>/tools/npm`, so nothing needs sudo and nothing touches a global
prefix; that folder goes ahead of everything else on the engines' PATH, so
the copy OMB installed is the one bots run. The package name comes from the
engine's own install descriptor, never from the browser. Engines installed
by a `curl | bash` script still need the command on the server.

## Provider keys, billed per token

**Settings → Connections → Model providers** takes the keys a whole workspace
runs on, for people who would rather pay per token than have every user sign
in. Keys are write-only: the page shows connected-or-not and a **Test** button
that makes one read-only request to the provider from the server.

- **Anthropic API key**: while one is saved, every Claude bot runs on it and
  Claude Code reports the real cost per turn to the usage ledger. Nobody has
  to sign in, and Settings → Engines shows "workspace API key" instead of a
  person. Remove the key to go back to personal logins. The server's own
  `ANTHROPIC_API_KEY` environment variable is deliberately ignored; use the
  page, `config.json`, or `SAGAX_ANTHROPIC_API_KEY`.
- **OpenAI-compatible API key and base URL**: OpenRouter by default, or Groq,
  Together, a gateway, or `https://api.openai.com/v1` for OpenAI itself. This
  powers the OpenAI-compatible engine. Codex has no key path by design and
  always uses a personal ChatGPT login.
- **xAI API key**: the Grok API engine and xAI image generation.

A saved key goes only to its own engine and only to the workspace's endpoint:
an engine instance in `config.json` with its own base URL or its own key (a
router or proxy) never receives it.

**OpenCode is the exception to "the server's own environment is ignored".**
Like `opencode` in a terminal, it reads provider keys from its environment
(`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`,
`KIMI_API_KEY`, `MOONSHOT_API_KEY`, `MINIMAX_API_KEY`) and offers those
providers' models, billed to that key. It does so only where the server's
environment is one person's own: never on MausBot Cloud, a hosted team
workspace, an organisation-managed desktop, or a server whose sign-in list
lets other people in (users, more than one admin, or a whole domain).
Providers added with `opencode auth login` work everywhere.

## Many client workspaces on one server

`sagax fleet` runs one workspace per client on a single Linux server,
each as its own OS user, its own `openmausbot@<name>` service on its own
loopback ports, its own data folder, brand, sign-in list and provider key,
reached at `<name>.<your domain>` through the system Caddy. Bots of one
workspace cannot read another's files or reach its API: the data lives in a
private home, the unit runs with a private `/tmp`, no new privileges and a
read-only system, and an nftables rule keeps each workspace's ports to its
own user, Caddy and root.

Once, as root, with the package installed permanently and a wildcard DNS
record (`*.example.com`) pointing at the server:

```sh
sagax fleet init --domain example.com
```

That writes the template unit, the fence and its unit, the workspace folders,
and adds `import /etc/caddy/omb.d/*.caddy` to `/etc/caddy/Caddyfile`. Then per
client:

```sh
sagax fleet create acme --admin owner@acme.test --member @acme.test \
  --brand /root/acme-brand.json --anthropic-key-file /root/acme-anthropic.key \
  --cap 50 --memory 1G
sagax fleet users acme add bob@acme.test --chat-only
sagax fleet list
sagax fleet suspend acme      # 503 page, service stopped; resume undoes it
sagax fleet upgrade           # new release, then every running workspace restarted in turn
sagax fleet delete acme --yes # add --keep-data to keep the home folder
```

Give `init` `--operator USER` (the Unix user your own workspace runs as; the
user behind `sudo` by default) and it also installs the **fleet agent**: a
root service on a Unix socket only that user may open. Your workspace then
shows **Settings → Installations** (with the enterprise `admin` feature): create
an installation, add or remove who may sign in, suspend, resume, delete, upgrade
all, and see each one's spend this month. Every action goes through the
agent's audit log at `/var/log/openmausbot/fleet.jsonl`.

`https://acme.example.com` is up when `create` returns; the first admin signs
in with an emailed code. `SAGAX_LICENSE_KEY` in the environment (or
`--license-key`) is carried into every workspace so a partner's white-label
key covers them all. Not root? Every command prints the exact steps to run as
root instead, and `--dry-run` always prints.

## Signing the engines in without a terminal

On a hosted server, the engine CLIs sign in from Settings → Engines:

- **Codex**: "Connect ChatGPT" shows a one-time code to enter on OpenAI's
  device page. Once connected, Settings names the account and offers
  **Sign out of ChatGPT** so a different person can connect their own.
- **Claude Code**: "Sign in to Claude" opens Anthropic's own sign-in page in
  your browser; after you sign in it shows a code, which you paste back into
  Settings. The server hands that code to the unmodified `claude` CLI once and
  never stores it; the login lands where Claude Code keeps it for the account
  that runs your bots. This is the sign-in Anthropic permits for a hosted,
  unmodified Claude Code with your own subscription; the bots then share that
  subscription's usage limits. Once signed in, **Manage account and sign-in →
  Sign out of Claude** runs `claude auth logout` for that account's
  configuration directory, confirmed with `claude auth status`, so a different
  person can sign in with their own subscription. Stop running Claude tasks
  before switching accounts: signing out does not cancel them.

## Using it from your computer

Pair once, then use the server from any browser on any machine that can
reach it. On the server:

```sh
pnpm omb pair                                # from a checkout
docker compose exec omb node dist-server/openmausbot.js pair   # Docker
```

It prints a 12-character code (single use, five minutes) and, when the
server knows its public address (`SAGAX_PUBLIC_URL`, set by the Docker stack),
a link like `https://maus.example.com/pair#code=XXXX-XXXX-XXXX`. Open the
link, or open `/pair` on the address you use and type the code. The browser
gets a session cookie (30 days, renewed on use up to 180 days from pairing, revocable) and the app loads. Sessions are
listed and revoked at `GET`/`DELETE /api/auth/sessions` for now; a Settings
screen follows.

From the **desktop app**, use the server dropdown above Search → **Connect
to a server…**, or **Settings → Servers**. Enter the server's
HTTPS address or full pairing link, with an optional name. Custom domains and
Cloudflare tunnel addresses work; Tailscale is not required. Generate a fresh
link for each device: `pnpm omb pair --label "My desktop"` creates an
owner link without the phone wizard; add `--client` for chat-only access.
A code already used by your phone cannot also pair your desktop.

Confirm the server address in the app's connection dialog, then finish pairing
on the server page. The app stays signed in across restarts. The workspace
dropdown switches between **This computer** and saved hosted workspaces, without
moving bots or chats. The **Server** menu and **Add Server from Copied Pairing
Link…** remain available there too (on Windows and Linux press Alt to show
the menu bar). The separate **Desktop companion** option in Settings is for
the six-digit code from another desktop app, not a self-hosted server's
12-character code. Older hosted UIs may not show the dropdown; use the native
Server menu to switch back until the server is updated.

After pairing, **Share this computer?** offers **Choose access** or **Not now**.
Nothing is shared automatically. In **Settings → Servers → Computer
access**, choose read-only folders and optionally allow edits. Unrestricted
terminal and screen/app control are separate opt-ins, confirmed in a native
dialog. They can access information outside the selected folders. Share only
with a workspace you trust; its bots and AI providers may receive shared content.
Folder transfers are limited to 256 KiB per file and do not follow links or
delete files. Local screen control also needs OS permissions and a supported
desktop driver. Microphone access is not included.

**Bring this computer's bots and chats.** When the server you just connected
is empty, its page shows **Bring your bots and chats from this computer**
with **Copy** and **Not now**; **Copy** takes you to this computer's
**Settings → Servers → Copy this computer here** for that server, where you
start it (a server's own page never starts a copy itself). Any time later, that
button on the server's row replaces what the server has (backed up on the
server first; **Swap {server} back** puts it back; copying again replaces that
backup, and the panel says so). On the server's own page, **Settings → Backups
→ Import from this computer** leads to the same place. No file, no password: the app uploads the encrypted workspace
backup directly, continues where a dropped connection left it, and the server
restarts itself to install it. API keys, engine sign-ins and paired devices
stay where they are on both sides; routines arrive paused. The desktop app must
be paired with an owner code (not `--client`), and a server whose email sign-in
lets someone besides you in (a member, a second admin or a whole `@domain`
added with `sagax access add`) never receives one; your own address
alone is fine. Behind a proxy, allow uploads of at least 1 MB
(nginx: `client_max_body_size 64m`); smaller parts are tried before the copy
says so. How each
way of running the server restarts itself: `sagax serve` and
`service install` start it again in the same process, the Docker and Podman
images run `server-launcher.js`, which does the same inside the container; a
server started any other way installs the copy at its next start. Details:
[docs/copy-workspace.md](copy-workspace.md).

Only conversations you start yourself on that server can use what you share;
other people's bots, routines and webhooks there cannot. Keys and sign-in
stores (`~/.ssh`, cloud CLIs, browser profiles, keychains) and `.git`
internals stay out of reach of any shared folder, and the desktop keeps a log
of every request under **Computer access**.

Sharing works while this desktop is awake and running, including when viewing
another workspace. **Stop sharing** revokes access; closing the app stops the
connector. An action already sent to a local app may still finish. **Forget**
also stops sharing and signs this desktop out, without deleting the server's
bots or conversations. If sign-out cannot reach the server, the app warns you;
revoke its session there when reachable again, or if the device is gone.

What this changes about the trust model: the server still binds loopback
and still trusts programs on loopback as the owner, though never a browser
(below). A **paired session** is the second
way in: a bearer token or the cookie, same-origin only, with a scope (`admin`
by default, `--client` for a device that may chat but not change settings or
pair others). Five bad codes from one address lock that address out for ten
minutes. Over plain HTTP (a LAN address without TLS) the cookie is not
marked `Secure` and travels in clear: use the Docker stack, Tailscale, or
another TLS front for anything beyond a trusted private network.

Native clients (CLI, scripts) send the token as `Authorization: Bearer …`
and take a 5-minute ticket from `POST /api/auth/stream-ticket` for the
event stream, because `EventSource` cannot set headers:
`GET /api/events?ticket=…`.

`GET /.well-known/openmausbot/environment` is public and tells a client what
it is talking to: a stable `environmentId`, the label, the version and
capabilities. Saved connections check the id so a reused address that now
points at a different server is refused loudly.

An SSH tunnel still works, and is the right answer when the server has no
address of its own:

```sh
ssh -L 8799:localhost:8799 you@your-server
# then run `sagax pair` on the server and open the "this computer:" link it prints
```

The browser signs in once through the tunnel, like any browser on the server
itself.

### A browser signs in

Port of OpenMausBot #2930 (2026-10-19). A browser never gets loopback trust,
on any server: a request that carries the `Sec-Fetch-Site` or
`Sec-Fetch-Dest` header (every browser sends them to a loopback address, and a
page cannot remove them), or a WebSocket handshake with an `Origin`, needs a
session. A web page is not the person who owns the server, even when it runs
on the same machine, and neither is the Chrome a bot drives. Programs are
unaffected: the CLI, scripts, `curl` and the companion send neither header.
Published pages follow the same rule: a browser reads a private page only
signed in.

The first time you open the web UI in a browser on the server's own machine,
it shows the sign-in page. `sagax serve` and `sagax pair` print a
link for it:

```
this computer: http://127.0.0.1:8799/pair#code=XXXX-XXXX-XXXX
```

Open it (or type the code on the sign-in page); the browser keeps its session
cookie from then on. `sagax` (the guided start) prints the same link.
The desktop app is unaffected: its window adds the app's per-launch owner
header to every request and WebSocket it sends to its server, and no other
Electron session (desktop viewers, Local VM panes) may reach the server.
Paired phones (session or companion relay) and organization servers
(Perspicax sign-in) are unchanged.

For development, `pnpm dev:server` sets `SAGAX_DEV_TRUST_LOCAL_BROWSER=1`,
so a browser on Vite's dev page (`pnpm dev`) is the owner as before. The
server honours it only when it runs from source with owner trust, logs a
warning, and ignores it in a build, the desktop app and a service-trust
server. Run `SAGAX_DEV_TRUST_LOCAL_BROWSER=0 pnpm dev:server` to try the
sign-in. An unpackaged desktop run (`electron .`) sends no owner header,
like upstream: sign its window in with a pairing code, or use a packaged
build. Verification fixtures (`scripts/control-omb.ts`) set it the same
way unless the caller passes `0`.

### Loopback trust: owner or service

Every bot's shell runs on the server as the same user, so every bot is a
loopback caller too. On a server one person uses that is fine: the bots are
theirs. On a workspace several people share it is not: a user could ask a
bot to `curl` the local API and change settings, keys, MCP servers or
webhooks as the owner. The server therefore decides at start-up how far a
loopback request **without a session** is trusted, and logs it:

```
local requests: owner trust (self-hosted default)
local requests: service trust (hosted workspace); without a session, loopback may use only health, edition, brand and bot capability routes. The worker data plane answers only when the relay token is presented.
```

| Trust | Default for | A session-less loopback request may |
|---|---|---|
| `owner` | a self-hosted server, the desktop app | do everything, as today |
| `service` | a hosted workspace: any of `SAGAX_ADMIN_URL`, `SAGAX_ADMIN_WORKSPACE` or `SAGAX_ADMIN_MEMBERSHIP` set (shared-workspace Full access only works there, so it is covered too) | read health, who-am-I, edition and brand; use the bots' own capability routes (`/api/internal/*`, which check their own per-turn token). The worker data plane below answers only with the relay token. |

Under `service`, everything else from loopback needs a real session and
answers 403: settings and keys (`/api/config`), instances, MCP servers,
webhooks, sessions and pairing, people and sign-in lists, usage, budgets,
the decision log, fleet, workspace backups, creating or loosening bots, and
approving or answering any card. Sessions — a portal sign-in, an email
sign-in or a pairing — work exactly as before, with their own scopes.

The worker data plane is the bot list, a thread's messages, attachments, a
new thread, the guarded send, the exact request fence and its stop,
withdrawing a queued line, and declining a card. Those routes answer a
session-less loopback caller only when the request carries
`x-sagax-worker-relay` and the value matches `SAGAX_WORKER_RELAY_TOKEN`
(one line, 32 to 256 characters). The server reads the variable once at
start and deletes it, so an engine it starts does not inherit the token. No
API returns it and no log line contains it. A missing, short or wrong token
leaves the data plane closed. The hosted worker that delivers chat messages
lives in a separate service: it must send the same header in the same
change window as this server. Until both sides carry the token, that
worker's calls answer 403.

Set `SAGAX_LOOPBACK_TRUST=service` on a self-hosted server people share (with
an email sign-in list, say), or `SAGAX_LOOPBACK_TRUST=owner` to opt a hosted
workspace back into the old behaviour (the log then warns). Any other value
means `service`. The desktop app ignores the setting: its local changes
already need the app's own per-launch capability.

With `service` on a self-hosted server:

- `sagax serve` still prints the first pairing code. It hands the
  server it starts a one-off secret over the server's stdin (never its
  environment, which every engine inherits), and that secret opens the
  pairing route for that CLI alone. Pass `--no-pair` to skip the code; if
  the server refuses one anyway, `serve` says why and keeps running.
- `sagax pair` and `sagax sessions`, run later from another
  terminal, are refused like any other admin change and say so. Pair from
  Settings → Remote access while signed in as an admin, or let people sign
  in with their email (`sagax access add you@example.com`, which edits
  the sign-in list on disk).
- A browser on an SSH tunnel gets the sign-in page instead of the app.
- The MCP server script works with `SAGAX_TOKEN` set to a paired session.

**What the relay token closes.** A bot's shell is the same session-less
loopback caller as the hosted worker, and it does not have the relay token.
Without that header it cannot list bots, post through the guarded route,
open a thread, stop a request or decline a card. The token does not open an
admin route, and it does not let `act` change an approval mode. Files the
server's user owns (`config.json`, the engine's environment) are still
readable from a bot's shell; that needs a second user for engines, a
separate change.

## Sign in with Pulsatrix (organization server)

A server shared by an organization signs people in with Pulsatrix
Perspicax, the organization's identity provider, instead of email codes or
invitation links. Accounts, passwords, second factors and roles live in
Perspicax; Sagax is an OpenID Connect client of it (spec:
`docs/superpowers/specs/2026-09-29-perspicax-multiuser-design.md`).

```sh
SAGAX_IDENTITY=perspicax
SAGAX_PERSPICAX_ISSUER=https://px.yourcompany.com   # the Perspicax public origin
SAGAX_PUBLIC_URL=https://bot.yourcompany.com        # this server, no path
# SAGAX_OIDC_CLIENT_ID=pulsa-bot                    # the default
# SAGAX_OIDC_REFRESH_AFTER_SECONDS=3000             # 1 to 3000: refresh a used grant after this long
# SAGAX_IDP_VAULT_KEY=<64 hex>                      # or SAGAX_IDP_VAULT_KEY_FILE=/path/to/key
```

On the Perspicax side, set `PXC_PULSABOT_ORIGIN` to exactly the value of
`SAGAX_PUBLIC_URL`: that registers the first-party client `pulsa-bot` with the
redirect URI `<SAGAX_PUBLIC_URL>/auth/oidc/callback`. Both addresses must be
https (plain http is accepted only on this machine, for a local test). A
server with `SAGAX_IDENTITY=perspicax` and a missing or unsafe address refuses
to start rather than fall back to email codes.

What changes:

- `/pair` shows **Sign in with Pulsatrix**. It opens `/auth/oidc/start`,
  which sends the browser to the Perspicax sign-in page (password and TOTP,
  or a passkey) and back to `/auth/oidc/callback`. The server exchanges the
  code itself (PKCE S256, `state`, `nonce`), checks the ES256 `id_token`
  against the Perspicax JWKS, and sets its own session cookie. No Perspicax
  token reaches the browser, the desktop app, a phone or an engine.
- The server keeps each sign-in's Perspicax refresh token (the grant) in a
  sealed file, `<data>/idp-grants.enc` (AES-256-GCM). Its key comes from
  `SAGAX_IDP_VAULT_KEY` (64 hex characters), else the file named by
  `SAGAX_IDP_VAULT_KEY_FILE`, else `<data>/idp-grants.key`, created 0600 on
  first start. Both files stay out of workspace backups. If the key cannot be
  read, sign-in is refused (`signin_error=unavailable`) rather than hand out a
  session without its grant.
- A session lives as long as Perspicax keeps refreshing its grant. When a
  session is used and its grant was last refreshed more than
  `SAGAX_OIDC_REFRESH_AFTER_SECONDS` ago (default 3000, at most 3000), the
  server refreshes it in the background. Perspicax refusing the refresh (the
  person was disabled or deleted, the grant revoked) puts the person out as a
  back-channel logout would, in case that push was lost: every session of
  theirs ends, including the devices they paired with a code, their pairing
  codes are cancelled, and they must sign in again. A
  Perspicax that cannot be reached keeps the session and retries a minute
  later; after 24 hours without a successful refresh the session ends with
  `401 {code: "idp_unreachable"}`. A refresh carries the current role: a
  demoted admin loses the admin scope on the next refresh, and the person's
  other devices only ever narrow.
- Logging out, or an admin revoking a device, revokes that session's grant
  at Perspicax too.
- Perspicax tells the server at once when a person is disabled, deleted,
  has their password or TOTP reset, or has their sessions revoked: it posts
  an OpenID Connect back-channel logout token to
  `<SAGAX_PUBLIC_URL>/api/auth/oidc/backchannel-logout`. Every session and
  open stream of that person ends, their pairing codes are cancelled, and
  their requests answer `401 {code: "principal_disabled"}` until they sign in
  again. When Perspicax reaches this server by another address than its
  public one (a compose network), set Perspicax's `PXC_PULSABOT_INTERNAL_URL`
  to that origin, for example `http://pulsabot:8799`; the path is added by
  Perspicax. That route takes no other authentication than the token's
  ES256 signature, so it is safe to expose.
- Account erasure (Perspicax 2026-10-17 and later). A person deletes their
  own account from Sagax (`DELETE /api/me`, iPhone Account > Delete
  Account): the server calls Perspicax `POST
  /api/v1/pulsabot/people/me/erase` with `{ "confirm": true }`, the link
  token as Bearer and, in `X-Perspicax-Subject-Token`, the access token of
  a sign-in the person made again just before (2026-10-18): the client calls
  `POST /api/me/reauth` and opens the address it answers
  (`/auth/oidc/reauth?ticket=`, a two-minute, single-use ticket for that
  session), which asks Perspicax for a new sign-in (`prompt=login`,
  `max_age=0`, `login_hint`, scope `openid pulsabot:erase`: Perspicax dates
  only a sign-in that carried that marker, so an ordinary sign-in never opens
  the erasure, and its page warns the person); the callback checks the same
  person, the same live session, the marker granted and an `auth_time` of
  the last five minutes, and keeps that access token in
  memory for this one deletion (an unused one is revoked when it expires).
  The session's own token, which this server refreshes, is never used:
  Perspicax refuses a refreshed token (`403 reauth_required`), so a server
  that only holds refresh tokens erases nobody. Without such a sign-in,
  `DELETE /api/me` answers 409 `reauth_required` and deletes nothing. Only once Perspicax answers `{ "erased": true }` does the server
  delete that person's data here. An older Perspicax (404 or 405 without the
  `X-Perspicax-Erasure` header) leaves everything as it was: 501
  `perspicax_deletion_unavailable`.
- When an account is erased in Perspicax (from Sagax or the console),
  Perspicax pushes it to every linked server as a back-channel logout token
  whose `events` also hold the RISC account purged event
  (`https://schemas.openid.net/secevent/risc/event-type/account-purged`,
  subject `iss_sub` equal to the token's `iss` and `sub`). The server logs
  the person out as usual, then erases their data as `DELETE /api/me` does:
  the bots they own, their threads elsewhere, their Data, server environment,
  saved settings, grants and routine delegation, and their name, address,
  login, photo, label and teams. The principal record stays, emptied and
  marked out (`erasedAt`), so what still names its id (a message in someone
  else's thread, an audit row) resolves to nobody; the directory never fills
  it again. It answers `200 {"purged": true, "bots": n, "threads": n}` once
  the erasure ran (zeros for a person this server never knew), and `500
  {"error": "purge_failed"}` when it did not, which Perspicax retries with a
  fresh token. Both paths are idempotent and never run at once for the same
  person.
- The person is found by the Perspicax account (`iss` + `sub`), never by
  email: the address, name and login are attributes refreshed at each
  sign-in. `GET /api/auth/session` shows `principalId`, `email`, `name`,
  `role` (the Perspicax role) and `orgRole`.
- The Perspicax role decides the session: `admin` gets the admin and client
  scopes and is an organization admin in Sagax; `manager` and
  `employee` get the client scope and are members. A role Sagax does not
  know cannot sign in.
- Email codes (`/api/auth/email/*`) and every invitation route
  (`/api/org/invites*`) answer 403 with `code: "identity_perspicax"`, and
  their screens are hidden. New people are created by an admin in
  Perspicax.
- Loopback without a session is a service, not the owner
  (`SAGAX_LOOPBACK_TRUST=service`), unless you set `SAGAX_LOOPBACK_TRUST`
  yourself: every bot's shell on a shared server is a loopback caller.
- The desktop app, connected to this server as a saved server, always runs
  the sign-in in the person's own default browser, where their password
  manager and passkeys work; it never opens a sign-in window of its own
  (RFC 8252). It listens once on `127.0.0.1`, on an ephemeral port at a
  random path, and opens
  `/auth/oidc/start?client=desktop&return=http://127.0.0.1:<port>/<state>`.
  The server accepts as `return` only `http://127.0.0.1:<port>/<state>` or
  `http://[::1]:<port>/<state>` (a port of 1024 or more, a state of 32 to 128
  URL-safe characters, nothing else: never `localhost` or another host) and
  ends there with `#code=...`, a two-minute, single-use pairing credential
  bound to the person, in the fragment, which no browser sends to a server.
  The page on that address posts it to the app, says "Connexion réussie,
  vous pouvez revenir à Sagax" (and in English), and the app comes to the
  front signed in. While it waits, the app's `/pair` shows **Annuler** and
  **Rouvrir le navigateur**; it stops after ten minutes. The descriptor's
  `identity.loopbackReturn: true` says the server takes `return`. Against an
  older server without it, the app falls back to
  `sagax://auth?origin=...#code=...` only when this exact copy of the
  app is the system's handler for `sagax://` (another installed copy
  would otherwise get the return), and otherwise says the server must be
  updated. Perspicax is unchanged: its redirect stays
  `<SAGAX_PUBLIC_URL>/auth/oidc/callback`. Only the app redeems that
  credential without a click: `/pair#code=...&auto=1` opened in an ordinary
  browser shows the code form. The phone apps offer **Sign in with Pulsatrix**
  for such a server: `?client=phone` ends on the same
  `sagax://pair?address=...&token=...` link a pairing QR code carries, and
  with `&return=sagax` (Sagax for iOS; `identity.phoneReturnSchemes` lists
  `sagax`) a refused sign-in ends on `sagax://pair?address=...&error=<code>`. Perspicax is unchanged for phones
  too: the server is the OpenID Connect client.
  A signed-in member may also open a pairing code for their own device; the
  device acts as them and never gets more than their own scopes. Such a
  device has no grant of its own: it is served only while one of the
  person's own sign-ins (web, desktop or phone) is live, it refreshes the
  freshest of them when due, and it never holds more than the person's
  current organization role. When the person's last sign-in ends, the
  device answers `401 {code: "idp_session_ended"}`.

Bots run on the server: an admin who signed in this way creates a bot and
its turns run on the engines installed on the server (in the Docker image,
the `ENGINES` build argument; see "Docker" above), with the engine
connection or provider key an admin set in Settings → Connections.

### Linked to Perspicax: the directory, sharing and engine access

Perspicax links this server to itself and writes a small link file (its
issuer, the client id, this server's id in Perspicax, this server's public
origin and a link token that opens only the Perspicax directory). Point the
server at it:

```sh
SAGAX_PERSPICAX_LINK_FILE=/link/pulsabot.json    # written by Perspicax (PXC_PULSABOT_LINK_FILE)
# SAGAX_PERSPICAX_INTERNAL_URL=http://perspicax:8787  # where this server reaches Perspicax inside the deployment
# SAGAX_PERSPICAX_DIRECTORY_SECONDS=300              # 5 to 3600: how often the directory is read
# SAGAX_PERSPICAX_TOKEN_BUDGET=45                    # 1 to 60: token and revocation calls to Perspicax per minute
# SAGAX_ORG_NAME=Acme                                # shown in Settings > Organization (default Pulsatrix)
# SAGAX_ENVIRONMENT_LABEL="Acme bots"                # the server's name on /pair and in the apps
```

The server's name on `/pair` ("Sign in to ...") and in the apps is
`SAGAX_ENVIRONMENT_LABEL`, else `SAGAX_ORG_NAME`, else the host of
`SAGAX_PUBLIC_URL`, and only then the machine's host name (in a container, its
id).

- The link file must match this server (issuer, client id, public origin),
  hold at most 4 KiB, and give no permission to "other" users (0640 or
  0600); anything else is refused and Settings > Organization says so. Its
  token is never logged. When Perspicax rotates the link, the file is
  rewritten and the next directory call picks the new token up (a 401
  re-reads the file and retries once).
- `SAGAX_PERSPICAX_INTERNAL_URL` (an origin, http or https, any host): the
  discovery document, the JWKS, the token and revocation endpoints and the
  directory are reached there; the issuer is still checked against
  `SAGAX_PERSPICAX_ISSUER`, and the browser is still sent to the public
  authorization endpoint.
- `SAGAX_PERSPICAX_TOKEN_BUDGET` (a whole number from 1 to 60, default 45):
  how many sign-in, refresh and revocation calls this server makes to
  Perspicax per rolling minute. Perspicax allows 60 a minute per client
  address; lower it when several servers reach Perspicax from one address
  (their budgets add up). Revocations always leave 10 calls free for
  sign-ins and refreshes, and wait in a sealed queue (`idp-revocations.enc`)
  until they go through.
- The directory is read at start, every `SAGAX_PERSPICAX_DIRECTORY_SECONDS`,
  after each sign-in, and when Perspicax asks for it after a rights change
  (`POST /api/org/link/directory-refresh` with the link token,
  `docs/org-admin-api.md` "Link routes"). Everyone it lists becomes a person here (so a bot
  can be shared with someone before their first sign-in), with their name,
  login, address and role. Someone disabled or deleted in Perspicax is
  logged out as a back-channel logout would, even if that push never
  arrived; an admin demoted in Perspicax loses the admin scope at once.
- Settings > Organization shows the link, the last sync, your role and a
  link to the Perspicax console; people, teams and accounts are managed
  there, never here.
- A bot's owner shares it with people from the directory (the bot's
  settings, **Shared with**): they see the bot and its conversations and
  can write to it. Removing someone takes effect at once: their lists and
  live updates lose the bot and its thread answers 404.
- Engine access: the person who speaks pays (2026-10-01; see "Who pays
  for a turn" below). The keys an admin sets in Settings > Connections are
  the organization's key, used automatically after a person's own
  subscription and key, and only on a key-backed engine (Claude, Mistral,
  xAI, OpenAI compatible or OpenCode with a key in Settings > Connections).
  The engines logged in on the server itself no longer serve anyone, admins
  included: each person signs in their own. When nothing serves a turn, or
  the bot's engine is not installed on the server, the message is kept and
  the thread shows a card saying why to the person who spoke, with what
  they can do; the owner gets a notification. The authenticated
  `GET /api/health` lists the engines and whether each is installed.
- A bot whose owner is not an organization admin (2026-10-16): its owner
  turns Full access on for it over HTTP only while the organization allows
  Full access and their profile holds `bots.fullAccess` (Custom, and Full
  through the desktop channel, answer `409 member_bot_full_access`); its
  Ask, Auto-accept edits and Approve for me run as such. In the owner's own
  isolated environment (their server environment, their Local VM) it runs
  commands without a card while **Bots work freely in their owner's
  environment** is on (the default; [approval levels](approval-levels.md#the-owners-own-environment)).
  A card that would act on the server itself, or beyond the owner's own
  rights, waits for an organization admin (Settings > Organization,
  **Commands waiting for an admin**, or the console's inbox); its owner's
  answer is refused with `403 admin_approval_required`.

### Rights, teams, owner keys and sections (slice 4)

- **Teams** come from Perspicax (the `teams` claim at each sign-in and
  refresh, and the directory); Pulsa Bot never edits a team. A change
  narrows or widens what a person sees at once.
- **Sharing** a bot names people or Perspicax teams, each at a level:

  | Level | Gives |
  |---|---|
  | Talk (`use`) | see the bot and its conversations, write to it |
  | Run routines (`run`) | also create, change, delete and run its routines |
  | Edit (`edit`) | also change its name, look, instructions and model |
  | Manage sharing (`manage`) | also share it, up to Edit |
  | Owner | everything, including Manage sharing and deleting it |

  A team grant reaches the team's members. Organization admins administer
  every bot's sharing (Settings > Organization, **Sharing in the
  organization**) but open no bot without a grant. A team manager
  administers the grants of their teams and members on a bot already
  shared with one of their teams, up to that level, and may always lower
  or remove them; a manager does not read a bot through that right.
- **Who pays for a turn (2026-10-01).** Every turn, on a person's own bot
  or on a bot shared with them, runs on the credentials of the person who
  speaks, in this order: the engine not installed (card), the person
  disabled (card), their own subscription for the bot's engine (Claude or
  Codex sign-in, the default and preferred), their own model key in
  Perspicax for the engine's provider (`speaker-key`, or `owner-key` when
  they own the bot), the organization's key (a key in Settings >
  Connections; there is no switch any more) when the person may use it
  (below), else the no_access card with
  **Sign in with my subscription** (Settings > Organization > My engines)
  and **Add my key in Perspicax**. The owner's subscription and key never
  pay for the people the bot is shared with. A bot's routines always run on
  its owner's credentials (subscription, key, then the organization's key),
  whoever created, edited or started them; a disabled owner's routines are
  refused. The thread shows what paid under each reply ("Your
  subscription", "Your key", "Owner's credentials", "Organization's key"),
  never the secret, and the usage rows carry `access` and
  `payerPrincipalId`.
- **The organization's key, per person (2026-10-16).** The accounts the
  organization provides (a key in Settings > Connections, and voice mode on
  its xAI key) serve an organization admin always, and a member only for
  the engine instances Perspicax lists on their person sheet
  (`sagax_server_engines` in the directory: engine instance ids such as
  `grok`, `xaiApi`, `claudeApi`, `xaiVoice` for voice and speech, and
  `xaiImage` for avatar images; `*` for
  every one, which the admin API accepts and the console does not offer). The
  default is none, for existing and new members: an admin checks the
  engines on the person's sheet in the Perspicax console (Sagax > People >
  the person > "Moteurs fournis par l'organisation"), or with
  `PUT /api/v1/users/{id}/sagax-server-engines`. A Perspicax that does not
  send the list gives a member none (logged once per person). A member's
  own subscription, own key in Perspicax and own key on this server keep
  serving them whatever the list. A refused turn shows the no_access card
  with `cause: "server_engine_not_allowed"` (the payer: the person who
  spoke, or the owner for a routine); voice mode answers the same cause.
  The organization's xAI key also pays for speech and images, and follows
  the same list: `xaiVoice` covers voice mode and, when the voice engine is
  xAI, read aloud, voice notes and `/api/tts/*` (for a bot turn: the person
  it speaks for, a routine's owner, or the bot's owner when nobody is
  known); `xaiImage` covers bot avatars generated on xAI (the signed-in
  person asking). A member without the id gets a 403 with
  `cause: "server_engine_not_allowed"` (a bot's voice note is refused the
  same way), nothing is sent to xAI, and there is no fallback to the key;
  their `GET /api/config` shows the xAI voice and images as not configured
  (`xaiKeyNotGiven: true`). A solo server is unchanged.
  The model picker hides, for a member, an engine that only the
  organization's key would serve and that they were not given
  (`GET /api/me/engines` marks it `orgKeyNotGiven`).
- **Access cards are private (2026-10-01).** A refused turn's card (no
  access, a disabled payer, a routine whose owner has no credentials, the
  engine not installed, a person's own key refused) and its notification
  reach only the person it is about: the person who spoke, or the bot's
  owner for its routines (a paused routine: the person it runs as and the
  owner). The other members of a thread or room see the message and nothing
  in place of the card, in the list, the live stream, search and export.
  The card speaks to that person ("You don't have Claude access for this
  message...") with **Sign in with my subscription** and **Add my key in
  Perspicax**; an admin also reads where the organization's key lives. A
  refused organization key stays visible to everyone (its provider words to
  The owner and admins only). Cards stored before this are filtered when
  read, from `payerPrincipalId`, else the bot's owner.
- **Keys live in Perspicax.** A person saves their Anthropic or OpenAI key
  in the Perspicax console (`/console/credentials?kind=model`); Pulsa Bot reads it
  through the link for each turn, keeps it in memory 60 s at most and never
  writes it to disk.
- **Personal subscriptions**: in Settings > Organization, **My engines**,
  each person (from the desktop app or the web) signs in to Claude or Codex
  with their own account. The login is kept in
  `/data/principals/<principal id>/claude` or `/codex` (0700); it pays for
  that person's own turns, on any bot they may talk to, and for the
  routines of the bots they own; never for someone else's turn.
- **Sections are channels.** Right-click a section header (or Shift+F10)
  for New section, Rename, Members and sharing, Move up or down,
  Collapse or expand all, Delete. Members (people or teams, moderator,
  participant or read only) see the section's bots at its default level
  (Talk or Run routines) and its conversation. General stays personal.
  Existing sections become private sections of the owner of most of their
  bots at the first start of this version.

The organization's compose file (Perspicax, Pulsa Bot and their proxies,
with the shared link volume) lives in the Perspicax repository,
`deploy/docker-compose.pulsabot.yml`. The `compose.yaml` here stays the solo
server.

## Join a Perspicax server

### At launch: No server or Server

On a first run, the desktop app asks how this computer is used before the
welcome tour:

- **No server**: the solo, local-first app. The welcome tour
  follows.
- **Server**: the address of your organization's Sagax (empty: ask your
  administrator; no build ships a default server, and only an organization
  server this computer already saved is proposed again). **Sign in** checks that the
  server signs people in with Pulsatrix (its
  `/.well-known/openmausbot/environment` names a `perspicax` identity),
  saves it under Servers, selects it and starts its **Sign in with
  Pulsatrix** (the same sign-in its own page offers, see above). A server
  that cannot be reached, or that is not linked to Pulsatrix, is refused
  with a message and nothing is saved.

The choice is kept in the workspace config (`onboarding.launchMode`, `solo`
or `server`). After **No server** the screen does not come back. **Server**
opens the app on that server (server mode). Beside it, **Personal** (this
computer's own space) is one click away in the account menu and in the
Server menu, at once and without signing out of the server; there is no
other saved server and no **Connect to a server**. The packaged app starts
no local server until Personal is first opened (it starts then, and with the
app from then on), so until then no bot runs on this computer. The one way
out is **Settings > General > System > Server > Change** (or **Server >
Change server…** in the menu bar): after a confirmation the app signs out of
the server, forgets it and its page data, and returns to the launch screen. **No server** there brings back the solo
app with its local bots, conversations and keys exactly as they were. An
install that had already finished the welcome tour is not interrupted. Only
the desktop app's own window shows the launch screen; a browser and a hosted
page never do.

#### Switching accounts

Switching between Personal and an organization server, or between two saved
servers, never signs out and never asks to sign in again: each account keeps
its own page in the window, on its own address, with its own session, its
conversations, drafts and the screen it was on. A switch only changes which
page is on screen, so it shows at once, and the page catches up from its
live stream. Signing out of one account (or forgetting it) closes that
account's page only.

#### The same UI in both modes

On an organization server the desktop draws **its own** UI, not the page the
server image serves: the window navigates to the server's address, but every
page request (the document, scripts, styles, images) is answered from the
app's bundle, and the server keeps `/api/*`, `/.well-known/*` and `/auth/*`
(`electron/bundled-ui.cjs`). The page stays same-origin with its API, so the
session cookie, the server's authorization and its organization rules are
unchanged; only the code that draws the page comes from the app installed on
this computer. The desktop-only parts that hold no local data work there too:
floating bots and their mascot look, the Hibou 98 assistant, the window's
caption buttons, Preferences in the app menu, links in the system browser,
native confirmations and the app's updater. What touches this computer
(files, screen, saved logins and keys, local helpers, diagnostics) stays with
the local page. A server image older than the app may lack an API the UI
calls; keep the server image current with the desktop release.

#### Your preferences and your computer

On an organization server a person's preferences follow them: appearance
(skin, font, threads, Hibou 98), language, notification sounds, the desktop
mascot's behavior and the sidebar layout are kept on the server for that
person (`GET/PUT /api/me/preferences`) and applied on every device they sign
in on. The first time, the desktop app brings the values it had in No server
mode, without asking; the local copy stays for No server. What belongs to
one device stays there: drafts, window and panel sizes, which bots float and
where, the mascot's mood, this device's voices.

Bots run on the server but never use the server's own machine: an
organization server refuses "This computer" and local virtual machines for
every bot. A bot works on the computer of the person who asks, through that
person's Sagax desktop app (Settings > Organization > This computer for your
bots, then Choose access: folders, terminal, screen control), only while the
app is open, and each action goes through the bot's usual approvals. A
routine, another person, or a person whose app is not connected gets a plain
refusal. The server must have computer sharing on in its `config.json`
(`"features": { "sharedComputers": true }`).

The tour's engines beat no longer offers the inherited Sagax Admin
sign-in (`admin.openmausbot.com`); its row now opens Server mode.
Settings > Organization keeps that managed-desktop sign-in for now.

### Copy your bots

A solo Sagax is one person and their devices (pairing codes). To work with
other people, join your organization's Sagax, the one that runs beside
Perspicax and signs everyone in with Pulsatrix. Your bots come with you as a
copy: nothing on this computer is moved or deleted.

**Settings > Organization > Join a Perspicax server** lists your own bots
(the ones you own, or that have no owner). For each one, choose **Copy**,
and whether its **Conversations** (every thread, or one empty conversation)
and its **Memory** (MEMORY.md, topic notes, daily logs) travel. Memory is on
and conversations are off by default. **See what will be copied** shows the
counts, what stays behind (a room or a routine that involves other people, a
bot's access for someone else, a room whose bots are not all chosen) and how
many secrets will be removed.

- **Desktop app:** enter the organization server's address and choose
  **Join and copy**. The app checks that the server signs people in with
  Pulsatrix, saves it under Servers, opens it, and, once you are signed in,
  hands the copy to that page once (it is kept in memory for 30 minutes,
  for that address only). After the copy, each bot can be removed from this
  computer, after a confirmation. Copying is optional: with no bot chosen
  the button reads **Join**, and the app checks the server, saves it under
  Servers and starts its **Sign in with Pulsatrix** (the launch screen's
  Server mode, below), copying nothing.
- **Browser:** **Download the copy file**, then in your organization's Sagax
  open **Settings > Organization > Bring bots from a solo Sagax** and choose
  that file.

What travels: names, titles, descriptions, instructions, colors, sections,
playbooks, rooms whose only person is you, routines (they arrive paused and
run as you), and the conversations and memory you chose. Secrets in message
text, instructions, descriptions, playbook instructions and memory are
removed on the way out. People are named in the copy only by opaque local
ids: on the organization server you are the owner of every bot, the only
person in every room, and the person every routine runs as; anyone else is
dropped and counted, never given access.

What never travels: API keys and provider keys, files and pictures, custom
avatars, model settings (the bots use the server's default model), connector
and MCP grants, Perspicax profiles, computer and browser access. Copied bots
start private, ask before acting, with the computer and the browser off.

The organization server answers `POST /api/org/import` only to a person
signed in with Pulsatrix who may create bots; it refuses a bot owned by
someone else, a room with other people and a routine run by someone else,
and writes nothing on any refusal. A second import is a second copy (fresh
names). Each import is one `org.import` row in the organization audit, with
counts only.

**Leaving.** Forget the organization server under Servers: the app signs out
there. Your bots copied there stay in the organization; your bots on this
computer are unchanged.

For several people on one server, run Sagax with Perspicax (the compose in
`<PERSPICAX_REPO>/deploy`, `docker-compose.sagax.yml`): Perspicax owns the
accounts there, so an organization server (`SAGAX_IDENTITY=perspicax`) offers
no emailed sign-in codes, invitation links or sign-in list, and an old
`config.json` `org` key is ignored. A solo server keeps them, as below: its
own sign-in list, emailed codes and invitations.

## Sign in with your email

A pairing code is fine for the owner's own devices. For a workspace other
people use every day, let them sign in with an emailed code instead: set an
allow-list, and `/pair` on your server offers "Sign in with your email" first.

```sh
SAGAX_SIGNIN_EMAILS="her@yourcompany.com, @yourcompany.com"   # full access
SAGAX_SIGNIN_MEMBER_EMAILS="freelancer@example.com"          # chat and approvals only
```

Signed in as an admin? Settings → Remote access → **Who can sign in with an
email** edits the same list in the browser, no command line needed. From a
checkout, the same thing from the command line, with the server running
or not, no restart needed:

```sh
pnpm omb access add her@yourcompany.com
pnpm omb access add freelancer@example.com --chat-only
pnpm omb access list
```

An entry is an address or `@domain` (everyone at that domain). Admins get
the same access as a pairing code from `sagax serve`; users get the
chat-only scope, the same as `sagax pair --client`. The same lists live
in `config.json` under `signIn.admins` and `signIn.members` and can be changed
through the settings API without a restart; the environment variables win
when set, which is how a container or a service unit is bootstrapped.

Your server mints the code, emails it through the mail provider you
configure (below), checks the answer, and then issues its own session
cookie: the browser only ever talks to your server, and who is welcome is
decided only by your allow-list. Until a mail provider is ready, `/pair`
offers pairing codes only. Wrong codes count against the same lockout as
pairing codes. Sessions from a sign-in show the email in
`sagax sessions` and can be revoked the same way.

### Sending mail from your server

Sign-in codes and invitations leave through one of three providers: `smtp`,
`sendgrid` or `twilio` (the Twilio Email API). An admin sets them in
**Settings > Email** (on the desktop app and on the web), or the server's
environment provides them. A value saved in Settings wins over the
environment for that field; the environment gives every field its default,
so a container can be bootstrapped before anyone signs in. Settings marks a
field the server provides with "Default value provided by the server", and
**Revert to the server's value** removes the saved value of one field.
Before Settings > Email existed the environment won instead; a server that
has both a hand-edited `mail` block and `SAGAX_MAIL_*` now uses the saved
block for every field it names.

```sh
SAGAX_MAIL_PROVIDER=twilio                 # smtp | sendgrid | twilio
SAGAX_MAIL_FROM=bot@yourcompany.com
SAGAX_MAIL_FROM_NAME=Sagax                 # the sender's name; Sagax when none is set

# smtp
SAGAX_SMTP_HOST=smtp.yourcompany.com
SAGAX_SMTP_PORT=587                        # default 465 with tls, 587 otherwise
SAGAX_SMTP_SECURE=starttls                 # tls | starttls | none
SAGAX_SMTP_USER=bot@yourcompany.com
SAGAX_SMTP_PASSWORD=...                    # or SAGAX_SMTP_PASSWORD_FILE=/run/secrets/smtp

# sendgrid
SAGAX_SENDGRID_API_KEY=...                 # or SAGAX_SENDGRID_API_KEY_FILE=/run/secrets/sendgrid

# twilio
SAGAX_TWILIO_API_KEY_SID=SK...
SAGAX_TWILIO_API_KEY_SECRET=...            # or SAGAX_TWILIO_API_KEY_SECRET_FILE=/run/secrets/twilio
```

The compose files under `deploy/` still forward these from `deploy/.env` under
their old names (`OMB_MAIL_*`, `OMB_SMTP_*`, ...); the server accepts both.

Each secret also reads from a `_FILE` path (a Docker secret); when both are
set, the direct value wins. Mail is ready once the provider, `from` and that
provider's fields are set: SMTP needs a host, SendGrid an API key, Twilio a
key SID and its secret. The Twilio provider posts to
`https://comms.twilio.com/v1/Emails` with the key SID and secret as HTTP
Basic credentials; create an API key in the Twilio Console and verify the
sender domain there first.

Settings > Email saves into `config.json` under `mail`, the owner-only
(mode 0600) file that holds this server's other settings and keys:

```json
"mail": {
  "provider": "twilio",
  "from": "bot@yourcompany.com",
  "fromName": "Sagax",
  "twilio": { "apiKeySid": "SK...", "apiKeySecret": "..." }
}
```

`smtp` takes `host`, `port`, `secure`, `user` and `password`; `sendgrid`
takes `apiKey`. The sender's name is `fromName`, then a name written in
`from` (`Sagax <bot@yourcompany.com>`), then `Sagax`: every provider sends
with a name, which the Twilio Email API requires.

A password, API key or key secret is write-only: Settings shows only
"Configured" and a **Replace** button, and `GET /api/mail/settings` never
returns any part of one. **Send a test** sends one message to the address
you signed in with (the profile address on the computer running the server)
and to nobody else; it is limited to one every 30 seconds and five an hour
per person. A refused message is logged with the provider's status code
(and, for Twilio, its reason, such as "The from.address domain ... is not
valid or authorized."), never the credential.

The routes are admin only: `GET` and `PUT /api/mail/settings` (a field set
to `null` goes back to the server's value) and `POST /api/mail/test`, which
takes no fields. An organization server (`SAGAX_IDENTITY=perspicax`) answers
them with 403 `identity_perspicax`, and Settings > Email says that
Perspicax manages its mail.

### Inviting people

**Settings → People** lists who may sign in, their role, when they were last
seen, and what each person spent this month. **Invite** adds an address (or
`@company.com` for everyone there) and shows a link like
`https://your.host/pair?email=name%40company.com`: it opens the sign-in page
with the address filled in, and the one-time code still goes to that address.
Roles change with one click; removing someone stops new sign-ins.

On a solo server, **Settings > Organization > Invite someone** also emails
a one-time invitation link (`https://your.host/join#token=...`, valid seven
days) once mail is set up; opening it adds the address to the members list
and signs that browser in. The invitations are issued in the name of the
server itself: a solo server has no organization to create or move (`POST`
and `PATCH /api/org` answer 410 `interim_org_removed`). An organization
server refuses the email and invitation routes (403 `identity_perspicax`)
and sends `/join` to `/pair`.

On a hosted workspace whose members your organization's Admin manages
(`SAGAX_ADMIN_MEMBERSHIP=portal`), this list decides nothing, so Settings →
People shows, read-only, who has signed in and what they spent, with a
**Manage people in Admin** link to that workspace in Admin → People. Remote
access there lists signed-in devices and offers no pairing codes, since a
hosted workspace refuses them.

### People from before Perspicax

A server that was used by several people before it signed in with Pulsatrix
keeps their bots under their old address. Nobody gets them by signing in
with that address (Perspicax lets people edit their own addresses). For 30
days from the first organization start, an organization admin sees **People
from before Perspicax** in Settings > Organization and attaches each one to
the Perspicax person who is them; a matching address is only a suggestion.
The attach moves their bots, access, rooms, sections and routines, ends their
old sessions and writes one `person.attach_interim` audit row. The admin can
shorten the window, extend it up to 90 days, or close it now.

### Who may answer a card

Approval cards are the provider's own (see the approval modes); Sagax
adds none. On a workspace several people share — portal membership, or an
email sign-in list that names users — it narrows only whose answer counts,
and only when the card can be traced to a person:

- a card for a request a user sent, or in a thread a user opened, is
  theirs to answer (admins and the owner may answer any card);
- a thread a bot opened while working on someone's request (a delegated or
  coordinated job) is traced back to that person, so the cards of work done
  for them are theirs too;
- a card that names nobody — sent by the owner on this machine, by a
  routine or webhook, from Slack (until Slack passes the asker through), or
  in a thread from before this existed — may be answered by any user, as
  before;
- a session-less local caller under `service` trust may only decline.

On a workspace with one person, anyone who can chat may answer, as before.
Each answered card records who answered it (`card.answeredBy`), and so does
its row in the decision log. Who a thread was opened for is kept in a
server-private file (`<data dir>/thread-starters.json`), never sent to clients.

### Who can see a bot

On a workspace several people share, an admin can limit who sees a bot:
**Bot settings → Who can see it** (in the browser, for admins), or when
creating it — **New bot** offers the same choice, and `POST /api/bots` and
`POST /api/teams/import?visibility=…` take it — so a bot for a sensitive job
is never shown to everyone first. Over the API it is `visibility`:

- `"everyone"` — every signed-in person, the default and today's behaviour;
- `"admins"` — admin sessions only;
- `{ "people": ["ada@company.com", "@hr.company.com"] }` — the listed
  addresses and `@domain` entries, plus admins.

It is access control, not an approval step, and it applies at once. For a
user who may not see a bot, the server answers the bot, its threads and
their messages, images, exports, reactions, cards, sends, routines, runs and
attachments exactly as it answers an id that does not exist (404), and leaves
the bot out of the bot list, search results, routines, webhooks, the team map
and the live event stream. Every bot a user is sent, by any route, comes
without its audience list or the ids of teammates they cannot see. When an
admin changes a bot's audience, every user's open app reconnects and
reloads exactly what that person may now see (a user who was away and
resumes from an older point gets the same fresh load); admins' apps are left
alone.

- **Rooms.** A room is one shared transcript, so its bots must be visible
  to the same people: creating a room, adding a bot to one, or scheduling a
  call between bots that other people see differently is refused with a
  plain sentence (for admins too). If an admin later restricts a bot that
  is already in a room, the change is allowed and the room narrows to the
  people who can see all its bots. A room also keeps the narrowest audience
  it has ever had (its floor): taking the restricted bot out, deleting it,
  or widening it again never shows the transcript to more people. A user
  sees a room only if they can see every bot in it and the floor admits
  them. Such a room stays out of the recall, recent-work brief and daily
  memory log of any bot more people can see, and that bot cannot write
  notes from it into its memory — so a bot everyone sees cannot repeat, in
  a chat with anyone, what a restricted bot said there. To widen a room, an
  admin says so explicitly: **Bot settings → Who can see it** lists the
  rooms visible to fewer people than the bot, each with **Show … to everyone
  its bots allow** (`PATCH /api/groups/:id` with `{"resetAudience": true}`),
  which resets the floor to what the room's current bots allow and is
  recorded in the admin activity log.
- **Teams.** A team (sidebar section) is listed to a user only when it
  holds a bot or room they can see.
- **Bots working together.** A bot reaches a teammate (asks, delegations,
  its roster and `list_bots`, @mentions, a Chief's team) only when exactly
  the same people can see both: otherwise one bot's thread could carry the
  other's answers to people who cannot see it. Bots nobody restricted all
  share "everyone", so nothing changes until an admin restricts one. A bot a
  Chief creates (directly, or in a reviewed team setup) gets exactly the
  Chief's audience.
- **Who sees everything.** Admin sessions and the owner on this machine see
  every bot. On a hosted workspace the worker sees every bot only after it
  presents the relay token. On an organization server a session-less
  service caller sees none. A pairing-code device with no email sees only
  bots everyone can see. Users never receive a bot's audience list.
- **Files.** An attachment is refused only when everything that uses it —
  a message in a thread, a bot's picture — is hidden from that user. A
  file nothing uses yet (someone's own upload) is served; its name is random.
- **Not covered.** Words already quoted into a conversation a user can
  see (an earlier delegation, a message copied by hand, or something a bot
  wrote into its own memory files with its file tools while it shared a room
  with a restricted bot) stay there. A bot's
  shell can still read files on the server, as it always could. Slack is
  decided in your organization's Admin: whoever may message a bot's Slack
  app reaches that bot there.

The desktop app has no chat-only user sessions and does not show this setting;
nothing there changes.

On the Workspaces screen, creating a client workspace shows the same kind of
link for that workspace's admin, so a client gets one address, one workspace
and one link.

## Standing Claude Code permissions for every bot

Claude Code runs with `--setting-sources project`: the server's own
`~/.claude/settings.json` is not read, so a rule placed there never applies.
To let every bot of the server run one command without a card, set
`SAGAX_CLAUDE_ALLOW` on the server, as a JSON list or one rule per line, in
Claude Code's rule syntax:

```sh
SAGAX_CLAUDE_ALLOW='["Bash(claude plugin marketplace add acme/marketplace)"]'
```

The rules go into each turn's private settings file (`permissions.allow`).
A guest's confined turn never gets them. A rule that is not a tool name with
an optional pattern is dropped, and a malformed list grants nothing. Prefer
exact commands over `:*` wildcards on a server many people share. Restart the
server after a change; a running bot takes the new rules at its next launch.

On an organization server, plugins and skills do not go through a bot's
shell at all: the bot's owner adds a marketplace and installs plugins in
Connect apps, in that bot's scope ("For <bot>", `server/bot-plugins.ts`; the
marketplace list is the workspace's own, one list for both scopes); Sagax
fetches the marketplace itself and loads each plugin with `--plugin-dir`, without its
hooks or MCP servers. The organization's admin may keep a list of allowed
marketplaces (Connect apps > Sources > Organization sources and access; any by default).
`SAGAX_CLAUDE_ALLOW` rules for `claude plugin ...` are therefore not needed
there.

### Pulsatrix Flow for every member (organization server)

On a server linked to Perspicax, the Claude Code plugins of Pulsatrix Flow
come by default with membership (`server/org-flow-plugins.ts`). Perspicax
declares them in the directory (`flow_plugins`): its own private marketplace
(`<issuer>/flow/marketplace/marketplace.json`, built from its active signed
Flow pack: the product `pulsatrix-flow` and the organization's configuration
plugin), the token audience (`<issuer>/flow/marketplace`) and the plugins with
their versions. Nothing comes from GitHub.

- Install: the server fetches the manifest and ZIP archives directly with
  its installation link token. It needs no member sign-in and no Claude CLI.
  The manifest and archive must stay on the linked issuer's marketplace;
  redirects are refused. SHA-256, plugin name and version are checked before
  a sanitized copy replaces the current one. Tokens stay in memory only.
- Load: sanitized copies keep skill, command, agent and executable script
  files; native hooks, MCP declarations and LSP are stripped. Claude loads
  them with `--plugin-dir`; the same selected copies are available to the
  person's sandbox and the capability file reader.
- Guard: the copy has no hooks, so the Flow guard runs in Perspicax (its
  server guard runs the pack's own PreToolUse hook on every call of a
  Flow-linked profile: dry run, the person's GO, read back). Perspicax
  declares `guard: "enforce"` only while that guard enforces and every
  profile that can write is linked to Flow. Without it (an older Perspicax,
  the guard off or in shadow, or `enabled: false` with a `reason` such as
  `flow_guard_uncovered`) the server installs nothing, takes its copy out,
  and no turn loads it.
- Triggers: a directory that changed, a person's sign-in,
  a Perspicax profile added to a bot, the start of the server and a check
  every 30 minutes. Each is idempotent and silent when the copy matches.
- Off: the Perspicax admin sets `flow_plugins_default` to `off` (its Flow
  page); the next directory takes the copy out. A plugin someone installed
  on a bot by hand stays.
- Status: `GET /api/org` (`settings.flowPlugins`), never a token.
- Other engines: Codex, Grok and the rest have no Claude Code plugin system;
  they reach Flow through the Perspicax profiles of the turn (`flow` and
  `flow_action`), under the same server guard.

An allow rule never overrides a denial. Rules only go into
`permissions.allow`; they never remove a tool from `--disallowedTools` or from
a deny list, and in Claude Code a deny always wins over an allow. On an
organization server where host tools (Bash, Read, Write, Edit and the like)
are denied because commands run in each person's sandbox, a rule such as
`Bash(claude plugin marketplace add ...)` does not reopen host Bash: the bot
still cannot run it on the server.

## Putting a proxy in front

Any reverse proxy works, given three things:

1. **Forward the real `Host`** and set `X-Forwarded-Proto`. Any request that
   carries forwarded headers is treated as remote and needs a session, so a
   proxy that rewrites `Host` to `127.0.0.1`, or forwards a stranger's
   `Host: localhost`, gains nothing. The proxy's scheme decides whether the
   session cookie is `Secure` and is part of the same-origin check.
2. **Set `X-Forwarded-For` yourself** (Caddy and nginx do by default) and
   drop any the client sent: the pairing lockout counts failures per first
   forwarded address.
3. **Do not buffer** the event stream (`flush_interval -1` in Caddy,
   `proxy_buffering off` in nginx); the UI streams events over SSE.

Plus one convenience: set `SAGAX_PUBLIC_URL=https://your.domain` so pairing
links and hook URLs use the public address (hook URLs also accept a dedicated
`SAGAX_WEBHOOK_PUBLIC_URL` when the webhook host differs).
[`deploy/Caddyfile`](../deploy/Caddyfile) is the reference implementation.

## Opening a desktop from another device

In a paired admin browser, **Open live desktop** uses the same address as
Sagax for Local VMs and your own VPS. Shared, per-bot and pool Local VMs
connect through their managed container's loopback port. VPS desktops connect
through an SSH tunnel opened by the server. Neither needs an additional public
port or viewer origin setting. Keep Local VM VNC ports bound to loopback and
VPS VNC ports private.

Your app reverse proxy must support WebSocket upgrades, preserve `Host`, and
set `X-Forwarded-Proto` to the browser-facing scheme. This also applies when
using Tailscale Serve. Viewer requests require an admin session. Logging out
or revoking that session closes open viewers. Client-only pairing does not
grant desktop control.

An open Local VM viewer keeps that VM's idle timer active. Remote VPS viewers
share a tunnel; it closes 30 seconds after the last viewer leaves, allowing
reconnects during that interval. A native desktop viewer keeps its existing
explicit-close behavior and maximum tunnel lifetime.

Use **Keyboard** to send text from a phone and **Clipboard** to exchange text
with the desktop; clipboard edits sync automatically. The desktop fits the
window, with fullscreen available when the browser supports it. Hosted Cloud
keeps its provider-issued viewer. Local owner connections keep their direct
viewer URLs and the packaged desktop's isolated viewer windows.

These controls are in the web app. The native phone apps have their own
computer viewers; use a paired browser for interactive Local VM or VPS access.
For the proxy boundary and offline regression checks, see the
[viewer verification recipe](verification/desktop-viewer.md).

## Using it from your phone

Signed in on a hosted server as an admin (with a pairing code or your
email)? Settings → Remote access → **Pair a phone or another computer**
creates a one-time code with a QR right in the browser, and lists every
paired device with a sign-out button. Nobody needs the command line.

The iOS app pairs with a server the same way a laptop does: scan the QR
code that `sagax serve` (or `sagax pair`) prints, paste the
whole `https://host/pair#code=…` link into the address field on the pairing
screen, or type the address and then the code. The phone gets a session of
its own, listed and revocable with `sagax sessions`. What it may do is
the code's scope: a code from `sagax pair` carries `admin` and the app
shows everything; a code from `sagax pair --client` (also what the
guided phone setup mints) can chat, approve and read, and the app hides
creating bots and sections, changing models, generating avatars, connecting
apps and cloud desktops — those stay with the owner. A server reinstalled at
the same address has a new identity; the app then asks to pair again rather
than present the old session to it.

Both native apps pair this way. `sagax pair --phone android` prints the
app-scheme QR that Android's scanner needs, and the iOS app accepts either
that QR or the web link. Pass `--phone` whenever nothing is watching the
terminal, such as `docker compose exec omb node dist-server/openmausbot.js
pair --phone android --public-url https://your-domain`, since a scripted run
never reaches the question the interactive command asks. Nothing extra to install, and the phone becomes a
session like any other.

Older way, still supported, and only useful on a LAN or a tailnet: run the
companion sidecar next to the harness and pair by its own QR. It advertises
on your private networks (Tailscale-aware) and issues its own per-device
credentials, which are **not** `sagax sessions` and are revoked from
its own page at the `127.0.0.1:8811/#token=…` link it prints. It also serves phones over cleartext HTTP
on port 8810, so do not expose it from a public server. It ships only in a
git checkout: the Docker image does not contain it.

```sh
node --experimental-strip-types companion/src/index.ts
```

## Usage and costs

Every settled turn is appended to `<data dir>/usage/YYYY-MM.jsonl`: which
bot, which model and engine, tokens in and out, the cost the engine reported
(real on a metered key, an equivalent on a subscription, absent when the
engine reports none), and who asked: the email a person signed in with, the
device label otherwise, a routine, another bot, or this computer. No message
text is stored. **Settings → Usage → History** shows a period grouped by bot,
model, person, day or engine, and **Export CSV** downloads one line per turn.
Owners can read the same over the API:

```sh
curl -H "Authorization: Bearer $TOKEN" \
  "https://maus.example.com/api/usage?from=2026-09-01&to=2026-09-30&groupBy=user"
curl -H "Authorization: Bearer $TOKEN" -o usage.csv \
  "https://maus.example.com/api/usage.csv?from=2026-09-01&to=2026-09-30"
```

Dates are inclusive, UTC, at most a year apart; without them you get the
current month to date.

### The decision log

Every approval decision — a rule that let a tool call through, a card that
was shown, and a person's answer, with who gave it (the session's email or
device label, `loopback` for the owner, `worker` for a session-less local
service) — is appended to `<data dir>/decisions/YYYY-MM.ndjson` (0600,
credentials redacted). Month files are kept for at least 180 days; set
`decisions.retentionDays` in `config.json` (or through `PUT /api/config`),
or `SAGAX_DECISION_RETENTION_DAYS`, to keep them longer or shorter (1–3650
days; the environment wins). A month is deleted only once all of it is older
than the window. An older server's `decisions.ndjson` and `.1` are still read
and age out the same way. Admins can read it back:

```sh
curl -H "Authorization: Bearer $TOKEN" "https://maus.example.com/api/decisions?limit=200"
curl -H "Authorization: Bearer $TOKEN" -o decisions.csv \
  "https://maus.example.com/api/decisions.csv?from=2026-09-01&to=2026-09-30"
```

The CSV has one line per decision (time, decision, source, bot, tool,
summary, rule, unattended, answered by, thread, request); cells that would
start a spreadsheet formula are prefixed with `'`.

### Admin activity

On a workspace several people share — a hosted workspace, an email sign-in
list that names more than one person or a whole `@domain`, or a device paired
(or a pairing code open) with chat-only access, whether before or after the
change — every admin change is recorded beside the decision
log, in `<data dir>/admin-activity/YYYY-MM.ndjson` (0600), and kept for the
same window (`decisions.retentionDays` / `SAGAX_DECISION_RETENTION_DAYS`; a
quiet server prunes on a timer, and pending rows are written out at
shutdown): settings
(which keys changed), sign-in lists and people, pairing codes and revoked
sessions, webhooks, MCP servers, engines and keys, bots created, deleted or
given different permissions, spend limits and prices, and who can see a bot.
Each row names who acted — the session's email or device label, `This
computer` for the owner, `Command line` for `sagax` commands such as
`sagax access add` — and the values before and after. Values are
redacted: anything under a key that names a credential, every value in a
headers or environment map, the value after a flag such as `--api-key` or
`-k`, URL parameters such as `?key=`, a token before a URL's host
(`https://TOKEN@host`), and key-like URL path parts (`/s/<key>/sse`) are
written as `[hidden]`, so a key change
shows that the key changed and never the key. Each row covers only what that
request named or saved, so two admins changing things at the same moment are
each credited with their own change. The desktop app, and a server one person
uses, keep no such log.

**Settings → Activity** (admins, in the browser) shows these rows together
with the cards people answered, filtered by who, what and when, and exports
them as CSV. The same over the API:

```sh
curl -H "Authorization: Bearer $TOKEN" \
  "https://maus.example.com/api/admin-activity?from=2026-09-01&to=2026-09-30&what=visibility"
curl -H "Authorization: Bearer $TOKEN" -o activity.csv \
  "https://maus.example.com/api/admin-activity.csv?who=ada@company.com"
```

`what` is `all` (admin changes and answered cards, the default), `approvals`,
`decisions` (every decision, automatic ones too), or one of `config`,
`people`, `session`, `webhook`, `mcp`, `engine`, `bot`, `budget`,
`visibility`; `who` matches part of a name or email; without `from` the list
starts 30 days ago. Nothing here is sent to your organization's cloud Admin,
which keeps its own activity log.

## Spend limits and sell prices (enterprise)

With the `budgets` entitlement, **Settings → Usage → Monthly spend limit**
caps the workspace: once the month's cost reaches it, no bot starts a turn,
whether a person wrote, a routine fired, a peer asked or a webhook arrived,
until an admin raises it. A warning shows at a configurable percentage, and
admins get one in-app notification the first time each month crosses the
warning and one when it reaches the limit (a new month or a new limit starts
over).

The figure is every cost in the usage ledger. Claude reports its own cost
(real on your keys, an equivalent on personal subscriptions). Codex, the
OpenAI-compatible/OpenRouter engine, Grok, MiniMax and the ACP engines report
tokens but no price, so the server books an **estimate** from a built-in list
of vendor list prices (`server/model-prices.ts`, each entry with its source
and the date it was read) and marks the row `costSource: "estimated"`. A model
that is not in the list is unpriced and not counted; Usage says how many
turns that was. Estimates use each vendor's standard short-context rate, so
long prompts, cache writes and priority tiers cost more than estimated.

With the `billing` entitlement, **Sell prices** takes your own price per
million tokens by model id, `driver/model`, or `default`, and History and the
CSV export gain a **billable** column next to the provider's cost. For an
engine that reports no cost, a price you set for that exact model also
replaces the list price in its estimate; `default` is used only for models
the list does not know. Both are plain settings in `config.json` (`budgets`,
`billing`) and through `PUT /api/config`.

## A bot that also runs outside the server

Some engines have their own long-running front door — a Hermes Agent Telegram
gateway, a Slack bot, an OpenClaw session. That process is the same bot with
the same workspace and memory, but the server did not spawn it, so it holds
none of the turn-scoped capabilities the peer-comms tools need and cannot ask
or delegate to its teammates.

Give it a standing one with `external-runtimes.json` in the data directory,
mapping the bot's id to a secret of at least 32 characters and one existing
thread owned by that bot. Use the bot and task `threadId` from the local
`GET /api/bots` response; selecting a different thread in the sidebar will
not change this binding. This connects peer communications, not the external
engine's filesystem or login configuration.

For a **new** file (add entries to the existing JSON instead if already set up):

```sh
umask 077
BOT_ID=your-bot-id
THREAD_ID=your-existing-thread-id
TOKEN=$(openssl rand -hex 32)
printf '{ "%s": {"token":"%s","threadId":"%s"} }\n' "$BOT_ID" "$TOKEN" "$THREAD_ID" > ~/.sagax/external-runtimes.json
chmod 600 ~/.sagax/external-runtimes.json
```

Keep the file private (`600` on Unix; restrict its Windows file permissions).
A Unix file other users can access is ignored with a warning. It is read on
demand, so adding, removing or rotating a token needs no restart, including
requests waiting on a body, approval or status poll. Use a different secret
for each bot. Deleting or archiving the bound thread disables its token; it
never silently moves to another conversation. A bare token without `threadId`
is rejected, including on bots that currently have just one thread.

The runtime runs the bundled MCP bridge from the source checkout with the same
bot, thread and token (replace the port with your server's actual address):

```sh
SAGAX_HARNESS_URL=http://127.0.0.1:8799 SAGAX_BOT_ID=$BOT_ID SAGAX_THREAD_ID=$THREAD_ID \
  SAGAX_COMMS_TOKEN=$TOKEN SAGAX_EXTERNAL_RUNTIME=1 \
  node --experimental-strip-types server/drivers/agents-proxy.ts
```

Scope is deliberately narrow: the token is an *agents* capability for that
bot's pinned thread only, and the server accepts just four routes with it — list
peers, ask, delegate, and read the status of its own delegations. Opening
threads, creating bots or rooms, skills, memory and every other internal route
answer 403. External mode advertises only `list_bots`, `ask_bot`, `delegate_bot`,
`check_delegation` and `wait_delegation`. It can check a delegation from the
same long-running process without inventing a turn end, and a settled handoff
never wakes the bot's own engine on that thread to answer it again. The server
still enforces peer access and approval settings. An idle source starts dispatch
immediately; a busy teammate is queued until available. Regular in-app turns
keep their existing dispatch timing.

The credentials stay on this server and are excluded from workspace backups;
restoring a backup preserves destination registrations. Never put this token
in chat or source control. Everything else the server offers still needs the
owner's session or a per-turn capability.

Verification: [external runtime fixture](verification/external-runtime.md).

## A turn that goes silent

The server stops a turn that has sent it nothing for 20 minutes
(`SAGAX_TURN_STALL_MS`) and says why in the chat. Engines report a tool only
when it starts and when it ends, so while one of the turn's tools is still
running (a long build or test suite) the turn may stay silent for up to
`SAGAX_TOOL_STALL_MS` (default 2 hours). That is a hard bound: a tool that truly
hangs still ends the turn. Any event from the turn starts the silence over, and
time spent waiting on a person or a computer never counts. Either way the turn
stops with "no activity for N minutes".

Both take whole milliseconds. `SAGAX_TURN_STALL_MS` is never below 60000 (one
minute) and `SAGAX_TOOL_STALL_MS` never below `SAGAX_TURN_STALL_MS`. A value
that is not a positive finite number (empty, `65m`, `0`, a negative number,
`Infinity`, `1e309`) leaves the default. Set them in the server's environment
and restart it; the restart stops every running turn.

A turn in a room also has a work ceiling of its own, `rooms.turnTimeoutMinutes`
in `config.json`. It stops a member's turn even while its tool runs, and these
two settings do not change it.

## Updating

For a service that runs a checkout, [check out and build the chosen
release](deploy-vps.md#update) as the service user while the server is
stopped, then start it again. A foreground server runs whatever the checkout
holds: `git checkout vX.Y.Z`, build, then `pnpm omb serve`.

```sh
sagax update                                                            # one-line install (docs/install.md)
git pull && docker compose -f deploy/docker-compose.yml up -d --build   # Docker from a checkout
git pull && pnpm install && pnpm build && sudo systemctl restart openmausbot   # from source
```

`sagax update [X.Y.Z]` pulls that release of the public image (the latest by
default), restarts, and waits until the server answers; the server applies
its data migrations when it starts. `sagax update <previous>` goes back.

Routines and queued work survive restarts. A teammate turn in flight runs
again once at the next start, told to check what it already did, and the bot
that asked for it is told. A person's own turn and a running routine are not
run again: the conversation says it was interrupted. Update between runs
where you can.

Stop the server before a filesystem backup so SQLite is copied consistently.
Back up the entire app data directory and, separately, the service user's
engine credentials, browser state, and external workspaces. For Docker, the
whole `/data` volume includes the CLI homes. See the
[backup and restore instructions](deploy-vps.md#back-up) for the exact scope
and stop/start commands.
