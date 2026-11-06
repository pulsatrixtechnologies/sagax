// The bot editor ("Edit bot"): the bot's profile page
// (bot-profile/BotProfilePage.tsx, Grok Bot's layout) filling the main panel
// in place of the chat (#2136); X or Escape goes back to the bot's chat. This
// module keeps the store wiring (store action openPersonaEditor:
// "..." > Edit bot, a click on the mascot, the bot panel's gear, a deep link)
// and the section names the rest of the app imports.
import { useEffect } from "react";

import { useStore, type BotSettingsSection } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { BOT_SECTIONS } from "../bot-settings/sections";
import {
  PERSONA_CATEGORIES,
  PERSONA_GROUPS,
  isPersonaCategory,
  type PersonaCategory,
  type PersonaGroup,
} from "@/lib/persona-sections";
import { BotProfilePage } from "../bot-profile/BotProfilePage";

export { PERSONA_CATEGORIES, PERSONA_GROUPS, isPersonaCategory, type PersonaCategory, type PersonaGroup };

const ENTRY = new Map(BOT_SECTIONS.map((entry) => [entry.id, entry]));

/** A section's name, as the editor names it. */
export function personaCategoryLabel(id: BotSettingsSection): string {
  const entry = ENTRY.get(id);
  if (!entry) return id;
  return entry.labelKey ? t(entry.labelKey) : entry.label;
}

/** A group's grey heading. */
export function personaGroupLabel(id: PersonaGroup): string {
  return t(`persona.group.${id}` as LocaleKey);
}

export function PersonaEditorModal() {
  const { state, dispatch } = useStore();
  const editor = state.personaEditor;
  const bot = editor ? state.bots.find((candidate) => candidate.id === editor.botId) : undefined;
  // A bot deleted while its profile is open closes the profile.
  const gone = editor !== null && bot === undefined;
  useEffect(() => { if (gone) dispatch({ type: "closePersonaEditor" }); }, [gone, dispatch]);
  if (!editor || !bot) return null;
  // Closing lands on this bot's chat, whichever conversation was open before.
  const close = () => {
    if (state.selectedId === bot.id) dispatch({ type: "closePersonaEditor" });
    else dispatch({ type: "select", id: bot.id });
  };
  return <BotProfilePage key={bot.id} bot={bot} section={editor.section} onClose={close} />;
}
