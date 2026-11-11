// #3577: a usage-limit line of a kind this app does not know (a newer server)
// reads as the row's plain words in both sidebar previews, and never hands a
// missing text to a helper that expects a string.
import { afterEach, describe, expect, it } from "vitest";

import { groupPreview } from "@/components/Sidebar";
import { setLocale } from "@/lib/i18n";
import type { Bot, Group, Message } from "@/state/store";
import type { LimitFailoverLine } from "../../../shared/limit-failover";
import { preview } from "./preview";

const line = { kind: "someLaterKind", engine: "Claude" } as unknown as LimitFailoverLine;
const row: Message = { id: "m2", at: 2, role: "bot", kind: "activity", from: { botId: "b", name: "Ada" },
  tool: { name: "error: Claude cannot answer right now.", ok: false, limitFailover: line } } as Message;
const messages: Message[] = [{ id: "m1", at: 1, role: "user", kind: "text", text: "hello" } as Message, row];

describe("a limit line of an unknown kind in the sidebar (#3577)", () => {
  afterEach(() => { setLocale("en"); });

  it("a bot's row reads its plain words", () => {
    setLocale("fr");
    const bot = { id: "b", name: "Ada", messages, modelSelection: { instanceId: "claude" } } as unknown as Bot;
    expect(preview(bot, messages, [])).toBe("Claude cannot answer right now.");
  });

  it("a group's row reads its plain words without a throw", () => {
    setLocale("fr");
    const group = { id: "g", threadId: "g", name: "Team", memberIds: ["b"], defaultResponder: { kind: "mentions" }, bulletin: "",
      unread: false, createdAt: 1, messages } as unknown as Group;
    expect(() => groupPreview(group, [], null, [])).not.toThrow();
    expect(groupPreview(group, [], null, [])).toContain("Claude cannot answer right now.");
  });
});
