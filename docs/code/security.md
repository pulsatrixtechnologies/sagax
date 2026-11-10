# Security, privacy and sessions

Descriptions of the code: how it works today, its files and its tests.
Moved out of `AGENTS.md` (#3292), which keeps the rules only. When a
description here and a rule in `AGENTS.md` disagree, the rule wins and this
text is fixed. A pointer such as `AGENTS.md, "<section>"` in an older comment
now means the section of that title in one of the files of `docs/code/`.

## Signed bot visits (2026-10-27)

The bot's own browser signs page opens (docs/web-bot-auth.md,
server/auth/web-bot-auth.ts). On unless that person turns it off
(`PUT /api/me/web-bot-auth`, `{ enabled: false }`). Not a login. The
person's attached browser is not signed. One key per person on an
organization server.

## Local access hardened: port of OpenMausBot #2930 (2026-10-19)

Decision: PORT COMPLET of upstream a5f9183bc. Three walls, each with tests:

- **Browsers never get loopback trust** (`server/auth/request-auth.ts`
  `fromBrowser`): a session-less loopback request carrying `Sec-Fetch-Site`,
  `Sec-Fetch-Dest`, or a WebSocket `Origin` gets 401 `BROWSER_SIGN_IN` unless
  it carries the desktop owner header (`x-openmausbot-desktop-owner`, added by
  the app window on http: and ws:). Same rule for the owner view of a
  published page (`loopbackBrowserRefused`). Programs (CLI, curl, MCP proxies,
  the companion relay) are unchanged. `openmausbot serve`/`pair` print a
  `this computer:` sign-in link (`server/cli/cli-pairing.ts`). Dev only:
  `SAGAX_DEV_TRUST_LOCAL_BROWSER=1` (set by `pnpm dev:server` via
  `server/dev-server.ts` and by `scripts/control-omb.ts` fixtures; ignored by
  builds, the desktop app and service trust). Electron: no session but the
  default one reaches the server (`electron/server-session.mjs`).
- **Companion control token**: every route of `127.0.0.1:8811` but the page
  needs `x-openmausbot-control-token`, minted per sidecar launch by
  `electron/companion.mjs` (private port) or printed by a standalone sidecar
  (`/#token=…`).
- **Egress gate for bots' browsers** (`server/browser/egress/`, adapted from
  T3 Code, MIT, NOTICE): one SOCKS5 gate per browser session; never Sagax's
  own ports, metadata (Azure IMDS) or link-local; on a server (organization,
  AKS sandbox) never the private network unless `browserEngine.egress.allow`.
  Meeting browsers keep WebRTC UDP. `agent_browser_read` with `url` refused.
  Refusals are appended to the bot's next browser result.
- Tests: `server/auth/request-auth.e2e.test.ts` (real headless Chrome page cannot
  create a bot), `server/browser/egress/hostile-pages.e2e.test.ts`,
  `companion/test/control.test.ts`. Docs: `docs/self-hosting.md#a-browser-signs-in`,
  `docs/browser-packaging.md#what-a-bots-browser-can-reach`.

## Confidential threads: kept to their owner (2026-10-16)

Decision: a « Fil confidentiel » is a 1:1 bot thread nothing of which is
remembered, exported, logged or shared beyond its owner
(`server/threads/confidential-threads.ts`, full table in
`docs/confidential-threads.md`). Rules, none optional:

- `WireTask.confidential: true`, set at creation (`POST .../tasks`
  `confidential`, else the organization's `confidentialThreadsByDefault`) or
  later (`PATCH .../tasks/:id` `{ confidential: true, confirmConfidential:
  true }`). **Permanent**: `confidential: false` is always 409
  `confidential_permanent`; it is not a `TASK_PATCH_FIELD`
  (`store.makeTaskConfidential` only). Deleting ends it.
- Check it with `store.isConfidentialThread(threadId)`. Every new path that
  writes a thread's words somewhere other people or threads read (memory,
  logs, exports, admin views, notifications, other threads' prompts) must
  check it too.
- Memory: no capture (`memoryUpkeep` hook, `capturable`, `restoreTurn`), no
  daily log line, internal writes refused (`confidentialInternalRefusal`:
  memory, memory/log, group and team memory, rules, docs, skills, routine
  requests, artifacts), Perspicax memory to a team or org refused and to
  `me` only after the owner's Allow (`confidentialPerspicaxRefusal`,
  `confidentialMemoryRequest` card, one-shot `ConfidentialMemoryPasses`).
  `privateRecallFilter` keeps the thread out of every other thread's recall
  on solo and organization servers alike, its owner's included; `list_threads`
  lists it only in itself.
- Exports and admin views: left out of the bot zip, the console file
  browser (`BotFileRoot.hidden`, attachments), the console's organization
  approvals queue, the workspace backup (`confidentialRoster`,
  `stripConfidentialMessages`, `confidentialBackupPath`, and its whole Data
  folder `data-scopes/<bot>/t-<hash>` by `confidentialDataScopePath`, never
  installed by a restore either) and the Perspicax work log. Decision rows are metadata only (`bindConfidentialDecisions`,
  `scrubThreadDecisions`).
