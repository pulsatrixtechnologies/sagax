// A person's preferences on an organization server (server mode): the
// appearance, language, notifications, mascot settings and sidebar layout
// that follow the PERSON from device to device. The renderer keeps them in
// localStorage under these exact keys (the modules that own them read them
// there), and on an organization server they are also kept per person on
// the server (server/user-preferences.ts, GET/PUT /api/me/preferences).
//
// Only these keys travel. Everything about one device or one window stays
// on that device: drafts, window and panel sizes, which bots float and where
// (always on top included), the mascot's mood and balloon, the Hibou 98
// assistant's position (omb.retro98.prefs), this device's voices
// (openmausbot.remote-voice.v1), the settings cards left open, caches and
// credentials.

export const USER_PREFERENCE_KEYS = [
  // appearance (the Hibou 98 switch goes with the skin it swaps)
  "omb-skin",
  // Auto (follow the system) and the last variant per skin family (src/lib/skin-families.ts)
  "omb-skin-mode",
  "omb-skin-tint",
  "omb-skin-depth",
  "omb-skin-texture",
  "omb-skin-variants",
  // the open bot's colour as the accent (src/lib/bot-accent.ts)
  "sagax.botAccent.v1",
  // 1:1 assistant bubbles wear the open bot's colour (ios BotBubble.swift). "1" is on; absent is off.
  "sagax.botBubble.v1",
  "omb-font",
  "omb-show-threads",
  // the bot panel's Suggestions card and All history row (src/lib/panel-visibility.ts)
  "sagax.showSuggestions.v1",
  "sagax.showAllHistory.v1",
  "omb.retro98.on",
  "omb.retro98.unlocked",
  "omb.retro98.previousSkin",
  // language (empty or absent: follow the system, then the server's default)
  "omb-language",
  // notifications
  "omb-notification-sounds",
  // which sound a notification plays (src/lib/notification-sound.ts)
  "sagax.notificationSound.v1",
  // Settings > Appearance > Accessibility (src/lib/accessibility-preferences.ts)
  "sagax.a11y.motion.v1",
  "sagax.a11y.contrast.v1",
  "sagax.a11y.textSize.v1",
  // Settings > Appearance > Mascots: painted HD art or the classic vector look (src/lib/hd-mascots-preference.ts). "on" | "off"; absent is on.
  "sagax.hdMascots.v1",
  // the desktop mascot's behavior (fly away during tasks, activity level)
  "omb.floatingBots.prefs.v1",
  // sidebar layout
  "openmausbot.sidebarDensity",
  "openmausbot.sidebarExpandedDensity.v1",
  "openmausbot.sidebarCollapsedSections.v1",
  "openmausbot.sidebarSectionOrder.v1",
  "openmausbot.sidebarAttentionPinned.v1",
  // what the person hid from their sidebar (src/lib/sidebar-hidden.ts)
  "sagax.sidebarHidden.v1",
  // the person's own sidebar sections (src/lib/personal-sections.ts)
  "sagax.sidebarSections.v1",
  // Settings > Appearance > Sidebar: keep unassigned people in their own
  // automatic section (src/lib/sidebar-people-apart-preference.ts). "on" | "off";
  // absent is on (#1661).
  "sagax.sidebarPeopleApart.v1",
  // the Team map's layout: team positions and the personal card order
  // (src/lib/team-canvas.ts; solo servers keep it per workspace instead)
  "sagax.teamCanvasPositions.v1",
  "sagax.teamCanvasBotOrder.v1",
  // privacy
  "omb-analytics-opt-out",
  // Simple or Advanced (src/lib/interface-mode.ts). "simple" | "advanced".
  "sagax.interfaceMode.v1",
  // the one-time move from Simple to Advanced was done for this person (an
  // ISO date; src/lib/interface-mode.ts, server/user-preferences.ts)
  "sagax.advancedModeMigratedAt.v1",
  // where bots work for this person (organization server: their computer
  // through the desktop app, or their server environment; shared/bot-workplace.ts)
  "sagax.botWorkplace.v1",
  // Computer place labels (Cloud, desktops, Browser, enrolled hosts)
  // (shared/place-labels.ts): the person's own names for their places.
  "sagax.placeLabels.v1",
  // voice mode: the xAI voice, speed and language (shared/voice-mode.ts)
  "omb.voiceMode.v1",
  // bot replies without em or en dashes, "on" | "off"; absent follows the
  // language, on for French (shared/voice-dashes.ts)
  "sagax.voiceDashes.v1",
  // what a message sent to a busy conversation does (shared/parallel-tasks.ts)
  "sagax.busySend.v1",
  // a bot's reply grows in its bubble as it is written, "on" | "off"; absent
  // is on (src/lib/stream-replies-preference.ts, ios StreamReplies)
  "sagax.streamReplies.v1",
  // single stream: hours away or quiet before a return opens a fresh topic
  // (shared/fresh-topic.ts; "0" never)
  "sagax.freshTopicAfter.v1",
  // Settings > Privacy: send read receipts in conversations between people
  // (server/read-receipts.ts). "off" turns them off both ways; absent is on.
  "sagax.readReceipts.v1",
  // privacy: "Show when I am online" ("0" hides; shared/presence.ts)
  "sagax.presenceVisible.v1",
  // the Automations page's scope and filters, per person (src/lib/routine-scope-prefs.ts)
  "sagax.routineScope.v1",
  // routine editor "More options" disclosure open ("1") or collapsed ("0"/absent)
  // (src/lib/routine-editor-more-pref.ts); Grok-simple default is collapsed
  "sagax.routineEditorMore.v1",
  // the models starred in the composer's model menu (src/lib/model-favorites.ts)
  "sagax.modelFavorites.v1",
  // the first-run step "connect your own engine" on an organization server
  // was seen (an ISO date; src/lib/org-engine-readiness.ts)
  "sagax.orgEngineSetupSeen.v1",
] as const;

export type UserPreferenceKey = (typeof USER_PREFERENCE_KEYS)[number];
export type UserPreferences = Partial<Record<UserPreferenceKey, string>>;

/** One value: the string a module stored, bounded. */
export const MAX_PREFERENCE_VALUE = 8 * 1024;

const keySet: ReadonlySet<string> = new Set(USER_PREFERENCE_KEYS);

export function isUserPreferenceKey(key: unknown): key is UserPreferenceKey {
  return typeof key === "string" && keySet.has(key);
}

/** Keep the known keys with string values, drop everything else. */
export function cleanUserPreferences(input: unknown): UserPreferences {
  const out: UserPreferences = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isUserPreferenceKey(key) && typeof value === "string" && value.length <= MAX_PREFERENCE_VALUE) out[key] = value;
  }
  return out;
}
