// Every desktop surface the reference capture visits, in order.
//
// A surface: { nn, id, phase, open(ctx), skins?, density?, note?, keepPointer?, settleMs? }
// - `open` starts from a fresh load with Ara selected (Ara's chat on screen)
//   and opens the surface the way the renderer itself does: a store action
//   its buttons dispatch, or real pointer and keyboard events. It returns
//   { skip: "why" } when the surface does not exist in this build/fixture.
// - `phase` picks the server's first-run state (PHASES below).
// - `skins: "all"` captures it once per skin (the main screen).
// - `org: true`: exists only on an organization server; captured by the
//   organization pass (capture-desktop.mjs --org, ios/parity/org-fixture.mjs)
//   and left out of the solo pass.
// - `served: true`: drawn as a page the server serves (a browser, or the
//   desktop app on another server: the bridge without remoteClient), on the
//   solo fixture; the section exists only there.
//
// Injected transcript messages (cards, markdown) exist only in the page's
// store: nothing is written to the fixture server.

import { jsLiteral } from "../../../scripts/testing/js-literal.mjs";

export const SKIN_IDS = [
  "pulsatrix", "pulsatrix-light", "midnight", "atelier", "foundry", "lagoon",
  "graphite", "linen", "dusk", "daylight", "retro98",
];

const ALL_TOUR = ["tour.composer", "tour.model", "tour.computer", "tour.computer-browser", "tour.tools", "tour.apps", "tour.apps-panel", "tour.automations", "tour.automations-page", "tour.done"];
const ALL_SPOTS = ["spot.composer", "spot.model", "spot.approval", "spot.connector", "computer", "apps", "cloud-first-turn"];
const DONE = { completedAt: "2026-01-01T00:00:00.000Z", version: 1 };

/** First-run state per phase, sent with PUT /api/config (sections merge). */
export const PHASES = [
  { id: "welcome", config: null } /* the fixture's fresh state */,
  { id: "tour", config: { onboarding: { ...DONE, hintsSeen: ALL_SPOTS } } },
  { id: "main", config: { onboarding: { ...DONE, hintsSeen: [...ALL_SPOTS, ...ALL_TOUR] } } },
];

// ── helpers ─────────────────────────────────────────────────────────────
const lastMessageOf = (ctx, name) => ctx.store(`
  const b = s.bots.find((x) => x.name === ${jsLiteral(name)});
  const m = b.messages || [];
  return { threadId: b.threadId, botId: b.id, parentId: m.length ? m[m.length - 1].id : null, at: m.length ? m[m.length - 1].at : Date.now() };
`);

async function inject(ctx, name, messages) {
  await ctx.waitFor(`(__parity.state().bots.find((b) => b.name === ${jsLiteral(name)})?.messages || []).length > 0`, { timeoutMs: 15_000 });
  let { threadId, parentId, at } = await lastMessageOf(ctx, name);
  let i = 0;
  for (const message of messages) {
    const id = `parity-desktop-${++i}`;
    at += 60_000;
    await ctx.dispatch({ type: "messageAdded", threadId, message: { id, at, parentId, ...message } });
    parentId = id;
  }
  await ctx.sleep(500);
}

const MARKDOWN = [
  "Voici le tableau de remplacement demandé, avec un exemple de code :",
  "",
  "| Poste | Responsable | Échéance | État |",
  "| --- | --- | --- | --- |",
  "| Sauvegarde | Ara | 3 oct. | Fait |",
  "| Migration | Keepler | 10 oct. | En cours |",
  "| Documentation | Lux | 17 oct. | À faire |",
  "",
  "```ts",
  "export function prochainLundi(date: Date): Date {",
  "  const jour = date.getDay();",
  "  const ecart = (8 - jour) % 7 || 7;",
  "  return new Date(date.getTime() + ecart * 86_400_000);",
  "}",
  "```",
  "",
  "1. **Gras** et *italique* pour la forme.",
  "2. Un lien : [documentation](https://docs.example.com).",
  "",
  "> Une citation courte, en texte de remplacement.",
].join("\n");

async function openPanel(ctx, section) {
  await ctx.dispatch({ type: "toggleSettings", open: true, ...(section ? { section } : {}) });
  await ctx.waitFor(`Boolean(document.querySelector("[data-panel-tab]"))`, { timeoutMs: 8_000 });
  await ctx.sleep(400);
}

