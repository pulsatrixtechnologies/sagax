import { describe, expect, it } from "vitest";
import { parseGoMessage } from "./go-message.ts";

// #2091 (decided 2026-11-05): the Flow GO card names the tool and the action,
// carries a human line and the arguments once, and keeps a rule per tool
// and action
describe("parseGoMessage", () => {
  const single = [
    "Pulsatrix Flow needs your GO before this write is sent.",
    "Tool: cw_psa_write",
    "Action: create",
    'Arguments: {"action":"create","parent":299334,"resource":"service.tickets.notes","set":{"text":"Suivi"}}',
    "Why: the pack asks a GO for every note",
    "Allow sends it once; Deny sends nothing.",
  ].join("\n");

  it("reads one write: tool, action, arguments, reason", () => {
    const go = parseGoMessage(single);
    expect(go.tool).toBe("cw_psa_write");
    expect(go.action).toBe("create");
    expect(go.args).toBe('{"action":"create","parent":299334,"resource":"service.tickets.notes","set":{"text":"Suivi"}}');
    expect(go.why).toBe("the pack asks a GO for every note");
    expect(go.summary).toBe(
      "Create service.tickets.notes under 299334 with cw_psa_write. Pulsatrix Flow asks your GO before this write is sent. Why: the pack asks a GO for every note.",
    );
    // the rule covers the tool and the action, not these arguments
    expect(go.fingerprint).toBe("go:cw_psa_write:create");
    expect(go.ruleDescription).toBe("Send cw_psa_write create writes through Pulsatrix Flow");
  });

  it("still names the resource when the guard truncated the arguments", () => {
    const go = parseGoMessage([
      "Pulsatrix Flow needs your GO before this write is sent.",
      "Tool: cw_psa_write",
      "Action: update",
      "Record: 299334",
      'Arguments: {"action":"update","id":299334,"resource":"service.tickets","set":{"summary":"a very long summ...',
      "Allow sends it once; Deny sends nothing.",
    ].join("\n"));
    expect(go.summary).toBe("Update service.tickets (record 299334) with cw_psa_write. Pulsatrix Flow asks your GO before this write is sent.");
    expect(go.args).toMatch(/^\{"action":"update"/);
    expect(go.fingerprint).toBe("go:cw_psa_write:update");
  });

  it("reads a flow_action batch as one rule per action", () => {
    const go = parseGoMessage([
      "Pulsatrix Flow needs your GO before the 2 write(s) of the action close_resolved are sent:",
      '1. [GO] cw_psa_write {"action":"update","id":1}',
      '2. cw_psa_write {"action":"update","id":2}',
      "Allow sends the whole batch once; Deny sends nothing.",
    ].join("\n"));
    expect(go.batch).toEqual({ action: "close_resolved", count: 2 });
    expect(go.tool).toBeUndefined();
    // the writes are the card's folded arguments, once
    expect(go.args).toBe('1. [GO] cw_psa_write {"action":"update","id":1}\n2. cw_psa_write {"action":"update","id":2}');
    expect(go.summary).toBe("Pulsatrix Flow asks your GO before the 2 writes of the action close_resolved are sent.");
    expect(go.fingerprint).toBe("go:flow_action:close_resolved");
  });

  it("keeps an unknown message as its own line, with no rule fingerprint", () => {
    const go = parseGoMessage("Something else needs your GO.");
    expect(go.tool).toBeUndefined();
    expect(go.fingerprint).toBeUndefined();
    expect(go.summary).toBe("Pulsatrix Flow asks your GO before this write is sent.");
  });
});
