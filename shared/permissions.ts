// The permission catalogue of an organization server (2026-10-09).
//
// Every "admin only" decision a person meets on a Sagax server linked to
// Perspicax is one key here. Perspicax holds permission sets (roles), each
// granting keys; a person's effective permissions are the union of the
// default set, the sets given to them and the sets of their teams, computed
// by Perspicax and sent in the directory (`permissions` on each person). An
// organization admin holds every key. Keys marked `adminOnly` are true
// security boundaries: no set grants them, whatever Perspicax sends.
//
// When Perspicax sends no list (an older Perspicax, a person missing from
// the directory, the directory not read yet), a person holds the member
// defaults: exactly what a plain member could do before this catalogue.
//
// Browser-safe: the server enforces it, the app hides or disables with it,
// and GET /api/org/admin/capabilities hands it to the Perspicax console,
// which draws its permission matrix from these rows. Keys are stable: never
// rename one; retire it and add another.
//
// Spec: docs/superpowers/specs/2026-10-09-sagax-permission-matrix.md.

export const PERMISSION_CATALOGUE_VERSION = 1;

export type PermissionGroupId =
  | "bots" | "sharing" | "engines" | "apps" | "skills" | "folders"
  | "routines" | "people" | "usage" | "backup" | "host" | "server" | "clients"
  | "security";

export interface LocalizedText {
  en: string;
  fr: string;
}

export interface PermissionGroup {
  id: PermissionGroupId;
  label: LocalizedText;
}

export interface PermissionDefinition<K extends string = string> {
  key: K;
  group: PermissionGroupId;
  label: LocalizedText;
  description: LocalizedText;
  /** What a plain member holds when Perspicax sends nothing. */
  memberDefault: boolean;
  /** Only an organization admin, whatever a profile grants. */
  adminOnly: boolean;
  /** Why it stays with admins (adminOnly keys only). */
  adminOnlyReason?: LocalizedText;
}

export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  { id: "bots", label: { en: "Bots", fr: "Bots" } },
  { id: "sharing", label: { en: "Sharing", fr: "Partage" } },
  { id: "engines", label: { en: "Engines", fr: "Moteurs" } },
  { id: "apps", label: { en: "Connect apps and plugins", fr: "Applications et plugiciels" } },
  { id: "skills", label: { en: "Skills", fr: "Compétences" } },
  { id: "folders", label: { en: "Working folders", fr: "Dossiers de travail" } },
  { id: "routines", label: { en: "Routines", fr: "Routines" } },
  { id: "people", label: { en: "People", fr: "Personnes" } },
  { id: "usage", label: { en: "Usage", fr: "Utilisation" } },
  { id: "backup", label: { en: "Backups", fr: "Sauvegardes" } },
  { id: "host", label: { en: "Server host", fr: "Hôte du serveur" } },
  { id: "server", label: { en: "Server", fr: "Serveur" } },
  { id: "clients", label: { en: "AI clients through Perspicax", fr: "Clients IA par Perspicax" } },
  { id: "security", label: { en: "Security", fr: "Sécurité" } },
];