async function openSettings(ctx, section, { retries = 0 } = {}) {
  await ctx.dispatch({ type: "toggleAppSettings", open: true, section });
  await ctx.sleep(600);
  // A section gated on an answer still on its way (who the viewer is, the
  // edition) is not listed yet on the first render, and the page falls back
  // to the first one: ask again once the answer is in.
  for (let i = 0; i < retries && (await ctx.eval(`__parity.state().appSettingsSection ?? null`)) !== section; i++) {
    await ctx.sleep(700);
    await ctx.dispatch({ type: "toggleAppSettings", open: true, section });
    await ctx.sleep(600);
  }
  const shown = await ctx.eval(`(() => { const el = document.querySelector('[aria-current="page"]'); return el ? el.innerText.trim() : null; })()`);
  return shown;
}

// ── the surfaces ────────────────────────────────────────────────────────
const S = [];
const add = (surface) => S.push(surface);

// first run
// 2026-11-04: a local first run is GuidedFirstRun (WelcomeGate.tsx: "Your
// model providers", step 1 of 3, under the once-per-account terms); the
// "Welcome to" flow and its hand-off to the guided tour are a hosted
// workspace's only. The tour itself opens from Settings or the command
// palette (`toggleTour`).
add({ id: "onboarding-welcome", phase: "welcome", note: "first run: guided first run, step 1 (model providers)",
  open: async (ctx) => { await ctx.waitFor(`/Step 1 of/.test(document.body.innerText)`, { timeoutMs: 20_000 }); await ctx.sleep(600); } });
add({ id: "onboarding-tour", phase: "tour", note: "guided tour, first spotlight (composer), replayed",
  open: async (ctx) => {
    await ctx.dispatch({ type: "toggleTour", open: true });
    await ctx.waitFor(`/Step 1 of/.test(document.body.innerText)`, { timeoutMs: 15_000 });
    await ctx.sleep(600);
  } });

// the main window
add({ id: "main", phase: "main", skins: "all", note: "main window: sidebar (comfortable) + Ara's chat", open: async () => {} });
add({ id: "main-compact", phase: "main", density: "compact", note: "sidebar density compact", open: async () => {} });
add({ id: "main-collapsed", phase: "main", density: "icons", note: "sidebar collapsed to the 80 pt icon rail", open: async () => {} });
add({ id: "main-threads", phase: "main", localStorage: { "omb-show-threads": "1" }, note: "Appearance > Show threads on: the sidebar's thread tree", open: async () => {} });
add({ id: "sidebar-row-hover", phase: "main", keepPointer: true, note: "pointer over a sidebar row: its actions appear",
  open: async (ctx) => {
    // the row itself (BotListItem's data-sidebar-bot-row), approached in
    // two moves so the pointer enters it as a hand would
    const aurora = await ctx.bot("Aurora");
    const row = `[data-sidebar-bot-row="${aurora.id}"]`;
    await ctx.waitFor(`Boolean(document.querySelector(${jsLiteral(row)}))`, { timeoutMs: 8_000 });
    await ctx.hover("[data-sidebar-row-name]");
    await ctx.hover(row);
    await ctx.sleep(400);
  } });
add({ id: "sidebar-bot-menu", phase: "main", note: "a bot row's actions menu (the same items as its context menu)",
  open: async (ctx) => { await ctx.hover('[aria-label="Actions for Aurora"]'); await ctx.click('[aria-label="Actions for Aurora"]'); } });
add({ id: "sidebar-bot-context-menu", phase: "main", note: "right-click on a bot row",
  open: async (ctx) => { await ctx.rightClick({ text: /^Helix/, tag: "[role=button],button,a,li" }); } });
add({ id: "sidebar-section-menu", phase: "main", note: "right-click on a section header (sections editing)",
  open: async (ctx) => { await ctx.rightClick({ text: /^Administration$/i, tag: "button,[role=button],h2,h3,div,span" }); } });
add({ id: "sidebar-profile-menu", phase: "main", note: "the account menu (sidebar footer)",
  open: async (ctx) => { await ctx.click('[aria-label="Parity Person"]'); } });
add({ id: "sidebar-new-menu", phase: "main", note: "sidebar New (+): compose-to picker (also Cmd-N)",
  open: async (ctx) => { await ctx.click('[aria-label="New"]'); } });
