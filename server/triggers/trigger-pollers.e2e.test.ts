// A typed trigger's poller against the real server: the password goes in
// once, write only; no answer, list, file in clear, log or activity row
// holds it; deleting the trigger forgets it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../../scripts/control-omb.ts";

const PASSWORD = "e2e-Poller-SECRET-pass-91f";

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat) continue;
    if (stat.isDirectory()) {
      if (["node_modules", "tools", "cache", ".cache"].includes(name)) continue;
      out.push(...filesUnder(path));
    } else if (stat.size < 8 * 1024 * 1024) out.push(path);
  }
  return out;
}

it("takes a poller password write only and never shows, logs or stores it in clear", async () => {
  const fixture = await launchVerificationServer();
  const { url, dataDir, logPath } = fixture.info;
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    return { status: response.status, text: await response.text() };
  };
  try {
    const bot = JSON.parse((await call("POST", "/api/bots", { name: "Poller probe" })).text).bot;
    const created = await call("POST", "/api/webhooks", {
      name: "Inbox", prompt: "Triage", botId: bot.id,
      source: { type: "email", events: [], filters: {}, poller: { kind: "imap", host: "mail.nonexistent.invalid", username: "me@example.com" } },
      pollerCredentials: { password: PASSWORD },
    });
    expect(created.status).toBe(201);
    expect(created.text).not.toContain(PASSWORD);
    const id = JSON.parse(created.text).webhook.id;
    const listed = await call("GET", "/api/webhooks");
    expect(listed.text).not.toContain(PASSWORD);
    const row = JSON.parse(listed.text).webhooks.find((hook: { id: string }) => hook.id === id);
    expect(row).toMatchObject({ pollerCredentialsSet: true, source: { poller: { kind: "imap" } } });
    expect(Array.isArray(JSON.parse(listed.text).graphConnectors)).toBe(true);

    // an ICS link is refused on a mailbox poller; a new password replaces the old one
    expect((await call("PATCH", `/api/webhooks/${id}`, { pollerCredentials: { url: "https://cal.example.com/x.ics" } })).status).toBe(400);
    const replaced = await call("PATCH", `/api/webhooks/${id}`, { pollerCredentials: { password: `${PASSWORD}-2` } });
    expect(replaced.status).toBe(200);
    expect(replaced.text).not.toContain(PASSWORD);

    // give the poller its first (failing) read, then search every file
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    for (const file of [...filesUnder(dataDir), logPath]) {
      const text = readFileSync(file, "latin1");
      expect(text.includes(PASSWORD), file).toBe(false);
    }
    expect(statSync(join(dataDir, "trigger-poller-credentials.enc")).size).toBeGreaterThan(0);

    expect((await call("DELETE", `/api/webhooks/${id}`)).status).toBe(200);
    expect(statSync(join(dataDir, "trigger-poller-credentials.enc"), { throwIfNoEntry: false })).toBeUndefined();
  } finally {
    await fixture.close();
  }
}, 60_000);
