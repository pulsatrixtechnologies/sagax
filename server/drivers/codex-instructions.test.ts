import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DATA_DIR } from "../config.ts";
import { CODEX_SECTION_NOTES_BEFORE_FULL, codexDeveloperInstructions, forgetCodexVolatile, syncCodexInstructions } from "./codex-instructions.ts";

const receiptPath = (key: string, nativeThreadId: string) =>
  join(DATA_DIR, "codex-instructions", `${createHash("sha256").update(JSON.stringify([key, nativeThreadId])).digest("hex")}.sha256`);

describe("Codex effective developer instructions", () => {
  it("preserves native rules after bot rules, including when bot rules are removed", () => {
    const config = { developer_instructions: "Native rules." };
    expect(codexDeveloperInstructions(config, "Bot rules.")).toBe("Bot rules.\n\nNative rules.");
    expect(codexDeveloperInstructions(config, "")).toBe("No Sagax bot-specific instructions remain.\n\nNative rules.");
    expect(codexDeveloperInstructions({}, "Bot rules.")).toBe("Bot rules.");
    expect(codexDeveloperInstructions({ developer_instructions: null }, "")).toBe("");
  });

  it.each([undefined, null, [], { developer_instructions: 42 }])("rejects unknown native configuration: %j", (config) => {
    expect(() => codexDeveloperInstructions(config, "Bot rules.")).toThrow("cannot safely update bot instructions");
  });
});

