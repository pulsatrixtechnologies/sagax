# Published pages and artifacts

Descriptions of the code: how it works today, its files and its tests.
Moved out of `AGENTS.md` (#3292), which keeps the rules only. When a
description here and a rule in `AGENTS.md` disagree, the rule wins and this
text is fixed. A pointer such as `AGENTS.md, "<section>"` in an older comment
now means the section of that title in one of the files of `docs/code/`.

## Native Claude artifact tools (#1990, 2026-11-04)

Organization Claude turns keep `Artifact`, `ArtifactData` and `ArtifactComments`
in `CLAUDE_ORG_TOOLS`, with no host deny on their parent. The driver opts print
sessions into `CLAUDE_CODE_ARTIFACT` and `CLAUDE_CODE_ARTIFACT_TOOLSET` by default.
Native ToolSearch remains available on compact turns; their Sagax MCP directory
stays compact. Explicit engine settings and Claude account eligibility still
apply. Routine readiness uses the resolved driver and payer access to explain
artifact dependencies on API accounts or another engine before creating a task.
Evidence and configuration matrix: `docs/verification/claude-artifacts.md`.

## Pages shared in a bot's Library (#3128)

A Page is personal by default. Share > "In the bot's Library" switches it to
shared and back (`botShared` on the page, PATCH `{botShared}`; a draft is
published first). Anyone who may use the bot (`bot.use`) reads it through its
reading link (`pageReadable`, `mayUseBot`) and asks the bot to refresh it (the
Library row sends the bot a message with the page context; the store lets the
bot propose a new version on a botShared page of the same bot). Its creator and
the bot's owner remove it (DELETE on the page, `mayRemoveShared`). They list
in `GET /api/pages` with `sharedBy` and `canRemove`, and in a "Shared Pages"
section of the Library tab. Tests: `server/pages/published-pages.test.ts`,
`src/components/PageShare.test.ts`.

## Page view (2026-10-28; lot 5 layout 2026-10-31, stage default after native audit)

A page a bot proposes shows in the conversation as a card with a live,
scaled-down drawing of its top and its icon, title and "Page"
(`PagePublishCard`). A click opens it in the conversation frame
(`PageSurface` in src/components/PageViewer.tsx, src/lib/open-page.ts,
src/lib/page-chat-layout.ts): Back to chat (×) top left, the title pill
(click to rename, Enter saves), « ⋯ » and Share top right. Default surface
for published HTML pages is **stage** (measured reference design 0.78.1 HTML/file
artifacts and Sagax 0.8.23 iOS): the page covers the mounted conversation and
the composer docks on the page (`data-page-stage-chat=docked`). The chat
column stays mounted underneath (`inert` while covered) so closing returns
to the same scroll. Optional **Show conversation** in « ⋯ » switches to
beside when the ChatView host is wide enough (host ResizeObserver, not the
window; Sagax richer control / Grok canvas chat-pane analogue). Hide
conversation returns to stage. Split-view side chats never host the panel.
Every earlier tool (versions, annotate, present, edit, comments, decline)
is in « ⋯ ». The app's own preview takes `bare=1` (no banner inside the
app), `theme=light|dark` and `y=<n>`: its frame runs a small script that
scrolls to `y` and posts `sagax-page-scroll` with a number to the app, so a
new version the bot proposes is drawn in place at the same place. A reading
link never takes these. Sandbox, CSP and isolation are unchanged.

Share is one popover (src/components/PageShare.tsx), the only place a page's
sharing is chosen (open page, Settings > Published pages, the Library):
Add people or groups (directory people and teams, `POST /api/pages/:id/invite`
`{ people, teams }`), who has access (Owner, invited), General access
(People you invite = `private`, Anyone in your organization = `org`, Anyone
with the link = `link` while the organization's `linkSharing` allows it),
expiry, Unpublish, Copy link, Open in browser. A `private` page reads for its
person and the invited people and teams' people (`pageReadable`,
`teamsOf`). A page not shared yet is published by the person's gesture there.
No admin: a member shares their own page within the organization's policy.

