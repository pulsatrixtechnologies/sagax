// A server, plugin or skill name as people say it, shared by the Capabilities page
// (src/lib/installed-model.ts) and the capabilities list
// (server/capabilities/capabilities.ts): "github-github" is "GitHub".

/** One app's key across sources: "Asana", "asana" and "Asana MCP" match. */
export function appKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\((?:mcp|beta)\)|\bmcp\b|\bserver\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Plain names of well-known apps (appKey of the readable name). */
const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  github: "GitHub",
  gitlab: "GitLab",
  gmail: "Gmail",
  googledrive: "Google Drive",
  googlecalendar: "Google Calendar",
  googledocs: "Google Docs",
  googlesheets: "Google Sheets",
  microsoft365: "Microsoft 365",
  onedrive: "OneDrive",
  sharepoint: "SharePoint",
  hubspot: "HubSpot",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  openai: "OpenAI",
  chatgpt: "ChatGPT",
  clickup: "ClickUp",
  paypal: "PayPal",
};

/** A server or plugin name as people say it: "github-github" is "GitHub",
 * "acme-docs" is "Acme Docs". A repeated word (a plugin that named its
 * server after itself) shows once; a name already written with capitals
 * stays as it is. */
export function readableName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return name;
  const all = trimmed.split(/[-_\s]+/).filter(Boolean);
  // "linear-mcp", "notion-server": the kind of thing is not its name
  const named = all.filter((word) => !/^(mcp|server)$/i.test(word));
  const words = named.length ? named : all;
  const kept = words.filter((word, index) => index === 0 || word.toLowerCase() !== words[index - 1]!.toLowerCase());
  const known = DISPLAY_NAMES[appKey(kept.join(""))];
  if (known) return known;
  if (/[A-Z]/.test(trimmed) && kept.length === all.length) return trimmed;
  return kept.map((word) => DISPLAY_NAMES[word.toLowerCase()] ?? (word.slice(0, 1).toUpperCase() + word.slice(1))).join(" ");
}
