import { describe, expect, it } from "vitest";

import {
  OUTBOUND_DEFAULT_CAP,
  connectorCallsIn,
  isMessageSendTool,
  isOutboundTool,
  isPhoneCallTool,
  isReadOnlyTool,
  normalizeOutboundPolicy,
  outboundCallsIn,
} from "./outbound.ts";

describe("isOutboundTool", () => {
  it("flags tools that send, reply, post, publish, invite, share, or move money", () => {
    for (const name of [
      "GMAIL_SEND_EMAIL",
      "GMAIL_SEND_DRAFT",
      "GMAIL_REPLY_TO_THREAD",
      "SLACK_SEND_MESSAGE",
      "SLACK_CHAT_POST_MESSAGE",
      "TWITTER_CREATION_OF_A_POST",
      "LINKEDIN_CREATE_LINKED_IN_POST",
      "STRIPE_CREATE_REFUND",
      "GITHUB_CREATE_AN_ISSUE_COMMENT",
      "HUBSPOT_SEND_EMAIL",
      "GOOGLECALENDAR_INVITE_ATTENDEES",
      "mcp__composio__WHATSAPP_SEND_MESSAGE",
      "mcp__claude_ai_Gmail__send_message",
      "mcp__claude_ai_Gmail__reply",
      "mcp__claude_ai_Gmail__forward",
      "mcp__claude_ai_Slack__slack_send_message",
      "mcp__claude_ai_Microsoft_365__create_task_comment",
      "outlook__create_invoice",
    ]) {
      expect(isOutboundTool(name), name).toBe(true);
    }
  });

  it("does not treat in-app Sagax peer tools as outbound (#1905)", () => {
    for (const name of [
      "send_to_bot",
      "agents__send_to_bot",
      "mcp__agents__send_to_bot",
      "post_to_room",
      "agents__post_to_room",
      "mcp__agents__post_to_room",
      "coordinate_bots",
      "agents__coordinate_bots",
      "ask_bot",
      "delegate_bot",
    ]) {
      expect(isOutboundTool(name), name).toBe(false);
    }
  });

  it("leaves reading, searching, drafting, and internal record-keeping alone", () => {
    for (const name of [
      "GMAIL_FETCH_EMAILS",
      "GMAIL_LIST_THREADS",
      "GMAIL_CREATE_EMAIL_DRAFT",
      "SLACK_SEARCH_MESSAGES",
      "REDDIT_GET_POST",
      "STRIPE_LIST_CHARGES",
      "GITHUB_GET_A_PULL_REQUEST",
      "GITHUB_CREATE_AN_ISSUE",
      "LINEAR_CREATE_ISSUE",
      "NOTION_CREATE_PAGE",
      "GOOGLESHEETS_BATCH_UPDATE",
      "mcp__claude_ai_Gmail__search_threads",
      // a reply draft sends nothing until it is sent (review of #943)
      "mcp__claude_ai_Microsoft_365__outlook_create_reply_draft",
      "mcp__claude_ai_Microsoft_365__outlook_create_reply_all_draft",
      "GMAIL_CREATE_REPLY_DRAFT",
      "mcp__claude_ai_Linear__save_issue",
      "mcp__computer__click",
      "Bash",
      "Read",
      "Edit",
    ]) {
      expect(isOutboundTool(name), name).toBe(false);
    }
  });
});

