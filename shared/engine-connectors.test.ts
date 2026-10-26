import { describe, expect, it } from "vitest";

import {
  capabilityRoutes,
  connectorNeed,
  isEngineConnectorServer,
  claudeAiConnectorCapabilities,
  connectorWriteKind,
  engineConnectorOffers,
  grokConnectorCapabilities,
} from "./engine-connectors.ts";
import { GROK_CLOUD_CONNECTORS } from "./grok-cloud-connectors.ts";

const M365 = "mcp__claude_ai_Microsoft_365__";

describe("what each engine's connectors reach", () => {
  it("reads the claude.ai connectors by name", () => {
    expect(claudeAiConnectorCapabilities("Microsoft 365")).toEqual(["mail", "calendar", "teams", "sharepoint", "files"]);
    expect(claudeAiConnectorCapabilities("Gmail")).toEqual(["mail"]);
    expect(claudeAiConnectorCapabilities("Google Calendar")).toEqual(["calendar"]);
    expect(claudeAiConnectorCapabilities("Google Drive")).toEqual(["files"]);
    expect(claudeAiConnectorCapabilities("GitHub")).toEqual([]);
  });

  it("reads every Grok cloud connector by id", () => {
    expect(grokConnectorCapabilities("outlook")).toEqual(["mail", "calendar"]);
    expect(grokConnectorCapabilities("microsoft-teams")).toEqual(["teams"]);
    expect(grokConnectorCapabilities("sharepoint")).toEqual(["sharepoint", "files"]);
    expect(grokConnectorCapabilities("x")).toEqual([]);
    // every catalog entry is known to the table (no silent gap)
    for (const connector of GROK_CLOUD_CONNECTORS) expect(grokConnectorCapabilities(connector.id)).toBeDefined();
  });

  it("lists, per capability, the engine and connector that reach it; a connector that needs sign-in still counts", () => {
    const offers = engineConnectorOffers({
      claude: [{ name: "Microsoft 365", status: "needs_auth" }, { name: "GitHub", status: "connected" }],
      grok: true,
    });
    expect(offers.map((offer) => `${offer.engine}:${offer.connector}`)).toEqual([
      "claude:Microsoft 365",
      "grok:Outlook (Exchange)",
      "grok:Microsoft Teams",
      "grok:Gmail",
      "grok:Google Drive",
      "grok:OneDrive",
      "grok:SharePoint",
    ]);
    const routes = capabilityRoutes(offers);
    expect(routes.teams.map((route) => `${route.engine}:${route.connector}`)).toEqual(["claude:Microsoft 365", "grok:Microsoft Teams"]);
    expect(routes.sharepoint.map((route) => route.engine)).toEqual(["claude", "grok"]);
  });

  it("offers nothing without a Claude connector or a Grok engine", () => {
    const routes = capabilityRoutes(engineConnectorOffers({ claude: [], grok: false }));
    expect(Object.values(routes).every((list) => list.length === 0)).toBe(true);
  });
});

