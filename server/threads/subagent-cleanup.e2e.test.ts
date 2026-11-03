// A turn that fails while one of its sub-agents runs leaves no sub-agent
// shown at work: its row closes with the turn.
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../../scripts/control-omb.ts";

describe.skipIf(process.platform === "win32")("a failed turn's sub-agents", () => {
  it("close with the turn instead of running for good", async () => {
    const fixture = await launchVerificationServer();
    const evidence: unknown[] = [{ fixture: fixture.info }];
    const control = async (args: string[]) => {
      const command = [...args, "--url", fixture.info.url];
      const result = await runControlOmb(command) as any;
      evidence.push({ command, result });
      return result;
    };
    try {
      const created = await control(["new-bot", "--name", "Sub-agent fixture"]);
      const target = ["--bot", created.bot.id, "--task", created.bot.activeTaskId];
      await control(["send", ...target, "--text", "Look around [fake:subagent-api-error]"]);
      expect(["settled", "failed"]).toContain((await control(["wait", ...target, "--timeout", "20"])).status);
      await expect.poll(async () => {
        const { messages } = await control(["messages", ...target, "--limit", "20"]);
        return (messages as any[]).filter((message) => message.tool?.name && /agent/i.test(message.tool.name))
          .map((message) => message.tool.ok);
        // the row closed as not finished (the transcript view leaves out its output)
      }, { timeout: 10_000 }).toEqual([false]);
      const { messages } = await control(["messages", ...target, "--limit", "20"]);
      expect((messages as any[]).some((message) => message.tool && message.tool.ok === undefined)).toBe(false);
    } finally {
      writeFileSync(`${fixture.info.logPath}.json`, JSON.stringify(evidence, null, 2));
      await fixture.close();
    }
  }, 60_000);
});
