import { describe, expect, it } from "vitest";

import { keyEvent, pointFraction, teachViewerParams, withTeachBot } from "./computer-teach-client";

describe("teaching on the whole computer, in the desktop viewer (parity R7, system 11)", () => {
  it("places a click as fractions of the remote screen, and ignores one beside it", () => {
    const rect = { left: 100, top: 50, width: 800, height: 400 };
    expect(pointFraction(300, 250, rect)).toEqual({ x: 0.25, y: 0.5 });
    expect(pointFraction(99, 250, rect)).toBeNull();
    expect(pointFraction(300, 250, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });

  it("keeps Enter, Tab and Escape, says typing for a character, never which one", () => {
    expect(keyEvent({ key: "Enter", ctrlKey: false, metaKey: false, altKey: false })).toEqual({ kind: "key", key: "Enter" });
    expect(keyEvent({ key: "p", ctrlKey: false, metaKey: false, altKey: false })).toEqual({ kind: "typing" });
    expect(keyEvent({ key: "Backspace", ctrlKey: false, metaKey: false, altKey: false })).toEqual({ kind: "typing" });
    expect(keyEvent({ key: "c", ctrlKey: true, metaKey: false, altKey: false })).toBeNull();
    expect(keyEvent({ key: "Shift", ctrlKey: false, metaKey: false, altKey: false })).toBeNull();
    expect(JSON.stringify(keyEvent({ key: "p", ctrlKey: false, metaKey: false, altKey: false }))).not.toContain("p\"");
  });

  it("adds the bot to the app's own viewer address only", () => {
    const local = withTeachBot("http://127.0.0.1:8810/desktop-viewer#target=local%2Fshared", { id: "b1", name: "Scout" }, "http://127.0.0.1:8810");
    expect(teachViewerParams(new URL(local).hash)).toEqual({ botId: "b1", botName: "Scout" });
    expect(new URLSearchParams(new URL(local).hash.slice(1)).get("target")).toBe("local/shared");
    expect(withTeachBot("https://boat.example/vnc.html#x=1", { id: "b1", name: "Scout" }, "http://127.0.0.1:8810")).toBe("https://boat.example/vnc.html#x=1");
    expect(teachViewerParams("#target=sandbox%2Fme")).toBeNull();
    expect(teachViewerParams("#bot=../x&botName=Scout")).toBeNull();
  });
});