describe("connector calls that act outside the app", () => {
  it.each([
    ["outlook_send_mail", "mail-send"],
    ["outlook_send_draft", "mail-send"],
    ["outlook_forward_mail", "mail-send"],
    ["outlook_set_vacation", "mail-auto-reply"],
    ["teams_send_chat_message", "teams-post"],
    ["teams_send_channel_message", "teams-post"],
    ["teams_reply_channel_message", "teams-post"],
    ["teams_create_chat", "teams-chat"],
    ["outlook_create_event", "calendar-invite"],
    ["outlook_update_event", "calendar-invite"],
    ["outlook_delete_event", "calendar-cancel"],
    ["outlook_respond_to_event", "calendar-respond"],
    ["sharepoint_upload_file", "files-write"],
    ["sharepoint_update_file", "files-write"],
    ["sharepoint_create_folder", "files-write"],
    ["sharepoint_move_item", "files-write"],
    ["sharepoint_rename_item", "files-write"],
    ["sharepoint_copy_item", "files-write"],
    ["sharepoint_delete_item", "files-write"],
  ])("Microsoft 365 %s is %s", (tool, kind) => {
    expect(connectorWriteKind(`${M365}${tool}`)).toBe(kind);
  });

  it.each([
    "outlook_email_search",
    "outlook_calendar_search",
    "outlook_find_available_time",
    "find_meeting_availability",
    "outlook_create_draft",
    "outlook_update_draft",
    "outlook_create_reply_draft",
    "teams_list_chats",
    "teams_list_channel_messages",
    "sharepoint_search",
    "sharepoint_folder_search",
    "read_resource",
  ])("Microsoft 365 %s only reads or drafts", (tool) => {
    expect(connectorWriteKind(`${M365}${tool}`)).toBeNull();
  });

  it("reads a Grok cloud connector's own names and Google Calendar the same way", () => {
    expect(connectorWriteKind("outlook__send_email")).toBe("mail-send");
    expect(connectorWriteKind("microsoft_teams__post_message")).toBe("teams-post");
    expect(connectorWriteKind("sharepoint__upload_file")).toBe("files-write");
    expect(connectorWriteKind("onedrive__delete_file")).toBe("files-write");
    expect(connectorWriteKind("mcp__claude_ai_Google_Calendar__create_event")).toBe("calendar-invite");
    expect(connectorWriteKind("mcp__claude_ai_Google_Calendar__list_events")).toBeNull();
  });

  it("fails closed on the engines' mail, calendar, Teams and file connectors: any call that is not a read or a draft acts", () => {
    for (const tool of [
      `${M365}set_out_of_office`,
      `${M365}update_mailbox_settings`,
      `${M365}teams_create_meeting`,
      `${M365}outlook_create_filter`,
      `${M365}outlook_batch_delete_messages`,
      `${M365}outlook_trash_thread`,
      "mcp__claude_ai_Google_Calendar__insert_event",
      "mcp__claude_ai_Google_Drive__upload_file",
      "mcp__claude_ai_Gmail__modify_labels",
      "onedrive__save_file",
      "onedrive__set_permissions",
      "sharepoint__grant_access",
      "google_drive__upload_file",
      "microsoft-teams__schedule_meeting",
      "outlook__whatever_new_tool",
    ]) {
      expect(connectorWriteKind(tool), tool).not.toBeNull();
    }
    expect(connectorWriteKind(`${M365}teams_create_meeting`)).toBe("calendar-invite");
    expect(connectorWriteKind("microsoft-teams__schedule_meeting")).toBe("calendar-invite");
    expect(connectorWriteKind(`${M365}set_out_of_office`)).toBe("mail-auto-reply");
    expect(connectorWriteKind(`${M365}update_mailbox_settings`)).toBe("mail-auto-reply");
    expect(connectorWriteKind("mcp__claude_ai_Google_Calendar__insert_event")).toBe("calendar-invite");
    expect(connectorWriteKind("onedrive__set_permissions")).toBe("files-write");
    expect(connectorWriteKind("sharepoint__grant_access")).toBe("files-write");
    expect(connectorWriteKind("google_drive__upload_file")).toBe("files-write");
  });

  it("keeps reads, drafts and reply drafts on those connectors free", () => {
    for (const tool of [`${M365}get_me`, `${M365}get_granted_scopes`, `${M365}search_people`, `${M365}outlook_create_reply_all_draft`, `${M365}outlook_delete_draft`, "outlook__list_messages", "sharepoint__get_file"]) {
      expect(connectorWriteKind(tool), tool).toBeNull();
    }
  });

  it("knows the engines' connector servers, and only those", () => {
    expect(isEngineConnectorServer("claude_ai_Microsoft_365")).toBe(true);
    expect(isEngineConnectorServer("claude_ai_Gmail")).toBe(true);
    expect(isEngineConnectorServer("outlook")).toBe(true);
    expect(isEngineConnectorServer("microsoft_teams")).toBe(true);
    expect(isEngineConnectorServer("google-drive")).toBe(true);
    // a claude.ai connector that is not mail, calendar, Teams or files
    expect(isEngineConnectorServer("claude_ai_Linear")).toBe(false);
    expect(isEngineConnectorServer("agents")).toBe(false);
  });

  it("reads the same action the same way from a Composio slug", () => {
    expect(connectorWriteKind("GOOGLECALENDAR_CREATE_EVENT")).toBe("calendar-invite");
    expect(connectorWriteKind("OUTLOOK_CALENDAR_CREATE_EVENT")).toBe("calendar-invite");
    expect(connectorWriteKind("SHAREPOINT_UPLOAD_FILE")).toBe("files-write");
    expect(connectorWriteKind("GOOGLECALENDAR_LIST_EVENTS")).toBeNull();
  });

  it("leaves other servers' tools alone", () => {
    expect(connectorWriteKind("mcp__analytics__create_event")).toBeNull();
    expect(connectorWriteKind("mcp__files__upload_file")).toBeNull();
    expect(connectorWriteKind("Write")).toBeNull();
    expect(connectorWriteKind("")).toBeNull();
  });
});

describe("what a request needs", () => {
  it.each([
    ["Envoie un courriel à Ana pour confirmer", "mail", undefined],
    ["Check my Gmail for the invoice", "mail", "Gmail"],
    ["Réponds dans Outlook à Bob", "mail", "Outlook"],
    ["Invite Ana à une réunion jeudi 14 h", "calendar", undefined],
    ["What's on my calendar tomorrow?", "calendar", undefined],
    ["Publie le résumé dans Teams", "teams", "Teams"],
    ["Dépose le rapport dans SharePoint", "sharepoint", "SharePoint"],
    ["Mets le fichier dans OneDrive", "sharepoint", "OneDrive"],
  ])("%s", (text, capability, hint) => {
    expect(connectorNeed(text)).toEqual({ capability, ...(hint ? { hint } : {}) });
  });
  it("needs nothing for other work", () => {
    expect(connectorNeed("Corrige le test qui échoue")).toBeNull();
    expect(connectorNeed("")).toBeNull();
  });
});
