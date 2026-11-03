# Merge order for the MCP permissions branch

Checked on 2026-10-15 against the open pull requests 492 to 518, by file
overlap with this branch (`git diff --name-only origin/main...HEAD`) and a
local `git merge-tree` of each head against this branch and against main.
This branch is #508.

## #497 is merged into this branch

The first check (2026-10-14) missed one conflict with #497 (native claim
tools): both branches added `PerspicaxMcp.callTool` to
`server/perspicax/perspicax-mcp.ts`, with different signatures (`tool` here, `name` in
#497) and different answers (`{ status, body }` here, `PerspicaxToolAnswer` in
#497), on top of the conflicts in `server/drivers/agents-catalog.ts` and
`server/index.ts`. The branch of #497 (with its route moved to
`server/routes`) is now merged into this one and the conflict is resolved:
one `callTool`, #497's, and the Perspicax gateway route
(`server/routes/perspicax-tool-internal.ts`) calls it. So #508 contains #497
and must merge after it.

## Overlap and real conflicts

| PR | State | Shared files with this branch | Merge with this branch |
|---|---|---|---|
| 497 native claim tools | open | contained in this branch | merge 497 first; this branch then merges on top of it |
| 495 native flow compute tools | open | `server/index.ts` | clean |
| 496 recognize memory v2 tools | open | `server/perspicax/perspicax-mcp.test.ts` | clean |
| 517 bot owner permissions | open | `server/index.ts`, `server/tool-policy.generated.ts` | clean; the merged `server/index.ts` keeps the route ratchet at its numbers |
| 518 menu simplification | open | none | conflicts with main itself (`ChatView.tsx`, locales), not with this branch |
| 492 to 494, 498 to 507, 509 to 516 | open | none | clean |

## Recommended order

1. The unrelated pull requests (492 to 494, 498 to 507, 509 to 516, 518 once
   it is rebased on main), in any order. They do not interact with this work.
2. 496, then 495. Both merge cleanly in either order, with 497 and with this
   branch.
3. 497 (native claim tools).
4. 517 and this branch (#508), in either order: they merge cleanly together.
   After the last of them, rerun `node scripts/tool-policy/generate.ts` (both
   add rows to `server/tool-policy.generated.ts`), then
   `scripts/testing/index-route-ratchet.test.ts`,
   `scripts/tool-policy/tool-policy-coverage.test.ts`,
   `server/mcp/mcp-permissions.test.ts` (it fails while a catalog tool has no
   permission) and `server/drivers/agents-catalog-wire.test.ts`. If a
   catalog golden moves, regenerate it with `UPDATE_AGENTS_CATALOG_GOLDENS=1`
   and set `BUDGET_BASELINE` by hand from the printed sizes.

The permission registry tests are the safety net for steps 2 to 4: a catalog
tool, or a tool Perspicax 1.8.28 serves, without a row in `MCP_PERMISSIONS`
fails them, so no merge can leave one to be refused by omission in enforce.
