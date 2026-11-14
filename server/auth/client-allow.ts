// The route table of a `client` session (what it may call), kept apart from the
// auth resolver in request-auth.ts.

/** What a `client` session may do: chat, rooms, approvals, attachments,
 * routines, its own session, and reads that carry no secrets. Everything
 * else needs `admin`: default deny, so a new route is admin-only until it is
 * deliberately listed here. Two client-allowed PATCH routes carry a body
 * filter in the handler (bot and room edits: display fields only). Loopback
 * holds both scopes. */
export type ClientFeature = "sharedComputers" | "orgPairing" | "orgDirectory" | "serverCatalogue";
export type ClientFeatures = Partial<Record<ClientFeature, boolean>>;

export const CLIENT_ALLOW: ReadonlyArray<{ methods: readonly string[]; path: RegExp; feature?: ClientFeature }> = [
  // own session
  { methods: ["GET"], path: /^\/api\/auth\/session$/ },
  // in-app feedback (#2618, #3299, server/routes/feedback.ts): the session
  // person's own reports. A report starts from /feedback in a chat. The
  // token config stays admin.
  { methods: ["GET"], path: /^\/api\/feedback$/ },
  // own preferences (organization server; the handler answers the session's person only)
  { methods: ["GET", "PUT", "PATCH"], path: /^\/api\/me\/preferences$/ },
  // Content between people (server/routes/moderation.ts, App Store 1.2): the
  // person's own blocked people and terms acceptance (the handler answers the
  // session's person only), and a report on a message of a thread they read
  // (the thread gates run first). The reports list stays admin.
  { methods: ["GET", "POST"], path: /^\/api\/me\/blocks$/ },
  { methods: ["DELETE"], path: /^\/api\/me\/blocks\/[^/]{1,600}$/ },
  { methods: ["GET", "POST"], path: /^\/api\/me\/terms$/ },
  { methods: ["POST"], path: /^\/api\/threads\/[\w-]+\/messages\/[\w-]+\/report$/ },
  // own model, effort and notification choices for a bot this person does not own
  { methods: ["GET"], path: /^\/api\/me\/bot-overrides$/ },
  { methods: ["PUT"], path: /^\/api\/me\/bot-overrides\/[\w-]+$/ },
  // the desktop's look on a personal computer, for the phone's "Same as my computer"
  { methods: ["GET", "PUT"], path: /^\/api\/me\/appearance$/ },
  // #2695: the person's own signal budget and quiet hours on a personal computer
  { methods: ["GET", "PUT"], path: /^\/api\/me\/signals$/ },
  // #3423: the person's own proactive choices (which watch domains, on which
  // of their bots); the handler answers the session's person only
  { methods: ["GET", "PUT"], path: /^\/api\/me\/proactive$/ },
  // own photo on an organization server (server/routes/me-avatar.ts): written
  // to Perspicax with the session person's own sign-in token, never anyone else's
  { methods: ["PUT", "DELETE"], path: /^\/api\/me\/avatar$/ },
  // #3424: own About me and what one's own bots learned about one
  // (server/routes/bot-memory.ts): the session person's alone, never another's
  { methods: ["GET", "PUT"], path: /^\/api\/me\/about-me$/ },
  { methods: ["GET"], path: /^\/api\/profile\/learned$/ },
  { methods: ["POST"], path: /^\/api\/profile\/learned\/[\w-]+\/remove$/ },
  // own achievements (server/routes/achievements.ts: the session's person only),
  // and colleagues' points (shared unless that person stored public false)
  { methods: ["GET"], path: /^\/api\/me\/achievements$/ },
  { methods: ["POST"], path: /^\/api\/me\/achievements\/events$/ },
  { methods: ["PUT"], path: /^\/api\/me\/achievements\/settings$/ },
  { methods: ["GET"], path: /^\/api\/achievements\/public$/ },
  // own phone tools (server/routes/phone-tools.ts: the session's person and
  // this device only; a bot's session is refused by the handler)
  // own device settings (#1545, server/routes/device-settings.ts: the session's
  // person only; answers from that person's own app, never a bot's)
  { methods: ["GET"], path: /^\/api\/me\/device-settings\/requests$/ },
  { methods: ["POST"], path: /^\/api\/me\/device-settings\/requests\/[\w-]+$/ },
  { methods: ["POST"], path: /^\/api\/me\/device-settings\/apply$/ },
  { methods: ["POST"], path: /^\/api\/me\/phone-tools\/device$/ },
  { methods: ["GET"], path: /^\/api\/me\/phone-tools\/requests$/ },
  { methods: ["POST"], path: /^\/api\/me\/phone-tools\/requests\/[\w-]+$/ },
  { methods: ["GET", "DELETE"], path: /^\/api\/me\/phone-tools\/grants$/ },
  // "Scanner avec l'iPhone" from the person's own computer (the handler refuses a bot or a phone)
  { methods: ["GET", "POST"], path: /^\/api\/me\/phone-tools\/card-scan$/ },
  { methods: ["POST"], path: /^\/api\/me\/phone-tools\/card-scan\/[\w-]+\/wait$/ },
  { methods: ["DELETE"], path: /^\/api\/me\/phone-tools\/card-scan\/[\w-]+$/ },
  // People's custom labels (server/routes/person-labels.ts): everyone reads
  // them; the handler lets a person change their own, an organization admin
  // anyone's and a team manager their team's people.
  { methods: ["GET"], path: /^\/api\/people\/labels$/ },
  { methods: ["PUT"], path: /^\/api\/people\/pr_[0-9a-f-]{36}\/label$/ },
  // The bot settings of the phone's Settings sheet (auto-review default, time
  // zone): the person's own on an organization server; on a solo server the
  // handler lets only the owner change the server's.
  { methods: ["GET", "PUT"], path: /^\/api\/settings\/bot$/ },
  // Delete my account (organization server: the handler deletes only the
  // session's own person; a solo server answers 400 personal_server).
  { methods: ["DELETE"], path: /^\/api\/me$/ },
  // Sign in again right before that deletion (2026-10-18): the handler opens
  // a ticket for the session's own person only.
  { methods: ["POST"], path: /^\/api\/me\/reauth$/ },
  // The phone's Bot Computer screen: one route for the person's own
  // computer (their server environment, or this computer's local container,
  // which the handler keeps to the owner).
  { methods: ["GET"], path: /^\/api\/computer\/status$/ },
  // the live view and capture of a bot's own cloud computer: the handler
  // lets only that bot's owner (or this computer's own person) through
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/computer\/(?:join|screenshot)$/ },
  // the bot panel's Computer row thumbnail: the handler keeps a person's own
  // capture to them and the bot's computer captures to who may see it
  { methods: ["GET", "PUT"], path: /^\/api\/bots\/[\w-]+\/computer\/thumbnail$/ },
  // Computer tab: attach enrolled unattended hosts to a bot the person edits.
  // Handler enforces person isolation (own hosts only) in remote-bot-hosts.ts.
  { methods: ["GET", "POST"], path: /^\/api\/bots\/[\w-]{1,80}\/remote-hosts$/ },
  { methods: ["DELETE"], path: /^\/api\/bots\/[\w-]{1,80}\/remote-hosts\/(h_[0-9a-f]{32})$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]{1,80}\/remote-hosts\/(h_[0-9a-f]{32})\/open$/ },
  // Computers panel: the person's own enrolled hosts, an install code to add
  // one (Unattended Remote Control) and placing one on their own team.
  // Handler enforces person isolation in routes/remote-hosts.ts.
  { methods: ["GET"], path: /^\/api\/remote-hosts$/ },
  { methods: ["POST"], path: /^\/api\/remote-hosts\/code$/ },
  { methods: ["PUT"], path: /^\/api\/remote-hosts\/h_[0-9a-f]{32}\/team$/ },
  { methods: ["POST"], path: /^\/api\/computer\/(?:update|reset)$/ },
  // Its scheduled update, read and set from the phone (parity R7, O2). The
  // handler (routes/computer-care.ts) keys it to the person's own computer.
  // The disk saver stays admin.
  { methods: ["GET", "PUT"], path: /^\/api\/computer\/maintenance$/ },
  // In-chat terminal: list shell-capable resources and manage the person's own sessions.
  { methods: ["GET"], path: /^\/api\/terminal\/resources$/ },
  { methods: ["GET", "POST"], path: /^\/api\/terminal\/sessions\/[\w-]+(?:\/(?:bot-input|close))?$/ },
  // The usage card the person asked for (server/routes/resource-usage.ts): the
  // handler answers the person who asked only.
  { methods: ["GET", "POST"], path: /^\/api\/resource-usage\/ru_[a-f0-9]{18}(?:\/(?:live|resume|pause))?$/ },
  // "Connect Microsoft Teams" card (server/routes/connector-setup.ts): the
  // handler answers the person the card is for only.
  { methods: ["POST"], path: /^\/api\/connector-setup\/cs_[a-f0-9]{18}\/check$/ },
  // Plugin catalog (reads: names, descriptions, icons; no secrets). Installing
  // one changes the server's MCP servers: the handler lets through an admin
  // or this computer's own person (clientSessionIsComputerOwner), nobody else.
  { methods: ["GET"], path: /^\/api\/plugins\/(?:search|installed)$/ },
  { methods: ["POST"], path: /^\/api\/plugins\/install$/ },
  { methods: ["POST"], path: /^\/api\/auth\/stream-ticket$/ },
  { methods: ["POST"], path: /^\/api\/auth\/logout$/ },
  // Own outbound desktop connector, additionally bound to a private secret.
  // Only honoured while features.sharedComputers is on (see requiredScope):
  // with the feature off these paths are as unlisted as any other, so a
  // client session is refused exactly the way an unknown route refuses it.
  { methods: ["POST"], path: /^\/api\/shared-computers\/(?:connect|[\w-]+\/(?:poll|lease|result|disconnect))$/, feature: "sharedComputers" },
  // Organization server: the person's own desktop app bridges their computer
  // (server/desktop/desktop-bridge-routes.ts). The handler answers the session's own
  // person only, binds poll/results to a private desktop secret, and 404s on
  // a solo server.
  { methods: ["POST"], path: /^\/api\/desktop-bridge\/(?:connect|[0-9a-f-]{36}\/(?:poll|lease|result|disconnect|system|local-models))$/ },
  { methods: ["GET"], path: /^\/api\/me\/desktop-bridge$/ },
  { methods: ["POST"], path: /^\/api\/me\/desktop-bridge\/local-vm$/ },
  { methods: ["POST"], path: /^\/api\/me\/desktop-bridge\/computers\/(?:rename|remove)$/ },
  { methods: ["GET", "PUT"], path: /^\/api\/me\/local-models$/ },
  // Organization server (SAGAX_IDENTITY=perspicax): a member pairs their own
  // phone or computer. The handler binds the code to the member's person and
  // clamps its scopes to the session's own.
  { methods: ["POST"], path: /^\/api\/auth\/pairing$/, feature: "orgPairing" },
  // What this person has lent (owner-scoped status, no secrets). Same gate.
  { methods: ["GET"], path: /^\/api\/shared-computers$/, feature: "sharedComputers" },
  // Inline video widgets: YouTube transcripts. Proxied media
  // (/api/media/proxy/<token>) is answered before this gate: its signed token
  // is the authorization (server/routes/media-widgets.ts).
  { methods: ["POST"], path: /^\/api\/youtube\/transcript$/ },
  // liveness, identity, the stream
  { methods: ["GET"], path: /^\/api\/health$/ },
  { methods: ["GET"], path: /^\/api\/edition$/ },
  { methods: ["GET"], path: /^\/api\/brand$/ },
  { methods: ["GET"], path: /^\/api\/events$/ },
  // reads: fleet, transcripts, search (no secrets in any of these)
  { methods: ["GET"], path: /^\/api\/bots$/ },
  { methods: ["GET"], path: /^\/api\/team-map$/ },
  // The engines catalogue the model picker and the chat header read. A
  // non-admin session gets clientInstanceView(): engine names, models,
  // capabilities and availability, never the host's CLI paths, install
  // commands, sign-in state or account addresses. Changing engines stays admin.
  // An organization server lists it under orgDirectory below instead, with
  // a member's copy (memberInstanceView in server/index.ts).
  { methods: ["GET"], path: /^\/api\/instances$/, feature: "serverCatalogue" },
  // a link into the organisation's Admin: identifiers only, and Admin authorizes its own visitor
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/slack-management$/ },
  // the bot's own email address from the Perspicax relay (an address, no id, no secret)
  // and its owner's change of it (PUT: the handler checks the owner)
  { methods: ["GET", "PUT"], path: /^\/api\/bots\/[\w-]+\/inbound-mail$/ },
  // #4250: what the viewer can watch in their products (URIs and names, read
  // with the viewer's own sign-in), for the routine editor
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/watchable-resources$/ },
  // "Me joindre": the person's own channels and hours for this bot (each
  // person chooses for themself, no admin); Telegram's token is write only
  { methods: ["GET", "PUT"], path: /^\/api\/bots\/[\w-]+\/reach-me$/ },
  { methods: ["POST", "DELETE"], path: /^\/api\/bots\/[\w-]+\/reach-me\/telegram$/ },
  { methods: ["POST", "PUT", "DELETE"], path: /^\/api\/bots\/[\w-]+\/reach-me\/whatsapp$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/reach-me\/whatsapp\/link$/ },
  // Watch and take over the bot's saved browser. The handler checks the
  // viewer may use the bot. Install and restart stay admin.
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/browser\/live$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/browser\/action$/ },
  { methods: ["GET"], path: /^\/api\/search$/ },
  { methods: ["GET"], path: /^\/api\/threads\/[\w-]+\/messages$/ },
  { methods: ["GET"], path: /^\/api\/threads\/[\w-]+\/messages\/[\w-]+\/image$/ },
  { methods: ["GET"], path: /^\/api\/threads\/[\w-]+\/export$/ },
  // POST downloads a file a message shares; GET ?preview=1&ref=N streams the
  // image a bot's Markdown renders at that offset (MarkdownImagePreview). The
  // handler grants both from the message itself, the same check for both.
  { methods: ["POST", "GET"], path: /^\/api\/threads\/[\w-]+\/messages\/[\w-]+\/file$/ },
  // a conversation's files (the bot panel's Files tab): the list and one file by id
  { methods: ["GET"], path: /^\/api\/threads\/[\w-]+\/files$/ },
  { methods: ["GET"], path: /^\/api\/threads\/[\w-]+\/files\/[a-f0-9]{24}$/ },
  // pin or unpin a file of the conversation (the Library tab); kept on the server
  { methods: ["POST"], path: /^\/api\/threads\/[\w-]+\/files\/[a-f0-9]{24}\/pin$/ },
  // what a bot is doing (the bot panel's Coding list): narrowed to the
  // viewer's own threads and the routines they may see (routes/bot-activity.ts)
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/activity(?:\/item)?$/ },
  // The Coding branches in the bot panel (server/routes/bot-code-branches.ts):
  // the person's own threads only (thread.post), their own credentials.
  { methods: ["GET", "POST"], path: /^\/api\/bots\/[\w-]+\/code\/(?:branch(?:\/(?:diff|pull|commit|push|pr|delete))?|branches\/archived)$/ },
  // Cloud coding agents (server/routes/cloud-agents.ts): reads for any bot
  // the viewer may see; writes use the session person's encrypted provider keys.
  { methods: ["GET", "POST"], path: /^\/api\/bots\/[\w-]+\/cloud-agents(?:\/[\w-]+(?:\/(?:follow-up|cancel|archive|artifacts|transcript))?)?$/ },
  { methods: ["GET", "PUT", "DELETE", "POST"], path: /^\/api\/me\/cloud-agent-providers(?:\/(?:cursor|claude|codex)(?:\/test)?)?$/ },
  // The person's own web search provider and key (server/routes/web-search.ts,
  // 2026-10-26): theirs on an organization server, no admin right; the key is
  // never answered back.
  { methods: ["GET", "PUT", "DELETE", "POST"], path: /^\/api\/me\/web-search(?:\/test)?$/ },
  // Memes (#2121): the person's Tenor/GIPHY key (never answered back) and the
  // search / materialize proxy used by the Memes picker.
  { methods: ["GET", "PUT", "DELETE"], path: /^\/api\/me\/memes$/ },
  { methods: ["GET"], path: /^\/api\/memes\/(?:search|trending)$/ },
  { methods: ["POST"], path: /^\/api\/memes\/materialize$/ },
  // The person's own Experimental switches and display preferences
  // (server/routes/person-settings.ts) and own voice keys
  // (server/routes/person-voice-keys.ts), #1098: theirs, no admin right;
  // a key is never answered back.
  { methods: ["GET", "PATCH"], path: /^\/api\/me\/experimental$/ },
  { methods: ["GET"], path: /^\/api\/me\/voice-keys$/ },
  { methods: ["PUT", "DELETE"], path: /^\/api\/me\/voice-keys\/(?:elevenlabs|fish|xai|openai)$/ },
  { methods: ["GET"], path: /^\/api\/me\/providers$/ },
  { methods: ["PUT", "DELETE"], path: /^\/api\/me\/providers\/(?:keys|servers)\/[^/]{1,100}$/ },
  // The person's visit signature (server/routes/web-bot-auth.ts): on unless
  // they turn it off. No admin right. The private key is never answered.
  { methods: ["GET", "PUT"], path: /^\/api\/me\/web-bot-auth$/ },
  // Linked Grok (#2193): the person's own webhook URL and sealed key.
  // No admin right. The key is never answered back.
  { methods: ["GET", "PUT", "DELETE", "POST"], path: /^\/api\/me\/grok-bridge(?:\/(?:test|dead|leases))?$/ },
  // Connect apps > Tailscale: the person's bot computer joins their tailnet.
  { methods: ["GET", "DELETE"], path: /^\/api\/me\/tailscale$/ },
  { methods: ["POST"], path: /^\/api\/me\/tailscale\/(setup|join|refresh|disconnect)$/ },
  // The person's own OpenAPI document (server/routes/openapi-connector.ts).
  // Their bots only. No admin right. Header values are never answered.
  { methods: ["GET", "PUT", "DELETE"], path: /^\/api\/me\/openapi$/ },
  // The person's YAML workflows (server/routes/workflows.ts). No admin right.
  // Steps do not start a model turn. An approval waits for their answer.
  { methods: ["GET", "PUT"], path: /^\/api\/me\/workflows$/ },
  { methods: ["DELETE", "POST"], path: /^\/api\/me\/workflows\/[a-z][a-z0-9-]{0,40}(?:\/run)?$/ },
  { methods: ["GET"], path: /^\/api\/me\/workflows\/runs\/wf_[a-f0-9]{16}$/ },
  { methods: ["POST"], path: /^\/api\/me\/workflows\/runs\/wf_[a-f0-9]{16}\/answer$/ },
  // The local health report (server/routes/health-report.ts). The scanner
  // is a separate process. No admin right.
  { methods: ["GET"], path: /^\/api\/me\/health-report$/ },
  // The Code section (server/routes/code.ts): the person's own Perspicax
  // runs, called with their own sign-in token; Perspicax decides the rest.
  { methods: ["GET", "POST"], path: /^\/api\/code\/(?:status|environments|runs(?:\/[A-Za-z0-9_-]{1,80}(?:\/(?:events|stream|read|followup|approve|stop|archive|diff|commits|files))?)?)$/ },
  // chat, one to one
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/messages$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/messages\/[\w-]+\/edit$/ },
  // 2026-10-30: a person's answer to a proactive proposal in their own
  // conversation (the handler checks they may write there)
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/proactive\/[\w-]+(?:\/feedback)?$/ },
  // 2026-11-05 (visible roles, server/routes/perspicax-roles.ts): an "Agit
  // comme" card answered in the person's own thread, and the bot owner's
  // "Toujours ainsi" rules; the handlers check the thread and the owner
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/cards\/[\w-]+\/role-transition$/ },
  { methods: ["GET", "DELETE"], path: /^\/api\/bots\/[\w-]+\/roles\/rules$/ },
  // the composer's role picker: the signed-in person's own held roles (live identity_switch)
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/roles\/held$/ },
  // the routine editor's "Au nom de" coverage (server/routes/routine-role-coverage.ts):
  // the run-as person's live roles; the handler checks the routine
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/roles\/routine-coverage$/ },
  // batch 5: the bot panel's Roles tab (the person's own graph and refusals)
  // and "Envoyer à l'admin" (a Sagax message to the admins, never a CW write)
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/roles$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/roles\/missing\/send$/ },
  // pre-warm the engine of a conversation the person opened (server/threads/thread-prewarm.ts)
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/warm$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/active-branch$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/compact$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/interrupt$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/read$/ },
  { methods: ["DELETE"], path: /^\/api\/bots\/[\w-]+\/queue\/[\w-]+$/ },
  // stop one parallel task (shared/parallel-tasks.ts); the handler checks the thread is theirs
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/parallel\/[\w-]+\/stop$/ },
  // Steer a queued message into the running turn: the cancel's guards, plus
  // the send's (the viewer's own thread; a Cloud guest only in a thread it
  // started). It never starts a turn or changes a setting.
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/queue\/[\w-]+\/steer$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/tasks$/ },
  { methods: ["POST", "PATCH", "DELETE"], path: /^\/api\/bots\/[\w-]+\/tasks\/[\w-]+$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/tasks\/[\w-]+\/title$/ }, // Regenerate title: a rename by the bot's own engine
  { methods: ["PATCH"], path: /^\/api\/bots\/[\w-]+\/profile$/ },
  // A bot's own parallel conversations, automatic recovery and tool access
  // (server/routes/bot-runtime-settings.ts): the handler lets through the
  // bot's owner (with bots.behaviour / bots.tools) or an admin; an
  // admin-tier grant stays an admin's.
  { methods: ["GET", "PATCH"], path: /^\/api\/bots\/[\w-]+\/runtime-settings$/ },
  // #1137: a group's override of who pays for one bot
  // (server/routes/group-bot-payer.ts): the bot's owner or an admin.
  { methods: ["PUT"], path: /^\/api\/groups\/[\w-]+\/bot-payer$/ },
  { methods: ["GET", "POST"], path: /^\/api\/bots\/[\w-]+\/tool-grants$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/tool-grants\/tg_[\w-]+\/revoke$/ },
  // 2026-10-26: the person's own tool access (server/routes/my-tool-grants.ts),
  // always the caller's own; a scope past their environment stays an admin's
  { methods: ["GET", "POST"], path: /^\/api\/me\/tool-grants$/ },
  // Import preference lines onto the person's own primary bot. The handler
  // checks the bot. Not the agent import, and not an admin route.
  { methods: ["POST"], path: /^\/api\/me\/preference-import\/(?:preview|apply)$/ },
  { methods: ["POST"], path: /^\/api\/me\/tool-grants\/tg_[\w-]+\/revoke$/ },
  { methods: ["PATCH"], path: /^\/api\/bots\/[\w-]+$/ }, // display fields only, or the owner's own bot: see clientBotPatchViolation
  // iOS parity (docs/ios-companion.md): the owner's (or an admin's) picture
  // generation, and the bot profile's Links, Media and Files tabs. The
  // handlers check the owner and narrow the threads to the viewer's own.
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/avatar\/generate$/ },
  // Shape avatar geometry JSON via the bot's text model (fallback presets).
  // Handler checks the owner; never an admin-only gate on the person's own bot.
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/shape-avatar\/generate$/ },
  // #1098: a bot's outbound allowance and today's count (Sending on your
  // behalf), for the owner who sets it; the handler checks the owner.
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/outbound$/ },
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/(?:links|files)$/ },
  // artifacts (server/routes/artifacts.ts): the route checks the bot and,
  // on a shared server, that the artifact is this person's
  { methods: ["GET"], path: /^\/api\/artifacts$/ },
  { methods: ["POST"], path: /^\/api\/artifacts\/watch$/ },
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/artifacts$/ },
  { methods: ["GET", "PATCH", "DELETE"], path: /^\/api\/bots\/[\w-]+\/artifacts\/art_[\w-]+$/ },
  // The person's task list for a bot they use (server/routes/bot-task-list.ts).
  // Not an organization setting. The handler keeps another person's list out.
  { methods: ["GET", "POST"], path: /^\/api\/bots\/[\w-]+\/task-list$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/task-list\/task_[\w-]+\/(?:advance|complete|resume|reopen)$/ },
  { methods: ["DELETE"], path: /^\/api\/bots\/[\w-]+\/task-list\/task_[\w-]+$/ },
  // The person's background brief for a bot they own (server/routes/background-brief.ts).
  // The handler refuses anyone but the bot's person. Not an admin route.
  { methods: ["GET", "PUT"], path: /^\/api\/bots\/[\w-]+\/background-brief$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/background-brief\/pass$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/background-brief\/[\w-]+\/(?:reject|keep|feedback)$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/artifacts\/art_[\w-]+\/refresh$/ },
  // claude.ai artifacts (server/routes/claude-artifacts.ts, #2018): every
  // call runs through the session person's own Claude account
  { methods: ["GET"], path: /^\/api\/claude-artifacts\/(?:summary|comments)$/ },
  { methods: ["POST"], path: /^\/api\/claude-artifacts\/(?:comments\/(?:reply|resolve)|copy)$/ },
  // Share as Template: a single-bot package without secrets (owner or admin).
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/export$/ },
  // The bot's standing instructions for the profile's Instructions row
  // (owner or admin, checked in the handler).
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/soul$/ },
  // The bot workspace (server/routes/bot-workspace.ts): the Files list, a
  // download, RULES.md and docs/<name>.md read, save, delete and rename,
  // and create / upload / move / delete for any file or folder in the bot
  // folder. Same gate as the Soul edit, checked in the handler: owner (or
  // edit grant) or admin; a person who may only use shared bots is refused.
  // MEMORY.md and memory/ are the memory routes below.
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/workspace(?:\/(?:download|count))?$/ },
  { methods: ["GET", "PUT", "DELETE"], path: /^\/api\/bots\/[\w-]+\/workspace\/file$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/workspace\/(?:docs\/rename|mkdir|touch|rename|upload)$/ },
  { methods: ["DELETE"], path: /^\/api\/bots\/[\w-]+\/workspace\/entry$/ },
  // 2026-10-26: the bot's memory (server/routes/bot-memory.ts):
  // MEMORY.md, memory/ topics, the journal and its revert, upkeep and tidy.
  // Same gate as the Soul edit, checked in the handler: a member keeps the
  // memory of their own bots without an admin.
  { methods: ["GET", "PUT"], path: /^\/api\/bots\/[\w-]+\/memory$/ },
  { methods: ["GET", "PUT", "DELETE"], path: /^\/api\/bots\/[\w-]+\/memory\/file$/ },
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/memory\/(?:journal|upkeep|semantic)$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/memory\/(?:journal\/[\w-]+\/revert|tidy|rename|import)$/ },
  // 2026-10-26: the bot's change history, its SOUL.md undo and a
  // version restore: the owner (or an edit grant) or an admin, checked in
  // the handlers.
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/history$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/history\/(?:rollback|restore)$/ },
  // 2026-11-06: the bot's analytics (server/routes/bot-analytics.ts); the
  // handler narrows a plain member to their own turns.
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/analytics$/ },
  // #2698: its proactivity metrics (server/routes/proactive-metrics.ts); the
  // handler answers the owner, an edit grant or an admin only.
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/proactive-metrics$/ },
  // The rule sets (server/routes/bot-rules.ts): list, add, rename, switch,
  // reorder, save a set's text, delete. Same gate as the Soul edit, checked
  // in the handler.
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/rules$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/rules\/sets$/ },
  { methods: ["PUT"], path: /^\/api\/bots\/[\w-]+\/rules\/order$/ },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/bots\/[\w-]+\/rules\/sets\/[a-z0-9-]+$/ },
  { methods: ["PUT"], path: /^\/api\/bots\/[\w-]+\/rules\/sets\/[a-z0-9-]+\/text$/ },
  { methods: ["POST", "DELETE"], path: /^\/api\/bots\/[\w-]+\/primary$/ }, // the person's own bot only: the handler checks the owner
  // What the bot does, can reach and won't do (the profile's "What this bot
  // does"): the handler lets a client session read it for a bot it owns.
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/overview$/ },
  // the prompt preview of a bot the session owns (the handler checks the owner)
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/system-prompt$/ },
  // the presets New bot offers: a person who creates bots starts from one
  // (read only; removing one stays admin)
  { methods: ["GET"], path: /^\/api\/bot-presets$/ },
  // A bot's saved command rules: its owner (or this computer's own person)
  // reads and removes them; adding one stays admin (the handler decides).
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/command-allowlist$/ },
  { methods: ["DELETE"], path: /^\/api\/bots\/[\w-]+\/command-allowlist\/[\w-]+$/ },
  // An organization member's own bots: the handler requires a member or
  // admin role, limits the fields (memberBotFieldViolation) and, for a
  // delete, that the session owns the bot.
  { methods: ["POST"], path: /^\/api\/bots$/ },
  { methods: ["DELETE"], path: /^\/api\/bots\/[\w-]+$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/direct-grants$/ },
  // The owner removes a person's grant (server/auth/direct-grants.ts checks ownership)
  { methods: ["DELETE"], path: /^\/api\/bots\/[\w-]+\/direct-grants\/pr_[0-9a-f-]{36}$/ },
  // approvals and cards
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/respond$/ },
  { methods: ["POST"], path: /^\/api\/threads\/[\w-]+\/respond$/ },
  { methods: ["POST"], path: /^\/api\/threads\/[\w-]+\/undo$/ }, // whoever may answer the card: see the handler
  // the Approvals screen (server/routes/approvals-inbox.ts): the person's own
  // cards, answered with the same refusals as /respond, once, never remembered
  { methods: ["GET"], path: /^\/api\/approvals$/ },
  { methods: ["POST"], path: /^\/api\/approvals\/bulk$/ },
  // #3471: a "needs you" card of the person's own conversation marked
  // handled, or skipped (`skip: true`); the handler keeps it to their cards
  { methods: ["POST"], path: /^\/api\/approvals\/handled$/ },
  // 2026-10-26: the Journal of the person's own bots and "Tester cette
  // règle" (read only, nothing saved); the handler keeps it to their bots
  { methods: ["GET"], path: /^\/api\/approvals\/journal$/ },
  { methods: ["POST"], path: /^\/api\/approvals\/journal\/test$/ },
  // a ConnectWise widget's change: an approval card for whoever may answer it (server/widgets/cw-widget-actions.ts)
  { methods: ["POST"], path: /^\/api\/threads\/[\w-]+\/cw-actions$/ },
  // an email draft's Send: an approval card for the bot's owner, then the send
  // once they allow it (server/mail/email-draft-send.ts)
  { methods: ["POST"], path: /^\/api\/threads\/[\w-]+\/email-drafts$/ },
  { methods: ["GET"], path: /^\/api\/threads\/[\w-]+\/email-drafts\/[\w-]+$/ },
  // published pages: a person's own pages only (server/routes/published-pages.ts
  // checks the owner on every call; a bot's shell never publishes)
  { methods: ["GET"], path: /^\/api\/pages$/ },
  { methods: ["GET", "PATCH", "DELETE"], path: /^\/api\/pages\/[\w-]+$/ },
  { methods: ["GET"], path: /^\/api\/pages\/[\w-]+\/versions\/\d+$/ },
  { methods: ["POST"], path: /^\/api\/pages\/[\w-]+\/(?:publish|decline|revoke)$/ },
  // The person's own share and the check that a person-marked page does not
  // enter a room or a group (server/routes/published-pages.ts). Not an admin route.
  { methods: ["POST"], path: /^\/api\/pages\/[\w-]+\/(?:share|place)$/ },
  // #3413: a page's capability bridge, called by its wrapper with the
  // reader's own session (server/routes/page-data.ts): what the version
  // declares, the reader's own data from a declared source, and who reads.
  // The handler answers for the session's person only.
  { methods: ["GET"], path: /^\/api\/pages\/[\w-]+\/(?:capabilities|viewer|data\/[\w-]+)$/ },
  // the reader's own answer to an Ask first card of a data read (never a
  // bot's act copy: the handler refuses it)
  { methods: ["POST"], path: /^\/api\/pages\/[\w-]+\/data-approvals\/[\w-]+$/ },
  // "Always allow this site" on a page's link card: the reader's own (the
  // handler refuses a bot's act copy), read, kept or forgotten
  { methods: ["GET", "POST", "DELETE"], path: /^\/api\/pages\/[\w-]+\/link-approvals$/ },
  { methods: ["PATCH"], path: /^\/api\/bots\/[\w-]+\/cards\/[\w-]+$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/secret-cards\/[\w-]+\/(?:resume|dismiss)$/ },
  // A sign-in card's Done or Cancel. The bot's browser itself stays admin
  // scope: it can hold the owner's signed-in sessions.
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/sign-in-cards\/[\w-]+\/(?:done|cancel)$/ },
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/connector-cards\/[\w-]+\/status$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/connector-cards\/[\w-]+\/(?:resume|dismiss)$/ },
  // Connect the app a card asks for (iOS parity S2). It signs an account into
  // the server's own connected apps, so the handler lets through only the
  // bot's owner on a personal server or this computer's own person
  // (clientSessionIsComputerOwner), never on an organization server.
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/connector-cards\/[\w-]+\/authorize$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/always-allow$/ }, // must match a pending card
  // 2026-10-14: a person's own approval rules; the handlers keep them to
  // the person (and the bot's owner).
  { methods: ["GET"], path: /^\/api\/approval-rules$/ },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/approval-rules\/[\w-]+$/ },
  // 2026-10-16: a person's own custom auto-review rules; the handler keeps
  // them to the person and never to a bot's act copy of a session.
  { methods: ["GET", "POST"], path: /^\/api\/custom-rules$/ },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/custom-rules\/[\w-]+$/ },
  // 2026-10-16: a person's own security keys and the approvals that need
  // one (server/routes/security-keys.ts); always the caller's own.
  { methods: ["GET"], path: /^\/api\/security-keys$/ },
  { methods: ["PUT"], path: /^\/api\/security-keys\/classes$/ },
  { methods: ["POST"], path: /^\/api\/security-keys\/(?:register|begin)$/ },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/security-keys\/[A-Za-z0-9_-]{1,1400}$/ },
  // rooms
  { methods: ["GET", "POST"], path: /^\/api\/groups$/ },
  { methods: ["POST"], path: /^\/api\/groups\/[\w-]+\/messages$/ },
  // #1480, #1786: a person listed in a group leaves it on their own. The
  // handler (planGroupLeave) names who leaves from the session, never the
  // body, and refuses anyone who is not listed.
  { methods: ["POST"], path: /^\/api\/groups\/[\w-]+\/leave$/ },
  { methods: ["POST"], path: /^\/api\/groups\/[\w-]+\/interrupt$/ },
  { methods: ["POST"], path: /^\/api\/groups\/[\w-]+\/members\/[\w-]+\/compact$/ },
  { methods: ["POST"], path: /^\/api\/groups\/[\w-]+\/read$/ },
  { methods: ["DELETE"], path: /^\/api\/groups\/[\w-]+\/queue\/[\w-]+$/ },
  // the room's steer: refused to a read-only member, as posting is
  { methods: ["POST"], path: /^\/api\/groups\/[\w-]+\/queue\/[\w-]+\/steer$/ },
  { methods: ["POST"], path: /^\/api\/groups\/[\w-]+\/tasks$/ },
  { methods: ["POST", "PATCH", "DELETE"], path: /^\/api\/groups\/[\w-]+\/tasks\/[\w-]+$/ },
  // the folders of a conversation with a person's threads, its two people's
  // (server/routes/group-folders.ts; a room has none)
  // the folders of a bot's threads: the handler lets only the bot's owner
  // (or an admin) organize them, never another person's bot
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/projects$/ },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/bots\/[\w-]+\/projects\/[\w-]+$/ },
  { methods: ["POST"], path: /^\/api\/groups\/[\w-]+\/projects$/ },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/groups\/[\w-]+\/projects\/[\w-]+$/ },
  { methods: ["PATCH"], path: /^\/api\/groups\/[\w-]+$/ }, // display fields only: see clientGroupPatchViolation
  // a group's shared memory: its people read, its owner edits (server/routes/group-memory.ts)
  { methods: ["GET", "PUT"], path: /^\/api\/groups\/[\w-]+\/memory$/ },
  // a direct conversation with another person of the organization (server/people/people-dms.ts)
  { methods: ["POST"], path: /^\/api\/people-dms$/ },
  // Shake that person's Sagax (server/routes/nudges.ts). The handler checks
  // the person and the 5 minute cooldown.
  { methods: ["POST"], path: /^\/api\/nudges$/ },
  // Who of the organization is online, away or offline, and this app's
  // heartbeat (server/routes/presence.ts). The handler answers a person of
  // the directory only: not a service account, not another issuer.
  { methods: ["GET"], path: /^\/api\/org\/presence$/, feature: "orgDirectory" },
  { methods: ["POST"], path: /^\/api\/presence\/heartbeat$/, feature: "orgDirectory" },
  // This person's phones for APNs pushes (server/routes/push-devices.ts):
  // register, list (tokens masked) and remove their own devices only.
  { methods: ["GET", "POST", "DELETE"], path: /^\/api\/push\/devices$/ },
  // Organization server: a group's owner deletes it (server/groups/group-ownership.ts);
  // the route refuses a client session anywhere else.
  { methods: ["DELETE"], path: /^\/api\/groups\/[\w-]+$/ },
  { methods: ["POST"], path: /^\/api\/threads\/[\w-]+\/messages\/[\w-]+\/reactions$/ },
  // read receipts: the positions a person may see, and their own (server/messages/read-receipts.ts)
  { methods: ["GET", "POST"], path: /^\/api\/threads\/[\w-]+\/read$/ },
  // attachments
  { methods: ["POST"], path: /^\/api\/attachments$/ },
  { methods: ["GET"], path: /^\/api\/attachments\/[\w.-]+$/ },
  { methods: ["POST"], path: /^\/api\/files$/ },
  // voice: labels and audio, never the key
  { methods: ["GET"], path: /^\/api\/tts\/voices$/ },
  { methods: ["POST"], path: /^\/api\/tts\/prepare$/ },
  { methods: ["POST"], path: /^\/api\/tts\/speak$/ },
  // voice mode (server/voice/voice-mode.ts): the speaker's own turn on a bot they may use; never the key
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/voice\/(?:status|voices|listen|speech|realtime)$/ },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/voice\/(?:prepare|speak|transcribe|stream|call)$/ },
  // the person's own providers, a provider's voices and the voice test (Settings > Voice, 2026-10-29)
  { methods: ["GET"], path: /^\/api\/voice\/(?:status|voices)$/ },
  { methods: ["POST"], path: /^\/api\/voice\/speak$/ },
  // routines: a scheduled message; the input carries no cwd or permission field
  { methods: ["GET"], path: /^\/api\/routines$/ },
  // the routine modal's "Runs as" choices (server/routines/routine-run-as.ts)
  { methods: ["GET"], path: /^\/api\/routines\/run-as-options$/ },
  { methods: ["POST"], path: /^\/api\/routines$/ },
  { methods: ["GET", "PATCH", "DELETE"], path: /^\/api\/routines\/[\w-]+$/ },
  { methods: ["POST"], path: /^\/api\/routines\/[\w-]+\/(?:run|check)$/ },
  // "Check now" of "Only when something changes" (#1202): one reading, no
  // model, nothing kept; the handler applies the same rights as saving a
  // routine of that bot, so a member checks their own watch without an admin
  { methods: ["POST"], path: /^\/api\/routines\/watch-check$/ },
  // Routine folders (routes/routine-folders.ts): the handler applies the
  // same rights as changing a routine of that bot, so a member arranges
  // their own bot's folders without an admin (2026-10-28)
  { methods: ["POST"], path: /^\/api\/routines\/folders$/ },
  // Several routines of one bot on, off or deleted at once (server/routine-bulk.ts,
  // 2026-10-29): each one with the same rights as its own PATCH or DELETE
  { methods: ["POST"], path: /^\/api\/routines\/bulk$/ },
  // Limit-reset automations (routes/limit-resets.ts): the person's own engines
  // and bots. Continue and after-reset go through routine submit / defer; a
  // member uses them in their sandbox without an admin right.
  { methods: ["GET"], path: /^\/api\/limit-resets$/ },
  { methods: ["POST"], path: /^\/api\/limit-resets\/(?:continue|after-reset)$/ },
  // "Only when I'm here" (routes/routine-away.ts): the page's beat, the
  // person's own state, and dismissing their report (the route checks whose)
  // "Create a Team Bot from this conversation" (routes/team-bot-from-thread.ts):
  // reading the conversation and changing the new bot are checked there
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/team-bot-(?:draft|carry)$/ },
  // The bot creation wizard's draft (routes/bot-wizard.ts): the bot's
  // owner's, checked there; a member runs it alone (2026-10-26)
  { methods: ["GET"], path: /^\/api\/bot-wizard(?:\/kits)?$/ },
  { methods: ["GET", "PUT", "PATCH", "DELETE"], path: /^\/api\/bot-wizard\/[\w-]+$/ },
  { methods: ["POST"], path: /^\/api\/bot-wizard\/[\w-]+\/(?:soul|finish)$/ },
  { methods: ["POST"], path: /^\/api\/routines\/away\/beat$/ },
  { methods: ["GET"], path: /^\/api\/routines\/away$/ },
  { methods: ["POST"], path: /^\/api\/routines\/[\w-]+\/away-seen$/ },
  { methods: ["POST"], path: /^\/api\/routine-runs\/[\w-]+\/(?:cancel|seen)$/ },
  { methods: ["POST"], path: /^\/api\/routine-runs\/seen-all$/ },
  { methods: ["DELETE"], path: /^\/api\/routine-runs$/ },
  // Scheduled calls (#1482): the handler shows a member the calls of the bots
  // they can see and lets them manage those of the bots they may run
  { methods: ["GET", "POST"], path: /^\/api\/calendar-calls$/ },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/calendar-calls\/[\w-]+$/ },
  { methods: ["POST"], path: /^\/api\/calendar-calls\/[\w-]+\/room$/ },
  // Webhooks are a bot feature its owner uses: a webhook runs a task on the
  // bot's own computer (This computer or its cloud computer), never on the
  // shared organization server, so creating or managing one is client scope
  // like a routine. Server-side, webhookDelegateRefusal keeps a member off an
  // admin's bot and off a Microsoft trigger, and the create handler refuses a
  // non-admin a run target on the shared server (server/exec-target.ts
  // webhookExecTargetAdminOnly). 2026-10-22 a normal user must be able
  // to use this basic bot feature without the server-settings right.
  { methods: ["GET"], path: /^\/api\/webhooks$/ },
  { methods: ["POST"], path: /^\/api\/webhooks$/ },
  { methods: ["POST"], path: /^\/api\/webhooks\/[\w-]+\/(?:rotate|test|reveal)$/ },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/webhooks\/[\w-]+$/ },
  // configured-or-not booleans; the handler strips the few identifying fields for clients
  { methods: ["GET"], path: /^\/api\/config$/ },
  // Accepting an invite is how a person who is not yet a member joins a
  // solo server's sign-in list. Issuing invites stays admin (owner/admin in
  // the handler); an organization server refuses them before the gate.
  { methods: ["POST"], path: /^\/api\/org\/invites\/[^/]+\/accept$/ },
  // The organization (Perspicax on an organization server; a solo server
  // answers 404 no_organization).
  { methods: ["GET"], path: /^\/api\/org$/ },
  // Organization server (SAGAX_IDENTITY=perspicax): the people a bot owner may
  // share with, from the Perspicax directory. Names, logins and addresses
  // only. PATCH /api/org/settings stays admin.
  { methods: ["GET"], path: /^\/api\/org\/directory$/, feature: "orgDirectory" },
  // a person's Perspicax avatar (the "You" row, room members, pickers; on a
  // personal computer, its owner's only, server/people/owner-identity.ts)
  { methods: ["GET"], path: /^\/api\/people\/[\w-]{1,80}\/avatar$/ },
  // a person's panel Library: files of the rooms the viewer shares with them (server/routes/person-library.ts)
  { methods: ["GET"], path: /^\/api\/people\/[\w-]{1,80}\/library$/ },
  // Organization server, slice 4: a bot's grants (user or team, with a
  // level). server/bots/bot-grants.ts decides who may read and change them (the
  // owner, manage holders, organization admins, team managers).
  { methods: ["GET", "PUT"], path: /^\/api\/bots\/[\w-]+\/grants$/, feature: "orgDirectory" },
  { methods: ["DELETE"], path: /^\/api\/bots\/[\w-]+\/grants\/(?:(?:user%3A|user:)pr_[0-9a-f-]{36}|(?:team%3A|team:)[0-9A-Za-z]{1,64})$/i, feature: "orgDirectory" },
  // A person's own connections (server/routes/person-connections.ts): their
  // GitHub account and their own MCP servers, the session's person only.
  { methods: ["GET"], path: /^\/api\/me\/connections$/, feature: "orgDirectory" },
  // Lot 5: canonical person capability store (connections stays as alias).
  { methods: ["GET"], path: /^\/api\/me\/capabilities$/, feature: "orgDirectory" },
  { methods: ["GET"], path: /^\/api\/installation\/capabilities$/, feature: "orgDirectory" },
  // The person's own credential vault (server/routes/credential-vault.ts):
  // the session's own vault only. Reads are POSTs (a loopback GET needs no
  // desktop capability); no answer carries a value.
  { methods: ["POST"], path: /^\/api\/me\/credentials(?:\/(?:list|import|export|wallets|onepassword\/(?:items|import)))?$/ },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/me\/credentials\/[a-z0-9]{8,40}$/ },
  { methods: ["POST"], path: /^\/api\/me\/credentials\/[a-z0-9]{8,40}\/(?:notes|grants|reveal)$/ },
  { methods: ["POST"], path: /^\/api\/me\/credentials\/purchases$/ },
  { methods: ["POST"], path: /^\/api\/me\/credentials\/purchases\/pay_[a-f0-9]{16}\/answer$/ },
  // a phone call card (server/routes/outbound-calls.ts): the person's own answer
  { methods: ["POST"], path: /^\/api\/me\/phone-calls$/ },
  { methods: ["POST"], path: /^\/api\/me\/phone-calls\/call_[a-f0-9]{16}\/answer$/ },
  { methods: ["DELETE"], path: /^\/api\/me\/credentials\/[a-z0-9]{8,40}\/grants\/[\w-]{1,128}$/ },
  // A bot's login request card: the handler checks the card is the caller's.
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/vault-cards\/[\w-]+\/(?:grant|dismiss|onepassword)$/ },
  // The person's own memory sync token for the desktop's Settings > Memory
  // (server/memory/perspicax-memory-sync-token.ts): the session's own sub only.
  { methods: ["GET", "POST"], path: /^\/api\/me\/memory-sync-token$/, feature: "orgDirectory" },
  // Memory manager (2026-11-02): sources catalog for every signed-in person;
  // Perspicax note proxy is session + own identity only (handler).
  { methods: ["GET"], path: /^\/api\/memory-manager\/sources$/ },
  { methods: ["GET", "POST", "PUT", "DELETE"], path: /^\/api\/me\/memory(?:\/(?:tree|entry|folder|bulk|tags|archived|trash(?:\/(?:undo|empty))?))?$/, feature: "orgDirectory" },
  { methods: ["POST"], path: /^\/api\/me\/github\/(?:device|token)$/, feature: "orgDirectory" },
  { methods: ["DELETE"], path: /^\/api\/me\/github$/, feature: "orgDirectory" },
  // the one list of GitHub credentials (server/routes/github-credentials.ts):
  // the person's own, no admin; the organization's need an admin (handler)
  { methods: ["GET", "POST"], path: /^\/api\/me\/github\/credentials$/, feature: "orgDirectory" },
  // the installation's MCP servers, read only: a person who does not manage
  // them gets each name, kind and state for their own bot's MCP choice
  // (the handler strips commands, URLs and every key name)
  { methods: ["GET"], path: /^\/api\/mcp\/servers$/ },
  { methods: ["POST"], path: /^\/api\/me\/mcp\/servers$/, feature: "orgDirectory" },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/me\/mcp\/servers\/[a-z][a-z0-9_-]{0,31}$/, feature: "orgDirectory" },
  { methods: ["POST"], path: /^\/api\/me\/mcp\/servers\/[a-z][a-z0-9_-]{0,31}\/oauth\/(?:start|disconnect)$/, feature: "orgDirectory" },
  // A bot's skills (Library) and Claude Code plugins (Capabilities, that
  // bot's scope): the handlers let a
  // person who may use the bot read them and its owner or a manager change them.
  { methods: ["GET", "POST"], path: /^\/api\/bots\/[\w-]+\/skills$/, feature: "orgDirectory" },
  // Person-UI skill editor: GET payload, PUT save (re-signs), POST review
  // Accept/Revert, GET supporting files. Handlers check owner/manager rights.
  { methods: ["GET", "PUT", "PATCH", "DELETE"], path: /^\/api\/bots\/[\w-]+\/skills\/[a-z0-9-]+$/, feature: "orgDirectory" },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/skills\/[a-z0-9-]+\/(?:share|unshare|review)$/, feature: "orgDirectory" },
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/skills\/[a-z0-9-]+\/files$/, feature: "orgDirectory" },
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/skill-template$/, feature: "orgDirectory" },
  // Skills > Upload (server/routes/bot-skill-upload.ts): same rights as the
  // skills routes, checked in the handler.
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/skill-upload$/, feature: "orgDirectory" },
  // A path shown once (server/routes/shown-path.ts): same rights as skills.
  { methods: ["POST"], path: /^\/api\/bots\/[\w-]+\/shown-path$/, feature: "orgDirectory" },
  // A bot's capabilities (server/routes/bot-capabilities.ts): the one
  // resolved list, read by a person who may use the bot (checked in the handler).
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/capabilities$/, feature: "orgDirectory" },
  // #3091: a bot's own setup, changed by its owner or a manager (checked in
  // the handlers): its plugin lifecycle hooks (they run on the bot's own
  // computer, server/routes/lifecycle-hooks.ts) and its library skills.
  { methods: ["GET", "PUT"], path: /^\/api\/bots\/[\w-]+\/lifecycle-hooks$/, feature: "orgDirectory" },
  { methods: ["PUT"], path: /^\/api\/bots\/[\w-]+\/skills-library$/, feature: "orgDirectory" },
  // Personal plugins use the same installer; the route binds "me" to the
  // signed-in principal, never a caller-supplied person or bot id.
  { methods: ["GET"], path: /^\/api\/(?:bots\/[\w-]+|me)\/plugins$/, feature: "orgDirectory" },
  { methods: ["POST", "DELETE"], path: /^\/api\/(?:bots\/[\w-]+|me)\/plugins\/marketplaces(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:\/update)?)?$/, feature: "orgDirectory" },
  { methods: ["PUT", "DELETE"], path: /^\/api\/bots\/[\w-]+\/plugins\/marketplaces\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/token$/, feature: "orgDirectory" },
  // the credential of the one list a marketplace picks on this bot (owner or manager)
  { methods: ["PUT"], path: /^\/api\/(?:bots\/[\w-]+|me)\/plugins\/marketplaces\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/credential$/, feature: "orgDirectory" },
  { methods: ["POST"], path: /^\/api\/(?:bots\/[\w-]+|me)\/plugins\/install$/, feature: "orgDirectory" },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/(?:bots\/[\w-]+|me)\/plugins\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:@|%40)[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, feature: "orgDirectory" },
  // a plugin's configuration values (server/plugins/plugin-config.ts)
  { methods: ["PUT"], path: /^\/api\/(?:bots\/[\w-]+|me)\/plugins\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:@|%40)[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/config$/, feature: "orgDirectory" },
  { methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], path: /^\/api\/me\/skills-library(?:\/[a-z0-9-]+)?$/, feature: "orgDirectory" },
  { methods: ["POST"], path: /^\/api\/me\/skills-library\/[a-z0-9-]+\/review$/, feature: "orgDirectory" },
  { methods: ["GET"], path: /^\/api\/me\/skills-library\/[a-z0-9-]+\/files$/, feature: "orgDirectory" },
  // Slice 5: the Perspicax MCP profiles a bot mounts. server/bots/bot-perspicax.ts
  // decides (use reads, edit changes, adding needs holding the profile).
  { methods: ["GET", "PUT"], path: /^\/api\/bots\/[\w-]+\/perspicax$/, feature: "orgDirectory" },
  // The bots whose sharing the caller administers (never their messages).
  { methods: ["GET"], path: /^\/api\/org\/bots$/, feature: "orgDirectory" },
  // Sidebar sections as channels (server/rooms/section-channels.ts checks the rights).
  { methods: ["GET", "POST"], path: /^\/api\/org\/sections$/, feature: "orgDirectory" },
  { methods: ["PATCH", "DELETE"], path: /^\/api\/org\/sections\/(?:sec_[0-9a-f-]{36}|general)$/, feature: "orgDirectory" },
  { methods: ["PUT"], path: /^\/api\/org\/sections\/(?:sec_[0-9a-f-]{36}|general)\/(?:members|bots)$/, feature: "orgDirectory" },
  // #2045: a member creates, renames, fills and deletes their own teams. The
  // route answers only with the caller's teams and files only their own bots.
  { methods: ["GET", "POST", "PATCH", "PUT", "DELETE"], path: /^\/api\/sidebar-sections$/, feature: "orgDirectory" },
  // I2: a team's model and computer. The handler answers only on the
  // caller's own teams; each bot then follows through its own PATCH.
  { methods: ["GET", "PUT"], path: /^\/api\/team-defaults$/ },
  // A person's own engines: what their own turns run on, and their own
  // subscription sign-in (server/engines/principal-engine-logins.ts).
  { methods: ["GET"], path: /^\/api\/me\/engines$/, feature: "orgDirectory" },
  // On an organization server this legacy form writes the person's own
  // Perspicax key, without changing the shared engine configuration.
  { methods: ["GET", "POST"], path: /^\/api\/instances\/[\w.-]+\/api-key$/, feature: "orgDirectory" },
  // A person's own usage ledger and their own per-job traces
  // (server/routes/usage.ts, 2026-10-15 / 2026-10-23): the handler keeps the
  // caller's own turns only, never another person's; the whole ledger and the
  // whole-ledger traces (/api/usage, /api/usage/traces) stay admin or usage.view.
  { methods: ["GET"], path: /^\/api\/me\/usage(?:\/traces|\/stats)?$/ },
  // The person's own monthly spend limit: anyone signed in reads it; changing
  // it stays admin scope (server/routes/usage.ts).
  { methods: ["GET"], path: /^\/api\/me\/spend-cap$/ },
  // #3091: the person's own usage measure switch (server/routes/usage-meter.ts:
  // the session's person only, nothing leaves this server).
  { methods: ["GET", "PUT"], path: /^\/api\/me\/usage-meter$/ },
  { methods: ["POST"], path: /^\/api\/me\/usage-meter\/events$/ },
  // A person's own plan windows (5-hour, weekly) read from their own
  // subscription logins only (server/usage/plan-usage.ts orgPlanAccounts). On a
  // solo server this path stays admin.
  { methods: ["GET"], path: /^\/api\/plan-usage(?:\/history)?$/, feature: "orgDirectory" },
  // The server's engines and their models (Model providers, the model
  // picker): a member's copy drops the server's own account, CLI paths and
  // install details (memberInstanceView in server/index.ts). Changes stay admin.
  { methods: ["GET"], path: /^\/api\/instances$/, feature: "orgDirectory" },
  // The caller's own server environment (user-sandbox): status and reset.
  { methods: ["GET"], path: /^\/api\/me\/server-environment$/, feature: "orgDirectory" },
  { methods: ["POST"], path: /^\/api\/me\/server-environment\/reset$/, feature: "orgDirectory" },
  { methods: ["POST"], path: /^\/api\/me\/server-environment\/update$/, feature: "orgDirectory" },
  { methods: ["POST"], path: /^\/api\/me\/server-environment\/power$/, feature: "orgDirectory" },
  { methods: ["GET"], path: /^\/api\/me\/server-environment\/stats$/, feature: "orgDirectory" },
  // The live view of the caller's own server environment desktop: the route
  // builds the target from the session's principal (routes/desktop-viewer.ts).
  { methods: ["GET"], path: /^\/api\/desktop-viewer\/sandbox\/me(?:\/websockify)?$/, feature: "orgDirectory" },
  // 2026-10-26: the desktop of a bot's own VPS, for its owner who may run
  // its computer; the target's `allows` decides (routes/desktop-viewer.ts).
  { methods: ["GET"], path: /^\/api\/desktop-viewer\/vps\/[\w-]+(?:\/websockify)?$/ },
  { methods: ["POST"], path: /^\/api\/me\/engines\/[\w.-]+\/login\/(?:start|complete|cancel|sign-out)$/, feature: "orgDirectory" },
  { methods: ["GET"], path: /^\/api\/me\/engines\/[\w.-]+\/login\/status$/, feature: "orgDirectory" },
  // The caller's own claude.ai connectors (server/harness-connectors.ts):
  // names and statuses of their own account only. The admin switch
  // (PUT /api/harness-connectors/settings) stays admin.
  { methods: ["GET"], path: /^\/api\/me\/harness-connectors$/ },
  // The engine's own slash commands for a bot the caller may use
  // (server/harness-commands.ts): names, descriptions and hints only.
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/harness-commands$/ },
  // Slice 6: the caller's own routine delegation (allow, status, revoke).
  { methods: ["GET"], path: /^\/api\/org\/routine-delegation$/, feature: "orgDirectory" },
  // Browse Bots (server/routes/bot-catalog.ts): the viewer's own, shared and
  // published bots, read only; publishing (owner or organization admin,
  // featuring admin only) and importing a copy are checked in the handler.
  { methods: ["GET"], path: /^\/api\/bot-catalog(?:\/[\w-]+)?$/ },
  { methods: ["PUT"], path: /^\/api\/bot-catalog\/[\w-]+\/listing$/ },
  { methods: ["POST"], path: /^\/api\/bot-catalog\/[\w-]+\/import$/ },
  // The public card of a bot shared on x.ai (server/routes/team-library-grok.ts):
  // it only reads x.ai and creates nothing, so anyone signed in may use it
  // to import their own agent (src/components/AgentImport.tsx).
  { methods: ["POST"], path: /^\/api\/team-library\/grok$/ },
  // The xAI Bot Marketplace (server/routes/xai-marketplace.ts): its public
  // list and one bot's page, read from x.ai and kept a few hours; creates nothing.
  { methods: ["GET"], path: /^\/api\/team-library\/xai(?:\/bots\/[a-z0-9][a-z0-9-]{0,79})?$/ },
  // A bot as one zip (server/routes/bot-zip.ts): export needs owner or
  // manage, import the right to create bots; both checked in the handler.
  { methods: ["GET"], path: /^\/api\/bots\/[\w-]+\/export\.zip$/ },
  { methods: ["POST"], path: /^\/api\/bots\/import\/(?:upload|[0-9a-f-]{36}(?:\/preview)?)$/ },
  // An x.ai bot's export reply made into a package on the server and staged
  // (the phone's agent import); GET is the export prompt. Same rights as upload.
  { methods: ["GET", "POST"], path: /^\/api\/bots\/import\/agent$/ },
  { methods: ["DELETE"], path: /^\/api\/bots\/import\/[0-9a-f-]{36}$/ },
  // 2026-10-26: a team file imported for oneself. The handler requires the
  // right to create bots, makes every bot the caller's with a member's
  // defaults, and keeps a server folder, visibility and a backup restore
  // an admin's. The organization library's Add stays admin.
  { methods: ["POST"], path: /^\/api\/teams\/import$/ },
  // #2045: a person exports their own team (handler packs only their bots
  // and section id). Organization library publish stays admin inside the
  // handler when the body asks for it.
  { methods: ["POST"], path: /^\/api\/teams\/export$/ },
  // Slice 8: a person copies their own bots from a solo Sagax (the handler
  // checks the session, the caller's right to create bots and the copy).
  { methods: ["POST"], path: /^\/api\/org\/import$/, feature: "orgDirectory" },
  // A member's machine checks in as a worker. The handler binds it to the session user.
  // Pull and cancel stay on that session: registering does not run the queued turns.
  { methods: ["GET", "POST"], path: /^\/api\/workers$/ },
  { methods: ["POST"], path: /^\/api\/workers\/[\w-]+\/pull$/ },
  { methods: ["POST"], path: /^\/api\/workers\/[\w-]+\/drop$/ },
  { methods: ["POST"], path: /^\/api\/workers\/queue\/[\w-]+\/cancel$/ },
  { methods: ["GET", "POST"], path: /^\/api\/workers\/[\w-]+\/turns\/[\w.-]+$/ },
];
