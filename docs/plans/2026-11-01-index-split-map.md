# Sagax `server/index.ts` region map (wave 0b)

Date: 2026-11-01. Measured at HEAD `0f14ddb11` (`refactor/1388-w0b`, post wave 0a merge into `feat/0825-integration`).

Workers must locate slices by **anchor path literals**, not by these line numbers. Regenerate after each merge:

```
S=$(rg -n 'const handleRequest' server/index.ts | head -1 | cut -d: -f1)
awk -v S="$S" 'NR>=S && /(path === "\/|path\.match\(|\.exec\(path\)|path\.startsWith\()/ {print NR" "$0}' server/index.ts
```

## Facts at this HEAD

| Item | Value |
|---|---|
| `server/index.ts` lines | 57,161 |
| `handleRequest` | 43782 to 56405 (~12.6k lines) |
| `startTurn` | 21902 |
| `runGroupMemberTurn` | 27066 |
| `dispatchRoutes(ROUTES, …)` | 44340 (right after the auth gate, before inline routes) |
| Ratchet `path === "/` | 185 |
| Ratchet `path.match(` | 91 |
| Ratchet `path.startsWith(` | 14 |
| Ratchet `.exec(path)` | 24 |
| Ratchet `.test(path)` | 9 |
| Ratchet `.includes(path)` | 4 |

Print the six counts: `node scripts/testing/index-route-count.mjs`.

## Wave 0b anchors (empty comments; one line per slice)

Import anchors (near the last `./routes/` imports, before `const PORT`):

- `IMPORT-ANCHOR:internal-memory` (I2)
- `IMPORT-ANCHOR:internal-environments` (I1)
- `IMPORT-ANCHOR:internal-sessions` (I4)
- `IMPORT-ANCHOR:internal-requests` (I3)
- `IMPORT-ANCHOR:internal-bot-chat` (I5)
- `IMPORT-ANCHOR:internal-integrations` (I6)
- `IMPORT-ANCHOR:testing-routes` (P7)
- `IMPORT-ANCHOR:team-map` (P1)
- `IMPORT-ANCHOR:routines-http` (P2)
- `IMPORT-ANCHOR:bots-messages` (B3)
- `IMPORT-ANCHOR:threads-http` (T1)
- `IMPORT-ANCHOR:uploads` (P3)
- `IMPORT-ANCHOR:groups-http` (P4)
- `IMPORT-ANCHOR:bots-core` (B1)
- `IMPORT-ANCHOR:local-computer` (P6)
- `IMPORT-ANCHOR:bots-content` (B2)
- `IMPORT-ANCHOR:instances` (P5)

`INTERNAL_ROUTES` registration order (original file order of first path):

1. `INTERNAL_ROUTES-ANCHOR:internal-memory`
2. `INTERNAL_ROUTES-ANCHOR:internal-environments`
3. `INTERNAL_ROUTES-ANCHOR:internal-sessions`
4. `INTERNAL_ROUTES-ANCHOR:internal-requests`
5. `INTERNAL_ROUTES-ANCHOR:internal-bot-chat`
6. `INTERNAL_ROUTES-ANCHOR:internal-integrations`

`ROUTES` registration order (original file order of first path of each public slice):

1. `ROUTES-ANCHOR:testing-routes`
2. `ROUTES-ANCHOR:team-map`
3. `ROUTES-ANCHOR:routines-http`
4. `ROUTES-ANCHOR:bots-messages`
5. `ROUTES-ANCHOR:threads-http`
6. `ROUTES-ANCHOR:uploads`
7. `ROUTES-ANCHOR:groups-http`
8. `ROUTES-ANCHOR:bots-core`
9. `ROUTES-ANCHOR:local-computer`
10. `ROUTES-ANCHOR:bots-content`
11. `ROUTES-ANCHOR:instances`

`PRE_AUTH_ROUTES` skeleton lives in `server/routes/table.ts` (unused until wave 4).

## Shared helpers hoisted in wave 0b

Leaf modules (never import `index.ts`):

