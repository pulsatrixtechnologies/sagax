// The seam: createCoordinator returns the runtime coordinator, and the
// test helper reads the same rows the server works from.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createCoordinator, type CoordinatorHost, type HandoffView } from "./coordinator.ts";
import { RuntimeCoordinator } from "./runtime-coordinator.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { readHandoffs } from "./testing/handoff-rows.ts";

function fakeHost(): CoordinatorHost {
  return {
    validate: vi.fn(() => undefined),
    busy: vi.fn(() => false),
    run: vi.fn(async (node: HandoffView) => ({ ok: true, text: `${node.botId} done` })),
    report: vi.fn(),
    changed: vi.fn(),
    names: vi.fn((node: HandoffView) => ({ requester: "Chief", assignee: node.botId })),
    park: vi.fn(),
    levelOf: vi.fn(() => ({ level: "ask" as const })),
    chiefOf: vi.fn(() => false),
  };
}

describe("createCoordinator", () => {
  it("returns the runtime coordinator, whose rows the test helper reads back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "coordinator-"));
    try {
      const coordinator = createCoordinator({ dataDir: dir, host: fakeHost(), log: () => {} });
      expect(coordinator).toBeInstanceOf(RuntimeCoordinator);
      const chief = { botId: "chief", threadId: "chief-chat" };
      const { node, duplicate } = coordinator.enqueue(chief, "gen-1", undefined, { botId: "builder", threadId: "builder-work" }, "builder",
        "Build it", false, false, "Ship it", undefined, { kind: "user", request: "Ship it" });
      expect(duplicate).toBe(false);
      expect(node).toMatchObject({ status: "queued", botId: "builder", parentId: "gen-1", kind: "work" });
      const rows = readHandoffs(dir);
      expect(rows.map((row) => [row.id, row.status])).toEqual([["gen-1", "source"], [node.id, "queued"]]);
      expect(rows[0]).toMatchObject({ origin: { kind: "user", request: "Ship it" } });
      coordinator.close();
    } finally {
      removeTempDir(dir);
    }
  });
});
