import { describe, expect, it } from "vitest";

import { captureErrorKey, captureFile, captureTarget } from "./screen-capture-to-bot";

const bot = (id: string, extra: Record<string, unknown> = {}) => ({ id, threadId: `${id}-t`, hidden: false, modelSelection: { instanceId: "claude" }, ...extra });
const instances = [{ instanceId: "claude", capabilities: { images: true } }, { instanceId: "text-only", capabilities: { images: false } }];

describe("screen capture to a bot (parity R7, system 12)", () => {
  it("goes to the open bot's own conversation draft", () => {
    const target = captureTarget({ selectedId: "b2", bots: [bot("b1"), bot("b2")], instances });
    expect(target).toEqual({ botId: "b2", draftId: "bot:b2:b2-t", open: false, images: true });
  });

  it("opens the first visible bot when no bot is open (a room or nothing)", () => {
    const target = captureTarget({ selectedId: "room-1", bots: [bot("b1", { hidden: true }), bot("b2")], instances });
    expect(target).toMatchObject({ botId: "b2", open: true });
    expect(captureTarget({ selectedId: "", bots: [], instances })).toBeNull();
  });

  it("says when the bot's engine cannot open a picture", () => {
    const target = captureTarget({ selectedId: "b1", bots: [bot("b1", { modelSelection: { instanceId: "text-only" } })], instances });
    expect(target?.images).toBe(false);
  });

  it("names the picture by the time it was taken, as a PNG", () => {
    const file = captureFile(btoa("png-bytes"), new Date(Date.UTC(2026, 9, 21, 22, 5, 9)));
    expect(file.type).toBe("image/png");
    expect(file.name).toMatch(/^Screenshot \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.png$/);
    expect(file.size).toBe("png-bytes".length);
  });

  it("names the person's own settings when the screen could not be captured", () => {
    expect(captureErrorKey({ error: "permission", platform: "darwin" })).toBe("screenCapture.permissionMac");
    expect(captureErrorKey({ error: "unavailable", platform: "darwin" })).toBe("screenCapture.unavailableMac");
    expect(captureErrorKey({ error: "unavailable", platform: "win32" })).toBe("screenCapture.unavailableWindows");
    expect(captureErrorKey({ error: "unavailable", platform: "other" })).toBe("screenCapture.unavailable");
  });
});
