import { Archive, AudioLines, Bell, Coins, Download, FlaskConical, Import, Info, KeyRound, Monitor, Palette, Plug, ShieldCheck, Terminal, User, Building2 } from "lucide-react";
import type { AppSettingsSection } from "@/state/store";
import type { LocaleKey } from "@/locales";
import { t } from "@/lib/i18n";
import { settingsTextMatches } from "@/lib/settings-search";

/** Search words of the cards moved from General > Advanced to Organization
 * (2026-10-15). On a desktop with no server they stay in General > Advanced,
 * and General matches them there (sectionMatches `extra`). */
export const ORGANIZATION_ADVANCED_KEYWORDS = ["routines", "conversation", "schedule", "mcp", "timeout", "group turns", "rooms"];

/** The headings of the settings nav (2026-10-16): Cursor Settings and
 * the reference design keep a short rail in a few groups; Sagax names its groups. A
 * heading shows while one of its pages does. Automations lives in the
 * avatar menu, not here (2026-10-16). */
export type SettingsNavGroup = "you" | "ai" | "workspace" | "app";

export const NAV_GROUPS: Array<{ id: SettingsNavGroup; labelKey: LocaleKey }> = [
  { id: "you", labelKey: "settings.nav.you" },
  { id: "ai", labelKey: "settings.nav.ai" },
  { id: "workspace", labelKey: "settings.nav.workspace" },
  { id: "app", labelKey: "settings.nav.app" },
];

