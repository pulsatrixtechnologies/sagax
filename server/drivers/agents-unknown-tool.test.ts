import { describe, expect, it } from "vitest";

import { knownAgentToolName } from "./agents-catalog.ts";
import { builtinAgentToolName, unknownAgentToolRefusal } from "../people/member-tool-scope.ts";

// #1426: a member's bot on an organization server called `agents__image_gen`,
// a name the model made up once Grok's own image tool was withheld; it got an
// admin card that could only end in "Unknown tool".
describe("a Sagax tool that does not exist", () => {
  it("is told apart from every tool the catalog can list", () => {
    expect(knownAgentToolName("list_bots")).toBe(true);
    expect(knownAgentToolName("make_video")).toBe(true);
    expect(knownAgentToolName("memory_recall")).toBe(true);
    expect(knownAgentToolName("place_phone_call")).toBe(true);
    // a coordinating turn replaces these, a routine or webhook turn lists
    // them (coreCatalogTools ROOM_REPLACED_TOOLS): still real tools
    expect(knownAgentToolName("ask_bot")).toBe(true);
    expect(knownAgentToolName("delegate_bot")).toBe(true);
    expect(knownAgentToolName("check_delegation")).toBe(true);
    expect(knownAgentToolName("wait_delegation")).toBe(true);
    expect(knownAgentToolName("coordinate_bots")).toBe(true);
    expect(knownAgentToolName("image_gen")).toBe(false);
    expect(knownAgentToolName("generate_image")).toBe(false);
    expect(builtinAgentToolName("agents__image_gen")).toBe("image_gen");
  });

  it("is refused with words the model can act on, never a card", () => {
    const text = unknownAgentToolRefusal("image_gen");
    expect(text).toContain('no tool named "image_gen"');
    expect(text).toContain("no approval was asked");
    expect(text).toContain("image_gen on Grok");
    expect(unknownAgentToolRefusal("do_magic")).not.toContain("image");
  });
});