add({ id: "new-group", phase: "main", note: "compose-to picker in group mode (new group chat)",
  open: async (ctx) => {
    await ctx.click('[aria-label="New"]');
    const ok = await ctx.exists({ text: /group/i, tag: "button,[role=tab],[role=button]" });
    if (!ok) return { skip: "no group mode control in the compose-to picker" };
    await ctx.click({ text: /group/i, tag: "button,[role=tab],[role=button]" });
  } });
add({ id: "search-palette", phase: "main", note: "command palette (Cmd-K), empty",
  open: async (ctx) => { await ctx.key("k", ["Meta"]); await ctx.sleep(300); } });
add({ id: "search-palette-query", phase: "main", note: "command palette with a query (bots, rooms, transcript hits)",
  open: async (ctx) => { await ctx.key("k", ["Meta"]); await ctx.sleep(300); await ctx.type("sauvegarde"); await ctx.sleep(1200); } });

// chat
add({ id: "chat-top", phase: "main", note: "Ara's transcript scrolled to the top (links, day separators)",
  // twice: a late engines or achievements answer re-pins the transcript to its end
  open: async (ctx) => { for (let i = 0; i < 2; i++) { await ctx.scrollTo({ text: /^Peux-tu me donner les liens/ }, "start"); await ctx.sleep(700); } } });
add({ id: "chat-attachments", phase: "main", note: "image and file attachments in the transcript",
  open: async (ctx) => { for (let i = 0; i < 2; i++) { await ctx.scrollTo({ text: /^Les deux captures de remplacement/ }, "center"); await ctx.sleep(700); } } });
add({ id: "chat-markdown", phase: "main", note: "bot reply with a markdown table, code block, list and quote (injected)",
  open: async (ctx) => { await inject(ctx, "Ara", [{ role: "user", kind: "text", text: "Montre-moi le tableau." }, { role: "bot", kind: "text", text: MARKDOWN, turnTerminal: true }]); } });
add({ id: "chat-approval", phase: "main", note: "approval card (command permission ask, injected)",
  open: async (ctx) => {
    await inject(ctx, "Ara", [
      { role: "user", kind: "text", text: "Pousse la sauvegarde." },
      { role: "bot", kind: "options", card: { title: "Run a command?", subtitle: "git push origin main", options: ["Deny", "Always allow", "Allow once"], requestId: "parity-req-1", tool: "Bash", allowKey: "Bash:git", commandAllowlist: { command: "git push origin main", cwd: "/workspace/fixture", providerInstanceId: "claude" } } },
    ]);
  } });
add({ id: "chat-question", phase: "main", note: "question card (AskUserQuestion, injected)",
  open: async (ctx) => {
    await inject(ctx, "Ara", [
      { role: "user", kind: "text", text: "Planifie la sauvegarde." },
      { role: "bot", kind: "options", card: { title: "Question", subtitle: "", options: ["Dimanche soir", "Lundi matin", "Chaque jour"], requestId: "parity-req-2", tool: "AskUserQuestion",
        questionRequest: { version: 1, questions: [{ question: "Quand faut-il refaire la sauvegarde ?", header: "Horaire", multiSelect: false, options: [
          { label: "Dimanche soir", description: "Une fois par semaine, à 21 h." },
          { label: "Lundi matin", description: "Avant la réunion d'équipe." },
          { label: "Chaque jour", description: "À 2 h, en dehors des heures de travail." },
        ] }] } } },
    ]);
  } });
add({ id: "chat-message-hover", phase: "main", keepPointer: true, note: "pointer over a bot reply: its action row",
  open: async (ctx) => { await ctx.hover({ text: /^Veux-tu que je refasse/, tag: "p,div" }); } });
add({ id: "chat-composer-draft", phase: "main", note: "composer focused with a multi-line draft",
  open: async (ctx) => {
    await ctx.click('textarea, [contenteditable="true"]');
    await ctx.type("Brouillon de remplacement : vérifie la sauvegarde de dimanche\net envoie le résumé à l'équipe.");
  } });
add({ id: "chat-composer-slash", phase: "main", note: "composer slash-command popup",
  open: async (ctx) => { await ctx.click('textarea, [contenteditable="true"]'); await ctx.type("/"); await ctx.sleep(500); } });
