import type { LocaleKey } from "@/locales";

// Literal catalog keys for the built-in publish targets, so the unread-key
// scans (which cannot follow a template) see that these strings are read.
const PAGE_TARGET_KEYS: Record<string, { name: LocaleKey; description: LocaleKey }> = {
  sagax_page: { name: "pageTarget.sagax_page.name", description: "pageTarget.sagax_page.description" },
  sagax_artifact: { name: "pageTarget.sagax_artifact.name", description: "pageTarget.sagax_artifact.description" },
  claude_artifact: { name: "pageTarget.claude_artifact.name", description: "pageTarget.claude_artifact.description" },
};

/** Catalog keys of a publish target, or null for a target the catalog does not name. */
export function pageTargetKeys(id: string): { name: LocaleKey; description: LocaleKey } | null {
  return Object.hasOwn(PAGE_TARGET_KEYS, id) ? PAGE_TARGET_KEYS[id]! : null;
}
