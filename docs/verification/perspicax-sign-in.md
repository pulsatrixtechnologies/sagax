# Sign in with Pulsatrix (Perspicax OpenID Connect)

An organization server (`SAGAX_IDENTITY=perspicax`, see
[self-hosting](../self-hosting.md#sign-in-with-pulsatrix-organization-server))
signs people in with Perspicax. Two levels of proof, both isolated: nothing
touches the user's app, `~/.sagax`, or a live Perspicax.

## Against a fake provider (automated)

```sh
pnpm exec vitest run server/auth/oidc-rp.test.ts server/auth/oidc-login.test.ts server/auth/oidc-login.e2e.test.ts
node --test electron/oidc-system-sign-in.node-test.mjs
```

`server/testing/fake-oidc-provider.ts` generates an ES256 key with
`node:crypto` and serves discovery, JWKS, authorize (signs the configured
person in at once), token (checks code, client, redirect URI and PKCE S256)
and revoke. The unit tests bend one thing at a time: bad signature, a key the
JWKS does not publish, `alg` other than ES256, wrong `aud`, `azp` or `iss`,
expiry and issue time outside 60 s, nonce mismatch or absence, state replay,
a callback in another browser, the wrong PKCE verifier, key rotation (one
JWKS refetch on an unknown `kid`), and the pending-flow limits.

The e2e test boots the real server with a temporary home against that
provider and the repository's fake engine, then proves: the environment
descriptor's `identity`, the sign-in walk and its cookie, `GET
/api/auth/session` (principal, email, name, role, orgRole), scenario A (an
admin creates a bot on the server, gets its answer, and a second browser of
the same person reads the thread), an employee's client-only session, refused
replays, foreign browsers and unknown roles, 403 on email codes and every
invitation route, and service loopback trust.

## Against a real Perspicax (manual)

Build Perspicax per its slice 1 contract and run it on a free port with a
throwaway config dir (never the operator's instances or
`~/.config/pulsatrix-connector`):

```sh
PX=$(mktemp -d)
cat > $PX/config.toml <<'EOF'
bind = "127.0.0.1:18787"
public_origin = "http://localhost:18787"
auth_mode = "local_oauth"
management = "gateway"
EOF
printf 'a-long-test-password\n' | pulsatrix-connector --config-dir $PX gateway init --admin alice --password-stdin --email alice@example.test
pulsatrix-connector --config-dir $PX local-auth enroll-totp alice > $PX/totp.txt   # keep the secret out of the terminal
PXC_PULSABOT_ORIGIN=http://localhost:18788 pulsatrix-connector --config-dir $PX serve
```

Then an isolated Sagax with a temporary home and the fake engine:

```sh
H=$(mktemp -d); mkdir -p $H/.openmausbot
echo '{"instances":{"grok":{"driver":"grokAgent","config":{"cli":"'$PWD'/server/testing/fake-acp-cli.ts","fullAuto":false}}}}' > $H/.openmausbot/config.json
env -i PATH="$PATH" HOME=$H SAGAX_PORT=18788 SAGAX_WEBHOOK_PORT=18789 \
  SAGAX_IDENTITY=perspicax SAGAX_PERSPICAX_ISSUER=http://localhost:18787 \
  SAGAX_PUBLIC_URL=http://localhost:18788 node server/index.ts
```

Open `http://localhost:18788/pair`, choose **Sign in with Pulsatrix**, enter
the password and a TOTP code on the Perspicax page, and land on the app. Check
`GET /api/auth/session` shows `identity: "perspicax"`, the principal, the
email and the role. A login access token (obtained by running the same code
flow by hand) must get 401 on `http://localhost:18787/mcp`: its audience is
the Sagax origin.

With real engines, the server runs turns on the engines installed where it
runs (the Docker image's `ENGINES` build argument) with the connection or key
an admin set in Settings, Connections; nothing runs on the signed-in person's
computer.

## Slice 2: the session lives on the grant

### Automated (fake provider)

```sh
pnpm exec vitest run server/auth/oidc-rp.test.ts server/auth/oidc-login.test.ts server/auth/idp-session.test.ts \
  server/auth/sessions.test.ts server/auth/request-auth.test.ts server/auth/principals.test.ts server/environment.test.ts \
  server/auth/oidc-login.e2e.test.ts server/oidc-session.e2e.test.ts src/pair
node --test electron/oidc-system-sign-in.node-test.mjs electron/environments.node-test.mjs
```

The fake provider now rotates refresh tokens (the old one dies), checks the
`resource`, returns an id_token without a nonce on refresh, revokes a whole
family, and signs back-channel logout tokens; `disable(sub)`,
`setRole(sub, role)` and `failNextToken(status)` drive the refusals.

- `server/auth/oidc-rp.test.ts`: refresh (rotation, resource, a refreshed id_token
  for another subject or carrying a nonce, no id_token, invalid_grant as
  rejected, 503, 429 and an unreachable provider as transient), revocation,
  and the logout token matrix (another key, `alg: none`, unknown kid,
  another typ, aud, iss, no or past `exp`, `iat` in the future, no or wrong
  events, a nonce, no `jti`, sid only); an id_token is never a logout token
  and the reverse.
- `server/auth/idp-session.test.ts`: the sealed vault (round trip, a file it
  cannot read is never overwritten, key from the environment, a key file or
  a 0600 default), refresh on use (not due, due, single flight), a rejected
  grant ending its sessions, a transient failure kept with a one minute
  backoff and ended after 24 hours, role changes (the grant's sessions take
  the new scopes, the person's other devices only narrow), release on
  logout and expiry, the sweep (unredeemed and orphan grants) and
  back-channel logout by subject and by principal.
- `server/auth/oidc-login.test.ts`: the routes in process: the `client`
  parameter, the exact desktop and phone return links, the desktop loopback
  `return` (127.0.0.1 and [::1] with a port and a state accepted; localhost,
  other hosts, https, no port, privileged ports, a query, a fragment, extra
  path and a missing state refused, on /pair, never on the address named;
  refused on phone and web), no-store, and the
  back-channel route (405, wrong content type, oversized body, every forged
  token, 200 once then a replay refused).
- `server/oidc-session.e2e.test.ts` (real server, fake provider, fake engine,
  `SAGAX_OIDC_REFRESH_AFTER_SECONDS=1`): S2-1 refresh and rotation, S2-2 a role
  change narrows the session, S2-3 a back-channel logout ends the sessions
  and the open event stream at once, S2-5 logout revokes the grant, S2-6
  forged and replayed logout tokens, S2-7 the desktop return link redeemed
  once into a cookie session, S2-7b the same through the desktop app's real
  loopback listener (the credential only in the fragment, posted back by the
  listener's page, never in the server log), S2-8 the phone return link redeemed into a
  bearer that a back-channel logout ends by principal, a disabled person's
  refresh ending the session, and a member pairing their own device.

### Against a real Perspicax (manual)

Start Perspicax and Sagax as above, with a short refresh period and, when
Perspicax should post to another address, its internal URL:

```sh
PXC_PULSABOT_ORIGIN=http://localhost:18788 pulsatrix-connector --config-dir $PX serve
env -i PATH="$PATH" HOME=$H SAGAX_PORT=18788 SAGAX_WEBHOOK_PORT=18789 \
  SAGAX_IDENTITY=perspicax SAGAX_PERSPICAX_ISSUER=http://localhost:18787 \
  SAGAX_PUBLIC_URL=http://localhost:18788 SAGAX_OIDC_REFRESH_AFTER_SECONDS=5 node server/index.ts
```

Then, with users `alice` (admin), `bob` (employee) and `carol` (admin) and an
admin console session for alice:

1. S2-1: sign bob in, wait 6 s, `GET /api/auth/session` answers 200 and
   Perspicax records `token_refreshed` for bob, client `pulsa-bot`.
2. S2-2: set carol to employee in Perspicax; after 6 s and one request her
   session shows `role: "employee"`, scopes `["client"]`, and
   `GET /api/auth/pairing` answers 403.
3. S2-3: with bob's event stream open, disable bob: within 3 s the stream
   ends and his session answers 401; Perspicax records `logout` ok. Enable
   him and sign in again: same `principalId`.
4. S2-4: `DELETE /api/v1/users/{bob}/sessions` ends bob's session within 3 s.
5. S2-5: alice logs out; Perspicax records `token_revoked` for her.
6. S2-6: forged logout tokens (another key, `alg: none`, wrong aud or iss,
   expired, no events, a nonce, an id_token) answer 400; a replayed valid
   one answers 400.
7. S2-7 and S2-8: in a browser with a throwaway profile, open
   `/auth/oidc/start?client=desktop` (and `?client=phone`), sign in, and read
   the `sagax://` address the browser is sent to; redeem it with
   `POST /api/auth/pair` (desktop) or `POST /api/pair` (phone) once.
   S2-7b: listen with `nc -l 127.0.0.1 53123` and open
   `/auth/oidc/start?client=desktop&return=http://127.0.0.1:53123/<43 url-safe chars>`:
   after the sign-in the browser asks for that path with no credential in
   the request line (it rides in the fragment).
8. S2-9: start a desktop flow and never redeem it: after about 3 minutes the
   sweep revokes the grant (`token_revoked`).
9. S2-10: stop Perspicax: requests still answer 200 and the server logs a
   deferred refresh; start it again and the next due refresh succeeds.

- `electron/oidc-system-sign-in.node-test.mjs`: the desktop never opens a
  sign-in window of its own; the loopback listener binds 127.0.0.1 only on an
  ephemeral port at a random 43-character state, serves its FR/EN page with
  a nonce CSP, takes only that state, that Host and that Origin, a credential
  or an error once, then closes; it times out and can be cancelled; the
  return decision (loopback, else sagax:// only when this exact copy of
  the app owns the scheme, else none with a reason).

The desktop return into a real Electron window is checked with the app's
real preload on a second local server acting as the remote environment
(fake Perspicax, temporary home and profile, free ports):

```sh
pnpm exec vite build
node --experimental-strip-types scripts/verify/dev/verify-desktop-sign-in.ts               # PASS: signed in, back on /
node --experimental-strip-types scripts/verify/dev/verify-desktop-sign-in.ts --old-target  # PASS: the 0.3.x delivery stays signed out
```

Server mode's UI is checked the same way, with the second server serving a
decoy page of its own: the window must show this app's bundle on the
server's origin (`electron/bundled-ui.cjs`), sign in, create a bot through
the API with the session, expose the desktop-UI bridge and nothing local,
and float that server's bot as a desktop mascot whose look follows a change
made on the server. It starts from a save made before organization servers
were marked (no `org`, no server mode), checks that the upgrade at launch
fixes it, then checks the mascot's balloon (a message reaches the server as
the signed-in person), Open in the app, and the owl, shape and Trombi:

```sh
pnpm exec vite build
node --experimental-strip-types scripts/verify/dev/verify-server-mode.ts         # PASS (32/32), built bundle
node --experimental-strip-types scripts/verify/dev/verify-server-mode.ts --dev   # the same, UI from Vite as in the dev app
```

The window already shows `<origin>/pair` when the credential comes back, so
the delivery must be a new document (`/pair?signin=<nonce>#code=...`): a
target that differs only in its fragment is a same-document navigation and
`/pair` never reads it. In a dev run every step is printed as `[sign-in] ...`
on stdout (and always written to the app's `server.log`), never the
credential.

The desktop click-through is checked by hand on a build that is not the
system's sagax handler (the dev build next to an installed
`/Applications/Sagax.app`): "Sign in with Pulsatrix" opens the default
browser (a passkey works there), /pair in the app shows "Annuler" and
"Rouvrir le navigateur" while it waits, the browser ends on "Connexion
réussie, vous pouvez revenir à Sagax" and the app comes to the front signed
in; the installed app gets nothing. The phone apps on a device are checked
by hand.

## Slice 3: the link, the directory and sharing with a person

### Automated (fake provider)

```sh
pnpm exec vitest run server/perspicax/perspicax-link.test.ts server/engines/engine-access.test.ts server/auth/direct-grants.test.ts \
  server/auth/principals.test.ts server/auth/oidc-rp.test.ts server/auth/oidc-login.test.ts server/auth/idp-session.test.ts \
  server/auth/request-auth.test.ts server/rooms/channel-visibility.test.ts server/org/org-sharing.e2e.test.ts \
  server/oidc-session.e2e.test.ts server/auth/oidc-login.e2e.test.ts server/environment.test.ts server/wire.test.ts \
  src/components/bot-settings
```

The fake provider now serves `GET /api/v1/pulsabot/directory` behind its
link token (`linkToken`), with an ETag and 304, settable `directoryPeople`
and `directoryTeams`, and `setDirectoryStatus(sub, status)`.

- `server/perspicax/perspicax-link.test.ts`: the link file (0644 refused, 0640 and
  0600 accepted, another issuer, origin or client, extra keys, a bad token,
  more than 4 KiB, and the token never in a refusal) and the directory sync
  (principals created before any sign-in, attributes updated, `disabledAt`
  never cleared, a disabled or vanished person logged out once, a demotion
  narrowed, 304, a 401 followed by a rotated file, single flight, a timeout
  or a 5xx keeping the last data).
- `server/engines/engine-access.test.ts`: who a turn speaks for, the refusal
  notices (the speaker's, a routine's, a disabled payer's), the
  key_refused card and who sees its detail, and who answers a server
  command of a member's bot.
- `server/org/org-sharing.e2e.test.ts` (real server, fake provider, fake Claude
  CLI with `SAGAX_ANTHROPIC_API_KEY` and `FAKE_CLAUDE_DUMP`): S3-3 the
  directory before and after a sign-in, S3-11 the engines in the
  authenticated health (an admin and a member read them; a session-less
  local caller, which on an organization server is any bot's shell, gets
  exactly `{"app":"openmausbot"}`), S3-4 a bot shared with bob answered with the
  organization key while dave sees nothing (list, thread, search, stream),
  S3-5 the grant removed ends bob's stream and access at once, S3-6 the
  no_access and engine_missing cards (and an admin's own login-backed bot
  still answering), S3-7 a member's bot refused full access, S3-10 a person
  disabled in the directory logged out with no back-channel push.

### Against a real Perspicax (manual)

Isolated instances only (never the live app or its data). Build
`pulsatrix-connector` from the slice 3 head and pick free ports, for
example Perspicax 19071 and Pulsa Bot 19072:

```sh
S=$(mktemp -d)
PXC_PULSABOT_ORIGIN=http://localhost:19072 PXC_PULSABOT_LINK_FILE=$S/link/pulsabot.json \
  pulsatrix-connector --config-dir $PX serve
env -i PATH="$PATH" HOME=$S/pbhome SAGAX_PORT=19072 SAGAX_WEBHOOK_PORT=19073 \
  SAGAX_IDENTITY=perspicax SAGAX_PERSPICAX_ISSUER=http://localhost:19071 \
  SAGAX_PUBLIC_URL=http://localhost:19072 SAGAX_OIDC_REFRESH_AFTER_SECONDS=5 \
  SAGAX_PERSPICAX_LINK_FILE=$S/link/pulsabot.json SAGAX_PERSPICAX_DIRECTORY_SECONDS=5 \
  SAGAX_ANTHROPIC_API_KEY=sk-ant-test-org-key FAKE_CLAUDE_DUMP=$S/claude-dump.json node server/index.ts
```

with `config.json` instances `claude` (claudeAgent, `cli` =
`server/testing/fake-claude-cli.ts`), `ghost` (claudeAgent, `cli` =
`/nonexistent/claude`) and `grok` (grokAgent, `server/testing/fake-acp-cli.ts`),
and accounts alice (admin), bob, dave and erin (employees). Then walk S3-1 to
S3-11 of the slice 3 plan: the link file (0640, six keys) and the auto link,
the link token scope, the directory before bob signs in, scenario B (share,
reply with `ANTHROPIC_API_KEY=sk-ant-test-org-key` in the dump, dave sees
nothing), scenario C (removal), scenario F (the cards, the owner's
`turn-failed` notification), the member bot rules, a link rotation picked up
within one directory period, unlink and relink, the directory as the
backstop when the back-channel push cannot arrive, and the engines in
`GET /api/health`.

## Slice 4: rights, teams, owner keys, personal subscriptions and sections

### Automated (fake provider)

```sh
pnpm exec vitest run server/auth/authz.test.ts server/bots/bot-grants.test.ts server/engines/engine-credentials.test.ts \
  server/rooms/section-channels.test.ts server/engines/principal-engine-logins.test.ts server/org/org-teams.test.ts \
  server/auth/principals.test.ts server/perspicax/perspicax-link.test.ts server/auth/oidc-rp.test.ts server/auth/idp-session.test.ts \
  server/engines/engine-access.test.ts server/auth/direct-grants.test.ts server/rooms/channel-visibility.test.ts \
  server/auth/request-auth.test.ts server/drivers/claude.test.ts server/drivers/codex.test.ts \
  server/org/org-rights.e2e.test.ts server/org/org-sharing.e2e.test.ts server/oidc-session.e2e.test.ts \
  server/auth/oidc-login.e2e.test.ts src/components/bot-settings
pnpm -s i18n:check
```

The fake provider now also puts a settable `teams` claim in the id_token
(`setTeams(sub, teams)`; a refresh reflects the change), lists each
person's `provider_keys` in the directory, and answers
`POST /api/v1/pulsabot/provider-keys/resolve` behind the link token
(`providerKeys`: 200 with the key, 404 `no_key`, 409 `user_inactive` for a
disabled person).

- `server/auth/authz.test.ts`: the level lattice (use, run, edit, manage, owner),
  team grants (members only: a team's managers administer, they do not
  read), a disabled person, an admin with no grant (administers, cannot
  use), a manage holder (up to edit), the manager anchor (add up to the
  anchor, lower and remove always, never outside their teams), section
  default levels capped at run, rooms with `team:` entries, section roles.
- `server/bots/bot-grants.test.ts`: GET, PUT and DELETE `/api/bots/:id/grants`
  with every answer code, and the new `CLIENT_ALLOW` rows.
- `server/engines/engine-credentials.test.ts` (revised 2026-10-01, the person who
  speaks pays): the whole decision table (speaker owner or someone shared
  with, x subscription, key, org key or nothing, x Claude, Codex or another
  engine, disabled people, unknown people), the bot's routines on the
  owner's credentials (scheduled, started or edited by someone else, owner
  disabled, owner without credentials, hops), a key that went away falling
  through, an inactive payer refused, an unreachable Perspicax.
- `server/drivers/claude.test.ts` and `server/drivers/codex.test.ts`: an
  owner key reaching the CLI, a subscription's `CLAUDE_CONFIG_DIR` /
  `CODEX_HOME`, no process reused under another identity, the
  `pulsa_owner` provider for Codex.
- `server/rooms/section-channels.test.ts`: migration owner, private records,
  rename and delete kept in step, General refused, sharing with a team,
  readonly, moving bots in and out, the manager anchor on members.
- `server/org/org-rights.e2e.test.ts` (real server): S4-1 teams in the session
  and the directory, S4-3 a person and a team grant, the speaker's own key
  answering them (never the owner's, 2026-10-01), S4-5 levels, S4-6 the manager, S4-7 an admin
  without a grant, S4-4 removal through the directory then through a
  refreshed id_token, S4-9 a personal Codex subscription (fake device
  login), S4-10 and S4-11 a section shared with a team and a room with a
  team.
- Who pays (2026-10-01): `server/org/org-sharing.e2e.test.ts` (the org key by
  itself, cleared by an admin then refused with the speaker's card, an
  admin's own login-backed bot refused, the digest's `access`),
  `server/org/org-routines.e2e.test.ts` (a routine started or rewritten by a
  shared user runs on the owner's key, never his own subscription or key;
  refused with the owner's card without credentials and once the owner is
  disabled; usage rows with `access` and `payerPrincipalId`) and
  `server/org/org-admin.e2e.test.ts` (the retired switch refused, the usage
  split with `speaker-key`).

### Against a real Perspicax (manual)

Isolated instances only. Build `pulsatrix-connector` from the slice 4 head,
ports for example Perspicax 19081 and Pulsa Bot 19082 (webhook 19083), and
start Pulsa Bot as in slice 3 with `SAGAX_PORT=19082`,
`SAGAX_PERSPICAX_ISSUER=http://localhost:19081`,
`SAGAX_ANTHROPIC_API_KEY=sk-ant-test-org-key-000000` and
`FAKE_CLAUDE_DUMP=$S/claude-dump.json`; `config.json` instances `claude`
(fake Claude CLI), `codex` (fake Codex, login CLI
`server/testing/fake-codex-login-cli.ts` with `SAGAX_DEVICE_AUTH_FIXTURE=1`)
and `ghost` (`/nonexistent/claude`). Accounts: alice (admin), bob, carol
(member of team T), dave (team U), mia (manager of T), erin. Then walk
S4-1 to S4-15 of the slice 4 plan: the teams claim, alice's key saved in
`/console/credentials?kind=model` and read through the link (the dump shows it for
bob's turn), scenario B and C with a team, levels, the manager, the admin,
engine resolution (key deleted, org key on, alice's own turn, erin's key,
`ghost`), erin's Codex subscription, sections as channels in headless
Chrome (right-click the empty sidebar, "New section…", "Members and
sharing…"), a room with `team:U`, the section migration on a slice 3 data
directory, the Members page, a disabled owner, and the slice 2 and 3
regressions.

## Health: who learns what

`GET /api/health` answers by caller (`server/auth/request-auth.ts`,
`healthDetail`):

| Caller | Answer |
|---|---|
| anyone signed in (admin or member, cookie or bearer) | `app`, `pid`, `static`, `capabilities`, `engines` (each instance, its driver, `installed`, and `version` when the CLI reports one) |
| loopback trusted as the owner (desktop, a one-person server) | the same |
| the `openmausbot serve` CLI, with its per-launch secret | the same (it waits on the pid it started) |
| session-less loopback on a hosted workspace (service trust) | `app` and `capabilities` (the Slack worker's guarded send contract) |
| session-less loopback on an organization server, or anyone remote without a session | `{"app":"openmausbot"}` only |

```sh
pnpm exec vitest run server/auth/request-auth.test.ts server/org/org-sharing.e2e.test.ts server/hosted-access.test.ts
```

By hand on an isolated organization server (port 19092 below):
`curl -s http://127.0.0.1:19092/api/health` prints `{"app":"openmausbot"}`;
the same with a signed-in cookie or `Authorization: Bearer omb_sess_...`
lists `engines`.

## Slice 5: one Perspicax account connection, as the person who speaks

### Automated (fake provider)

```sh
pnpm exec vitest run server/perspicax/perspicax-mcp.test.ts server/perspicax/perspicax-identity.test.ts \
  server/perspicax/perspicax-link.test.ts server/perspicax/perspicax-claims.test.ts \
  server/perspicax-mcp-bridge.test.ts server/routes/internal-integrations.test.ts \
  server/routes/mcp-internal.test.ts server/drivers/chat-mcp-tools.test.ts \
  server/drivers/pi-mcp-extension.test.ts
pnpm typecheck
```

The fake provider now answers the RFC 8693 token exchange at its token
endpoint (Basic auth with the link token, `subject_token` = the speaker's
sign-in access token, canonical `resource` = its `/mcp`, with no profile in
the exchange), lists the account's held roles, and serves a small `/mcp` that
records who called which tool. Every harness mounts that connection as the
fixed server `perspicax`.

- `server/perspicax/perspicax-mcp.test.ts`: who speaks for a turn (the Direct's
  person, a hop through `ask_bot` or `coordinate_bots`, a room member, a
  routine's person), one account exchange, the fixed mount, token renewal and
  revocation, and no cache across people.
- `server/perspicax/perspicax-identity.test.ts`: explicit `identity_switch`
  and `profile_use`, role-dependent tool discovery, restoration after token or
  session renewal, generation reset, and no silent fallback to the default
  role when restoration fails, including routine retry.
- `server/perspicax-mcp-bridge.test.ts`: the stdio bridge the harness holds;
  the engine sees only a turn capability, gets `tools/list_changed` before a
  switch response, and receives 401 once the turn ends.
- `server/drivers/chat-mcp-tools.test.ts` and
  `server/drivers/pi-mcp-extension.test.ts`: a role switch re-lists tools and
  replaces the model's registered catalogue without replaying a completed
  vendor operation.

### Against a real Perspicax (manual)

Isolated instances only. Build `pulsatrix-connector` from the slice 5 head
(Perspicax 19091, Sagax 19092, webhook 19093) and start Sagax as in slice 4
with `FAKE_CLAUDE_MCP_CALLS` and `FAKE_CLAUDE_MCP_DUMP=$S/mcp-dump.json`.
Give alice and bob the roles Dispatch and Billing, and leave one additional
role unheld. Then walk the slice 5 acceptance:

1. Discovery lists the token-exchange grant; the directory shows each
   person's held roles. There is no bot Perspicax profile setting or route.
2. The exchange contract by curl: `expires_in` at most 900, no
   `refresh_token`, `resource` is exactly `/mcp`, and no profile selector is
   sent. The subject token itself, a missing Basic header, a console `pxat1.`,
   an ordinary `/mcp` token and a foreign resource are refused with the codes
   in the plan; `token_exchanged` appears in auth_events.
3. `tools/list` on mount `perspicax` exposes role controls. Switch from
   Dispatch to Billing, list again, and verify that each role's real tool
   surface is used. An unheld role is refused by Perspicax.
4. Scenario E: bob (`use` on X) sends "ping"; the reply has
   `mcp:api_list:ok`; Perspicax's journal has the rows under bob, none
   under alice; `token_revoked` within 10 s after the turn.
5. End the generation after selecting Billing, start a warm generation, and
   verify that it opens a new MCP session on the account default. No selected
   role or role-specific tool catalogue crosses the boundary.
6. No `pxlo1.` in `claude-dump.json`, `mcp-dump.json`, the Sagax log or
   `ps -Eww` during a turn; a person disabled mid-turn gets an MCP error on
   the next call, never a result.
7. `PXC_INTERNAL_HOSTS=perspicax:8787` lets the compose's internal host past
   the Host check (`deploy/docker-compose.pulsabot.yml` sets it).

## Slice 6: routines in the owner's name

### Automated (fake provider)

```sh
pnpm exec vitest run server/org/org-routine-consent.test.ts server/routines/routines.test.ts server/auth/idp-session.test.ts \
  server/perspicax/perspicax-mcp.test.ts server/auth/authz.test.ts server/auth/request-auth.test.ts \
  server/org/org-routines.e2e.test.ts server/org/org-mcp.e2e.test.ts server/org/org-sharing.e2e.test.ts \
  server/oidc-session.e2e.test.ts server/routines/routine-delegation.e2e.test.ts \
  server/perspicax/perspicax-link.test.ts server/auth/oidc-login.test.ts \
  src/components/routines/RoutineOwnerName.test.ts
pnpm -s i18n:check
```

The fake provider now issues routine delegation families
(`scope` with `pulsabot:routines`, a refresh token that survives the
person's sign-outs), lists `routine_delegation` per person in the
directory, and revokes a family from its fake console. Since 2026-10-08 it
also issues a delegation family by token exchange through the link
(`requested_token_type` refresh token, the marker scope), the change Sagax
needs from Perspicax; `tamper.noDelegationExchange` answers like Perspicax up
to 1.8.13 (`invalid_request`).
`SAGAX_ROUTINE_RENEW_SECONDS` shortens the renewal window for tests.

- `server/org/org-routine-consent.test.ts`: one delegation per person (a new
  one revokes the previous one), the renewal reused for its window and
  refreshed once for concurrent runs, a refusal ending the delegation with
  one notice, a transient failure skipping the run, the refreshed claims
  (a role that no longer signs in is `person_out`), reconciliation with the
  directory, the delegation's access token as the token exchange subject, no
  revoke from Sagax, a person out, and no token in plain text; and
  ("routines always act in their owner's name") the delegation issued at a
  run from the live session, at sign-in from its access token (one flight),
  again at once after Perspicax ended the family, the fallback to the live
  session, a skipped run (never paused) when nobody is signed in or
  Perspicax cannot issue it, nothing for a person who is out, and the daily
  slide while the person uses Sagax. The legacy consent callback's refusals (`routines_subject`, `binding`,
  `routines_session`, 401 without a session) are in
  `server/auth/oidc-login.test.ts` and `server/org/org-routines.e2e.test.ts`; the
  solo server's 403 `identity_perspicax` is checked by hand (S6-12). Who gets
  401 and who gets 403 on `/api/org/routine-delegation` (the gate's 403 for a
  session-less local request under service trust, its 401 for an expired or
  revoked session, the route's 401 `session_required` under
  `SAGAX_LOOPBACK_TRUST=owner`, 403 `identity_perspicax` for a session without
  a principal or on a solo server) is tabled in `docs/verification/routines.md`
  ("Slice 6: rate limits at Perspicax"), with the rate limit behavior and the
  durable revocation queue.
- `server/routines/routines.test.ts` ("slice 6: routines in their person's name"):
  `runAs` from the creator and moved by a work-field edit, snapshotted on the
  run, a refused run suspending its routine once (`no_right`,
  `person_out`), a transient refusal failing without suspending, a new
  delegation resuming from now, and a routine paused for a delegation before
  2026-10-08 resuming from now at load.
- `server/org/org-routines.e2e.test.ts` (real server): the delegation issued at
  sign-in with no consent and a read-only route, scenario D (the routine
  runs while alice has no session, on her key and her delegation), renewal
  reused within the window, Perspicax unreachable (skipped, not suspended),
  a console revoke never pausing the routine (the next run gets a new
  delegation), a Perspicax that cannot issue one (skipped, never paused, no
  card), bob's routine on alice's bot (runs as bob on alice's key, then
  `no_right`), a room goal, a disable pausing `person_out`, and no refresh
  or access token written in clear.

### Against a real Perspicax (manual)

Same setup as slice 5, with the slice 6 connector build, the accounts
`root` (second admin), `mona` (manager of T) and `max` (manager of U), and
routines on cron `* * * * *` (a stand-in for scenario D's hourly routine).
Walk S6-1 to S6-13 of the slice 6 acceptance:

1. alice signs in: no consent page, no card; `token_issued` detail
   `routine delegation` appears in the Perspicax journal right after her
   sign-in (needs the Perspicax change of 2026-10-08).
2. alice signs out everywhere; her routine R1 on X still runs within 90 s,
   on her owner key, with MCP rows under alice and `token_refreshed`
   detail `routine delegation`.
3. `root` disables alice: R1 `person_out` within 10 s, the held run
   cancelled; once re-enabled, her next sign-in issues a new delegation
   and R1 resumes.
4. There is no revoke in Sagax. Until Perspicax removes its revoke (Mon
   accès, Members), a revoke there never pauses R1: the next run issues a
   new delegation from alice's session, with no card.
5. bob's routine on X runs as bob and never under alice; losing `run`
   pauses it `no_right`; a member-owned bot's server command still waits
   for an admin approval.
6. Stopping Perspicax (its PID only) skips runs without suspending;
   `grep -r 'pxlr1\.\|pxlo1\.'` over the data directory and logs finds
   nothing.

## Slice 7: the Sagax console in Perspicax

Spec sections 5 and 8. Sagax answers the Perspicax console at
`/api/org/admin/*` (`server/org/org-admin-routes.ts`), before the auth gate and
before loopback trust: the only credential is a console assertion Perspicax
signs per proxied request (ES256 with the OIDC key, header typ
`pulsabot-console+jwt`, `aud` = this server's `SAGAX_PUBLIC_URL` origin,
`act.sub = "console"`, `exp - iat <= 120`, a `jti` kept until exp + 60 s, at
most 10,000). A session cookie is ignored there and a loopback request
without an assertion is 401. Every answer carries `X-Sagax-Admin-Api: 1` and
`Cache-Control: no-store`; errors are `{ code, message, error }`.
`/api/health` lists `capabilities.orgAdminApi: 1` on an organization server.

Bot files (2026-10-08, slice 1 of the Perspicax file browser, read only,
`server/org/org-admin-files.ts`): `GET /api/org/admin/files/<bot>/roots`,
`list?root&path`, `stat?root&path`, `read?root&path&offset&length` (at most
128 KiB, `binary` instead of `text` for bytes that are not UTF-8) and
`download?root&path` (`application/octet-stream`, `Content-Disposition:
attachment`, `X-Sagax-File-Type`, at most 100 MiB, else 413 `too_large`).
Managers in reach (the bots route's reach) and admins; any other bot is 404.
Roots: `workspace`, `tasks`, `project` (only inside the data folder),
`attachments` (by opaque id), and `sandbox` and `desktop` listed as
unavailable. Paths are relative, `/`-separated, no `.`, `..`, empty segment,
backslash or NUL, at most 1,024 bytes; a link anywhere is 403
`link_refused`. Each read and download writes `bot.files.read` or
`bot.files.download` (category `bot`, actor the console person, `after`
root, path, bytes) to the admin activity log. `/api/health` adds
`capabilities.orgAdminFiles: 1`. Tests: `server/org/org-admin-files.test.ts`,
`server/org/org-admin.e2e.test.ts` (S7-G).

### Automated

```sh
pnpm exec vitest run server/auth/oidc-rp.test.ts server/org/org-admin-routes.test.ts server/org/org-admin-files.test.ts server/usage/usage-ledger.test.ts \
  server/activity/admin-activity.test.ts server/bots/bot-grants.test.ts server/rooms/section-channels.test.ts \
  src/lib/open-thread-hash.test.ts server/org/org-admin.e2e.test.ts \
  server/org/org-routines.e2e.test.ts server/org/org-mcp.e2e.test.ts server/org/org-sharing.e2e.test.ts \
  server/oidc-session.e2e.test.ts server/peers/peer-approval.e2e.test.ts
pnpm -s typecheck && pnpm -s lint && pnpm -s i18n:check
```

The fake provider signs console assertions (`consoleAssertion`, one claim or
header bent at a time).

- `server/auth/oidc-rp.test.ts` ("console assertions"): a good assertion, then
  each refusal (typ, act, an audience array or another origin, an `azp`, a
  300 s life, expired, no expiry, a future `iat`, a nonce, events, alg
  `none`, another key, an unknown kid, another issuer, the subject, the
  `jti` length, the role, the teams, another linked server), one JWKS
  refetch on rotation, and the three tokens never taken for one another.
- `server/org/org-admin-routes.test.ts`: the gate (missing, forged, too long,
  replayed, unknown and disabled people, solo), 404 and 405, the role per
  route, a manager's reach on bots and usage, approvals oldest first, the
  POST body (`allow` or `deny` only, never `always` or `rememberCommand`),
  the audit parameters and cursor, the replay cache's expiry and cap.
- `server/usage/usage-ledger.test.ts` ("organization admin usage"): speakers by
  principal, routine runAs, bot or unattributed; grouping by day, bot and
  speaker with the access split; the 92 day and 20,000 row caps.
- `server/activity/admin-activity.test.ts` ("organization audit page"): the org
  categories newest first, stable `<month>-<line>` ids, the `before` cursor,
  the time range, no secret value.
- `server/bots/bot-grants.test.ts` and `server/rooms/section-channels.test.ts`: one
  audit row per saved change (`grant.set`, `grant.remove`,
  `section.create` ... `section.bot.remove`), none for a refusal.
- `server/org/org-admin.e2e.test.ts` (real server): every refusal of the gate
  (including a loopback request and a session cookie without an assertion,
  a replay, a logout token, another server id), the role gates, bots for an
  admin and a manager (metadata only), usage attributed to principals,
  approvals listed to the owner or the admins as Sagax decides and a
  console decision resuming the waiting turn once (then 409), and the audit
  with `grant.*`, `org.settings`, `org.link`, `approval.answer` (via
  console) and `person.disabled`, paged.
- `src/lib/open-thread-hash.test.ts`: `#thread=<id>&bot=<id>` parsed, kept
  through the sign-in in sessionStorage (blocked storage never throws), and
  opened only when the viewer's lists hold the thread.

Not decidable from the console (listed with "Open in Sagax" only): skill,
routine, profile, model, team setup, tightening and peer cards, and any card
of a bot on a machine host. Ownership transfer is not in this slice.

### Against a real Perspicax (manual)

Isolated instances as in slice 6. As alice (admin), mona (manager of T) and
bob (employee), open `/console/pulsabot/bots`, `usage`, `approvals` and
`audit` in headless Chrome at 1280 and 390 px:

1. Bots: alice sees every bot with owner, engine, profiles and grants; mona
   only her teams' bots; bob has no Bots page.
2. Usage: turns, model tokens and MCP calls per person, bot and day match
   the Sagax usage page for the same window.
3. Approvals: each person sees only the cards they may answer (decision 5),
   with a link to the thread in Sagax; answering a member bot's server
   command needs an org admin.
4. Audit: Sagax's rights, sharing, ownership and link rows appear beside
   Perspicax's `admin_audit`.
5. Every call from the console goes through Perspicax's proxy (the browser
   never calls Sagax: check the network panel); a replayed assertion is
   refused (401) and an impersonated console session is refused by the
   proxy.

## Slice 8: joining an organization from solo, and cleanup

Spec sections 1 ("Passer de solo à organisation", "Revenir en solo",
"Serveur intérim déjà en organisation"), 2, 8 and 11. One deliberate change
from the spec text: an interim person is attached to a Perspicax person by an
organization admin, never automatically by email (Perspicax lets people edit
their own addresses).

### Automated

```sh
pnpm -s vitest run shared/org-import.test.ts server/people/identity-migration.test.ts \
  server/org/org-export.test.ts server/org/org-import-routes.test.ts server/interim-attach-routes.test.ts \
  server/auth/principals.test.ts server/org/org-routes.test.ts server/perspicax/perspicax-org-routes.test.ts \
  server/org/org-import.e2e.test.ts server/org/org-interim-attach.e2e.test.ts \
  server/auth/member-identity.e2e.test.ts server/org/org-identity.e2e.test.ts \
  src/lib/org-join.test.ts src/components/OrgImportDialog.test.ts
node --test electron/org-join.node-test.mjs
```

- `sagax.org-import` v1 (`shared/org-import.ts`): one entry per backup bot in
  `choices` and `people.bots`, one per room in `people.groups`, one per
  routine in `people.routines`; people only as `pr_<uuid>`; `threads: false`
  means one empty task, `memory: false` means no memory; at most the backup
  limit plus 1 MiB.
- Solo `POST /api/org/export` (operator only: 403 `operator_only`; 404
  `unknown_bot`; 403 `not_your_bot`): only the chosen bots, rooms whose bots
  are all chosen and whose only person is the operator, routines with their
  bot and room; secrets scrubbed and counted; what stays behind is listed
  with local labels in the summary only.
- Organization `POST /api/org/import`: 403 `identity_perspicax` on a solo
  server; 401 `session_required` without a Pulsatrix session (loopback
  included); 403 `forbidden`; 415; 413 `too_large`; 409
  `import_in_progress`; 400 `invalid_document`, `foreign_owner`,
  `foreign_room`, `foreign_routine`; nothing written on a refusal, all or
  nothing (section-channel records included); 201 with the report; one
  `org.import` audit row with counts only. `POST /api/teams/import` on an
  organization server also lands the caller's bots in their private sections.
- Interim attach: `GET /api/org/interim-people` (admin, 403 `forbidden`, 410
  `interim_attach_closed`), `POST /api/org/interim-people/attach` (404
  `unknown_person`, 400 `not_interim`, 400 `bad_target`, 410), the window in
  `GET /api/org` settings and `PATCH /api/org/settings { interimAttachDays }`.
- Email stays solo (decision: "Garder le courriel en solo"): a solo server
  keeps `POST /api/auth/email/start|verify` for its sign-in list, the mailer
  (SMTP, SendGrid, Twilio, Settings > Email saved in `config.json` over the
  `SAGAX_MAIL_*` defaults, `*_FILE` secrets), Settings > People and its invitations (`/api/org/invites*`, the
  `/join` page), issued in the server's own name. Solo `POST`/`PATCH
  /api/org` answer 410 `interim_org_removed`, `GET /api/org` 404
  `no_organization`; an old `config.json` `org` key is ignored. An
  organization server answers 403 `identity_perspicax` on the email and
  invitation routes, sends `GET /join` to `/pair`, sends no sign-in list and
  ends a seeded email session at its first request while a pairing session
  in the same file works.

### Against a real Perspicax (manual, isolated instances only)

Never `~/.sagax`, the live app or a production Perspicax. Build
Perspicax from the current head (`bind = "127.0.0.1:19191"`), start an
organization Sagax on 19192 (`SAGAX_IDENTITY=perspicax`, its own data
directory) and a solo Sagax on 19194 (its own data directory, fake engine).

1. Solo, Settings > Organization: "Join a Perspicax server" only (no create
   form, no people list, no invitation field). Choose bots with and without
   conversations and memory; the preview names what stays behind and how
   many secrets are removed. Download the copy: it has no address and no
   secret (`grep` both).
2. Organization, as an employee: Settings > Organization > "Bring bots from
   a solo Sagax", choose the file, copy. The bots are theirs, private, ask
   before acting, routines paused and run as them; another member sees
   nothing of them (list, by id, live stream). The console's Sagax > Audit
   shows one `org.import` row.
3. The refusals above with curl, and a second import is a second copy.
4. Interim attach: seed an interim person owning a bot and a room in the
   organization data directory before its first start; a person whose
   Perspicax address matches gets nothing when they sign in; an admin
   attaches them from "People from before Perspicax"; closing the window
   gives 410.
5. Solo after restart: the retired routes, the `/pair` page without an email
   field, `pulsa access` exiting 2, an old `config.json` with `mail`,
   `signIn`, `invites` and `org` booting.
6. Leaving: Forget the organization server under Servers; the dialog says
   the copied bots stay in the organization and the local ones are
   unchanged.
