# Native Claude artifacts

Covers issue #1990 (native Artifact tools on cloud and routine turns) and
issue #2018 (claude.ai pages through the person's own Claude account: cards,
comments, `claude_artifact`, Electron window).

## #1990: native Artifact / ArtifactData / ArtifactComments

Cloud turns passed a closed `--tools` list without `ArtifactData` or
`ArtifactComments`, and denied their parent `Artifact` as a host tool.
Print sessions also default artifacts off, and compact prompts disabled native
ToolSearch. These independently prevented the artifact database from being used.

`server/drivers/host-tools.ts` now keeps all three tools in the organization
allowlist and removes the parent deny. `turn-prepare-mcp.ts` defaults
`CLAUDE_CODE_ARTIFACT=1` and `CLAUDE_CODE_ARTIFACT_TOOLSET=1` and keeps native
ToolSearch on, including with a compact prompt. The compact Sagax MCP catalog
still uses its own directory. Explicit engine environment settings remain in
effect. The native tools use the existing permission broker, not a new grant.

### Availability

| Configuration | Result |
| --- | --- |
| Claude subscription sign-in, supported CLI and account policy | Native artifact family is eligible, including routine and cloud turns. |
| Solo Claude using its CLI subscription sign-in | Same behavior. No built-in allowlist unless explicitly configured. |
| Claude using a personal or organization API key, gateway or cloud provider | No claude.ai artifact account. Flags do not create one. |
| Codex, Grok or another engine, including an Auto selection | No Claude native artifact tools. |
| Explicit engine disable, tool selection or Claude account policy denial | Those settings still determine availability. |
| Cloud job runner using the managed model proxy | API access, not a claude.ai subscription session. No artifact account. |

Routine readiness recognizes the exact tool names in the effective prompt.
Known incompatible engines and API access get `engine_artifacts` with a clear
subscription sign-in instruction, translated in the viewer. Unknown account
facts pass. The account cache includes the resolved route, and the blocked
notice survives restart without repeating for every run.

