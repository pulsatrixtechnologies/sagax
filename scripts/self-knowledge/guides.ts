// The short how-tos of the sagax_help knowledge base: the only hand-written
// part. Each one answers a question people really ask, in a few sentences,
// and names its references: a tool (`tool:<name>`, must be in the agents
// catalog), a generated section (`setting:`, `card:`, `menu:`,
// `bot-setting:`, `px:`, `engine:`) or a file of this repository
// (`file:<path>`). scripts/self-knowledge/build.ts refuses a guide whose
// reference is gone, so a guide cannot outlive what it describes.
// Fact-checked against the code on 2026-10-19 (Sagax 0.5.29, Perspicax 1.8.40).

export interface Guide {
  id: string;
  title: string;
  where?: string;
  access?: string;
  /** Search words, French and English. */
  keywords: string;
  text: string;
  refs: string[];
}

/** One line more on a Settings page (setting:<id>): what it holds or who sees it. */
export const SETTING_NOTES: Record<string, { text?: string; access?: string }> = {
  account: { text: "Who is signed in (name, photo, label, Sign out), Open at login, About me, language and time zone; then the server, default bot, guided tours and Advanced." },
  security: { text: "The person's own security: security keys and passkeys and the approvals that need one, every approval rule they saved (Always allow, Always deny, Ask first; paged, each revocable) and their own tool access.", access: "everyone, for their own keys, rules and tool access" },
  credentials: { text: "Vault: logins, API keys and notes bots use without seeing them (Import, Export, Add an item, which bot may use each), the one-time card (Shop Pay, Link), purchases waiting for an answer and 1Password.", access: "everyone, for their own vault" },
  providers: { text: "Providers: personal subscriptions and CLI sign-ins, model and voice API keys, compatible OpenAI/Anthropic endpoints, CLI paths and cloud coding agent keys. The same personal accounts serve Models and Voice in solo and organization modes." },
  engines: { text: "Models: active model switches by provider, the Auto explanation and a link to Providers. Web search, image generation and configured online computers keep their controls here; provider sign-ins and general API keys live in Providers." },
  voice: { text: "Voice: the person's speaking and listening providers, read-aloud and voice-note preferences, available voices, paired Mac voices, microphone and provider options. Keys live in Providers; the same OpenAI key serves Live. Installation Live settings stay under Advanced." },
  experimental: { text: "Early features, each off until switched on: Connected apps, Meeting notetaker (Google Meet), skill authoring, browser profiles, data window.", access: "on an organization server, only people who may edit the configuration (admins)" },
  backups: { text: "Export full backup (bots, conversations, settings; no secret), import and restore.", access: "solo: the person; organization: permission backup.workspace (off for members by default), restore stays with admins" },
  computer: { text: "Where bots work: this computer, Local VM, cloud computers, self-hosted VPS, isolation, safety and storage.", access: "solo: the person; organization: admins, and each member for their own server environment" },
  organization: { text: "Join a Perspicax server, connect to or start an organization; on an organization server the admin's policies: Allow full access, member auto-approval, new threads confidential by default, memory." },
  usage: { text: "Tokens and cost this month and over 30 days, by bot and by model.", access: "everyone; it shows the person's own usage only" },
};

