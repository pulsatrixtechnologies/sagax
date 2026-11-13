import { describe, expect, it, vi } from "vitest";
import { acpToolEndEvents } from "../drivers/acp/tool-items.ts";
import { handleItemEvents } from "./items.ts";

// #4205: pictures a tool returned to the model are reading material.
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function host() {
  return {
    decodeGeneratedImage: vi.fn(() => { throw new Error("stop before the disk"); }),
    turnAttachmentKey: (threadId: string, turnId: string) => `${threadId}:${turnId}`,
    turnAttachmentsByTurn: new Map(),
  };
}
const ctx = () => ({ pushMessage: vi.fn(), staleAssistant: false });
const imageEvent = (extra: Record<string, unknown>) => ({ type: "item.completed", itemType: "assistant_image", threadId: "t", turnId: "u", data: png, ...extra });

describe("tool images are not attached to the reply (#4205)", () => {
  it("marks an image block in a tool result as the tool's", () => {
    const events = acpToolEndEvents({ status: "completed", content: [{ type: "text", text: "ticket" }, { type: "image", data: png, mimeType: "image/png" }] }, "tc-1", new Set());
    expect(events.find((event) => event.itemType === "assistant_image")).toMatchObject({ fromTool: true });
  });

  it("does not attach a tool's picture to the turn's final message", () => {
    const h = host();
    const c = ctx();
    handleItemEvents(imageEvent({ fromTool: true }), c, h);
    expect(h.decodeGeneratedImage).not.toHaveBeenCalled();
    expect(h.turnAttachmentsByTurn.size).toBe(0);
    expect(c.pushMessage).not.toHaveBeenCalled();
  });

  it("still attaches a picture the model produced", () => {
    const h = host();
    handleItemEvents(imageEvent({}), ctx(), h);
    expect(h.decodeGeneratedImage).toHaveBeenCalledWith(png);
  });
});
