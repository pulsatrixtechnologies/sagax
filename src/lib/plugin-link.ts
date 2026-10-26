// "Copy link to this plugin" (2026-10-21, parity with Grok Bot): the page a
// person can send to someone else about a plugin. A marketplace plugin: its
// marketplace's repository (owner/repo reads as GitHub). An MCP server: the
// catalog's documentation page when it is a reviewed one, else its own
// https address. Nothing for a connected app or a local server. Pure.
import { PLUGIN_CATALOG } from "../../shared/plugin-catalog";

export function pluginShareLink(input: { kind: string; marketplaceSource?: string; serverUrl?: string }): string | null {
  if (input.kind === "plugin" && input.marketplaceSource) {
    const source = input.marketplaceSource.trim();
    if (/^https:\/\//i.test(source)) return source.replace(/\.git$/i, "");
    if (/^[A-Za-z0-9][\w.-]*\/[\w.-]+$/.test(source)) return `https://github.com/${source.replace(/\.git$/i, "")}`;
    return null;
  }
  if (input.serverUrl && /^https:\/\//i.test(input.serverUrl)) {
    const entry = PLUGIN_CATALOG.find((candidate) => candidate.url === input.serverUrl || candidate.regions?.some((region) => region.url === input.serverUrl));
    return entry?.docsUrl ?? input.serverUrl;
  }
  return null;
}
