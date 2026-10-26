import { describe, expect, it, vi } from "vitest";
import { handleCloudAgentInternal } from "./cloud-agents-internal.ts";
import type { CloudAgentManager } from "../cloud-agents/manager.ts";

describe("cloud-agents internal", () => {
  it("lists agents for the launching person only", async () => {
    const manager = {
      syncBot: vi.fn(async () => {}),
      list: vi.fn(() => [
        { id: "ca_a", principalId: "pr_alice", botId: "b1" },
        { id: "ca_b", principalId: "pr_bob", botId: "b1" },
      ]),
    } as unknown as CloudAgentManager;
    const answer = await handleCloudAgentInternal("list", {}, {
      manager,
      principalId: "pr_alice",
      botId: "b1",
      threadId: "t1",
    });
    expect(answer.text).toContain("ca_a");
    expect(answer.text).not.toContain("ca_b");
  });

  it("launches a Perspicax run with its environment and engine, and says where it shows", async () => {
    const launch = vi.fn(async () => ({ id: "ca_x", name: "Corriger", status: "queued", provider: "perspicax" }));
    const manager = { launch } as unknown as CloudAgentManager;
    const answer = await handleCloudAgentInternal("launch", { provider: "perspicax", prompt: "Corrige", env_id: "env_1", engine: "codex" }, {
      manager,
      principalId: "pr_alice",
      botId: "b1",
      threadId: "t1",
    });
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({
      botId: "b1",
      threadId: "t1",
      launch: expect.objectContaining({ provider: "perspicax", envId: "env_1", engine: "codex" }),
    }));
    expect(answer.text).toContain("Code section");
  });
});
