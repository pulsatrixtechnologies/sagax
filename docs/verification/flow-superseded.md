# Installed: a bot tenant copy replaced by Flow

Issue #1993 follow-up. `server/capabilities/capabilities.ts` identifies an
older bot tenant copy using its exact plugin name and the installed tenant
version in the signed organization pack. It reports no replacement for a
missing pack, an inactive guard/member, an unavailable tenant folder, an
unknown version, or a copy at the same or a newer version. The installed
version wins over a newer advertised declaration.

The real PluginsPanel DOM test exercises a member's one-click removal in
English and French, one DELETE to that bot's plugin route, disabled controls
while busy, the retained organization Flow, the refreshed list, an error
with retry, and a reader without a removal action. No new admin requirement.

Run the tests beside the changed code only:

```sh
pnpm exec vitest run server/capabilities/capabilities.test.ts src/components/bot-settings/CapabilitiesTab.test.ts src/components/plugins/InstalledView.test.ts src/components/PluginsPanel.modal.dom.test.ts
```

Capture the real PluginsPanel in headless Chrome with a synthetic local API:

```sh
SAGAX_VERIFY_BROWSER_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node scripts/capture/flow-superseded.mjs
```

The script owns Vite on port 5187 (override `SAGAX_CAPTURE_PORT`, 5176 to
5206 only), owns a headless browser, and stops both in `finally`. It captures
English/French, light/dark, 1100/700/390 px, plus the desktop after removal.
It checks readable replacement/version text, visible controls, no horizontal
overflow, one-click removal without a second dialog, retained organization
Flow, and no page errors. Evidence: `docs/screenshots/flow-superseded/`.

The capture's API is a stand-in, so it proves the renderer and its request
flow, not a live Perspicax deployment. No user data, live server, visible
window, or billable engine is involved. iOS has no change in this follow-up.