describe("Codex instruction receipts", () => {
  it("does not repeat unchanged rules, but persists edits and removal", async () => {
    const key = randomUUID();
    const request = vi.fn().mockResolvedValue({});
    await syncCodexInstructions(key, "native", "old", "", false, request);
    await syncCodexInstructions(key, "native", "old", "", true, request);
    expect(request).not.toHaveBeenCalled();
    await syncCodexInstructions(key, "native", "new", "", true, request);
    await syncCodexInstructions(key, "native", "new", "", true, request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1].items[0]).toMatchObject({ role: "developer" });
    expect(request.mock.calls[0][1].items[0].content[0].text).toContain("new");
    await syncCodexInstructions(key, "native", "", "", true, request);
    await syncCodexInstructions(key, "native", "", "", true, request);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][1].items[0].content[0].text).toContain("No Sagax bot-specific instructions remain.");
  });

  it("adopts an existing native session once without replaying user history", async () => {
    const key = randomUUID();
    const request = vi.fn().mockResolvedValue({});
    await syncCodexInstructions(key, "pre-fix", "current rules", "", true, request);
    await syncCodexInstructions(key, "pre-fix", "current rules", "", true, request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe("thread/inject_items");
    expect(request.mock.calls[0][1].threadId).toBe("pre-fix");
    expect(request.mock.calls[0][1].items).toHaveLength(1);
  });

  it("does not acknowledge an update that Codex rejected", async () => {
    const key = randomUUID();
    const rejected = vi.fn().mockRejectedValue(new Error("method not found"));
    await expect(syncCodexInstructions(key, "native", "rules", "", true, rejected)).rejects.toThrow("method not found");
    const accepted = vi.fn().mockResolvedValue({});
    await syncCodexInstructions(key, "native", "rules", "", true, accepted);
    await syncCodexInstructions(key, "native", "rules", "", true, accepted);
    expect(accepted).toHaveBeenCalledTimes(1);
  });

  it("keeps native sessions independent even for one Sagax task", async () => {
    const key = randomUUID();
    const request = vi.fn().mockResolvedValue({});
    await syncCodexInstructions(key, "first", "rules", "", false, request);
    await syncCodexInstructions(key, "second", "rules", "", true, request);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("delivers a changed volatile half without touching developer rules", async () => {
    const key = randomUUID();
    const request = vi.fn().mockResolvedValue({});
    const first = await syncCodexInstructions(key, "native", "rules", "memory v1", false, request);
    first.commitVolatile?.();
    expect(first).toMatchObject({ deliverVolatile: true, hadVolatile: false });
    const unchanged = await syncCodexInstructions(key, "native", "rules", "memory v1", true, request);
    expect(unchanged).toMatchObject({ deliverVolatile: false, hadVolatile: true });
    const changed = await syncCodexInstructions(key, "native", "rules", "memory v2", true, request);
    changed.commitVolatile?.();
    expect(changed).toMatchObject({ deliverVolatile: true, hadVolatile: true });
    expect(request).not.toHaveBeenCalled();
    const cleared = await syncCodexInstructions(key, "native", "rules", "", true, request);
    cleared.commitVolatile?.();
    expect(cleared).toMatchObject({ deliverVolatile: true, hadVolatile: true });
  });

  it("remembers the volatile sections the native thread holds, only once committed", async () => {
    const key = randomUUID();
    const request = vi.fn().mockResolvedValue({});
    const v1 = { memory: "a".repeat(64), recent: "b".repeat(64) };
    const first = await syncCodexInstructions(key, "native", "rules", "memory v1", false, request, false, v1);
    expect(first.previousSections).toBeUndefined();
    first.commitVolatile?.();
    const changed = await syncCodexInstructions(key, "native", "rules", "memory v2", true, request, false, { ...v1, recent: "c".repeat(64) });
    expect(changed.previousSections).toEqual(v1);
    // not committed (the provider refused the turn): the old copy still counts
    const retried = await syncCodexInstructions(key, "native", "rules", "memory v2", true, request, false, { ...v1, recent: "c".repeat(64) });
    expect(retried.previousSections).toEqual(v1);
    // a fresh native thread holds nothing yet
    const fresh = await syncCodexInstructions(key, "native-2", "rules", "memory v2", false, request, false, v1);
    expect(fresh.previousSections).toBeUndefined();
  });

  it("sends the whole half again after a run of section-only notes (Codex compacts silently)", async () => {
    const key = randomUUID();
    const request = vi.fn().mockResolvedValue({});
    const prints = (n: number) => ({ memory: "a".repeat(64), recent: n.toString(16).padStart(64, "0") });
    (await syncCodexInstructions(key, "native", "rules", "v0", false, request, false, prints(0))).commitVolatile?.();
    const known: boolean[] = [];
    for (let n = 1; n <= CODEX_SECTION_NOTES_BEFORE_FULL + 2; n++) {
      const sync = await syncCodexInstructions(key, "native", "rules", `v${n}`, true, request, false, prints(n));
      known.push(sync.previousSections !== undefined);
      sync.commitVolatile?.();
    }
    expect(known).toEqual([...Array(CODEX_SECTION_NOTES_BEFORE_FULL).fill(true), false, true]);
  });

  it("sends the whole half again after Codex compacts its thread", async () => {
    const key = randomUUID();
    const request = vi.fn().mockResolvedValue({});
    const v1 = { memory: "a".repeat(64), recent: "b".repeat(64) };
    (await syncCodexInstructions(key, "native", "rules", "memory v1", false, request, false, v1)).commitVolatile?.();
    forgetCodexVolatile(key, "native");
    // same volatile text: delivered anyway, as a whole half
    const after = await syncCodexInstructions(key, "native", "rules", "memory v1", true, request, false, v1);
    expect(after.deliverVolatile).toBe(true);
    expect(after.previousSections).toBeUndefined();
    // instructions untouched: no developer update is injected again
    expect(request).not.toHaveBeenCalled();
    forgetCodexVolatile(key, "missing");
  });

  it("treats a legacy bare-fingerprint receipt as unknown volatile context", async () => {
    const key = randomUUID();
    const request = vi.fn().mockResolvedValue({});
    await syncCodexInstructions(key, "native", "rules", "", false, request);
    // A receipt written before the split carries only the instruction digest.
    const path = receiptPath(key, "native");
    const fingerprint = JSON.parse(readFileSync(path, "utf8")).instructions;
    writeFileSync(path, fingerprint, { mode: 0o600 });
    const legacy = await syncCodexInstructions(key, "native", "rules", "memory v1", true, request);
    expect(legacy).toMatchObject({ deliverVolatile: true, hadVolatile: false });
    expect(request).not.toHaveBeenCalled();
  });

  it("delivers mention context on every tagged turn even when the volatile half is unchanged", async () => {
    const key = randomUUID();
    const request = vi.fn().mockResolvedValue({});
    const first = await syncCodexInstructions(key, "native", "rules", "Tagged: @Testy", false, request);
    first.commitVolatile?.();
    const untagged = await syncCodexInstructions(key, "native", "rules", "Tagged: @Testy", true, request);
    expect(untagged.deliverVolatile).toBe(false);
    const tagged = await syncCodexInstructions(key, "native", "rules", "Tagged: @Testy", true, request, true);
    expect(tagged.deliverVolatile).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps the volatile digest pending until the provider accepts the turn", async () => {
    const key = randomUUID();
    const request = vi.fn().mockResolvedValue({});
    const first = await syncCodexInstructions(key, "native", "rules", "memory v1", true, request);
    expect(first.deliverVolatile).toBe(true);
    // the on-disk receipt does not yet claim the volatile half was carried
    const path = receiptPath(key, "native");
    const pending = JSON.parse(readFileSync(path, "utf8"));
    expect(pending).toEqual({ instructions: expect.any(String) });
    // so a retry before acceptance still redelivers it
    const retry = await syncCodexInstructions(key, "native", "rules", "memory v1", true, request);
    expect(retry.deliverVolatile).toBe(true);
    expect(first.commitVolatile).toBeTypeOf("function");
    first.commitVolatile?.();
    const committed = JSON.parse(readFileSync(path, "utf8"));
    expect(committed).toEqual({ instructions: pending.instructions, volatile: expect.any(String) });
    const after = await syncCodexInstructions(key, "native", "rules", "memory v1", true, request);
    expect(after.deliverVolatile).toBe(false);
    expect(after.commitVolatile).toBeNull();
  });
});
