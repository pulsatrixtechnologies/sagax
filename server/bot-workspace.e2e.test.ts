// The bot workspace end to end (docs/bot-workspace.md), against an isolated
// fixture server and the fake engine: RULES.md rides right after the soul
// in a real turn's system prompt, docs/ rides as an index only, the Files
// list records what the turn used, and its routes stay inside the
// workspace. A bot without RULES.md or docs/ gets neither block.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import type { WireBot } from "../shared/wire.ts";

it("loads RULES.md after the soul, indexes docs/, and tracks what a turn used", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "omb-bot-workspace-"));
  const fixture = await launchVerificationServer(process.env);
  const dump = fixture.fixtureDumpPath;
  const control = (...args: string[]) => runControlOmb([...args, "--url", fixture.info.url]);
  const api = async <T = any>(path: string, method = "GET", body?: unknown, status = 200): Promise<T> => {
    const response = await fetch(fixture.info.url + path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.status, `${method} ${path}`).toBe(status);
    return response.json() as Promise<T>;
  };
  const turn = async (botId: string, threadId: string, text: string) => {
    await control("send", "--bot", botId, "--task", threadId, "--text", text);
    expect(await control("wait", "--bot", botId, "--task", threadId, "--timeout", "30")).toMatchObject({ status: "settled" });
  };
  const systemPrompt = () => String(JSON.parse(readFileSync(dump, "utf8")).systemPrompt ?? "");
  try {
    // a bot without either file: no Rules block, no documents index
    const { bot: plain } = await api<{ bot: WireBot }>("/api/bots", "POST", { name: "Plain" }, 201);
    await api(`/api/bots/${plain.id}`, "PATCH", { soul: "Be brief." });
    await turn(plain.id, plain.threadId, "Hello");
    expect(systemPrompt()).toContain("BEGIN STANDING INSTRUCTIONS");
    expect(systemPrompt()).not.toContain("BEGIN RULES");
    expect(systemPrompt()).not.toContain("Documents available");

    const { bot } = await api<{ bot: WireBot }>("/api/bots", "POST", { name: "Ruled" }, 201);
    await api(`/api/bots/${bot.id}`, "PATCH", { soul: "Be brief." });
    await api(`/api/bots/${bot.id}/memory/file`, "PUT", { path: "RULES.md", text: "# Rules\n\n<!-- my note -->\n- Never quote a price.\n" });
    await api(`/api/bots/${bot.id}/memory/file`, "PUT", { path: "docs/onboarding.md", text: "# Onboarding a client\n\nBODY-NOT-LOADED\n" });

    const preview = await api<{ sections: Array<{ id: string; text: string }> }>(`/api/bots/${bot.id}/system-prompt`);
    const ids = preview.sections.map((section) => section.id);
    expect(ids.slice(0, 6)).toEqual(["misuse-policy", "run-yourself", "verify-first", "persona", "soul", "rules"]);
    expect(ids.indexOf("docs")).toBeGreaterThan(ids.indexOf("memory"));

    await turn(bot.id, bot.threadId, "What are your rules?");
    const sent = systemPrompt();
    expect(sent.indexOf("BEGIN RULES")).toBeGreaterThan(sent.indexOf("END STANDING INSTRUCTIONS"));
    expect(sent).toContain("- Never quote a price.\n--- END RULES ---");
    expect(sent).not.toContain("my note");
    expect(sent).toContain("- docs/onboarding.md: Onboarding a client (");
    expect(sent).not.toContain("BODY-NOT-LOADED");
    if (sent.includes("Your memory (MEMORY.md):")) expect(sent.indexOf("BEGIN RULES")).toBeLessThan(sent.indexOf("Your memory (MEMORY.md):"));

    // the Files list: the turn's prompt carried SOUL.md and RULES.md
    await expect.poll(async () => {
      const listing = await api(`/api/bots/${bot.id}/workspace`);
      return {
        soul: typeof listing.soul.lastUsedAt,
        rules: typeof listing.entries.find((entry: any) => entry.path === "RULES.md")?.lastUsedAt,
      };
    }, { timeout: 10_000 }).toEqual({ soul: "number", rules: "number" });
    const listing = await api(`/api/bots/${bot.id}/workspace`);
    expect(listing.entries.find((entry: any) => entry.path === "RULES.md")).toMatchObject({ load: "every-turn", editable: true, budget: { maxLines: 100, maxBytes: 12000, lines: 3 } });
    expect(listing.entries.find((entry: any) => entry.path === "docs/onboarding.md")).toMatchObject({ load: "on-demand", forgotten: false });

    // rename, download, and the journal row for every change
    await api(`/api/bots/${bot.id}/workspace/docs/rename`, "POST", { from: "docs/onboarding.md", to: "docs/clients.md" });
    const download = await fetch(`${fixture.info.url}/api/bots/${bot.id}/workspace/download?path=docs%2Fclients.md`);
    expect(download.status).toBe(200);
    expect(await download.text()).toContain("BODY-NOT-LOADED");
    await api(`/api/bots/${bot.id}/workspace/download?path=..%2F${plain.id}%2FMEMORY.md`, "GET", undefined, 400);
    const journal = await api<{ entries: Array<{ path: string; kind: string }> }>(`/api/bots/${bot.id}/memory/journal`);
    expect(journal.entries.map((row) => `${row.kind} ${row.path}`)).toEqual(expect.arrayContaining(["created RULES.md", "created docs/clients.md", "deleted docs/onboarding.md"]));
  } finally {
    await fixture.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}, 120_000);