add({ id: "chat-export-menu", phase: "main", note: "chat header: More options menu (Copy as Markdown, Export, Inspector)",
  open: async (ctx) => { await ctx.click('[aria-label="More options"]'); } });
// 2026-11-04: the composer has no model control left (its + menu is Attach
// files and Teach a task; the headless menu has no trigger). The model picker
// is the model window (ModelWindowHost, src/lib/model-window.ts), the one the
// persona's Model tab and an access card open: opened on Ara here.
add({ id: "chat-model-picker", phase: "main", note: "the model window on Ara (ModelWindowHost: engines and models)",
  open: async (ctx) => {
    const ara = await ctx.bot("Ara");
    await ctx.eval(`import("/src/lib/model-window.ts").then((m) => m.openModelWindow(${JSON.stringify(ara.id)}))`);
    await ctx.waitFor(`Boolean(document.querySelector("[data-model-menu], [role=dialog]"))`, { timeoutMs: 10_000 });
    await ctx.sleep(800);
  } });
add({ id: "chat-approval-mode", phase: "main", note: "composer approval-mode menu",
  open: async (ctx) => {
    const trigger = 'button[aria-haspopup="menu"][aria-label$=" for Fixture engine"]';
    if (!(await ctx.exists(trigger))) return { skip: "approval-mode control not in the composer at this width" };
    await ctx.click(trigger);
  } });
// 2026-11-04: the composer's "where this conversation works" chip and menu
// are gone; `place.chipAria` is now only the badge on a busy room member's
// face (GroupView.tsx), not a menu. The surface stays listed (its iPad id).
add({ id: "chat-where-menu", phase: "main", note: "composer 'where this conversation works' menu (removed from the desktop)",
  open: async (ctx) => {
    if (!(await ctx.exists('[aria-label^="Where this conversation works"]'))) return { skip: "the desktop composer has no 'where this conversation works' menu any more (2026-11)" };
    await ctx.click('[aria-label^="Where this conversation works"]');
  } });
add({ id: "chat-find", phase: "main", note: "find in conversation (Cmd-F)",
  open: async (ctx) => { await ctx.click({ text: /^Fais une sauvegarde/ }); await ctx.key("f", ["Meta"]); await ctx.type("sauvegarde"); await ctx.sleep(400); } });
add({ id: "chat-threads", phase: "main", localStorage: { "omb-show-threads": "1" }, note: "thread (task) picker (Appearance > Show threads on)",
  open: async (ctx) => {
    if (!(await ctx.exists('[aria-label="All threads"]'))) return { skip: "no thread picker control on screen" };
    await ctx.click('[aria-label="All threads"]');
  } });
add({ id: "inspector", phase: "main", note: "Inspector panel (chat header bug icon)",
  open: async (ctx) => { await ctx.dispatch({ type: "toggleInspector", open: true }); await ctx.sleep(600); } });

// rooms
add({ id: "group-chat", phase: "main", note: "group / room chat (Peer Managers)",
  open: async (ctx) => { await ctx.selectGroup("Peer Managers"); await ctx.sleep(600); } });
add({ id: "group-panel", phase: "main", note: "room panel (header profile button)",
  open: async (ctx) => { await ctx.selectGroup("Peer Managers"); await ctx.sleep(500); await ctx.click("[data-bot-header-pill]"); await ctx.sleep(600); } });

// the bot panel
add({ id: "panel-details", phase: "main", note: "bot panel: Details tab (Coding, Activity, Routines)", open: async (ctx) => { await openPanel(ctx); } });
add({ id: "panel-avatar-editor", phase: "main", note: "bot panel: character/avatar editor popover",
  open: async (ctx) => { await openPanel(ctx); await ctx.click('button[aria-label="Edit avatar"]'); await ctx.sleep(500); } });
add({ id: "panel-library", phase: "main", note: "bot panel: Library tab (the bot's files)",
  open: async (ctx) => { await openPanel(ctx); await ctx.click('[data-panel-tab="library"]'); await ctx.sleep(600); } });
add({ id: "panel-computer", phase: "main", note: "bot panel: Computer tab",
  open: async (ctx) => { await ctx.dispatch({ type: "toggleComputer", open: true }); await ctx.sleep(900); } });
