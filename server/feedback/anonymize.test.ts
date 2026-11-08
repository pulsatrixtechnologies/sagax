import { describe, expect, it } from "vitest";
import { anonymize, anonymizeLines } from "./anonymize.ts";

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

  it("masks user paths on macOS, Linux and Windows", () => {
    expect(anonymize("/Users/alex/Library/Logs/x.log", {})).toBe("/Users/[user]/Library/Logs/x.log");
    expect(anonymize("/home/alex/.sagax/data", {})).toBe("/home/[user]/.sagax/data");
    expect(anonymize("C:\\Users\\Alex\\AppData\\Roaming", {})).toBe("C:\\Users\\[user]\\AppData\\Roaming");
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
});
