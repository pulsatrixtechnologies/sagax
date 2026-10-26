import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { APPROVAL_EN, approvalPlain, describeAllowRule, mcpAllowKey, parseToolId } from "./approval-describe.ts";

const en = JSON.parse(readFileSync(join(import.meta.dirname, "..", "src", "locales", "en.json"), "utf8")) as Record<string, string>;
const flat = (obj: Record<string, unknown>, prefix = ""): Record<string, string> =>
  Object.entries(obj).reduce<Record<string, string>>((out, [key, value]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") Object.assign(out, flat(value as Record<string, unknown>, name));
    else out[name] = String(value);
    return out;
  }, {});
const catalog = flat(en);

describe("server approval words", () => {
  it("say exactly what the app catalog says (one generator, card and push)", () => {
    for (const [key, text] of Object.entries(APPROVAL_EN)) expect(catalog[key], key).toBe(text);
  });
});

describe("approvalPlain", () => {
  it("names the bot and the action, never the raw tool id", () => {
    const plain = approvalPlain({ botName: "Cryptic", tool: "sagax-environment__run_command", toolInput: '{"command":"echo hi"}', detail: 'sagax-environment__run_command {"command":"echo hi"}' });
    expect(plain.title).toMatch(/^Allow Cryptic to .+\?$/);
    expect(`${plain.title} ${plain.line}`).not.toMatch(/__|\{"/);
  });
  it("says 'run a command' for a run_command tool, not 'run the command action'", () => {
    const plain = approvalPlain({ botName: "Cryptic", tool: "sagax-environment__run_command", toolInput: '{"command":"echo hi"}', detail: 'sagax-environment__run_command {"command":"echo hi"}' });
    expect(plain.title).toBe("Allow Cryptic to run a command on your cloud computer?");
    expect(approvalPlain({ botName: "Cryptic", tool: "sagax-desktop__run_command", toolInput: '{"command":"ls"}' }).action).toBe("run a command on your computer");
    expect(approvalPlain({ botName: "Cryptic", tool: "acme__run_command", toolInput: '{"command":"ls"}' }).action).not.toMatch(/your/);
    const isolate = approvalPlain({ botName: "Cryptic", tool: "s1__isolate_action", detail: "s1__isolate_action {}" });
    expect(isolate.title).not.toMatch(/run a command/);
  });
  it("reads an MCP tool behind Grok's mcp__ prefix", () => {
    expect(parseToolId("mcp__perspicax__cw_psa__query")).toMatchObject({ server: "perspicax" });
  });
  it("falls back to a plain line when there is nothing readable", () => {
    const plain = approvalPlain({ botName: "Nib", tool: "other", detail: "{}" });
    expect(plain.line).toBeTruthy();
    expect(plain.line).not.toBe("{}");
  });
});

describe("allow rules", () => {
  it("are one exact tool of one server, described in words", () => {
    expect(mcpAllowKey("mcp__agents__list_bots")).toBe("mcp:agents__list_bots");
    expect(mcpAllowKey("Bash")).toBeUndefined();
    expect(describeAllowRule("mcp:agents__list_bots")).not.toMatch(/__/);
    expect(describeAllowRule("ask_bot:b1", undefined, () => "Dot")).toMatch(/Dot/);
  });
});

describe("the engines' mail, Teams, calendar and SharePoint connectors on the card", () => {
  const M365 = "mcp__claude_ai_Microsoft_365__";
  const now = new Date("2026-10-21T12:00:00");

  it("reads a calendar invitation: what, when and who is invited", () => {
    const plain = approvalPlain({
      botName: "Cryptic",
      tool: `${M365}outlook_create_event`,
      toolInput: JSON.stringify({
        subject: "Revue trimestrielle",
        start: "2026-10-23T14:00:00",
        end: "2026-10-23T15:00:00",
        attendees: [{ emailAddress: { address: "ana@example.com", name: "Ana" } }, "bo@example.com", { email: "cy@example.com" }, "di@example.com"],
      }),
    }, undefined, now);
    expect(plain.title).toBe("Allow Cryptic to send a calendar invitation in Microsoft 365?");
    expect(plain.line).toContain("Revue trimestrielle");
    expect(plain.line).toContain("to Ana <ana@example.com>, bo@example.com, cy@example.com and 1 more");
  });

  it("reads a sent mail, a Teams post, an answered invitation and a SharePoint write", () => {
    expect(approvalPlain({ botName: "Dot", tool: `${M365}outlook_send_mail`, toolInput: '{"to":["ana@example.com"],"subject":"Suivi"}' }).title)
      .toBe("Allow Dot to send an email in Microsoft 365?");
    expect(approvalPlain({ botName: "Dot", tool: `${M365}outlook_send_mail`, toolInput: '{"to":["ana@example.com"],"subject":"Suivi"}' }).line)
      .toContain("to ana@example.com");
    expect(approvalPlain({ botName: "Dot", tool: `${M365}teams_send_channel_message`, toolInput: '{"message":"hi"}' }).title)
      .toBe("Allow Dot to post a message in Teams in Microsoft 365?");
    expect(approvalPlain({ botName: "Dot", tool: `${M365}outlook_respond_to_event`, toolInput: '{"response":"accept"}' }).title)
      .toBe("Allow Dot to answer a calendar invitation in Microsoft 365?");
    expect(approvalPlain({ botName: "Dot", tool: `${M365}sharepoint_upload_file`, toolInput: '{"name":"rapport.pdf"}' }).title)
      .toBe("Allow Dot to write to SharePoint in Microsoft 365?");
    // a Grok cloud connector named for the store itself: no "in Sharepoint" twice
    expect(approvalPlain({ botName: "Dot", tool: "sharepoint__upload_file", toolInput: "{}" }).title).toBe("Allow Dot to write to SharePoint?");
    expect(approvalPlain({ botName: "Dot", tool: "onedrive__delete_file", toolInput: "{}" }).title).toBe("Allow Dot to write to OneDrive?");
  });

  it("never lets a display name hide the address it sends to (review of #943)", () => {
    const line = (attendee: unknown) => approvalPlain({ botName: "Dot", tool: `${M365}outlook_send_mail`, toolInput: JSON.stringify({ subject: "x", toRecipients: [attendee] }) }).line;
    expect(line({ emailAddress: { name: "Ana Tremblay (GOX)", address: "attacker@evil.example" } })).toContain("Ana Tremblay (GOX) <attacker@evil.example>");
    // a name that looks like another address or a domain is dropped
    expect(line({ emailAddress: { name: "ana@gox.ca", address: "attacker@evil.example" } })).toContain("to attacker@evil.example");
    expect(line({ emailAddress: { name: "ana@gox.ca", address: "attacker@evil.example" } })).not.toContain("gox.ca");
    expect(line({ name: "Support gox.ca", email: "attacker@evil.example" })).not.toContain("gox.ca");
    // a name with no address says so
    expect(line({ name: "Ana" })).toContain("Ana (?)");
  });

  it("leaves reads worded as before", () => {
    expect(approvalPlain({ botName: "Dot", tool: `${M365}outlook_calendar_search`, toolInput: "{}" }).title).not.toMatch(/invitation/);
  });
});