const definitions = [
  {
    key: "bots.create", group: "bots", memberDefault: true, adminOnly: false,
    label: { en: "Create and own bots", fr: "Créer et posséder des bots" },
    description: {
      en: "Create bots, bring them from a solo Sagax, and rename, instruct, change the model of or delete the bots they own.",
      fr: "Créer des bots, les apporter d'un Sagax solo, et renommer, instruire, changer le modèle ou supprimer les bots qu'ils possèdent.",
    },
  },
  {
    key: "bots.approvalLevel", group: "bots", memberDefault: false, adminOnly: false,
    label: { en: "Choose Ask or Auto on their bots", fr: "Choisir Demander ou Auto sur leurs bots" },
    description: {
      en: "Set the approval level of a bot they own to Ask or Auto. Full access has its own permission.",
      fr: "Régler le niveau d'approbation d'un bot qu'ils possèdent à Demander ou Auto. L'accès complet a sa propre permission.",
    },
  },
  {
    key: "bots.fullAccess", group: "bots", memberDefault: true, adminOnly: false,
    label: { en: "Turn on Full access on their bots", fr: "Activer l'accès complet sur leurs bots" },
    description: {
      en: "Turn on Full access for a bot they own, while the organization allows Full access.",
      fr: "Activer l'accès complet pour un bot qu'ils possèdent, tant que l'organisation le permet.",
    },
  },
  {
    key: "bots.behaviour", group: "bots", memberDefault: false, adminOnly: false,
    label: { en: "Change memory, voice notes and fallback of their bots", fr: "Changer la mémoire, les notes vocales et le repli de leurs bots" },
    description: {
      en: "Turn memory and its upkeep, voice notes, the fallback model and parked direct messages on or off for a bot they own.",
      fr: "Activer ou désactiver la mémoire et son entretien, les notes vocales, le modèle de repli et les messages directs en attente d'un bot qu'ils possèdent.",
    },
  },
  {
    key: "bots.computer", group: "bots", memberDefault: false, adminOnly: false,
    label: { en: "Choose where their bots work", fr: "Choisir où travaillent leurs bots" },
    description: {
      en: "Choose the computer, the cloud computer, the built-in browser and the browser profile of a bot they own.",
      fr: "Choisir l'ordinateur, l'ordinateur infonuagique, le navigateur intégré et le profil de navigateur d'un bot qu'ils possèdent.",
    },
  },
  {
    key: "bots.tools", group: "bots", memberDefault: false, adminOnly: false,
    label: { en: "Choose the tools of their bots", fr: "Choisir les outils de leurs bots" },
    description: {
      en: "Change the tool selection, MCP servers, connected apps, outbound rules and peers of a bot they own.",
      fr: "Changer la sélection d'outils, les serveurs MCP, les applications connectées, les règles sortantes et les pairs d'un bot qu'ils possèdent.",
    },
  },
  {
    key: "bots.catalogFeature", group: "bots", memberDefault: false, adminOnly: false,
    label: { en: "Feature bots in Browse Bots", fr: "Mettre des bots en vedette dans Parcourir les bots" },
    description: {
      en: "Feature or unfeature a published bot in the organization's bot catalogue.",
      fr: "Mettre en vedette ou retirer de la vedette un bot publié dans le catalogue de bots de l'organisation.",
    },
  },
  {
    key: "sharing.grants", group: "sharing", memberDefault: true, adminOnly: false,
    label: { en: "Share their bots", fr: "Partager leurs bots" },
    description: {
      en: "Give people and teams access to a bot they own, and take it back.",
      fr: "Donner à des personnes et des équipes l'accès à un bot qu'ils possèdent, et le retirer.",
    },
  },
  {
    key: "sharing.visibility", group: "sharing", memberDefault: false, adminOnly: false,
    label: { en: "Choose who sees their bots", fr: "Choisir qui voit leurs bots" },
    description: {
      en: "Set the visibility and the sidebar section of a bot they own, at creation and afterwards.",
      fr: "Régler la visibilité et la section de la barre latérale d'un bot qu'ils possèdent, à la création et ensuite.",
    },
  },
  {
    key: "engines.manage", group: "engines", memberDefault: false, adminOnly: false,
    label: { en: "Manage the server's engines", fr: "Gérer les moteurs du serveur" },
    description: {
      en: "Install, update, sign in, rename and refresh the engines of the server. Changing an engine's program path stays with admins.",
      fr: "Installer, mettre à jour, connecter, renommer et rafraîchir les moteurs du serveur. Changer le chemin du programme d'un moteur reste aux admins.",
    },
  },
  {
    key: "apps.ownIntegrations", group: "apps", memberDefault: true, adminOnly: false,
    label: { en: "Manage their own plugins, skills and MCP servers", fr: "Gérer leurs propres plugiciels, compétences et serveurs MCP" },
    description: {
      en: "Add and change their own MCP servers and GitHub account, and the plugins and skills of the bots they own or manage.",
      fr: "Ajouter et changer leurs propres serveurs MCP et compte GitHub, ainsi que les plugiciels et compétences des bots qu'ils possèdent ou gèrent.",
    },
  },
  {
    key: "apps.serverPlugins", group: "apps", memberDefault: false, adminOnly: false,
    label: { en: "Add plugins to the server", fr: "Ajouter des plugiciels au serveur" },
    description: {
      en: "Install a plugin from the catalog or the registry for the whole server: every bot can then reach it. A plugin that would run a command on the server is still skipped.",
      fr: "Installer un plugiciel du catalogue ou du registre pour tout le serveur : chaque bot peut alors l'atteindre. Un plugiciel qui lancerait une commande sur le serveur reste ignoré.",
    },
  },
  {
    key: "apps.marketplaces", group: "apps", memberDefault: false, adminOnly: false,
    label: { en: "Manage plugin marketplaces", fr: "Gérer les marchés de plugiciels" },
    description: {
      en: "Add, refresh and remove the server's plugin marketplaces, and install or remove their plugins for the whole server. A plugin that would run a command on the server is still skipped.",
      fr: "Ajouter, rafraîchir et retirer les marchés de plugiciels du serveur, et installer ou retirer leurs plugiciels pour tout le serveur. Un plugiciel qui lancerait une commande sur le serveur reste ignoré.",
    },
  },
  {
    key: "skills.library", group: "skills", memberDefault: false, adminOnly: false,
    label: { en: "Change the skills library", fr: "Changer la bibliothèque de compétences" },
    description: {
      en: "Read, save, approve, disable and delete the skills of the server's shared library.",
      fr: "Lire, enregistrer, approuver, désactiver et supprimer les compétences de la bibliothèque partagée du serveur.",
    },
  },
  {
    key: "folders.botWorkingFolder", group: "folders", memberDefault: false, adminOnly: false,
    label: { en: "Set the working folder of their bots", fr: "Choisir le dossier de travail de leurs bots" },
    description: {
      en: "Choose the folder a bot they own works in, at creation and afterwards.",
      fr: "Choisir le dossier où travaille un bot qu'ils possèdent, à la création et ensuite.",
    },
  },
  {
    key: "folders.roomWorkingFolder", group: "folders", memberDefault: false, adminOnly: false,
    label: { en: "Set the working folder of their groups", fr: "Choisir le dossier de travail de leurs groupes" },
    description: {
      en: "Choose the folder a group they own works in.",
      fr: "Choisir le dossier où travaille un groupe qu'ils possèdent.",
    },
  },
  {
    key: "routines.runAsAnyone", group: "routines", memberDefault: false, adminOnly: false,
    label: { en: "Choose anyone a routine runs as", fr: "Choisir n'importe qui comme exécutant d'une routine" },
    description: {
      en: "Pick any active person of the directory in a routine's Runs as field, like an admin. Team managers already reach their teams.",
      fr: "Choisir toute personne active du répertoire dans le champ S'exécute en tant que d'une routine, comme un admin. Les gestionnaires d'équipe atteignent déjà leurs équipes.",
    },
  },
  {
    key: "routines.runNowAny", group: "routines", memberDefault: false, adminOnly: false,
    label: { en: "Run any routine now", fr: "Lancer n'importe quelle routine maintenant" },
    description: {
      en: "Use Run now on a routine they can see, even when they neither own its bot nor are the person it runs as.",
      fr: "Utiliser Lancer maintenant sur une routine qu'ils voient, même s'ils ne possèdent pas son bot et ne sont pas la personne qui l'exécute.",
    },
  },
  // 2026-10-09 (JC): who sees the automation schedule beyond their own
  // routines. Read side only: Run now, Edit and Runs as keep their own gates
  // (routines.runNowAny, routines.runAsAnyone, the bot's `run` level).
  {
    key: "routines.viewTeam", group: "routines", memberDefault: false, adminOnly: false,
    label: { en: "See their teams' routines", fr: "Voir les routines de leurs équipes" },
    description: {
      en: "See on the Automations page the routines of the people in their teams and of the bots shared with their teams, read-only unless they may run or edit them.",
      fr: "Voir dans la page Automatisations les routines des personnes de leurs équipes et des bots partagés avec leurs équipes, en lecture seule sauf s'ils peuvent les lancer ou les modifier.",
    },
  },
  {
    key: "routines.viewAll", group: "routines", memberDefault: false, adminOnly: false,
    label: { en: "See every routine of the organization", fr: "Voir toutes les routines de l'organisation" },
    description: {
      en: "See on the Automations page every routine of the server, with its owner, bot and status, and clear any run log. Instructions and run outputs of others' routines stay hidden.",
      fr: "Voir dans la page Automatisations toutes les routines du serveur, avec leur propriétaire, leur bot et leur état, et effacer n'importe quel journal d'exécution. Les instructions et les résultats des routines des autres restent masqués.",
    },
  },
  {
    key: "people.labelAnyone", group: "people", memberDefault: false, adminOnly: false,
    label: { en: "Change anyone's label", fr: "Changer l'étiquette de n'importe qui" },
    description: {
      en: "Change the custom label of any person. Everyone changes their own; team managers change their teams' people.",
      fr: "Changer l'étiquette personnalisée de n'importe quelle personne. Chacun change la sienne; les gestionnaires changent celles de leurs équipes.",
    },
  },
  {
    key: "people.activityLog", group: "people", memberDefault: false, adminOnly: false,
    label: { en: "Read the admin activity log", fr: "Lire le journal d'activité admin" },
    description: {
      en: "Read and export who changed settings, people, access and bots, and who answered approval cards.",
      fr: "Lire et exporter qui a changé les réglages, les personnes, les accès et les bots, et qui a répondu aux cartes d'approbation.",
    },
  },
  // 2026-10-19 (JC): delegable. Nobody but an admin acts on an admin
  // (their sessions, codes, connections, bots or pages), and attaching an
  // interim person stays an admin's (it merges identities).
  {
    key: "people.manage", group: "people", memberDefault: false, adminOnly: false,
    label: { en: "Manage other people", fr: "Gérer les autres personnes" },
    description: {
      en: "See and end people's sessions and pairing codes, revoke their connections, stop or delete their bots and revoke their published pages. Never an organization admin's, and attaching an interim person stays with admins.",
      fr: "Voir et fermer les sessions et les codes de jumelage des personnes, révoquer leurs connexions, arrêter ou supprimer leurs bots et révoquer leurs pages publiées. Jamais ceux d'un admin de l'organisation, et rattacher une personne intérimaire reste aux admins.",
    },
  },
  {
    key: "usage.view", group: "usage", memberDefault: false, adminOnly: false,
    label: { en: "See usage and spend", fr: "Voir l'utilisation et les dépenses" },
    description: {
      en: "Read the server's usage, spend and budget, and export them.",
      fr: "Lire l'utilisation, les dépenses et le budget du serveur, et les exporter.",
    },
  },
  // 2026-10-19 (JC): delegable for the export; a restore replaces sign-in,
  // people and sessions, so it stays an admin's.
  {
    key: "backup.workspace", group: "backup", memberDefault: false, adminOnly: false,
    label: { en: "Back up the server", fr: "Sauvegarder le serveur" },
    description: {
      en: "Export and download the server's backups and see their status. A backup holds everyone's conversations and files. Restoring stays with admins.",
      fr: "Exporter et télécharger les sauvegardes du serveur et voir leur état. Une sauvegarde contient les conversations et les fichiers de tout le monde. La restauration reste aux admins.",
    },
  },
  // 2026-10-19 (JC): running commands on the organization's shared host is
  // a right an admin gives (a person, a team), never an admin's alone. A
  // person's own destinations (their cloud computer, their Local VM, their
  // own computer) never need it: those commands are theirs at their own
  // approval level.
  {
    key: "host.commands", group: "host", memberDefault: false, adminOnly: false,
    label: { en: "Run commands on the organization's server", fr: "Exécuter des commandes sur le serveur de l'organisation" },
    description: {
      en: "Open a terminal on the organization's server hosts (the Sagax server, its SSH and unRAID hosts) and approve by hand the server commands of the bots they own. A shell there reaches the whole server, everyone's data included: give it only to people you would trust as admins of the server. Their own cloud computer, Local VM and computer never need it.",
      fr: "Ouvrir un terminal sur les hôtes du serveur de l'organisation (le serveur Sagax, ses hôtes SSH et unRAID) et approuver à la main les commandes serveur des bots qu'ils possèdent. Un terminal là-bas atteint tout le serveur, données de chacun comprises : ne la donnez qu'à des personnes à qui vous confieriez l'administration du serveur. Leur propre ordinateur infonuagique, leur VM locale et leur ordinateur n'en ont jamais besoin.",
    },
  },
  // 2026-10-19 (JC): delegable. Equivalent to an admin on the server's
  // machine: the label says so.
  {
    key: "host.shell", group: "host", memberDefault: false, adminOnly: false,
    label: { en: "Change the server's own setup", fr: "Changer la configuration propre du serveur" },
    description: {
      en: "Approve the server commands of other people's bots, save command rules, change the server's own MCP servers, an engine's program path, its computers and this computer. It runs programs on the server's machine: give it only to people you would trust as admins of the server.",
      fr: "Approuver les commandes serveur des bots des autres, enregistrer des règles de commande, changer les serveurs MCP du serveur, le chemin du programme d'un moteur, ses ordinateurs et cet ordinateur. Elle exécute des programmes sur la machine du serveur : ne la donnez qu'à des personnes à qui vous confieriez l'administration du serveur.",
    },
  },
  // 2026-10-19 (JC): delegable. Who is an admin (the sign-in lists), the
  // operator's own profile, tool grants, the interim attach window and the
  // server's provider keys stay with admins.
  {
    key: "server.settings", group: "server", memberDefault: false, adminOnly: false,
    label: { en: "Change the server's settings", fr: "Changer les réglages du serveur" },
    description: {
      en: "Change the installation's settings, webhooks, bot defaults and organization policies (Full access, marketplaces and their tokens, GitHub app). It changes security and payment settings for everyone. Who is an admin, tool grants, the interim attach window and the server's provider keys (OpenRouter, OpenAI, Anthropic, voice...) stay with admins.",
      fr: "Changer les réglages de l'installation, les webhooks, les valeurs par défaut des bots et les politiques de l'organisation (accès complet, marchés et leurs jetons, application GitHub). Elle change les réglages de sécurité et de paiement pour tout le monde. Qui est admin, les droits d'outils, la fenêtre de rattachement intérimaire et les clés de fournisseurs du serveur (OpenRouter, OpenAI, Anthropic, voix...) restent aux admins.",
    },
  },
  // 2026-10-22 (JC): the experimental features of the server (Settings >
  // Experimental), delegable on its own. It governs who sees and toggles the
  // early features there (skill authoring, the built-in browser, connected
  // apps, the decision model, the data window, the meeting notetaker). These
  // are server-wide switches, so it is implied by server.settings (a person
  // who may change the settings may always manage the experiments): see
  // server/org-permissions.ts. A person given only this key never reaches any
  // other installation setting.
  {
    key: "server.experimental", group: "server", memberDefault: false, adminOnly: false,
    label: { en: "Manage experimental features", fr: "Gérer les fonctionnalités expérimentales" },
    description: {
      en: "See Settings > Experimental and turn its early features on or off for the whole server (skill authoring, the built-in browser, connected apps, the decision model, the data window, the meeting notetaker). It reaches no other installation setting. Anyone who can change the server's settings already has it.",
      fr: "Voir Réglages > Expérimental et activer ou désactiver ses fonctionnalités en avant-première pour tout le serveur (rédaction de compétences, navigateur intégré, applications connectées, modèle de décision, fenêtre de données, preneur de notes de réunion). Elle n'atteint aucun autre réglage de l'installation. Toute personne qui peut changer les réglages du serveur l'a déjà.",
    },
  },
  {
    key: "server.link", group: "server", memberDefault: false, adminOnly: true,
    label: { en: "Link the server", fr: "Lier le serveur" },
    description: {
      en: "Link or unlink the server to Perspicax and change who may sign in.",
      fr: "Lier ou délier le serveur à Perspicax et changer qui peut se connecter.",
    },
    adminOnlyReason: {
      en: "It decides who can reach the server at all.",
      fr: "Elle décide qui peut joindre le serveur.",
    },
  },
  // 2026-10-09 (Perspicax plan, lot C.1): what a person may do with their
  // bots from an AI client attached to Perspicax (Claude Code, claude.ai,
  // Cursor), through the member API (server/org-member-routes.ts). Each key
  // is checked on top of the rule the same action meets in Sagax.
  {
    key: "clients.botsRead", group: "clients", memberDefault: true, adminOnly: false,
    label: { en: "See their bots and conversations from an AI client", fr: "Voir leurs bots et leurs conversations depuis un client IA" },
    description: {
      en: "List the bots they can use and read their own conversations with them from Claude Code, claude.ai or another client attached to Perspicax.",
      fr: "Lister les bots qu'ils peuvent utiliser et lire leurs propres conversations avec eux depuis Claude Code, claude.ai ou un autre client relié à Perspicax.",
    },
  },
  {
    key: "clients.botsMessage", group: "clients", memberDefault: true, adminOnly: false,
    label: { en: "Message their bots from an AI client", fr: "Écrire à leurs bots depuis un client IA" },
    description: {
      en: "Send a message to a bot they can use from a client attached to Perspicax, under their own name, and wait for its answer.",
      fr: "Envoyer un message à un bot qu'ils peuvent utiliser depuis un client relié à Perspicax, en leur propre nom, et attendre sa réponse.",
    },
  },
  {
    key: "clients.routinesRun", group: "clients", memberDefault: false, adminOnly: false,
    label: { en: "Run routines from an AI client", fr: "Lancer des routines depuis un client IA" },
    description: {
      en: "Run a routine now and follow its run from a client attached to Perspicax. The routine's own Run now rule still applies.",
      fr: "Lancer une routine maintenant et suivre son exécution depuis un client relié à Perspicax. La règle Lancer maintenant de la routine s'applique toujours.",
    },
  },
  {
    key: "clients.approvalsAnswer", group: "clients", memberDefault: false, adminOnly: false,
    label: { en: "Answer approvals from an AI client", fr: "Répondre aux approbations depuis un client IA" },
    description: {
      en: "Allow or deny an approval card they may answer in Sagax, from a client attached to Perspicax.",
      fr: "Autoriser ou refuser une carte d'approbation à laquelle ils peuvent répondre dans Sagax, depuis un client relié à Perspicax.",
    },
  },
  {
    key: "clients.peopleNudge", group: "clients", memberDefault: false, adminOnly: false,
    label: { en: "Nudge people from an AI client", fr: "Faire signe à des personnes depuis un client IA" },
    description: {
      en: "Nudge a person of the organization from a client attached to Perspicax, like the nudge button in Sagax.",
      fr: "Faire signe à une personne de l'organisation depuis un client relié à Perspicax, comme le bouton Faire signe de Sagax.",
    },
  },
  // 2026-10-11: create_agent of the agent-to-agent API (server/agent-api.ts).
  // Off by default: a new bot is lasting, and only the owner deletes it.
  {
    key: "clients.agentsCreate", group: "clients", memberDefault: false, adminOnly: false,
    label: { en: "Create bots from an AI client", fr: "Créer des bots depuis un client IA" },
    description: {
      en: "Create a new bot of their own from a client attached to Perspicax (create_agent), one per call, only when they ask. Only they can delete it, in Sagax.",
      fr: "Créer un nouveau bot à eux depuis un client relié à Perspicax (create_agent), un par appel, seulement à leur demande. Eux seuls peuvent le supprimer, dans Sagax.",
    },
  },
  // Defensive security work (SentinelOne triage and the like). Not a member
  // default and not admin-only: Perspicax grants it on a profile. It does not
  // lift the misuse blocks for escape, malware, destruction or platform files.
  {
    key: "security.triage", group: "security", memberDefault: false, adminOnly: false,
    label: { en: "Do defensive security work", fr: "Faire le travail de défense" },
    description: {
      en: "Review and handle the organization's security alerts (for example SentinelOne triage) through a bot. Does not allow an attack, malware, or reading the platform's own files.",
      fr: "Examiner et traiter les alertes de sécurité de l'organisation (par exemple le triage SentinelOne) par un bot. N'autorise pas une attaque, un programme malveillant, ni la lecture des fichiers internes de la plateforme.",
    },
  },
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof definitions)[number]["key"];

