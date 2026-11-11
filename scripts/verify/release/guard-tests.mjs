// The guard tests: one list, read by both gates. verify:merge runs it as its
// second stage; scripts/fast-gate.sh runs it on every lot through the
// "guard-tests" line of .fast-gate (#3509), so a guard a merge breaks shows
// on the next lot whatever files that lot touches.
//
//   node scripts/verify/release/guard-tests.mjs   prints the files that exist,
//                                                 one per line
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Tests that hold main to a line: a key nothing reads, a route without a
 * policy row, a golden or a budget. They fail for the PR that merged last,
 * so every PR runs them. */
export const GUARD_TESTS = [
  "scripts/testing/index-route-ratchet.test.ts",
  // #2086: JC product rules (unified chat, Always allow, no unrequested caution, fr dashes/UUIDs)
  // also #2081 / #2096 / #2098 / #2106 chat rules; #2091 Always allow / settings-driven guards
  "scripts/testing/jc-rules.guard.test.ts",
  "scripts/tool-policy/tool-policy-coverage.test.ts",
  "scripts/self-knowledge/knowledge.test.ts",
  // a docs site page and its generated repository copy (scripts/docs-copies.mjs)
  "scripts/docs-copies.test.mjs",
  "src/locales/unused-keys.test.ts",
  "src/locales/data-keys.test.ts",
  "src/lib/copy-text.guard.test.ts",
  "src/lib/view-transitions.test.ts",
  "src/lib/bundled-release-notes.test.ts",
  "src/components/dialogs-close.test.ts",
  "server/admission-golden.test.ts",
  "server/drain-coalescing-golden.test.ts",
  "server/drivers/agents-catalog-wire.test.ts",
  "server/drivers/agents-proxy.test.ts",
  "server/drivers/tool-scope-coverage.test.ts",
  // #1905: every approval or choice card reads the one Full access decision
  "server/approvals/full-access-gate.guard.test.ts",
  // #1386: docs/ media must be cited; no large GIF; PR proofs on pr-assets
  "scripts/testing/docs-media.guard.test.ts",
  // #2085 / #2125 (Refs #2086): the bot panel has only Activity and Library (no Roles tab)
  "src/components/bot-settings/panel-tabs.guard.test.ts",
  // #3292: AGENTS.md stays rules only (size ceiling, no dated journal section)
  "scripts/testing/agents-md.guard.test.ts",
];

/** The guard tests present under `root` (a lot may predate one of them). */
export function existingGuardTests(root) {
  return GUARD_TESTS.filter((file) => existsSync(join(root, file)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
  const files = existingGuardTests(root);
  if (files.length) console.log(files.join("\n"));
}