| Module | Exports | Used by (examples) |
|---|---|---|
| `server/request-speaker.ts` | `speakerFor`, `personKey`, `legacyPersonKey` | B1, B3, P4, messaging |
| `server/bot-owner.ts` | `recordedBotOwner`, `effectiveBotOwner(bot, localOperatorId)` | I2, I3, I5, I6, B1, B2, P2, P4 |
| `server/cloud-thread-refusal.ts` | `cloudThreadRefusal`, `cloudGuestSendRefusal` (always null) | B1, B3, P4 |
| `server/request-auth.ts` | `sessionPrincipal` (added) | B1 and many wiring sites |

`index.ts` keeps a one-line `effectiveBotOwner(bot)` wrapper that passes `localPrincipalId()`.

## Map of `handleRequest` at this HEAD

| Region (HEAD lines) | Slice | Prefix / contents |
|---|---|---|
| 43800 to 44606 | wave 4 | pre-auth: health, auth, pair, pairing, mcp-oauth, org/import, events, workspace-backup, custom-domain, shared-computers, desktop |
| 44607 to 44664 | P7 | `/api/testing/*` |
| 44665 to 44937 | stays | internal capability gate + `requiredCapabilityKind` |
| 44938 to 45169 | I2 | hook, tool-result, widget, options-card, page-comments, group-memory, reaction, memory, workspace |
| 45170 to 45685 | I1 | browser, sandbox, personal-mcp, desktop, workplace, computer, messages, phone, shared-computers |
| 45686 to 45931 | I4 | agents, threads, attach-file, vm-exec, rooms |
| 45932 to 46467 | I3 (+ I2 team-memory) | routines, requests; `/api/internal/team-memory` is I2 mid-block |
| 46468 to 46683 | I4 | session-search, session-read, skills |
| 46684 to 48019 | I5 | ask-bot through create-room |
| 48020 to 48305 | I6 | mcp-servers, github-connect, request-credential, voice-note, perspicax |
| 48306 to 48350 | I1 | computer-control |
| 48351 to 48393 | P1 | `/api/team-map` |
| 48394 to 48735 | P2 | `/api/routines*`, `/api/routine-runs*`, `/api/calendar-calls`, `/api/webhooks` |
| 48736 to 48786 | B3 | bot browser live/action |
| 48787 to 49303 | T1 | `/api/events` (post-gate), `/api/bots` list, thread files and related |
| 49304 to 49615 | P3 | `/api/attachments`, `/api/files`, `/api/search` |
| 49616 to 49645 | P4 | `/api/groups` list/create |
| 49646 to 49993 | P1 | `/api/teams/*`, `/api/team-library/*` |
| 49994 to 50681 | P4 | `/api/groups/:id/*` |
| 50682 to 50740 | P1 | `/api/sidebar-sections` |
| 50741 to 52072 | B1 | `/api/bot-defaults*`, `/api/bots` create and profile (continues after B2) |
| 52073 to 52118 | P6 | `/api/local-computer/interrupt` |
| 52119 to 52333 | B2 | `/api/bots/:id/skills*`, skills-library |
| 52334 to 52435 | P1 | `/api/team-memory`, `/api/section-context` |
| 52436 to 52580 | B1 | `/soul/*`, system-prompt, overview, cards |
| 52581 to 54137 | B3 (+ B1 tasks) | `/messages`, queue, respond, interrupt; `/projects` and `/tasks` (B1) sit in this span |
| 54138 to 54307 | P1 | `/api/team-computers`, `/api/computers/*` |
| 54308 to 54520 | P6 | `/api/local-computer*` |
| 54521 to 54619 | P5 | `/api/health`, browser-engine, edition, brand |
| 54620 to 54646 | T1 | `/api/threads/:id/events` |
| 54647 to 56166 | P5 | plan-usage, keys/test, decisions, admin-activity, instances*, cli-*, `/api/mcp/servers*`, `/api/config` |
| 56167 to 56405 | P6 | `/api/bots/:id/computer/*` tail |

## Hard constraints (unchanged)

1. Everything in `handleRequest` before `dispatchRoutes(ROUTES, …)` (44340) runs before the auth gate for some paths; pre-auth bodies stay until wave 4.
2. Moved public routes run before every remaining inline route. Keep original relative order inside each module. Register via the anchors above.
3. `let m` in `handleRequest` is shared scratch; moved code declares its own local.
4. Type-only imports must be `import type` (type stripping at boot).
5. Route modules never import `index.ts`. madge `server` must not gain a cycle from a slice.
