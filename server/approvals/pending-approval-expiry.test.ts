import { describe, expect, it } from "vitest";
import type { Message } from "../store.ts";
import {
  DAY_MS,
  DEFAULT_PENDING_APPROVAL_EXPIRE_DAYS,
  expirePendingApprovalIfDue,
  isPendingApprovalPastExpiry,
  parsePendingApprovalExpireDays,
  pendingApprovalExpireDays,
  pendingApprovalExpiresAt,
  pendingApprovalExpiryNote,
  sweepPendingApprovalExpiry,
  visiblePendingExpiresAt,
  type PendingExpiryDeps,
  type PendingExpiryRow,
} from "./pending-approval-expiry.ts";

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);

function card(extra: Record<string, unknown> = {}) {
  return {
    title: "Allow this?",
    subtitle: "write notes.md",
    options: ["Allow", "Deny"],
    requestType: "permission",
    requestId: "r1",
    tool: "Write",
    ...extra,
  };
}

function msg(id: string, at: number, c: Record<string, unknown>): Message {
  return { id, at, role: "bot", kind: "options", card: card(c) } as unknown as Message;
}

function captureDeps(rows: PendingExpiryRow[], days: number): PendingExpiryDeps & {
  patched: Array<[string, string, Record<string, unknown>]>;
  notes: Array<[string, string]>;
  released: Array<Record<string, unknown>>;
  journaled: Array<Record<string, unknown>>;
  withdrawn: Array<[string, string]>;
} {
  const patched: Array<[string, string, Record<string, unknown>]> = [];
  const notes: Array<[string, string]> = [];
  const released: Array<Record<string, unknown>> = [];
  const journaled: Array<Record<string, unknown>> = [];
  const withdrawn: Array<[string, string]> = [];
  return {
    patched,
    notes,
    released,
    journaled,
    withdrawn,
    open: () => rows,
    daysFor: () => days,
    now: () => NOW,
    patch: (threadId, messageId, next) => patched.push([threadId, messageId, next as unknown as Record<string, unknown>]),
    note: (threadId, text) => notes.push([threadId, text]),
    release: (row) => { released.push(row); },
    journal: (row) => { journaled.push(row); },
    withdraw: (threadId, requestId) => withdrawn.push([threadId, requestId]),
    botOf: () => ({ id: "bot-osprey", name: "Osprey" }),
    localeFor: () => "en",
  };
}

describe("pendingApprovalExpireDays", () => {
  it("defaults to 7 days", () => {
    expect(pendingApprovalExpireDays({ env: {} })).toBe(DEFAULT_PENDING_APPROVAL_EXPIRE_DAYS);
  });

  it("reads env, then prefers org, then person; 0 means never", () => {
    expect(pendingApprovalExpireDays({ env: { SAGAX_PENDING_APPROVAL_EXPIRE_DAYS: "14" } })).toBe(14);
    expect(pendingApprovalExpireDays({ orgDays: 3, env: { SAGAX_PENDING_APPROVAL_EXPIRE_DAYS: "14" } })).toBe(3);
    expect(pendingApprovalExpireDays({ personDays: 1, orgDays: 3, env: { SAGAX_PENDING_APPROVAL_EXPIRE_DAYS: "14" } })).toBe(1);
    expect(pendingApprovalExpireDays({ personDays: 0, orgDays: 3 })).toBe(0);
    expect(pendingApprovalExpireDays({ orgDays: 0 })).toBe(0);
    expect(pendingApprovalExpireDays({ env: { SAGAX_PENDING_APPROVAL_EXPIRE_DAYS: "0" } })).toBe(0);
  });

  it("rejects unusable values", () => {
    expect(parsePendingApprovalExpireDays(-1)).toBeNull();
    expect(parsePendingApprovalExpireDays(1.5)).toBeNull();
    expect(parsePendingApprovalExpireDays(366)).toBeNull();
    expect(parsePendingApprovalExpireDays("soon")).toBeNull();
    expect(parsePendingApprovalExpireDays("")).toBeNull();
    expect(pendingApprovalExpireDays({ orgDays: -1, env: {} })).toBe(7);
  });
});