describe("isOutboundTool, the engines' mail, Teams, calendar and SharePoint connectors", () => {
  it("keeps the card for every send or write through them", () => {
    for (const tool of [
      "outlook_send_mail",
      "outlook_set_vacation",
      "teams_send_chat_message",
      "teams_create_chat",
      "outlook_create_event",
      "outlook_update_event",
      "outlook_delete_event",
      "outlook_respond_to_event",
      "sharepoint_upload_file",
      "sharepoint_update_file",
      "sharepoint_create_folder",
      "sharepoint_move_item",
      "sharepoint_rename_item",
      "sharepoint_delete_item",
    ]) {
      expect(isOutboundTool(`mcp__claude_ai_Microsoft_365__${tool}`), tool).toBe(true);
    }
    expect(isOutboundTool("sharepoint__upload_file")).toBe(true);
    // fail closed on an engine connector's unknown tool, and the same
    // reading on the Composio path (review of #943)
    expect(isOutboundTool("mcp__claude_ai_Microsoft_365__set_out_of_office")).toBe(true);
    expect(isOutboundTool("onedrive__set_permissions")).toBe(true);
    for (const slug of ["GOOGLECALENDAR_CREATE_EVENT", "OUTLOOK_CALENDAR_CREATE_EVENT", "SHAREPOINT_UPLOAD_FILE"]) expect(isOutboundTool(slug), slug).toBe(true);
    expect(isOutboundTool("outlook__create_event")).toBe(true);
  });

  it("lets reads and drafts through them run", () => {
    for (const tool of ["outlook_email_search", "outlook_calendar_search", "find_meeting_availability", "outlook_create_draft", "teams_list_chats", "sharepoint_search", "sharepoint_folder_search"]) {
      expect(isOutboundTool(`mcp__claude_ai_Microsoft_365__${tool}`), tool).toBe(false);
    }
  });

  it("does not turn mailbox organization, deletion or an unknown connector write into an outbound send", () => {
    for (const tool of [
      "outlook__move_message",
      "outlook__move_email",
      "mcp__Outlook__move_email",
      "mcp__claude_ai_Microsoft_365__outlook_move_message",
      "cursor__user-Outlook-move_5fmail_5fmessage___12",
      "outlook__delete_message",
      "outlook__batch_delete_messages",
      "outlook__mark_as_read",
      "mcp__claude_ai_Gmail__modify_labels",
      "mcp__claude_ai_Microsoft_365__outlook_create_filter",
      "outlook__whatever_new_tool",
    ]) expect(isOutboundTool(tool), tool).toBe(false);
  });
});

describe("isReadOnlyTool", () => {
  it("recognizes exact MCP reads and known noun-first slugs without treating other non-outbound actions as reads", () => {
    for (const name of [
      "mcp__linear__list_issues",
      "mcp__linear__list_comments",
      "mcp__linear__get_issue",
      "GMAIL_SEARCH_MESSAGES",
      "GOOGLECALENDAR_EVENTS_LIST",
      "mcp__composio__GMAIL_FETCH_EMAILS",
    ]) expect(isReadOnlyTool(name), name).toBe(true);

    for (const name of [
      "mcp__linear__save_issue",
      "mcp__linear__delete_issue",
      "mcp__linear__create_comment",
      "mcp__computer__click",
      "Bash",
    ]) expect(isReadOnlyTool(name), name).toBe(false);
  });
});

describe("normalizeOutboundPolicy", () => {
  it("accepts ask and allow with a whole-number daily cap", () => {
    expect(normalizeOutboundPolicy({ policy: "ask" })).toEqual({ policy: "ask", dailyCap: OUTBOUND_DEFAULT_CAP });
    expect(normalizeOutboundPolicy({ policy: "allow", dailyCap: 10 })).toEqual({ policy: "allow", dailyCap: 10 });
  });

  it("refuses anything else", () => {
    expect(normalizeOutboundPolicy({ policy: "yes" })).toBeNull();
    expect(normalizeOutboundPolicy({ policy: "allow", dailyCap: 0 })).toBeNull();
    expect(normalizeOutboundPolicy({ policy: "allow", dailyCap: 2.5 })).toBeNull();
    expect(normalizeOutboundPolicy({ policy: "allow", dailyCap: 100_000 })).toBeNull();
    expect(normalizeOutboundPolicy("allow")).toBeNull();
    expect(normalizeOutboundPolicy(null)).toBeNull();
  });
});

