import { describe, expect, it } from "vitest";

import { approvalModeLoosens, botActClasses, canonicalJson, cardContentText, requiredClasses, riskClassesFromFacts, stepUpClassesForCard, usableRpId } from "./step-up.ts";
import type { OptionCardData } from "./wire.ts";

const base: OptionCardData = { title: "Allow?", subtitle: "", options: ["Allow", "Deny"], requestType: "permission", requestId: "r1" };

describe("step-up classes", () => {
  it("takes the call's risk classes as read by the rules", () => {
    expect(stepUpClassesForCard({ ...base, tool: "Bash" }, ["irreversible", "money"])).toEqual(["irreversible", "money"]);
  });

  it("reads destructive and sending from the card itself", () => {
    expect(stepUpClassesForCard({ ...base, tool: "x", toolHints: { destructive: true } })).toContain("destructive");
    expect(stepUpClassesForCard({ ...base, ownerRule: { tool: "t", scope: {}, destructive: "external-message", description: "" } })).toEqual(["external-send"]);
    expect(stepUpClassesForCard({ ...base, outboundRequest: { tool: "send_mail", app: null } })).toEqual(["external-send"]);
  });

  it("knows a page being published", () => {
    expect(stepUpClassesForCard({ ...base, tool: "Artifact", toolInput: JSON.stringify({ file_path: "a.html" }) })).toEqual(["publish-page"]);
    expect(stepUpClassesForCard({ ...base, tool: "Artifact", toolInput: JSON.stringify({ action: "read" }) })).toEqual([]);
    expect(stepUpClassesForCard({ ...base, tool: "mcp__site__publish_page" })).toEqual(["publish-page"]);
  });

  it("knows a change to rules, never a read of them", () => {
    expect(stepUpClassesForCard({ ...base, tool: "mcp__admin__update_permissions" })).toEqual(["rule-change"]);
    expect(stepUpClassesForCard({ ...base, tool: "mcp__admin__list_permissions" })).toEqual([]);
  });

  it("counts what the answer remembers", () => {
    expect(stepUpClassesForCard({ ...base, tool: "Read" }, [], { always: true })).toEqual(["always-grant"]);
    expect(stepUpClassesForCard({ ...base, tool: "Read" }, [], { alwaysAllowKey: "Read" })).toEqual(["always-grant"]);
    expect(stepUpClassesForCard({ ...base, tool: "Read" }, [], { rule: "allow" })).toEqual(["always-grant", "rule-change"]);
    expect(stepUpClassesForCard({ ...base, tool: "Read" }, [], {})).toEqual([]);
  });

  it("asks only for the classes the person chose", () => {
    expect(requiredClasses(["money"], ["destructive", "money"])).toEqual(["money"]);
    expect(requiredClasses([], ["destructive"])).toEqual([]);
  });
});

describe("card content", () => {
  it("is stable whatever the key order, and ignores status fields", () => {
    const card: OptionCardData = { ...base, tool: "x", toolInput: '{"a":1}' };
    expect(cardContentText(card)).toBe(cardContentText({ ...card, answered: "allow", held: "mode", answeredBy: { kind: "loopback" } as never }));
    expect(cardContentText(card)).not.toBe(cardContentText({ ...card, toolInput: '{"a":2}' }));
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
  });
});

describe("RP ID", () => {
  it("is never an IP address, and needs https off this computer", () => {
    expect(usableRpId("localhost", "http:")).toBe("localhost");
    expect(usableRpId("127.0.0.1", "http:")).toBeNull();
    expect(usableRpId("sagax.example.com", "https:")).toBe("sagax.example.com");
    expect(usableRpId("sagax.example.com", "http:")).toBeNull();
    expect(usableRpId("::1", "http:")).toBeNull();
  });
});

describe("hardening (security review)", () => {
  it("a bot act is classed by its route, and fails closed", () => {
    expect(botActClasses({ kind: "route", method: "DELETE", path: "/api/bots/b1" })).toEqual(["destructive", "irreversible"]);
    expect(botActClasses({ kind: "route", method: "POST", path: "/api/bots/b1/messages" })).toEqual(["irreversible", "external-send"]);
    expect(botActClasses({ kind: "route", method: "PATCH", path: "/api/bots/b1" })).toEqual(["irreversible"]);
    expect(botActClasses({ kind: "route", method: "GET", path: "/api/bots" })).toEqual([]);
    expect(botActClasses({ kind: "ui", write: true })).toEqual(["irreversible"]);
    expect(botActClasses(undefined)).toEqual(["irreversible"]);
  });

  it("a shell command that is not a plain read is destructive and irreversible", () => {
    expect(riskClassesFromFacts({ command: "python3 -c 'x'", opaque: true, pureRead: false, risks: [] })).toEqual(["destructive", "irreversible"]);
    expect(riskClassesFromFacts({ command: "cat a", opaque: false, pureRead: true, risks: [] })).toEqual([]);
    expect(riskClassesFromFacts({ risks: ["money"] })).toEqual(["money"]);
  });

  it("a terminal and a routine are in a class", () => {
    expect(stepUpClassesForCard({ ...base, terminalRequest: {} as never })).toEqual(["destructive", "irreversible"]);
    expect(stepUpClassesForCard({ ...base, routineRequest: { operation: { action: "create" } } as never })).toEqual(["always-grant"]);
    expect(stepUpClassesForCard({ ...base, routineRequest: { operation: { action: "update" } } as never })).toEqual(["always-grant"]);
  });

  it("does not class routine model or effort changes as a standing grant", () => {
    for (const changes of [{ model: "fast" }, { effort: "low" }, { model: null, effort: null }]) {
      expect(botActClasses({ kind: "route", method: "PATCH", path: "/api/routines/r1", body: changes })).not.toContain("always-grant");
      expect(botActClasses({ kind: "ui", command: "updateRoutine", input: { patch: changes } })).not.toContain("always-grant");
      expect(stepUpClassesForCard({ ...base, routineRequest: { operation: { action: "update", changes } } as never })).not.toContain("always-grant");
    }
    expect(botActClasses({ kind: "route", method: "PATCH", path: "/api/routines/r1", body: { effort: "low", enabled: true } })).toContain("always-grant");
  });

  it("knows which approval level changes loosen", () => {
    expect(approvalModeLoosens("ask", "auto")).toBe(true);
    expect(approvalModeLoosens("ask", "edits")).toBe(true);
    expect(approvalModeLoosens("auto", "full")).toBe(true);
    expect(approvalModeLoosens("full", "custom")).toBe(true);
    expect(approvalModeLoosens("custom", "full")).toBe(true);
    expect(approvalModeLoosens("full", "ask")).toBe(false);
    expect(approvalModeLoosens("auto", "auto")).toBe(false);
    expect(approvalModeLoosens(undefined, "auto")).toBe(true);
  });
});

describe("bot act routines (re-review)", () => {
  it("a routine written or run through act is a standing grant; a delete is destructive", () => {
    expect(botActClasses({ kind: "route", method: "POST", path: "/api/routines" })).toContain("always-grant");
    expect(botActClasses({ kind: "route", method: "PATCH", path: "/api/routines/r1" })).toContain("always-grant");
    expect(botActClasses({ kind: "route", method: "DELETE", path: "/api/routines/r1" })).toContain("destructive");
    for (const command of ["createRoutine", "updateRoutine", "runRoutine"]) expect(botActClasses({ kind: "ui", command, write: true })).toContain("always-grant");
    expect(botActClasses({ kind: "ui", command: "deleteRoutine", write: true })).toContain("destructive");
  });
});
