// The spoken register is the half of voice that decides whether it is
// pleasant, and it is the piece most likely to be tuned against real
// transcripts — so its behaviour is pinned here rather than discovered in
// the kitchen at 8am.
import { describe, expect, it } from "vitest";

import { DELTA_HOLD_MAX, narrateTool, speakable, speakableDelta, splitHeldDelta, toUtterances } from "./speech-text.ts";

describe("speakable", () => {
  it("names a code block instead of reading it", () => {
    const out = speakable("Here's the fix:\n\n```ts\nconst x: number = 1;\nif (x) throw new Error('no');\n```\n\nThat's it.");
    expect(out).toContain("TypeScript code block");
    expect(out).not.toContain("const x");
    expect(out).not.toContain("throw");
    expect(out).toContain("That's it.");
  });

  it("closes an unterminated fence rather than swallowing the rest", () => {
    // a streamed reply can be mid-fence when we're asked to speak it
    const out = speakable("Working on it:\n\n```sh\nnpm test");
    expect(out).toContain("Working on it");
    expect(out).toContain("code block");
    expect(out).not.toContain("npm test");
  });

  it("keeps a link's words and drops its URL", () => {
    expect(speakable("See [the README](https://example.com/a/b?c=d) for more")).toBe(
      "See the README for more",
    );
  });

  it("turns a bare URL into a noun", () => {
    expect(speakable("Deployed to https://openmausbot.example.com/status now")).toBe(
      "Deployed to a link now",
    );
  });

  it("turns a www address into a noun too, and drops emoji joiners", () => {
    expect(speakable("Go to www.example.org/x now")).toBe("Go to a link now");
    expect(speakable("Team \u{1F468}\u200D\u{1F469} ready")).toBe("Team ready");
  });

  it("says the file, not the path to it", () => {
    expect(speakable("I changed server/drivers/acp/core.ts today")).toBe("I changed core.ts today");
  });

  it("never reads an identifier and keeps only the last name of an absolute path", () => {
    expect(speakable("Thread `3f2a9c1e-7b4d-4e2a-9f10-0c5b8d7e6a21` (#481516) is in /Users/someone/work/notes.md")).toBe("Thread is in notes.md");
  });

  it("keeps short inline code but not long snippets", () => {
    expect(speakable("Run `pnpm test` first")).toBe("Run pnpm test first");
    const long = speakable(`Use \`${"x".repeat(60)}\` here`);
    expect(long).toBe("Use that snippet here");
  });

  it("strips list scaffolding but keeps the pause between items", () => {
    const out = speakable("- first thing\n- second thing\n- third thing");
    expect(out).toBe("first thing. second thing. third thing");
  });

  it("reads a table as rows, not pipes", () => {
    const out = speakable("| Name | State |\n| --- | --- |\n| Scout | idle |");
    expect(out).not.toContain("|");
    expect(out).not.toContain("---");
    expect(out).toContain("Scout, idle");
  });

  it("drops emphasis markers, emoji and checkboxes", () => {
    expect(speakable("**Done** ✅ — [x] shipped the _thing_")).toBe("Done — shipped the thing");
  });

  it("gives a heading a full stop so the voice breathes", () => {
    expect(speakable("## Results\nAll green")).toBe("Results. All green");
  });

  it("collapses the punctuation its own substitutions create", () => {
    expect(speakable("Done.\n\n\n- one\n\n- two")).toBe("Done. one. two");
  });

  it("is empty for empty input", () => {
    expect(speakable("")).toBe("");
    expect(speakable("   \n\n  ")).toBe("");
  });
});

describe("speakableDelta", () => {
  it("keeps the space before and after appended words", () => {
    expect(speakableDelta(" pense")).toBe(" pense");
    expect(speakableDelta("ment ")).toBe("ment ");
    expect(speakableDelta(" **vraiment**,")).toBe(" vraiment,");
  });

  it("drops markdown, emoji and links, keeps a lone punctuation mark", () => {
    expect(speakableDelta(" 👍")).toBe("");
    expect(speakableDelta(".")).toBe(".");
    expect(speakableDelta(" ?")).toBe(" ?");
    expect(speakableDelta(" voir https://example.com/x")).toBe(" voir a link");
    expect(speakableDelta("   ")).toBe("");
  });
});

