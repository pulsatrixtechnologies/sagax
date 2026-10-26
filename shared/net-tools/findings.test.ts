import { describe, expect, it } from "vitest";

import { NET_FIXTURES, netStressFixture } from "./fixtures.ts";
import { NET_CARD_TEXT, NET_CHECK_LABELS, NET_DETAIL_LABELS, NET_FINDINGS, NET_VERDICT_LABELS, netFill, netFindingWords, type NetText } from "./findings.ts";
import { NET_TARGET_REFUSALS } from "./target.ts";
import { NET_CHECK_NAMES, NET_LANGUAGES, NET_VERDICTS } from "./types.ts";

const placeholders = (value: string) => [...value.matchAll(/\{([a-zA-Z_]+)\}/g)].map((match) => match[1]).sort();

function expectParity(name: string, text: NetText): void {
  for (const language of NET_LANGUAGES) expect(text[language]?.trim(), `${name} ${language}`).toBeTruthy();
  for (const language of NET_LANGUAGES) expect(placeholders(text[language]), `${name} ${language} placeholders`).toEqual(placeholders(text.en));
  // deliverable style: no em or en dashes
  for (const language of NET_LANGUAGES) expect(text[language], `${name} ${language}`).not.toMatch(/[\u2013\u2014]/);
}

describe("net-tools findings catalogue", () => {
  it("every finding has a title and a text in en, fr and pt-BR with the same placeholders", () => {
    expect(Object.keys(NET_FINDINGS).length).toBeGreaterThan(80);
    for (const [code, entry] of Object.entries(NET_FINDINGS)) {
      expect(code).toMatch(/^[a-z0-9_]+\.[a-z0-9_]+$/);
      expectParity(`${code}.title`, entry.title);
      expectParity(`${code}.text`, entry.text);
      if (entry.fix) expectParity(`${code}.fix`, entry.fix);
    }
  });

  it("labels, verdicts and card words are complete in the three languages", () => {
    for (const name of NET_CHECK_NAMES) expectParity(`check ${name}`, NET_CHECK_LABELS[name]);
    for (const verdict of NET_VERDICTS) expectParity(`verdict ${verdict}`, NET_VERDICT_LABELS[verdict]);
    for (const [key, text] of Object.entries(NET_CARD_TEXT)) expectParity(`card ${key}`, text);
    for (const [key, text] of Object.entries(NET_DETAIL_LABELS)) expectParity(`detail ${key}`, text);
  });

  it("check names follow the spec", () => {
    expect(NET_CHECK_LABELS.mail_auth_check).toEqual({ en: "SPF, DKIM and DMARC", fr: "SPF, DKIM et DMARC", "pt-BR": "SPF, DKIM e DMARC" });
    expect(NET_CHECK_LABELS.tcp_ping.en).toContain("not ICMP");
  });

  it("every target refusal has words", () => {
    for (const code of NET_TARGET_REFUSALS) expect(NET_FINDINGS[code], code).toBeDefined();
    for (const code of ["target.refused_address", "target.not_typed", "limit.rate", "limit.busy", "check.timeout", "check.no_egress", "check.error"]) expect(NET_FINDINGS[code], code).toBeDefined();
  });

  it("every fixture finding is in the catalogue and fills all of its placeholders", () => {
    const results = [...Object.values(NET_FIXTURES), netStressFixture()];
    for (const result of results) {
      for (const finding of result.findings) {
        const entry = NET_FINDINGS[finding.code];
        expect(entry, finding.code).toBeDefined();
        const given = Object.keys(finding.params ?? {});
        for (const text of [entry.title, entry.text, entry.fix].filter((item): item is NetText => Boolean(item))) {
          for (const name of placeholders(text.en)) expect(given, `${finding.code} needs {${name}}`).toContain(name);
        }
      }
    }
  });

  it("keeps the spec's example texts", () => {
    const words = (language: "en" | "fr" | "pt-BR") => netFindingWords({ code: "spf.softfail_all", severity: "warn" }, language);
    expect(`${words("en").text} ${words("en").fix}`).toBe("SPF ends with ~all: mail from unlisted servers is marked suspicious but still accepted. Use -all once every sender is listed.");
    expect(`${words("fr").text} ${words("fr").fix}`).toBe("Le SPF se termine par ~all : le courriel d'un serveur non listé est marqué comme suspect mais accepté. Passez à -all quand tous les expéditeurs sont listés.");
    expect(`${words("pt-BR").text} ${words("pt-BR").fix}`).toBe("O SPF termina com ~all: e-mails de servidores não listados são marcados como suspeitos, mas ainda aceitos. Use -all quando todos os remetentes estiverem listados.");
  });

  it("fills placeholders and marks a missing one", () => {
    expect(netFill("{count} records on {name}", { count: 3, name: "example.com" })).toBe("3 records on example.com");
    expect(netFill("{count} more", {})).toBe("? more");
    expect(netFill("{__proto__}", {})).toBe("?");
  });

  it("an unknown code still reads as its code", () => {
    expect(netFindingWords({ code: "future.check", severity: "info" }, "fr")).toEqual({ title: "future.check", text: "" });
  });
});
