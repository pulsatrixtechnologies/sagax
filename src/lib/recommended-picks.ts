// Connect Apps > "Recommended for you" (#4207, the owner 2026-11-13: the
// first section, and it picks what is usually a good pick for a bot). One
// curated, ordered list: the work basics first (mail, calendar, files and
// documents, chat and meetings, the code host, a browser, the ticketing or
// CRM product), then the rest. Each pick says in a few words why a bot wants
// it. The picker keeps only what this person can connect here and does not
// have yet, never greyed: an item it cannot offer is left out.
import type { LocaleKey } from "@/locales";
import type { ConnectorCapability } from "../../shared/engine-connectors";
import { appKey, type PluginItem } from "./plugins-model";

/** What a pick does for a bot. The order is the basics' order. */
export const PICK_KINDS = [
  "mail", "calendar", "files", "chat", "code", "browser", "tickets", "crm",
  "notes", "tasks", "docs", "design", "errors", "payments",
] as const;
export type PickKind = (typeof PICK_KINDS)[number];

export interface RecommendedPick {
  /** the app's name, as people know it */
  name: string;
  kind: PickKind;
  /** the app's names across sources (appKey): "github", "github-plugin" */
  keys: readonly string[];
}

/** Why a bot wants it, by kind: the row's grey line. */
export const PICK_WHY: Readonly<Record<PickKind, LocaleKey>> = {
  mail: "connectApps.recommended.why.mail",
  calendar: "connectApps.recommended.why.calendar",
  files: "connectApps.recommended.why.files",
  chat: "connectApps.recommended.why.chat",
  code: "connectApps.recommended.why.code",
  browser: "connectApps.recommended.why.browser",
  tickets: "connectApps.recommended.why.tickets",
  crm: "connectApps.recommended.why.crm",
  notes: "connectApps.recommended.why.notes",
  tasks: "connectApps.recommended.why.tasks",
  docs: "connectApps.recommended.why.docs",
  design: "connectApps.recommended.why.design",
  errors: "connectApps.recommended.why.errors",
  payments: "connectApps.recommended.why.payments",
};

/** The curated list, in order. */
export const RECOMMENDED_PICKS: readonly RecommendedPick[] = [
  { name: "Gmail", kind: "mail", keys: ["gmail"] },
  { name: "Outlook", kind: "mail", keys: ["outlook", "outlookexchange", "microsoft365", "office365", "m365"] },
  { name: "Google Calendar", kind: "calendar", keys: ["googlecalendar", "gcal"] },
  { name: "Calendly", kind: "calendar", keys: ["calendly"] },
  { name: "Google Drive", kind: "files", keys: ["googledrive"] },
  { name: "OneDrive", kind: "files", keys: ["onedrive", "sharepoint"] },
  { name: "Dropbox", kind: "files", keys: ["dropbox"] },
  { name: "Box", kind: "files", keys: ["box"] },
  { name: "Slack", kind: "chat", keys: ["slack"] },
  { name: "Microsoft Teams", kind: "chat", keys: ["microsoftteams", "teams"] },
  { name: "Zoom", kind: "chat", keys: ["zoom", "zoomplugin"] },
  { name: "Discord", kind: "chat", keys: ["discord"] },
  { name: "GitHub", kind: "code", keys: ["github", "githubplugin"] },
  { name: "GitLab", kind: "code", keys: ["gitlab"] },
  { name: "Playwright", kind: "browser", keys: ["playwright"] },
  { name: "Browser Use", kind: "browser", keys: ["browseruse"] },
  { name: "Chrome DevTools", kind: "browser", keys: ["chromedevtools"] },
  { name: "Atlassian", kind: "tickets", keys: ["atlassian", "jira"] },
  { name: "Linear", kind: "tickets", keys: ["linear"] },
  { name: "Zendesk", kind: "tickets", keys: ["zendesk"] },
  { name: "Intercom", kind: "tickets", keys: ["intercom"] },
  { name: "HubSpot", kind: "crm", keys: ["hubspot", "hubspotsales"] },
  { name: "Salesforce", kind: "crm", keys: ["salesforce"] },
  { name: "Notion", kind: "notes", keys: ["notion", "notionworkspace"] },
  { name: "Asana", kind: "tasks", keys: ["asana"] },
  { name: "Airtable", kind: "tasks", keys: ["airtable"] },
  { name: "Context7", kind: "docs", keys: ["context7", "context7plugin"] },
  { name: "Figma", kind: "design", keys: ["figma"] },
  { name: "Canva", kind: "design", keys: ["canva"] },
  { name: "Sentry", kind: "errors", keys: ["sentry"] },
  { name: "Stripe", kind: "payments", keys: ["stripe"] },
];

/** An account connector's reach, as the kind it covers. */
const CAPABILITY_KIND: Readonly<Record<ConnectorCapability, PickKind>> = {
  mail: "mail", calendar: "calendar", files: "files", sharepoint: "files", teams: "chat",
};

/** The keys an item answers to: its name, and a plugin's or app's id
 * without its marketplace. */
function itemKeys(item: Pick<PluginItem, "name" | "id">): string[] {
  return [appKey(item.name), appKey(item.id.split("@")[0] ?? "")].filter(Boolean);
}

/** The pick an app's name belongs to, if any. */
export function pickFor(names: readonly string[]): RecommendedPick | undefined {
  const keys = new Set(names.map(appKey).filter(Boolean));
  return RECOMMENDED_PICKS.find((pick) => pick.keys.some((key) => keys.has(key)));
}

/** What the person already has: names of what is installed or connected
 * (any scope, any account), and what their account connectors reach. */
export interface OwnedApps {
  names: readonly string[];
  capabilities?: readonly ConnectorCapability[];
}

export interface RecommendedRow {
  item: PluginItem;
  pick: RecommendedPick;
}

/** The recommendations, in order: of the curated list, what `candidates`
 * offers that the person can connect (`canConnect`) and does not have, by
 * name or by kind (a person with one mail app is not offered another).
 * One pick per kind first, in the list's order, then the others. */
export function recommendedPicks(
  candidates: readonly PluginItem[],
  owned: OwnedApps,
  canConnect: (item: PluginItem) => boolean = (item) => item.action !== null,
): RecommendedRow[] {
  const ownedKinds = new Set<PickKind>((owned.capabilities ?? []).map((capability) => CAPABILITY_KIND[capability]));
  const ownedKeys = new Set(owned.names.map(appKey).filter(Boolean));
  for (const pick of RECOMMENDED_PICKS) {
    if (pick.keys.some((key) => ownedKeys.has(key))) ownedKinds.add(pick.kind);
  }
  const found: RecommendedRow[] = [];
  const taken = new Set<string>();
  for (const pick of RECOMMENDED_PICKS) {
    if (ownedKinds.has(pick.kind)) continue;
    const item = candidates.find((candidate) => !candidate.installed && !taken.has(candidate.key)
      && canConnect(candidate) && itemKeys(candidate).some((key) => pick.keys.includes(key)));
    if (!item) continue;
    taken.add(item.key);
    found.push({ item, pick });
  }
  const firsts: RecommendedRow[] = [];
  const rest: RecommendedRow[] = [];
  const kinds = new Set<PickKind>();
  for (const row of found) {
    if (kinds.has(row.pick.kind)) rest.push(row);
    else {
      kinds.add(row.pick.kind);
      firsts.push(row);
    }
  }
  return [...firsts, ...rest];
}
