import { describe, expect, it } from "vitest";

import { TELEPHONY_CALL_REFUSAL, TELEPHONY_NUMBER_REFUSAL, TELEPHONY_WRITE_REFUSAL, telephonyRefusal } from "./telephony-guard.ts";

const TELEPHONY_REDIRECT_REFUSAL = TELEPHONY_WRITE_REFUSAL;

describe("telephonyRefusal", () => {
  it("refuses every number purchase or change, any profile prefix", () => {
    expect(telephonyRefusal("twilio_api_write", { resource: "IncomingPhoneNumbers", action: "create", set: { PhoneNumber: "+15145550142" } })).toBe(TELEPHONY_NUMBER_REFUSAL);
    expect(telephonyRefusal("mcp__perspicax_acme__twilio_api_write", { resource: "Accounts_IncomingPhoneNumbers_Local", action: "create" })).toBe(TELEPHONY_NUMBER_REFUSAL);
    expect(telephonyRefusal("twilio_api_write", { resource: "IncomingPhoneNumbers", action: "update", id: "PN1", set: { VoiceUrl: "https://x" } })).toBe(TELEPHONY_NUMBER_REFUSAL);
    expect(telephonyRefusal("twilio_api_write", { resource: "IncomingPhoneNumbers", action: "delete", id: "PN1" })).toBe(TELEPHONY_NUMBER_REFUSAL);
    expect(telephonyRefusal("twilio_api_action", { action: "CreateIncomingPhoneNumber" })).toBe(TELEPHONY_NUMBER_REFUSAL);
  });

  it("refuses a bot's own call and a redirect, lets other writes through", () => {
    expect(telephonyRefusal("twilio_api_write", { resource: "Calls", action: "create", set: { To: "+15145550142", Url: "https://evil" } })).toBe(TELEPHONY_CALL_REFUSAL);
    expect(telephonyRefusal("twilio_api_write", { resource: "Calls", action: "update", id: "CA1", set: { Twiml: "<Response/>" } })).toBe(TELEPHONY_CALL_REFUSAL);
    expect(telephonyRefusal("twilio_api_write", { resource: "Calls", action: "update", id: "CA1", set: { Status: "completed" } })).toBe(TELEPHONY_CALL_REFUSAL);
    expect(telephonyRefusal("twilio_api_write", { resource: "Participants", action: "create", parent: ["AC1", "CF1"] })).toBe(TELEPHONY_REDIRECT_REFUSAL);
    // texts keep their existing approval card (owner-approval external-message)
    expect(telephonyRefusal("twilio_api_write", { resource: "Messages", action: "create", set: { To: "+15145550142" } })).toBeNull();
  });

  it("closes the name, case and default-action variants (review)", () => {
    expect(telephonyRefusal("twilio_api_write", { resource: "Calls", set: { To: "+15145550142", Url: "https://x" } })).toBe(TELEPHONY_CALL_REFUSAL);
    expect(telephonyRefusal("twilio_api_write", { resource: "Accounts_Calls", action: "create" })).toBe(TELEPHONY_CALL_REFUSAL);
    expect(telephonyRefusal("twilio_api_write", { resource: "calls", action: "CREATE" })).toBe(TELEPHONY_CALL_REFUSAL);
    expect(telephonyRefusal("twilio_api_write", { resource: "Calls", action: "update", set: { url: "https://x" } })).toBe(TELEPHONY_CALL_REFUSAL);
    expect(telephonyRefusal("twilio_api_write", { resource: "Accounts_Conferences_Participants", action: "create" })).toBe(TELEPHONY_REDIRECT_REFUSAL);
    expect(telephonyRefusal("twilio_api_write", { resource: "IncomingPhoneNumbers" })).toBe(TELEPHONY_NUMBER_REFUSAL);
    expect(telephonyRefusal("twilio_api_action", { name: "update_call" })).toBe(TELEPHONY_CALL_REFUSAL);
    expect(telephonyRefusal("twilio_api_action", { op_id: "CreateParticipant" })).toBe(TELEPHONY_REDIRECT_REFUSAL);
  });

  it("is an allow-list: reads and texts only (security review of #956)", () => {
    for (const [resource, set] of [
      ["Streams", { Url: "wss://bot" }], ["Siprec", { ConnectorName: "x" }], ["Payments", {}], ["Members", { Url: "https://x" }],
      ["Conferences", { AnnounceUrl: "https://x" }], ["Applications", { VoiceUrl: "https://x" }], ["Domains", { VoiceUrl: "https://x" }],
      ["ShortCodes", { SmsUrl: "https://x" }], ["OutgoingCallerIds", {}], ["Keys", {}], ["SigningKeys", {}], ["Accounts", { FriendlyName: "x" }],
      ["Accounts_Calls_Recordings", {}],
    ] as const) {
      for (const action of ["create", "update", "delete", ""]) {
        expect(telephonyRefusal("twilio_api_write", { resource, action, set }), `${resource} ${action}`).not.toBeNull();
      }
    }
    expect(telephonyRefusal("twilio_api_write", { resource: "Calls", action: "delete", id: "CA1" })).toBe(TELEPHONY_CALL_REFUSAL);
    expect(telephonyRefusal("twilio_api_write", { resource: "Messages", action: "update", id: "SM1", set: { Body: "" } })).not.toBeNull();
    expect(telephonyRefusal("twilio_messaging_write", { resource: "Services", action: "create" })).not.toBeNull();
    expect(telephonyRefusal("twilio_lookups_PhoneNumbers_Overrides", { action: "create" })).not.toBeNull();
  });

  it("folds tool name separators and per-resource names", () => {
    expect(telephonyRefusal("twilio_api-write", { resource: "Calls", action: "create" })).toBe(TELEPHONY_CALL_REFUSAL);
    expect(telephonyRefusal("TWILIO_API__WRITE", { resource: "Keys", action: "create" })).toBe(TELEPHONY_WRITE_REFUSAL);
    expect(telephonyRefusal("twilio_api_Calls_write", { action: "create", set: { To: "+15145550142" } })).toBe(TELEPHONY_CALL_REFUSAL);
    expect(telephonyRefusal("twilio_api_IncomingPhoneNumbers_write", { action: "create" })).toBe(TELEPHONY_NUMBER_REFUSAL);
    expect(telephonyRefusal("twilio_api_Messages_write", { action: "create", set: { To: "+15145550142" } })).toBeNull();
    expect(telephonyRefusal("mcp__perspicax-acme__twilio-api__query", { resource: "Calls" })).toBeNull();
  });

  it("allows reads, dry runs and other profiles", () => {
    expect(telephonyRefusal("twilio_api_query", { resource: "IncomingPhoneNumbers" })).toBeNull();
    expect(telephonyRefusal("twilio_api_write", { resource: "Calls", action: "create", _dry_run: true })).toBeNull();
    expect(telephonyRefusal("cw_psa_write", { resource: "Calls", action: "create" })).toBeNull();
  });

  it("refuses a text that carries a URL or a callback (re-review)", () => {
    expect(telephonyRefusal("twilio_api_write", { resource: "Messages", action: "create", set: { To: "+15145550142", Body: "x", StatusCallback: "https://bot" } })).toBe(TELEPHONY_WRITE_REFUSAL);
    expect(telephonyRefusal("twilio_api_write", { resource: "Messages", action: "create", set: { To: "+15145550142", MediaUrl: ["https://x"] } })).toBe(TELEPHONY_WRITE_REFUSAL);
    expect(telephonyRefusal("twilio_api_write", { resource: "Messages", action: "create", set: { To: "+15145550142", Body: "Bonjour" } })).toBeNull();
  });

  it("allows texts in the other write shapes and read recipes; no read action on a write tool (re-review)", () => {
    expect(telephonyRefusal("twilio_api_action", { action: "CreateMessage", params: { To: "+15145550142", Body: "x" } })).toBeNull();
    expect(telephonyRefusal("twilio_api_write", { resource: "Messages", action: "create", ids: ["a", "b"], set: { Body: "x" } })).toBeNull();
    expect(telephonyRefusal("twilio_api_read_action", { action: "FetchCall", id: "CA1" })).toBeNull();
    expect(telephonyRefusal("twilio_api_find_calls", { to: "+15145550142" })).toBeNull();
    expect(telephonyRefusal("twilio_api_write", { resource: "Calls", action: "list" })).not.toBeNull();
    expect(telephonyRefusal("twilio_api_write", { resource: "Keys", action: "fetch" })).not.toBeNull();
  });

  it("guards a catalog that targets Twilio under another id, and flow actions that reach it (re-review)", () => {
    const twilioTools = new Set(["sms_gateway__write"]);
    expect(telephonyRefusal("sms_gateway__write", { resource: "Calls", action: "create" }, { twilioTools })).toBe(TELEPHONY_CALL_REFUSAL);
    expect(telephonyRefusal("sms_gateway__query", { resource: "Calls" }, { twilioTools })).toBeNull();
    expect(telephonyRefusal("flow_action", { name: "twilio.place_call", params: { to: "+15145550142" } })).toBe(TELEPHONY_WRITE_REFUSAL);
    expect(telephonyRefusal("flow_action", { name: "notify", params: { via: "api.twilio.com" } })).toBe(TELEPHONY_WRITE_REFUSAL);
    expect(telephonyRefusal("flow_action", { name: "twilio.place_call", _dry_run: true })).toBeNull();
    expect(telephonyRefusal("flow_action", { name: "cw.add_note", params: { text: "ok" } })).toBeNull();
  });

  // #1994: a read of the Perspicax Voice line is never a Twilio change, even
  // when tools/list put voice_line in twilioTools because its description
  // names Twilio.
  it("allows voice_line reads, including when aliased as a Twilio tool (#1994)", () => {
    const twilioTools = new Set(["voice_line", "voice_sms", "voice_number"]);
    expect(telephonyRefusal("voice_line", {}, { twilioTools })).toBeNull();
    expect(telephonyRefusal("voice_line", { action: "read" }, { twilioTools })).toBeNull();
    expect(telephonyRefusal("mcp__perspicax__voice_line", {}, { twilioTools })).toBeNull();
    expect(telephonyRefusal("mcp__perspicax_osprey__voice_line", {}, { twilioTools })).toBeNull();
    // voice_number still changes numbers: refuse when aliased
    expect(telephonyRefusal("voice_number", { action: "buy" }, { twilioTools })).toBe(TELEPHONY_WRITE_REFUSAL);
  });
});
