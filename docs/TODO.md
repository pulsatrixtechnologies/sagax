# TODO

Backlog of requests not started yet. One entry per item: the request, who asked, the date, and what is known. An item leaves this file when its pull request is merged.

## A desktop local model on an organization server needs no provider key (JC, 2026-10-08)

Request: a bot or thread whose model points at a local engine that only exists on the person's desktop (pi on a desktop local model, `desk...::model`, #189) must not refuse the turn on the organization server. It should run there through the desktop bridge when the desktop is connected, and fall back to the person's connected cloud engine or the Auto pick (#153) with a notice when it cannot.

Today (fix/routine-run-rpc-error): a thread whose own model has no credentials on the server for the payer gives way to its bot's model with a notice (`healOrgRefusedThreadModel` in `server/index.ts`), the way a model that is gone already did. On production this was Cryptic's "Team incidents" thread, pinned to `pi / desk8a1ada8002::qwen3.8-flash-next`, which refused every incident report with `no_access/no_credentials (pi)`.

Still open:

1. `resolveEngineAccess` (`server/engine-credentials.ts`) asks pi for a provider key (anthropic, openai, xai, google, moonshot) even when the picked model is a desktop local model that needs none. A desktop inject model on pi should get its own access (the desktop model grant) instead of `no_credentials`.
2. When the bot's own model is refused too, the turn is still refused with the access card. Falling back to the payer's connected cloud engine, or to the Auto pick for that payer, needs a rule for who pays and a notice in the thread.
3. Incident reports (`reportIncident`) could skip a Primary Bot whose engine cannot run for its owner on the server, and notify the person instead.

## Several accounts in the desktop app (JC, 2026-10-08)

Request: add more than one account to the desktop app and switch between them in one click, like the account menu of Claude Desktop (Switch account, Add account, Log out, the current account checked, name and email on each row).

Today: in server mode the app is locked to one organization server (`withServerMode` in `electron/main.mjs`). `switchEnvironment` returns early and `requireNotServerMode` blocks adding another server; the Server menu only offers "Change server...", which signs out, clears that server's data, forgets the server and returns to the launch screen. Switching between two organization servers means signing out of one and into the other every time. The desktop bridge follows the server-mode server only. A packaged app in server mode does not start the local server, so going back to local mode is a restart.

Design sketch (several days of work):

1. `electron/environments.cjs`: server mode holds several organization servers plus the current one, instead of one locked id. Idempotent migration from the single `serverModeId`, with node tests.
2. `electron/main.mjs`: switching loads the other server's page (its HttpOnly cookie is kept); an expired session opens `startPulsatrixSignIn` for that server. "Add account" opens the browser sign-in for a new server without signing the others out. "Log out" signs out of the current server only.
3. Rebind the desktop bridge, the tunnel, computer sharing, the floating windows and the retro assistant window on a switch. Nothing may keep calling the previous server.
4. `src/components/SidebarProfileMenu.tsx`: an account submenu (name and email from `state.config.viewer`), new preload calls in `electron/preload.cjs`, translations in en, fr and pt-BR.
5. Solo mode as a third account needs the local server running beside server mode: either a restart or a change to the boot sequence (the largest risk).

Bots, threads and sidebar state need no extra isolation: each server draws its own UI on its own address, so browser storage is already separate per server.

## Full ChatGPT Pets style mascot mode (JC, 2026-10-08)

Request: make the desktop mascot a full ChatGPT Pets style companion, with a voice call that starts from the character, live captions and task chips beside it, and a virtual pointer that shows the person where to click on their screen. JC wants the whole experience (Pets + Voice + pointer), not one piece.

Today: the mascot is a transparent always-on-top window per bot, and a mascot call runs the app's single voice call (`LiveCallEngine`). The call is a 36 px pill under the feet (timer, push-to-talk, mute, end); there is no caption or transcript beside the mascot, and no global hotkey in `electron/`. Computer use (CUA) can act on the screen but has no pointing or highlight tool, and the driver's agent cursor is not used for pointing.

Design sketch (about 18 days in total, in two slices after a small first step):

1. Slice 2, about 7 days: a call rail beside the character (status chip, live captions, task chips with Allow / Stop, compact transcript), per-phase animations for each character, and a global hotkey for the call. Single call engine, no new server piece for voice.
2. Slice 3, about 11 days: a click-through overlay per display (`electron/pointer-overlay.mjs`), tools `point_at`, `show_me` (guide or do), `clear_pointer`, consent to act from the rail, and an activity log entry for each point and act.

Open questions for JC (full text in the plan):

1. Must the pointer work over native fullscreen apps and games, or is "normal windows and fullscreen Spaces where macOS allows it" enough?
2. Should the mascot call coexist with the main window's call bar, or replace it while the mascot is on screen?
3. Click on the mascot when idle: open the call (ChatGPT behaviour) or keep the balloon (today)? Call on double-click?
4. Default hotkey: Control+Option+Space ok? Mute vs push-to-talk on the same key?
5. Should the pointer be visible in screen shares or hidden from the bot's own screenshots? The two exclude each other.
6. Consent for acting: per task, per app, or a timed "drive for 10 minutes"?
7. Server mode: may an organization bot point or act on a person's screen from a call, or solo only first?
8. Use CUA's agent cursor for real actions, or our overlay for both?
9. Captions on by default beside the mascot?
10. Linux Wayland: acceptable to ship without the pointer there?

Started first (easy, high value): mascot hover controls (quick chat, voice, activity), a global hotkey for the call, live captions beside the mascot during a call; the rest waits for JC's answers.

JC's answers (2026-10-08): a click on the idle mascot opens the call; the mascot call coexists with the main window's call bar (one engine, two surfaces); Control+Option+Space is the hotkey; captions on by default.

Slice 2 (`feat/mascot-desktop-2`):

- [x] Hover controls beside the character (quick chat, voice, activity tray with Allow / Stop), 150 ms in, 400 ms out (`hover-controls.ts`, `MascotControls.tsx`, `tray.ts`).
- [x] Click = chat balloon on the idle mascot (JC, 2026-10-08: a click must not call; the hover call button and the hotkey do); a drag stays a drag, a click on a call ends nothing (`mascotClick`).
- [x] Global hotkey Control+Option+Space: press to call, again to mute, hold to talk in push-to-talk mode (`electron/mascot-hotkey.mjs`, `hotkey.ts`, Settings > Appearance).
- [x] Captions and the phase's status chip beside the mascot during a call, on by default (`captions.ts`, Settings > Appearance; stored with the call settings).
- [ ] Still open from the design: the call rail's task chips inside the call, the compact transcript, per-phase clips for each character, the captions switch inside the call bar's settings panel (that panel is being reworked on `fix/call-bar-card-animation`), slice 3 (pointer).

Plan: `docs/plans/2026-10-08-mascot-full-mode.md` (research on ChatGPT Pets and Voice, Clicky, the current code, and the full design).

## Plugins: what the Connect apps redesign left out (JC, 2026-10-08)

Request: the Plugins panel works like the "Connect Apps" screens of Claude Desktop (main view, Manage plugins and skills, plugin detail). These parts of the reference screens are not done yet:

- Categories come from the catalog tags (a connector's toolkit categories, a marketplace plugin's category, `category` in `shared/plugin-catalog.json`), read by `categoryFromTags` in `src/lib/plugins-model.ts`; an untagged app is under Other. The tag rules are English words: a category name in another language would land under Other.
- "Recommended for you" is the reviewed plugin catalog (`shared/plugin-catalog.json`), the same for everyone. Nothing is personalised yet.
- Done 2026-10-09: several accounts per MCP server. `server/mcp-oauth.ts` keys tokens by server and account (vault v2; a v1 vault moves to the "default" account on load), "+ Add another account" on an MCP server's page, and a bot's Access settings pick the account per server (`bot.mcpAccounts`). Removing an account sends its bots back to the first one.
- Done 2026-10-09: per-tool switches for connected apps. A connected app's detail page has a Tools card with one switch per tool for the workspace (`PUT /api/connectors/:slug/tools`, admin, audited; `server/connector-tool-switches.ts`). The relay refuses a tool turned off. The bridge's tools/list is not trimmed by these switches yet: the model can still see a tool that is off and is refused when it calls it.
- Publish a private skill to the organization library: a desktop has no path to publish (the organization's Admin publishes packages), so the skill page has no Publish button.
- Bot templates: the button beside the search opens Browse Bots on its Templates section (2026-10-09; the Templates library is gone). Templates show the apps they use as chips and the Templates view filters by app; only community templates declare their apps (`requires.apps`), so presets, organization packages and built-in roles have no app chips yet.
- Admin oversight of a person's connections (person panel, `PersonConnectionsSection`) and the organization's allowed marketplaces (Settings > Organization) stay where they are: they govern other people, they do not add or set up anyone's own plugins.
- Marketplace tokens are per bot and marketplace (`server/marketplace-tokens.ts`, 2026-10-09, docs/bot-package.md). Since the one marketplace list, the token field is in Connect apps > Manage > Advanced > Marketplaces with "For <bot>" chosen: that bot reads a private repository with its token first, then the person's GitHub connection, then the organization's GitHub tokens (adding, fetching again and installing a plugin kept in another repository). Added for everyone, a marketplace reads with the person's GitHub connection, then the organization's first GitHub token; the workspace scope has no token field of its own yet.
- One marketplace list, two install scopes (done 2026-10-09): Connect apps installs a marketplace plugin for everyone (its MCP servers and skills) or, with "For <bot>" beside the workspace scope, whole on that one bot (agents, commands and skills, `server/bot-plugins.ts`). The per-bot store reads the panel's marketplaces; the boot migration (`migrateBotMarketplaces`) moved each bot's own marketplaces into that list, renaming a clash, and kept every install (a bot zip restored on a new bot takes its marketplaces in the same way). Library > Plugins is gone: the Library's link and the bot panel open Connect apps on that bot. Left: a member without `apps.marketplaces` reads the list only through a bot they may change, and removing a marketplace from a bot takes it off the list only for a workspace manager or the person who added it, once nothing uses it; anyone else leaves it listed for the workspace's managers to remove.
- Done 2026-10-09: updating an installed marketplace plugin in place. Update shows on its row and detail page when the marketplace offers another version or other files (`POST /api/marketplaces/:name/plugins/:plugin/update`): its MCP servers keep their names, switches, headers, env and sign-in, its skills are rewritten, and the change is audited (`plugin.update`). "For <bot>" shows Update by the same rule (`updateAvailable` in the bot listing, the plugin's `revision` kept per bot); installing again updates the bot's copy in place, its switch kept.
- A marketplace added by the address of its marketplace.json (not a repository) installs a plugin's MCP servers (`.mcp.json`, plugin.json) read over https, not its skills (a folder listing needs a repository). A bot install from such a marketplace is refused (422 `manifest_only`): it needs the plugin's files.
- Providers other than Claude: Plugins > Manage > Providers lists every engine account, but only a Claude subscription brings its connectors to bots. ChatGPT connectors need Codex backend auth (see `server/harness-connectors.ts`); Grok and Gemini have no known path, and no "Manage on" address is shown for them until one is known.
