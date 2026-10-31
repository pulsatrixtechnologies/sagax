# Grok Bot behavior convergence, preserving Sagax strengths

Baseline: Sagax 0.8.23, commit `8035bbf55`, compared with Grok Bot
0.78.1 and the official documentation checked on 2026-10-31. This is a
source and documented-behavior comparison. Comparative runtime reliability
and visual parity have not yet been measured.

The target is the same observable outcome for the same supported action:
navigation, response lifecycle, files, background work and recovery. Model
wording and provider-specific abilities are not deterministic contracts.

## What must survive every lot

- Sagax identity, skins and personalization.
- Multiple engines, personal provider accounts, local models and self-hosting.
- Personal autonomy: the person's bot can manage their own environment.
  No additional admin requirement or confirmation for personal operations.
  Keep explicit organization Ask/Deny rules and actual cross-person boundaries.
- Capabilities with an honest account of what the selected engine receives.
- One personal skill library, complete plugins and native Claude loading.
- Existing Pages comments, sharing and state; advanced routines, telephony,
  semantic recall, split views and team coordination.

Behavior shared with Grok is the default path. Additional Sagax abilities
remain accessible without making that path harder to use.

## Evidence and sequence

| Lot | Current evidence | Implementation and acceptance |
| --- | --- | --- |
| 1. Discoverable Capabilities | Bot index overflow points to `skills_list`, but its catalog and GET route depend on authoring. Me is unbounded; plugin scanning silently stops after 40 files. Capabilities metrics measure only the bot index. | One scoped inventory feeds direct turns, rooms, preview, metrics and paginated discovery. Bound the aggregate prompt. A reference outside it must remain searchable and readable. Keep authoring settings independent and Claude plugins native. |
| 2. Engine continuity | Lot 1 extends managed bot, Me and assigned Library discovery to API engines when both retrieval tools are permitted. Explicit `/skill` still inlines reviewed instructions. API plugin distribution remains separate. | Extend complete plugin distribution to API engines where its files and declared dependencies can actually execute. Preserve the existing organization Flow engine decision. Verify identical selected skill bytes before and after an engine switch and failover. |
| 3. Reliable execution | SQLite runtime/coordinator coexist with older dispatch and continuation paths. Existing voice and delivery tooling already covers part of the contract. | Follow `docs/runtime-contract.md`, move remaining delivery paths behind the same state machine incrementally. Reproduce cancel, reconnect, provider limit, restart during a tool call and concurrent sends. Require no duplicate writes, no lost accepted message and a terminal or explicit waiting state. |
| 4. Files and media | Current attachment limits are lower than documented Grok limits. `make_video` reports a provider gap. | Implement streaming/resumable uploads, storage and proxy support before increasing advertised limits. Connect a real video provider end to end. Verify progress, cancellation, retry, supported formats and failure receipts. Preserve native media producers. |
| 5. Interface | Sagax Pages currently overlays the composer; Grok documents a full-screen Page with chat beside it. Sagax already has rich Page features and split views. | Capture both apps at the same viewport and task state. Align navigation, composer, busy sends, files, Pages/chat layout, routines and approval feedback screen by screen. Preserve Sagax themes and extra Page functions. Verify keyboard, accessibility and small screens. |
| 6. Reliability qualification | Existing real/synthetic voice benchmark, device checks and runtime tests provide reusable infrastructure. No comparative failure-rate baseline exists. | Record the same task corpus on both products: completion rate, duplicate/lost messages, restart recovery and p50/p95 response latency. Run bilingual real voice with enforcement. Complete physical iPhone/Watch approval checks. Full suite once at version cut. |

Lot 1 starts on branch `feat/grok-convergence-capabilities`. It does not
claim API plugin parity, UI parity, video readiness or measured reliability
parity. Each later lot must preserve the invariants above and
add evidence to this table before it is called complete.

## Lot 1 contract

`server/skill-discovery.ts` renders at most 30 references and 4,000 UTF-8
bytes, including notices. Descriptions shrink before names are omitted.
The count includes indexed plugin commands and agents. `promptIndex`
measures that exact aggregate block; native Claude plugin entries consume
no prompt budget and do not count as omissions.

`skills_list` is a read operation, available independently of skill
authoring. It searches names, reviewed descriptions, sources and scopes,
then pages in stable scoped identity order. Different plugins may expose
the same nested skill name. The result includes a discovered total and next offset. Plugin metadata scans
are bounded globally across selected folders: 512 references, 4,096 visited
entries and 2 MiB read, with depth and per-file limits retained. A partial
scan is explicit in the prompt, list and Capabilities UI. This is not a
claim that arbitrary plugins fit in the index; native plugin loading and
file tools remain available. A manifest/cache lifecycle is the follow-up
for exhaustive metadata of unusually large plugins.
Disabled descriptions, instruction bodies and staged gists stay out of
discovery output. `skill_manage` and the staging POST retain their settings.

Discovery paths address `workspace_read`: bot skill revisions, the active
person's Me library, selected plugin folders and currently assigned,
verified library skills. An old library alias grants no access after
disable, unassignment, shadow replacement or integrity failure. No
organization prompt or list needs a host filesystem path. Native file-tools
paths remain separate from managed aliases and are used only when managed
retrieval is absent. API prompts and receipts require both `skills_list`
and `workspace_read` to be allowed by tool selection; provider tools-off
mode serves no managed index. Direct turns, rooms and preview use this
same rule. The internal list uses the actual running engine, including a
failover, rather than only the bot's saved selection.

Verification: `server/skill-discovery.test.ts`,
`server/skill-discovery.e2e.test.ts`, `server/plugin-turn.test.ts`,
the agents catalog wire goldens, `server/openai-tools.e2e.test.ts` and
existing skill/workspace scope tests, including the organization room MCP
fixture with different owner and speaker libraries.
Fixtures own temporary data and fake engines. No user app data is involved.

## References

- [Grok Bot changelog](https://x.ai/changelog/bot)
- [Chat and collaboration](https://docs.x.ai/grok-bot/chat-and-collaboration)
- [Files and results](https://docs.x.ai/grok-bot/files-and-results)
- [Skills, routines and automations](https://docs.x.ai/grok-bot/skills-routines-and-automations)
- [Computer and apps](https://docs.x.ai/grok-bot/computer-and-apps)
- [Approvals, security and privacy](https://docs.x.ai/grok-bot/approvals-security-and-privacy)
- [Catalog budget follow-up, #1703](https://github.com/pulsatrixtechnologies/sagax/issues/1703)
- [Physical device follow-up, #1708](https://github.com/pulsatrixtechnologies/sagax/issues/1708)
