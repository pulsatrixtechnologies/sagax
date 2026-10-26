# IT tools as widgets

Status: approved design (all decisions in section 8 resolved as listed). Delivered dark in stacked PRs behind the
experimental server switch `features.netTools`, off by default (section 7). File references were checked against
`main` at `2df9edace`.

Audience: technicians at managed service providers who use Sagax in solo or organization mode.

## 0. Goal and scope

Give technicians one-click network and mail diagnostics in Sagax. They show up as a verdict card in the
conversation and in a small **Tools** panel. The bot can run the same checks as tools and explain or fix
what they find.

v1 checks:

| # | Check | Tool name | Network? |
|---|---|---|---|
| 1 | DNS lookup (A, AAAA, CNAME, TXT, NS, SOA, plus CAA and PTR for an IP) | `dns_lookup` | DNS |
| 2 | MX lookup (with host resolution, null MX, PTR/forward-confirmed) | `mx_lookup` | DNS |
| 3 | SPF / DKIM / DMARC with plain-language verdicts | `mail_auth_check` | DNS |
| 4 | Blacklist (DNSBL) check for an IP or a domain's mail and web IPs | `blacklist_check` | DNS |
| 5 | SSL/TLS certificate (expiry, chain, hostname, protocol) | `tls_check` | TCP to target |
| 6 | Domain info via RDAP (registrar, dates, status, DNSSEC, nameservers) | `domain_info` | HTTPS to registry |
| 7 | HTTP response and security headers | `http_headers` | HTTP(S) to target |
| 8 | Email header analyzer (pasted headers, no network) | `email_header_analyze` | none |

v1.1 (same module, after v1 is live): `dns_propagation`, `port_check`, `tcp_ping`.
Not planned: ICMP ping and traceroute (see §3.6).

## 1. What exists today

Rendering surfaces:

- **Canonical chat widgets.** `shared/widget.ts` (`parseWidgetInput`, `WIDGET_LIMITS`, `widgetToText`,
  `resolveWidgetAction`) and the spec `docs/superpowers/specs/2026-10-13-chat-widgets-design.md`. A widget is a
  message of kind `"widget"` (`shared/wire.ts`, `widget?: WidgetPayload`). The server normalizes it once and stores
  it, and every renderer draws only the canonical tree:
  - desktop: `src/components/widget/WidgetMessage.tsx`, `WidgetBody.tsx`, `WidgetNodes.tsx`, `WidgetTable.tsx`;
  - iOS: `ios/App/Features/Chat/Widget/ChatWidgetCard.swift`, `ChatWidgetNodes.swift`;
  - Android: no widget renderer, so it shows the `text` fallback.

  A button press comes back as an ordinary user message that replies to the widget row
  (`server/chat-widgets.ts` `prepareWidgetPress`, `server/replies.ts` `promptWithReply`). Widgets are refused in
  rooms (`ROOM_REFUSAL` in `server/chat-widgets.ts`).
- **Tool-result widgets (PSA precedent).** `shared/cw-widgets/tool-call.ts` (`cwWidgetFromToolCall`,
  `isCwViewTool`, `shownCwWidget`) maps a tool call's result to a typed widget. `server/cw-widget-actions.ts`
  (`cwToolRowWidget`) attaches it to the tool row (`tool.widget` in `shared/wire.ts`). Desktop draws it in
  `src/components/cw/CwWidgetView.tsx` and iOS in `ios/App/Features/Chat/CwWidgetCard.swift`. A change asked from
  the widget becomes an approval card, never a direct write.
