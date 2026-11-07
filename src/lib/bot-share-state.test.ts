import { describe, expect, it } from "vitest";
import { botShareState } from "./bot-share-state";

const bot = { id: "b1", ownerUserId: "me" };
const room = (humanIds: string[], name = "Ops") => ({ name, memberIds: ["b1"], humanIds });

describe("botShareState", () => {
  it("is shared when the owner granted access, even inside a group", () => {
    expect(botShareState({ ...bot, grants: [{}] }, [room(["user:alex"])], "me")).toEqual({ kind: "shared" });
    expect(botShareState({ ...bot, directGrants: ["alex"] }, [], "me")).toEqual({ kind: "shared" });
  });

  it("is partially shared in a group with another person, naming each group", () => {
    expect(botShareState(bot, [room(["user:ME", "user:alex"]), room(["team:ops"], "Desk")], "me"))
      .toEqual({ kind: "partial", count: 2, names: ["Ops", "Desk"] });
  });

  it("stays private in a group of only the owner, or one without the bot", () => {
    expect(botShareState(bot, [room(["user:me"]), { name: "Other", memberIds: ["b2"], humanIds: ["user:alex"] }, { name: "Bots", memberIds: ["b1"] }], "me")).toBeNull();
  });

  it("leaves a bot someone else owns to the sharer badge", () => {
    expect(botShareState({ id: "b1", ownerUserId: "alex", grants: [{}] }, [room(["user:me"])], "me")).toBeNull();
  });

  it("treats a local bot as the viewer's own", () => {
    expect(botShareState({ id: "b1", ownerUserId: "local-owner" }, [room(["sam@example.com"])], "local-owner"))
      .toEqual({ kind: "partial", count: 1, names: ["Ops"] });
  });
});
