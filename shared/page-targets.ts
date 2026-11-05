/** Page / artifact publish targets (#2048).
 *
 * A request to create a page or artifact offers the surfaces that can host
 * it. Targets come from this registry (not a hard-coded UI list). Availability
 * is filtered per bot, engine and person; a single available target, or a
 * remembered bot default that is still available, skips the choice card.
 */

import type { AskQuestionOption } from "./ask-question.ts";

/** Built-in target ids. Extra targets may be registered at runtime. */
export const PAGE_TARGET_IDS = ["sagax_page", "sagax_artifact", "claude_artifact"] as const;
export type BuiltInPageTargetId = (typeof PAGE_TARGET_IDS)[number];
export type PageTargetId = string;

/** What the person asked for: narrows which targets are relevant. */
export type PageTargetIntent = "page" | "artifact" | "any";

/** Lucide icon names the card knows how to draw. Unknown names fall back. */
export type PageTargetIcon = "file-text" | "layout-dashboard" | "sparkles" | "box";

export interface PageTargetDefinition {
  id: PageTargetId;
  /** Agents tool the bot calls once this target is chosen. */
  tool: string;
  icon: PageTargetIcon;
  /** English name (i18n keys mirror these under pageTarget.*). */
  name: string;
  /** One line: share, edit, offline, etc. */
  description: string;
  /** Intents this target answers. Absent = any. */
  intents?: readonly PageTargetIntent[];
}

export interface PageTargetAvailability {
  /** Pages (propose_page) are offered in this conversation. */
  pages?: boolean;
  /** Sagax artifacts (save_artifact) are offered. */
  artifacts?: boolean;
  /** Claude official artifacts through the person's own Claude account. */
  claudeArtifacts?: boolean;
  /** Why Claude artifacts are off, when claudeArtifacts is false. */
  claudeReason?: string;
  /** Extra per-id overrides for registered targets (true = on, false = off). */
  extra?: Record<string, boolean | { available: boolean; reason?: string }>;
}

export interface PageTargetOffer {
  id: PageTargetId;
  tool: string;
  icon: PageTargetIcon;
  name: string;
  description: string;
  available: boolean;
  /** Present when available is false. */
  reason?: string;
}

export interface PageTargetResolution {
  available: PageTargetOffer[];
  unavailable: PageTargetOffer[];
  /** The target to use without a card, when one is decided. */
  auto?: PageTargetOffer;
  /** Why no card is shown when auto is set. */
  autoReason?: "single" | "default";
}

const BUILT_INS: readonly PageTargetDefinition[] = [
  {
    id: "sagax_page",
    tool: "propose_page",
    icon: "file-text",
    name: "Sagax page",
    description: "Shareable link the person publishes; others can open it outside Sagax.",
    intents: ["page"],
  },
  {
    id: "sagax_artifact",
    tool: "save_artifact",
    icon: "layout-dashboard",
    name: "Sagax artifact",
    description: "Kept inside Sagax for this person; can refresh itself, no public link.",
    intents: ["artifact"],
  },
  {
    id: "claude_artifact",
    tool: "claude_artifact",
    icon: "sparkles",
    name: "Claude artifact",
    description: "Official claude.ai artifact through the person's own Claude account.",
    intents: ["page", "artifact"],
  },
];

/** Mutable registry: built-ins first, then any target registered later. */
const registry: PageTargetDefinition[] = [...BUILT_INS];

/** Built-in definitions (copy). Tests and settings use this. */
export function builtInPageTargets(): readonly PageTargetDefinition[] {
  return BUILT_INS.slice();
}

/** Every registered target, built-ins then extras. */
export function listPageTargets(): readonly PageTargetDefinition[] {
  return registry.slice();
}

/** Add or replace a target by id. Built-ins may be replaced for tests. */
export function registerPageTarget(target: PageTargetDefinition): void {
  const id = String(target.id ?? "").trim();
  if (!id) throw new Error("page target id is required");
  if (!String(target.tool ?? "").trim()) throw new Error("page target tool is required");
  const entry: PageTargetDefinition = {
    id,
    tool: String(target.tool).trim(),
    icon: target.icon ?? "box",
    name: String(target.name ?? id).trim() || id,
    description: String(target.description ?? "").trim(),
    ...(target.intents?.length ? { intents: target.intents } : {}),
  };
  const at = registry.findIndex((row) => row.id === id);
  if (at >= 0) registry[at] = entry;
  else registry.push(entry);
}

/** Test helper: drop every non-built-in and restore built-in rows. */
export function resetPageTargetRegistry(): void {
  registry.length = 0;
  registry.push(...BUILT_INS);
}

function matchesIntent(target: PageTargetDefinition, intent: PageTargetIntent): boolean {
  if (intent === "any") return true;
  const intents = target.intents ?? ["any"];
  return intents.includes(intent) || intents.includes("any");
}

