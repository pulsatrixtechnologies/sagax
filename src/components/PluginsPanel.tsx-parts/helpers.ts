import { t } from "@/lib/i18n";
import type { PluginItem } from "@/lib/plugins-model";
import { openExternalLink } from "@/lib/app-links";
import { GROK_CONNECTORS_URL } from "../../../shared/grok-cloud-connectors";

/** The GitHub plugin's page (2026-10-29), where the GitHub connection is:
 * the marketplace plugin named github, else one whose MCP server reads the
 * person's GitHub account; an installed one first. None: null. */
export function githubPluginKey(items: readonly PluginItem[]): string | null {
  const named = (item: PluginItem) => item.id.slice(0, item.id.lastIndexOf("@")) === "github";
  const reads = (item: PluginItem) => items.some((child) => child.parent === item.key && Boolean(child.githubAccount));
  const rank = (item: PluginItem) => (item.installed ? 0 : 2) + (named(item) ? 0 : 1);
  const found = items
    .filter((item) => item.kind === "plugin" && (named(item) || reads(item)))
    .sort((a, b) => rank(a) - rank(b));
  return found[0]?.key ?? null;
}

/** The label of a plugin's source, for Manage and the details. */
export function pluginSourceLabel(source: string): string {
  if (source === "manual") return t("connectApps.source.manual");
  if (source === "catalog") return t("connectApps.source.catalog");
  if (source === "grok") return t("connectApps.source.grok");
  if (source === "local") return t("connectApps.skill.createdLocally");
  return source;
}

/** Opens grok.com/connectors; the sentence to show when no path opens it. */
export async function openGrokConnectors(): Promise<string | null> {
  try {
    await openExternalLink(GROK_CONNECTORS_URL);
    return null;
  } catch {
    return t("connectorSetup.blocked");
  }
}

export function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
