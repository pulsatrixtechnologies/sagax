import { Archive, AudioLines, Bell, Code2, Coins, Download, Info, KeyRound, LockKeyhole, Monitor, Palette, Plug, Settings2, ShieldCheck, Terminal, User, Building2 } from "lucide-react";
import type { AppSettingsSection } from "@/state/store";
import type { LocaleKey } from "@/locales";
import { t } from "@/lib/i18n";
import { settingsTextMatches } from "@/lib/settings-search";

/** Search words of the cards moved from General > Advanced to Organization
 * (2026-10-15). On a desktop with no server they stay in General > Advanced,
 * and General matches them there (sectionMatches `extra`). #2636: the two
 * timeouts (mcp, timeout, group turns, rooms) are on Developer now. */
export const ORGANIZATION_ADVANCED_KEYWORDS = ["routines", "conversation", "schedule"];

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
  /** The page's one-line sentence, drawn by the modal under the title (#2080).
   * About has none: it opens the centred About window, not a page. */
  introKey?: LocaleKey;
  /** The nav heading it sits under (NAV_GROUPS). */
  group: SettingsNavGroup;
  icon: typeof User;
  keywords: string[];
}> = [
  // #2080 (L0, 2026-11-05): the final rail, which never changes size.
  // Personal: Account, Appearance, Notifications, Security, Vault. AI:
  // Providers, Models, Voice, Usage. Installation: Organization, Computer,
  // Backups and storage. App: General, Updates (desktop only), Developer
  // (#2729: Experimental is a card of it), About (JC 2026-11-07: General first, About last). Import is a card now (settings-sections.ts MERGED). Each keyword names the one page where its
  // option lives (settings-nav.test.ts checks no page shares one).
  { id: "account", group: "you", labelKey: "settings.section.account", introKey: "settings.intro.account", icon: User, keywords: ["account", "compte", "profile", "profil", "name", "nom", "email", "courriel", "copy email", "sign out", "se déconnecter", "déconnexion", "label", "avatar", "photo", "about me", "à propos de moi", "language", "langue", "time zone", "timezone", "fuseau horaire", "fuseau", "region", "région"] },
  { id: "appearance", group: "you", labelKey: "settings.section.appearance", introKey: "settings.intro.appearance", icon: Palette, keywords: ["skin", "theme", "thème", "variant", "variante", "light", "clair", "dark", "sombre", "auto", "appearance", "apparence", "tools", "tool calls", "threads", "show threads", "hide threads", "sidebar", "hidden", "hide", "show", "density", "compact", "comfortable", "avatars", "display", "commands", "mascot", "owl", "fly", "floating", "font", "police", "accessibility", "accessibilité", "reduce motion", "motion", "animations", "contrast", "contraste", "text size", "taille du texte", "zoom", "logo", "masqués", "mascottes", "barre latérale", "conversations", "background", "arrière-plan", "customize", "personnaliser"] },
  // 2026-10-14: Privacy is a card of this page on an organization server.
  { id: "notifications", group: "you", labelKey: "settings.section.notifications", introKey: "settings.intro.notifications", icon: Bell, keywords: ["notifications", "notification", "sound", "sounds", "notification sound", "son de notification", "tick", "tic", "carillon", "chime a", "chime b", "blip", "mute", "silent", "chime", "alert", "alerts", "banner", "badge", "dock", "icône", "unread", "nudge", "wizz", "shake", "secousse", "son", "persistent", "stay", "privacy", "read receipts", "seen", "vu", "confidentialité", "accusés de lecture", "presence", "online", "away", "offline", "last seen", "status", "en ligne", "absent", "hors ligne", "privacidade", "alertes", "on screen", "à l'écran", "quiet hours", "heures calmes", "budget", "daily budget", "budget quotidien", "signals", "signaux"] },
  { id: "security", group: "you", labelKey: "settings.section.security", introKey: "settings.intro.security", icon: ShieldCheck, keywords: ["security", "sécurité", "security key", "security keys", "clé de sécurité", "clés de sécurité", "passkey", "clé d'accès", "yubikey", "webauthn", "touch id", "face id", "step-up", "sensitive", "sensibles", "approvals", "approbations", "approval level", "niveau d'approbation", "approval rules", "règles d'approbation", "rules", "règles", "always allow", "toujours permettre", "always deny", "toujours refuser", "ask first", "demander d'abord", "deny", "refuser", "tool access", "accès aux outils", "my tool access", "mon accès aux outils", "grants", "autorisations", "people's tool access", "accès aux outils des personnes"] },
  { id: "credentials", group: "you", labelKey: "settings.section.vault", introKey: "settings.intro.credentials", icon: KeyRound, keywords: ["vault", "coffre", "your vault", "votre coffre", "credentials", "identifiants", "password", "mot de passe", "login", "logins", "connexions", "totp", "2fa", "one-time code", "code à usage unique", "1password", "notes", "note", "autofill", "remplissage", "add an item", "ajouter un élément", "one-time card", "carte à usage unique", "single-use", "shop pay", "link", "card", "carte", "purchase", "achat", "achats", "payments", "paiements", "wallet", "portefeuille", "history", "historique"] },
  // 2026-10-30: Providers, every account, key and server in one list.
  { id: "providers", group: "ai", labelKey: "settings.section.providers", introKey: "settings.intro.providers", icon: Plug, keywords: ["providers", "fournisseurs", "model providers", "accounts", "comptes", "claude", "codex", "grok", "cli", "sign in", "connexion", "subscription", "abonnement", "keys", "clés", "api", "api key", "api keys", "clé api", "clés api", "xai", "mistral", "cerebras", "router", "openrouter", "base url", "openai", "anthropic", "groq", "opencode", "provider", "fournisseur", "elevenlabs", "fish audio", "azure", "foundry", "compatible", "local models", "modèles locaux", "needs setup", "à configurer", "to connect", "à connecter", "view as a member", "voir comme un membre", "connectors", "connecteurs", "claude.ai", "cursor", "cloud agents", "cloud coding agents", "voice keys", "clés de voix", "image", "image provider", "fournisseur d'images", "génération d'images", "web search", "recherche web", "brave", "exa", "firecrawl", "searxng", "grok bot", "linked grok", "linked grok bot", "pont grok", "grok bridge"] },
  { id: "engines", group: "ai", labelKey: "settings.section.models", introKey: "settings.intro.engines", icon: Terminal, keywords: ["models", "modèles", "engines", "moteurs", "connections", "integrations", "intégrations", "box", "decision", "jev", "typesafe", "routing", "who answers", "bot models", "modèles des bots", "bulk", "decision model", "modèle de décision", "who pays", "qui paie", "effort", "reasoning", "backup model", "fallback", "automatic recovery"] },
  { id: "voice", group: "ai", labelKey: "settings.section.voice", introKey: "settings.intro.voice", icon: AudioLines, keywords: ["voice", "voix", "tts", "speech", "parole", "fish", "chatterbox", "grok voice", "voice engine", "moteur de voix", "live call", "live calls", "appels en direct", "read replies", "hang up", "gpt-live", "microphone", "micro", "audio", "input device", "entrée audio", "phone calls", "appels téléphoniques", "callback number", "numéro de rappel", "do not call", "ne pas appeler"] },
  // #2080: Usage is the cost of the models and the person's own cap, so it sits under AI.
  { id: "usage", group: "ai", labelKey: "settings.section.usage", introKey: "settings.intro.usage", icon: Coins, keywords: ["tokens", "cost", "billing", "plan", "forfait", "coût", "usage", "spend", "this month", "ce mois-ci", "last 30 days", "30 derniers jours", "by bot", "par bot", "by model", "par modèle", "renews", "renouvelle", "sagax business"] },
  // 2026-10-14: Memory is a card of this page (it was its own section).
  { id: "organization", group: "workspace", labelKey: "settings.section.organization", introKey: "settings.intro.organization", icon: Building2, keywords: ["company", "organization", "organisation", "enroll", "managed", "disconnect", "workspace", "cloud", "hosted", "vps", "server", "serveur", "servers", "connect", "pair", "switch", "local", "memory", "obsidian", "sync", "git", "perspicax", "mémoire", "pending", "domain", "dns", "caddy", "full access", "accès complet", "waiting for an admin", "en attente", "people from before", "rattacher", "invite", "inviter", "invitation", "people", "personnes", "serveurs", "oublier", "forget", ...ORGANIZATION_ADVANCED_KEYWORDS] },
  { id: "computer", group: "workspace", labelKey: "settings.section.computer", introKey: "settings.intro.computer", icon: Monitor, keywords: ["computer", "local vm", "vm", "virtual", "desktop", "ordinateur", "this computer", "cet ordinateur", "your computer", "votre ordinateur", "other computers", "autres ordinateurs", "rename", "renommer", "remove computer", "retirer", "network", "réseau", "traffic", "trafic", "repair", "réparer", "disk", "disque", "disk saver", "économiseur de disque", "cache", "clean", "nettoyer", "lend", "prêter", "browser", "navigateur", "profiles", "my chrome"] },
  { id: "permissions", group: "workspace", labelKey: "settings.section.permissions", introKey: "settings.intro.permissions", icon: LockKeyhole, keywords: ["permissions", "permission", "privacy & security", "confidentialité et sécurité", "screen recording", "enregistrement de l'écran", "full disk access", "accès complet au disque", "speech recognition", "reconnaissance vocale", "automation", "automatisation", "system settings", "réglages système", "windows settings", "paramètres windows", "allow", "autoriser", "relaunch", "relancer", "tcc"] },
  // #2080: restore is the backups.import card. Grok Bot / preference import left this page (JC 2026-11-06). Updates stays its own page (#2090).
  // #2636: event log cleanup and retention are on Developer.
  { id: "backups", group: "workspace", labelKey: "settings.section.backupsAndStorage", introKey: "settings.intro.backups", icon: Archive, keywords: ["backups", "export", "exporter", "import", "importer", "restore", "restaurer", "full backup", "recovery", "backup", "sauvegarde", "sauvegardes", "replace", "remplacer", "storage", "stockage"] },
  // JC 2026-11-07: App in the Apple order, General first, About last.
  // General: how this app behaves on the computer, the composer keys and
  // Advanced mode (JC 2026-11-06).
  { id: "general", group: "app", labelKey: "settings.section.general", introKey: "settings.intro.general", icon: Settings2, keywords: ["general", "général", "system", "système", "open at login", "ouvrir à la connexion", "startup", "démarrage", "app icon", "icon", "taskbar", "barre des tâches", "hotkey", "raccourci", "shortcut", "hardware acceleration", "accélération matérielle", "gpu", "send", "send key", "touche d'envoi", "enter", "return", "shift+enter", "ctrl+enter", "cmd+enter", "⌘+enter", "new line", "keyboard", "clavier", "typing", "saisie", "ime", "japanese", "spell check", "spellcheck", "orthographe", "correcteur", "simple"] },
  // #2090: Updates is its own page again (desktop only).
  { id: "updates", group: "app", labelKey: "settings.updates.title", introKey: "settings.intro.updates", icon: Download, keywords: ["updates", "update", "version", "mise à jour", "mises à jour", "prerelease", "pre-release", "beta", "bêta", "restart"] },
  // Developer (#2636, JC 2026-11-07): every technical option on one page, for
  // every member, in Simple and Advanced mode: run details, timeouts, loop
  // guard, OpenTelemetry, event log cleanup, diagnostics, logs, context pods.
  // #2658 (lot 2): the bot page's technical cards (working folder, tool
  // selection, webhooks, always-allowed list, memory logs and embeddings,
  // export zip) and the Claude Code switches.
  { id: "developer", group: "app", labelKey: "settings.section.developer", introKey: "settings.intro.developer", icon: Code2, keywords: ["advanced mode", "mode avancé", "interface", "server environment", "environnement serveur", "reset", "réinitialiser", "maintenance", "entretien", "scheduled update", "mise à jour planifiée", "github oauth", "client id", "developer", "développeur", "technical", "technique", "run", "this run", "run card", "carte d'exécution", "inspector", "inspecteur", "turn timing", "minutage", "latency", "latence", "usage meter", "usage measure", "mesure d'utilisation", "compteur", "loop guard", "garde-fou", "opentelemetry", "telemetry", "télémétrie", "otlp", "trace", "traces", "collector", "collecteur", "group turns", "rooms", "room turn", "tour de groupe", "mcp", "mcp call", "appel mcp", "timeout", "délai", "tool call", "cleanup", "retention", "rétention", "nettoyage", "event log", "journal des événements", "log size", "diagnostics", "diagnostic", "journaux", "logs", "download logs", "télécharger les journaux", "context pods", "pods", "dev pods", "pods de contexte", "webhooks", "webhook", "crochets", "export zip", "export the bot", "exporter le bot", "zip", "embeddings", "embedding", "recall by meaning", "rappel par sens", "skills folder", "dossier de skills", "claude code", "working folder", "dossier de travail", "always allowed", "toujours permis", "daily logs", "journaux quotidiens", "auto model", "modèle auto", "what auto would choose", "defaults for new bots", "défauts des nouveaux bots", "new bots", "prompt cache", "keep warm", "cache chaud", "tool selection", "sélection d'outils", "per bot", "early", "preview", "learn", "skill", "authoring", "experimental", "expérimental", "data window", "fenêtre data", "compétences", "unavailable", "indisponible"] },
  // About (was "Help and about", JC 2026-11-07): the About window, the tours
  // and Send feedback as a card of the page (#2636: diagnostics and logs are on Developer).
  { id: "about", group: "app", labelKey: "settings.section.about", introKey: "settings.intro.about", icon: Info, keywords: ["app", "application", "about", "à propos", "license", "licence", "github", "documentation", "docs", "release notes", "notes de version", "sagax", "openmausbot", "tour", "tours", "visite", "welcome", "bienvenue", "feedback", "send feedback", "commentaires", "envoyer des commentaires", "help", "aide"] },
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
  // #2295: the Grok Bot link and the claude.ai connectors live in Providers > Advanced
  "providers.advanced": ["link with grok bot", "lier à grok bot", "linked grok", "grok bot", "grok bridge", "pont grok", "claude.ai", "connectors", "connecteurs", "cloud agent", "cloud coding"],
  "providers.advanced.connectors": ["claude.ai", "connectors", "connecteurs"],
  "myApprovalRules": ["always allow", "always deny", "ask first", "approval rules", "règles d'approbation"],
  // #2636: these cards open on Developer (settings-sections.ts CARD_HOME)
  "general.threadCleanup": ["cleanup", "retention", "event log", "event-log", "log size", "nettoyage"],
  "organization.mcpCalls": ["mcp", "mcp call", "appel mcp", "timeout", "tool call"],
  "organization.roomTurns": ["group turns", "rooms", "room turn"],
  "developer.conversation": ["run card", "inspector", "inspecteur", "turn timing", "minutage"],
  "general.telemetry": ["opentelemetry", "telemetry", "télémétrie", "otlp"],
  "developer.diagnostics": ["diagnostics", "diagnostic", "journaux", "logs", "download logs", "télécharger les journaux"],
  "developer.devPods": ["context pods", "dev pods", "pods de contexte"],
  // #2658 (lot 2): the bot page's technical cards, and Claude Code on this computer
  "developer.bot": ["per bot", "webhooks", "webhook", "crochets", "export zip", "export the bot", "exporter le bot", "zip", "embeddings", "embedding", "recall by meaning", "rappel par sens", "working folder", "dossier de travail", "always allowed", "toujours permis", "toujours permettre", "daily logs", "journaux quotidiens", "tool selection", "sélection d'outils"],
  // #2729: Experimental features is a card of Developer
  "experimental.features": ["early", "preview", "learn", "skill", "authoring", "experimental", "expérimental", "data window", "fenêtre data", "compétences", "unavailable", "indisponible"],
  "developer.claudeCode": ["claude code", "skills folder", "dossier de skills"],
  "connections.integrations": ["box", "vps"],
  "connections.image": ["image", "avatar", "gpt image"],
  "voice.advanced": ["live call", "read replies", "hang up", "gpt-live"],
  "companion.domain": ["domain", "dns", "caddy"],
  "engines.decisionModel": ["decision", "decision model", "modèle de décision", "jev", "typesafe"],
  "connections.cloudAgents": ["cursor", "cloud agent", "cloud coding"],
  "connections.webSearch": ["web search", "recherche web", "brave", "exa", "parallel", "firecrawl", "searxng"],
  "usage.breakdown": ["by bot", "by model", "par bot", "par modèle"],
  "organization.memory": ["obsidian", "vault"],
  // JC 2026-11-06: General and About cards
  "general.system": ["open at login", "ouvrir à la connexion", "startup", "démarrage", "app icon", "hotkey", "raccourci", "hardware acceleration", "gpu"],
  "general.input": ["send", "enter", "spell check", "spellcheck", "orthographe", "correcteur", "keyboard", "clavier"],
  "general.interface": [],
  "general.loopGuard": ["loop guard"],
  "about.about": ["license", "licence", "tour", "tours", "visite", "welcome", "bienvenue"],
  "about.help": ["feedback", "send feedback", "commentaires", "envoyer des commentaires", "help", "aide"],
  "general.peopleToolAccess": ["people's tool access"],
  "general.usage": ["usage meter", "usage measure"],
  "updates.links": ["release notes", "notes de version"],
  "voice.phoneCalls": ["phone calls", "appels téléphoniques", "callback number", "do not call"],
  "notifications.privacy": ["blocked", "bloquer", "report", "signalement", "privacy", "confidentialité", "read receipts", "accusés de lecture", "presence", "présence"],
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
  // admin gave it sees the card without the rest of the installation. Since
  // #2729 the card lives on Developer (experimentalShown); an old link to the
  // section opens Developer.
  if (id === "experimental") return !(input.manageExperimental ?? input.editConfig) && input.personalSettings !== true;
  if (id === "decisionModel" || id === "workspaces") return !input.editConfig;
  // #2265: Import left Settings, so Backups is only the installation-wide
  // Full backup (manageBackups); without it the page would be empty.
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