describe("toUtterances", () => {
  it("splits on sentences", () => {
    const out = toUtterances("The tests pass now. I changed two files. Want me to push it?");
    expect(out).toHaveLength(3);
    expect(out[0]).toBe("The tests pass now.");
    expect(out[2]).toBe("Want me to push it?");
  });

  it("does not split inside a decimal or an abbreviation", () => {
    const out = toUtterances("It dropped to 11.7 seconds per step, i.e. about half of what it was before.");
    expect(out).toHaveLength(1);
  });

  it("glues a fragment onto its neighbour", () => {
    // two words handed to a synthesizer produce two words of flat prosody
    const out = toUtterances("Yes. The whole suite is green and nothing else changed.");
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("Yes.");
  });

  it("breaks a runaway sentence at a clause, never mid-word", () => {
    const long = `I looked at ${Array.from({ length: 40 }, (_, i) => `item ${i}`).join(", ")} and finished.`;
    const out = toUtterances(long, { maxChars: 120 });
    expect(out.length).toBeGreaterThan(1);
    for (const piece of out) expect(piece.length).toBeLessThanOrEqual(140);
    // nothing lost, nothing cut in half
    expect(out.join(" ")).toContain("item 39");
  });

  it("runs its input through the spoken register first", () => {
    const out = toUtterances("Fixed it.\n\n```js\nconsole.log(1)\n```\n\nShipped.");
    expect(out.join(" ")).not.toContain("console.log");
  });

  it("is empty for text that speaks to nothing", () => {
    expect(toUtterances("```\ncode only\n```")).not.toContain("code only");
    expect(toUtterances("")).toEqual([]);
  });

  it("reads a long answer in pieces the speak route accepts, and keeps the end", () => {
    const long = "a".repeat(2000);
    const out = toUtterances(long);
    expect(out.length).toBeGreaterThan(1);
    for (const piece of out) expect(piece.length).toBeLessThanOrEqual(500);
    expect(out.join("")).toBe(long);
  });

  it.each(["漢".repeat(325), "日本語の文章を読み上げます。".repeat(40)])("bounds unspaced speech without dropping text", (text) => {
    const out = toUtterances(text, { maxChars: 320 });
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((piece) => piece.length > 0 && piece.length <= 320)).toBe(true);
    expect(out.join("")).toBe(speakable(text));
  });

  it("keeps a supplementary-plane letter whole at an odd boundary", () => {
    const text = "𠮷".repeat(95);
    const out = toUtterances(text, { maxChars: 91 });
    expect(out.length).toBeGreaterThan(1);
    expect(out[0]!.length).toBeLessThanOrEqual(91);
    expect(out.every((piece) => Buffer.from(piece).toString("utf8") === piece)).toBe(true);
    expect(out.join("")).toBe(text);
  });

  it("caps a decomposed Katakana word without splitting its graphemes", () => {
    const text = "カ\u3099".repeat(321);
    const out = toUtterances(text, { maxChars: 320 });
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((piece) => piece.length > 0 && piece.length <= 320 && /^(?:カ\u3099)+$/u.test(piece))).toBe(true);
    expect(out.join("")).toBe(speakable(text));
  });
});

describe("narrateTool", () => {
  it("turns tool names into something worth hearing", () => {
    expect(narrateTool("Bash")).toBe("running a command");
    expect(narrateTool("Read")).toBe("reading a file");
    expect(narrateTool("Edit")).toBe("editing a file");
    expect(narrateTool("WebSearch")).toBe("searching the web");
    expect(narrateTool("screenshot")).toBe("looking at the screen");
  });

  it("sees through an MCP tool prefix", () => {
    expect(narrateTool("mcp__computer__click")).toBe("using the computer");
    expect(narrateTool("mcp__agents__ask_bot")).toBe("asking a teammate");
  });

  it("stays quiet for chips the user is already told about another way", () => {
    expect(narrateTool("auto-approved Bash:git (always allowed)")).toBeNull();
    expect(narrateTool("error: claude exited 1")).toBeNull();
    expect(narrateTool("")).toBeNull();
  });

  it("falls back to naming an unknown tool, without reading its argv", () => {
    expect(narrateTool("deploy_thing")).toBe("running deploy_thing");
    expect(narrateTool('curl -X POST "https://x/y" --data @{}')).toBeNull();
  });
});

describe("splitHeldDelta", () => {
  it("holds the last unfinished word, and an id label with it", () => {
    expect(splitHeldDelta(" le commit 3f9a")).toEqual({ ready: " le commit", held: " 3f9a" });
    expect(splitHeldDelta("3f9a")).toEqual({ ready: "", held: "3f9a" });
    expect(splitHeldDelta(" voilà ")).toEqual({ ready: " voilà ", held: "" });
    expect(splitHeldDelta(" ticket id: ")).toEqual({ ready: " ticket", held: " id: " });
    expect(splitHeldDelta(" ticket ID =")).toEqual({ ready: " ticket", held: " ID =" });
    expect(splitHeldDelta(" trois")).toEqual({ ready: "", held: " trois" });
  });

  it("a sentence end makes the last word whole; a very long run is cleaned as it is", () => {
    expect(splitHeldDelta(" c'est réglé.")).toEqual({ ready: " c'est réglé.", held: "" });
    expect(splitHeldDelta(" vraiment?»")).toEqual({ ready: " vraiment?»", held: "" });
    const run = "a1".repeat(DELTA_HOLD_MAX);
    expect(splitHeldDelta(run)).toEqual({ ready: run, held: "" });
    expect(splitHeldDelta("")).toEqual({ ready: "", held: "" });
  });

  it("a split identifier, joined again, is removed by the delta cleaner", () => {
    const first = splitHeldDelta(" le hash 3f9a2c7");
    const second = splitHeldDelta(`${first.held}e1b04d9 est là `);
    expect(speakableDelta(first.ready) + speakableDelta(second.ready)).not.toMatch(/3f9a|e1b0/);
  });
});