- **Views only on request.** `shared/requested-views.ts` (`askedForView`) is applied at row creation in
  `server/index.ts`. A view that a tool result would add on its own appears only when the person's message for
  that turn asked for it (#870, #876). Any IT-tools card a bot triggers has to follow this rule.
- **Panel and window surfaces.** The bot panel tabs are `src/components/bot-settings/panel-tabs.ts`
  (`PANEL_TABS = details, library, computer`, `visiblePanelTabs`, `simpleHidesPanelTab` in
  `src/lib/interface-visibility.ts`), drawn in `src/components/BotSettingsDialog.tsx`. The **Data** surface is
  the closest precedent for "a bot tool plus a panel that runs the same operation":
  - `server/data/tools.ts` runs "the same operations the panel's routes run for the person";
  - `server/data/rpc.ts` is the MCP tools/list and tools/call;
  - `server/data/routes.ts` holds the panel routes under `/api/bots/:botId/data`;
  - `src/components/data/*` and `src/components/DataWindowButton.tsx` are the UI. They sit behind the
    experimental flag `features.dataWindow` (`server/config.ts` `dataWindowEnabled`,
    `src/lib/feature-flags.ts`).

Tool declaration and gating:

- **Agents catalog.** `server/drivers/agents-catalog.ts` (`TOOL_DEFINITIONS`, `CatalogProfile` flags such as
  `meetings`) plus `agents-widget-tools.ts` and `agents-call-cards.ts`. Its wire bytes are pinned and budgeted
  on every turn by `agents-catalog-wire.test.ts` (`BUDGET_BASELINE`). Ten new tools there would cost every
  turn of every bot.
- **Built-in harness MCP servers.** `server/harness-mcp-proxy.ts` (`HarnessMcpKind = browser | computer | data`)
  and `server/harness-mcp-http.ts` (path `/api/internal/(browser|computer|data)/mcp-http`). Supporting pieces:
  - each driver declares the capability `dataMcp` (`server/contracts.ts`) and mounts the server in
    `server/drivers/claude.ts`, `codex.ts` and `acp/core.ts`;
  - the capability token is minted in `server/index.ts` (`mintInternalCapability`, `InternalCapability.kind`,
    `dataIntegration`);
  - reserved server names live in `server/mcp-registry.ts` (`RESERVED_MCP_NAMES`).
- **Per-bot tool scope.** `shared/tool-scope.ts` (`native:` / `mcp:<server>:<tool>` selectors, e.g.
  `mcp:agents:show_widget`).
- **Read-only annotations.** `server/agent-tool-policy.ts` (`READ_ONLY_AGENT_TOOL_NAMES`, `openWorldHint: false`).
  `server/flow-tools.ts` has the same `READ_ONLY` shape.
- **No-card list.** `server/sagax-internal-tools.ts` (`sagaxInternalTool`) is the reviewed exact-name list of
  Sagax's own tools that never ask for approval (today: Data, plus member-own-scope agents tools).
- **Confidential threads.** `server/confidential-threads.ts` never trusts a tool's own `readOnlyHint`.
- **HTTP routes.** Route modules live in `server/routes/` (README: `createXRoutes(deps)`, no new `if` blocks in
  `server/index.ts`, enforced by `scripts/testing/index-route-ratchet.test.ts`). Route scopes are in
  `server/request-auth.ts` (`CLIENT_ALLOW` for client and member sessions, `PERMISSION_ROUTES`). Each route also
  needs a row in `server/tool-policy.generated.ts` (`scripts/tool-policy/generate.ts`, `docs/tool-policy.md`).
- **Org permissions.** `shared/permissions.ts` (`PermissionDefinition`, `memberDefault`, `adminOnly`, labels
  `{en, fr}`).

Network-safety helpers already in the tree:

- `server/media-proxy-guard.ts`: `blockedAddressReason(address)` returns typed reasons (loopback, private,
  link-local, metadata, cgnat, ula, ipv4-mapped, ...). `checkMediaDestination` resolves every address and
  connects to the checked one.
- `server/custom-domain.ts`: `isPublicDomainAddress` (BlockList that includes 169.254/16, 100.64/10 and the
  cloud host-agent address `168.63.129.16`; for IPv6 only global 2000::/3 passes).
- `server/public-fetch.ts`: `guardedFetch` re-checks every redirect and pins the resolved address. Note that its
  **first** request is not guarded, so callers must guard hop 0 themselves.
- `server/person-connections.ts`: the "all resolved addresses must be public" rule.
- `server/browser-navigation.ts`: blocks `localhost`, `metadata.google.internal` and non-public IP literals.

Environment facts:

- Node ≥ 24 (`package.json` engines).
- The server image is `node:24-trixie-slim` with no `iputils-ping` (`Dockerfile`).
- Engine egress may go through the person's computer (`server/desktop-egress.ts`), but harness-side code such
  as the Data tools runs **in the server process**. The IT tools will too, so their vantage point is the Sagax
  server and never the person's LAN.

Language:

- `src/locales/*.json` packs are partial and fall back to English (`src/locales/index.ts`). `pt-br.json` also
  serves `pt`. Check with `pnpm i18n:check` (`scripts/generate-locale.mjs`).
- The server-side language precedent is `cwActionLanguage(cfg.language)` in `server/cw-widget-actions.ts`.

Tests:

- Vitest unit tests sit beside the code. `test:unit` and `test:e2e` shards run through
  `scripts/testing/vitest-shards.mjs`.
- Server e2e uses `launchVerificationServer` + `FAKE_CLAUDE_TOOL_CALLS` (`server/cw-widgets.e2e.test.ts`,
  `scripts/control-omb.ts`). UI e2e lives in `scripts/testing/*-ui.e2e.test.ts`. Visual gallery is `src/gallery/`.
- `src/lib/no-visible-ids.test.ts` fails if a UUID reaches visible text.

## 2. Where the widgets live (decision 1)

Options:

- **A. Chat card from a tool result only.** This fits the PSA precedent, but under the "views only on request"
  rule the card would rarely show, and a technician cannot run a check without going through the model.
- **B. Standalone Tools panel only.** Fast and deterministic, but the bot cannot reason over results in the
  conversation, and nothing is kept in the thread.
- **C. Both, sharing one renderer and one implementation.** *Chosen.*

Chosen shape (C), in delivery order:

1. **Chat card = a canonical widget row** (`kind: "widget"`). It is built on the server from the structured
   result by one pure mapper, `netCheckWidget(result, lang)`, and passed through `parseWidgetInput` like any
   bot widget:
   - desktop and iOS draw it with no new renderer, and Android gets `widgetToText`;
   - the "Explain" and "Suggest a fix" buttons are ordinary widget presses, so they reach the bot as a reply
     with the widget fenced as untrusted content;
   - in rooms, widgets are refused today, so the bot gets the text result and answers in prose there.

   A card is posted when:
   - (a) the person ran the check directly, with the `/check` composer command or the Tools panel's
     "Post to chat"; or
   - (b) the bot ran it and the person's message for that turn asked for a check or a view. This extends
     `shared/requested-views.ts` with a `"check"` kind; see decision 2.

   Otherwise the bot's call stays a plain tool row with a one-line verdict in `tool.summary`, and the bot
   answers in text.
2. **Tools panel = a new bot panel tab `tools`** (`panel-tabs.ts`), behind the same feature flag. It has a check
   picker, an input form and the result drawn with the **same** `WidgetBody` component from the same canonical
   tree, plus "Run again", "Copy raw" and "Post to chat / Ask the bot". Results stay in the panel's memory and
   are not stored unless posted. A separate pop-out window like the Data window is not needed for v1.

Why a canonical tree instead of a typed widget like the PSA one: a typed widget costs a wire field and three
native renderers (desktop, iOS, Android). The chat-widgets spec was written to stop that growth.

## 3. Server: one module, each check is a bot tool and a direct action

### 3.1 Layout

```
shared/net-tools/                  (browser-safe, pure)
  types.ts        NetCheckName, NetCheckInput (per check), NetCheckResult, Finding, Verdict
  target.ts       syntax-only target parsing shared by the panel form and the server
                  (IDN -> ASCII through the WHATWG URL parser, the same IDNA mapping as
                  node:url domainToASCII, so the server and the client agree)
  findings.ts     finding codes -> { en, fr, "pt-BR" } title + explanation + fix hint, with {placeholders}
  widget.ts       netCheckWidget(result, lang): WidgetRoot  (Card: Title, Badge verdict, findings list,
                  details Table, raw Markdown fence, Explain / Suggest a fix buttons)
  text.ts         netCheckText(result, lang): fallback and tool-row summary;
                  netCheckModelText(result): compact English text for the model
server/net-tools/
  guard.ts        target + address guard (SSRF), port policy
  resolver.ts     NetResolver interface; NodeResolver (dns/promises Resolver with servers, timeout, tries);
                  DohResolver fallback (JSON DoH over guardedFetch); FakeResolver lives in tests only
  limits.ts       per-person / per-bot token buckets, global concurrency, per-target result cache
  registry.ts     NET_CHECKS: name -> { schema (JSON Schema for MCP, zod for the route), network, limitClass, run }
  run.ts          runNetCheck(ctx, name, input): validate -> limit -> guard -> run with deadline -> NetCheckResult
  checks/dns.ts  checks/mx.ts  checks/spf.ts  checks/dkim.ts  checks/dmarc.ts  checks/mail-auth.ts
  checks/dnsbl.ts  checks/tls.ts  checks/rdap.ts  checks/http-headers.ts  checks/email-headers.ts
  checks/propagation.ts  checks/ports.ts  checks/tcp-ping.ts        (v1.1 for the last three)
  rpc.ts          tools/list + tools/call, same shape as server/data/rpc.ts (assertActive before and after)
  instructions.ts MCP server instructions (vantage point, never scan internal ranges, how to read verdicts)
server/routes/net-tools.ts          createNetToolsRoutes(deps): the direct-action routes (§3.4)
server/routes/net-tools-internal.ts the internal MCP route (/api/internal/nettools/mcp), a route module so
                                    index.ts gains no path guard
```

`runNetCheck` is the **only** entry point. MCP calls run it with `by: "bot"` and the panel or `/check` routes run
it with `by: "person"`. This is the same split as Data's `connection: "bot" | "panel"`.

`NetCheckResult` (language-neutral and storable):

```ts
{ check: NetCheckName; target: string; at: number; durationMs: number;
  verdict: "pass" | "warn" | "fail" | "info" | "unknown";
  findings: Array<{ code: string; severity: "pass" | "warn" | "fail" | "info" | "unknown"; params?: Record<string, string | number> }>;
  details: Array<{ label: string; columns?: string[]; rows: string[][] }>;  // tables: records, hops, chain, lists
  raw: string;                                           // capped at 16 KB; widget shows the first ~5,500 chars
  vantage: "server";                                     // shown as "Checked from this Sagax server"
  links?: Array<{ label: string; url: string }>;         // https only, at most 6 (delisting pages)
}
```

Table `label` and `columns` are keys (`NET_DETAIL_LABELS` in `findings.ts`) when one exists, so the stored result
stays language-neutral; anything else (a record type such as `TXT`) is shown as it is.

The overall verdict is the worst finding severity. `unknown` (timeout, refused query, blocked egress) never counts
as `fail`: a `fail` or `warn` finding wins, then any `pass`, and `unknown` stands only when nothing was conclusive
(`info` alone stays `info`; no finding at all is `unknown`). Findings are listed worst first: fail, warn, unknown,
info, pass.

### 3.2 Bot tools: a separate built-in MCP server `nettools`

Chosen (decision 3) over adding tools to the agents catalog:

- add `"nettools"` to `HarnessMcpKind` (`harness-mcp-proxy.ts`: NAMES "IT tools", INSTRUCTIONS) and to the
  `PATH` regex in `harness-mcp-http.ts`;
- add `"nettools"` to `InternalCapability.kind` and a `netToolsIntegration(botId, turn)` beside `dataIntegration`
  in `server/index.ts`. Mount it at the two call sites that mount Data today (direct turn and room turn), only
  when the feature is on;
- add the driver capability `netToolsMcp` in `server/contracts.ts`, and mount it in `claude.ts`, `codex.ts` and
  `acp/core.ts`, exactly as `data` is mounted (`harnessHttp(..., "nettools")`, `mountSelected`);
- add `"nettools"` to `RESERVED_MCP_NAMES` (`server/mcp-registry.ts`);
- per-bot off switch: tool scope `mcp:nettools:*` or one tool, for example deny `mcp:nettools:port_check`
  (`shared/tool-scope.ts`);
- annotations on every tool: `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }`.
  Do **not** reuse `READ_ONLY_ANNOTATIONS` from `agent-tool-policy.ts`, which says `openWorldHint: false`;
- approval: add the exact v1 tool names to `sagaxInternalTool` (`server/sagax-internal-tools.ts`) as a third
  family `"nettools"`, so they never raise a card (decision 6). They read only public data about a target the
  person or bot names, and the guard (§3.3) is the boundary. `port_check` is the exception, with its own rule in
  §3.3;
- confidential threads: classify `nettools` as Sagax-internal reads in `server/confidential-threads.ts`. The only
  thing that leaves the server is the target name, sent to DNS, RDAP or the target itself. A test pins this;
- result size: keep the model text under 6 KB (`netCheckModelText`). The full raw output stays in the result, and
  `mcp-result-budget.ts` trims as a backstop.

One tool per check (decision 4): clearer schemas and better model routing. This costs nothing on bots without the
feature, because the server is not mounted for them.

### 3.3 Guard, limits and abuse

Target rules (`guard.ts`), applied to every check that touches the network:

- **Accepted input:**
  - a hostname: labels `[a-z0-9-]`, IDN converted to ASCII, at most 253 chars, at least one dot (`dns_lookup` also
    accepts service labels such as `_dmarc` or `selector._domainkey`);
  - an IPv4 or IPv6 literal;
  - for `http_headers`, an `http(s)` URL without credentials;
  - for `tls_check` and `tcp_ping`, an optional `:port` from the port policy.
- **Refused names:** `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.home.arpa`, `*.lan`, single-label
  names, `metadata.google.internal`, and the server's own public names.
- **Refused addresses:** every address the name resolves to must pass `blockedAddressReason`
  (`media-proxy-guard.ts`) **and** `isPublicDomainAddress` (`custom-domain.ts`). That covers loopback, RFC 1918,
  CGNAT 100.64/10, link-local and the cloud metadata address 169.254.169.254, 168.63.129.16, ULA fc00::/7,
  fe80::/10, IPv4-mapped and NAT64 forms, multicast, documentation and reserved ranges. If **any** resolved
  address is non-public, the target is refused; this matches `person-connections.ts`.
- **Pinning:** the connection goes to the address that was checked, never through a second lookup, so DNS
  rebinding cannot swap it. TLS uses `servername` for SNI. HTTP uses the pinned-lookup pattern of
  `public-fetch.ts`, and hop 0 is guarded too.
- **DNS-only checks** (lookups, mail auth, DNSBL, RDAP) query records and never connect to the target, so they
  do not need the address guard. They still refuse the refused names, so internal zone names are not looked up.
- **No operator override in v1** that would allow private ranges. If ever added, it would be an admin-only env
  allowlist like `SAGAX_MEDIA_PROXY_ALLOW_HOSTS`, not a per-request option (decision 7).

Port policy (`port_check`, `tcp_ping`, `tls_check` port):

- connect-only TCP (`net.connect` to the pinned address), with no payload and no banner grab in v1. Results are
  open, closed (RST) or filtered (timeout 3 s);
- either a preset list (web, mail, remote access, file sharing, databases, about 20 ports) or at most **10
  explicit ports** per request. No ranges, CIDR or wildcards. At most 5 connections in parallel per request;
- **the bot may only check a target the person typed:** for a bot call, the host (or its registrable parent)
  must appear literally in the person's message for that turn. The server already finds that text for the PSA
  rule (`cwToolRowWidget(..., personText)` and the lookup near `slimMessage` in `server/index.ts`). Otherwise the
  call is refused with "Ask the person to type the host to check." In the panel and `/check`, the person typed
  it by definition;
- every port check is appended to the admin activity log (`server/admin-activity.ts` `appendAdminAction`,
  category `security`): who, target and ports. No other check is logged beyond its normal tool row (decision 13).

Limits (`limits.ts`, in memory, starting values to tune):

| Class | Per person | Per bot | Notes |
|---|---|---|---|
| DNS-only (lookup, MX, mail auth, propagation) | 60 / 10 min | 120 / 10 min | per-query timeout 2.5 s, 2 tries |
| DNSBL | 10 / 10 min | 20 / 10 min | at most 8 zones in flight, 2 s per zone, at most 25 zones |
| RDAP | 20 / 10 min | 40 / 10 min | IANA bootstrap cached 24 h, answers cached 1 h per domain |
| TLS / HTTP headers / TCP ping | 30 / 10 min | 60 / 10 min | at most 5 redirects, body never read |
| Port check | 5 / 10 min and 30 / day | 10 / 10 min | audit-logged |
| Header analyzer | 60 / 10 min | 120 / 10 min | input ≤ 64 KB, no network |

- Global limits: at most 8 checks running at once on the server and a 20 s deadline per check, which is below
  the harness's 130 s per call.
- Same-target results are cached: DNS for min(TTL, 60 s), TLS 5 min, DNSBL 15 min. Cached results carry
  "checked N min ago".
- A refusal from a limit reads "Too many checks, try again in N min." It never counts as a `fail` verdict.

Abuse notes for the spec:

- The server must not become a free scanner. The guard, the typed-target rule, the port caps and the audit log
  together keep port checks to "is my client's firewall open on 3389", never sweeps.
- DNS amplification is not a concern because the server is only a client. DNSBL operators rate-limit and some
  refuse queries that come through large public resolvers; those answers map to `unknown` (§3.5).
- Results reflect the **server's** network. Many cloud hosts block outbound TCP 25, so any SMTP-port test shows
  "could not test from this server" (`unknown`), never "closed".

### 3.4 Direct UI actions (routes)

`server/routes/net-tools.ts` (module listed in `server/routes/table.ts` or pushed from `index.ts` with deps):

- `POST /api/bots/:botId/net-tools/run` with body `{ check, input, lang }`. It returns
  `{ result: NetCheckResult, widget: WidgetRoot }` and stores nothing. The bot id scopes the bot's tool scope,
  feature and permissions, and the panel lives on a bot.
- `POST /api/bots/:botId/net-tools/post` with body `{ threadId, result, lang }`. It re-validates the result shape
  and posts the canonical widget row into the person's own conversation, refusing rooms. It is used by "Post to
  chat" and by `/check`.

  Chosen (decision 19): do not trust a client-supplied result. `post` takes `{ threadId, check, input }`
  and runs the check again, hitting the cache when it just ran. A client can then never post a fabricated
  verdict as if it came from the server.
- Auth: add both paths to `CLIENT_ALLOW` in `server/request-auth.ts` so member sessions and paired clients reach
  them. On an organization server, gate them in `PERMISSION_ROUTES` with a new key (§3.8).
- Tool policy: add reviewed rows to `server/tool-policy.generated.ts` (`tier: "read"`, `readOnly: true` for
  `run`, `write` for `post`), then rerun `scripts/tool-policy/generate.ts`.
- `/check` composer command:
  - add `check` to `SAGAX_COMMAND_NAMES` (`shared/harness-commands.ts`) and `ComposerSlashCommandId`
    (`src/lib/composer-commands.ts`);
  - syntax: `/check spf example.com`, `/check dns example.com txt`, `/check ssl host:443`;
  - with no arguments, it opens the Tools tab;
  - the client calls `post`, no model turn runs, and the row appears and syncs to iOS like any widget row.

### 3.5 Data sources per check (native Node, no paid keys)

- **DNS lookup:**
  - `node:dns/promises` `Resolver` with `{ timeout, tries }` and `setServers(configured public resolvers)`;
  - it does **not** use the server's system resolver, so split-horizon internal records never leak (decision 9);
  - calls: `resolve4/6({ ttl: true })`, `resolveCname`, `resolveTxt`, `resolveNs`, `resolveSoa`, `resolveCaa`,
    `reverse` for IPs;
  - fallback: when UDP/TCP 53 egress is blocked, JSON DoH over `guardedFetch`. It also gives TTLs for every type
    and the AD bit, which feeds an informational "DNSSEC validated" line.
- **MX:**
  - `resolveMx`, then A/AAAA for each host and PTR plus a forward-confirm check for each IP;
  - null MX (RFC 7505) gives info "domain does not accept mail".
- **SPF:** a native evaluator for the record checks, without a full message check:
  - parse the `v=spf1` TXT records and walk `include` and `redirect` recursively;
  - count DNS-mechanism lookups (limit 10) and void lookups (limit 2);
  - detect multiple records, `+all`, `?all`, `~all` vs `-all`, `ptr`, unknown mechanisms, macro use, loops, and
    records over the UDP-safe size.
- **DKIM:**
  - `<selector>._domainkey.<domain>` TXT, which follows CNAME delegation;
  - parse `v`, `k`, `p` and `t`, and read the key size with `crypto.createPublicKey`;
  - an empty `p=` means revoked, and `t=y` means testing;
  - with no selector given, probe a small list of common selectors and say clearly that **absence is not proof**,
    because selectors cannot be listed.
- **DMARC:**
  - `_dmarc.<domain>` TXT; if none, find the organizational domain by **DNS tree walk** (DMARCbis), which
    avoids a Public Suffix List dependency;
  - parse `p`, `sp`, `pct`, `rua`, `ruf`, `adkim` and `aspf`;
  - check external report authorization (`<domain>._report._dmarc.<rua-host>`).
- **DNSBL:**
  - IPv4 reversed-octet queries against a configurable zone list, with domain-based lists for domains;
  - `127.0.0.x` means listed, with TXT read for the reason; NXDOMAIN means not listed; a timeout means unknown;
  - operator "query refused / resolver blocked" return codes (the `127.255.255.x` family) mean `unknown` with an
    explanation. This matters because several lists refuse queries arriving from large public resolvers, so the
    DNSBL check uses **the system resolver or a dedicated configurable resolver**, not the public ones;
  - IPv6 is "not checked" in v1.
- **TLS:**
  - `tls.connect({ host: pinnedIp, servername, rejectUnauthorized: false, requestOCSP: true })`;
  - read `socket.authorized` / `authorizationError`, `getPeerCertificate(true)` for the full chain,
    `new X509Certificate(raw)` (`node:crypto`) for key, signature algorithm and SANs, `tls.checkServerIdentity`
    for the name, and `getProtocol()` / `getCipher()`;
  - an incomplete chain is recognised from `UNABLE_TO_VERIFY_LEAF_SIGNATURE`;
  - legacy-protocol probes (`maxVersion: "TLSv1.1"`) report `unknown` when the local OpenSSL cannot offer them;
  - STARTTLS for SMTP/IMAP/POP comes in v1.1 with the port policy.
- **RDAP:**
  - IANA bootstrap JSON (`data.iana.org/rdap/dns.json`, plus `ipv4.json` / `ipv6.json` for IP owners), then the
    registry's RDAP base, all through `guardedFetch` with hop 0 guarded;
  - read registrar, events (registration, expiration, last changed), status codes (each one explained), nameservers,
    `secureDNS.delegationSigned`, and the abuse contact;
  - a TLD with no RDAP shows "no RDAP service for this TLD". A WHOIS port-43 fallback is decision 11.
- **HTTP headers:**
  - `GET`, with the body cancelled immediately, through the pinned request, and up to 5 redirects each guarded;
  - report the status chain, an http→https upgrade, HSTS (max-age, includeSubDomains, preload), CSP,
    X-Content-Type-Options, X-Frame-Options or `frame-ancestors`, Referrer-Policy and Permissions-Policy;
  - flag version disclosure in Server and X-Powered-By, and cookie flags (Secure, HttpOnly, SameSite);
  - send a fixed honest User-Agent.
- **Email header analyzer:**
  - pure parser for unfolded headers: the Received chain (hops, timestamps, delay per hop), Authentication-Results
    and ARC results, alignment of From, Return-Path, DKIM `d=` and SPF domain, Reply-To that differs from From,
    and lookalike display names;
  - no DNS by default, so it can be safely auto-run on pasted content. "Check sending IP on blacklists" is a
    follow-up button;
  - DKIM signatures cannot be re-verified without the body, and the card says so.
- **Propagation (v1.1):** query each authoritative NS IP (resolved from NS) plus the configured public resolvers,
  then compare answer sets and TTLs.
- **TCP ping (v1.1):** 4 timed TCP connects to the pinned address (default 443), reporting min, avg, max and loss.

### 3.6 Ping and traceroute feasibility

- **ICMP ping** needs raw sockets (`CAP_NET_RAW`) or a setuid `ping` binary. The server image has none, Node has
  no ICMP API, and spawning a binary adds an exec path to review. In solo mode it would also ping from the
  person's own machine, with different semantics from the server. Decision: **Not in v1.** Offer `tcp_ping` (connect
  latency), labeled "TCP reachability (not ICMP)".