describe("connectorCallsIn", () => {
  // Connected-apps session meta tools; the app tools run inside them. The
  // gate has to see through the wrapper or it sees nothing.
  it("returns a direct app tool as itself", () => {
    expect(connectorCallsIn("GMAIL_SEND_EMAIL", { to: "a@b.c" })).toEqual([{ slug: "GMAIL_SEND_EMAIL", arguments: { to: "a@b.c" } }]);
  });

  it("unwraps every tool inside a multi-execute call", () => {
    const calls = connectorCallsIn("COMPOSIO_MULTI_EXECUTE_TOOL", {
      tools: [
        { tool_slug: "GMAIL_FETCH_EMAILS", arguments: { query: "is:unread" } },
        { tool_slug: "SLACK_SEND_MESSAGE", arguments: { channel: "#ops", text: "hi" } },
      ],
      sync_response_to_workbench: false,
    });
    expect(calls.map((call) => call.slug)).toEqual(["GMAIL_FETCH_EMAILS", "SLACK_SEND_MESSAGE"]);
    expect(calls[1].arguments).toEqual({ channel: "#ops", text: "hi" });
  });

  it("treats all arbitrary code as opaque, not as an enumerable send allowance", () => {
    const code = 'for id in ids:\n    run_tool("GMAIL_SEND_EMAIL", {"thread_id": id})\nrun_tool("GMAIL_FETCH_EMAILS", {})';
    expect(connectorCallsIn("COMPOSIO_REMOTE_WORKBENCH", { code_to_execute: code }).map((call) => call.slug)).toEqual([
      "COMPOSIO_PROXY_EXECUTE",
    ]);
    expect(connectorCallsIn("COMPOSIO_REMOTE_WORKBENCH", { code_to_execute: "proxy_execute('POST', 'https://api.x.com')" })
      .map((call) => call.slug)).toEqual(["COMPOSIO_PROXY_EXECUTE"]);
  });

  it("ignores discovery but fails closed for malformed execution arguments", () => {
    expect(connectorCallsIn("COMPOSIO_SEARCH_TOOLS", { queries: [{ use_case: "send an email" }] })).toEqual([]);
    expect(connectorCallsIn("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: "nope" })[0].slug).toBe("COMPOSIO_PROXY_EXECUTE");
    expect(connectorCallsIn("COMPOSIO_MULTI_EXECUTE_TOOL", undefined)[0].slug).toBe("COMPOSIO_PROXY_EXECUTE");
    expect(connectorCallsIn("COMPOSIO_REMOTE_WORKBENCH", { code: 'run_tool("GMAIL_" + "SEND_EMAIL", {})' })[0].slug).toBe("COMPOSIO_PROXY_EXECUTE");
    expect(connectorCallsIn("COMPOSIO_REMOTE_BASH_TOOL", { command: "curl -X POST https://example.test/send" })[0].slug).toBe("COMPOSIO_PROXY_EXECUTE");
    expect(connectorCallsIn("COMPOSIO_PROXY_EXECUTE", {})[0].slug).toBe("COMPOSIO_PROXY_EXECUTE");
  });
});

describe("outboundCallsIn", () => {
  it("keeps only the calls that send", () => {
    const sends = outboundCallsIn("COMPOSIO_MULTI_EXECUTE_TOOL", {
      tools: [{ tool_slug: "GMAIL_FETCH_EMAILS" }, { tool_slug: "GMAIL_SEND_EMAIL", arguments: { to: "x" } }],
    });
    expect(sends.map((call) => call.slug)).toEqual(["GMAIL_SEND_EMAIL"]);
    expect(outboundCallsIn("GMAIL_FETCH_EMAILS", {})).toEqual([]);
    expect(isOutboundTool("COMPOSIO_PROXY_EXECUTE")).toBe(true);
  });
});

// 2026-11-02: a phone call reaches a real person and costs money: held like
// a text. Only known call-placing tools, never the word "call" in a name.
describe("isPhoneCallTool: a call placed is outbound, like a text", () => {
  const create = { resource: "Calls", action: "create", set: { To: "+15145550142", From: "+15145550100", Twiml: "<Response/>" } };

  it("a Twilio Calls create is outbound, in both the old __ and the new _ names", () => {
    for (const tool of [
      "twilio_api_write",
      "twilio_api__write",
      "mcp__perspicax__twilio_api_write",
      "mcp__perspicax__twilio_api__write",
      "mcp__pulsatrix_connectwise_psa__twilio_api_write",
    ]) {
      expect(isPhoneCallTool(tool, create), tool).toBe(true);
      expect(isOutboundTool(tool, create), tool).toBe(true);
    }
    // the resource spelled Calls.json or as the full path, a per-resource tool
    expect(isOutboundTool("twilio_api_write", { ...create, resource: "Calls.json" })).toBe(true);
    expect(isOutboundTool("twilio_api_write", { ...create, resource: "/2010-04-01/Accounts/AC123/Calls.json" })).toBe(true);
    expect(isOutboundTool("twilio_api_Calls_write", { action: "create", set: { To: "+15145550142" } })).toBe(true);
    expect(isOutboundTool("mcp__perspicax__twilio_api__Calls_write", { set: { To: "+15145550142" } })).toBe(true);
    expect(isOutboundTool("api_write", create)).toBe(true);
  });

  it("voice_call and create_call place a call by name, with or without a server", () => {
    for (const tool of [
      "voice_call",
      "mcp__perspicax__voice_call",
      "mcp__pulsatrix_connectwise_psa__voice_call",
      "create_call",
      "mcp__twilio__create_call",
      "TWILIO_CREATE_CALL",
    ]) {
      expect(isPhoneCallTool(tool), tool).toBe(true);
      expect(isOutboundTool(tool), tool).toBe(true);
    }
    // run through a directory's call_tool or a gateway's use_tool
    expect(isOutboundTool("mcp__directory__call_tool", { name: "voice_call", arguments: { to: "+15145550142", purpose: "Rappel" } })).toBe(true);
    expect(isOutboundTool("mcp__gateway__use_tool", { tool_name: "twilio_api__write", tool_input: create })).toBe(true);
  });

  it("a read of calls is not held", () => {
    for (const tool of ["twilio_api_query", "twilio_api__query", "mcp__perspicax__twilio_api_query", "calls_query", "get_call_recordings", "mcp__twilio__list_calls", "mcp__perspicax__voice_line"]) {
      expect(isPhoneCallTool(tool, { resource: "Calls", params: { To: "+15145550142" } }), tool).toBe(false);
      expect(isOutboundTool(tool, { resource: "Calls" }), tool).toBe(false);
    }
  });

  it("a name that merely contains call is not held", () => {
    for (const tool of ["call_tool", "mcp__directory__call_tool", "callback_handler", "recall_notes", "mcp__crm__log_call", "mcp__crm__update_call", "call_summary", "mcp__perspicax__voice_number"]) {
      expect(isPhoneCallTool(tool, {}), tool).toBe(false);
      expect(isOutboundTool(tool, {}), tool).toBe(false);
    }
    // a meta tool running a read is no call either
    expect(isOutboundTool("mcp__directory__call_tool", { name: "twilio_api_query", arguments: { resource: "Calls" } })).toBe(false);
  });

  it("a Twilio write that does not place a call is not a call", () => {
    // no To: an update of a live call, a recording of one, another resource
    expect(isPhoneCallTool("twilio_api_write", { resource: "Calls", action: "update", id: "CA1", set: { Status: "completed" } })).toBe(false);
    expect(isPhoneCallTool("twilio_api_write", { resource: "Calls", action: "create", set: { From: "+15145550100" } })).toBe(false);
    expect(isPhoneCallTool("twilio_api_write", { resource: "Accounts_Calls_Recordings", action: "create", parent: "CA1", set: { To: "x" } })).toBe(false);
    expect(isPhoneCallTool("twilio_api_write", { resource: "Messages", action: "create", set: { To: "+15145550142" } })).toBe(false);
    // the name alone, without the arguments, is not read as a call
    expect(isPhoneCallTool("twilio_api_write")).toBe(false);
    // a Calls write of another product is not Twilio's
    expect(isPhoneCallTool("cw_psa_write", create)).toBe(false);
  });

  it("place_phone_call keeps its own card and is not matched; a call is never a plain message send", () => {
    expect(isPhoneCallTool("place_phone_call")).toBe(false);
    expect(isMessageSendTool("mcp__perspicax__voice_call")).toBe(false);
    expect(isMessageSendTool("TWILIO_CREATE_CALL")).toBe(false);
  });

  it("outboundCallsIn reads a Calls create through its arguments", () => {
    expect(outboundCallsIn("mcp__perspicax__twilio_api__write", create).map((call) => call.slug)).toEqual(["mcp__perspicax__twilio_api__write"]);
    expect(outboundCallsIn("mcp__perspicax__twilio_api__query", { resource: "Calls" })).toEqual([]);
  });
});
