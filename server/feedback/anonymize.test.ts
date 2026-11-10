import { describe, expect, it } from "vitest";
import { anonymize, anonymizeLines, anonymizeWords, maskUnknownNames } from "./anonymize.ts";

const NAMES = {
  people: ["Alexandra Tremblay", "Jordan"],
  orgs: ["Acme Plomberie"],
  bots: ["Nova"],
};

describe("feedback anonymizer", () => {
  it("masks secrets and tokens with the existing redactor", () => {
    const out = anonymize("export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789AB and Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijk", {});
    expect(out).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789AB");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("masks emails", () => {
    expect(anonymize("write to alex.t@acme-plomberie.ca please", {})).toBe("write to [email] please");
  });

  it("masks phone numbers but keeps dates and times", () => {
    expect(anonymize("call 514-555-0199 or +1 (438) 555 0101", {})).toBe("call [phone] or [phone]");
    expect(anonymize("on 2026-11-07 16:17:05", {})).toBe("on 2026-11-07 16:17:05");
  });

  it("masks people, organization and bot names, whole words, any case", () => {
    const out = anonymize("Alexandra Tremblay from ACME PLOMBERIE asked Nova; jordan agreed. Jordanie stays.", NAMES);
    expect(out).toBe("[person] from [org] asked [bot]; [person] agreed. Jordanie stays.");
  });

  it("masks UUIDs and long ids", () => {
    const out = anonymize("thread 3f2a9c1e-8b7d-4e6f-9a0b-1c2d3e4f5a6b bot k3j9x2m8q7w1z5 hash 9f86d081884c7d659a2feaa0c55ad015", {});
    expect(out).toBe("thread [id] bot [id] hash [id]");
  });

  it("masks private paths whole on macOS, Linux, Windows and shares (#3299)", () => {
    expect(anonymize("/Users/alex/Library/Logs/x.log", {})).toBe("[path]");
    expect(anonymize("see /home/alex/.sagax/data now", {})).toBe("see [path] now");
    expect(anonymize("C:\\Users\\Alex\\AppData\\Roaming", {})).toBe("[path]");
    expect(anonymize("open \\\\FS01\\Clients\\Acme", {})).toBe("open [path]");
    expect(anonymize("/Volumes/Clients/Acme/q3.xlsx and ~/Documents/acme.pdf", {})).toBe("[path] and [path]");
    expect(anonymize("GET /api/bots/x/messages failed in server/feedback/report.ts", {})).toBe("GET /api/bots/x/messages failed in server/feedback/report.ts");
  });

  it("masks ticket numbers and the text quoted after them (#3299)", () => {
    expect(anonymize('ticket #48213 "Printer down at the north office" is stuck', {})).toBe("[ticket] [ticket text] is stuck");
    expect(anonymize("billet 297048 et cas INC-00123", {})).toBe("[ticket] et [ticket]");
    expect(anonymize("see #123456", {})).toBe("see [ticket]");
    expect(anonymize("HTTP 404 on request 500 times", {})).toBe("HTTP 404 on request 500 times");
  });

  it("masks computer and server names, known or by their shape (#3299)", () => {
    expect(anonymize("from Ada's MacBook Pro and adas-imac to SRV-DC01", {})).toBe("from [host] and [host] to [host]");
    expect(anonymize("UTF-8 and SHA-256 and GPT-5 stay", {})).toBe("UTF-8 and SHA-256 and GPT-5 stay");
    expect(anonymize("the iPhone app on studio-7", { hosts: ["studio-7"], other: ["adalove"] })).toBe("the iPhone app on [host]");
    expect(anonymize("login adalove", { other: ["adalove"] })).toBe("login [name]");
  });

  it("masks IPv4 and IPv6 addresses", () => {
    expect(anonymize("from 192.168.10.24 and 2001:db8::8a2e:370:7334", {})).toBe("from [ip] and [ip]");
  });

  it("masks client domains, keeps allowed ones and file names", () => {
    const out = anonymize("open https://portal.acme-plomberie.ca/x and https://github.com/pulsatrixtechnologies/sagax; see server.log and index.ts", {});
    expect(out).toBe("open https://[domain]/x and https://github.com/pulsatrixtechnologies/sagax; see server.log and index.ts");
  });

  it("neutralizes GitHub mentions so nobody is notified", () => {
    expect(anonymize("ping @someone about it", {})).toBe("ping [handle] about it");
  });

  it("anonymizes each log line and caps the count", () => {
    const lines = anonymizeLines(Array.from({ length: 80 }, (_, i) => `line ${i} from 10.0.0.${i % 200}`), {}, 40);
    expect(lines).toHaveLength(40);
    expect(lines.every((line) => line.includes("[ip]"))).toBe(true);
  });

  it("keeps ISO timestamps of the log readable", () => {
    expect(anonymize("2026-11-07T23:56:37.075Z warn engine", {})).toContain("2026-11-07T23:56:37.075Z");
  });

  it("masks people and companies the server does not know, in English and French (#3299)", () => {
    const known = { people: ["Alice Martin"], orgs: ["Contoso"] };
    expect(anonymizeWords("Bob Tremblay de Fabrikam m'a demandé", known)).toBe("[name] m'a demandé");
    expect(anonymizeWords("Can you check the backups for Northwind Traders? Alice Martin asked.", known)).toBe("Can you check the backups for [name]? [person] asked.");
    expect(anonymizeWords("Peux-tu appeler Jean-Pierre D'Amours chez fabrikam", {})).toBe("Peux-tu appeler [name] chez [name]");
    expect(anonymizeWords("Send the report to the client wingtip and to ACMEX", {})).toBe("Send the report to the client [name] and to [name]");
    expect(anonymizeWords("Dominique's report at O'Neil Holdings", {})).toBe("[name] report at [name]");
  });

  it("keeps ordinary words, products and technical terms in free text (#3299)", () => {
    const text = "Show the open routines for this week. I expected the Outlook calendar on macOS but the API returns JSON with HTTP 500. Don't retry. C'est l'écran Réglages qui gèle, j'ai essayé deux fois.";
    expect(maskUnknownNames(text)).toBe(text);
  });
});