While a page is open, the visible empty composer stays Message <botname>
(measured). Message about the page title (`composer.placeholder.page`) is
the stage-chat aria-label only. A message sent then carries
`dataContext.page` `{ pageId, title, version? }` (shared/data-context.ts
`withPageContext`): the app draws it as a chip over the words, and the
server keeps it only for the sender's own page of that bot (`ownPageContext`
in server/index.ts) and gives the model a `<page-context>` envelope with the
page's current source (cut at 96 KB, data never instructions). The bot
revises it with propose_page and page_id, from any topic of the same bot and
person. An older card that a newer version replaced says "Updated below"
(also when the thread already names a newer version than the mounted card)
and opens the latest page. Tests: `shared/data-context.test.ts`,
`server/data-context.test.ts`, `src/components/PageComposerParts.test.ts`,
`src/lib/page-chat-layout.test.ts`, `src/lib/composer-placeholder.test.ts`,
`src/components/ChatView.page-layout.dom.test.ts`,
`src/components/ChatView.page-real.dom.test.ts` (the real ChatView,
Composer, PageSurface and cards: stage cover, docked composer, context
sent, Back to chat with scroll place and focus on the opener, Escape from
the empty docked composer, optional side conversation and its host-width
fallback, split sections, exchange sheet, v1 card refresh),
`src/components/PublishedPages.card-refresh.dom.test.ts`. The composer dock
moves onto the page and back: `useComposerDockPad(ref, pageStage)` must
re-observe it. Captures: `node scripts/capture/page-chat-real.mjs`
(gallery `src/gallery/page-chat-real.html`, real ChatView; `--tree` serves
another checkout for before shots), `docs/screenshots/grok-convergence/real-chatview/`.

