import { describe, expect, it } from "vitest";

import { parseUnattendedConsent, defaultUnattendedExpiry } from "./remote-session-consent.ts";
import {
  adminHostKey,
  filterAdminRows,
  redactCommand,
  sortAdminRows,
  toAdminRow,
  type AdminSessionInput,
} from "./remote-session-admin.ts";

const NOW = Date.parse("2026-10-22T12:00:00.000Z");

function session(over: Partial<AdminSessionInput> = {}): AdminSessionInput {
  return {
    id: "a1b2c3d4e5f6",
    code: "ABC234",
    os: "windows",
    elevated: false,
    endAt: "2026-10-22T18:00:00.000Z",
    state: "connected",
    createdAt: NOW - 60_000,
    hostname: "PC-RECEPTION",
    user: "marie",
    ownerId: "tech@gox",
    botId: "bot-7",
    reachable: true,
    ...over,
  };
}

describe("toAdminRow", () => {
  it("maps a connected session with the bot label and the opener", () => {
    const row = toAdminRow(session({ openedBy: "tech@gox" }), { botLabel: "Atlas", now: NOW });
    expect(row.host).toBe("PC-RECEPTION");
    expect(row.status).toBe("connected");
    expect(row.botLabel).toBe("Atlas");
    expect(row.botId).toBe("bot-7");
    expect(row.openedBy).toBe("tech@gox");
    expect(row.unattended).toBe(false);
  });

  it("marks failed when it ended without ever reading the computer", () => {
    const row = toAdminRow(session({ state: "ended", hostname: undefined, inventory: "no-answer" }), { botLabel: "Atlas", now: NOW });
    expect(row.status).toBe("failed");
    const ok = toAdminRow(session({ state: "ended", inventory: "ready" }), { botLabel: "Atlas", now: NOW });
    expect(ok.status).toBe("ended");
  });

  it("surfaces unattended consent (since, expiry, banner, signed)", () => {
    const consent = parseUnattendedConsent({ hostKey: "sn-9", org: "GOX", installedBy: "admin@gox", bannerVisible: false, signed: true, expiresAt: defaultUnattendedExpiry(NOW, 60) }, NOW)!;
    const row = toAdminRow(session(), { botLabel: "Atlas", consent, now: NOW });
    expect(row.unattended).toBe(true);
    expect(row.bannerVisible).toBe(false);
    expect(row.signed).toBe(true);
    expect(row.unattendedExpiresAt).toBe(consent.expiresAt);
  });

  it("drops a revoked or expired consent", () => {
    const expired = parseUnattendedConsent({ hostKey: "sn-9", org: "GOX", installedBy: "a", installedAt: new Date(NOW - 10 * 86400000).toISOString(), expiresAt: new Date(NOW - 86400000).toISOString() }, NOW - 10 * 86400000)!;
    expect(toAdminRow(session(), { botLabel: "A", consent: expired, now: NOW }).unattended).toBe(false);
  });
});

describe("adminHostKey", () => {
  it("prefers serial, then hostname, then code, lowercased", () => {
    expect(adminHostKey({ serial: "SN-9", hostname: "PC", code: "ABC234" })).toBe("sn-9");
    expect(adminHostKey({ hostname: "PC-01", code: "ABC234" })).toBe("pc-01");
    expect(adminHostKey({ code: "ABC234" })).toBe("abc234");
  });
});

describe("filterAdminRows / sort", () => {
  const rows = [
    toAdminRow(session({ id: "aaaaaaaaaaaa", state: "connected", hostname: "PC-A", botId: "b1" }), { botLabel: "Atlas", now: NOW }),
    toAdminRow(session({ id: "bbbbbbbbbbbb", state: "ended", hostname: "PC-B", botId: "b2", createdAt: NOW - 120_000 }), { botLabel: "Boreas", now: NOW }),
  ];

  it("active only, by bot, by host, and search", () => {
    expect(filterAdminRows(rows, { activeOnly: true }).map((r) => r.id)).toEqual(["aaaaaaaaaaaa"]);
    expect(filterAdminRows(rows, { botId: "b2" }).map((r) => r.id)).toEqual(["bbbbbbbbbbbb"]);
    expect(filterAdminRows(rows, { host: "pc-b" }).map((r) => r.id)).toEqual(["bbbbbbbbbbbb"]);
    expect(filterAdminRows(rows, { search: "boreas" }).map((r) => r.id)).toEqual(["bbbbbbbbbbbb"]);
    expect(filterAdminRows(rows, { unattendedOnly: true })).toHaveLength(0);
  });

  it("sorts connected before ended, newest first", () => {
    expect(sortAdminRows([rows[1]!, rows[0]!]).map((r) => r.id)).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
  });
});

describe("redactCommand", () => {
  it("strips a tunnel token and a node key from a command", () => {
    expect(redactCommand("echo hi tc0123456789abcdef0123456789 nodekey:" + "a".repeat(64))).toBe("echo hi");
    expect(redactCommand(undefined)).toBe("");
  });
});
