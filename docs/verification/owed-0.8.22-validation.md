# Owed validation after 0.8.22 (#1895)

Release 0.8.22 shipped without the remaining live and full-suite checks.
This recipe records what local automation now covers, and what still needs
a live organization session, an iOS upload, or the next version cut.

Tracker: [#1895](https://github.com/pulsatrixtechnologies/sagax/issues/1895).

## Local automation (run these)

```sh
pnpm exec vitest run \
  server/drivers/codex/mcp-mount.test.ts \
  server/perspicax-mcp-bridge.test.ts \
  server/safety/safety-review.test.ts \
  server/routines/routine-full-approval.e2e.test.ts \
  scripts/check-ios-app-intent-vocabulary.test.mjs \
  scripts/testing/verification-docs.test.ts
node scripts/check-ios-app-intent-vocabulary.mjs
```

| #1895 item | Local proof | Limit |
| --- | --- | --- |
| Multi-profile internal bridge | `isolatedPerspicaxBridge` keeps two mounts' reserved variables under distinct prefixes; the stdio bridge restores only its own prefix from a shared parent env (`server/drivers/codex/mcp-mount.test.ts`, `server/perspicax-mcp-bridge.test.ts`). Third-party MCP still cannot set reserved names (`server/drivers/codex.test.ts`). Role switches and tool refresh stay covered by the fake Perspicax MCP and routine smoke. | Not a live organization session with two real Perspicax profiles. |
| Full-level webhook mail | Isolated enforce-mode E2E allows `outlook__move_message` at Full; mailbox organization is not treated as outbound send; delete/bulk stay destructive; org Ask/Deny still holds (`server/routines/routine-full-approval.e2e.test.ts`, `server/safety/safety-review.test.ts`, [full-access.md](full-access.md)). | Provider planning and mail delivery are synthetic. No live mailbox change. |
| Siri vocabulary files | Source ships `AppIntentVocabulary.plist` for Base, en, fr and pt-BR with examples for `INSendMessageIntent` and `INStartCallIntent`. `scripts/check-ios-app-intent-vocabulary.mjs` fails if a locale or intent example disappears. | Does not prove App Store Connect cleared ITMS-90626 after an upload. |
| Full unit and e2e suites | Commands below. | Runs once at the version cut ([releasing.md](../releasing.md), AGENTS.md). Not part of ordinary PR gates. |

Related local gates already in the release flow: `pnpm test:routine-smoke`
([routine-smoke.md](routine-smoke.md)).

## Device / live / release remainder

Do these on the organization server, an iPhone build, or the cut. Record the
result on #1895 (or close with evidence when a later release already did).

1. **Live multi-profile bridge** (owner or release agent): two or more real
   Perspicax profiles in one session on the organization server. Confirm
   reserved variables stay isolated per profile and are restored at start;
   tool selection, mount renaming, approval rules and the third-party MCP
   guard unchanged.
2. **Live Full webhook mail** (owner or release agent): replay a real
   incoming mail through a Full-level webhook routine in enforce mode.
   Move/label allowed; delete/bulk still held; org Deny / Ask-first still
   honored. No production mailbox of a client.
3. **Next iOS binary** (release flow): confirm the vocabulary files ship in
   the uploaded app and the six App Store Connect warnings (missing examples
   for message and call intents in three languages) are gone.
4. **Full suites at the next cut** (release flow):

```sh
pnpm test
pnpm test:electron
pnpm test:packaged-server
pnpm test:routine-smoke
```

Triage each failure as a real bug (own issue) or a stale test.

## Status rule

Local automation here does not close #1895. Closing needs the live or
full-suite results above, or evidence that a later release already recorded
them.