function builtInAvailability(id: PageTargetId, availability: PageTargetAvailability): { available: boolean; reason?: string } {
  if (id === "sagax_page") {
    return availability.pages === false
      ? { available: false, reason: "Pages are not available in this conversation." }
      : { available: true };
  }
  if (id === "sagax_artifact") {
    return availability.artifacts === false
      ? { available: false, reason: "Artifacts are not available for this bot." }
      : { available: true };
  }
  if (id === "claude_artifact") {
    if (availability.claudeArtifacts === true) return { available: true };
    return {
      available: false,
      reason: availability.claudeReason?.trim() || "Claude artifacts need the person's Claude account signed in.",
    };
  }
  return { available: true };
}

function offerFor(target: PageTargetDefinition, availability: PageTargetAvailability): PageTargetOffer {
  const extra = availability.extra?.[target.id];
  let available = true;
  let reason: string | undefined;
  if (extra === false) {
    available = false;
    reason = "Not available for this bot.";
  } else if (extra && typeof extra === "object") {
    available = extra.available;
    reason = extra.available ? undefined : (extra.reason?.trim() || "Not available for this bot.");
  } else if (PAGE_TARGET_IDS.includes(target.id as BuiltInPageTargetId)) {
    const built = builtInAvailability(target.id, availability);
    available = built.available;
    reason = built.reason;
  }
  return {
    id: target.id,
    tool: target.tool,
    icon: target.icon,
    name: target.name,
    description: target.description,
    available,
    ...(reason ? { reason } : {}),
  };
}

/** Resolve which targets to show, and whether a card is needed. */
export function resolvePageTargets(input: {
  intent?: PageTargetIntent;
  availability?: PageTargetAvailability;
  /** Bot-remembered default target id. */
  defaultId?: string | null;
}): PageTargetResolution {
  const intent = input.intent ?? "any";
  const availability = input.availability ?? {};
  const offers = listPageTargets()
    .filter((target) => matchesIntent(target, intent))
    .map((target) => offerFor(target, availability));
  const available = offers.filter((row) => row.available);
  const unavailable = offers.filter((row) => !row.available);
  if (available.length === 1) {
    return { available, unavailable, auto: available[0], autoReason: "single" };
  }
  const defaultId = typeof input.defaultId === "string" ? input.defaultId.trim() : "";
  if (defaultId) {
    const remembered = available.find((row) => row.id === defaultId);
    if (remembered) return { available, unavailable, auto: remembered, autoReason: "default" };
  }
  return { available, unavailable };
}

/** Whether the choice card should be drawn for this resolution. */
export function shouldShowPageTargetCard(resolution: PageTargetResolution): boolean {
  return !resolution.auto && resolution.available.length >= 2;
}

/** Card options for QuestionSheet / AskUserQuestion (label + description + id). */
export function pageTargetQuestionOptions(
  offers: readonly PageTargetOffer[],
  /** When true, include unavailable rows (greyed) with their reason as description. */
  includeUnavailable = false,
): AskQuestionOption[] {
  const rows = includeUnavailable ? offers : offers.filter((row) => row.available);
  return rows.map((row) => ({
    label: row.name,
    description: row.available ? row.description : (row.reason || row.description),
    id: row.id,
    ...(row.icon ? { icon: row.icon } : {}),
    ...(row.available ? {} : { disabled: true }),
  }));
}

/** Stable ids accepted as a bot.pageTargetDefault value (null clears). */
export function parsePageTargetDefault(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: "pageTargetDefault must be a target id string or null" };
  const id = value.trim();
  if (!id || id.length > 64) return { ok: false, error: "pageTargetDefault must be a target id of at most 64 characters" };
  if (!/^[\w.-]+$/.test(id)) return { ok: false, error: "pageTargetDefault must be a target id" };
  return { ok: true, value: id };
}

/** Map a chosen id (or a human label) back to an offer. */
export function matchPageTargetChoice(
  choice: string,
  offers: readonly PageTargetOffer[],
): PageTargetOffer | undefined {
  const text = choice.trim();
  if (!text) return undefined;
  return offers.find((row) => row.id === text || row.name === text || row.tool === text);
}

/** Tool result text when a target is already decided (no card). */
export function pageTargetAutoResult(offer: PageTargetOffer, reason: "single" | "default"): string {
  const why = reason === "single"
    ? "Only one publish target is available for this bot and conversation."
    : "Using this bot's remembered default publish target.";
  return `${why} Target: ${offer.id} (${offer.name}). Call ${offer.tool} now with the page or artifact content. Do not ask again.`;
}

/** Tool result text when the choice card is waiting. */
export function pageTargetCardResult(offers: readonly PageTargetOffer[]): string {
  const ids = offers.filter((row) => row.available).map((row) => `${row.id}→${row.tool}`).join(", ");
  return `The publish-target choice card is on the person's screen (${ids}). End your turn now with no further text: their pick arrives as their next message as the target id (for example sagax_page). Then call that target's tool. If they checked "Always use this choice", the id is also saved as this bot's default.`;
}

/** Durable payload on the choice card (OptionCardData.pageTargetChoice). */
export interface PageTargetChoiceCardData {
  version: 1;
  /** Offers shown on the card (available first). */
  targets: Array<{ id: string; tool: string; name: string; icon?: PageTargetIcon }>;
}
