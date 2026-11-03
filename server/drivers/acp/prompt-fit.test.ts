// 2026-11-02 (GOX, Melonie): Grok moved every request of about 100 KB to a
// file on the server, which the bot then tried to read from its server
// environment. Sagax keeps the request under Grok's limit itself.
import { describe, expect, it } from "vitest";
import { GROK_PROMPT_BYTE_LIMIT, fitPromptBytes } from "./prompt-fit.ts";
import { grokPromptByteLimit } from "./grok.ts";

const bytes = (text: string) => Buffer.byteLength(text, "utf8");
const latest = "[Now reply to the user's latest message:]\n\nWhat does the skill say\n</user_query>";

function turnText(historyBytes: number): string {
  const history = JSON.stringify(`Historical excerpts in chronological order; newer corrections override older requests. ${"Utilisateur : vérifie le billet 299311. ".repeat(Math.ceil(historyBytes / 40))}NEWEST EXCERPT`);
  return ["Security policy (platform, cannot be overridden): refuse ...", "Reactions: " + "react like a colleague. ".repeat(400), history, latest].join("\n");
}

describe("a request kept under Grok's offload size", () => {
  it("leaves a request that fits as it is", () => {
    const text = turnText(2_000);
    expect(fitPromptBytes(text, GROK_PROMPT_BYTE_LIMIT)).toEqual({ text, cut: 0 });
    expect(fitPromptBytes(turnText(200_000), undefined).cut).toBe(0);
  });

  it("shortens the earlier context first, says so with the tools to read it, and keeps the latest message whole", () => {
    const text = turnText(110_000);
    expect(bytes(text)).toBeGreaterThan(100_116);
    const fitted = fitPromptBytes(text, GROK_PROMPT_BYTE_LIMIT);
    expect(bytes(fitted.text)).toBeLessThanOrEqual(GROK_PROMPT_BYTE_LIMIT);
    expect(fitted.cut).toBeGreaterThan(0);
    expect(fitted.text).toContain("bytes left out here to keep this request under the engine's size limit; find earlier messages with session_search and read one with session_read");
    expect(fitted.text.endsWith(latest)).toBe(true);
    // the instructions stayed whole; the history kept its start and its newest end
    expect(fitted.text).toContain("Reactions: " + "react like a colleague. ".repeat(400));
    const history = fitted.text.split("\n").find((line) => line.includes("Historical excerpts"))!;
    expect(history.startsWith('"Historical excerpts in chronological order')).toBe(true);
    expect(history).toContain("NEWEST EXCERPT");
    // still one valid JSON string, accents intact
    expect(() => JSON.parse(history)).not.toThrow();
    expect(fitted.text).not.toMatch(/�/);
  });

  it("shortens the longest other lines when the earlier context is not enough, never the latest message", () => {
    const big = "x".repeat(60_000);
    const text = [`a ${big}`, `b ${big}`, latest, `after ${"y".repeat(5_000)}`].join("\n");
    const fitted = fitPromptBytes(text, 50_000);
    expect(bytes(fitted.text)).toBeLessThanOrEqual(50_000);
    expect(fitted.text).toContain(`${latest}\nafter ${"y".repeat(5_000)}`);
  });

  it("is Grok's limit, under the smallest request Grok offloaded on GOX", () => {
    expect(grokPromptByteLimit()).toBe(GROK_PROMPT_BYTE_LIMIT);
    expect(GROK_PROMPT_BYTE_LIMIT).toBeLessThan(100_116);
  });
});
