import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  batchCommands,
  clipboardWriteCommands,
  computerInputBodySchema,
  decodeClipboard,
  inputCommands,
  inputSummary,
  keysymFor,
} from "./computer-input.ts";

describe("computer input events", () => {
  it("accepts each event kind and refuses the rest", () => {
    const ok = computerInputBodySchema.safeParse({ events: [
      { type: "move", dx: 4, dy: -2 }, { type: "moveTo", x: 0.5, y: 1 },
      { type: "button", button: "right", action: "click", count: 2 }, { type: "scroll", dx: 0, dy: -3 },
      { type: "key", key: "Enter", modifiers: ["ctrl"] }, { type: "text", text: "héllo" },
    ] });
    expect(ok.success).toBe(true);
    for (const event of [
      { type: "moveTo", x: 1.5, y: 0 }, { type: "move", dx: 0.5, dy: 0 }, { type: "button", button: "back", action: "click" },
      { type: "key", key: "a", modifiers: ["hyper"] }, { type: "text", text: "" }, { type: "exec", command: "id" },
      { type: "move", dx: 1, dy: 1, extra: true },
    ]) expect(computerInputBodySchema.safeParse({ events: [event] }).success, JSON.stringify(event)).toBe(false);
    expect(computerInputBodySchema.safeParse({ events: [] }).success).toBe(false);
    expect(computerInputBodySchema.safeParse({ events: Array(65).fill({ type: "move", dx: 1, dy: 1 }) }).success).toBe(false);
  });

  it("maps web key names and characters to X keysyms, and refuses anything else", () => {
    expect(keysymFor("Enter")).toBe("Return");
    expect(keysymFor("ArrowLeft")).toBe("Left");
    expect(keysymFor("PageDown")).toBe("Next");
    expect(keysymFor("q")).toBe("q");
    expect(keysymFor("?")).toBe("question");
    expect(keysymFor("f5")).toBe("F5");
    expect(keysymFor("BackSpace")).toBe("BackSpace");
    expect(keysymFor("a;rm -rf /")).toBeNull();
    expect(keysymFor("é")).toBeNull();
  });

  it("builds xdotool lines with nothing from the caller unquoted", () => {
    const built = inputCommands([
      { type: "move", dx: 3, dy: -4 },
      { type: "moveTo", x: 1, y: 0.25 },
      { type: "button", button: "left", action: "down" },
      { type: "scroll", dx: 2, dy: -1 },
      { type: "key", key: "c", modifiers: ["ctrl", "ctrl", "meta"] },
      { type: "text", text: "'; rm -rf / #" },
    ]);
    expect(built.ok).toBe(true);
    const commands = built.ok ? built.commands : [];
    expect(commands).toEqual([
      "xdotool mousemove_relative -- 3 -4",
      'eval "$(xdotool getdisplaygeometry --shell)" && xdotool mousemove $((WIDTH*99999/100000)) $((HEIGHT*25000/100000))',
      "xdotool mousedown 1",
      "xdotool click --repeat 1 --delay 30 4",
      "xdotool click --repeat 2 --delay 30 7",
      "xdotool key --clearmodifiers ctrl+super+c",
      `xdotool type --clearmodifiers --delay 8 -- "$(printf %s '${Buffer.from("'; rm -rf / #").toString("base64")}' | base64 -d)"`,
    ]);
    expect(commands.join("\n")).not.toContain("rm -rf");
    expect(inputCommands([{ type: "key", key: "a b" }])).toEqual({ ok: false, error: "events[0].key is not a key Sagax can send" });
  });

  it("decodes typed text exactly as sent, through a real shell", () => {
    if (process.platform === "win32") return;
    const text = "naïve 'quotes' \"double\" $HOME `x` \\ end";
    const built = inputCommands([{ type: "text", text }]);
    const line = built.ok ? built.commands[0]! : "";
    const decoded = line.replace(/^xdotool type --clearmodifiers --delay 8 -- /, "printf %s ");
    expect(execFileSync("sh", ["-c", decoded], { encoding: "utf8" })).toBe(text);
  });

  it("batches scripts under the backend's limit", () => {
    expect(batchCommands(["a", "b", "c"], 6)).toEqual(["a && b", "c"]);
    expect(batchCommands([], 10)).toEqual([]);
  });

  it("round-trips the clipboard through base64 chunks", () => {
    if (process.platform === "win32") return;
    const text = "clip: ünïcode ✓ ".repeat(300);
    const commands = clipboardWriteCommands(text, 1_000);
    expect(commands.length).toBeGreaterThan(3);
    expect(commands.at(-1)).toContain("xclip -selection clipboard -i");
    const encoded = commands.slice(1, -1).map((command) => /printf %s '([^']*)'/.exec(command)![1]).join("");
    expect(decodeClipboard(encoded)).toBe(text);
    expect(decodeClipboard("")).toBe("");
    expect(() => decodeClipboard("not base64!")).toThrow();
  });

  it("audits counts, never text", () => {
    expect(inputSummary([{ type: "text", text: "secret" }, { type: "move", dx: 1, dy: 1 }, { type: "move", dx: 1, dy: 1 }])).toEqual({ text: 1, move: 2 });
  });
  it("never waits on --sync for pointer moves (a move to where the pointer is, or past an edge, would hang the batch)", () => {
    const built = inputCommands([
      { type: "move", dx: -10_000, dy: 0 },
      { type: "moveTo", x: 0.5, y: 0.5 },
      { type: "moveTo", x: 0.5, y: 0.5 },
    ]);
    expect(built.ok).toBe(true);
    const commands = built.ok ? built.commands : [];
    expect(commands).toHaveLength(3);
    for (const command of commands) expect(command).not.toContain("--sync");
  });
});
