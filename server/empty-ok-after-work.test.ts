import { describe, expect, it } from "vitest";
import { emptyOkAfterAnnouncement, emptyOkAfterWork } from "./empty-ok-after-work.ts";

describe("emptyOkAfterWork (#5360)", () => {
  it("ignores a failed, stopped, silent or answered turn", () => {
    const rows = [{ role: "bot", kind: "tool", turnId: "t1", tool: { name: "x" } }];
    expect(emptyOkAfterWork({ ok: false, stopped: false, reply: "", silent: false, turnId: "t1", rows })).toBe(false);
    expect(emptyOkAfterWork({ ok: true, stopped: true, reply: "", silent: false, turnId: "t1", rows })).toBe(false);
    expect(emptyOkAfterWork({ ok: true, stopped: false, reply: "", silent: true, turnId: "t1", rows })).toBe(false);
    expect(emptyOkAfterWork({ ok: true, stopped: false, reply: "Done.", silent: false, turnId: "t1", rows })).toBe(false);
  });

  it("flags tools then silence", () => {
    expect(emptyOkAfterWork({
      ok: true, stopped: false, reply: "", silent: false, turnId: "t1",
      rows: [
        { role: "bot", kind: "text", turnId: "t1", text: "I will read the settings." },
        { role: "bot", kind: "tool", turnId: "t1", tool: { name: "sagax_settings" } },
      ],
    })).toBe(true);
  });

  it("leaves an announcement-only turn to emptyOkAfterAnnouncement", () => {
    const rows = [{ role: "bot", kind: "text", turnId: "t1", text: "Compris : j'audite au complet." }];
    const input = { ok: true, stopped: false, reply: "", silent: false, turnId: "t1", rows };
    expect(emptyOkAfterWork(input)).toBe(false);
    expect(emptyOkAfterAnnouncement(input)).toBe(true);
  });

  it("leaves a waiting card alone", () => {
    expect(emptyOkAfterWork({
      ok: true, stopped: false, reply: "", silent: false, turnId: "t1",
      rows: [{ role: "bot", kind: "options", turnId: "t1", card: { requestId: "ask-1" } }],
    })).toBe(false);
  });
});