// The desktop dropped the More tab for the persona editor (Edit persona,
// PersonaEditorModal.tsx); the surfaces keep their panel-more ids, which the
// iOS parity screens name.
// Edit bot (PersonaEditorModal.tsx) opens from the panel's "..." menu or
// the mascot: the store's openPersonaEditor, on the selected bot.
async function openEditBot(ctx, section) {
  await openPanel(ctx);
  const botId = await ctx.eval(`__parity.state().selectedId ?? null`);
  await ctx.dispatch({ type: "openPersonaEditor", botId, ...(section ? { section } : {}) });
  await ctx.waitFor(`Boolean(document.querySelector("[data-persona-modal]"))`, { timeoutMs: 8_000 });
  await ctx.sleep(700);
}
add({ id: "panel-more", phase: "main", note: "Edit bot window, on Identity",
  open: async (ctx) => { await openEditBot(ctx); } });
// Slack: a hosted workspace's link to its Admin; Shared with, Perspicax
// tools and Works on: a server signed in with Perspicax (the organization
// pass draws them on one server). Who can see it: an admin on a served page
// of a server that is not an organization's.
// persona-sections.ts FOLDED_INTO: the memory is managed in the Bot folder
const PERSONA_FOLDED = { memory: "files" };
const MORE_WHERE = { slack: { org: true }, worksOn: { org: true }, sharing: { org: true }, visibility: { served: true } };
for (const section of ["overview", "slack", "soul", "skills", "memory", "access", "worksOn", "model", "permissions", "voice", "visibility", "sharing", "history", "usage"]) {
  const where = MORE_WHERE[section] ?? {};
  add({ id: `panel-more-${section.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, phase: "main", note: `bot panel: Edit persona > ${section}${where.org ? " (organization server)" : where.served ? " (served page)" : ""}`, ...where,
    open: async (ctx) => {
      // the store's deep link, as the panel's links open a page (a page
      // folded into another one, Memory into Bot folder, opens that one)
      await openEditBot(ctx, section);
      const page = PERSONA_FOLDED[section] ?? section;
      const selector = `[data-persona-page="${page}"]`;
      // these rows wait for the server's answer (the organization, the Slack link, the viewer)
      if (where.org || where.served) await ctx.waitFor(`Boolean(document.querySelector(${jsLiteral(selector)}))`, { timeoutMs: 8_000 }).catch(() => {});
      if (!(await ctx.exists(selector))) return { skip: `page ${section} not listed for this bot` };
      if (!(await ctx.exists(`${selector}[aria-current="page"]`))) { await ctx.click(selector); await ctx.sleep(300); }
      await ctx.sleep(900);
    } });
}

// pages
add({ id: "routines-calendar", phase: "main", note: "Automations page: calendar",
  open: async (ctx) => { await ctx.dispatch({ type: "showRoutines", section: "schedule", view: "calendar" }); await ctx.sleep(900); } });
add({ id: "routines-list", phase: "main", note: "Automations page: list",
  open: async (ctx) => { await ctx.dispatch({ type: "showRoutines", section: "schedule", view: "list" }); await ctx.sleep(900); } });
add({ id: "routines-logs", phase: "main", note: "Automations page: run logs",
  open: async (ctx) => { await ctx.dispatch({ type: "showRoutines", section: "logs" }); await ctx.sleep(900); } });
add({ id: "team-map", phase: "main", note: "Team map page", settleMs: 600,
  open: async (ctx) => { await ctx.dispatch({ type: "showTeamMap" }); await ctx.sleep(1200); } });
add({ id: "templates", phase: "main", note: "Templates (team library) panel",
  open: async (ctx) => {
    // an experimental place since the sidebar redesign (Settings > Experimental features)
    if (!(await ctx.exists('[data-sidebar-place="templates"]'))) return { skip: "Templates is experimental and off in the default fixture (Settings > Experimental features)" };
    await ctx.click('[data-sidebar-place="templates"]'); await ctx.sleep(800);
  } });

// dialogs
add({ id: "new-bot", phase: "main", note: "New bot dialog",
  open: async (ctx) => {
    await ctx.dispatch({ type: "toggleNewBot", open: true });
    // the dialog loads its settings first ("Loading settings…")
    await ctx.waitFor(`!/Loading settings/.test(document.querySelector("[role=dialog]")?.innerText ?? "")`, { timeoutMs: 15_000 }).catch(() => {});
    await ctx.sleep(700);
  } });
add({ id: "plugins-mcp", phase: "main", note: "Connected apps / plugins panel: MCP servers",
  open: async (ctx) => { await ctx.dispatch({ type: "togglePlugins", open: true, surface: "mcp" }); await ctx.sleep(1200); } });
add({ id: "keyboard-shortcuts", phase: "main", note: "keyboard shortcuts sheet (? or Cmd-/)",
  open: async (ctx) => { await ctx.dispatch({ type: "toggleShortcuts", open: true }); await ctx.sleep(500); } });
add({ id: "about-dialog", phase: "main", note: "About Sagax (account menu > Help > About): the small centred window",
  open: async (ctx) => {
    await ctx.click('[aria-label="Parity Person"]'); await ctx.sleep(300);
    await ctx.click({ text: /^Help$/ }); await ctx.sleep(300);
    await ctx.click({ text: /^About$/ }); await ctx.sleep(600);
  } });
add({ id: "release-notes-dialog", phase: "main", note: "Release notes with the version picker (account menu > Help > Release notes)",
  open: async (ctx) => {
    await ctx.click('[aria-label="Parity Person"]'); await ctx.sleep(300);
    await ctx.click({ text: /^Help$/ }); await ctx.sleep(300);
    await ctx.click({ text: /^Release notes$/ }); await ctx.sleep(700);
  } });
add({ id: "notice-thread-gone", phase: "main", note: "in-app notice (toast)",
  open: async (ctx) => { await ctx.dispatch({ type: "notice", notice: { kind: "thread-gone", botName: "Helix" } }); await ctx.sleep(500); } });

// settings, every section the local desktop page lists
const SETTINGS = ["general", "organization", "cloudAccount", "appearance", "experimental", "connections", "decisionModel", "engines", "companion", "computer", "usage", "people", "mail", "activity", "backups", "workspaces"];
// People (who signed in, managed in the organization's Admin) and Activity
// (the admin log, with the fixture's own changes): an admin on the
// organization server, where they have content (on the solo fixture both are
// empty). Mail: the owner or an admin, known once the session answers.
// Workspaces: the `admin` edition and a fleet agent (the organization
// fixture's stub).
const SETTINGS_WHERE = { people: { org: true }, activity: { org: true }, mail: {}, workspaces: { org: true } };
for (const section of SETTINGS) {
  const where = SETTINGS_WHERE[section];
  add({ id: `settings-${section}`, phase: "main", note: `Settings > ${section}${where?.org ? " (organization server)" : where?.served ? " (served page)" : ""}`, ...where,
    open: async (ctx) => {
      await openSettings(ctx, section, { retries: where ? 6 : 0 });
      const current = await ctx.eval(`__parity.state().appSettingsSection ?? null`);
      if (current && current !== section) return { skip: `section ${section} not shown on this page (opened ${current})` };
      await ctx.sleep(500);
    } });
}
add({ id: "settings-general-scrolled", phase: "main", note: "Settings > General, scrolled to the end",
  open: async (ctx) => {
    await openSettings(ctx, "general");
    await ctx.eval(`(() => { for (const el of document.querySelectorAll("[role=dialog] *")) { if (el.scrollHeight > el.clientHeight + 20 && getComputedStyle(el).overflowY !== "visible") el.scrollTop = el.scrollHeight; } return true; })()`);
  } });

// I-sync (current renderer): appended so the earlier numbers stay put.
// Library's Skills and Plugins views (LibraryTab.tsx), and Settings > My
// connections, a person's own on an organization server.
// Retired 2026-11-04: the desktop's Library is the list alone (LibraryTab.tsx,
// no Skills or Plugins view). The slots keep their numbers so the later
// surfaces' file names stay put; neither side captures them.
for (const view of ["skills", "plugins"]) {
  add({ id: `panel-library-${view}`, retired: "the desktop Library has no Skills or Plugins view any more" });
}
add({ id: "settings-myConnections", phase: "main", note: "Settings > myConnections (organization server)", org: true,
  open: async (ctx) => {
    await openSettings(ctx, "myConnections", { retries: 6 });
    const current = await ctx.eval(`__parity.state().appSettingsSection ?? null`);
    if (current !== "myConnections") return { skip: `section myConnections not shown on this page (opened ${current})` };
    await ctx.sleep(700);
  } });

// The simplification pass (2026-10-12): the persona categories the loop
// above does not name, every Settings section the page can list, and the
// same on the organization server (where Organization, People, Mail and
// the organization pages have their content). Appended so the
// earlier numbers stay put.
const PERSONA_ALL = ["overview", "appearance", "soul", "rules", "skills", "memory", "files", "access", "model", "permissions", "voice", "history", "usage"];
// a deep link opens the persona editor on the category (store: toggleSettings)
// (2026-11-04: Edit bot's deep link, openPersonaEditor; data-persona-page)
const openPersona = async (ctx, category) => {
  await openEditBot(ctx, category);
  const selector = `[data-persona-page="${PERSONA_FOLDED[category] ?? category}"]`;
  await ctx.waitFor(`Boolean(document.querySelector(${jsLiteral(selector)}))`, { timeoutMs: 8_000 }).catch(() => {});
  if (!(await ctx.exists(selector))) return { skip: `category ${category} not listed for this bot` };
  if (!(await ctx.exists(`${selector}[aria-current="page"]`))) await ctx.click(selector);
  await ctx.sleep(1200);
};
for (const category of PERSONA_ALL) {
  add({ id: `persona-${category}`, phase: "main", note: `persona editor > ${category}`, open: (ctx) => openPersona(ctx, category) });
}
for (const category of ["overview", "appearance", "soul", "rules", "skills", "memory", "files", "access", "model", "permissions", "voice", "history", "usage"]) {
  add({ id: `org-persona-${category}`, phase: "main", org: true, note: `persona editor > ${category} (organization server)`, open: (ctx) => openPersona(ctx, category) });
}
for (const section of ["memory", "privacy", "notifications"]) {
  add({ id: `settings-${section}`, phase: "main", note: `Settings > ${section}`,
    open: async (ctx) => {
      await openSettings(ctx, section, { retries: 3 });
      const current = await ctx.eval(`__parity.state().appSettingsSection ?? null`);
      if (current && current !== section) return { skip: `section ${section} not shown on this page (opened ${current})` };
      await ctx.sleep(500);
    } });
}
for (const section of ["general", "memory", "privacy", "notifications", "organization", "appearance", "experimental", "connections", "decisionModel", "engines", "companion", "computer", "usage", "backups", "myConnections"]) {
  add({ id: `org-settings-${section}`, phase: "main", org: true, note: `Settings > ${section} (organization server)`,
    open: async (ctx) => {
      await openSettings(ctx, section, { retries: 6 });
      const current = await ctx.eval(`__parity.state().appSettingsSection ?? null`);
      if (current !== section) return { skip: `section ${section} not shown on this page (opened ${current})` };
      await ctx.sleep(700);
    } });
}

// notes for the spec: not capturable here
// 2026-11-03 (iPad 1:1 audit): the desktop surfaces added since the I-series.
add({ id: "memory-page", phase: "main", note: "Memory page (main column, Perspicax console shape)",
  open: async (ctx) => { await ctx.dispatch({ type: "toggleMemoryManager", open: true }); await ctx.sleep(1500); } });
for (const [id, label] of [["memory-map", "Map"], ["memory-tags", "Tags"], ["memory-quality", "Quality"]]) {
  add({ id, phase: "main", note: `Memory page, the ${label} view`,
    open: async (ctx) => {
      await ctx.dispatch({ type: "toggleMemoryManager", open: true });
      await ctx.sleep(1500);
      if (!(await ctx.exists({ text: new RegExp(`^${label}$`) }))) return { skip: `${label} tab not shown` };
      await ctx.click({ text: new RegExp(`^${label}$`) });
      await ctx.sleep(1500);
    } });
}
for (const [id, layout] of [["memory-map-radial", "Radial"], ["memory-map-columns", "Columns"]]) {
  add({ id, phase: "main", note: `Memory page, the Map view, ${layout} layout`,
    open: async (ctx) => {
      await ctx.dispatch({ type: "toggleMemoryManager", open: true });
      await ctx.sleep(1500);
      if (!(await ctx.exists({ text: /^Map$/ }))) return { skip: "Map tab not shown" };
      await ctx.click({ text: /^Map$/ });
      await ctx.sleep(1200);
      if (!(await ctx.exists({ text: new RegExp(`^${layout}$`) }))) return { skip: `${layout} not shown` };
      await ctx.click({ text: new RegExp(`^${layout}$`) });
      await ctx.sleep(2000);
    } });
}
add({ id: "capabilities", phase: "main", note: "Capabilities (centred modal)",
  open: async (ctx) => { await ctx.dispatch({ type: "togglePlugins", open: true }); await ctx.sleep(1500); } });
add({ id: "routine-edit", phase: "main", note: "Automations list: a routine open in the side panel",
  open: async (ctx) => {
    await ctx.dispatch({ type: "showRoutines", section: "schedule", view: "list" });
    await ctx.sleep(1000);
    if (!(await ctx.exists({ text: /^Scan skills populaires mensuel/ }))) return { skip: "routine row not listed" };
    await ctx.click({ text: /^Scan skills populaires mensuel/ });
    await ctx.sleep(1200);
  } });
// Updates lists itself where the desktop app's updater answers
// (window.ogb.updater): a stub that reports "up to date" on the stable
// channel. The Vault is a person's: the page's own calls carry the paired
// device's bearer (a person, as the iPad is), so it shows the signed-in vault.
const STUB_UPDATER = `(() => {
  const state = { status: "idle", channel: "stable", autoInstallWhenAway: false, installMode: "restart" };
  window.ogb = { ...(window.ogb || {}), updater: {
    onState(cb) { cb(state); return () => {}; }, check() {}, install() {},
    setChannel() { return Promise.resolve(); }, setAutoInstallAway() { return Promise.resolve(); },
  } };
  return true;
})()`;
const personFetch = (token) => `(() => {
  if (window.__parityPersonFetch) return true;
  window.__parityPersonFetch = true;
  const original = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (String(url).includes("/api/me/credentials")) {
      const headers = new Headers(init.headers || {});
      headers.set("authorization", "Bearer " + ${JSON.stringify(token)});
      init = { ...init, headers };
    }
    return original(input, init);
  };
  return true;
})()`;
for (const section of ["account", "voice", "updates", "about", "providers", "security", "credentials", "import"]) {
  add({ id: `settings-${section}`, phase: "main", note: `Settings > ${section}`,
    open: async (ctx) => {
      if (section === "updates") await ctx.eval(STUB_UPDATER);
      if (section === "credentials" && ctx.fixture?.token) await ctx.eval(personFetch(ctx.fixture.token));
      await openSettings(ctx, section, { retries: 3 });
      const current = await ctx.eval(`__parity.state().appSettingsSection ?? null`);
      if (current && current !== section) return { skip: `section ${section} not shown on this page (opened ${current})` };
      await ctx.sleep(700);
    } });
}

add({ id: "sidebar-select", phase: "main", note: "sidebar multi-select: Aurora and Helix chosen, the grouped action bar",
  open: async (ctx) => {
    await ctx.hover('[aria-label="Actions for Aurora"]');
    await ctx.click('[aria-label="Actions for Aurora"]');
    await ctx.click({ text: "Select", tag: "[role=menuitem]" });
    await ctx.sleep(300);
    await ctx.click({ text: /^Helix/, tag: "[role=button],button,a,li" });
    await ctx.moveAway();
    await ctx.sleep(400);
  } });
add({ id: "computer-window", phase: "main", noShell: true, note: "the bot's computer in its own large window (SandboxDesktopModal, src/gallery/computer-screens.html?modal=sandbox)",
  open: async (ctx) => {
    const origin = await ctx.eval("location.origin");
    await ctx.page.send("Page.navigate", { url: `${origin}/src/gallery/computer-screens.html?modal=sandbox&lang=en` });
    await ctx.sleep(2500);
    await ctx.waitFor(`Boolean(document.querySelector("[data-sandbox-takeover]"))`, { timeoutMs: 15_000 });
  } });

export const NOT_CAPTURED = [
  { id: "floating-mascot", why: "desktop-only: a bot floated onto the macOS desktop is its own frameless always-on-top Electron window (electron/floating-bot-window.mjs); nothing is drawn in the main window" },
  { id: "update-banner", why: "needs the Electron updater bridge (window.ogb.updater); the iPad updates through the App Store" },
  { id: "launch-screen", why: "needs the orgJoin/serverMode bridges (Electron); iPad pairs instead" },
  { id: "retro-assistant", why: "Hibou 98 desktop assistant, unlocked by the Konami code; desktop novelty" },
];

let nn = 0;
export const SURFACES = S.map((surface) => ({ ...surface, nn: String(++nn).padStart(2, "0") })).filter((surface) => !surface.retired);
