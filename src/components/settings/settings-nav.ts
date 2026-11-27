import { ChartNoAxesColumn, CloudDownload, Monitor, Plug, Settings, Shield, User, Building2, Server, Vault } from "lucide-react";
import type { AppSettingsSection } from "@/state/store";
import type { LocaleKey } from "@/locales";
import { t } from "@/lib/i18n";
import { settingsTextMatches } from "@/lib/settings-search";
import { OFF_RAIL_PAGES } from "@/lib/settings-sections";

/** Search words of the cards moved from General > Advanced to Organization
 * (2026-10-15). On a desktop with no server they stay in General > Advanced,
 * and General matches them there (sectionMatches `extra`). #2636: the two
 * timeouts (mcp, timeout, group turns, rooms) are on Developer now. */
export const ORGANIZATION_ADVANCED_KEYWORDS = ["routines", "conversation", "schedule"];

export interface SettingsSection {
  id: AppSettingsSection;
  labelKey: LocaleKey;
  /** The page's one-line sentence, drawn by the modal under the title (#2080). */
  introKey?: LocaleKey;
  icon: typeof User;
  keywords: string[];
}

/** #4457 (the owner, 2026-11-16): the rail of the reference app, seven
 * entries with no group title: General, Computer, Permissions, Vault,
 * Providers, Usage, Updates (src/lib/settings-sections.ts RAIL_PAGES). What
 * the former pages held lives on these pages or one page further
 * (SETTINGS_SUB_PAGES); each keyword names the one page where its option
 * lives (settings-contract.test.ts checks no page shares one). Organization
 * is off the rail: the search and its own address reach it. */
