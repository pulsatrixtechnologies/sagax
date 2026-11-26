import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

// The app's minimum version (D-20261126-004) through the real server: a send
// from a desktop app older than 0.8.173 is answered with the sentence that
// says to update, nothing is posted, and the same person reads their bots and
// sends again from an app that is new enough.
const agent = (version: string) =>
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) openmausbot/${version} Chrome/142.0.0.0 Electron/39.2.0 Safari/537.36`;

it("asks an app older than the minimum to update before it sends, and holds nothing else", async () => {
  const session = await launchVerificationServer({ ...process.env }, undefined, undefined, undefined, undefined, { scripted: true });
  try {
    const cli = (...args: string[]) => runControlOmb(args, { env: { SAGAX_URL: session.info.url } }) as Promise<any>;
    const bot = (await cli("new-bot", "--name", "Wren", "--section", "Leadership")).bot;
    const call = (version: string, path: string, body?: unknown) => fetch(`${session.info.url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", "user-agent": agent(version), "x-sagax-locale": "fr" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const messages = async () => ((await (await call("0.8.172", "/api/bots?messages=20")).json() as { bots: any[] }).bots).find((b) => b.id === bot.id).messages as any[];

    const before = (await messages()).length;
    const refused = await call("0.8.172", `/api/bots/${bot.id}/messages`, { text: "Hello.", threadId: bot.activeTaskId, sendId: crypto.randomUUID() });
    expect(refused.status).toBe(426);
    const body = await refused.json() as { error: string };
    expect(body).toMatchObject({ code: "app_update_required", minimumVersion: "0.8.173", appVersion: "0.8.172" });
    expect(body.error).toMatch(/^Mets Sagax à jour pour continuer/);
    // nothing was posted, and the older app still reads its bots
    expect((await messages()).length).toBe(before);

    const accepted = await call("0.8.173", `/api/bots/${bot.id}/messages`, { text: "Hello.", threadId: bot.activeTaskId, sendId: crypto.randomUUID() });
    expect(accepted.ok).toBe(true);
  } finally { await session.close(); }
}, 60_000);