- Nothing leaves to another bot, room or channel: `ask-bot`, `delegate-bot`,
  `coordinate-bots`, `post-to-room`, `create-room`, `manage-room`, `act`,
  `create-bot` and `team-setup-requests` (a new bot's soul outlives the thread),
  `start_thread` on another bot and the agent API refuse
  (`CONFIDENTIAL_PEER_REFUSED`); Perspicax outbound calls and every
  `<profile>_write`/`__action` wait for the owner's card with the exact
  arguments (`perspicaxConfidentialVerdict`, fail closed: only known reads
  pass; `outboundCallDigest`); other MCP servers take the same card for
  any non-read tool, whatever the mode (`mcpConfidentialVerdict`,
  `CONFIDENTIAL_GATED_MCP_PATHS`); `act` never names or returns a
  confidential thread (`performBotActRouteOutsideConfidential`); routine
  results, the main thread, Retry thread and `propose_page` skip it; a
  personal memory write has `scope: "me"` written in (`pinPersonalScope`).
  Threads it opens inherit the flag and owner. A turn that names no thread
  never lands in a confidential one (`peerThreadFor`, also `startTurn`'s
  default). AI clients never list, read or write one (`personAgentThreads`).
- Team backup and organization copy leave it out (`team-backup.ts`); every
  import keeps `confidential: true` if it ever arrives. Notifications say
  « Fil confidentiel » only (`notify`, iOS widgets, Live Activities).
  A thread already pinned to a shared folder is not converted
  (`privateFolderThread`, 409 `confidential_shared_folder`); a Cloud home
  guest cannot open one (`CLOUD_GUEST_CONFIDENTIAL`).
- Approvals: `approvalOwnerId(bot, threadId)` is the thread owner for a
  confidential thread; a card they could not answer is refused in the fold
  (`confidentialCardAnswerable`, decision source `confidential`).
- Incidents: `CONFIDENTIAL_INCIDENT_TEXT` only, to the owner, no Primary Bot
  report. `[omb-turn]` logs `text=(confidential)`.
- Browser: a throwaway guest session per thread
  (`confidentialBrowserSessions`), discarded at each turn's end and on delete.
- Place: always the thread owner's environment
  (`sandboxPrincipalForTurn` `confidentialOwnerPrincipalId`) and its own
  folder (`pinTaskCwd` `privateOnly`); no other `cwd` at creation.
- Delete wipes the folder, its own attachments, pending capture, browser and
  decision summaries (`wipeConfidentialThread`).
- Teammate work (`runtime.db`, 2026-10-18): a thread turns confidential only
  when no work it takes part in is live (409 `confidential_live_work`,
  `liveCoordination`); then and at delete `coordinator.forgetThread` removes
  every settled tree it asked and strips its words from its rows in any other
  tree (`RuntimeStore.forgetThread`, decided on columns, `secure_delete`, WAL
  truncated); at start `confidentialThreads` forgets older ones once.
  `roomHandoffProblem` refuses any edge to or from a confidential thread and
  `store.workThread` never reuses a confidential work thread. The workspace
  backup drops those trees (`stripConfidentialRuntime`) and, from the message
  snapshot, its `command_receipts` (`<thread>:` key range), then rebuilds the
  search index and vacuums both copies, also when a deletion left the
  `CONFIDENTIAL_FORGOTTEN_MARKER` note (cleared by that backup).
  `room-handoffs.json.migrated` is never backed up. `deleteThread` drops the
  thread's `command_receipts` too.
- Engine transcripts (2026-10-18, `server/engines/engine-transcripts.ts`): the
  engines' own session files (Claude Code `projects/*.jsonl` and
  `history.jsonl`, Codex rollouts and `state_*.sqlite`, Hermes `state.db`,
  Grok, pi, Cursor, Gemini, Qwen, OpenCode) are found by keys only: the
  thread id (folder-named buckets), its folder's md5/sha256, every session id
  (`TaskRecord.engineSessions`, cursors, event log), widened from the homes
  (`widenKeys`). The workspace backup leaves them out
  (`confidentialEngineKeys`, `confidentialEngineSessionPath`, filtered
  histories, scrubbed database snapshots) and a restore never installs them
  (`withoutConfidentialEngineSessions`). Deletion (`wipeConfidentialThread`,
  bot deletion, Loi 25 erase) and conversion (`forgetThreadEngineSessions`)
  purge them (`purgeEngineSessions`), the latter with
  `store.forgetEngineSessions` (cursors gone, `rewound`: next turn is a new
  session with the transcript replayed); once at start for threads already
  confidential (`confidential-engine-sessions-v1`); held databases retried
  (`confidential-engine-purge.json`). A deleted thread's event and native
  logs are never written again (`forgetThreadLogs`). Never line-filter or
  scrub another session's transcript: only names, prompt histories, logs,
  `logs.json`, chat records by `sessionId` and database id/folder columns.
- Clients: a classification banner top and above the composer (not
  dismissible, height reserved, `role="note"`), lock and « Confidentiel » on
  the row and window title, no off control anywhere (desktop, remote client,
  iOS, iPad).
- Honest limits (docs): the server operator and anyone with disk access,
  backups outside Sagax (Velero, 30 days) and the model provider still get
  the content; a local (solo) Sagax is the recommendation for the most
  sensitive work.
