import { describe, expect, it } from "vitest";

import { WIDGET_LIMITS } from "../widget.ts";
import { NET_FIXTURES, netStressFixture } from "./fixtures.ts";
import { netCheckModelText, netCheckSummary, netCheckText, netIssueCount } from "./text.ts";
import { NET_LANGUAGES, NET_RESULT_LIMITS } from "./types.ts";

describe("net-tools text", () => {
  it("summarises a result on one line for the tool row", () => {
    expect(netCheckSummary(NET_FIXTURES.mailAuthWarn, "en")).toBe("SPF, DKIM and DMARC: example.com: Problem (4 to review)");
    expect(netCheckSummary(NET_FIXTURES.mailAuthPass, "fr")).toBe("SPF, DKIM et DMARC: example.org: OK");
    expect(netCheckSummary(NET_FIXTURES.mxWarn, "pt-BR")).toBe("Consulta MX: example.org: Requer atenção (2 para revisar)");
    expect(netIssueCount(NET_FIXTURES.domainUnknown)).toBe(0);
    for (const result of Object.values(NET_FIXTURES)) expect(netCheckSummary(result, "en")).not.toContain("\n");
  });

  it("writes a readable fallback within the widget fallback limit", () => {
    for (const result of [...Object.values(NET_FIXTURES), netStressFixture()]) {
      for (const language of NET_LANGUAGES) {
        const text = netCheckText(result, language);
        expect(text.length).toBeLessThanOrEqual(WIDGET_LIMITS.fallback);
        expect(text.startsWith("**")).toBe(true);
      }
    }
    expect(netCheckText(NET_FIXTURES.tlsFail, "fr").split("\n")).toEqual([
      "**Certificat SSL/TLS: expired.example.com:443**",
      "Problème",
      "- Problème: Certificat expiré. Le certificat a expiré le 2026-09-30. Les navigateurs et les serveurs de courriel le refusent.",
      "- Problème: Chaîne incomplète. Le serveur n'envoie pas le certificat intermédiaire; certains clients ne peuvent pas le vérifier.",
      "- À surveiller: Signature SHA-1. Le certificat est signé en SHA-1, qui n'est plus jugé sûr.",
    ]);
  });

  it("gives the model compact English with codes, tables and raw output", () => {
    const text = netCheckModelText(NET_FIXTURES.mxWarn);
    expect(text.split("\n").slice(0, 5)).toEqual([
      "mx_lookup example.org: verdict warn. Checked from the Sagax server, not from the person's network.",
      "Findings:",
      "- [warn] mx.ptr_not_confirmed {\"ip\":\"198.51.100.25\",\"ptr\":\"host25.example.net\"}: Reverse DNS does not match. 198.51.100.25 reverses to host25.example.net, which does not resolve back to 198.51.100.25. Fix: Make the PTR name resolve to the same address.",
      "- [warn] mx.cname {\"host\":\"mx2.example.org\"}: MX points to a CNAME. mx2.example.org is a CNAME. Standards forbid it and some senders refuse it. Fix: Point the MX at the canonical host name.",
      "- [pass] mx.ok {\"count\":2}: 2 mail servers. The domain lists mail servers and each one has an address.",
    ]);
    expect(text).toContain("Mail servers (Priority | Host | IP addresses | PTR):\n10 | mx1.example.org | 198.51.100.24 | mx1.example.org");
    expect(netCheckModelText(NET_FIXTURES.dnsPass)).toContain("Raw:\nexample.com. 300 IN A 192.0.2.10");
  });

  it("keeps the model text under its budget", () => {
    const text = netCheckModelText(netStressFixture());
    expect(text.length).toBeLessThanOrEqual(NET_RESULT_LIMITS.modelText);
    expect(text).toContain("more findings not shown");
    expect(text).toContain("more rows not shown");
    for (const result of Object.values(NET_FIXTURES)) expect(netCheckModelText(result).length).toBeLessThanOrEqual(NET_RESULT_LIMITS.modelText);
  });
});
