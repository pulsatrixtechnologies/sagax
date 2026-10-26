import { describe, expect, it } from "vitest";

import { DESKTOP_BRIDGE_ACTIONS } from "../server/desktop-bridge.ts";
import {
  handleFromChatGuid,
  messagesOnBotMac,
  planImessageSend,
} from "./imessage.ts";

describe("Messages stays on the bot Mac", () => {
  it("allows only a solo Mac and refuses a bridge or an organization server", () => {
    expect(messagesOnBotMac({ platform: "darwin", identityKind: "solo" })).toEqual({ ok: true });
    expect(messagesOnBotMac({ platform: "darwin", identityKind: "perspicax" })).toEqual({ ok: false, reason: "organization_server" });
    expect(messagesOnBotMac({ platform: "linux", identityKind: "solo" })).toEqual({ ok: false, reason: "not_darwin" });
    expect(messagesOnBotMac({ platform: "darwin", identityKind: "solo", bridgeAction: true })).toEqual({ ok: false, reason: "bridge_refused" });
  });

  it("is not a desktop-bridge action", () => {
    expect(DESKTOP_BRIDGE_ACTIONS.some((action) => /message|imessage/i.test(action))).toBe(false);
  });

  it("sends to a listed person and cards everyone else", () => {
    expect(planImessageSend({ to: "+15145551234", listed: true })).toEqual({ action: "send", to: "+15145551234", service: "auto" });
    expect(planImessageSend({ to: "ada@example.com", service: "SMS", listed: false })).toEqual({ action: "card", to: "ada@example.com", service: "SMS" });
    expect(planImessageSend({ chatId: "iMessage;-;+15145551234", listed: true })).toEqual({ action: "send", to: "+15145551234", service: "iMessage" });
    expect(planImessageSend({ chatId: "any;-;chat123,chat456", listed: true })).toEqual({ action: "refuse", reason: "group" });
    expect(planImessageSend({ listed: true })).toEqual({ action: "refuse", reason: "invalid" });
  });

  it("reads a 1:1 chat guid and refuses a group", () => {
    expect(handleFromChatGuid("SMS;+;ada@example.com")).toEqual({ service: "SMS", handle: "ada@example.com" });
    expect(handleFromChatGuid("iMessage;+;group-guid")).toEqual({ service: "iMessage", handle: "group-guid" });
    expect(handleFromChatGuid("iMessage;-;+1, +2")).toBeNull();
  });
});