export const SECTIONS: SettingsSection[] = [
  // General: Account, Appearance, Notifications, Mascots, System, then Advanced (former Developer, M-20261127-068)
  { id: "general", labelKey: "settings.section.general", introKey: "settings.intro.general", icon: Settings, keywords: ["general", "général", "system", "système", "open at login", "ouvrir à la connexion", "startup", "démarrage", "app icon", "icon", "taskbar", "barre des tâches", "hotkey", "raccourci", "shortcut", "hardware acceleration", "accélération matérielle", "gpu", "send", "send key", "touche d'envoi", "enter", "return", "shift+enter", "ctrl+enter", "cmd+enter", "⌘+enter", "new line", "keyboard", "clavier", "typing", "saisie", "ime", "japanese", "spell check", "spellcheck", "orthographe", "correcteur", "simple", "account", "compte", "profile", "profil", "name", "nom", "email", "courriel", "copy email", "sign out", "se déconnecter", "déconnexion", "avatar", "photo", "language", "langue", "time zone", "timezone", "fuseau horaire", "fuseau", "region", "région", "skin", "theme", "thème", "variant", "variante", "light", "clair", "dark", "sombre", "auto", "appearance", "apparence", "chat width", "largeur de la conversation", "space under the composer", "espace sous la zone de saisie", "composer", "zone de saisie", "conversation header", "en-tête de la conversation", "header", "en-tête", "pill", "pastille", "title", "titre", "tools", "tool calls", "threads", "show threads", "hide threads", "sidebar", "hidden", "hide", "show", "density", "compact", "comfortable", "avatars", "display", "commands", "mascot", "owl", "fly", "floating", "font", "police", "accessibility", "accessibilité", "reduce motion", "motion", "animations", "contrast", "contraste", "text size", "taille du texte", "zoom", "logo", "masqués", "mascottes", "barre latérale", "conversations", "background", "arrière-plan", "customize", "personnaliser", "notifications", "notification", "sound", "sounds", "notification sound", "son de notification", "tick", "tic", "carillon", "chime a", "chime b", "blip", "mute", "silent", "chime", "alert", "alerts", "banner", "badge", "dock", "icône", "unread", "nudge", "wizz", "shake", "secousse", "son", "persistent", "stay", "alertes", "on screen", "à l'écran", "quiet hours", "heures calmes", "budget", "daily budget", "budget quotidien", "signals", "signaux", "microphone", "micro", "audio", "input device", "entrée audio", "backups", "export", "exporter", "import", "importer", "restore", "restaurer", "full backup", "recovery", "backup", "sauvegarde", "sauvegardes", "replace", "remplacer", "storage", "stockage", "mascots", "shortcuts", "raccourcis", "keep on screen", "advanced mode", "mode avancé", "interface", "server environment", "environnement serveur", "reset", "réinitialiser", "maintenance", "entretien", "scheduled update", "mise à jour planifiée", "github oauth", "client id", "developer", "développeur", "technical", "technique", "advanced", "avancé", "run", "this run", "run card", "carte d'exécution", "inspector", "inspecteur", "turn timing", "minutage", "latency", "latence", "usage meter", "usage measure", "mesure d'utilisation", "compteur", "loop guard", "garde-fou", "opentelemetry", "telemetry", "télémétrie", "otlp", "trace", "traces", "collector", "collecteur", "group turns", "rooms", "room turn", "tour de groupe", "mcp", "mcp call", "appel mcp", "timeout", "délai", "tool call", "cleanup", "retention", "rétention", "nettoyage", "event log", "journal des événements", "log size", "diagnostics", "diagnostic", "journaux", "logs", "download logs", "télécharger les journaux", "context pods", "pods", "dev pods", "pods de contexte", "webhooks", "webhook", "crochets", "export zip", "export the bot", "exporter le bot", "zip", "embeddings", "embedding", "recall by meaning", "rappel par sens", "skills folder", "dossier de skills", "claude code", "working folder", "dossier de travail", "always allowed", "toujours permis", "daily logs", "journaux quotidiens", "auto model", "modèle auto", "what auto would choose", "prompt cache", "keep warm", "cache chaud", "tool selection", "sélection d'outils", "per bot", "early", "preview", "learn", "skill", "authoring", "experimental", "expérimental", "data window", "fenêtre data", "compétences", "unavailable", "indisponible"] },
  { id: "computer", labelKey: "settings.section.computer", introKey: "settings.intro.computer", icon: Monitor, keywords: ["computer", "local vm", "vm", "virtual", "desktop", "ordinateur", "this computer", "cet ordinateur", "your computer", "votre ordinateur", "other computers", "autres ordinateurs", "rename", "renommer", "remove computer", "retirer", "network", "réseau", "traffic", "trafic", "repair", "réparer", "disk", "disque", "disk saver", "économiseur de disque", "cache", "clean", "nettoyer", "lend", "prêter", "browser", "navigateur", "profiles", "my chrome"] },
  // Permissions (id "security"): Before acting, Privacy, Security, this computer's permissions
  { id: "security", labelKey: "settings.section.permissions", introKey: "settings.intro.security", icon: Shield, keywords: ["security", "sécurité", "security key", "security keys", "clé de sécurité", "clés de sécurité", "passkey", "clé d'accès", "yubikey", "webauthn", "touch id", "face id", "step-up", "sensitive", "sensibles", "approvals", "approbations", "approval level", "niveau d'approbation", "approval rules", "règles d'approbation", "rules", "règles", "always allow", "toujours permettre", "always deny", "toujours refuser", "ask first", "demander d'abord", "deny", "refuser", "tool access", "accès aux outils", "my tool access", "mon accès aux outils", "grants", "autorisations", "people's tool access", "accès aux outils des personnes", "permissions", "permission", "privacy & security", "confidentialité et sécurité", "screen recording", "enregistrement de l'écran", "full disk access", "accès complet au disque", "speech recognition", "reconnaissance vocale", "automation", "automatisation", "system settings", "réglages système", "windows settings", "paramètres windows", "allow", "autoriser", "relaunch", "relancer", "tcc", "privacy", "read receipts", "seen", "vu", "confidentialité", "accusés de lecture", "presence", "online", "away", "offline", "last seen", "status", "en ligne", "absent", "hors ligne", "privacidade", "keep people apart", "garder les personnes à part", "signed-in devices", "your keys", "vos clés"] },
  { id: "credentials", labelKey: "settings.section.vault", introKey: "settings.intro.credentials", icon: Vault, keywords: ["vault", "coffre", "your vault", "votre coffre", "credentials", "identifiants", "password", "mot de passe", "login", "logins", "connexions", "totp", "2fa", "one-time code", "code à usage unique", "1password", "notes", "note", "autofill", "remplissage", "add an item", "ajouter un élément", "one-time card", "carte à usage unique", "single-use", "shop pay", "link", "card", "carte", "purchase", "achat", "achats", "payments", "paiements", "wallet", "portefeuille", "history", "historique"] },
  // Providers: Accounts, Models, Voice, Advanced
  { id: "providers", labelKey: "settings.section.providers", introKey: "settings.intro.providers", icon: Plug, keywords: ["providers", "fournisseurs", "model providers", "accounts", "comptes", "claude", "codex", "grok", "cli", "sign in", "connexion", "subscription", "abonnement", "keys", "clés", "api", "api key", "api keys", "clé api", "clés api", "xai", "mistral", "cerebras", "router", "openrouter", "base url", "openai", "anthropic", "groq", "opencode", "provider", "fournisseur", "elevenlabs", "fish audio", "azure", "foundry", "compatible", "local models", "modèles locaux", "needs setup", "à configurer", "to connect", "à connecter", "view as a member", "voir comme un membre", "connectors", "connecteurs", "claude.ai", "cursor", "cloud agents", "cloud coding agents", "voice keys", "clés de voix", "image", "image provider", "fournisseur d'images", "génération d'images", "web search", "recherche web", "brave", "exa", "firecrawl", "searxng", "grok bot", "linked grok", "linked grok bot", "pont grok", "grok bridge", "link with grok bot", "lier à grok bot", "your bots there", "tes bots là-bas", "spacexsi", "models", "modèles", "engines", "moteurs", "connections", "integrations", "intégrations", "box", "decision", "jev", "typesafe", "routing", "who answers", "bot models", "modèles des bots", "bulk", "decision model", "modèle de décision", "who pays", "qui paie", "effort", "reasoning", "backup model", "fallback", "automatic recovery", "voice", "voix", "tts", "speech", "parole", "fish", "chatterbox", "grok voice", "voice engine", "moteur de voix", "live call", "live calls", "appels en direct", "read replies", "hang up", "gpt-live", "phone calls", "appels téléphoniques", "do not call", "ne pas appeler", "context size", "taille du contexte", "defaults for new bots", "défauts des nouveaux bots", "new bots", "default model", "modèle par défaut", "generated titles", "conversation titles", "titres générés", "titres de conversation"] },
  { id: "usage", labelKey: "settings.section.usage", introKey: "settings.intro.usage", icon: ChartNoAxesColumn, keywords: ["tokens", "cost", "billing", "plan", "forfait", "coût", "usage", "spend", "this month", "ce mois-ci", "last 30 days", "30 derniers jours", "by bot", "par bot", "by model", "par modèle", "renews", "renouvelle", "sagax business"] },
  // Updates: version and About (Advanced moved to General, M-20261127-068)
  { id: "updates", labelKey: "settings.updates.title", introKey: "settings.intro.updates", icon: CloudDownload, keywords: ["updates", "update", "version", "mise à jour", "mises à jour", "prerelease", "pre-release", "beta", "bêta", "restart", "app", "application", "about", "à propos", "license", "licence", "github", "documentation", "docs", "release notes", "notes de version", "sagax", "openmausbot", "tour", "tours", "visite", "welcome", "bienvenue", "feedback", "send feedback", "commentaires", "envoyer des commentaires", "help", "aide", "what's new", "quoi de neuf"] },
  // Off the rail (#4457): the organization's settings are the console's
  { id: "organization", labelKey: "settings.section.organization", introKey: "settings.intro.organization", icon: Building2, keywords: ["company", "organization", "organisation", "enroll", "managed", "disconnect", "workspace", "cloud", "hosted", "vps", "server", "serveur", "servers", "connect", "pair", "switch", "local", "memory", "obsidian", "sync", "git", "perspicax", "mémoire", "pending", "domain", "dns", "caddy", "full access", "accès complet", "waiting for an admin", "en attente", "people from before", "rattacher", "invite", "inviter", "invitation", "people", "personnes", "serveurs", "oublier", "forget", ...ORGANIZATION_ADVANCED_KEYWORDS] },
];