- Tests: `server/threads/confidential-threads.test.ts`,
  `server/threads/confidential-threads.e2e.test.ts` (CT-1 to CT-17),
  `server/engines/engine-transcripts.test.ts`,
  `server/runtime/store.test.ts`, `server/workspace-backup.test.ts`,
  `server/messages/message-db.test.ts`,
  `server/bots/bot-zip.test.ts`, `src/components/ConfidentialBanner.test.ts`,
  `src/components/ChatView.confidential.test.ts`,
  `ios/Tests/CompanionCoreTests/ConfidentialThreadTests.swift`.

## Workspace backup: no secret at all (2026-10-18)

The maintainer, 15:55: « Exclure tout ». A workspace backup (`.sagaxbackup`,
`server/workspace-backup.ts`, also what a cloud move and the desktop's
company backups carry) holds no secret: every rule is in
`server/backup/workspace-backup-policy.ts`, covered by
`workspace-backup-policy.test.ts` and `workspace-backup.test.ts` (one test
fills every location below with obvious fakes and scans every byte of the
decrypted archive, the staging and the restored folder).

- `savedSignInPath` (never exported, never installed by a restore):
  - in an engine home (`principals/<id>/<engine>`, `principals/<id>/<driver>-key`,
    `org/<x>`, `engine-policies/<x>`): `.credentials.json`, `auth.json`,
    `mcp_credentials.json`, `oauth_creds.json`, `.env`, `credentials/`
    (Kimi), `.ssh/`, `.aws/`, `.docker/`, `gh/`, any `.pem`/`.enc`/`.key`
    and the like (`engineCredentialPath`, list in the file), Sagax's
    `.pulsabot-login.json` marker and Claude's `.claude.json.backup*`;
  - anywhere, even a work folder: `.netrc`, `_netrc`, `.git-credentials`,
    `.pypirc`, `.pgpass`, SSH private keys (`credentialFileName`; reconnect
    category `files`); `.npmrc` and `.yarnrc.yml` are copied without their
    tokens (`withoutRegistrySecrets`);
  - every sealed store or key of a person, `principals/<id>/*.enc` and
    `*.key` (`connections.enc`, `credential-vault.enc`, `engine-api-keys.enc`,
    `mcp-oauth.enc`, `cloud-agent-credentials.enc`, any future one);
  - every `*.enc` and `*.key` at ANY depth outside the person's own files
    (`attachments/`, `task-workspaces/`, `workspaces/`, where a `.key` may be
    a Keynote document), with copy suffixes (`.bak`, `.lock`, `.tmp`,
    `.previous`, `.1.tmp`, `~`), at the top of the data folder
    (`marketplace-tokens.enc`, `idp-revocations.enc`, the HMAC keys
    `agent-api.key`, `media-proxy.key`, `published-pages.key`,
    `template-links.key`, any future one) and `push-devices/`.
  A new secret store goes there by name (`.enc` or `.key` already does),
  never in `excludedWorkspaceAuthPath`, which refuses the whole archive.
- Engine settings files (`engineSettingsPath`: `.claude.json`,
  `settings.json`, `config.toml`, `config.yaml`, `models.json`,
  `opencode.json`, the MCP files) are copied by `withoutEngineSecrets`:
  without any key whose name holds a secret word (`secretFieldName`: words
  of the name, so `openai_api_key`, `github_token`, `apiToken`, `GITHUB_PAT`,
  `db_password`, `credentials`, any name ending in `key`: `key`,
  `OPENAI_KEY`; not `api_key_env`, `envKey`, `max_tokens`, `sort_key`),
  without any value shaped like a key (`secretValue`: `sk-`, `ghp_`, JWT,
  `Bearer`, PEM, `user:pass@` URL, also inside `args`), the argument after
  a secret flag (`--token <v>`, `--api-key=<v>`) and without the
  values of every `env` and `headers` map. TOML: dotted keys, inline tables,
  `[x.env.y]` tables, multi-line arrays and strings (small reader in the
  file). YAML: parsed by `yaml` and edited in place (flow maps, block and
  folded values, sequences). A file that does not parse is left out with a
  warning.
- `config.json` keeps only `PORTABLE_CONFIG_KEYS` (none holds a secret);
  `webhooks.json` loses `secretHash`, `pendingToken`, `signingSecret`,
  `graphSubscription`; a `*_FILE` variable's file inside the data folder (the
  Perspicax link file) is never exported and stays in place.
- The destination keeps its own: top-level ones stay in place
  (`destinationSignInFile`, `keptInPlace`; a missing HMAC key is made again
  at start, so old shared links change only on another machine), and
  `carryDestinationSecrets` puts the destination's own secrets back into
  the restored tree, only under `org/`, `engine-policies/` and
  `principals/<id>/` when the archive's principals.json names the same
  person behind that id (subject, else local operator, else email;
  `samePrincipals`), never elsewhere
  (and the Claude sign-in fields into a restored `.claude.json`).
- An older archive that holds them still restores: `withoutEngineCredentials`
  drops them at staging (manifest recounted, warnings) and `prepareRestore`
  never installs them.
- The summary's `reconnect` (`ReconnectTally`, shared
  `WORKSPACE_BACKUP_RECONNECT`) counts by category what the source held:
  engines (per engine home, with people), provider keys, connections,
  credential vault, MCP, GitHub, cloud agents, triggers, phones, shared
  links, engine settings. Counts only, never a name or a value. The restore
  preview and Settings > Backups after the restore (`GET
  /api/workspace-backup/status` `lastRestoreReconnect`) show it
  (`WorkspaceBackupReconnectList`, keys `backup.reconnect.*`).