export const PERMISSIONS: readonly PermissionDefinition<PermissionKey>[] = definitions;

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((entry) => entry.key);

const BY_KEY = new Map<string, PermissionDefinition<PermissionKey>>(PERMISSIONS.map((entry) => [entry.key, entry]));

/** Dotted, stable: a group, a dot, a camelCase name. */
export const PERMISSION_KEY_PATTERN = /^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/;

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && BY_KEY.has(value);
}

/** What a plain member holds when Perspicax sends no list. */
export const MEMBER_DEFAULT_PERMISSIONS: readonly PermissionKey[] = PERMISSIONS
  .filter((entry) => entry.memberDefault && !entry.adminOnly)
  .map((entry) => entry.key);

/** The keys no profile grants. */
export const ADMIN_ONLY_PERMISSIONS: readonly PermissionKey[] = PERMISSIONS
  .filter((entry) => entry.adminOnly)
  .map((entry) => entry.key);

export interface NormalizedPermissions {
  /** Known, grantable keys, in catalogue order. */
  granted: PermissionKey[];
  /** Strings that name no key of this catalogue (a newer Perspicax, a typo). */
  unknown: string[];
  /** Known keys a profile may not grant (adminOnly). */
  ignored: PermissionKey[];
}

/** Read a list Perspicax sent: keep the known, grantable keys; report the
 * rest. Never throws. */