No page is ever drawn in a window inside Sagax. From the bot's Library
(Pinned, This week; « … » Open, Share…, Pin or Unpin, Delete…), Settings >
Published pages and the open page's « ⋯ » > Open in a window, a page opens in
its own system window (src/lib/page-windows.ts): the artifact window bridge
with the id `page:<pageId>`, one window per page, its place kept; a browser
gets a new tab. That window draws the same PageSurface (×, title, Share, « ⋯ »)
and asks the page again every 5 s for the bot's new version. On desktop it
auto-fits to the page content (#2051: `src/lib/page-window-fit.ts`,
`electron/artifact-window.mjs` + `artifact-window-preload.cjs`) until the
person resizes it; that size is remembered per page id (`personSized`). Tests:
`src/lib/page-windows.test.ts`, `src/lib/page-window-fit.test.ts`,
`electron/artifact-window.test.mjs`, `src/components/bot-settings/LibraryTab.test.ts`.
Tests: `server/pages/published-pages.test.ts` (app's own look),
`src/components/PageViewer.surface.dom.test.ts`, `src/lib/open-page.test.ts`.
Lot 5 evidence: `docs/plans/grok-convergence-interface-evidence.md`.

## The reader's bar of a published page (2026-10-28)

A reading link (`/pages/view/<token>`) shows a bar instead of the yellow
banner: the title, the full notice (published by <bot> for <person>, not a
Sagax screen, never a password) always visible, and the actions the reader
has a right to (shared/page-reader.ts `ReaderBoot`). The bar is a second
Vite page (page-reader.html, src/page-reader/); the server reads the built
tags from SAGAX_STATIC_DIR (`readerAssetsFrom`) and the wrapper's CSP allows
only `script-src 'self'` and `connect-src 'self'`. The page's frame is
unchanged (same sandbox and CSP). Share: the page's own person only, on the
same routes and plan as the app (src/lib/page-share-plan.ts). Download PDF
(every reader): the reading frame posts its height (`sagax-page-size`, by
nonce on Markdown) and the wrapper prints only the frame at that height;
the browser's Save as PDF writes it, a presentation one slide per sheet.
Annotate (anyone signed in who may read the page, its person always, no
admin): `/api/pages/:id/threads` (shared/page-threads.ts), threads anchored
on text or a part of the page, replies, resolved, deleted by their author
or the page's person. The frame's bridge (`ANNOTATE_BRIDGE_SOURCE`) is
dormant until the wrapper turns the mode on and only ever gets anchors
back, never a comment or a name. Live (server/pages/page-live.ts):
`GET /api/pages/:id/live` streams who has the page open and "threads
changed" (never a comment) to the people who may annotate; a comment by
someone else notifies the page's person (`page-comment`, audience the
owner only). The page's bot: a message about the page carries its
annotations in `<page-context>` (`comments`, data never instructions, `new`
since the bot last read them); the `page_comments` tool (list, reply,
resolve) reaches only the calling bot's own page for this conversation's
person (`/api/internal/page-comments`), never in a room or a confidential
thread. Suggested edits (Markdown and presentation pages, not live
co-editing): an annotation may carry the words that replace its quote;
only the page's person accepts it (`/threads/:tid/accept`: a new version,
published with the same access if the page is) or declines it; words no
longer found once in the source are refused (409). Shared state (#1544,
shared/page-state.ts): an HTML page's script keeps small JSON values for
every reader through `window.sagax.page` (ready, get, entry, all,
canWrite(key?), level, me, set, subscribe); the wrapper reads `GET
/pages/state/<token>` (anyone who may read it) and writes `PUT
/api/pages/:id/state` (signed in) or `PUT /pages/state/<token>` (not signed
in); names, never ids; capped (200 keys, 4 KB a value, 64 KB a page, 60
writes a minute per person); erased on revoke. Who writes a key
(2026-10-29) is the page's own declaration, a `<script
type="application/sagax-state+json">` block the server reads from the
published version (`stateRulesOf`), never from the browser: `anyone`,
`signed_in` (the default for a key named nowhere), `editors` (who may change
the page: its person and the people on `editors`, #1704) or `owner`;
`prefix*` and `*` patterns. The level declared in the published HTML stays
as written (`editors` never becomes `owner`). The person sets the list with
`PATCH /api/pages/:id { editors: [principal ids] }` (at most 50); a listed
editor may save a new version (`POST .../versions`) and write editors-level
state keys (role `editor`), not owner-only keys, locks or clears. Always
within the sharing: `anyone` reaches a reader not signed in only while the
page is shared with anyone with the link (else the same 404). Anonymous
writes: 1 KB a value, 20 writes a minute per browser, 120 per network
address, 100 keys a page; stored as `anon:<hash>` of the browser's own
random id (`x-sagax-reader`), shown as Anonyme. The page's person clears it
(`DELETE /api/pages/:id/state`) or makes a key read-only (`PUT
/api/pages/:id/state/lock`) from Page state in the reader's bar
(`src/page-reader/ReaderState.tsx`). Captures:
`scripts/capture/page-reader.ts`.

## The reader's bar in its person's look (2026-10-29)

A reading link's bar (and its page frame) wears the Sagax theme of the
page's person, never a generic grey. Their app sends its look
(`PUT /api/pages/look`, src/lib/page-look-sync.ts `usePageLookSync`, at start
and on each skin or bot-accent change, only when it changed): the tokens of
the skin worn, read from a hidden probe wearing its light and its dark
sibling with the person's variant (one scheme only for a skin without a
sibling, worn in both), and the "Use bot color as accent" choice. The server
keeps known tokens with safe values only (src/lib/page-look.ts
`sanitizePageLook`, the #1551 rule) per person in
`published-pages-looks.json`, and draws: the bar's `--sb-*` variables, light
and dark by the reader's system (`readerBarThemeCss`, the bot's color as the
accent when chosen, held to 3:1 and 4.5:1 on the panel,
src/lib/bot-accent-colors.ts), and the frame's theme (`pageThemeCss
schemes`). The bar: title semibold; byline with the publishing bot's mascot
(a dot in its color, then src/page-reader/ReaderMascot.tsx in its own chunk,
without the app's i18n) and its name in semibold; the warning "not a Sagax
screen, never a password" as a quiet line with a shield, always visible
(a themed bar looks more like the app, which is why it stays); PDF, Annotate,
and Share in the accent; icons only on a phone. Popover and comments panel
read the same variables. Sandbox and CSPs unchanged; the app's preview never
takes it. No iOS change: the phone has no reader bar. Tests:
`server/pages/published-pages.test.ts` ("in its person's look"),
`src/lib/page-look.test.ts`, `shared/page-reader.test.ts`. Captures:
`node --experimental-strip-types scripts/capture/page-bar-theme.ts`,
docs/screenshots/page-bar-theme.

## Published pages (2026-10-16, the reference design canvases)

The page index and looks registry fail explicitly (503) when a saved file
cannot be read or validated (#1731). Only ENOENT means no saved data. Never
replace an unreadable registry with an empty one; the next request retries
the read so repairing the file restores access without a restart. Log the
file name once per failure, never its contents.

A bot proposes a page (HTML, Markdown or a small one-file static app) with
the agents tool `propose_page`; the person publishes it from its card
(`shared/published-pages.ts`, store `server/pages/published-pages.ts`, renderer
`server/pages/published-pages-render.ts`, routes `server/routes/published-pages.ts`,
UI `src/components/PublishedPages.tsx`: the chat card and Settings > Pages
publiées). On iPhone, Settings > Pages > Snapshot frames that version's
preview wrapper only (`ios/Sources/CompanionCore/PagePreview.swift`): the
same `/pages/preview/<id>/<n>` path the desktop frames, and its
preview-frame, on the API origin. Another host or path is not loaded.
Keep these rules, covered by `server/pages/published-pages.test.ts`,
`server/pages/published-pages.e2e.test.ts`, `server/pages/published-pages-prelude.test.ts`,
`src/components/PublishedPages.test.ts` and `electron/page-frame-guard.node-test.mjs`
(two security reviews of #646 folded in):

- Publishing is an outward action and only the person does it. The tool
  goes through the internal card route (`createAgentCard`, tool
  `propose_page`) and stores a `proposed` version plus a bot row with
  `pagePublish`; whatever the bot sends (access, publish flags) is ignored.
  `POST /api/pages/:id/publish` needs an explicit `access`. Not available in
  rooms. Choosing "Toute personne ayant le lien" asks a second press.
- Source from a file (#3488): `propose_page` takes `content` or `path`,
  exactly one. `path` names a UTF-8 file of the calling bot's own workspace,
  or `plugins/<name>/<file>` of one of its installed plugins (#3612),
  resolved by `readWorkspaceSourceFile` through `resolveOwnReadable`, the
  resolver `workspace_read` uses, with the plugin folders of the turn's
  person (`scopedPluginFolders`): no traversal, no link, no hidden file, no
  absolute path (the sandbox mount alias included), never another bot's
  workspace or plugins. A file that is not there is refused; the tool tells
  the bot that retyping cannot replace it. It is
  read byte for byte under the same 512 KB limit and secret masking as
  inline content. The answer and a source read carry `bytes` and `sha256`
  of the stored source, computed in one place (`pageSourceDigest`) and
  written on the version when it is stored; when a step changed the source
  before storage (secret masking, a design system applied) the answer also
  gives what the bot sent (`given`) and why (`changedBy`). The version
  listing (`PageVersionSummary`) shows the recorded hash only: a version
  stored before it gets it on its first source read (`recordDigest`), read
  from its file, never through the cache that serves published pages. A save
  of that hash that fails never fails the read (#3584): the read answers the
  hash, and the next read tries to save it again.
  `GET /api/pages/:id/versions/:n/source?offset=&limit=` and the bot's
  `page_comments` action `source` read one slice by UTF-8 byte offset
  (`shared/utf8-slice.ts`, also behind `workspace_read`; follow
  `nextOffset`). There is no write of a source into the workspace: paging
  plus the size and hash cover a comparison with a file.
- Whose page it is: the conversation's person (`pageOwnerFor` =
  `threadOwner` of `server/threads/thread-privacy.ts`: the thread's recorded owner,
  else the bot owner), never simply the bot's owner. A member's private
  conversation with someone else's team bot gives the member the page; the
  bot owner gets 404. Who manages pages: on an organization server the
  page's person only (a session with that principal); on a one-person server
  the computer's owner only (`computerOwner`), never another paired session;
  never a bot's shell on a shared server. Another person's page reads as 404.
- Who reads it: `private` (its person; on a one-person server the computer's
  owner), `org` (any human, enabled person signed in to this server, never a
  guest; on a one-person server any paired session), `link` (anyone holding
  the link). Expiry: never, or a time within a year. Revoke drops the link
  id at once (and every frame ticket with it); publishing again mints a new
  link. A bad signature, a revoked or expired page and a reader who may not
  see it all get the same 404 page. Nothing of a person disabled or deleted
  in the organization is served (`ownerActive`). Organization admins see
  every page and can Revoke one (`GET /api/admin/pages`,
  `POST /api/admin/pages/:id/revoke`, admin activity row `page.revoke`,
  category security); they cannot publish, change access or read content.
- Isolation. The reader never lands on the page itself. `GET
  /pages/view/<id>.<hmac>` (before the auth gate and the cookie re-issue: no
  Set-Cookie) is a Sagax wrapper with a permanent banner, "Page publiée par
  <bot> pour <personne> : ceci n'est pas un écran Sagax, n'y entrez jamais
  de mot de passe" (English for other readers), no script and nothing to
  dismiss, that embeds the page in an iframe sandboxed to `allow-scripts`
  only (Markdown: empty sandbox). The wrapper's CSP has `script-src 'none'`,
  `frame-ancestors 'none'` and `frame-src`/`child-src` set to this page's
  frame path (a host-source with the path), so the page cannot navigate its
  frame anywhere else, cannot navigate the top window (no
  allow-top-navigation), open a window (no allow-popups), show prompt() (no
  allow-modals) or submit a form (no allow-forms, `form-action 'none'`).
  `GET /pages/frame/<token>?t=<ticket>` serves the page only with the
  wrapper's five-minute HMAC ticket (bound to the page and to the reader the
  wrapper served) and only when `Sec-Fetch-Dest`, if sent, is `iframe`; the
  frame checks the reader again: the live session on the app's origin, or
  the ticket's reader, still an active person, on the separate origin. Its CSP is `sandbox` without allow-same-origin (opaque
  origin: no Sagax cookie, storage or API), `default-src 'none'`,
  `connect-src 'none'`, `frame-src 'none'`, data:/blob: images only, and
  `frame-ancestors` the wrapper's origin. No allow-modals or allow-forms
  anywhere. Not everything is a CSP request (Chromium fetches a
  `<link rel=prerender>` whatever the CSP says): the server neuters every
  HTML version as it serves it (`neuterPageHtml`: every `<link`, `<iframe`,
  `<frame`, `<frameset`, `<object`, `<embed`, `<portal`, `<fencedframe`
  becomes an inert `<sagax-removed-...>` element wherever the text appears,
  and `speculationrules` loses its meaning), and the page starts with
  `x-dns-prefetch-control: off` and `FRAME_PRELUDE`, a synchronous script
  that makes the WebRTC constructors undefined and patches every way a
  script inserts or changes an element (appendChild and kin, append and
  kin, insertAdjacent*, innerHTML and outerHTML, document.write,
  createContextualFragment, DOMParser, setAttribute and kin, Attr values,
  link rel, relList, script type, iframe srcdoc and src, createElement of a
  frame) so a resource hint or a speculation-rules script is neutered
  before it is in the document and no nested frame (a fresh realm) can be
  made. Every patched descriptor is non-configurable and non-writable. Markdown is rendered by our own escaper: no raw HTML, links
  written as text with their address. Title and content lose secret-shaped
  text before storage.
- Separate origin: `SAGAX_PAGES_ORIGIN=https://pages.example.com` (an
  origin, no path; read once at start) serves the frames there. That host
  never serves the app: `handlePagesOriginRequest` runs first in
  `handleRequest` and answers only frame paths, or nothing at all (404)
  while the separation is off. The separation is on only when the app's own
  public origin is known (organization public origin or custom domain,
  checked on each request) and differs; the frames' `frame-ancestors` is
  then that app origin, and the app origin no longer serves frames. The
  wrappers stay on the app origin (they check the reader's session).
- The app's preview is the reader's path, never a srcdoc: `GET
  /api/pages/:id/versions/:n` answers `previewPath`
  (`/pages/preview/<id>/<n>`, the page's person only, any version state),
  the same no-script wrapper with a preview banner ("Aperçu d'une page
  proposée par ... : ceci n'est pas un écran Sagax ..."), framed by the app
  (`frame-ancestors 'self'`), which frames `/pages/preview-frame/<id>/<n>`
  with a preview ticket under the same sandbox and CSP, `frame-src` pinned
  to that path. In the desktop app `will-frame-navigate` also blocks any
  navigation of a page frame other than its own exact address
  (`electron/page-frame-guard.mjs`).
- Storage and caps: the index `published-pages.json` (0600, no content) is
  read again only when its mtime or size changes; each version's content is
  `published-pages/<pageId>/<n>` (0600, folders 0700), cached in memory once
  read. At most 50 pages per person and per bot, 500 per server, 20
  versions per page (the published one is never dropped), 512 KB per
  version, 50 MB per person (checked for new versions too) and 100 MB for
  all content. The banner shows at most 60 characters of each name.
- `frame-src` names the app's known public origin (with its scheme) when
  the request came in on that host, else the Host header (a reverse proxy
  must pass it through, as Caddy does). The admin list never carries a
  page's link or path (they hold the token); admins are `orgAdminCaller`
  (admin scope and organization role admin). The desktop guard fails
  closed when a subframe navigation names no frame.
- Cross-browser escape run (Chromium, Firefox, WebKit through Playwright,
  23 vectors, reader and preview; PR #646): no attacker HTTP request, top
  never moved, frame stays on its own path. Residual risks (documented, not
  closed): Chromium opens a TCP connection (and resolves the name, about
  250 characters, once per load) for a navigation it then blocks with
  `frame-src`; WebKit opens a TCP connection on a target=_blank click; the
  page can still draw a fake login form inside its own frame under the
  banner (nothing it types can leave by HTTP); WebRTC under a name the
  prelude does not know. Not done: multi-file apps, an admin audit row per publish
  (the page keeps its own history), the phone apps' card (they show the
  row's text).

### Pages: edit, comments, annotation, Presentation, link switch (lot R8, 2026-10-21)

The reference design parity, chat rows 31 to 34. Covered by
`server/pages/published-pages-editing.test.ts`, the second case of
`server/pages/published-pages.e2e.test.ts` and `src/components/PageViewer.test.ts`.

- Full-page viewer (`src/components/PageViewer.tsx`, opened from the card's
  and the Settings row's Open full page): rename, version picker, Annotate,
  Present, Edit, Comments, Share. The page is always the preview wrapper and
  its frame, never a srcdoc. Shared controls: `src/components/page-controls.tsx`.
  ChatView is untouched (the card renders the dialog itself).
- Rename: `PATCH /api/pages/:id { title }` in any state (`page.title`, used by
  the summary, the wrapper and the frame `<title>`). Access and expiry still
  need a published page.
- The person's edit: `GET /api/pages/:id/versions/:n/source` (their own pages
  only) and `POST /api/pages/:id/versions { kind, content, title? }`: a new
  `proposed` version with `author: "person"`, under the same caps, secret-shaped
  text removed (`redact`, wired to `redactSecretsInText`). Readers keep the
  published version until the person publishes the new one (Save and publish
  reuses the page's access and a future expiry only).
- Comments: `GET|POST /api/pages/:id/comments`, `DELETE .../comments/:cid`;
  200 per page, 2000 characters, optional version and anchor. Never in the
  summary (a count only), the wrapper or the frame.
- Annotation: `/pages/preview/<id>/<n>?annotate=1` (the page's person only)
  frames `...?t=<ticket>&a=1`, which adds `ANNOTATE_SOURCE`
  (`server/pages/published-pages-render.ts`): clicks are caught before the page
  sees them, the element gets a numbered badge, and `{ type:
  "sagax-page-annotation", v: 1, n, tag, text, path }` is posted to
  `window.top`. Nothing else: no network. A Markdown page or a presentation
  runs it by a per-response nonce (`script-src 'nonce-...'`, sandbox
  `allow-scripts` for that response only); an HTML page inline after the
  prelude. A reading link never gets it, whatever its query. The app keeps a
  message only when `event.source` is the frame inside its own wrapper and
  `parseAnnotationMessage` accepts it (plain text, capped); the page's own
  scripts can forge one, which only adds a line the person sees. Send writes
  one ordinary message to the page's bot in the page's conversation
  (`annotationPrompt`: title and version, never an id).
- Presentation: `kind: "presentation"` (tool `propose_page`, the editor):
  Markdown slides split on a line of three dashes (`splitSlides`), rendered by
  our escaper into full-height sections with scroll snapping and Previous /
  Next as in-page anchors: no script at all, same sandbox and CSP as
  Markdown. Present asks the frame element for full screen; the banner stays.
- Public-link switch: `GET /api/pages/policy` (any person),
  `GET|PUT /api/admin/pages/policy { linkSharing }` (admins, audited
  `page.policy`), stored in `published-pages.json` (`policy`, absent = on).
  Off: publish or PATCH to `link` is 403 `link_sharing_off`, and a page
  already shared by link reads as `org` (signed-in people only) until it is on
  again; the link itself is kept. Settings action `org.pagesLinkSharing`
  (class org: a card at every level). On by default (the page itself still
  starts private and asks a second press for a link).
- Review of #952: every PATCH field is checked before anything changes (no
  rename kept behind a refused access); switching a published page to a link
  asks the same second press as a first publish; a refusal for a closed link
  switch reads "Choisissez « Mon organisation »" (`pageErrorText`). At most 50
  annotations; the message quotes the page's text as untrusted, never as
  instructions, and the panel shows it in full before Send; an anchor's text
  and path lose secret-shaped text. The editor, comment and reader-comment
  routes are one regex per line with their method, so each has its own
  tool-policy row, all `defaultEnabled: false`.
- Reader comments (2026-10-21): per page, off by default
  (`PATCH /api/pages/:id { readerComments }`), and an admin policy
  (`readerComments` in the pages policy, on = allowed; off: no page takes or
  shows them; settings action `org.pagesReaderComments`). On a reading link
  with them on, the wrapper adds a plain form (no script; `form-action` pinned
  to `/pages/comment/<token>`) and the approved comments, escaped. `POST
  /pages/comment/<token>` (before the auth gate): only a reader of a published
  page with them open, an Origin (when sent) of this host, never
  `Sec-Fetch-Site: cross-site`, urlencoded, 16 KB,
  name 60 and text 1000 characters, secret-shaped text removed, honeypot
  `website` thanked and dropped, 5 posts per address per 10 minutes
  (`requestSource`), 50 pending and 200 kept per page. Each waits as
  `pending` and is never shown before its person approves it in the viewer
  (`GET /api/pages/:id/reader-comments`, `POST .../:cid/approve`, `DELETE
  .../:cid`). Page history: `reader-comments`, `reader-comment`,
  `reader-comment-approve`, `reader-comment-remove`.
- Not done here: iOS (C11, annotation is desktop only on Grok too; #937 holds
  the phone screens), multi-file pages.

## Pages: audience, pin, co-edit, kept up to date

The person chooses who sees a page inside Sagax (`shared/page-audience.ts`,
`POST /api/pages/:id/share`). The mark is `person` (only them), `room` (one
room) or `group` (one group). A page marked person does not enter a room or
a group: `POST /api/pages/:id/place` answers 403 `page_audience_person` and
writes nothing. A room mark enters only that room. A group mark enters only
that group. The bot cannot change the mark. No admin route does either.
The public reading link (private, organization, link) is unchanged.

Pin is the person's (`PATCH { pinned }`). Their list shows pinned pages
first. Co-edit is the person's own version (`POST /api/pages/:id/versions`)
and the bot's `propose_page`. `PATCH { keepUpdated: true }` is the person's
switch: on a page they already published, the next version from either of
them replaces the published one. Access, audience, expiry and the link stay.
A draft is not published by that switch. Artifacts (the widget and its
refresh) are a different object and are not changed here.

Covered by `shared/page-audience.test.ts` and `server/page-share.test.ts`.

## Designs: kind design of the published pages (#2717, 2026-11-08)

Claude Design and nexu-io/open-design, the same way as the pages: no parallel
system. A design is a page of kind `design` (`shared/published-pages.ts`,
`PAGE_KINDS`), proposed by the same bot tool `propose_page` (kind design,
optional `design_system`, `design_tokens`), stored and versioned by
`PublishedPages`, shown in the same surface (`PageViewer`), shared the same way.

- Format: one HTML document; each `<section data-screen="Name"
  data-device="phone|tablet|desktop">` is a screen. `DESIGN_CANVAS_CSS`
  (`src/lib/design-systems.ts`, in the page theme layer) draws the canvas and
  the artboards without a script (`body:has(>section[data-screen])`); print
  puts one screen per sheet. `pageIsHtml(kind)` routes design like html
  (render, CSP, state).
- Design system: one `<style data-sagax-design-system="id">:root{...}</style>`
  block inside the design, so each version keeps its tokens and an export is
  self-contained. Schema: open-design's tokens (--bg, --surface, --fg, --muted,
  --border, --accent, --accent-on, --font-*, --text-*, --space-*, --radius-*).
  Built in: `sagax` (the person's look through --color-*, the default) and four
  neutral systems vendored from open-design (Apache-2.0,
  `third_party/open-design/LICENSE`, `src/lib/design-systems-vendored.ts`,
  tokens only). A person's own (from their code: `design_tokens`) live in
  `published-pages-design-systems.json` per owner (`own-<slug>`, max 20).
- Routes: `GET /api/pages/design-systems`, `DELETE /api/pages/design-systems/own-*`,
  `POST /api/pages/:id/versions` with `designSystem` (the person's pick),
  `GET /api/pages/:id/versions/:n/export?theme=` (`{ filename, html }`, any kind).
- Viewer: « ⋯ » > Design system (side panel, swatches, the person's own
  removable) and Export (HTML). Iteration stays in the same conversation
  (`proposePageCard` appends to the thread): never a new thread.
- Bot knowledge: guide `designs` (scripts/self-knowledge/guides.ts) and one
  line in `PAGE_TARGET_PROMPT` (a design skips choose_page_target).

## Artifacts: saved widgets that refresh without a turn (2026-10-16)

A bot saves a widget as an artifact (`save_artifact`, `update_artifact`,
`list_artifacts`, `delete_artifact`; `server/artifacts/artifacts.ts`,
`server/routes/artifacts.ts`, spec
`docs/superpowers/specs/2026-10-16-artifacts-design.md`). Rules:

- The settings (HTML, source, interval, favorite, popped, bounds) are the
  bot's. The person's routes change `favorite` and `popped` only, and
  delete; any other field is a 400 that says to ask the bot.
- 2026-10-28: an artifact opens only in its own window, never inside
  Sagax. Desktop: the system window (`openArtifactInOwnWindow`,
  electron/artifact-window.mjs, one per artifact); browser: a new tab on
  `/artifact-window#bot=…&artifact=…`. No floating panel, Pop out, open
  dialog or drag out of the app for artifacts (floating-windows.ts stays for
  the terminal). `popped` = open in its window; reconcile reopens them at
  start with `focus: false`; old floating panels are dropped
  (`migrateLegacyArtifactPanels`). Window ids `page:<id>` on the same bridge
  are page windows: `isPageWindowId`, ignored on close and by reconcile.
  Tests: `src/components/artifacts/artifact-windows.test.ts`.
- A bot reaches only its own artifacts: the bot is the turn capability's,
  never the body's. On a server with private threads a member sees only the
  artifacts saved from their own conversations.
- The widget renders in the chat widgets' sandbox (`allow-scripts` only,
  opaque origin, the no-network CSP). Data reaches it by `postMessage`
  (`sagax-artifact-data`); the bridge accepts only its parent.
- A refresh is never a model turn. `server/artifacts/artifact-refresh.ts` re-runs a
  source only while the artifact is open (a watch lease) or a favorite, two
  at once, 30 seconds each, and pauses it after 3 failures in a row.
- `server/artifacts/artifact-sources.ts` decides what may run with nobody there, on
  every run: `workspace_read` of the bot's own workspace, a Perspicax tool
  in `PERSPICAX_READ_ONLY_TOOLS` (in the owner's name, through the relay's
  permission guard), a remote MCP tool the person allowed for good
  (`mcp:<server>__<tool>` in the conversation's always-allow), or a command
  on the bot's own Local VM in Full access. Anything else is `blocked`,
  makes no call and counts no failure. Never widen this list without the
  same review as `PERSPICAX_READ_ONLY_TOOLS`.

## claude.ai artifacts through the person's own Claude account (#2018, 2026-11-05)

`claude_artifact` (server/drivers/agents-artifact-tools.ts, call
server/drivers/agents-call-claude-artifact.ts) is one call to Claude's
`Artifact`, `ArtifactData` or `ArtifactComments` tool: `{tool, input, html?,
file?}`. The internal route `/api/internal/claude-artifact`
(server/routes/claude-artifacts.ts) runs it as a short `claude -p`
(server/claude-artifacts/runner.ts) in the config dir of the person who speaks
in the conversation (`claudeAccountForPrincipal`). Rules:

- Only that person's own account, never another person's: no account picked
  by the runner, no fallback. No Claude login is a 409 `claude_not_signed_in`.
  A page of another claude.ai account answers `blocked: other_account`; the
  bot is asked to publish a copy from an HTML file in its workspace (or a
  paste), then return the new URL so references can be updated. A foreign
  page cannot be read with `Artifact`.
- The page goes in as `html` or `file` (a regular file inside the bot's
  workspace, realpath checked); `file_path` and the other local-path keys in
  `input` are refused. The runner stages it in a private temp folder and the
  CLI reads only that folder. Every result is untrusted data, fenced.
- The person's routes (`/api/claude-artifacts/summary|comments`, `comments/
  reply|resolve`, `copy`) use the session person only. The summary is plain
  text (tags dropped), cached 60 s per (person, url); a publish drops it.
- A published owned page is tracked per person (`DATA_DIR/claude-artifacts.json`)
  and creates, once and lazily, the person's ACTIVE routine "Commentaires des
  artefacts" (every 15 min, runAs that person). Its pre-check is code
  (`{kind: "code", check: "claude_artifact_comments"}`,
  server/routines/routine-precheck.ts): it reads the comment threads and wakes
  the bot only on `sent_to_claude` or `awaiting_reply` threads, with their
  text in the untrusted watch fence.
