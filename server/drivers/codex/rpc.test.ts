import { describe, expect, it } from "vitest";
import { CodexRpcError, archivedNativeCodexThread, missingNativeCodexThread } from "./rpc.ts";

describe("missingNativeCodexThread", () => {
  it("matches only Codex's verified empty-home resume rejection", () => {
    const cursor = "thread-abc";
    expect(missingNativeCodexThread(
      new CodexRpcError({ code: -32600, message: `no rollout found for thread id ${cursor}` }),
      cursor,
    )).toBe(true);
    expect(missingNativeCodexThread(
      new CodexRpcError({ code: -32600, message: "no rollout found for thread id other" }),
      cursor,
    )).toBe(false);
    expect(missingNativeCodexThread(
      new CodexRpcError({ code: 404, message: `no rollout found for thread id ${cursor}` }),
      cursor,
    )).toBe(false);
    expect(missingNativeCodexThread(new Error(`no rollout found for thread id ${cursor}`), cursor)).toBe(false);
  });
});

describe("archivedNativeCodexThread", () => {
  it("detects archived session prose that names the cursor", () => {
    const cursor = "sess-1";
    expect(archivedNativeCodexThread(
      new CodexRpcError({ message: `session ${cursor} is archived. Run \`codex unarchive ${cursor}\` first.` }),
      cursor,
    )).toBe(true);
    expect(archivedNativeCodexThread(
      new CodexRpcError({ message: `session other is archived` }),
      cursor,
    )).toBe(false);
    expect(archivedNativeCodexThread(new Error(`session ${cursor} is archived`), cursor)).toBe(false);
  });
});
