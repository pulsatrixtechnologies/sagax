# Native Claude artifact tools

Issue #1990: cloud turns passed a closed `--tools` list without `ArtifactData`
or `ArtifactComments`, and denied their parent `Artifact` as a host tool.
Print sessions also default artifacts off, and compact prompts disabled native
ToolSearch. These independently prevented the artifact database from being used.

`server/drivers/host-tools.ts` now keeps all three tools in the organization
allowlist and removes the parent deny. `turn-prepare-mcp.ts` defaults
`CLAUDE_CODE_ARTIFACT=1` and `CLAUDE_CODE_ARTIFACT_TOOLSET=1` and keeps native
ToolSearch on, including with a compact prompt. The compact Sagax MCP catalog
still uses its own directory. Explicit engine environment settings remain in
effect. The native tools use the existing permission broker, not a new grant.

## Availability

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

## Evidence, 2026-11-04

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
