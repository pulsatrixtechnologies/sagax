// Section ids for Settings and the bot panel. A leaf: src/state/store.tsx
// imports the modules that name these ids, so the ids cannot live in the store.

/** A page of the app Settings dialog. */
export type AppSettingsSection =
  /** Who is signed in: the account row, About me, language and time zone,
   * and what General held (2026-10-28: Security and the vault are pages of
   * their own again). */
  | "account"
  | "general"
  | "memory"
  | "privacy"
  | "notifications"
  /** Security (2026-10-28): security keys and passkeys, the person's own
   * approval rules (Always allow, Always deny, Ask first) and their tool
   * access. */
  | "security"
  | "organization"
  | "appearance"
  | "experimental"
  /** Merged into "engines" (Models and voice) on 2026-10-14; still accepted
   * from old links and redirected (src/lib/settings-link.ts). */
  | "connections"
  | "connectedApps"
  | "decisionModel"
  /** Providers (2026-10-30): every account, key, server and model of this
   * computer that pays for a turn or a voice, in one list. */
  | "providers"
  /** Models (2026-10-28; "Models and voice" until then): engines, keys,
   * web search, image generation. */
  | "engines"
  /** Voice (2026-10-28, out of Models and voice): the voice engine, Live
   * calls, the microphone and the person's own voice keys. */
  | "voice"
  | "companion"
  | "computer"
  | "usage"
  /** Vault (2026-10-28, page of its own again): the person's credential
   * vault (logins, API keys and notes bots use without seeing them) and the
   * one-time card. The id stays "credentials" so old links keep working. */
  | "credentials"
  | "people"
  | "mail"
  | "activity"
  | "backups"
  /** Bring a shared Grok Bot in (port of OpenMausBot #3073). */
  | "import"
  | "workspaces"
  /** This app's updates and the pre-release channel (0.5.6; were in General). */
  | "updates"
  /** About this app (modal; last under App, like Grok Bot). */
  | "about"
  /** Pages a bot proposed and the person published (src/components/PublishedPages.tsx). */
  | "pages";

/** A page of the bot settings panel or the persona editor. */
export type BotSettingsSection =
  | "overview"
  /** The persona editor's Appearance: the mascot gallery and the picture sources. */
  | "appearance"
  /** The persona editor's What it does: the server's summary of what the
   * bot does, reaches and won't do, and the prompt preview. */
  | "summary"
  /** Deep link to the Details tab. */
  | "details"
  | "slack"
  | "soul"
  /** RULES.md: hard constraints loaded every turn (docs/bot-workspace.md). */
  | "rules"
  | "skills"
  | "memory"
  /** The whole bot workspace: SOUL.md, RULES.md, memory, docs/, skills. */
  | "files"
  | "routines"
  | "access"
  /** More > Computer. The Works on control. Not a row of the Computer tab. */
  | "worksOn"
  | "model"
  | "permissions"
  | "voice"
  | "visibility"
  | "sharing"
  | "history"
  | "usage";