- **Traceroute** needs raw sockets to read ICMP Time Exceeded. `dgram.setTTL` can send probes but cannot receive
  the replies. Decision: **Not feasible in-process.** A later option is an optional host binary run as an
  admin-configured external tool, out of scope here.

## 4. Widget UX per check

Common card anatomy (canonical nodes only, inside `WIDGET_LIMITS`: 32 KB, 250 nodes, Markdown 6,000 chars,
table 60×8):

- `Card` title: "SPF, DKIM and DMARC: example.com". Caption: "Checked from this Sagax server · 14:32".
- **Verdict badge.** `Badge` color `success` / `warning` / `danger` / `secondary`, with an icon (`check-circle`,
  `warning`, `close`, `info`) **and** a word ("OK", "Needs attention", "Problem", "Unknown"), so color is never
  the only signal.
- **Findings list.** One `Row` per finding: an icon, a title, and a one- or two-sentence plain explanation from
  `findings.ts` in the viewer's language. Worst findings come first. At most 8 are shown, then "and N more".
- **Details.** `Table` (records, hops, chain, DNSBL zones), capped at 60 rows.
- **Raw output.** A `Markdown` node with a ```text fence (first ~5,500 chars). Desktop code blocks already have
  Copy (`src/components/ChatMarkdown.tsx`, `useCopyFeedback`), and `inert` only turns off nested rich fences.
  iOS: `MarkdownText(inert: true)`; confirm it offers copy and add it if not (B7). The panel has its own
  "Copy raw" button for the full 16 KB.
- **Buttons** (non-settling):
  - "Explain" sends action `{ type: "nettools.explain", payload: { check, target } }`;
  - "Suggest a fix" sends `{ type: "nettools.fix", payload: { check, target } }`. It is shown only when a finding
    is `warn` or `fail`, so a clean result never invites an invented fix.

  The press reaches the bot as a reply with the widget fenced, so it already has the verdicts, and `payload`
  stays under 2 KB. The fix answer is guidance and corrected record text only. The bot has no DNS write tools,
  and any write a connector could do still needs its approval card.
- **Language.** `lang` comes from the request for direct actions and from `cfg.language` for bot calls
  (precedent `cwActionLanguage`). Values are `en`, `fr` or `pt-BR`, with anything else falling back to `en`.

Per check:

- **DNS lookup**
  - Input: name or IP, plus a type picker (All / A / AAAA / CNAME / TXT / NS / SOA / CAA / PTR).
  - Shows: one table per type with value and TTL.
  - Findings (mostly `info`): CNAME at apex (fail), lame NS (warn), SOA serial mismatch between NS (warn), no
    AAAA (info), DNSSEC validated (info).
- **MX lookup**
  - Input: domain.
  - Shows: table with priority, host, IPs and PTR.
  - Findings: no MX (fail, or null MX = info), MX host without address (fail), MX → CNAME (warn), MX → IP literal
    (fail), PTR missing or not forward-confirmed (warn), single MX (info).
- **Mail auth**
  - Input: domain, plus an optional DKIM selector.
  - Shows: three sections (SPF, DKIM, DMARC), each with its own badge, and an overall verdict.
  - Example findings: "SPF ends with ~all (soft fail)…", "SPF needs 12 DNS lookups; receivers stop at 10…",
    "DMARC policy is none: reports only, spoofed mail is still delivered", "No DMARC reports address", "DKIM key
    is 1024-bit".
- **Blacklist**
  - Input: IP or domain.
  - Shows: IPs checked and a zone table (listed / clean / unknown, with a reason), plus delist links as `open_url`
    buttons, at most 6.
  - Verdict: listed on a major zone = fail, minor = warn, all clean = pass, any unknown shown separately.
- **TLS**
  - Input: host, plus a port (443 default).
  - Shows: chain table (subject, issuer, valid until), protocol, cipher, OCSP stapled.
  - Findings: expired / not yet valid / name mismatch / self-signed / incomplete chain (fail), expires in under
    14 days (fail), under 30 days (warn), SHA-1 or a key under 2048 bits (warn).
- **Domain info**
  - Input: domain.
  - Shows: registrar, created, expires, updated, status codes with plain meanings, nameservers, DNSSEC.
  - Findings: expires in under 7 days (fail), under 30 days (warn); `clientHold`, `serverHold`,
    `redemptionPeriod` or `pendingDelete` (fail); no transfer lock (info).
- **HTTP headers**
  - Input: URL or host.
  - Shows: redirect chain and a header table.
  - Findings: no https redirect (warn), HSTS missing or short (warn), CSP missing (warn), no clickjacking protection
    (warn), version disclosure (info), insecure cookie (warn).
- **Email header analyzer**
  - Input: a textarea in the panel. In chat, the person pastes the headers and asks; the bot calls the tool.
  - Shows: a hops table with delays, an auth results summary and alignment.
  - Findings: SPF, DKIM or DMARC fail (fail), Reply-To on a different domain (warn), a hop delay over 5 min (warn),
    a lookalike sender (warn).
  - The card carries no raw headers beyond the Received chain, because headers hold personal data.
- **v1.1:**
  - propagation: a resolver × answer table, with authoritative mismatch = fail and "still cached, refresh within
    TTL" = warn;
  - port check: a port, service and state table, with exposure verdicts (open RDP, SMB, Telnet or database ports
    on a public IP = fail; FTP = warn);
  - TCP ping: min, avg, max and loss.

Example finding in three languages (`findings.ts`, code `spf.softfail_all`):

- en: "SPF ends with ~all: mail from unlisted servers is marked suspicious but still accepted. Use -all once every
  sender is listed."
- fr: "Le SPF se termine par ~all : le courriel d'un serveur non listé est marqué comme suspect mais accepté.
  Passez à -all quand tous les expéditeurs sont listés."
- pt-BR: "O SPF termina com ~all: e-mails de servidores não listados são marcados como suspeitos, mas ainda
  aceitos. Use -all quando todos os remetentes estiverem listados."

## 5. i18n (en, fr, pt-BR)

- **Finding texts** (title, explanation, fix hint) go in `shared/net-tools/findings.ts` as `{ en, fr, "pt-BR" }`.
  This follows the `LocalizedText` pattern of `shared/permissions.ts`, extended to three languages, because the
  **server** builds the widget tree and its text fallback. Other UI languages fall back to `en`.
- **UI chrome** (panel tab "Tools", form labels, check names, buttons, limit and guard messages) goes in
  `src/locales/en.json`, `fr.json` and `pt-br.json` under `netTools.*`. `source-hashes.json` is updated and
  `pnpm i18n:check` stays green. The other packs fall back to English by design.
- Server refusal messages (guard, limits) are returned as codes and drawn from `findings.ts` (or locale keys in
  the panel), never as bare English.
- Names: "IT tools" / "Outils TI" / "Ferramentas de TI" (decision 17). French copy follows Québec usage
  (courriel, nom de domaine).
- iOS and Android need no new strings in v1: the card arrives already rendered in the chosen language. A native
  iOS Tools tab, if ever built, adds keys to `ios/App/Localizable.xcstrings`.

## 6. Tests

Unit tests (Vitest, beside the code, no network):

- `resolver.ts`: a `FakeResolver` implementing `NetResolver` from fixture zones. Every check takes the resolver
  by injection, and none reads `node:dns` directly.
- SPF: RFC 7208 cases for lookup count, void lookups, include loops, redirect, `+all`/`?all`/`~all`/`-all`,
  multiple records, macros, oversize records, a missing include target.
- DKIM: key-size parsing (RSA 1024 and 2048, ed25519), revoked `p=`, `t=y`, CNAME-delegated selector, absence
  wording.
- DMARC: tag parsing, tree walk, `pct`, external `rua` authorization, multiple records.
- DNSBL: listed, clean, NXDOMAIN, timeout, and refusal codes mapping to `unknown`; IPv6 is skipped.
- TLS: a local `tls.createServer` with self-signed, expired, wrong-name and missing-intermediate certificates
  generated in the test. The guard is injected so the loopback test target is allowed **only** through test
  injection, never through an env var.
- RDAP: bootstrap and answer fixtures, status-code mapping, a TLD with no RDAP, and a redirect to a private
  address that is refused.
- HTTP headers: a local server with header permutations and a redirect chain to a refused host.
- Header analyzer: anonymized fixture headers (forwarded, phishing-like, aligned and misaligned).
- Guard table:
  - IPv4 and IPv6 ranges, including 169.254.169.254, 168.63.129.16, 100.64/10, `::ffff:127.0.0.1` and
    `64:ff9b::/96`;
  - refused names;
  - mixed public/private answers (refused);
  - rebinding, with a second lookup returning another address: the pinned address is used;
  - port caps and the typed-target rule (bot call with and without the host in the person's text).
- Limits: fake clock, buckets refill, cache hits, global concurrency.
- Widget mapping:
  - every fixture result, in each language, passes `parseWidgetInput` and stays inside `WIDGET_LIMITS`;
  - `widgetToText` is non-empty;
  - action labels are unique (the `resolveWidgetAction` rule);
  - no UUID reaches visible text (add a case to `src/lib/no-visible-ids.test.ts`).
- i18n parity: every finding code has non-empty `en`, `fr` and `pt-BR` with the same placeholders, and
  `pnpm i18n:check` passes.
- `rpc.ts`: tools/list and tools/call shape, schema refusal, `assertActive` before and after (mirroring
  `server/data/rpc.test.ts`).
- Catalog wire: `agents-catalog-wire.test.ts` goldens and budget are **unchanged**, which proves the separate
  server costs nothing on other bots.
- Approvals and confidential threads: `sagaxInternalTool` names the v1 tools; `port_check` from a confidential
  thread follows the rule chosen in decision 6.

e2e (fixture server, `docs/verification/README.md`, never the live app):

- `server/net-tools.e2e.test.ts`:
  - `launchVerificationServer` with `FAKE_CLAUDE_TOOL_CALLS` calling `mcp__nettools__mail_auth_check` and
    returning a fixture result;
  - assert a tool row with a verdict summary, and no widget when the person's text did not ask for one;
  - with "check the SPF of example.com", assert a widget row.
- Direct route e2e:
  - `POST /api/bots/:id/net-tools/run`, then `post`, with the server started under a test-only fake resolver;
  - the seam is honored only by the verification fixture (same pattern as other `FAKE_*` fixture switches), and
    a test proves production startup ignores it.
- UI e2e (`scripts/testing/net-tools-ui.e2e.test.ts`):
  - open the Tools tab, run a check, see the verdict, Copy raw, Post to chat;
  - press "Explain" and see a reply message to the widget.
- Gallery: `src/gallery/net-tools.html`/`.tsx` shows every check × verdict × language for visual review in light
  and dark.
- Manual live smoke (not CI): a script that runs each check against IANA example and reserved domains and a
  known-expired certificate test host, to confirm real resolvers and RDAP before each release.

## 7. Delivery: stacked PRs

Each PR is reviewable alone, is green on `test:unit`, and is dark (behind `features.netTools`, off) until B7.
Sizes: S < 300 changed lines, M 300 to 700, L > 700 (tests included).

| # | PR | Content | Depends | Size |
|---|---|---|---|---|
| B0 | Spec | `docs/superpowers/specs/<date>-it-tools-design.md` (this document, decisions resolved) | none | S |
| B1 | Shared model | `shared/net-tools/` types, target parsing, `findings.ts` (en/fr/pt-BR), `widget.ts`, `text.ts`; mapping, limit and parity tests | B0 | M |
| B2 | Core + DNS | `server/net-tools/` guard, resolver (Node + DoH fallback), limits/cache, registry, `runNetCheck`; checks `dns_lookup`, `mx_lookup`; guard table tests | B1 | M/L |
| B3 | Mail auth | SPF evaluator, DKIM, DMARC tree walk, `mail_auth_check`; RFC test vectors | B2 | L |
| B4 | Reputation + registry | `blacklist_check` (zone list config, refusal codes), `domain_info` (RDAP bootstrap and cache) | B2 | M |
| B5 | Web | `tls_check`, `http_headers` (pinned connections, redirect guard); local TLS and HTTP fixtures | B2 | M |
| B6 | Bot tools | `nettools` harness MCP kind: `rpc.ts`, `routes/net-tools-internal.ts`, capability token, driver mounts (Claude, Codex, ACP), reserved name, annotations, `sagaxInternalTool`, confidential classification, `features.netTools` flag (server config and `src/lib/feature-flags.ts`, Settings > Experimental), instructions; rpc and wire tests; e2e with fake tool calls | B2 (B3 to B5 add tools as they land) | M |
| B7 | Chat surface | `requested-views.ts` `"check"` kind; widget row for bot calls on request; `routes/net-tools.ts` (`run`, `post`), `CLIENT_ALLOW`, tool-policy rows, org permission key(s); `/check` composer command; `email_header_analyze`; iOS copy-in-code-block check; en/fr/pt-BR chrome; e2e | B6 | M/L |
| B8 | Tools panel | `PANEL_TABS += "tools"`, form per check, result via `WidgetBody`, Run again, Copy raw, Post to chat, Ask the bot; Simple-mode visibility; gallery page; UI e2e | B7 | M |
| B9 | v1.1 network | `port_check` (port policy, typed-target rule, audit log), `tcp_ping`; tests | B8 | M |
| B10 | v1.1 DNS | `dns_propagation` (authoritative and public resolver matrix) | B8 | S/M |

Critical path: B0 → B1 → B2 → B6 → B7 → B8. B3, B4 and B5 run in parallel after B2. Roughly 9 to 11 PRs for v1
plus v1.1. B3 is the riskiest logic and B6 the riskiest plumbing (driver mounts).

Verification for each PR follows `AGENTS.md` and `docs/verification/README.md`: an isolated fixture, never the
person's live app or data.

## 8. Decisions (approved)

Each decision below was approved as written.

1. **Surface:** chat card, panel, or both. Decision: **Both**, chat first (B7), then the Tools panel tab (B8). Both use
   the same canonical widget tree and renderer.
2. **When a bot-run check draws a card.** Decision: Only when the person's message for that turn asks for a check or view
   (new `"check"` kind in `requested-views.ts`). Direct actions (`/check`, panel "Post to chat") always draw one.
   Otherwise there is a tool row plus a text answer.
3. **Packaging the bot tools.** Decision: A **separate built-in MCP server `nettools`** (harness kind like `data`), not the
   agents catalog. This leaves the per-turn wire budget untouched and gives a clean per-bot switch with
   `mcp:nettools:*`.
4. **One tool per check vs one multiplexed tool.** Decision: **One per check.** Schemas are clearer, and the cost is zero
   for bots without the server.
5. **Enablement.** Decision: Server-level experimental switch `features.netTools`, off by default in v1. When on, every bot
   gets the server unless its tool scope denies it. After a soak period, default it on in organization mode.
6. **Approvals.** Decision: No approval card for the read checks (`sagaxInternalTool` family `nettools`). `port_check` from
   a bot is refused unless the host was typed by the person in that turn, and runs from the panel or `/check`
   without a card. In confidential threads, read checks pass and `port_check` asks for the owner's card.
7. **Private and internal targets.** Decision: **Never in v1**: no override, no env allowlist. Revisit only as an
   admin-only allowlist, or as a v2 "run from my computer" path through the desktop bridge with explicit consent.
8. **DNSBL zones and terms.** Decision: Ship a curated default list of free public zones, chosen and terms-checked in B4. Make
   the list configurable in server config. Treat refusal codes as `unknown`. Support an optional operator key for
   lists that require registration for commercial use, never required.
9. **Resolvers.** Decision: Lookups use configured public resolvers (default list in config) with DoH fallback, never the
   server's system resolver (no split-horizon leak). DNSBL uses the system resolver or a dedicated configurable
   one, because public resolvers are refused by several lists.
10. **Where finding texts live.** Decision: `shared/net-tools/findings.ts` (en, fr, pt-BR), because the server renders the
    card. UI chrome stays in `src/locales`.
11. **WHOIS port-43 fallback** for TLDs without RDAP. Decision: **Not in v1.** Show "no RDAP service for this TLD" and
    revisit if technicians hit it often (some country-code TLDs).
12. **Ping and traceroute.** Decision: TCP connect latency (`tcp_ping`) in v1.1. No ICMP ping or traceroute: the server
    image has no raw-socket tools, and in-process traceroute is not feasible.
13. **Audit.** Decision: Log every `port_check` (who, target, ports) to admin activity, category `security`. Other checks
    rely on their normal tool rows or are not stored (panel runs).
14. **Rooms.** Decision: Text-only in rooms for v1, consistent with `show_widget`'s room refusal.
15. **Android.** Decision: Accept the text fallback for v1. A native Android widget renderer is a separate project that
    benefits every widget.
16. **Organization permissions.** Decision: Two keys in `shared/permissions.ts` under group `security`:
    - `netTools.use`: `memberDefault: true`;
    - `netTools.ports`: `memberDefault: false`, so an admin grants it to the technician role.

    Labels need `{en, fr}` today; add pt-BR when the catalogue supports it.
17. **Name.** Decision: "IT tools" / "Outils TI" / "Ferramentas de TI". The tab is "Tools" / "Outils" / "Ferramentas".
18. **Limits and cache numbers.** Decision: Start with §3.3 values and make them config-tunable, without exposing them in
    the UI in v1.
19. **Posting from the panel.** Decision: `post` runs the check again on the server (cache hit). It never accepts a
    client-supplied result, so a client cannot forge a verdict.
20. **Email header analyzer storage.** Decision: Do not keep raw pasted headers. The posted card keeps only the parsed
    hops, auth results and alignment.

## Appendix A: v1 tool list (as the model sees it)

| Tool | Input | Output (model text) |
|---|---|---|
| `dns_lookup` | `name`, `types?[]` | records per type with TTL, findings |
| `mx_lookup` | `domain` | MX hosts, IPs, PTR status, findings |
| `mail_auth_check` | `domain`, `dkim_selector?` | SPF, DKIM, DMARC verdicts plus findings, records |
| `blacklist_check` | `target` (IP or domain) | IPs checked, listed, unknown zones, findings |
| `tls_check` | `host`, `port?` | chain summary, expiry, protocol, findings |
| `domain_info` | `domain` | registrar, dates, statuses, NS, DNSSEC, findings |
| `http_headers` | `url` | redirect chain, security headers, findings |
| `email_header_analyze` | `headers` (≤ 64 KB) | hops, auth results, alignment, findings |

## Appendix B: file touch list (v1)

New:
- `shared/net-tools/*`
- `server/net-tools/*`
- `server/routes/net-tools.ts`, `server/routes/net-tools-internal.ts`
- `src/components/net-tools/ToolsTab.tsx` (panel)
- `src/gallery/net-tools.*`
- the tests listed in §6
- this spec

Edited:
- `server/harness-mcp-proxy.ts`, `server/harness-mcp-http.ts`
- `server/contracts.ts`
- `server/drivers/claude.ts`, `codex.ts`, `acp/core.ts`
- `server/index.ts` (capability kind, integration mount only; no route `if`)
- `server/mcp-registry.ts`, `server/sagax-internal-tools.ts`, `server/confidential-threads.ts`
- `server/config.ts`, `src/lib/feature-flags.ts`
- `server/request-auth.ts`, `server/tool-policy.generated.ts`
- `shared/permissions.ts`, `shared/requested-views.ts`, `shared/harness-commands.ts`
- `src/lib/composer-commands.ts`
- `src/components/bot-settings/panel-tabs.ts`, `src/components/BotSettingsDialog.tsx`
- `src/locales/en.json`, `fr.json`, `pt-br.json`, `source-hashes.json`
- possibly `ios/App/Features/Chat/Widget/ChatWidgetNodes.swift` (copy in a code block)

