# Security Policy

## Supported versions

Only the latest Sagax release receives security fixes. Releases are tagged
`pulsa-vX.Y.Z` on
[pulsatrixtechnologies/sagax](https://github.com/pulsatrixtechnologies/sagax/releases),
and the desktop app updates from that feed only. If you can reproduce a problem
on the latest release, report it. If you can only reproduce it on an older
release, update first.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

- **Preferred:** open a private security advisory on this repository (Security
  tab, "Report a vulnerability"):
  <https://github.com/pulsatrixtechnologies/sagax/security/advisories/new>. The
  report stays visible only to you and the maintainers until a fix is published.
- **Or email** **hello+security@pulsatrix.ca** with the details: version, platform,
  what you did, what happened, and what you expected.

What to expect:

- An acknowledgement within 3 business days.
- A first assessment (accepted, needs more information, or not a vulnerability)
  within 10 business days.
- Updates as the fix progresses. We aim to ship a fix for a confirmed
  vulnerability in the next release, sooner when it is severe.

## Coordinated disclosure

Give us a reasonable time to fix the problem before you publish anything. We
ask for up to 90 days from your report, and will tell you if we need more. When
a fix ships we publish an advisory, and we credit you unless you prefer to stay
anonymous. Test only against your own installation and your own data, never
against someone else's server or account.

## What counts

A vulnerability is a way to break one of these guarantees in the current
release.

- **Desktop app and local server.** The harness server binds **127.0.0.1
  only**. Packaged builds allow anonymous loopback reads, but public mutations
  require either the desktop's private per-launch capability or a paired
  session; built-in agent integrations use narrower per-turn capabilities.
  Anything that makes it reachable from off-machine without a paired session,
  lets one bot reuse another turn's capability, or lets a local unprivileged
  other user drive it is a vulnerability.
- **Hosted or shared workspaces.** On a hosted or shared workspace (service
  loopback trust, see `docs/self-hosting.md`) a session-less loopback caller,
  which includes every bot's shell, may use only the routes in `SERVICE_ALLOW`
  (`server/auth/request-auth.ts`): health, who-am-I, edition, brand, and the bots'
  capability routes. The worker data plane (the bot list, messages,
  attachments, new threads, the guarded send, the request fence, a queued
  line, a card decline) answers only when the request also presents the
  worker relay token (`SAGAX_WORKER_RELAY_TOKEN`, header
  `x-sagax-worker-relay`). The server reads that value once at start and
  removes it from its environment, so a bot's shell does not inherit it. No
  API returns the token and no log line contains it. Reaching an admin route,
  or using the worker routes without that token, is a vulnerability. The
  hosted worker that delivers chat messages lives in a separate service and
  must send the same header in the same change window. Until both sides
  carry the token, those routes stay closed.
- **Organization mode with Perspicax.** Sign-in, roles, and admin scope on an
  organization server; one person reading or acting on another person's bots,
  threads, credentials or private threads; a routine that does not act in its
  owner's name; any path around the organization's approval and Full access
  settings.
- **Desktop bridge.** The bridge that lets an organization server act on a
  person's own computer: pairing, per-bot "This computer" consent, and any way
  to drive a desktop without the person's opt-in and approval.
- **Engines and tool scopes.** The permission broker is the consent layer for
  risky actions in every engine (Claude Code, Codex, Grok, Cursor, OpenCode,
  ACP and OpenAI-compatible engines). Bypasses of the broker (approving without
  a user decision, spoofing the broker socket) are vulnerabilities unless that
  bot is explicitly set to **Full access**. Full access is a standing user
  decision to approve provider permission requests; it must never answer
  questions or silently broaden product-level confirmations such as
  credentials, routines, skills, or peer communication. A tool that reaches
  beyond the scope its bot was given is also in scope.
- **Webhooks.** Routine webhooks are authenticated with bearer tokens. A way to
  trigger a routine without a valid token, to read or guess a token, or to
  make a token work for another routine is a vulnerability.
- **Read receipts and presence.** Presence and read state are per-person
  settings. Showing them to people who should not see them, or ignoring a
  person's choice to hide them, is a privacy vulnerability.
- **Secrets.** API keys live in `~/.sagax/config.json` and are write-only
  through the API (`configured` booleans out, never values). Any path that
  echoes a stored secret back (API response, SSE event, log line, argv visible
  in `ps`) is a vulnerability.
- **Credential vault.** A person's logins, API keys and notes
  (`server/credential-vault.ts`) are encrypted at rest with a key derived
  from the server's vault key (the OS keychain through Electron safeStorage
  on the desktop, a 0600 key file on a server), one file per person, bound to
  that person. A bot only ever holds an opaque handle: `fill_credential`
  (`server/credential-fill.ts`) holds the bot's browser session alone (every
  other action of any bot on that session is refused until it ends), reads
  the page's address through the engine (`location.href`, which a page
  cannot redefine, never a value a page script reports), and types the
  value only for a granted bot (once: that conversation for 15 minutes;
  always: until revoked), only when that address matches one of the item's
  sites, into an input of the top document marked by a one-time attribute
  and holding the focus, never into a frame, never into a form that posts to
  another origin. The value is typed by a strict-mode script whose first
  statement checks the top frame and the origin before it names the value;
  the engine receives that script over stdin (agent-browser's eval), never
  on a command line, so no process list shows it. Sites are exact by default (host,
  https, port); subdomains only through an explicit `*.example.com`, refused
  on a shared suffix such as `co.uk`; plain http only for an explicit
  `http://localhost:<port>`. While a bot may use a login, its own page
  scripts (eval and any script or frame tool) are refused in its whole
  browser; once a value was filled in a browser session, every bot's
  scripts are refused in it until a restart; a fill is refused on an origin
  where any bot ran a script in that browser session until a restart; a
  bot's script carries an origin guard in the same evaluation; screenshots
  are refused on a filled site, and no preview or settled frame of that
  browser is captured until a restart. While a login is allowed or after a
  fill, elements are addressed only by accessibility refs (`@eN`), never by a
  CSS selector, in every selector-taking tool including `fill_credential`'s
  target: a selector such as `[value^="a"]` would otherwise read, one
  character at a time, a value a framework mirrored into the `value`
  attribute. The engine's live stream (which sends each command, script
  included, to its clients) is paused around the write; if it cannot be
  paused, nothing is typed. Every later browser result is redacted (the value and its common
  encodings, and user:pass pairs in base64; every piece of six characters
  or more of a secret; whatever the filled fields hold now, edited or
  revealed; a value shorter than four characters as a whole word; the length
  of a masked password; every URL and form encoding of a secret,
  `application/x-www-form-urlencoded` and strict RFC 3986 with upper and
  lower case hex, and its pieces of six characters or more; a user name
  whatever its case, though only whole: its pieces would hide ordinary
  words and domains). A fill is refused into a form that any of its buttons
  can send with GET (the value would land in the URL); a field outside any
  form is filled, and a page script that sends it in a URL is then met by
  the encoded-value redaction above. The engine's raw answer is redacted before any
  trimming or shaping, so a cut through a value never leaves its prefix.
  After a fill, typed text with Tab, Enter or any other control character
  is refused (the engine presses each as a key, which could move the focus
  into the filled field mid-call), and keys and typing are refused when the target or the focused
  element is a filled field (the field also loses focus and gets
  `autocomplete="off"`), and every screenshot is refused until a restart. The
  Browser panel does not turn the engine's stream back on while a fill holds
  the session. Chromium's own password saving is not turned off at launch
  (agent-browser exposes no launch option for it here); headless Chrome
  shows no save prompt, but a persistent profile could keep form data. The vault routes answer the
  desktop's own app, a paired session, or on a headless server a loopback
  caller only when the operator sets `SAGAX_CREDENTIAL_VAULT_LOOPBACK=1`;
  reads are POSTs. The optional 1Password CLI runs only from a fixed install
  path where neither the file nor any folder above it can be written by
  others, checked again before every run, satisfying on macOS the code
  requirement `anchor apple generic and certificate leaf[subject.OU] =
  "2BUA8C4S2C" and identifier "com.1password.op"`, with a short environment
  with no Sagax or provider key. Any way for a bot,
  an AI client or another person to read a value back (a tool result, an SSE
  event, a transcript, a log, a loopback request), to fill it on another
  origin, in a frame or into a cross-origin form, or to grant itself an
  item, is a vulnerability. Known limits, not vulnerabilities: a script of
  the bound site itself can read what was typed into its own form; a user
  name or a one-time code can appear in a page read before it is redacted
  on another site; on an organization server bots keep their browser
  session (cookies) across the people they work for; a process running as
  the same operating-system user (a bot's shell on the desktop, an engine on
  Full access) can reach the agent-browser daemon's socket and Chrome's
  DevTools port directly, and so the pages and what was typed into them:
  the vault's guarantees are against the model and its tools, not against
  code already running as that user.
- **Process spawning.** Spawning must never route user-influenced strings
  through a shell. Report any `shell: true` or `cmd.exe` string-building you
  find.

## Out of scope

- **The upstream project.** Sagax is based on OpenMausBot. Problems that exist
  only in the original project's code or its hosted services are not Sagax
  vulnerabilities; report them to that project separately. Sagax does not
  contact the original project's services. If you are not sure which side a
  problem is on, report it to us and we will route it.
- Third-party engines, providers and CLIs themselves (report to their vendors).
- Findings that need an already-compromised machine, an administrator who
  chooses to weaken a setting, or a bot explicitly set to Full access acting
  within what Full access allows.
- Denial of service by volume, and missing hardening headers with no
  demonstrated impact.

Never include real secrets or other people's data in a report.