describe("pendingApprovalExpiresAt / past expiry", () => {
  it("computes an absolute instant; 0 never expires", () => {
    expect(pendingApprovalExpiresAt(NOW - 8 * DAY_MS, 7)).toBe(NOW - DAY_MS);
    expect(pendingApprovalExpiresAt(NOW, 0)).toBeNull();
    expect(isPendingApprovalPastExpiry(NOW - 8 * DAY_MS, 7, NOW)).toBe(true);
    expect(isPendingApprovalPastExpiry(NOW - 3 * DAY_MS, 7, NOW)).toBe(false);
    expect(isPendingApprovalPastExpiry(NOW - 100 * DAY_MS, 0, NOW)).toBe(false);
  });

  it("visiblePendingExpiresAt prefers the card's own expiresAt", () => {
    expect(visiblePendingExpiresAt({ cardExpiresAt: 99, createdAt: NOW - DAY_MS, days: 7 })).toBe(99);
    expect(visiblePendingExpiresAt({ cardExpiresAt: null, createdAt: NOW - DAY_MS, days: 7 })).toBe(NOW - DAY_MS + 7 * DAY_MS);
    expect(visiblePendingExpiresAt({ cardExpiresAt: null, createdAt: NOW, days: 0 })).toBeNull();
  });
});

describe("pendingApprovalExpiryNote", () => {
  it("words the note in English and French", () => {
    expect(pendingApprovalExpiryNote(7, "en")).toBe(
      "This approval expired after 7 days without an answer; ask again if it is still needed.",
    );
    expect(pendingApprovalExpiryNote(7, "fr")).toContain("7 jours");
    expect(pendingApprovalExpiryNote(7, "fr")).toContain("expiré");
  });
});

describe("sweepPendingApprovalExpiry", () => {
  it("expires a card older than N with a note, leaves the list, and journals expired (not denied)", () => {
    const old = msg("m-old", NOW - 10 * DAY_MS, { requestId: "r-old" });
    const young = msg("m-young", NOW - 2 * DAY_MS, { requestId: "r-young", requestType: "question" });
    const deps = captureDeps(
      [
        { threadId: "t1", message: old },
        { threadId: "t2", message: young },
        { threadId: "human", message: msg("view", old.at, { requestId: "r-old", approvalOrigin: { threadId: "t1", messageId: "m-old", requestId: "r-old" } }) },
      ],
      7,
    );
    expect(sweepPendingApprovalExpiry(deps)).toBe(1);
    expect(deps.patched).toHaveLength(1);
    expect(deps.patched[0]).toEqual([
      "t1",
      "m-old",
      expect.objectContaining({ expired: true, options: [], requestId: "r-old" }),
    ]);
    // Distinct from a person's deny: no answered field set by expiry.
    expect(deps.patched[0]![2].answered).toBeUndefined();
    expect(deps.notes).toEqual([["t1", pendingApprovalExpiryNote(7, "en")]]);
    expect(deps.released).toHaveLength(1);
    expect(deps.journaled).toEqual([
      expect.objectContaining({ threadId: "t1", requestId: "r-old", botId: "bot-osprey", tool: "Write" }),
    ]);
    expect(deps.withdrawn).toEqual([["t1", "r-old"]]);
  });

  it("keeps a younger card and never expires when days is 0", () => {
    const old = msg("m1", NOW - 40 * DAY_MS, { requestId: "r1" });
    const youngDeps = captureDeps([{ threadId: "t", message: msg("m2", NOW - DAY_MS, { requestId: "r2" }) }], 7);
    expect(sweepPendingApprovalExpiry(youngDeps)).toBe(0);
    expect(youngDeps.patched).toEqual([]);

    const never = captureDeps([{ threadId: "t", message: old }], 0);
    expect(sweepPendingApprovalExpiry(never)).toBe(0);
    expect(never.patched).toEqual([]);
    expect(never.journaled).toEqual([]);
  });

  it("expires every inbox kind (permission, question, request) on the restart sweep path", () => {
    const kinds = ["permission", "question", undefined] as const;
    const rows = kinds.map((requestType, i) => ({
      threadId: `t${i}`,
      message: msg(`m${i}`, NOW - 9 * DAY_MS, {
        requestId: `r${i}`,
        ...(requestType ? { requestType } : { requestType: undefined, tool: undefined }),
      }),
    }));
    const deps = captureDeps(rows, 7);
    expect(sweepPendingApprovalExpiry(deps)).toBe(3);
    expect(deps.patched.every(([, , c]) => c.expired === true && c.answered === undefined)).toBe(true);
  });

  it("lazy path expires one due card on read", () => {
    const due = { threadId: "t", message: msg("m", NOW - 8 * DAY_MS, { requestId: "r" }) };
    const deps = captureDeps([due], 7);
    deps.patch = (threadId, messageId, next) => {
      deps.patched.push([threadId, messageId, next as unknown as Record<string, unknown>]);
      due.message = { ...due.message, card: next };
    };
    expect(expirePendingApprovalIfDue(deps, due)).toBe(true);
    expect(expirePendingApprovalIfDue(deps, due)).toBe(false);
    expect(deps.patched).toHaveLength(1);
  });
});

