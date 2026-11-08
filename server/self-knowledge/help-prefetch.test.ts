import { describe, expect, it } from "vitest";
import { bundledKnowledgeIndex, indexKnowledge } from "./self-knowledge.ts";
import type { KnowledgeBase } from "./self-knowledge-types.ts";
import { HELP_PREFETCH_HEADER, namedTerms, wantsHelpPrefetch, withHelpPrefetch } from "./help-prefetch.ts";

const base = {
  version: "0.8.66",
  generated: "2026-11-08",
  sections: [
    { id: "doc:approvals#today", kind: "doc", title: "Approvals and inspector: Today", text: "Today (the Approvals page) is the one box for everything your bots wait on you for.", source: "approvals.mdx" },
    { id: "doc:automation#heartbeat", kind: "doc", title: "Routines and webhooks: Heartbeat checklist", text: "HEARTBEAT.md at the root of the workspace lists the checks that wake the bot.", source: "automation.mdx" },
    { id: "tool:connect_github", kind: "tool", title: "connect_github", text: "Connect GitHub with a link and a code from any chat.", source: "tools.ts" },
    { id: "guide:routine-create", kind: "guide", title: "Create a routine", keywords: "routine schedule cron recurring every morning", text: "To create a routine, ask the bot: it schedules a recurring job with routine_create.", source: "guides.md" },
    { id: "doc:mail", kind: "doc", title: "Mail", text: "Bots read and send mail through the connected account.", source: "mail.mdx" },
  ],
} as unknown as KnowledgeBase;
const index = indexKnowledge(base);

describe("help prefetch", () => {
  it("prefetches for a question naming the product and adds the page the message names (QA 0.8.66 Today)", () => {
    const question = "Dans Sagax, c'est quoi Today, à quoi sert HEARTBEAT, et comment je connecte GitHub ? Court.";
    const out = withHelpPrefetch("TURN", question, index, { organization: false, release: "0.8.66" });
    expect(out.ids).toContain("doc:approvals#today");
    expect(out.ids).toContain("tool:connect_github");
    expect(out.text.startsWith("TURN\n\n<sagax_help_prefetch>\n")).toBe(true);
    expect(out.text).toContain(HELP_PREFETCH_HEADER);
    expect(out.text.endsWith("</sagax_help_prefetch>")).toBe(true);
  });

  it("prefetches a how-to the product is not named in only when a guide matches strongly", async () => {
    const bundled = (await bundledKnowledgeIndex())!;
    expect(wantsHelpPrefetch(bundled, "Crée une routine qui me résume mes courriels chaque matin.", { organization: false })).toBe(true);
    expect(wantsHelpPrefetch(bundled, "Écris un courriel à Marc pour reporter la rencontre.", { organization: false })).toBe(false);
    expect(wantsHelpPrefetch(bundled, "Quelle heure est-il maintenant à Montréal (ET) ?", { organization: false })).toBe(false);
    const plain = withHelpPrefetch("TURN", "Écris un courriel à Marc.", index, { organization: false });
    expect(plain).toEqual({ text: "TURN", ids: [] });
    expect(withHelpPrefetch("TURN", "Dans Sagax, Today ?", null, { organization: false })).toEqual({ text: "TURN", ids: [] });
  });

  it("names are capitalized words not first in their sentence, or all caps", () => {
    expect(namedTerms("Dans Sagax, c'est quoi Today, et HEARTBEAT ? Court.")).toEqual(["sagax", "today", "heartbeat"]);
    expect(namedTerms("Bonjour. Merci")).toEqual([]);
  });
});