export const SECTIONS: Array<{
  id: AppSettingsSection;
  labelKey: LocaleKey;
  /** The nav heading it sits under (NAV_GROUPS). */
  group: SettingsNavGroup;
  icon: typeof User;
  keywords: string[];
}> = [
  // 2026-10-16: in the order of their nav groups (NAV_GROUPS), as Cursor
  // Settings groups its rail: you, AI, the workspace, this app last.
  // 0.5.6: General is laid out as the reference design's (Account, Appearance,
  // System); Updates is a page of its own, as there.
  // 2026-10-26: Account comes first. 2026-10-28: Account keeps the account
  // (who is signed in, name, avatar, About me, language and time zone) and
  // what General held; Security and Vault are pages of their own again.
  { id: "account", group: "you", labelKey: "settings.section.account", icon: User, keywords: ["account", "compte", "profile", "profil", "name", "nom", "email", "courriel", "copy email", "sign out", "se déconnecter", "déconnexion", "label", "avatar", "photo", "about me", "à propos de moi", "open at login", "ouvrir à la connexion", "suggestions", "suggested", "memory", "effort", "new bots", "reasoning", "threads", "parallel", "concurrency", "cleanup", "retention", "event log", "event-log", "log size", "automatic recovery", "backup model", "fallback", "advanced", "avancé", "diagnostics", "diagnostic", "journaux", "logs", "download logs", "télécharger les journaux", "feedback", "send feedback", "commentaires", "envoyer des commentaires", "nettoyage", "people's tool access", "language", "langue", "time zone", "timezone", "fuseau horaire", "fuseau", "tour", "tours", "visite", "welcome", "bienvenue", "system", "système", "server", "serveur"] },
  // 2026-10-28: Security, the person's own: security keys and passkeys, the
  // approval rules they saved (Always allow, Always deny, Ask first, paged)
  // and their tool access. Vault: the credential vault and the one-time card.
  { id: "security", group: "you", labelKey: "settings.section.security", icon: ShieldCheck, keywords: ["security", "sécurité", "security key", "security keys", "clé de sécurité", "clés de sécurité", "passkey", "clé d'accès", "yubikey", "webauthn", "touch id", "face id", "step-up", "sensitive", "sensibles", "approvals", "approbations", "approval level", "niveau d'approbation", "approval rules", "règles d'approbation", "rules", "règles", "always allow", "toujours permettre", "always deny", "toujours refuser", "ask first", "demander d'abord", "deny", "refuser", "tool access", "accès aux outils", "my tool access", "mon accès aux outils", "grants", "autorisations"] },
  { id: "credentials", group: "you", labelKey: "settings.section.vault", icon: KeyRound, keywords: ["vault", "coffre", "your vault", "votre coffre", "credentials", "identifiants", "password", "mot de passe", "login", "logins", "connexions", "totp", "2fa", "one-time code", "code à usage unique", "1password", "api key", "clé api", "api keys", "clés api", "notes", "note", "autofill", "remplissage", "import", "importer", "export", "exporter", "add an item", "ajouter un élément", "one-time card", "carte à usage unique", "single-use", "shop pay", "link", "card", "carte", "purchase", "achat", "achats", "payments", "paiements", "wallet", "portefeuille", "history", "historique"] },
  { id: "appearance", group: "you", labelKey: "settings.section.appearance", icon: Palette, keywords: ["skin", "theme", "thème", "variant", "variante", "light", "clair", "dark", "sombre", "auto", "appearance", "advanced", "simple", "mode", "tools", "tool calls", "threads", "show threads", "hide threads", "sidebar", "hidden", "hide", "show", "density", "compact", "comfortable", "avatars", "display", "run", "this run", "run card", "commands", "mascot", "owl", "desktop", "fly", "floating", "app icon", "dock", "icon", "taskbar", "providers", "sign-in", "fournisseurs", "connexion", "send", "enter", "return", "shift+enter", "ctrl+enter", "cmd+enter", "⌘+enter", "new line", "keyboard", "ime", "japanese", "font", "police", "accessibility", "accessibilité", "reduce motion", "motion", "animations", "contrast", "contraste", "text size", "taille du texte", "zoom", "hardware acceleration", "accélération matérielle", "gpu", "spell check", "spellcheck", "orthographe", "correcteur", "interface", "inspector", "inspecteur", "logo", "masqués", "mascottes", "icône", "barre latérale", "conversations", "desktop", "bureau"] },
  // 2026-10-14: Privacy is a card of this page on an organization server.
  { id: "notifications", group: "you", labelKey: "settings.section.notifications", icon: Bell, keywords: ["notifications", "notification", "sound", "sounds", "notification sound", "son de notification", "tick", "tic", "carillon", "chime a", "chime b", "blip", "mute", "silent", "chime", "alert", "alerts", "banner", "badge", "dock", "app icon", "icône", "unread", "nudge", "wizz", "shake", "secousse", "son", "persistent", "stay", "privacy", "read receipts", "seen", "vu", "confidentialité", "accusés de lecture", "presence", "online", "away", "offline", "last seen", "status", "en ligne", "absent", "hors ligne", "privacidade", "alertes", "on screen", "à l'écran"] },
  // Models (2026-10-14 as Models and voice: Integrations and Models and
  // accounts in one page; Connected apps and Decision model are cards of
  // it). 2026-10-28: Voice is a page of its own; every key stays in Models.
  // 2026-10-30: Providers, every account, key and server in one list (lot 1 of "Providers, models and voice")
  { id: "providers", group: "ai", labelKey: "settings.section.providers", icon: Plug, keywords: ["providers", "fournisseurs", "model providers", "accounts", "comptes", "claude", "codex", "grok", "cli", "sign in", "connexion", "subscription", "abonnement", "keys", "clés", "api", "api key", "api keys", "xai", "mistral", "cerebras", "router", "openrouter", "base url", "openai", "anthropic", "groq", "opencode", "provider", "fournisseur", "elevenlabs", "fish audio", "azure", "foundry", "compatible", "server", "serveur", "local models", "modèles locaux", "this computer", "cet ordinateur", "needs setup", "à configurer", "to connect", "à connecter", "view as a member", "voir comme un membre", "connectors", "connecteurs", "claude.ai", "cursor", "cloud agents", "cloud coding agents", "voice keys", "clés de voix"] },
  { id: "engines", group: "ai", labelKey: "settings.section.models", icon: Terminal, keywords: ["models", "modèles", "engines", "moteurs", "connections", "integrations", "intégrations", "image", "avatar", "box", "vps", "decision", "jev", "typesafe", "routing", "auto", "who answers", "auto model", "modèle auto", "image provider", "fournisseur d'images", "génération d'images", "web search", "recherche web", "brave", "exa", "firecrawl", "searxng", "bot models", "modèles des bots", "bulk", "defaults for new bots", "défauts des nouveaux bots", "who pays", "qui paie", "effort"] },
  { id: "voice", group: "ai", labelKey: "settings.section.voice", icon: AudioLines, keywords: ["voice", "voix", "tts", "speech", "parole", "elevenlabs", "fish", "fish audio", "chatterbox", "grok voice", "voice engine", "moteur de voix", "live call", "live calls", "appels en direct", "read replies", "hang up", "gpt-live", "voice keys", "clés de voix", "microphone", "micro", "audio", "input device", "entrée audio"] },
  // 2026-10-14: Memory is a card of this page (it was its own section).
  { id: "organization", group: "workspace", labelKey: "settings.section.organization", icon: Building2, keywords: ["company", "organization", "organisation", "sign in", "enroll", "managed", "models", "disconnect", "workspace", "cloud", "hosted", "vps", "server", "servers", "connect", "pair", "switch", "local", "memory", "obsidian", "vault", "sync", "git", "perspicax", "mémoire", "cache", "pending", "domain", "dns", "caddy", "full access", "accès complet", "approvals", "approbations", "waiting for an admin", "en attente", "people from before", "rattacher", "invite", "inviter", "invitation", "people", "personnes", "this computer", "cet ordinateur", "serveurs", "oublier", "forget", ...ORGANIZATION_ADVANCED_KEYWORDS] },
  { id: "computer", group: "workspace", labelKey: "settings.section.computer", icon: Monitor, keywords: ["computer", "local vm", "vm", "virtual", "desktop", "ordinateur", "your computer", "votre ordinateur", "other computers", "autres ordinateurs", "rename", "renommer", "remove computer", "retirer", "network", "réseau", "traffic", "trafic", "server environment", "environnement serveur", "reset", "réinitialiser", "repair", "réparer", "update", "mise à jour", "maintenance", "entretien", "disk", "disque", "disk saver", "économiseur de disque", "cache", "clean", "nettoyer"] },
  { id: "usage", group: "workspace", labelKey: "settings.section.usage", icon: Coins, keywords: ["tokens", "cost", "billing", "plan", "forfait", "coût", "usage", "spend", "this month", "ce mois-ci", "last 30 days", "30 derniers jours", "by bot", "par bot", "by model", "par modèle", "renews", "renouvelle", "sagax business"] },
  // 2026-10-15: People and Installations are hidden in the app, like Email,
  // Activity and Pair devices (settings-sections.ts HIDDEN).
  { id: "backups", group: "workspace", labelKey: "settings.section.backups", icon: Archive, keywords: ["export", "import", "restore", "full backup", "password", "recovery", "backup", "sauvegarde", "exporter", "restaurer", "replace", "remplacer", "mot de passe"] },
  // 2026-10-19: a shared Grok Bot comes in here (port of OpenMausBot #3073).
  { id: "import", group: "workspace", labelKey: "settings.section.import", icon: Import, keywords: ["import", "importer", "grok", "grok bot", "x.ai", "share link", "lien de partage", "template", "modèle"] },
  // 0.5.6: this app's updates and the pre-release channel (were in General
  // and General > Advanced). Shown where the desktop app answers.
  { id: "updates", group: "app", labelKey: "settings.updates.title", icon: Download, keywords: ["updates", "update", "version", "mise à jour", "mises à jour", "prerelease", "pre-release", "beta", "bêta", "restart"] },
  { id: "experimental", group: "app", labelKey: "settings.section.experimental", icon: FlaskConical, keywords: ["early", "preview", "learn", "skill", "authoring", "browser", "profiles", "experimental", "expérimental", "data window", "fenêtre data", "decision model", "modèle de décision", "compétences", "navigateur", "unavailable", "indisponible", "phone calls", "appels téléphoniques", "callback number", "numéro de rappel", "do not call", "ne pas appeler"] },
  // About: last under App (like Grok Bot). Opens the centred About modal.
  { id: "about", group: "app", labelKey: "sidebar.menu.about", icon: Info, keywords: ["about", "à propos", "version", "license", "licence", "github", "documentation", "docs", "release notes", "notes de version", "sagax", "openmausbot"] },
];