export function normalizePermissions(input: unknown): NormalizedPermissions {
  const seen = new Set<string>();
  const unknown: string[] = [];
  const ignored: PermissionKey[] = [];
  if (Array.isArray(input)) {
    for (const value of input) {
      if (typeof value !== "string" || seen.has(value)) continue;
      seen.add(value);
      const definition = BY_KEY.get(value);
      if (!definition) unknown.push(value.slice(0, 64));
      else if (definition.adminOnly) ignored.push(definition.key);
    }
  }
  const granted = PERMISSION_KEYS.filter((key) => seen.has(key) && !BY_KEY.get(key)!.adminOnly);
  return { granted, unknown, ignored };
}

/** Who asks: an organization admin, or a person and what they hold.
 * Undefined is the operator at the server's own computer (everything). */
export interface PermissionPrincipal {
  admin: boolean;
  permissions: ReadonlySet<string> | readonly string[];
}

/** The one question every gate asks. An admin may everything; an adminOnly
 * key is an admin's only; anyone else needs the key in their list. */
export function can(principal: PermissionPrincipal | undefined | null, key: PermissionKey): boolean {
  if (!principal) return true;
  if (principal.admin) return true;
  const definition = BY_KEY.get(key);
  if (!definition || definition.adminOnly) return false;
  const held = principal.permissions;
  return Array.isArray(held) ? held.includes(key) : (held as ReadonlySet<string>).has(key);
}

