import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { memoryReadersOf } from "../memory/memory-audience.ts";
import { memoryMayShow } from "../memory/memory-audience.ts";
import { BriefStore, briefGist, localizedGist, suggestionAction, suggestionIdentity, toolWords, briefReadTools, briefTimeCame, briefToolAllowed, cleanBriefSettings, datedBriefPiece, keptMemoryLine, localDay, migrateBriefIdentities, readConnectedBrief, runBriefPass } from "./background-brief.ts";
import { briefMessageText, briefNoticeLines, runScheduledBriefs, type BriefDelivery } from "./background-brief-schedule.ts";

const piece = { piece: "Inbox, Monday note", asOf: "2026-10-26", text: "Three invoices arrived, 3 in all." };

describe("background brief", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("reads only, cites every number, skips a rejection, and stays with the person", () => {
    expect(briefToolAllowed("list_messages")).toBe(true);
    expect(briefToolAllowed("send_mail")).toBe(false);
    expect(briefToolAllowed("browse")).toBe(false);
    expect(briefToolAllowed("write_file")).toBe(false);
    expect(runBriefPass({ tools: ["send_mail"], pieces: [piece], costUsd: 0.01, fastModel: "fast-1" }).ok).toBe(false);
    expect(runBriefPass({ tools: ["list_messages"], pieces: [piece], costUsd: 0.01, fastModel: "" }).ok).toBe(false);
    const uncited = runBriefPass({ tools: ["list_messages"], pieces: [{ piece: "note", asOf: "Monday", text: "About 12 items" }], costUsd: 0.02, fastModel: "fast-1" });
    expect(uncited.ok && uncited.suggestions).toEqual([]);
    const pass = runBriefPass({ tools: ["read_inbox"], pieces: [piece], costUsd: 0.02, fastModel: "fast-1" }, ["three invoices arrived, 3 in all"]);
    expect(pass.ok && pass.suggestions).toEqual([]);
    const open = runBriefPass({ tools: ["read_inbox"], pieces: [piece], costUsd: 0.02, fastModel: "fast-1" });
    expect(open.ok && open.suggestions[0]).toMatchObject({ costUsd: 0.02, model: "fast-1", sources: [piece] });
    const line = keptMemoryLine("Three invoices arrived, 3 in all.", new Date(2026, 9, 27));
    expect(memoryReadersOf(line)).toEqual({ kind: "person" });
    expect(memoryMayShow({ kind: "person" }, { kind: "room", id: "garden" })).toBe(false);
    expect(line).toContain("readers person");
  });

  it("keeps a counted gist in the person's language (#2879)", () => {
    const day = new Date(2026, 10, 8);
    expect(keptMemoryLine("3 invoices", day, "fr")).toContain("3 factures");
    expect(keptMemoryLine("3 invoices", day, "en")).toContain("3 invoices");
    expect(keptMemoryLine("3 invoices", day)).toContain("3 invoices");
    expect(keptMemoryLine("Répondre à Carla", day, "fr")).toContain("Répondre à Carla");
  });

  it("moves a pre-#2866 counted rejection to its app and day, drops one with no source (#2879)", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-brief-"));
    dirs.push(dir);
    const file = join(dir, "background-brief.json");
    const source = { piece: "Teams, list messages", asOf: "2026-11-01", text: "2026-11-01: 3 messages" };
    const old = { id: "brief_a", text: "3 messages", sources: [source], costUsd: 0, model: "fast", status: "rejected", identity: "3 messages", at: 1 };
    writeFileSync(file, JSON.stringify({ version: 1, bots: { "bot-1": { suggestions: [old], rejected: ["3 messages", "4 invoices", "relancer paul", "relancer paul"] } } }));
    const store = new BriefStore(file, () => 1_000);
    const scoped = "3 messages | teams | 2026-11-01";
    expect(store.view("bot-1").suggestions[0]?.identity).toBe(scoped);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.bots["bot-1"].rejected).toEqual([scoped, "relancer paul"]);
    // the scoped key blocks that day's Teams count again, not Outlook's
    const teams = runBriefPass({ tools: ["list_messages"], pieces: [source], costUsd: 0, fastModel: "fast" }, saved.bots["bot-1"].rejected);
    expect(teams.ok && teams.suggestions).toEqual([]);
    const outlook = runBriefPass({ tools: ["list_messages"], pieces: [{ ...source, piece: "Outlook, list messages" }], costUsd: 0, fastModel: "fast" }, saved.bots["bot-1"].rejected);
    expect(outlook.ok && outlook.suggestions.length).toBe(1);
    // a second load changes nothing
    const row = saved.bots["bot-1"];
    expect(migrateBriefIdentities(row)).toBe(false);
  });

  it("moves a counted rejection to every rejected suggestion of that text, not the first one (#2880)", () => {
    const at = (piece: string, day: string) => ({ piece, asOf: day, text: `${day}: 3 messages` });
    const item = (id: string, source: ReturnType<typeof at>, extra: Record<string, unknown>) => ({ id, text: "3 messages", sources: [source], costUsd: 0, model: "fast", identity: "3 messages", at: 1, ...extra });
    const row = {
      suggestions: [
        item("brief_o", at("Outlook, list messages", "2026-11-01"), { status: "pending" }),
        item("brief_t", at("Teams, list messages", "2026-11-01"), { status: "rejected" }),
        item("brief_n", at("Teams, list messages", "2026-11-02"), { status: "pending", feedback: "never" }),
      ],
      rejected: ["3 messages"],
    } as unknown as Parameters<typeof migrateBriefIdentities>[0];
    expect(migrateBriefIdentities(row)).toBe(true);
    expect(row.rejected).toEqual(["3 messages | teams | 2026-11-01", "3 messages | teams | 2026-11-02"]);
    expect(migrateBriefIdentities(row)).toBe(false);
    // with no rejected one, the first suggestion of that text stands in
    const pending = { suggestions: [item("brief_o", at("Outlook, list messages", "2026-11-01"), { status: "pending" }), item("brief_x", at("Teams, list messages", "2026-11-03"), { status: "pending" })], rejected: ["3 messages"] } as unknown as Parameters<typeof migrateBriefIdentities>[0];
    migrateBriefIdentities(pending);
    expect(pending.rejected).toEqual(["3 messages | outlook | 2026-11-01"]);
  });

  it("stores the cadence the person chose and does not rewrite a rejection", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-brief-"));
    dirs.push(dir);
    const store = new BriefStore(join(dir, "background-brief.json"), () => 1_000);
    expect(store.due("bot-1")).toBe(false);
    store.saveSettings("bot-1", { enabled: true, everyHours: 6, subjects: ["invoices"] });
    expect(store.view("bot-1").settings).toMatchObject({ enabled: true, everyHours: 6, subjects: ["invoices"], at: "08:00" });
    expect(store.due("bot-1", 1_000)).toBe(true);
    const pass = runBriefPass({ tools: ["read_inbox"], pieces: [piece], costUsd: 0.02, fastModel: "fast-1" });
    if (!pass.ok) throw new Error(pass.error);
    const [added] = store.recordPass("bot-1", pass);
    expect(added?.costUsd).toBe(0.02);
    expect(store.due("bot-1", 1_000 + 5 * 3_600_000)).toBe(false);
    expect(store.due("bot-1", 1_000 + 6 * 3_600_000)).toBe(true);
    expect(store.reject("bot-1", added!.id)?.status).toBe("rejected");
    expect(store.recordPass("bot-1", pass)).toEqual([]);
    expect(store.view("bot-1").costUsd).toBe(0);
  });

  it("reads a connected app, drops a number with no date, and stays empty when nothing is connected", async () => {
    expect(briefReadTools(["list_messages", "send_mail", "browser_open", "write_file"])).toEqual(["list_messages"]);
    expect(datedBriefPiece("Inbox", "list_messages", "Three invoices arrived")).toBeNull();
    const none = await readConnectedBrief({ apps: () => [], read: async () => "3" }, { costUsd: 0, fastModel: "fast-1" });
    expect(none).toMatchObject({ ok: true, apps: 0, notice: "no_apps", suggestions: [] });
    const called: string[] = [];
    const read = await readConnectedBrief({
      apps: () => [{ name: "Inbox", tools: ["list_messages", "send_mail"] }],
      read: async (app, tool) => {
        called.push(`${app}:${tool}`);
        return tool === "list_messages" ? "Monday note 2026-10-26: 3 invoices arrived" : "sent";
      },
    }, { costUsd: 0, fastModel: "fast-1" });
    expect(called).toEqual(["Inbox:list_messages"]);
    expect(read.ok && read.suggestions[0]).toMatchObject({ sources: [{ piece: "Inbox, list messages", asOf: "2026-10-26" }] });
    expect(read.ok && read.suggestions[0]?.text).toContain("3");
    // #2845: what the answer counts, not its raw first line
    expect(read.ok && read.suggestions[0]?.text).toBe("3 invoices");
  });

  it("runs at the person's time, once a day, in their time zone", () => {
    const on = { enabled: true, at: "07:30", timeZone: "America/Toronto" };
    // 11:00 UTC is 07:00 in Toronto (EDT): not yet
    expect(briefTimeCame(on, undefined, Date.parse("2026-10-26T11:00:00Z"))).toBe(false);
    expect(briefTimeCame(on, undefined, Date.parse("2026-10-26T11:31:00Z"))).toBe(true);
    expect(briefTimeCame(on, "2026-10-26", Date.parse("2026-10-26T11:31:00Z"))).toBe(false);
    expect(briefTimeCame(on, "2026-10-26", Date.parse("2026-10-27T11:31:00Z"))).toBe(true);
    // never late in the day: the catch-up window is three hours
    expect(briefTimeCame(on, undefined, Date.parse("2026-10-26T19:00:00Z"))).toBe(false);
    expect(briefTimeCame({ ...on, enabled: false }, undefined, Date.parse("2026-10-26T11:31:00Z"))).toBe(false);
    expect(localDay(Date.parse("2026-10-27T02:00:00Z"), "America/Toronto")).toBe("2026-10-26");
  });

  it("is on by default for a Primary Bot, and the person's own choice wins", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-brief-"));
    dirs.push(dir);
    const store = new BriefStore(join(dir, "background-brief.json"), () => 1_000, { defaultEnabled: (botId) => botId === "primary" });
    expect(store.settings("primary").enabled).toBe(true);
    expect(store.settings("other").enabled).toBe(false);
    // a time change alone keeps it on
    expect(store.saveSettings("primary", { at: "06:45", timeZone: "Europe/Paris" })).toMatchObject({ enabled: true, at: "06:45", timeZone: "Europe/Paris" });
    store.saveSettings("primary", { enabled: false });
    expect(store.settings("primary")).toMatchObject({ enabled: false, at: "06:45" });
    const reopened = new BriefStore(join(dir, "background-brief.json"), () => 1_000, { defaultEnabled: () => true });
    expect(reopened.settings("primary").enabled).toBe(false);
    expect(cleanBriefSettings({ at: "25:00", timeZone: "Nowhere/City" }, { enabled: true, everyHours: 4, subjects: [], at: "08:00", timeZone: "UTC", screenContext: false })).toMatchObject({ at: "08:00", timeZone: "UTC" });
  });

  it("the timer reads once at the person's time and delivers only what is new", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-brief-"));
    dirs.push(dir);
    let now = Date.parse("2026-10-26T12:05:00Z");
    const store = new BriefStore(join(dir, "background-brief.json"), () => now, { defaultEnabled: (botId) => botId === "primary" });
    store.saveSettings("primary", { at: "08:00", timeZone: "America/Toronto" });
    const delivered: BriefDelivery[] = [];
    let reads = 0;
    const deps = {
      store,
      bots: () => [{ id: "primary", name: "Nimbus", person: "pr_a" }, { id: "other", name: "Other", person: "pr_a" }, { id: "nobody", name: "Nobody", person: null }],
      connected: () => ["Inbox"],
      fastModel: () => "fast-1",
      reads: async () => ({
        apps: () => [{ name: "Inbox", tools: ["list_messages"] }],
        read: async () => { reads += 1; return "Monday note 2026-10-26: 3 invoices arrived"; },
      }),
      deliver: (input: BriefDelivery) => { delivered.push(input); },
      now: () => now,
    };
    expect(await runScheduledBriefs(deps)).toEqual(["primary"]);
    expect(reads).toBe(1);
    expect(delivered[0]).toMatchObject({ botId: "primary", person: "pr_a" });
    expect(delivered[0]!.suggestions[0]!.text).toContain("3 invoices");
    // the same minute again: today is taken
    expect(await runScheduledBriefs(deps)).toEqual([]);
    expect(reads).toBe(1);
    // next day, same piece: nothing new, nothing sent
    now = Date.parse("2026-10-27T12:05:00Z");
    expect(await runScheduledBriefs(deps)).toEqual([]);
    expect(reads).toBe(2);
    expect(delivered).toHaveLength(1);
    const text = briefMessageText(delivered[0]!.suggestions, "fr");
    expect(text).toContain("Brief du jour");
    // #2845: what the answer counts, as an action, never its raw first line
    expect(text).toContain("- Passer en revue les 3 factures dans Inbox (2026-10-26)");
    expect(text).not.toContain("Monday note");
    expect(briefNoticeLines(delivered[0]!.suggestions, "en").title).toBe("Today's brief: 1 point");
  });

  it("#2693: a full ISO timestamp dates the piece, and the point is human words, not the raw answer", () => {
    expect(datedBriefPiece("Mail", "list_messages", "due 2026-11-08T14:00:00Z")?.asOf).toBe("2026-11-08");
    expect(datedBriefPiece("Mail", "list_messages", "at 2026-11-08T14:00:00.000-05:00")?.asOf).toBe("2026-11-08");
    expect(datedBriefPiece("Mail", "list", "ref 12026-11-08")).toBeNull();
    expect(toolWords("listMessages")).toBe("list messages");
    const raw = JSON.stringify({ value: [{ id: "AAMk42", subject: "Facture 1042 en retard", receivedDateTime: "2026-11-08T14:00:00Z" }] });
    expect(briefGist(raw)).toBe("Facture 1042 en retard");
    expect(briefGist('{"count": 3, "note": "x"} trailing')).not.toMatch(/[{}"]/);
    const pass = runBriefPass({ tools: ["list_messages"], pieces: [datedBriefPiece("Outlook", "list_messages", raw)!], costUsd: 0, fastModel: "fast-1" });
    if (!pass.ok) throw new Error(pass.error);
    expect(pass.suggestions[0]?.text).toBe("Facture 1042 en retard");
    expect(suggestionAction(pass.suggestions[0]!, "fr")).toBe("Faire le suivi de « Facture 1042 en retard » dans Outlook");
    expect(suggestionAction(pass.suggestions[0]!, "en")).toBe('Follow up on "Facture 1042 en retard" in Outlook');
  });

  it("#2845: a text answer gives a concrete action in the person's language, or no suggestion at all", () => {
    const point = (app: string, raw: string) => {
      const pass = runBriefPass({ tools: ["list_messages"], pieces: [datedBriefPiece(app, "list_messages", raw)!], costUsd: 0, fastModel: "fast-1" });
      if (!pass.ok) throw new Error(pass.error);
      return pass.suggestions[0];
    };
    const found = point("Outlook", "Found 3 messages (2026-11-08)");
    expect(found?.text).toBe("3 messages");
    expect(suggestionAction(found!, "fr")).toBe("Passer en revue les 3 messages dans Outlook");
    expect(suggestionAction(found!, "en")).toBe("Review the 3 messages in Outlook");
    const one = point("Facturation", "2026-11-08 : 1 facture en retard");
    expect(suggestionAction(one!, "fr")).toBe("Passer en revue 1 facture dans Facturation");
    expect(suggestionAction(one!, "en")).toBe("Review 1 invoice in Facturation");
    const subject = point("Outlook", "From: Carla\nSubject: Renouvellement du contrat\nDate: 2026-11-08");
    expect(suggestionAction(subject!, "fr")).toBe("Faire le suivi de « Renouvellement du contrat » dans Outlook");
    // nothing a person can act on: no suggestion
    expect(point("Outlook", "OK 2026-11-08 status=200")).toBeUndefined();
    expect(point("Outlook", "Found 0 messages 2026-11-08")).toBeUndefined();
    expect(point("Outlook", '{"count": 3, "asOf": "2026-11-08"}')).toBeUndefined();
    expect(briefGist("Found 3 messages")).not.toMatch(/Found/);
    expect(briefGist("Found no messages")).toBe("");
    expect(briefGist("Répondre à Carla avant midi")).toBe("Répondre à Carla avant midi");
    // whole words only: a person's sentence starting like a tool word stays
    for (const said of ["Totaliser les heures de Carla", "Sentinel signale un poste", "Okay pour la réunion", "Country manager attend la soumission", "Notre client attend", "Truc à régler demain"]) {
      expect(briefGist(said)).toBe(said);
    }
    for (const report of ["OK done", "Total: 4", "Sent to Carla", "No results today", "Status ready"]) {
      expect(briefGist(report)).toBe("");
    }
  });

  it("#2693 review: a counted point keeps its app and day in its key, and reads in the person's language", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-brief-"));
    dirs.push(dir);
    const store = new BriefStore(join(dir, "background-brief.json"), () => 1_000);
    const pass = (pieces: Array<[string, string]>) => {
      const result = runBriefPass({ tools: ["list_messages"], pieces: pieces.map(([app, raw]) => datedBriefPiece(app, "list_messages", raw)!), costUsd: 0, fastModel: "fast-1" });
      if (!result.ok) throw new Error(result.error);
      return result;
    };
    // two apps counting alike in one pass: both kept
    const first = store.recordPass("bot-1", pass([["Outlook", "Found 3 messages (2026-11-08)"], ["Teams", "Found 3 messages (2026-11-08)"]]));
    expect(first.map((item) => item.sources[0]!.piece.split(",")[0])).toEqual(["Outlook", "Teams"]);
    // the same app the same day: one; another day: a new point
    expect(store.recordPass("bot-1", pass([["Outlook", "Found 3 messages (2026-11-08)"]]))).toEqual([]);
    expect(store.recordPass("bot-1", pass([["Outlook", "Found 3 messages (2026-11-09)"]]))).toHaveLength(1);
    // a rejection blocks that app's count that day, not every "3 messages"
    store.reject("bot-1", first[0]!.id);
    expect(store.recordPass("bot-1", pass([["Teams", "Found 3 messages (2026-11-10)"]]))).toHaveLength(1);
    expect(suggestionIdentity("3 messages", { piece: "Outlook, list messages", asOf: "2026-11-08" })).not.toBe(suggestionIdentity("3 messages", { piece: "Teams, list messages", asOf: "2026-11-08" }));
    // a person's words keep the plain key
    expect(suggestionIdentity("Renouvellement du contrat", { piece: "Outlook, list messages", asOf: "2026-11-08" })).toBe("renouvellement du contrat");
    // the stored gist in the person's language (memory lines, kept lines)
    expect(localizedGist("3 invoices", "fr")).toBe("3 factures");
    expect(localizedGist("1 invoices", "fr")).toBe("1 facture");
    expect(localizedGist("3 invoices", "en")).toBe("3 invoices");
    expect(localizedGist("Renouvellement du contrat", "fr")).toBe("Renouvellement du contrat");
  });
});