- A bot export (`server/bots/bot-zip.ts` walkFiles) leaves out the same sign-in
  files, `.enc`, `.pem`, `.p12`, `.pfx`, a `.key` that is not a Keynote zip,
  `.env` (not its templates), `.ssh/`, `.aws/`, `.docker/` and an `.npmrc`
  with a token (`exportedSecretFile`).
- `comms-tokens/` and an engine home's `tmp/`, `.tmp/`, `.cache/`,
  `Library/Caches/` (`disposableEngineHomePath`) are never exported.
- Not covered: secrets a person typed into a conversation, a note or a
  project file (the export warns), and secrets in engine transcripts.

## Misuse guardrails (2026-10-12)

End users must not use a bot for privilege escalation, escape from the
server environment, tampering with antivirus or logs, attacks on third
parties, malware, reading the platform's files (`bots.json`, `messages.db`,
`idp_key`, and the rest), destruction of the server, or resource abuse.
Defensive security work (EDR triage and the like) is the permission
`security.triage` in Perspicax. It allows that work only. It does not lift
a block. Details, the flag, and the French refusals:
[`docs/security/misuse-guardrails.md`](docs/security/misuse-guardrails.md).

- `SAGAX_MISUSE_GUARDRAILS` is `off`, `shadow`, or `enforce`. The default is
  `shadow`: classify and write `misuse.shadow` (category `security` on the
  admin activity log), refuse nothing. `enforce` refuses, alerts tenant
  admins (`admin-action`, admins only), and locks a principal after 5
  attempts in 10 minutes (15 minutes, 429 `misuse_locked`).
- The prompt section `misuse-policy` is first in `buildSystemPrompt`, ahead
  of the persona and the soul, and it is not a control. The server
  classifies messages, shell, file, the shared-computer terminal,
  `flow_action`, and MCP. The MCP gate subprocess blocks hard categories
  only, and only in enforce mode.
- The container limits, the metadata deny `169.254.0.0/16`, and the masked
  host `/proc` entries stay on regardless of the flag. The path allowlist
  follows the flag.
- What a person reads is Québec French, with no anglicism. Tests:
  `shared/misuse-guardrails.test.ts`, `server/safety/misuse-guardrails.test.ts`.
- Safety review uses the same flag. Shadow writes `safety.shadow` and
  changes nothing. Enforce reviews shell, MCP, computer use, and routine
  writes before they run: a hard block stays a 403 refusal, never a card
  Full or Auto can accept; a risky call gets a safer path once, then a
  native approval card the person accepts; denial and expiry are final for
  that fingerprint, and for a destructive git intent, a prompt disclosure,
  or a credential grab across rewording. Reads are auto-approved. Writes
  and unknown tools wait. Outbound mail is a draft, then the existing send
  card. Tool results, pages, files, and other bots' messages are wrapped
  as `<<<UNTRUSTED>>>` and are not instructions. `security.triage` still
  covers defensive work only. The tool guard (`SAGAX_TOOL_GUARD`) and the
  agent card guard are unchanged. Tests: `shared/safety-review.test.ts`,
  `server/safety/safety-review.test.ts`.

## Never signed out by a deploy (2026-10-20)

the rule: a person is signed out only when their session is revoked, their
account disabled, or after 30 days without use (`SESSION_TTL_MS`). Never by
a Sagax or Perspicax deploy or restart, an app update, a failed refresh or a
sensitive action. Keep these, each covered by a test:

- Every 401 for a presented credential has a `code`
  (`shared/session-refusal.ts`): `session_unknown` (the only retryable one),
  `session_revoked`, `session_expired`, `idp_session_ended`,
  `principal_disabled`, `session_cookie_only`, `sign_in_required`. Ended
  sessions are remembered by token hash in `sessions.json` (`ended`, 35 days,
  2,000 entries; `SessionRegistry.explainRefusal`). Each refusal and each
  session the server ends is one `auth: session refused|ended` line
  (`server/auth/auth-refusal-log.ts`: code, route without query, via, client
  family, session id prefix; never a token, hash or cookie; repeats once a
  minute).
