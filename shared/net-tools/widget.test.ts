import { describe, expect, it } from "vitest";

import { containsUuid } from "../human-id.ts";
import { WIDGET_LIMITS, parseWidgetInput, resolveWidgetAction, widgetActions, widgetToText, type WidgetNode } from "../widget.ts";
import { NET_FIXTURES, netStressFixture } from "./fixtures.ts";
import { NET_ACTION_EXPLAIN, NET_ACTION_FIX, netCheckWidget, netCheckWidgetInput, netCheckedAt } from "./widget.ts";
import { NET_LANGUAGES, type NetCheckResult } from "./types.ts";

const ALL: Array<[string, NetCheckResult]> = [...Object.entries(NET_FIXTURES), ["stress", netStressFixture()]];

function nodes(root: WidgetNode): WidgetNode[] {
  const out: WidgetNode[] = [];
  const walk = (node: WidgetNode) => {
    out.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return out;
}

/** Every string a person can read on the card: not node ids, not action payloads. */
function visibleStrings(root: WidgetNode): string[] {
  const out: string[] = [];
  for (const node of nodes(root)) {
    for (const key of ["title", "caption", "value", "label"]) if (typeof node[key] === "string") out.push(node[key] as string);
  }
  return out;
}

describe("net-tools card mapping", () => {
  it("every fixture in every language parses and stays inside WIDGET_LIMITS", () => {
    for (const [name, result] of ALL) {
      for (const language of NET_LANGUAGES) {
        const input = netCheckWidgetInput(result, language, { timeZone: "America/Toronto" });
        expect(JSON.stringify(input).length, `${name} ${language} bytes`).toBeLessThanOrEqual(WIDGET_LIMITS.bytes);
        const parsed = parseWidgetInput(input);
        expect(parsed.ok ? "" : parsed.error, `${name} ${language}`).toBe("");
        if (!parsed.ok) continue;
        const root = parsed.value;
        expect(nodes(root).length, `${name} ${language} nodes`).toBeLessThanOrEqual(WIDGET_LIMITS.nodes);
        for (const table of nodes(root).filter((node) => node.type === "Table")) {
          expect(table.children?.length ?? 0).toBeLessThanOrEqual(WIDGET_LIMITS.tableRows);
          for (const row of table.children ?? []) expect(row.children?.length ?? 0).toBeLessThanOrEqual(WIDGET_LIMITS.tableCols);
        }
        expect(widgetToText(root).trim(), `${name} ${language} text`).not.toBe("");
        // action labels are unique among the presses that reach the bot
        const sent = widgetActions(root).filter((entry) => !entry.client).map((entry) => entry.label);
        expect(new Set(sent).size).toBe(sent.length);
        for (const text of visibleStrings(root)) expect(containsUuid(text), `${name}: ${text}`).toBe(false);
      }
    }
  });

  it("shows the verdict as a word and an icon, not only a color", () => {
    const words = { en: "Problem", fr: "Problème", "pt-BR": "Problema" } as const;
    for (const language of NET_LANGUAGES) {
      const root = netCheckWidget(NET_FIXTURES.mailAuthWarn, language);
      const badge = nodes(root).find((node) => node.type === "Badge");
      expect(badge?.label).toBe(words[language]);
      expect(badge?.color).toBe("danger");
    }
    const header = netCheckWidget(NET_FIXTURES.mxWarn, "en").children?.[0];
    expect(header?.children?.map((node) => [node.type, node.name ?? node.label])).toEqual([["Icon", "warning"], ["Badge", "Needs attention"]]);
  });

  it("titles the card with the check and the target, and says where it was checked from", () => {
    const root = netCheckWidget(NET_FIXTURES.mailAuthWarn, "en", { timeZone: "UTC" });
    expect(root.title).toBe("SPF, DKIM and DMARC: example.com");
    expect(root.caption).toMatch(/^Checked from this Sagax server · Oct 21, 2026, 2:32\sPM$/);
    expect(netCheckWidget(NET_FIXTURES.mailAuthWarn, "fr").caption).toMatch(/^Vérifié depuis ce serveur Sagax · .+ UTC$/);
    expect(netCheckWidget(NET_FIXTURES.mailAuthWarn, "pt-BR").title).toBe("SPF, DKIM e DMARC: example.com");
  });

  it("lists findings worst first with their explanation and fix", () => {
    const root = netCheckWidget(NET_FIXTURES.mailAuthWarn, "en");
    const titles = nodes(root).filter((node) => node.type === "Text" && node.weight === "medium").map((node) => node.value);
    expect(titles.slice(0, 5)).toEqual(["Too many DNS lookups", "SPF ends with ~all", "DKIM key is 1024-bit", "DMARC policy is none", "No DMARC reports address"]);
    const captions = nodes(root).filter((node) => node.type === "Caption").map((node) => node.value);
    expect(captions).toContain("SPF needs 12 DNS lookups; receivers stop at 10 and fail the check. Remove unused includes or replace some with ip4/ip6 ranges.");
  });

  it("offers Explain always and Suggest a fix only when something needs fixing", () => {
    const labels = (result: NetCheckResult) => widgetActions(netCheckWidget(result, "en")).map((entry) => [entry.label, entry.action.type]);
    expect(labels(NET_FIXTURES.mailAuthWarn)).toEqual([["Explain", NET_ACTION_EXPLAIN], ["Suggest a fix", NET_ACTION_FIX]]);
    expect(labels(NET_FIXTURES.mailAuthPass)).toEqual([["Explain", NET_ACTION_EXPLAIN]]);
    expect(labels(NET_FIXTURES.domainUnknown)).toEqual([["Explain", NET_ACTION_EXPLAIN]]);
    const fr = widgetActions(netCheckWidget(NET_FIXTURES.mailAuthWarn, "fr")).map((entry) => entry.label);
    expect(fr).toEqual(["Expliquer", "Proposer un correctif"]);
  });

  it("an Explain press resolves to a reply that names the check and the target", () => {
    const root = netCheckWidget(NET_FIXTURES.mailAuthWarn, "en");
    const explain = widgetActions(root).find((entry) => entry.label === "Explain");
    expect(explain?.action.payload).toEqual({ check: "mail_auth_check", target: "example.com" });
    const resolved = resolveWidgetAction({ v: 1, root }, explain?.ref ?? "", {});
    expect(resolved).toMatchObject({ ok: true, label: "Explain", text: "Explain", action: { type: NET_ACTION_EXPLAIN } });
  });

  it("delist links become open_url buttons", () => {
    const entries = widgetActions(netCheckWidget(NET_FIXTURES.blacklistFail, "en"));
    expect(entries.find((entry) => entry.action.type === "open_url")).toMatchObject({ client: true, label: "Delist: major.dnsbl.example" });
  });

  it("shows details tables with translated headers", () => {
    const root = netCheckWidget(NET_FIXTURES.mxWarn, "fr");
    const table = nodes(root).find((node) => node.type === "Table");
    const header = table?.children?.[0];
    expect(header?.header).toBe(true);
    expect(header?.children?.map((cell) => cell.children?.[0]?.value)).toEqual(["Priorité", "Hôte", "Adresses IP", "PTR"]);
    expect(nodes(root).some((node) => node.type === "Text" && node.value === "Serveurs de courriel")).toBe(true);
  });

  it("puts the raw output in a text fence the content cannot close", () => {
    const root = netCheckWidget(NET_FIXTURES.dnsPass, "en");
    const raw = nodes(root).find((node) => node.type === "Markdown")?.value as string;
    expect(raw.startsWith("```text\nexample.com. 300 IN A 192.0.2.10")).toBe(true);
    expect(raw.endsWith("\n```")).toBe(true);
    // the stress raw output holds ``` runs: the fence grows past them
    const stress = nodes(netCheckWidget(netStressFixture(), "en")).find((node) => node.type === "Markdown")?.value as string;
    expect(stress.startsWith("````text\n```\n")).toBe(true);
    expect(stress.endsWith("\n````")).toBe(true);
    expect(stress.length).toBeLessThanOrEqual(WIDGET_LIMITS.markdown);
  });

  it("trims a result past every limit and says what it left out", () => {
    const stress = netStressFixture();
    for (const language of NET_LANGUAGES) {
      const root = netCheckWidget(stress, language);
      const findingRows = nodes(root).filter((node) => node.type === "Row" && node.align === "start");
      expect(findingRows.length).toBe(8);
      const captions = nodes(root).filter((node) => node.type === "Caption").map((node) => String(node.value));
      expect(captions).toContain({ en: "and 22 more", fr: "et 22 de plus", "pt-BR": "e mais 22" }[language]);
      expect(captions.some((text) => /\d+ (more rows not shown|autres lignes non affichées|linhas a mais não exibidas)/.test(text))).toBe(true);
      expect(String(root.title).length).toBeLessThanOrEqual(WIDGET_LIMITS.title);
      const links = widgetActions(root).filter((entry) => entry.action.type === "open_url");
      expect(links.length).toBeLessThanOrEqual(6);
      expect(new Set(links.map((entry) => entry.label)).size).toBe(links.length);
    }
  });

  it("a result with no findings says there is nothing to report", () => {
    const root = netCheckWidget(NET_FIXTURES.empty, "pt-BR");
    expect(nodes(root).find((node) => node.type === "Badge")?.label).toBe("Desconhecido");
    expect(nodes(root).some((node) => node.value === "Nada a relatar.")).toBe(true);
  });

  it("formats the time in the viewer's zone, or UTC", () => {
    expect(netCheckedAt(NET_FIXTURES.dnsPass.at, "en")).toMatch(/2:32\sPM UTC$/);
    expect(netCheckedAt(NET_FIXTURES.dnsPass.at, "en", { timeZone: "America/Toronto" })).toMatch(/10:32\sAM$/);
    expect(netCheckedAt(NET_FIXTURES.dnsPass.at, "fr", { timeZone: "America/Toronto" })).toMatch(/10 h 32|10:32/);
    expect(netCheckedAt(NET_FIXTURES.dnsPass.at, "en", { timeZone: "Not/AZone" })).toBe("2026-10-21 14:32 UTC");
  });
});
