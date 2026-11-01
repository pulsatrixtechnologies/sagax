// Proactive wakes through the real server and the fake engine
// (server/proactive-wake.ts): a webhook post wakes the bot it was posted to
// when proactive is on. The wake runs at the bot's approval level, reports
// into its one conversation, and records dry runs before writes. Off does
// nothing. One line in the conversation's Events tab per wake.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

const REPORT = "The deploy finished; I checked the release notes and nothing needs you.";

it("a webhook post wakes its bot when proactive is on, and stays quiet when off", async () => {
  const fixture = await launchVerificationServer({
    ...process.env,
    SAGAX_PROACTIVE_GATHER_MS: "200",
    FAKE_CLAUDE_REPLIES: JSON.stringify([REPORT, REPORT]),
  });
  const { url, dataDir } = fixture.info;
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBe(status);
    return value;
  };
  const control = (args: string[]) => runControlOmb([...args, "--url", url]) as Promise<any>;
  const runs = async (botId: string) => ((await api("GET", "/api/routines")).runs as any[]).filter((run) => run.botId === botId);
  const messages = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages?limit=100`)).messages as any[];
  const systemPrompt = () => String(JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")).systemPrompt ?? "");
  const post = async (botId: string, text: string) => {
    const hook = await api("POST", "/api/webhooks", { name: "Deploys", prompt: "", botId, delivery: "post" }, 201);
    const delivered = await fetch(hook.credential.endpointUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${hook.credential.token}` },
      body: JSON.stringify({ text }),
    });
    expect(delivered.ok).toBe(true);
  };
  const eventsLines = (threadId: string) => {
    const file = join(dataDir, "events", `${threadId}.ndjson`);
    return existsSync(file) ? readFileSync(file, "utf8") : "";
  };
  try {
    const newBot = async (name: string, mode: string) => {
      const { bot } = await control(["new-bot", "--name", name]);
      await api("PATCH", `/api/bots/${bot.id}`, { proactiveMode: mode, approvalMode: "edits" });
      const wire = (await api("GET", "/api/bots")).bots.find((candidate: any) => candidate.id === bot.id);
      return { id: bot.id as string, threadId: wire.threadId as string };
    };

    // proactive (the default): a background run at the bot's own level
    const doer = await newBot("Doer", "proactive");
    await post(doer.id, "Deploy 42 finished.");
    await expect.poll(async () => (await runs(doer.id)).find((run) => run.proactive)?.status, { timeout: 30_000 }).toBe("completed");
    const doerRun = (await runs(doer.id)).find((run) => run.proactive);
    expect(doerRun.proactive).toMatchObject({ mode: "proactive", hops: 0, sources: ["webhook"] });
    expect(doerRun.triggerSource).toBe("proactive");
    expect(doerRun.routineName).toBe("Proactive: webhook");
    expect(doerRun.runAs).toBeTruthy();
    await control(["wait", "--bot", doer.id, "--task", doerRun.threadId]);
    expect(systemPrompt()).toContain("Approval level of this turn: Auto-accept edits");
    expect(systemPrompt()).toContain("Proactive mode: on");
    // its report lands in the bot's one conversation
    await expect.poll(async () => (await messages(doer.threadId)).some((message) => message.kind === "routine.run" && String(message.text).includes(REPORT)), { timeout: 20_000 }).toBe(true);
    // the run read the post inside the fence
    const asked = (await messages(doerRun.threadId)).find((message) => message.role === "user");
    expect(String(asked?.text)).toContain("[UNTRUSTED PROACTIVE EVENT DATA");
    expect(String(asked?.text)).toContain("Deploy 42 finished.");
    // one Events line, without the post's words
    await expect.poll(() => eventsLines(doer.threadId), { timeout: 10_000 }).toContain("Proactive wake (proactive): 1 event, webhook post. Webhook post");
    expect(eventsLines(doer.threadId)).not.toContain("Deploy 42");

    // legacy follow-rules on PATCH normalizes to proactive
    const legacy = await newBot("Legacy", "follow-rules");
    expect((await api("GET", "/api/bots")).bots.find((b: any) => b.id === legacy.id).proactiveMode).toBe("proactive");

    // off: nothing at all
    const quiet = await newBot("Quiet", "off");
    await post(quiet.id, "Deploy 45 finished.");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(await runs(quiet.id)).toEqual([]);
    expect((await messages(quiet.threadId)).some((message) => message.card?.proactiveProposal)).toBe(false);
    expect(eventsLines(quiet.threadId)).not.toContain("Proactive wake");
  } finally {
    await fixture.close();
  }
}, 180_000);
