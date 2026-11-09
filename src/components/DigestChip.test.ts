import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { CompactionChip, DigestChip, DigestDetail } from "./DigestChip";

const message: Message = {
  id: "receipt", role: "bot", kind: "digest", at: 1, text: "[digest] · tools: Bash×12 · reply: done",
  digest: {
    turnId: "turn", botId: "bot", threadId: "thread", at: 1, durationMs: 100,
    tools: [{ name: "Bash", count: 12, failed: 1 }], toolsDropped: 2, toolCalls: 19,
    files: { changed: ["a.ts"], added: [], deleted: [], truncated: 4 },
    memory: [], reply: "Finished this turn.", hookCoverage: "preview",
  },
};

describe("DigestChip", () => {
  it("does not draw a receipt for a reply with no recorded work", () => {
    for (const files of [undefined, { changed: [], added: [], deleted: [] }]) {
      const html = renderToStaticMarkup(createElement(DigestChip, { message: {
        ...message, digest: { ...message.digest!, tools: [], toolsDropped: 0, toolCalls: 0,
          files, memory: [], memoryDropped: 0 },
      } }));
      expect(html).toBe("");
    }
  });

  it("keeps file, memory, and truncated work even without a sampled tool", () => {
    const quiet = { ...message.digest!, tools: [], toolsDropped: 0, toolCalls: 0,
      files: undefined, memory: [], memoryDropped: 0 };
    for (const work of [
      { files: { changed: ["notes.txt"], added: [], deleted: [] } },
      { memory: [{ kind: "updated" as const, path: "MEMORY.md" }] },
      { toolsDropped: 2 }, { toolCalls: 2 }, { memoryDropped: 2 },
      { files: { changed: [], added: [], deleted: [], truncated: 2 } },
    ]) {
      const html = renderToStaticMarkup(createElement(DigestChip, { message: { ...message, digest: { ...quiet, ...work } } }));
      expect(html).toContain('data-testid="digest-chip"');
    }
  });

  it("shows compaction as expandable historical text, never executable markup", () => {
    const html = renderToStaticMarkup(createElement(CompactionChip, { message: {
      id: "context", role: "bot", kind: "compaction", at: 1,
      compaction: { summary: "Latest correction: <script>bad()</script> x < -5", firstKeptId: "", foldedThroughId: "old", tokensBefore: 1, by: "person" },
    } }));
    expect(html).toContain("<details");
    expect(html).toContain("Earlier context summarized");
    expect(html).toContain("Your full conversation is still here");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("never shows a fold Sagax made on its own, only one the person asked for", () => {
    const html = renderToStaticMarkup(createElement(CompactionChip, { message: {
      id: "context", role: "bot", kind: "compaction", at: 1,
      compaction: { summary: "Older turns", firstKeptId: "kept", foldedThroughId: "old", tokensBefore: 1, by: "harness" },
    } }));
    expect(html).toBe("");
  });
  it("shows total counts rather than only the truncated sample", () => {
    const html = renderToStaticMarkup(createElement(DigestChip, { message }));
    expect(html).toContain(">Used 19 tools<");
    expect(html).toContain(">5 files changed<");
    expect(html).toContain('title="What this turn did"');
  });

  // The server's digest line is model and search context, never UI text.
  it("never shows the internal digest line, closed or open", () => {
    const closed = renderToStaticMarkup(createElement(DigestChip, { message }));
    const open = renderToStaticMarkup(createElement(DigestDetail, { message }));
    for (const html of [closed, open]) {
      expect(html).not.toContain("[digest]");
      expect(html).not.toContain("reply:");
    }
    expect(open).toContain(">Bash<");
  });

  it("does not imply zero changed files when capture was unavailable", () => {
    const html = renderToStaticMarkup(createElement(DigestChip, { message: { ...message, digest: { ...message.digest!, files: undefined, toolCalls: undefined } } }));
    expect(html).toContain(">Used 12+ tools<");
    expect(html).not.toContain("files changed");
  });
});

describe("who paid for a turn is never shown (2026-10-08)", () => {
  it("keeps the payer out of the digest chip", () => {
    const paid: Message = { ...message, digest: { ...message.digest!, access: { via: "subscription", payer: "speaker", payerPrincipalId: "pr_00000000-0000-4000-8000-0000000000b0" } } };
    expect(renderToStaticMarkup(createElement(DigestChip, { message: paid }))).not.toContain("Paid with");
  });
});