export const GUIDES: Guide[] = [
  {
    id: "settings-by-bot",
    title: "Change any setting through a bot",
    where: "bot tool sagax_settings; the same settings on screen (bot editor, Automations, Settings)",
    access: "the person speaking, with their own rights: a member cannot do through a bot what they cannot do by hand",
    keywords: "reglage reglages setting settings modifier changer change niveau approbation approval approuver pour moi auto modele model effort routine horaire schedule fil thread section geree managed built-in persona mascotte skin apparence notifications coffre vault organisation organization",
    text: "Yes: every setting is an action. A bot calls sagax_settings: action list (with a family: bot, thread, routine, group, section, rules, account, appearance, notifications, models, connections, credentials, server, organization, computer) gives the keys, get reads one, set changes it, through the same route the screen calls with the person's own session. The person's own bots and routines (model, effort, approval level up to the bot's own, managed teams such as Built-in, persona, look, routine schedule, conversation, on/off) change at once when the bot is at Approve for me or Full. A secret, a deletion, another person, several people or an organization setting waits for the person's Allow on a card, with their security key when they chose one for that kind; so does anything at Ask, and Full or Custom, unless the person's own Primary Bot makes the change because the person asked for it in their message (it passes quote, their own words): then approval levels (Full included, on an organization server too when the organization allows it and the person may set it themselves), Always allow rules and their removal run at once on any of the person's bots, the Primary Bot itself included (a key they chose, a secret, another person and the organization keep their card). Every change is written to the admin journal (setting.change). The full inventory is docs/settings-actions.md.",
    refs: ["tool:sagax_settings", "file:server/settings-actions.ts", "file:shared/settings-actions.ts", "file:docs/settings-actions.md"],
  },
  {
    id: "plugins",
    title: "Install a plugin for a bot",
    where: "sidebar Capabilities (Capacités), scope For <bot> (Pour <bot>)",
    access: "the bot's owner or someone who manages it; organization: a write waits for an admin, and an admin may limit marketplaces",
    keywords: "plugin plugins greffon installer install marketplace extension ajouter",
    text: "Yes, a bot can install a plugin itself with the act tool and its plugins parameter: list, addMarketplace, install (also updates), setEnabled, uninstall, removeMarketplace. Each write waits for the person's Allow on a card unless the bot's approval mode is auto or full. On an organization server a write (install, enable, uninstall, a marketplace) still waits for an admin, who may also restrict marketplaces. Listing plugins on the member's own bot does not. Hooks, MCP servers, LSP and bin/ of a plugin are removed. The person can also do it in the sidebar's Capabilities, scope For <bot>.",
    refs: ["tool:act", "file:server/bot-plugins.ts", "file:shared/permissions.ts"],
  },
  {
    id: "voice-team",
    title: "Give voice mode (xAI) to a team or to people",
    where: "Perspicax console > Access > Bot rights (Accès > Droits sur les bots), tab Who has what (Qui a quoi), /sagax/permissions?tab=assign",
    access: "Perspicax admins only; a bot cannot do it",
    keywords: "voix vocal mode voix voice mode xai equipe team teams donner assigner moteur engine membres",
    text: "An admin does it in the Perspicax console: Access > Bot rights, tab Who has what; pick the teams or people, then give the engine Voice mode (xAI) (Mode voix (xAI)). A person's rights are the union of their own and their teams'. One person can also get it on their sheet. On the Sagax organization server the organization's xAI key then serves voice to admins and to the people given that engine. The personal xAI key is in Settings > Providers. In solo mode each person sets their own voice engine in Settings > Voice.",
    refs: ["px:console:/sagax/permissions", "setting:engines", "file:server/org-xai-media.ts", "file:docs/voice-mode-xai.md"],
  },
  {
    id: "cloud-agents",
    title: "Launch a cloud coding agent",
    where: "bot tool launch_cloud_agent; keys in Settings > Providers > Cloud coding agents (Agents de codage cloud)",
    access: "organization: a member's call waits for an admin",
    keywords: "agent cloud agents nuage lancer launch cursor codex claude coding code pr pull request",
    text: "Yes, with launch_cloud_agent, then follow it with get_cloud_agent, cloud_agent_follow_up, cloud_agent_transcript, cancel_cloud_agent. Providers: perspicax (organization server linked to Perspicax, uses the person's sign-in, no key), cursor, claude and codex (the person's own key in Settings > Providers > Cloud coding agents). Without a sign-in or key the launch is refused with the reason. On an organization server the tool is host-level: a member's call waits for an admin.",
    refs: ["tool:launch_cloud_agent", "tool:get_cloud_agent", "tool:cloud_agent_follow_up", "setting:providers", "file:server/cloud-agents"],
  },
  {
    id: "routines-where",
    title: "Where routines are",
    where: "account menu (avatar, bottom of the sidebar) > Automations (Automatisations); a bot's panel > Details > Routines",
    keywords: "routines routine ou sont where automations automatisations calendrier calendar planifiees scheduled",
    text: "In Sagax: the account menu (the person's avatar at the bottom of the sidebar) > Automations opens the routines calendar (upcoming runs, webhooks). One bot's routines are in its panel > Details > Routines, with an on/off switch per routine. A bot reads its own with list_routines and runs one with run_routine. On an organization server, the Perspicax console also lists them: Bots > Routines (/sagax/routines), for every person (their own).",
    refs: ["menu:sidebar.nav.automations", "tool:list_routines", "tool:run_routine", "px:console:/sagax/routines"],
  },
  {
    id: "routine-folders",
    title: "Sort routines into folders",
    where: "bot panel > Details > Routines; bot tools propose_routine and propose_routine_action (folder)",
    keywords: "routine routines dossier dossiers folder folders ranger trier sort prefix prefixe groupe group organiser organize",
    text: "Yes: a bot's routines can sit in folders. In the bot's panel > Details > Routines, a row's menu (right click or its ...) has Move to folder, New folder... and Remove from folder; a folder's header folds, and its menu renames, reorders, pauses or resumes the whole folder, or deletes the folder (its routines stay, in no folder). When titles start with [Name], a line offers Sort by prefix once, with an Undo. A bot files its own routine with folder on propose_routine or propose_routine_action (null takes it out) and sees it in list_routines; never write the folder as a [Prefix] in the name. The person does it on their own bots, no admin.",
    refs: ["tool:propose_routine", "tool:propose_routine_action", "tool:list_routines", "file:docs/routine-folders.md"],
  },
  {
    id: "routine-create",
    title: "Create a routine (every morning, every weekday)",
    where: "bot tool propose_routine; also Automations in the account menu",
    keywords: "routine creer create planifier schedule chaque matin every morning 8h cron recurring recurrente tache task",
    text: "Yes: propose_routine with a cron schedule and an IANA time zone. A routine for the bot itself applies at once with an Undo, at any approval level (up to 20 enabled routines). A routine for another bot stays a card the person confirms, unless Full access is on. The person can also create and edit routines in Automations (account menu).",
    refs: ["tool:propose_routine", "file:server/direct-apply.ts", "menu:sidebar.nav.automations"],
  },
  {
    id: "zip",
    title: "Read a .zip or other archive",
    keywords: "zip archive archives tar gz 7z lire read fichier compresse decompresser unzip piece jointe attachment",
    text: "Yes, when the person attaches it in the chat: the bot gets the archive and a manifest of its files (zip, tar, tar.gz, 7z), then reads the files with its tools. Solo: unpacked next to the upload. Organization: listed on the host, then copied and unpacked where the bot's tools run (its server environment, or the person's computer through the desktop app) at its first tool call. Limits: 5,000 files, 512 MB unpacked, 200:1 ratio.",
    refs: ["file:server/attachment-archives.ts", "file:electron/archive-extract.mjs"],
  },
  {
    id: "attachment-upload-recovery",
    title: "Attach a large file or retry an interrupted upload",
    keywords: "attachment upload retry interrupted large file video fichier piece jointe televersement reprendre reessayer",
    text: "Attach or drop a file in the composer. Documents, audio and archives accept up to 250 MB each; videos accept up to 1 GB. Pictures keep 32 MB on a shared host and 90 MB on a solo host. Files larger than 4 MB upload in resumable chunks with progress. Removing the chip cancels the upload; Retry upload resumes the acknowledged bytes of that same file, including after the server restarts. The file is committed only after its content checks pass. Existing buffered previews have a separate 25 MB shared or 90 MB solo limit. Archives keep their unpacked-size and path rules. No extra administrator action is needed to attach your files.",
    refs: ["file:server/attachments.ts", "file:src/lib/attachment-uploads.ts"],
  },
  {
    id: "create-bot",
    title: "Create a new bot",
    keywords: "creer create nouveau new bot bots agent assistant",
    text: "A Primary Bot has create_bot; another bot gets it when it may create bots for its person (not hidden, not temporary, owner not read-only). Only on the person's own request, at most 6 bots made by bots per person per hour. Below Full access the person approves a card; the new bot starts with connected apps and automatic approvals off. On an organization server a member creates bots for themselves only (permission bots.create, on by default). The person can always create one from the sidebar.",
    refs: ["tool:create_bot", "file:server/bot-creation.ts", "file:shared/permissions.ts"],
  },
  {
    id: "mcp-server",
    title: "Add an MCP server",
    where: "sidebar Capabilities (Capacités) > Installed (Installées)",
    access: "organization: admin tier; Perspicax admins may limit servers in Settings > Organisation > Allowed MCP servers",
    keywords: "mcp serveur server ajouter add connecteur connector outil tool",
    text: "Partly: add_mcp_server saves the server switched off, only when the person asked. The bot cannot enable, test or edit it: the person turns it on in the sidebar's Capabilities > Installed. On an organization server it is an admin-tier action, and the Perspicax admin may limit which servers are allowed (Perspicax Settings > Organisation > Allowed MCP servers).",
    refs: ["tool:add_mcp_server", "card:myConnections.servers", "px:settings:org.mcp"],
  },
  {
    id: "voice-note",
    title: "Send a voice note",
    where: "voice engine in Settings > Voice; the bot's voice in Edit bot > Model and tools > Voice & alerts",
    keywords: "note vocale voice note audio message vocal voix parler speak",
    text: "Yes with send_voice_note, but only when a voice is configured: a voice engine with its key and a voice for the bot or the app, and the bot's voice notes not turned off. Otherwise the tool is not offered. On an organization server using the organization's xAI key, only for people given Voice mode (xAI).",
    refs: ["tool:send_voice_note", "setting:engines", "bot-setting:voice"],
  },
  {
    id: "model-change",
    title: "Change a bot's model",
    where: "Edit bot (Modifier le bot) > Model and tools > Model; for one conversation, the composer's model picker",
    keywords: "modele model changer change moteur engine effort claude codex grok opus sonnet",
    text: "The person opens the bot, Edit bot > Model and tools > Model (engine, model, effort). One conversation's model changes in the composer's model picker. The bot can do it too with propose_model: a change to itself applies at once with an Undo; existing conversations keep their model.",
    refs: ["bot-setting:model", "tool:propose_model"],
  },
  {
    id: "confidential",
    title: "Make a conversation confidential",
    where: "new thread menu > New confidential thread; thread menu > Make confidential (Rendre confidentiel)",
    keywords: "confidentiel confidentielle confidential prive private secret conversation fil thread",
    text: "The person does it: the new thread menu > New confidential thread (Nouveau fil confidentiel), or an existing thread's menu > Make confidential (permanent, after a confirmation). A confidential conversation is kept to its owner: other people, admins and bots outside it do not read it, and it is answered in the Sagax app only. On an organization server an admin may make new threads confidential by default (Settings > Organization). A thread working in a shared folder cannot be converted.",
    refs: ["file:docs/confidential-threads.md", "setting:organization"],
  },
  {
    id: "meetings",
    title: "Join a meeting and take notes",
    where: "Settings > Experimental > Meeting notetaker (Google Meet)",
    access: "organization: Experimental is for admins",
    keywords: "reunion meeting teams zoom google meet notes prendre rejoindre join transcription",
    text: "Google Meet only: Microsoft Teams and Zoom links are recognized but not supported. With Settings > Experimental > Meeting notetaker (Google Meet) on, in a direct conversation, the bot has join_meeting, which shows the person a consent card first.",
    refs: ["tool:join_meeting", "setting:experimental", "file:shared/meeting-links.ts"],
  },
  {
    id: "usage",
    title: "See token usage and cost",
    where: "account menu > Usage > View usage (Utilisation > Voir l'utilisation), which opens Settings > Usage",
    keywords: "consommation usage jetons tokens cout cost facture billing forfait plan depense spend",
    text: "Account menu (avatar) > Usage > View usage opens Settings > Usage: this month and the last 30 days, by bot and by model; everyone sees their own usage. One bot: Edit bot > Activity > Usage. Organization totals: Perspicax console > Organization > Usage and cost (/usage), for managers and admins.",
    refs: ["menu:sidebar.account.viewUsage", "setting:usage", "bot-setting:usage", "px:console:/usage"],
  },
  {
    id: "primary-cards",
    title: "Have a bot answer or cancel approval cards, or the Primary Bot turn them off",
    where: "bot tool sagax_approvals in a conversation with any bot the person owns; sagax_settings with their Primary Bot",
    access: "the person's own message to a bot they own; never another agent's text, a tool result, a routine, a webhook, an email, a page or a note; a temporary agent does not answer cards; turning cards off stays with their Primary Bot",
    keywords: "carte cartes approbation approval approuve approuver vas-y oui permettre toujours always allow refuse deny annule cancel tour desactiver disable cartes plus de cartes bot principal primary bot nova maya demande au nom de on behalf",
    text: "Yes. When the person asks any bot they own (\"approuve-la\", \"oui\", \"ouais\", \"ok\", \"vas-y\", \"allez-y\", \"go\", \"yeah\", \"annule-la\"), that bot calls sagax_approvals: list gives the cards waiting on that person (any of their bots, rooms, bot-to-bot work) with a short handle, answer gives allow, always_allow, always_allow_this, deny, always_deny or answer (a question), cancel stops that card's turn. It passes quote, the person's own words from their message: words from a tool, an email, a page, another bot or a note never count, and a card raised after the person spoke is never answered. A bare \"oui\", \"vas-y\" or \"approuve\" that names no card answers the latest card the person saw, however long their message and however many cards wait (one card per message; in a long message it must be about a card), and the bot tells them which one. A card of the person's own confidential thread is answered too, without its words reaching the answering bot. The answer is the click's own (same rules, same Always allow rule), the card reads \"via <bot>\" and the admin journal names the bot and the message. Only a card that needs the person's physical security key stays theirs to answer in Sagax: the bot cannot touch the key. To stop the cards altogether, their Primary Bot uses sagax_settings with quote: bot.approvalMode (Full included, also on an organization server when the organization allows Full and the person may set it themselves, and also for itself while it answers: from their next message), thread.approvalMode for a conversation that keeps its own level, rules.custom, rules.owner, rules.ownerDelete; they run at once. Another bot cannot turn the cards off from those words.",
    refs: ["tool:sagax_approvals", "tool:sagax_settings", "file:server/primary-approvals.ts", "file:shared/primary-request.ts"],
  },
  {
    id: "approvals",
    title: "Stop asking approval for every command (approval mode, Full access)",
    where: "the icon left of the message field, or Edit bot > Security > Permissions",
    access: "the person, or their Primary Bot when they ask it (sagax_settings with quote); organization: Full access off until an admin allows it, and Ask/Auto choice needs bots.approvalLevel (off for members by default)",
    keywords: "approbation approval approuver approve demander ask auto full access acces complet permission commande command carte card mode",
    text: "The person chooses the bot's approval level: the icon left of the message field, or Edit bot > Security > Permissions. The level belongs to the bot: every conversation, routine and delegated run uses its current level, and a conversation keeps its own only when the person chose one in it. Approve for me (Approuver à ma place) uses the provider's automatic review (Codex, Claude, Cursor, Grok) to approve routine actions and ask about others; Full access (Accès complet) runs commands and edits without cards, set from the packaged desktop app only; real questions and missing credentials still ask. Custom auto-review rules can allow specific commands. On an organization server Full access stays off until an admin turns on Allow full access (Settings > Organization, or Perspicax Settings > Bots > Policies), and a member needs bots.approvalLevel (Perspicax Access > Bot rights) to switch between Ask and Auto.",
    refs: ["bot-setting:permissions", "setting:organization", "file:docs/approval-levels.md", "px:console:/sagax/permissions"],
  },
  {
    id: "computer",
    title: "Use the person's computer (Mac, PC)",
    where: "Settings > Computer; the bot's Workspace (Edit bot > Model and tools > Workspace)",
    keywords: "ordinateur computer mac pc controler control utiliser use ecran screen souris mouse clavier keyboard desktop bureau computer use",
    text: "Yes, from the desktop app (macOS, or packaged Ubuntu x64): select_computer with surface local, then computer use. On an organization server only the person's own computer, through the desktop bridge while their desktop app is connected, and only when the bot's Workspace allows This computer or Local VM. Otherwise the bot works in its cloud computer or server environment. Not from iOS: the phone only shows a still of the screen with Play, Pause and Stop.",
    refs: ["tool:select_computer", "setting:computer", "bot-setting:worksOn", "file:docs/computer-use-integration.md"],
  },
  {
    id: "backups",
    title: "Back up bots and conversations",
    where: "Settings > Backups > Export full backup (Réglages > Sauvegardes > Exporter une sauvegarde complète); one bot: its actions menu > Export the bot (.zip)",
    access: "organization: permission backup.workspace (off for members by default); restoring stays with admins",
    keywords: "sauvegarde backup exporter export restaurer restore bots conversations zip copie",
    text: "Settings > Backups > Export full backup saves bots, conversations and settings (never a secret: keys and tokens are left out). One bot: its actions menu > Export the bot (.zip), optionally with its conversations. On an organization server the page needs the backup.workspace permission, and restoring stays with admins.",
    refs: ["setting:backups", "file:docs/bot-package.md", "file:shared/permissions.ts"],
  },
  {
    id: "triggers",
    title: "Start work on an outside event (GitHub, webhook)",
    where: "account menu > Automations > Webhooks",
    access: "organization: server.settings (admin)",
    keywords: "webhook declencheur trigger github gitlab ticket issue evenement event slack sentry pagerduty linear demarrer start",
    text: "A webhook starts a task from outside: Automations (account menu) > Webhooks creates one with a bearer token shown once. Each webhook runs its task on the bot's own computer (This computer or its cloud computer), not on the organization's server. Typed triggers verified by the provider's own signature (GitHub, GitLab, Slack, Microsoft Teams, Outlook, Sentry, PagerDuty, Linear) exist on the server, but the app has no button to open their panel yet: say so rather than promising it. A bot cannot create either without the person's Allow (act on POST /api/webhooks). On an organization server a person creates and manages a webhook on the bot's own computer themselves, no admin and no server.settings needed; only a Microsoft trigger (it names a mailbox sign-in) or a webhook that would run on the organization's server is an admin's.",
    refs: ["menu:sidebar.nav.automations", "tool:act", "file:shared/trigger-sources.ts", "file:server/webhooks.ts"],
  },
  {
    id: "pages",
    title: "Publish a web page to share",
    where: "bot tool propose_page; manage in Capabilities > Pages (Capacités > Pages)",
    keywords: "page web publier publish partager share lien link site html canevas canvas",
    text: "The bot proposes it with propose_page; the person reviews it on the card and decides whether to publish and who sees it (only them, the organization, or anyone with the link). Not available in rooms. Published pages are managed, shared or revoked in Capabilities > Pages.",
    refs: ["tool:propose_page"],
  },
  {
    id: "mobile",
    title: "Use Sagax on an iPhone or iPad",
    keywords: "iphone ipad ios telephone phone mobile cellulaire application app store testflight appairer pair",
    text: "A native iOS companion app exists and pairs with the Mac or the server by QR code; there is no public App Store link yet (the account menu's Get Sagax on mobile entry stays hidden until one exists). Pairing is offered in the welcome flow's phone step, and an admin's bot can create a pairing code with manage_pairing. Another way: the phone web app (Add to Home Screen). On iOS, computer use is view-only.",
    refs: ["file:docs/ios-companion.md", "file:docs/phone-web-app.md", "tool:manage_pairing", "menu:sidebar.account.mobile"],
  },
  {
    id: "solo-vs-org",
    title: "Solo Sagax and organization (Perspicax) differences",
    keywords: "solo organisation organization perspicax admin membre member difference entreprise business",
    text: "Solo: a person's own Sagax; they hold every setting. Organization: a Sagax server linked to Perspicax (Sagax Business); people sign in with Perspicax, admins manage people, teams, bot rights, engines, routines and usage in the Perspicax console. A member's bot runs its commands, code and files on its OWN computer by default (its server environment (sagax-environment), its owner's own computer or Local VM (sagax-desktop), or its cloud computer), under the owner's own approval level, never assuming the shared organization server. The engine's host shell (a Bash or shell command on the shared server) is an admin's: only an admin targets the organization's server, so run commands on the bot's own computer instead. Host-level tools (add_mcp_server, attach_file, vm_exec, shared_computer, the cloud agent tools) also run only after an admin's approval. A read-only act on the member's own bot does not wait for an admin; a write through act, or act on someone else's bot, does. Perspicax also serves the organization's products (ConnectWise and others) to bots through api_list, api_search and the profile tools.",
    refs: ["file:server/member-tool-scope.ts", "px:console:/sagax/permissions", "tool:api_list"],
  },
  {
    id: "admin-asks",
    title: "What a member must ask an admin for",
    keywords: "admin administrateur demander ask permission droit right membre member refuse refused bloque blocked",
    text: "On an organization server a member asks an admin for: host-level bot tools (a write through act, including settings and plugins, or act on someone else's bot, add_mcp_server, attach_file, vm_exec, the cloud agent tools), a command on the organization's server itself (the engine's host shell), Full access, organization engines such as Voice mode (xAI), backups, Experimental features and Connected apps, and server settings. A member does NOT need an admin for a read-only act on their own bot, to run commands on the bot's own computer (its server environment, Local VM, This computer or cloud computer), or to create a webhook on the bot's own computer: those are the owner's own. The admin grants rights in the Perspicax console > Access > Bot rights, per person or team; a pending admin approval shows in Perspicax To do (À traiter).",
    refs: ["file:docs/member-admin-audit.md", "px:console:/sagax/permissions", "px:console:/inbox"],
  },
  {
    id: "remote-support",
    title: "Open a remote support session (Tailcat) for an end user",
    where: "a bot's conversation, on an organization server linked to Perspicax 1.8.43 or later",
    access: "a person holding the remote support permission in Perspicax (granted by an admin to the person or a team), with remote support turned on for the organization",
    keywords: "assistance a distance remote support session tailcat prise en main controle a distance depannage client utilisateur end user code lien support page aide donne-moi le lien",
    text: "A person asks in one sentence for the link for their client (donne-moi le lien pour mon client). Fast path, at most three calls, no schema search, no cloud fallback. (1) remote_support_open with no key and no template, rights standard (a session without administrator rights) unless the person asks for elevated. Sagax creates a new key for this session only on this computer (the desktop PC, or the bot's cloud computer), keeps the private key there, never sends it, and deletes it when the session is closed or past its end. Perspicax signs a short grant (at most one hour, renewed while the session runs) that lets only that key in, on that one computer. Optional: scope (full-control by default, view-only or shell-only) and call_ref (the phone call or ticket that records the person's consent). Your first reply gives the link, the code and the normal PowerShell line exactly as the tool answered it, inside a powershell code fence (the macOS or Linux line in a sh fence). Never pass that line through a shell on this computer (echo, pbcopy, a here-doc): a Mac shell eats its $ variables. (2) Sagax watches the session by itself: as soon as the end user's computer joins, it connects it and posts the session card in the chat, without the person saying anything. Call remote_support_status only to check: fetch_ip_count must be exactly 1, one address took the script. Above 1 the code leaked: remote_support_close with cancelled and open a new one. (3) That status call connects this computer on the technician side with the local key and marks the session connected. If it still says started, call it once more. The session then appears by itself in the bot panel (Remote sessions, Sessions à distance) and as a card in the chat: computer, user, rights, code, serial, model, processor, memory, disk, with Shell, Send a file and Download. Prendre le contrôle shows the screen in the Computer tab. Do not write a screenshot (jpg or png) to the Desktop or anywhere else, and do not open Preview: the screen is drawn in Sagax. Never expose the person's own computer: no tailcat serve, no exit node, no file sharing, no tunnel back to it. Do not ask anyone for a nodekey. Sagax ships tailcat 0.7.0 beside the app and in the server image. Do not download tailcat and do not copy it into a system directory. The address stays on this computer and is not repeated. Defaults: the technician shown is the person's name and the organization, the session ends in 2 hours (never past 24), the support page detects the OS. Always close at the end (ended, or cancelled if it never connected). The tools need a Perspicax profile mounted for the person speaking. remote_support_disabled means an admin has not turned remote support on.",
    refs: ["tool:remote_support_open", "tool:remote_support_status", "tool:remote_support_close", "file:server/perspicax-mcp.ts"],
  },
];