- `server/auth/idp-session.ts`: a refresh is marked in the vault before it is
  sent (`refreshStartedAt`) and resumed at boot (`resumeInterrupted`); the
  rotated token is written first and kept in memory if the write fails; the
  vault is re-read before a refresh and before each write (a deploy's two
  processes). `invalid_grant` is asked again after 2 s with the newest token
  before it ends that sign-in; the person is marked out (all sessions,
  `disabledAt`) only when a second sign-in of theirs is refused too, or when
  they have no other sign-in to ask. The vault is written under an O_EXCL
  lock, refresh paths only `update` a grant still present (never bring back
  a removed one), and a file that cannot be read is never written over.
  `invalid_client` and the like are a deploy for 15 minutes, then end the
  sign-in; an ignored id_token keeps the 24 h clock running. Transient failures retry at 5 s
  and 15 s (inside Perspicax's 30 s reuse grace), then each minute; 24 hours
  of observed failures answer 503 `idp_unreachable`, never a sign-out.
  `server/auth/oidc-rp.ts`: only `invalid_grant` is a refusal; `invalid_client`
  and the like, a 200 that is not a token answer, and an id_token that does
  not verify (except another subject) are not.
- The Perspicax directory puts a missing person out only when two answers a
  minute apart miss them (`DIRECTORY_ABSENT_CONFIRM_MS`); `disabled` at once.
- Clients: `resolveSessionState` (`src/lib/session.ts`, used by
  `src/main.tsx`) retries 503, 5xx and network errors with backoff and shows
  the sign-in screen only for a definitive code or after three
  `session_unknown`. The desktop bridge and computer sharing back off to 10
  minutes on 401/403 (`electron/auth-backoff.mjs`). The cookie jar is flushed
  before a quit and an update (`electron/session-persistence.mjs`); the
  startup eviction empties the HTTP cache only.
- Tests: `server/no-logout.e2e.test.ts` ("redéploiement Sagax",
  "redéploiement Perspicax", "mise à jour de l'app", "jeton expiré ->
  rafraîchi en silence", "révocation -> déconnexion", "action sensible ->
  confirmation ponctuelle sans déconnexion"), `server/deploy-bench.e2e.test.ts`
  and the bench `node --experimental-strip-types
  scripts/bench-deploy-no-logout.ts [people] [sessions]`,
  `electron/session-persistence.node-test.mjs`,
  `electron/auth-backoff.node-test.mjs`. The fake Perspicax
  (`server/testing/fake-oidc-provider.ts`) has `reuseGraceMs`,
  `dropNextRefreshAnswer`, `delayNextRefreshAnswer`, `stop` and `start`.

## Media proxy destinations (2026-10-14)

`GET /api/media/proxy/<token>` fetches a URL a bot gave, so it only reaches
public destinations (`server/media/media-proxy-guard.ts`, `docs/media-proxy.md`).
Keep these rules:

- Loopback, unspecified, link-local, cloud metadata (169.254.169.254,
  168.63.129.16, fd00:ec2::254), RFC 1918, CGNAT/Tailscale 100.64.0.0/10,
  ULA, multicast, reserved ranges and IPv4 inside IPv6 are refused, ports
  other than 80/443 too. The check runs on every resolved address
  (`checkMediaDestination`), the socket connects to the checked address
  (`lookup` hook in `requestCheckedUpstream`, own keep-alive agents), and
  redirects are followed by hand (5 max) with the same check per hop.
- `SAGAX_MEDIA_PROXY_ALLOW_HOSTS` (empty by default): host names, `*.suffix`,
  IPs or CIDRs the operator allows (any port). A name never opens a metadata
  address.
- `rewriteHlsPlaylist` leaves a non-public literal host unproxied unless
  allowed (`mediaUrlMayBeProxied`); other origins stay untouched.
- A refusal answers a generic 403 and logs reason and host only
  (`logMediaProxyRefusal`), never the token, path or query.
- Tests that proxy a local upstream allow `127.0.0.1` explicitly (policy
  option or `vi.stubEnv`). Tests: `server/media/media-proxy-guard.test.ts`.

## No phone-home

Sagax contacts no service of the original OpenMausBot project and sends no
telemetry. Keep these rules, each covered by a test:

- Updates come only from our GitHub releases: `electron/update-feed.mjs` pins
  electron-updater to `pulsatrixtechnologies/sagax` (channel latest,
  pre-releases opt-in in Settings > General). Tests:
  `electron/update-feed.node-test.mjs`, `electron/updater.test.mjs`.
- No analytics: `src/lib/analytics.ts` is a no-op and `posthog-js` is gone.
- `electron/upstream-hosts.mjs` is the block list (every `openmausbot.*`
  domain, `posthog.com`, the upstream author's GitHub). Main guards its fetch
  and every Electron session; the server imports `server/safety/network-guard.ts`
  first. Upstream defaults stay empty: Cloud (`CLOUD_ORIGIN`, bridges behind
  `--sagax-cloud`), control plane (`SAGAX_CONTROL_PLANE_URL` of ours only),
  Admin portal, Pro link, team catalog (`SAGAX_TEAM_LIBRARY_URL`).
- `pnpm check:no-phone-home` (run by `package:prepare` and
  `electron/no-phone-home.node-test.mjs`) fails when a bundle names a blocked
  host outside its reviewed allowlist; `server/phone/no-phone-home.e2e.test.ts`
  audits a server start and a chat turn.

## Sensitive fields masked from the bot (2026-10-26)

A sensitive field's value never reaches a model, whoever typed it: the
person during a takeover, the bot, the site or the vault. One rule,
`shared/sensitive-fields.ts`: `input type=password`; an input, textarea or
select whose `autocomplete` has `current-password`, `new-password`,
`one-time-code` or any `cc-*` token; any element marked `data-sensitive`
(any value but `"false"`, which never makes a password ordinary); and a
field already seen sensitive (`data-sagax-sensitive`, so a "show password"
toggle keeps it hidden). Teach by demonstration uses the same rule
(`isSecretField`). `server/browser/browser-runtime.ts` reads what those fields hold
(`SENSITIVE_VALUES_SCRIPT`, in the page, its open shadow roots and
same-origin frames) after every tool whose answer can carry page text
(snapshot, read, get_text, eval, open and any unknown tool; not
`NO_PAGE_TEXT_TOOLS`), and in the page observation a click, fill or type
already makes (`withSensitiveValues`, no extra call); the values go to
`SecretRedactor.rememberSensitive`, which replaces them in every later
result with `[sensitive field]` (8 characters or more: with their pieces;
shorter: whole, for 5 minutes after last seen). A screenshot is taken with
those fields drawn as discs (`MASK_SENSITIVE_SCRIPT`, a style and
`data-sagax-masked`), then the page is put back (`UNMASK_SENSITIVE_SCRIPT`).
Nothing writes a field's value: the page and its forms keep the real one.
Out of reach: a cross-origin frame (a payment widget's own frame), pixels
of a desktop computer, and the live view and preview frames, which only the
person sees. Tests: `shared/sensitive-fields.test.ts`,
`server/browser/browser-runtime.sensitive.test.ts`.

## Credential vault and secure form fill (2026-10-16)

Settings > Credentials (`src/components/settings/CredentialsSettings.tsx`)
keeps a person's logins (user name, password, one-time code seed), API keys,
notes, cards, addresses and contacts, each bound to sites, with the bots
allowed to use it and when one last did. Storage is
`server/vault/credential-vault.ts`: one AES-256-GCM file per owner
(`credential-vault.enc`), key derived by HKDF from the vault key of
`mcp-oauth.enc` (desktop: OS keychain via safeStorage, `SAGAX_MCP_OAUTH_KEY`;
server: 0600 key file). Layout: solo or desktop at the data root; a person on
an organization server under `principals/<pid>/`; a team bot's shared vault
under `bots/<botId>/` (principal `bot:<botId>`, AAD-bound so a copy under
another bot does not open). Managers of that bot (owner, manage grant, org
admin) CRUD via `POST/PATCH/DELETE /api/bots/:id/credentials*`
(`server/routes/team-bot-vault.ts`, Edit bot > Details > Shared vault;
iOS bot panel > Permissions > Shared vault). A file that does not open is
never overwritten. Never a plaintext store. Filled values are remembered only
in process memory for redaction (`server/vault/filled-secret-guard.ts`) and never
enter transcripts, memory, logs or tool results. Fills happen in the bot's
browser only; the computer surface has no fill tool. A team bot's login is
allowed by a card to the bot's owner (once, or always for that bot), never
set at creation.

A bot never gets a value. `request_login` (agents tool) returns a handle
(`cred_<id>`) when the bot is already allowed, else posts a `kind: "secret"`
card with `target: "vaultLogin"` (`src/components/VaultRequestCard.tsx`)
where the person picks or saves a login and allows it this time (the
conversation, 15 minutes) or always for that bot; the bot resumes with the
handle (`server/routes/credential-vault.ts`, `grantedNote`). The browser's
harness tool `fill_credential` (`server/vault/credential-fill.ts`, run by
`server/browser/browser-runtime.ts`) holds the session alone (`holdExclusive`: other
agent actions are refused, running ones drain), reads the page's URL through
the engine (`agent_browser_get_url`, `location.href`), focuses the ref,
probes with a script that has no secret (origin guard first; top frame; a
fillable input of the top document; a password only into `type=password`;
where the form posts) and marks the target with a one-time attribute, asks
the vault (grant and site check on that URL), then writes with a strict-mode
script (origin guard first, marked element, focused) sent as
`agent_browser_eval`, which agent-browser passes over stdin: never
`agent_browser_fill`, whose text lands on a command line. Sites are exact by
default; `*.example.com` opts into subdomains, `example.com:8443` a port,
`http://localhost:3000` the only plain http. Every later browser result of
that session is redacted (value, encodings, user:pass in base64), script
tools are refused in the whole browser while the bot holds a grant and,
after any fill, for every bot until a restart; a bot's eval carries an
origin guard; a fill refuses on an origin where a script ran in that browser
session, and screenshots and preview frames are refused after a fill. While
a grant is held or after a fill, selector-taking tools accept only `@eN`
refs (`cssSelectorArgument`: no CSS value oracle). The write runs with the
engine's live stream paused (`pauseBrowserStream`; the Browser panel picks
the stream up again, never while `filling`). Raw engine answers are redacted
before shaping and trimming; after a fill, keyboard tools refuse a filled
target or focus (`data-sagax-filled`) or typed text with a control
character, a GET form (`formPostsOnly`) is never filled, URL and form
encodings of a secret and their pieces are redacted, the current contents of filled
fields are redacted too (`refreshFilledValues`), and every screenshot is
refused. On a headless server the vault
routes need a paired session (or `SAGAX_CREDENTIAL_VAULT_LOOPBACK=1`). The
`op` CLI runs only from `/opt/homebrew/bin/op`, `/usr/local/bin/op` or
`/usr/bin/op`, with no folder above it writable by others, located again
before each run, satisfying the AgileBits code requirement on macOS, with a
short environment.
One-time codes are computed at fill time (`server/auth/totp.ts`).

Logins that fill where you'd expect (2026-10-19, port of OpenMausBot #2929,
#2725/#2726 and the sign-in request of #2707, on this vault: no second login
store). `fill_credential` with `field: "login"` (`server/login-fill.ts`, the
loop in `BrowserRuntime.loginHeld`) signs in in one call: it reads what the
page asks for with a script that carries no secret (`loginStateScript`),
fills each field of the step through the same single-field path
(`fillOne`: origin guard, top frame, POST on the page's origin, the vault's
grant and site check on the engine's URL, the stdin write, the redactor),
submits once (`submitScript`: the form's `requestSubmit` with its submit
button, else a sign-in button around the field), waits for the page
(`settleAfterSubmit`) and fills the next step (user name, Next, password,
one-time code; at most `MAX_LOGIN_STEPS`). A password or code asked again,
or left in place by an inline error, is a refusal: the filled password and
code are emptied (`clearScript`) and nothing is sent twice. A visible
CAPTCHA stops before the submit; `submit: false` only fills. Sites stay
exact by default (stricter than upstream's whole-registrable-site rule):
when a fill lands on another address, the refusal names the page's host and
tells the bot to call `request_login` with it; the card then offers logins
of the same site (`matchingItems`, `vaultSiteOf`: last two labels, a
country's shared second level, a short list of shared hosting names) and,
for a login of that same site only, "Also fill it on <site>", unticked
(`addSite` on the grant route, with Always only; the server checks
`siteAddable` itself: an exact host of the login's own site, never a
wildcard, a shared hosting name or a look-alike; audited as `addedSite:
true` with no site name). The card also lets the person sign in themselves
in the bot's browser: `self-start` arms that browser first
(`BrowserRuntime.armForPerson`: refused where a bot ran a script in it,
then scripts, screenshots, preview frames and CSS selectors are off until a
restart; until Done the sign-in under way survives any restart or close,
`forgetSession` arms the new browser again and the bot's `restart_browser`
is refused; it ends at Done, on a grant or a decline from the card, when a
newer card replaces it, or after `PERSON_SIGN_IN_MS`, 30 minutes; meanwhile
PATCH /api/bots/:id refuses a browser profile change,
`browserProfileChangeRefusal`; the card polls `self-status` and says "Not
protected any more" once the browser is no longer armed, also after a
restart of Sagax), and Done (`signed-in`, 409 `not_armed` when the browser
was not armed) empties its password and code fields
(`clearAfterPerson`; refused while the person still holds the browser),
resumes the bot (`signedInNote`: no handle, no value), then marks the card
and writes `credentials.signed_in` (no site). The submit checks again, in
its own evaluation, that the form posts on the page's origin; any exit of a
sign-in that is not a finished step empties what it typed; the page's alert
reaches the bot only quoted as untrusted page text (`pageSays`). 1Password stays per item (a reference with its own bot
grants, read at fill time, never on an organization server): finer than
upstream's per-vault grants. Tests: `server/login-fill.test.ts` (happy-dom
page behind a fake engine: one, two and three steps, refusals, CAPTCHA),
`server/login-fill.e2e.test.ts` (a local fake site in a throwaway headless
Chromium from Playwright's cache, skipped without it: one and two steps, a
refused login, another site; what the bot sees and what the process prints
hold no value nor encoding), the card blocks of
`server/routes/credential-vault.test.ts` and
`src/components/VaultRequestCard.test.ts`, and the data-folder sweep of
`server/vault/credential-vault.e2e.test.ts`.

Reads of the vault are POSTs (`/api/me/credentials/list`, `/notes`, the
1Password picker): a packaged desktop answers loopback GETs from any local
process. The agent tool policy keeps `/api/me/credentials*` and
`vault-cards` admin and off. 1Password (`server/onepassword.ts`) is optional
and read-only: Connect (`OP_CONNECT_HOST`, `OP_CONNECT_TOKEN`) or the `op`
CLI with the desktop app integration or a service account, never on an
organization server; a picked item is a reference read at fill time. Tests:
`server/vault/credential-vault.test.ts`, `server/vault/credential-fill.test.ts` (a
happy-dom page behind a fake engine), `server/routes/credential-vault.test.ts`,
`server/onepassword.test.ts`, `server/auth/totp.test.ts`,
`src/components/VaultRequestCard.test.ts`.

Import and Export (2026-10-18), two buttons in the vault's card
(`src/components/settings/CredentialsTransfer.tsx`, parsers and writers in
`shared/credential-vault-transfer.ts`, fake files per format in
`shared/fixtures/credential-vault-import/`). Import reads Bitwarden
(unencrypted JSON, CSV), LastPass, Apple Passwords, 1Password (CSV, 1PUX),
Chrome/Edge/Brave, Firefox and a generic CSV, detected from the bytes and
the header, in memory only: the file is never copied nor sent; only the
parsed items go to `POST /api/me/credentials/import`, which plans again
against the saved items (`planVaultImport`: a login matches by site and user
name, an API key by site and name, a note by name; merge or leave as is; a
1Password item is never merged, and an item a bot is allowed to use never
gains a site from a file) and writes once. Sites come from the URLs (host
and port; http becomes the https site, except localhost; `*.host` its exact
host; an IP, an app link or a URL with a user name gives none, and a login
with no site is left out). What the vault cannot keep (cards, identities, attachments,
custom fields, passkeys, a seed it cannot read) is counted in the preview,
never invented. Export writes Chrome CSV (logins only, first site, no
codes; the server sends nothing else for it), Bitwarden CSV or Bitwarden
JSON (both round-trip notes, API keys as a login with `sagax_kind: apiKey`,
and seeds); 1Password references are left out; a name or a note that would
run as a spreadsheet formula gets a leading apostrophe. `POST
/api/me/credentials/export` needs `acknowledge: "plaintext"` and
`exportGate`: a person (`credentialVaultPersonRefusal`: no ephemeral, act or
actAs session, no chat-only device without a person, no local service),
their security key whenever they have one (`credentials.export` step-up,
class-free; off an organization server the vault owner's key), else a
sign-in younger than 15 minutes; the desktop's own person counts, a
headless server's loopback never does. Import refuses the same callers. The
1PUX reader inflates chunk by chunk and stops past the limit or a ratio of
200. Both routes write an admin-activity row (category security)
with counts only. No organization policy blocks an export yet; iOS has no
vault. Tests: `shared/credential-vault-transfer.test.ts`, the import and
export blocks of `server/vault/credential-vault.test.ts` and
`server/routes/credential-vault.test.ts`,
`src/components/settings/CredentialsTransfer.test.ts`, and
`server/vault/credential-vault-transfer.e2e.test.ts` (a real desktop-mode server:
the launcher forwards a throwaway `SAGAX_MCP_OAUTH_KEY` and sends the owner
capability on its own starter rename).

## API keys Sagax sends itself, command variables (2026-10-26)

An API key of the vault can be sent by Sagax on a bot's request: the item's
`injection` (Bearer, named header, Basic, query parameter, optional base path)
and its Sites are the binding; the bot calls `vault_http_request` (listed only
with `SAGAX_VAULT_HTTP=1`, `CredentialVault.injectable`) with the handle and
never sees the key. `server/vault/credential-http.ts`: https only, public addresses
only (`addressClass`, pinned connection), same-origin redirects only, 30 s,
1 MB, every echo of the key and its encodings removed from body, headers and
errors; audit has host, method, status only. `commandVariable` (off by
default, the person's choice, one line on the row, no admin) exposes the key
to the allowed bots' commands: sandbox `run_command` via
`withCommandVariables`; every engine's own shell via
`SendTurnInput.commandEnvironment` (Claude, ACP core and Pi in the process
env, never an engine's own credential name: `engineCommandVariables`; Codex
in the thread's `shell_environment_policy.set`, names only in the native
log); `vm_exec` on stdin (`commandVariablesScript`); the desktop bridge's
`run_command`/`vm_run_command` `env`. Not the cloud computer's `exec`.
Do not log a resolved value; do not touch `server/vault/credential-fill.ts` for it.
Doc: `docs/api-key-injection.md`. Tests: `server/vault/credential-http.test.ts`,
`server/vault/credential-command-env.test.ts`.

## Content encryption at rest (2026-10-26)

Transcripts in `messages.db` are sealed (AES-256-GCM, additional data =
key, owner, thread, message id) under a content key per person (the
workspace's for rooms and unowned threads) and a key of its own per
confidential thread, wrapped by the local vault key (keychain on the
desktop, 0600 file on a server) or Azure Key Vault
(`SAGAX_CONTENT_KEY_PROVIDER=azure-keyvault`). On by default;
`SAGAX_CONTENT_ENCRYPTION=off` opens everything back to plain in the
background. Rows of both kinds read everywhere; never read `messages.text`
or `json` raw for content in new code: go through `server/messages/message-db.ts`
(a sealed row's `json` is only a projection). Search and recall use a blind
index (keyed Bloom filters, keyed words in a contentless FTS5 table). A
person's erasure (`eraseContentOwner`) and a confidential thread's deletion
destroy their keys. The workspace backup exports transcripts in the clear
inside its password-encrypted archive. Tests run with it off unless they
turn it on (`server/testing/setup.ts`); its own:
`server/content-encryption.test.ts`. Benchmark:
`scripts/bench-content-encryption.ts`. See `docs/content-encryption.md`.

Files and logs (2026-10-27, same keys, `server/encryption/content-at-rest.ts`,
`server/encryption/content-file-crypto.ts`): bot memory files (`workspaces/<bot>/`
MEMORY.md, memory/, docs/), the `memory_files` index (blind index like
the transcripts), group memory, everything under `attachments/` (uploads,
generated files, scaled pictures, Office pictures, archive manifests and
unpacked folders) are sealed in place (64 KiB AES-256-GCM chunks, additional
data = key, owner, context, chunk index, last chunk); the memory journal,
`events/`, `native/`, `decisions/` and `admin-activity/` are sealed line by
line in blocks (one physical line per record, a block opened once;
clear projection for filters). New files are written plain as before
and sealed by the background migration once idle (10 min); every
replacement is read back and compared before an atomic rename. Never read
such a file with `readFileSync` for content in new code: use
`readAtRestSync`, `readMemoryText`, `atRestStream` / `openMessageFile`'s
`stream()`, and for a log `LogReader` (a writer seals with `sealLogLines`
and appends at once: every line on disk when the append returns). An engine reads them by path: they are held plain in
place off the turn's path, from the composer's warm request (`holdPlain`,
`holdBotMemoryPlain`, released with `releasePlain(turn:<thread>)`). A thread
or bot that changes hands goes through `contentOwnerChanged`, which
re-seals everything of it at once. A locked key throws
`ContentKeyUnavailable`; a memory read never answers empty on it
(`isAtRestRefusal`). Tests: `server/encryption/content-at-rest.test.ts`. Benchmark:
`scripts/bench-content-at-rest.ts [--before <checkout of main>]`.