/** The bot fields a member sets on a bot they own only with a key (on top
 * of MEMBER_BOT_FIELDS in shared/viewer-capabilities.ts, which need
 * bots.create). A field missing here stays an admin's. */
export const BOT_FIELD_PERMISSIONS: Readonly<Record<string, PermissionKey>> = {
  approvalMode: "bots.approvalLevel",
  autoApprove: "bots.approvalLevel",
  acknowledgeLocalAuto: "bots.approvalLevel",
  proactiveMode: "bots.approvalLevel",
  memoryEnabled: "bots.behaviour",
  teamMemorySharing: "bots.behaviour",
  memoryUpkeep: "bots.behaviour",
  voiceNotes: "bots.behaviour",
  emailDrafts: "bots.behaviour",
  fallback: "bots.behaviour",
  parkDirectMessages: "bots.behaviour",
  maxConcurrentThreads: "bots.behaviour",
  maxParallelPerPerson: "bots.behaviour",
  busySend: "bots.behaviour",
  automaticRecovery: "bots.behaviour",
  computer: "bots.computer",
  cloudBackend: "bots.computer",
  autoStartVps: "bots.computer",
  browser: "bots.computer",
  browserProfile: "bots.computer",
  toolScope: "bots.tools",
  mcpServers: "bots.tools",
  mcpAccounts: "bots.tools",
  outbound: "bots.tools",
  peers: "bots.tools",
  approvePeerComms: "bots.tools",
  allowedRecipients: "bots.tools",
  acknowledgePeerScope: "bots.tools",
  visibility: "sharing.visibility",
  section: "sharing.visibility",
  cwd: "folders.botWorkingFolder",
};

