import { describe, expect, it } from "vitest";
import { clipAtWord, markdownToPlainText, plainPreviewLine } from "./plain-text.ts";

// The push a bot sent on 2026-11-08: a table under two sentences.
const CAPTURE_MARKDOWN = [
  "Cinq messages de Nova, tous dépassés. Rien à trancher.",
  "",
  "| Champ | Valeur |",
  "| --- | --- |",
  "| Source | Nova, 5 messages, tours expirés |",
].join("\n");
// What the phone showed: the same body after the old summarize flattened it.
const CAPTURE_FLATTENED = "Cinq messages de Nova, tous dépassés. Rien à trancher. | Champ | Valeur | | --- | --- | | Source | Nova, 5 messages, tours expirés...";

describe("markdownToPlainText", () => {
  it("reads the reported table as key : value, header gone", () => {
    expect(markdownToPlainText(CAPTURE_MARKDOWN)).toBe("Cinq messages de Nova, tous dépassés. Rien à trancher. Source : Nova, 5 messages, tours expirés");
  });

  it("reads the same table already flattened onto one line (older server, clipped body)", () => {
    expect(markdownToPlainText(CAPTURE_FLATTENED)).toBe("Cinq messages de Nova, tous dépassés. Rien à trancher. Source : Nova, 5 messages, tours expirés...");
  });

  it.each([
    ["**Gras** et __aussi__ et *italique*", "Gras et aussi et italique"],
    ["Voir [le billet](https://example.com/t/1) maintenant", "Voir le billet maintenant"],
    ["## Résumé\nTout est vert.", "Résumé Tout est vert."],
    ["- un\n- deux\n1. trois\n- [x] fait", "un deux trois fait"],
    ["> cité", "cité"],
    ["| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | | 6 |", "1 : 2, 3; 4 : 6"],
    ["avant | x | y | | --- | --- | | k1 | v1 | | k2 | v2 | après", "avant k1 : v1; k2 : v2 après"],
    ["Lance `pnpm test` puis lis.", "Lance pnpm test puis lis."],
    ["snake_case et 2 * 3 restent", "snake_case et 2 * 3 restent"],
  ])("reads %j as %j", (input, expected) => {
    expect(markdownToPlainText(input)).toBe(expected);
  });

  it("keeps a code block's code by default and drops it for a banner", () => {
    const text = "Correctif :\n```ts\nconst a = 1;\n```\nC'est fait.";
    expect(markdownToPlainText(text)).toBe("Correctif : const a = 1; C'est fait.");
    expect(markdownToPlainText(text, { dropCode: true })).toBe("Correctif : C'est fait.");
  });

  it("drops a rich fence the caller names", () => {
    expect(markdownToPlainText("Voici.\n```widget\n<div>x</div>\n```", { isRichFence: (info) => info.trim() === "widget" })).toBe("Voici.");
  });
});

describe("clipAtWord", () => {
  it("never cuts a word in half when a boundary is near", () => {
    expect(clipAtWord("Cinq messages de Nova, tous dépassés", 20)).toBe("Cinq messages de…");
  });
  it("keeps a short line whole", () => {
    expect(clipAtWord("  court  ", 20)).toBe("court");
  });
  it("cuts a single long word when there is no boundary", () => {
    expect(clipAtWord("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefghi…");
  });
});

describe("plainPreviewLine", () => {
  it("strips, flattens and clips the reported body for a banner", () => {
    const line = plainPreviewLine(CAPTURE_MARKDOWN, 140);
    expect(line).not.toMatch(/\||---|\*\*/);
    expect(line).toContain("Source : Nova");
  });
});

describe("a table flattened on a line of its own", () => {
  it("reads its body rows, never its header and separator as cells", () => {
    expect(markdownToPlainText("| a | b | | --- | --- | | x | y |")).toBe("x : y");
    expect(markdownToPlainText("**Publier ?**\n| a | b | | --- | --- | | x | y |")).toBe("Publier ? x : y");
  });
});
