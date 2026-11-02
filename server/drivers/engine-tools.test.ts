// Organization server: every native tool of every pinned engine CLI is
// classified. The inventory (engine-native-tools.json) is what the pinned
// CLI exposed, captured by scripts/capture/engine-native-tools.ts; each tool
// must be on the engine's allowlist (kept on an organization server) or its
// deny list (removed there), never on neither. Bumping an engine in
// engines.lock.json fails here until its inventory is captured again, and a
// new tool fails here until someone decides which list it belongs on.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ORG_ENGINE_TOOLS } from "./host-tools.ts";

interface Inventory { version: string; captured: string; how: string; solo: string[]; org: string[] }
const inventory = (JSON.parse(readFileSync(new URL("./engine-native-tools.json", import.meta.url), "utf8")) as { engines: Record<string, Inventory> }).engines;
const lock = JSON.parse(readFileSync(new URL("../../engines.lock.json", import.meta.url), "utf8")) as { engines: Array<{ id: string; name: string; version: string }> };
const capture = (id: string) => `node --experimental-strip-types scripts/capture/engine-native-tools.ts ${id} <path to the ${id} CLI>`;

describe("native tools of the pinned engines on an organization server", () => {
  it("covers every engine an organization server admits, at its pinned version", () => {
    const problems: string[] = [];
    for (const [id, policy] of Object.entries(ORG_ENGINE_TOOLS)) {
      const pinned = lock.engines.find((engine) => engine.id === id);
      if (!pinned) { problems.push(`${id} has an organization tool policy but no entry in engines.lock.json.`); continue; }
      const seen = inventory[id];
      if (!seen) problems.push(`${pinned.name} ${pinned.version} has no native tool inventory. Run ${capture(id)}, then classify what it lists in ${policy.allowName} or ${policy.denyName}.`);
      else if (seen.version !== pinned.version) problems.push(`engines.lock.json pins ${pinned.name} at ${pinned.version}, but its native tools were inventoried on ${seen.version}. Run ${capture(id)} with ${pinned.version}, then classify any new tool this test names.`);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("puts every native tool a pinned CLI exposes on its allowlist or its deny list", () => {
    const problems: string[] = [];
    for (const [id, policy] of Object.entries(ORG_ENGINE_TOOLS)) {
      const seen = inventory[id];
      if (!seen) continue;
      const known = new Set([...policy.allow, ...policy.deny]);
      for (const tool of new Set([...seen.solo, ...seen.org])) {
        if (known.has(tool)) continue;
        problems.push(
          `${id} ${seen.version} exposes the native tool "${tool}", which is on neither ${policy.allowName} (kept on an organization server) `
          + `nor ${policy.denyName} (removed there), in server/drivers/host-tools.ts. Decide which: the allowlist if it only works on the conversation `
          + `or reaches Sagax's MCP servers; the deny list if it runs a command, reads or writes a file, starts a process or a browser, opens a URL `
          + `from the Sagax server, or reaches a vendor service the turn is not part of.`
          + (policy.enforced === "pinned inventory" ? " This engine takes no allowlist: a denied tool also needs its switch in the driver's flags." : ""),
        );
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("keeps every tool an organization turn has today (the allowlist drops nothing)", () => {
    const problems: string[] = [];
    for (const [id, policy] of Object.entries(ORG_ENGINE_TOOLS)) {
      const seen = inventory[id];
      if (!seen) continue;
      for (const tool of seen.org) {
        if (policy.allow.includes(tool)) continue;
        // Codex keeps offering apply_patch: the read-only sandbox and a
        // declined approval stop it (CODEX_HOST_TOOLS).
        if (policy.enforced === "pinned inventory" && policy.deny.includes(tool)) continue;
        problems.push(`${id} ${seen.version} offers "${tool}" to an organization turn, but ${policy.allowName} does not list it: add it there, or remove it from the turn first.`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("never lists a tool as both kept and removed", () => {
    for (const [id, policy] of Object.entries(ORG_ENGINE_TOOLS)) {
      const both = policy.allow.filter((tool) => policy.deny.includes(tool));
      expect(both, `${id}: ${both.join(", ")} on both ${policy.allowName} and ${policy.denyName}`).toEqual([]);
    }
  });
});