/** The pages of the rail, in order. */
export function railSections(sections: readonly SettingsSection[]): SettingsSection[] {
  return sections.filter((entry) => !(OFF_RAIL_PAGES as readonly string[]).includes(entry.id));
}

/** #4360: a server with no organization (the probe on GET /api/org, or no
 * desktop locked to one) is one person's: no page says "Organization"
 * there. The page holds their server and the servers they connect to. */
export function sectionsFor(organization: boolean): SettingsSection[] {
  if (organization) return SECTIONS;
  return SECTIONS.map((entry) => entry.id === "organization" ? { ...entry, labelKey: "settings.section.servers", introKey: "settings.intro.servers", icon: Server } : entry);
}

/** The former pages each page holds now (2026-10-14; #4457 the seven
 * pages), by the page that holds them. Each keeps its own visibility rules:
 * its card or sub-page shows where the page would have, and the page shows
 * when one of them does. */
export const HOSTED_CARDS: Partial<Record<AppSettingsSection, AppSettingsSection[]>> = {
  // M-20261127-068: developer and experimental live under General > Advanced
  general: ["account", "appearance", "notifications", "backups", "developer", "experimental"],
  security: ["privacy", "permissions"],
  providers: ["engines", "voice", "decisionModel"],
  updates: ["about"],
  organization: ["memory"],
};

/** Collapsible cards a search opens: a match on these words means the person
 * is looking for what the card holds, so it should not stay folded. */
export const CARD_KEYWORDS: Record<string, string[]> = {
  // #2295, #4408: the connectors of the person's provider accounts live in
  // Providers > Advanced, one card per provider (the bots link is a line of
  // the xAI provider since #4329, found by its own words)
  "providers.advanced": ["claude.ai", "chatgpt.com", "grok.com", "connectors", "connecteurs", "cloud agent", "cloud coding"],
  "providers.advanced.connectors.anthropic": ["claude.ai", "connectors", "connecteurs"],
  "providers.advanced.connectors.openai": ["chatgpt.com", "chatgpt apps", "connectors", "connecteurs"],
  "providers.advanced.connectors.xai": ["grok.com", "connectors", "connecteurs"],
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
  "voice.phoneCalls": ["phone calls", "appels téléphoniques", "do not call"],
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

