import { describe, expect, it, vi } from "vitest";
import { handleDesktopBridgeMcp } from "./desktop-bridge-tools.ts";
import { handleUserSandboxMcp } from "./user-sandbox-tools.ts";
import { TOOL_RESULT_READ, TOOL_TEXT_BUDGET, boundToolResult, boundToolText } from "./tool-output-bound.ts";

const scan = (lines: number) => Array.from({ length: lines }, (_, i) => `${i + 1}/tcp open service-${i + 1}`).join("\n");

describe("boundToolText", () => {
  it("leaves an answer that fits untouched", () => {
    expect(boundToolText("22/tcp open ssh")).toEqual({ text: "22/tcp open ssh", cut: false });
  });

  it("keeps the start and the end of a huge output, and says what it left out and how to ask", () => {
    const output = `${scan(40_000)}\nERROR: last line`;
    const { text, cut, pointer } = boundToolText(output);
    expect(cut).toBe(true);
    expect(text.length).toBeLessThanOrEqual(TOOL_TEXT_BUDGET + 400);
    expect(text.startsWith("1/tcp open service-1\n")).toBe(true);
    expect(text.endsWith("ERROR: last line")).toBe(true);
    expect(text).toMatch(/\[… [\d,]+ more lines \([\d,]+ characters\) not shown; characters [\d,]+-[\d,]+ of [\d,]+ omitted\. Ask for the rest in smaller pieces/);
    expect(pointer).toMatchObject({
      omittedStart: expect.any(Number),
      omittedEnd: expect.any(Number),
      total: output.length,
    });
    expect(pointer!.omittedStart).toBeGreaterThan(0);
    expect(pointer!.omittedEnd).toBeGreaterThan(pointer!.omittedStart);
    expect(pointer!.omittedEnd).toBeLessThan(output.length);
    expect(pointer!.id).toBeUndefined();
    // cut at line boundaries: no half line around the marker
    const [before, after] = text.split(/\n\[… .*\]\n/);
    expect(before!.split("\n").every((line) => /^\d+\/tcp open service-\d+$/.test(line))).toBe(true);
    expect(after!.split("\n").slice(0, -1).every((line) => /^\d+\/tcp open service-\d+$/.test(line))).toBe(true);
  });

  it("holds the full text and names tool_result_read with id and offset (TST-02)", () => {
    const output = scan(40_000);
    const hold = vi.fn(() => ({ id: "r-37a58e8d-4411-4a9c-bc1a-00c4278201db" }));
    const { text, cut, pointer } = boundToolText(output, { hold });
    expect(cut).toBe(true);
    expect(hold).toHaveBeenCalledExactlyOnceWith(output);
    expect(pointer?.id).toBe("r-37a58e8d-4411-4a9c-bc1a-00c4278201db");
    expect(text).toContain(`${TOOL_RESULT_READ} id "r-37a58e8d-4411-4a9c-bc1a-00c4278201db" and offset ${pointer!.omittedStart}`);
    expect(text).toMatch(/characters [\d,]+-[\d,]+ of [\d,]+ omitted/);
  });

  it("still cuts when hold fails, without advertising an id", () => {
    const { text, pointer } = boundToolText(scan(40_000), { hold: () => { throw new Error("offline"); } });
    expect(pointer?.id).toBeUndefined();
    expect(text).not.toContain(TOOL_RESULT_READ);
    expect(text).toMatch(/characters [\d,]+-[\d,]+ of [\d,]+ omitted/);
  });
});

describe("boundToolResult", () => {
  it("shares one budget across text items and never touches an image", () => {
    const image = { type: "image", data: "A".repeat(200_000), mimeType: "image/png" };
    const result = boundToolResult({ content: [{ type: "text", text: scan(20_000) }, image] });
    expect(result.content[1]).toBe(image);
    expect((result.content[0] as { text: string }).text.length).toBeLessThanOrEqual(TOOL_TEXT_BUDGET + 400);
  });

  it("returns anything that is not a tool result as it was", () => {
    expect(boundToolResult("plain")).toBe("plain");
    expect(boundToolResult(null)).toBe(null);
  });

  it("holds only the first cut text item once", () => {
    const hold = vi.fn(() => ({ id: "r-once" }));
    const result = boundToolResult({
      content: [
        { type: "text", text: scan(20_000) },
        { type: "text", text: scan(20_000) },
      ],
    }, { hold });
    expect(hold).toHaveBeenCalledTimes(1);
    const texts = result.content.map((item) => (item as { text?: string }).text ?? "");
    expect(texts.filter((text) => text.includes('id "r-once"'))).toHaveLength(1);
  });
});

describe("machine tools Sagax serves", () => {
  it("cuts a command's huge output on the person's computer", async () => {
    const result = await handleDesktopBridgeMcp("tools/call", { name: "run_command", arguments: { command: "nmap -p- host" } },
      async () => ({ content: [{ type: "text", text: `${scan(60_000)}\n[exit 0]` }] })) as { content: Array<{ text: string }> };
    expect(result.content[0]!.text.length).toBeLessThanOrEqual(TOOL_TEXT_BUDGET + 400);
    expect(result.content[0]!.text).toMatch(/more lines .* not shown; characters /);
    expect(result.content[0]!.text.endsWith("[exit 0]")).toBe(true);
  });

  it("cuts a big text file with a hint to read on, and leaves a base64 file whole", async () => {
    const big = "x".repeat(250_000);
    const text = await handleDesktopBridgeMcp("tools/call", { name: "read_file", arguments: { path: "~/big.log" } },
      async () => ({ content: [{ type: "text", text: big }] })) as { content: Array<{ text: string }> };
    expect(text.content[0]!.text.length).toBeLessThanOrEqual(TOOL_TEXT_BUDGET + 400);
    expect(text.content[0]!.text).toContain("with offset");
    expect(text.content[0]!.text).toMatch(/characters [\d,]+-[\d,]+ of [\d,]+ omitted/);
    const binary = await handleDesktopBridgeMcp("tools/call", { name: "read_file", arguments: { path: "~/key.bin", encoding: "base64" } },
      async () => ({ content: [{ type: "text", text: big }] })) as { content: Array<{ text: string }> };
    expect(binary.content[0]!.text).toBe(big);
  });

  it("cuts a command's huge output in the server environment", async () => {
    const exec = {
      exec: async () => ({ stdout: scan(60_000), stderr: "", exitCode: 0, truncated: false, timedOut: false }),
      overQuota: async () => false,
    };
    const result = await handleUserSandboxMcp("tools/call", { name: "run_command", arguments: { command: "grep -r key /" } }, exec as never) as { content: Array<{ text: string }> };
    expect(result.content[0]!.text.length).toBeLessThanOrEqual(TOOL_TEXT_BUDGET + 400);
    expect(result.content[0]!.text).toMatch(/more lines .* not shown; characters /);
    expect(result.content[0]!.text).toContain("[exit 0]");
  });

  it("holds a desktop cut when the caller passes a hold", async () => {
    const hold = vi.fn(() => ({ id: "r-desk" }));
    const result = await handleDesktopBridgeMcp("tools/call", { name: "run_command", arguments: { command: "nmap -p- host" } },
      async () => ({ content: [{ type: "text", text: `${scan(60_000)}\n[exit 0]` }] }),
      { hold }) as { content: Array<{ text: string }> };
    expect(hold).toHaveBeenCalled();
    expect(result.content[0]!.text).toContain(`${TOOL_RESULT_READ} id "r-desk"`);
  });
});
