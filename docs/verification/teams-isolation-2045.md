# Team isolation (#2045)

Each person on an organization server sees and manages only their own teams,
their own bots and their own Primary Bot. Teams are the person's sidebar
groups (one source). Sub-teams nest up to four levels. Existing teams migrate
to their creator (or the server owner when unknown).

## Checks

```sh
pnpm exec vitest run \
  src/lib/team-map-access.test.ts \
  src/lib/viewer-teams.test.ts \
  src/lib/team-writes.test.ts \
  src/lib/section-tree.test.ts \
  src/lib/primary-bot.test.ts \
  src/lib/personal-sections.test.ts \
  src/lib/team-map.test.ts \
  server/rooms/section-channels.test.ts \
  server/rooms/section-link.test.ts \
  server/rooms/team-data-keys.test.ts \
  server/pages/published-teams.test.ts \
  server/routes/team-computers.test.ts \
  server/computer/team-computers.test.ts \
  --maxWorkers=2
```

Organization e2e (two people, neither sees the other's team):

```sh
pnpm exec vitest run server/org/org-rights.e2e.test.ts -t "2045" --maxWorkers=1
```

## Criterion 5 audit (shared data on one server)

| Area | Isolation |
|---|---|
| Teams / section channels | Per owner (`section-channels.json`); API/SSE via `orgVisibleSections` |
| Team instructions / memory | Keyed by owner + section id |
| Primary Bot | One per person (`setPrimaryBot`) |
| Bot grants / approvals | Per owner |
| User preferences (sidebar, sub-teams, canvas) | Per principal |
| Person settings / personal skills | Per principal |
| Shared bot wire `section` / `sectionId` | Stripped for other viewers |
| Team export | Caller's teams and bots only |
| `suggestedName` / published-teams keys | Scoped / migrated to section id |
| Team computers inventory | Filtered to caller's section ids (+ unassigned); assignment uses caller's teams |
| Routines store (`routines.json`) | Single file; filtered on read by bot visibility / runAs |
| Installation skills library | Shared by design for the server; personal skills stay per principal |
| `bot-preferences.json` | Keyed by bot id (follows the bot) |
| `command-allowlist.json` | Keyed by bot id; bots do not change owner after create |
| Group memory | Shared by design for the room |

Captures of the Team map and sidebar before/after isolation live with the
lifecycle UI evidence under `.omb-scratch/verify-evidence/` when
`SAGAX_UI_E2E=1` runs `scripts/testing/team-lifecycle-ui.e2e.test.ts`.
