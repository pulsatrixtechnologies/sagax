// The cloud connectors a Grok account brings (grok.com/connectors).
// Sagax does not sign the person in and does not store a token. The names
// are what Connect apps and Providers show, so Exchange, X and Microsoft
// Teams are visible beside the servers Sagax itself mounts. A turn still
// asks before a call (server/drivers/acp/grok.ts).

export interface GrokCloudConnector {
  id: string;
  name: string;
  /** A tag categoryFromTags already understands. */
  tag: string;
}

export const GROK_CONNECTORS_URL = "https://grok.com/connectors";

export const GROK_CLOUD_CONNECTORS: readonly GrokCloudConnector[] = [
  { id: "outlook", name: "Outlook (Exchange)", tag: "email" },
  { id: "microsoft-teams", name: "Microsoft Teams", tag: "messaging" },
  { id: "x", name: "X", tag: "social" },
  { id: "gmail", name: "Gmail", tag: "email" },
  { id: "google-drive", name: "Google Drive", tag: "files" },
  { id: "onedrive", name: "OneDrive", tag: "files" },
  { id: "sharepoint", name: "SharePoint", tag: "files" },
  { id: "salesforce", name: "Salesforce", tag: "crm" },
];
