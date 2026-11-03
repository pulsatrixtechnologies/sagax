// Browse Bots (src/components/bot-catalog/, its own centred window again
// since 619b200c8; Connect apps' Bots tab embeds the same pane) is the one
// place for templates. New bot's "Browse templates",
// the bot wizard and an install link open that tab on its Templates
// section. Pure, for tests.
import { openBotCatalog, type Action } from "@/state/store";

/** Where a person asked for templates. */
export type TemplatesEntry =
  /** Connect apps: Browse Bots' Templates (it closes Connect apps). */
  | "connectApps"
  /** New bot: "Browse templates" beside Starting role (it closes New bot). */
  | "newBot"
  /** The bot creation wizard: "Browse templates" under Other ways to start (it closes the wizard). */
  | "botWizard"
  /** An install link from outside (openmaus://, a team's address). */
  | "installLink";

/** The actions to dispatch, in order: close what the entry sits in, then
 * open the Browse Bots window on Templates (with the link to preview, if any). */
export function templatesEntryActions(entry: TemplatesEntry, installUrl?: string): Action[] {
  const open = openBotCatalog({ section: "templates", ...(entry === "installLink" && installUrl ? { installUrl } : {}) });
  if (entry === "connectApps") return [{ type: "togglePlugins", open: false }, open];
  if (entry === "newBot") return [{ type: "toggleNewBot", open: false }, open];
  if (entry === "botWizard") return [{ type: "closeBotWizard" }, open];
  return [open];
}
