import { describe, expect, it } from "vitest";
import { HELP_TOOL_DEFINITIONS } from "../agents-help-tools.ts";
import { PERSPICAX_TOOLS } from "./perspicax.ts";

// QA 0.8.66 F6: "install sagax remote access unattended" took sagax_help x2
// and session_search x2 before remote_support_hosts. The tool descriptions
// must send the bot straight to remote_support_hosts, in one call.
describe("Sagax Remote Access goes to remote_support_hosts first (QA 0.8.66 F6)", () => {
  const description = (name: string, list: ReadonlyArray<{ name: string; description: string }>) =>
    list.find((tool) => tool.name === name)?.description ?? "";

  it("remote_support_hosts says it is the first call and never points at sagax_help", () => {
    const text = description("remote_support_hosts", PERSPICAX_TOOLS);
    expect(text).toContain("very first call");
    expect(text).toContain("do not call sagax_help, session_search or search the disk before it");
    expect(text).not.toMatch(/See sagax_help/);
  });

  it("sagax_help sends Remote Access requests to remote_support_hosts", () => {
    expect(description("sagax_help", HELP_TOOL_DEFINITIONS)).toContain("Not for Sagax Remote Access (install, status, open a session): call remote_support_hosts directly");
  });
});
