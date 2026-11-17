// #4507: a record link is the app's own (`sagax://record/...`). Nothing that
// leaves the chat carries that address: a text, a mail, speech, a push or a
// reach-me notice, a message to another bot, the stored words an export or a
// copy reads, a published page. Each channel is checked on its own path.
// Invented product and record names only.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import { normalizeDraftForSend } from "../shared/email-draft-send.ts";
import { plainPreviewLine } from "../shared/plain-text.ts";
import { recordTextOf } from "../shared/record-cards.ts";
import { DATA_DIR } from "./config.ts";
import { callCoreTool } from "./drivers/agents-tools/core.ts";
import type { ToolCallContext } from "./drivers/agents-call-types.ts";
import { PublishedPages } from "./pages/published-pages.ts";
import { smsReplyBody } from "./sms-conversation.ts";
import { Store } from "./store.ts";
import { speakable } from "./tts/speech-text.ts";

const LINKED = "Le billet [#481516](sagax://record/nimbus_desk/ticket/481516) est fermé, voir aussi <sagax://record/nimbus_desk/ticket/2>.";
const NO_ADDRESS = /sagax:/i;

describe("no record address leaves the chat", () => {
  const dirs: string[] = [];
  afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

  it("a text (SMS) carries the label", () => {
    const body = smsReplyBody(LINKED, "fr");
    expect(body).toContain("#481516");
    expect(body).not.toMatch(NO_ADDRESS);
  });

  it("a mail a bot drafts carries the label, in its body and its subject", () => {
    const out = normalizeDraftForSend({ to: ["ada@desk.example"], subject: "Billet [#481516](sagax://record/nimbus_desk/ticket/481516)", body: LINKED });
    expect("draft" in out).toBe(true);
    const { draft } = out as Extract<typeof out, { draft: unknown }>;
    expect(draft.subject).toBe("Billet #481516");
    expect(draft.body).toContain("#481516");
    expect(`${draft.subject} ${draft.body}`).not.toMatch(NO_ADDRESS);
  });

  it("speech says the words and never the address (an id is not read aloud, as before)", () => {
    const spoken = speakable(LINKED);
    expect(spoken).toContain("Le billet");
    expect(spoken).not.toMatch(/sagax|record|nimbus/i);
  });

  it("a push banner and a reach-me notice read the label (plainPreviewLine, both channels' one reader)", () => {
    const line = plainPreviewLine(LINKED, 200);
    expect(line).toContain("#481516");
    expect(line).not.toMatch(NO_ADDRESS);
  });

  it("a message to another bot or a room carries the label", async () => {
    const api = vi.fn(async () => ({ threadId: "t2", state: "running", botName: "Dev", title: "Suivi" }));
    const context = { botId: "orc", threadId: "t1", depth: 0, client: { api } } as unknown as ToolCallContext;
    await callCoreTool("send_to_bot", { bot_id: "dev", title: "Suivi [#481516](sagax://record/nimbus_desk/ticket/481516)", message: LINKED }, context);
    await callCoreTool("coordinate_bots", { bot_ids: ["dev"], message: LINKED }, context);
    expect(api).toHaveBeenCalled();
    for (const call of api.mock.calls as unknown as Array<[string, { body?: string }]>) {
      expect(String(call[1]?.body ?? "")).not.toMatch(NO_ADDRESS);
    }
  });

  it("the stored words every export, copy and other client read are plain; the links ride beside them", () => {
    rmSync(DATA_DIR, { recursive: true, force: true });
    const store = new Store(() => ({ instanceId: "claude", model: "claude-sonnet-5" }));
    const bot = store.createBot({ name: "Wren" }, { seedMessages: false });
    const stored = store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: LINKED });
    expect(stored.text).not.toMatch(NO_ADDRESS);
    expect(stored.text).toContain("#481516");
    expect(stored.recordText).toBe(LINKED);
    expect(recordTextOf(stored)).toBe(LINKED);
    const read = store.messagesFor(bot.threadId).find((message) => message.id === stored.id)!;
    expect(read.text).not.toMatch(NO_ADDRESS);
    // new words drop the old linked copy; new linked words split again
    const patched = store.patchMessage(bot.threadId, stored.id, { text: "Autre chose" })!;
    expect(patched.recordText).toBeUndefined();
    const relinked = store.patchMessage(bot.threadId, stored.id, { text: LINKED })!;
    expect(relinked.text).not.toMatch(NO_ADDRESS);
    expect(relinked.recordText).toBe(LINKED);
    // the person's own words are theirs, as typed
    const typed = store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "sagax://record/nimbus_desk/ticket/1" });
    expect(typed.text).toBe("sagax://record/nimbus_desk/ticket/1");
  });

  it("a page a bot publishes carries the label", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-record-pages-"));
    dirs.push(dir);
    const pages = new PublishedPages(dir, () => 1_800_000_000_000);
    const made = pages.propose({ botId: "bot1", threadId: "t1", title: "Rapport", kind: "markdown", content: `# Suivi\n\n${LINKED}\n\n<a href="sagax://record/nimbus_desk/ticket/3">x</a>` });
    expect(made.ok).toBe(true);
    const page = made as Extract<typeof made, { ok: true }>;
    const content = pages.content(page.page.id, page.version.n)!;
    expect(content).toContain("#481516");
    expect(content).not.toMatch(NO_ADDRESS);
  });
});