/** The label of a key in a language (English unless French). */
export function permissionLabel(key: string, locale = "en"): string {
  const definition = BY_KEY.get(key);
  if (!definition) return key;
  return locale.toLowerCase().startsWith("fr") ? definition.label.fr : definition.label.en;
}

/** The refusal body a gate answers: `{ error: "forbidden", permission }`
 * plus a sentence for older clients that show `message`. */
export function permissionRefusal(key: PermissionKey): { error: "forbidden"; permission: PermissionKey; message: string } {
  return {
    error: "forbidden",
    permission: key,
    message: `Your profile does not include ${permissionLabel(key)}. Ask an admin to add it in Perspicax.`,
  };
}

/** The catalogue as GET /api/org/admin/capabilities returns it. */
export function permissionCatalogue(): { version: number; groups: readonly PermissionGroup[]; permissions: readonly PermissionDefinition<PermissionKey>[] } {
  return { version: PERMISSION_CATALOGUE_VERSION, groups: PERMISSION_GROUPS, permissions: PERMISSIONS };
}

/** The server-wide `features` keys that `server.experimental` governs, i.e.
 * the switches of Settings > Experimental (src/components/settings/
 * ExperimentalSettings.tsx). A person holding only `server.experimental` may
 * PATCH /api/config with these feature keys and nothing else; the client
 * hides every other control from them. The host-reaching feature switches
 * (sharedComputers, claudeUserMcp, vpsComputer, boatComputer) are NOT here:
 * those stay with admins whatever right a delegate holds. Stable: the server
 * refusal and the client gate both read this one list. */
export const EXPERIMENTAL_FEATURE_KEYS: readonly string[] = [
  "skillAuthoring", "browser", "connectedApps", "decisionModel", "dataWindow", "meetingNotetaker",
];

const EXPERIMENTAL_FEATURE_SET = new Set<string>(EXPERIMENTAL_FEATURE_KEYS);

export function isExperimentalFeatureKey(key: string): boolean {
  return EXPERIMENTAL_FEATURE_SET.has(key);
}

/** The first field a `server.experimental`-only caller (no `server.settings`,
 * not an admin) may not send to PUT/PATCH /api/config, or null when the body
 * is a features-only patch touching those experimental keys alone. It lets
 * such a delegate flip the experiments of the server and nothing else. */
export function experimentalOnlyConfigViolation(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body";
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "features") return key;
  }
  const features = record.features;
  if (features === undefined) return null;
  if (!features || typeof features !== "object" || Array.isArray(features)) return "features";
  for (const key of Object.keys(features as object)) {
    if (!EXPERIMENTAL_FEATURE_SET.has(key)) return `features.${key}`;
  }
  return null;
}