/** Former sections that are a card of another page now (2026-10-14), by the
 * page that holds them. Each keeps its own visibility rules: the card shows
 * where the section would have, and its page shows when the card does. */
export const HOSTED_CARDS: Partial<Record<AppSettingsSection, AppSettingsSection[]>> = {
  engines: ["decisionModel"],
  notifications: ["privacy"],
  organization: ["memory"],
};

/** Collapsible cards a search opens: a match on these words means the person
 * is looking for what the card holds, so it should not stay folded. */
export const CARD_KEYWORDS: Record<string, string[]> = {
  "general.aboutMe": ["about me"],
  "myApprovalRules": ["always allow", "always deny", "ask first", "approval rules", "règles d'approbation"],
  "general.threadCleanup": ["cleanup", "retention", "event log", "event-log", "log size"],
  "organization.mcpCalls": ["mcp", "timeout", "tool call"],
  "connections.integrations": ["box", "vps"],
  "connections.image": ["image", "avatar", "gpt image"],
  "providers.toConnect": ["needs setup", "à configurer", "to connect", "à connecter", "kimi", "droid", "qwen", "hermes", "cline", "antigravity"],
  "voice.advanced": ["live call", "read replies", "hang up", "gpt-live"],
  "companion.domain": ["domain", "dns", "caddy"],
  "engines.decisionModel": ["decision", "jev", "typesafe"],
  "connections.cloudAgents": ["cursor", "cloud agent", "cloud coding"],
  "connections.webSearch": ["web search", "recherche web", "brave", "exa", "parallel", "firecrawl", "searxng"],
  "usage.breakdown": ["by bot", "by model", "par bot", "par modèle"],
  "organization.memory": ["obsidian", "vault"],
  "backups.import": ["import", "restore", "restaurer"],
};