[Claude's artifact requirements](https://code.claude.com/docs/en/artifacts#availability)
document the required subscription sign-in and the default-off print/SDK
behavior. Account policy remains a provider requirement, not a Sagax admin gate.

### Evidence, 2026-11-04

- Local CLI: `claude --version` reported 2.1.318.
- `claude --help`: `--tools` selects available built-ins;
  `--allowedTools` grants permission and does not add tools to that set.
  `--strict-mcp-config` selects MCP servers, not native built-ins.
- Inspection of that installed binary confirmed the headless artifact gate
  accepts `CLAUDE_CODE_ARTIFACT`, and the separate deferred data/comments
  family uses `CLAUDE_CODE_ARTIFACT_TOOLSET`.
- Two disposable CLI launches used a synthetic API key, empty HOME/config,
  proxies and model URL bound to a closed loopback port. Both emitted an init
  inventory with no Artifact tools, even when the artifact flags and explicit
  `--tools Artifact,ArtifactData,ArtifactComments,ToolSearch` were set. This
  confirms flags do not manufacture subscription access. No provider request
  or artifact mutation was performed; both CLI process groups were stopped.
- The fake CLI launch regressions cover ordinary and compact cloud turns,
  the native allowlist, denylist, flags, search and permission broker. They
  failed before the fix. Readiness regressions cover engine changes, API and
  subscription access, effective prompts and persisted owner notices.

The subscription tool execution itself was not exercised against a live
account. This record proves launch and readiness contracts, not an end to end
artifact database transaction.

## #2018: claude.ai pages through the person's own account

Plan lots 2 to 8 ship the Sagax surface. Lot 1 (republish the dispatch viewer
mirror under the bot's Claude account, then update tenant references) is an
operational step after this code is live on the server. See Lot 1 runbook
below. The in-repo Lot 1 path is covered: a foreign `other_account` result
tells the bot to publish from workspace HTML (or a paste) and return the new
URL (`claudeArtifactOtherAccountGuidance` / `claudeArtifactCopyPrompt`); the
internal publish-from-file route notes the new owned URL.

### Surface

| Piece | Where |
| --- | --- |
| Consent card when the page is another claude.ai account (`localDisplayOnly` / `other_account`) | `shared/claude-chat-blocks.ts`, `ClaudeArtifactCard`, iOS `ClaudeArtifactCardView` |
| Artifact tools allowed in Full access; reads allowed in Auto | host tools / permission policy (#2018 lot 3) |
| `parseArtifactPublish` prefers `tool_use_result` | `shared/claude-chat-blocks.ts` |
| Claude CLI pin | `engines.lock.json` (2.1.318 at the cut) |
| Desktop / iOS cards for `claude.ai/artifact` links | `ClaudeArtifactCard`, Electron `openClaudeAi`, iOS companion |
| Comment reply / resolve cards + per-person wake routine | `/api/claude-artifacts/comments`, `comments-routine.ts` |
| `claude_artifact` agents tool for non-Claude engines | `agents-artifact-tools.ts`, `/api/internal/claude-artifact`, `runner.ts` |

Rules (also in `docs/code/pages.md`):

- Calls run only in the speaking person's Claude config dir. No account pick
  by the runner. No Claude login is `409 claude_not_signed_in`.
- A page of another claude.ai account returns `blocked: other_account`. The
  copy prompt tells the bot to publish from an HTML file (or a paste), then
  return the new URL so references can be updated. A foreign page cannot be
  read with `Artifact`.
- Publish input is `html` or a workspace `file` only. Local path keys inside
  `input` are refused. Results are untrusted data, fenced.
- Owned publishes are tracked per person and create the lazy ACTIVE routine
  "Commentaires des artefacts" (code pre-check `claude_artifact_comments`).

### Targeted tests

```bash
pnpm exec vitest run \
  shared/claude-chat-blocks.test.ts \
  server/claude-artifacts/runner.test.ts \
  server/claude-artifacts/service.test.ts \
  server/routes/claude-artifacts.test.ts \
  server/drivers/agents-call-artifacts.test.ts \
  server/drivers/claude/stream-content.test.ts \
  src/components/ClaudeArtifactCard.dom.test.ts \
  electron/artifact-window.test.mjs
```

Gallery: `src/gallery/claude-artifact-cards.tsx` (consent, owned, shared,
signed-out). Headless UI only on the ports this worktree starts (5176-5206).

### Lot 1 runbook (dispatch viewer mirror)

Goal: the dispatch history viewer (Flow skill `mirroring-dispatch-journal`,
page `library/claude-artifact/dispatch/skills/mirroring-dispatch-journal/assets/dispatch-history.html`
in the Pulsatrix Flow plugin) is published under the **bot's** claude.ai
account, then the tenant's dispatch viewer URL is updated.

Blocked until: a Sagax **server** image that includes `claude_artifact` and
`server/routes/claude-artifacts.ts` is live on the tenant host. Source tags
from `pulsa-v0.8.51` onward carry that surface. As of 2026-11-06 the GOX
Sagax image commit still predated those routes, so Lot 1 live stays blocked
on the next Sagax server roll that includes #2018. Desktop / `feat/next-0828`
alone is not enough.

Steps (after that server roll, on the tenant host, neutral wording):

1. Confirm the speaking person / bot has a Claude subscription sign-in in
   Sagax (Settings > Models, Claude) that owns the account that should hold
   the viewer.
2. Fill the page `TENANT` block from the tenant reference (`px_flow.py
   reference boards`, `team`, `sources`, and the tenant's routines). Never
   commit tenant values back into the product asset.
3. Ask the bot (or call `claude_artifact`) to publish from that HTML file:
   `{ tool: "Artifact", input: { action: "publish", ... }, file: "<workspace path to the filled page>" }`.
   Do not try to `Artifact` `read` / `update` the previous URL if it belongs
   to another claude.ai account: that returns `other_account`.
4. Keep the new `https://claude.ai/artifact/<id>` URL.
5. Update the tenant reference row « dispatch viewer URL »
   (`px_flow.py reference sources`, file `sources-and-accounts.md` in the
   tenant plugin) and any routine that hard-codes the old URL.
6. Smoke: one dispatch pass mirrors with `viewer_set_document` / ArtifactData
   `set` into the new URL; backup / retention commands still use that URL.

Refs stay outside the public Sagax repo (tenant plugin). Public docs name the
mechanism only.
