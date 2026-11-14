import { describe, expect, it } from "vitest";

import {
  canadianNumber,
  CHOICE_ANSWER_RULE,
  CONVERSATION_LIMITS,
  formatPhone,
  maskPhone,
  ownerCallToPlaceArgs,
  parseOutboundCall,
  PLACE_PHONE_CALL_TOOL_SPEC,
  readablePhone,
  voiceCallArgs,
} from "./outbound-call.ts";
import { PLACE_CALL_TOOL_SPEC } from "./phone-call-live.ts";

const good = { to: "514-555-0142", objective: "Confirmer le rendez-vous de mardi à 10 h" };

describe("outbound call", () => {
  it("parses a Canadian call and refuses elsewhere", () => {
    expect(parseOutboundCall(good)).toEqual({ to: "+15145550142", from: "", purpose: good.objective, message: "", language: "fr", mode: "conversation", maxMinutes: 5 });
    expect(parseOutboundCall({ ...good, to: "+1 212 555 0142" })).toMatch(/Only Canadian/);
    expect(parseOutboundCall({ ...good, to: "+1 800 555 0142" })).toMatch(/Only Canadian/);
    expect(parseOutboundCall({ ...good, to: "+33 1 23 45 67 89" })).toMatch(/Only Canadian/);
    expect(parseOutboundCall(null)).toMatch(/needs/);
    expect(canadianNumber("+15145550142")).toBe(true);
    // N11, 0/1 exchanges and 976 premium are not callable (review)
    for (const bad of ["+15149110000", "+15144111234", "+15140551234", "+15141551234", "+15149761234"]) expect(canadianNumber(bad), bad).toBe(false);
    expect(parseOutboundCall({ ...good, objective: "Confirmer\u202E le rendez-vous" })).toMatchObject({ purpose: "Confirmer le rendez-vous" });
  });

  it("every call is a live conversation: a one-way message is never parsed, offered or sent (#4193)", () => {
    const oneWay = { to: "514-555-0142", from: "+1 438 555 0100", purpose: "Confirmer le rendez-vous", message: "Jean confirme mardi.", account: `AC${"0".repeat(32)}` };
    const request = parseOutboundCall(oneWay);
    expect(request).toMatchObject({ mode: "conversation", purpose: "Confirmer le rendez-vous", from: "", message: "" });
    expect(request).not.toHaveProperty("account");
    expect(parseOutboundCall({ ...good, mode: "live" })).toMatchObject({ mode: "conversation" });
    expect(parseOutboundCall({ ...good, mode: "message" })).toMatch(/live conversation/);
    if (typeof request === "string") throw new Error(request);
    const args = voiceCallArgs(request, { botName: "Rocket", ref: "call_0000000000000001", dryRun: false });
    expect(args).toMatchObject({ mode: "conversation", purpose: "Confirmer le rendez-vous" });
    expect(args).not.toHaveProperty("message");
    const properties = PLACE_PHONE_CALL_TOOL_SPEC.inputSchema.properties as Record<string, unknown>;
    for (const gone of ["message", "from", "account", "mode", "purpose"]) expect(properties, gone).not.toHaveProperty(gone);
    expect(PLACE_PHONE_CALL_TOOL_SPEC.description).toContain("never a recorded or spoken message");
    expect(PLACE_PHONE_CALL_TOOL_SPEC.description).not.toMatch(/message \(default\)|said twice|hangs up\b/);
  });

  it("the place_call alias offers the same live conversation, never the removed message mode (#4193)", () => {
    expect(PLACE_CALL_TOOL_SPEC.inputSchema).toEqual(PLACE_PHONE_CALL_TOOL_SPEC.inputSchema);
    const properties = PLACE_CALL_TOOL_SPEC.inputSchema.properties as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual(["instructions", "language", "max_minutes", "objective", "to", "voicemail"]);
    expect(PLACE_CALL_TOOL_SPEC.inputSchema.required).toEqual(["to", "objective"]);
    expect(PLACE_CALL_TOOL_SPEC.description).toContain("live two-way conversation");
    expect(PLACE_CALL_TOOL_SPEC.description).not.toMatch(/message or conversation/);
  });

  it("#4304: every conversation call asks again when an answer picks no side of a choice", () => {
    const request = parseOutboundCall({ ...good, instructions: "Rester bref." });
    if (typeof request === "string") throw new Error(request);
    const args = voiceCallArgs({ ...request, language: "fr" }, { botName: "Rocket", ref: "call_0000000000000001", dryRun: false });
    expect(args.instructions).toBe(`Rester bref.\n${CHOICE_ANSWER_RULE.fr}`);
    const bare = voiceCallArgs({ ...request, instructions: undefined, language: "en" }, { botName: "Rocket", ref: "call_0000000000000001", dryRun: false });
    expect(bare.instructions).toBe(CHOICE_ANSWER_RULE.en);
    // the bot's own guidance is never cut to make room
    const full = "x".repeat(CONVERSATION_LIMITS.instructions);
    expect(voiceCallArgs({ ...request, instructions: full }, { botName: "Rocket", ref: "call_0000000000000001", dryRun: false }).instructions).toBe(full);
    // the person's own questions call carries it once, when placed
    const owner = ownerCallToPlaceArgs({ questions: ["Tu préfères mardi ou mercredi ?"], to: "+1 514 555 0142", language: "fr" });
    if (typeof owner === "string") throw new Error(owner);
    const placed = voiceCallArgs({ ...request, instructions: owner.instructions, language: "fr" }, { botName: "Rocket", ref: "call_0000000000000001", dryRun: false });
    expect(String(placed.instructions).split(CHOICE_ANSWER_RULE.fr)).toHaveLength(2);
  });

  it("#4304: the choice rule never takes room from the person's own questions", () => {
    // 3 questions of 150 characters and 100 of context fit before the rule existed
    const questions = ["a", "b", "c"].map((letter) => `${letter.repeat(148)} ?`);
    const context = "c".repeat(100);
    for (const language of ["fr", "en"] as const) {
      const owner = ownerCallToPlaceArgs({ questions, context, to: "+1 514 555 0142", language });
      if (typeof owner === "string") throw new Error(owner);
      expect(owner.instructions.length).toBeLessThanOrEqual(CONVERSATION_LIMITS.instructions);
      const request = parseOutboundCall({ ...good, instructions: owner.instructions, language });
      if (typeof request === "string") throw new Error(request);
      const placed = String(voiceCallArgs(request, { botName: "Rocket", ref: "call_0000000000000001", dryRun: false }).instructions);
      // the questions always go out whole; the rule rides along only when it fits
      for (const q of questions) expect(placed).toContain(q);
      expect(placed.startsWith(request.instructions ?? "")).toBe(true);
    }
  });

  it("masks and formats", () => {
    expect(maskPhone("+15145550142")).toBe("+1 514 ••• •• 42");
    expect(formatPhone("+15145550142")).toBe("+1 514 555 0142");
  });

  it("phone_call_owner maps questions to a conversation place_phone_call (#2194)", () => {
    const mapped = ownerCallToPlaceArgs({
      questions: ["Tu es libre demain ?", "À quelle heure ?"],
      context: "Pour le rendez-vous fournisseur",
      to: "+1 514 555 0142",
      language: "fr",
    });
    expect(mapped).toMatchObject({
      to: "+15145550142",
      mode: "conversation",
      objective: "Tu es libre demain ?",
      language: "fr",
      max_minutes: 5,
    });
    if (typeof mapped === "string") throw new Error(mapped);
    expect(mapped.instructions).toContain("1. Tu es libre demain ?");
    expect(mapped.instructions).toContain("2. À quelle heure ?");
    expect(mapped.instructions).toContain("Pour le rendez-vous fournisseur");
    expect(ownerCallToPlaceArgs({ questions: [] })).toMatch(/at least one/);
    expect(ownerCallToPlaceArgs({ questions: ["ok"], to: "+1 212 555 0142" })).toMatch(/Only Canadian/);
    expect(ownerCallToPlaceArgs(null)).toMatch(/needs questions/);
  });
});

describe("readablePhone (#4112)", () => {
  it("reads a North American number the local way, from either form", () => {
    expect(readablePhone("+15550100142")).toBe("555 010-0142");
    expect(readablePhone("+1 555 010 0142")).toBe("555 010-0142");
  });
  it("leaves a name or another number as it is", () => {
    expect(readablePhone(" Sam Example ")).toBe("Sam Example");
    expect(readablePhone("+33 1 23 45 67 89")).toBe("+33 1 23 45 67 89");
  });
});