export function cardsMatching(query: string): string[] {
  if (query.length < 3) return [];
  return Object.entries(CARD_KEYWORDS)
    .filter(([, words]) => words.some((word) => word.includes(query)))
    .map(([id]) => id);
}

/** Sections an organization server (Perspicax) leaves out: its mail is
 * managed in the Perspicax admin console. A solo server keeps Email: it
 * sends its own sign-in codes and invitations. */
export function organizationHidesSection(id: AppSettingsSection, organization: boolean): boolean {
  // Privacy holds read receipts between people, which exist there only.
  // (A person's own GitHub is in Connect apps > Sources, their MCP servers in Providers.)
  return organization ? id === "mail" : id === "privacy";
}

/** Sections whose every control writes the installation. Hidden (not greyed)
 * when the viewer cannot edit it. Computer stays for an organization member:
 * their own server environment is not an installation computer. Usage stays
 * for everyone (2026-10-15): it shows the person's own usage only
 * (GET /api/me/usage). */
export function memberHidesSection(id: AppSettingsSection, input: {
  editConfig: boolean;
  manageComputers: boolean;
  manageBackups: boolean;
  organization: boolean;
  /** server.experimental (implied by server.settings). Defaults to editConfig
   * for an older server that sends no permission list. */
  manageExperimental?: boolean;
  /** Organization server (#1098): the viewer's own Experimental switches. */
  personalSettings?: boolean;
}): boolean {
  // Experimental is its own delegable right (server.experimental): a member an
  // admin gave it sees the section without the rest of the installation.
  if (id === "experimental") return !(input.manageExperimental ?? input.editConfig) && input.personalSettings !== true;
  if (id === "decisionModel" || id === "workspaces") return !input.editConfig;
  if (id === "backups" || id === "import") return !input.manageBackups;
  if (id === "computer") return !input.manageComputers && !input.organization;
  return false;
}

/** Settings > Memory needs the desktop app's main process (the vault is a
 * folder on this computer). */
export function orgMemoryAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.ogb?.orgMemory);
}

/** Published pages left Settings for Connect apps > Pages (2026-10-26). A
 * search still finds them, as one entry that opens them there. */
export const PUBLISHED_PAGES_KEYWORDS = ["pages", "published", "publiées", "canvas", "canevas", "share", "partager", "link", "lien", "revoke", "révoquer", "expiry", "expiration", "site", "html", "markdown"];

export function publishedPagesMatch(query: string): boolean {
  if (!query.trim()) return false;
  return [t("settings.section.pages"), ...PUBLISHED_PAGES_KEYWORDS].some((part) => settingsTextMatches(part, query));
}

export function sectionMatches(section: (typeof SECTIONS)[number], query: string, extra: string[] = []): boolean {
  if (!query.trim()) return true;
  return [t(section.labelKey), ...section.keywords, ...extra].some((part) => settingsTextMatches(part, query));
}

