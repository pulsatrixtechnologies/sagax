// What this pairing lets the app show: one place for every feature gate.
//
// The reference for a paired phone is the desktop remote client (spec
// 2026-10-02-ipad-desktop-parity-design.md, "Rule for the iPad"): paired
// through a desktop's sidecar, the app shows what the remote-client renderer
// shows; paired with a server, what the served renderer shows for the
// session's scope (client: `CLIENT_ALLOW` in server/request-auth.ts; admin:
// everything). JC's decisions of 2026-10-03 (matrix, "JC's answers") add to
// that: D1 the advanced bot panel on a sidecar for the owner, D2 message pin
// everywhere, D3 room memory on the sidecar, D4 the phone's own extras (pin
// bot, delete bot, framing) for the owner or an admin.
//
// A feature the gate refuses is hidden, never drawn disabled: a button the
// computer can only answer 403 to is worse than no button.
import Foundation

/// How the phone is paired, from the connection and the server session.
public enum PairingScope: String, Hashable, Sendable {
    /// Through the desktop's companion sidecar (`companion/src/routes.ts`
    /// `ALLOWED`): the remote-client surface, as the desktop's owner.
    case sidecar
    /// A server session without the admin scope (`CLIENT_ALLOW`).
    case serverClient
    /// A server session with the admin scope.
    case serverAdmin
}

/// Sidecar routes that JC approved but that a given desktop may not serve
/// yet (package S1 adds them to `ALLOWED`). Until the app knows the paired
/// sidecar has one, the feature behind it stays hidden on sidecar pairings.
public struct SidecarRoutes: OptionSet, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    /// POST /api/bots/:id/parallel/:t/stop (TH8).
    public static let parallelStop = SidecarRoutes(rawValue: 1 << 0)
    /// GET/PUT /api/groups/:id/memory (RM8, D3).
    public static let roomMemory = SidecarRoutes(rawValue: 1 << 1)
    /// The advanced bot panel's reads and owner edits (D1).
    public static let advancedPanel = SidecarRoutes(rawValue: 1 << 2)
    /// A sidecar-safe voice engine switch, replacing PUT /api/config (BA12).
    public static let voiceEngine = SidecarRoutes(rawValue: 1 << 3)
    /// GET /api/bots/:id/harness-commands, the engine's "/" list (CO9).
    public static let harnessCommands = SidecarRoutes(rawValue: 1 << 4)
    /// GET /api/bots/:id/activity[/item], what a bot is doing (BP10).
    public static let botActivity = SidecarRoutes(rawValue: 1 << 5)
    /// POST /api/bots/:id/primary, the owner's Primary Bot (SB28).
    public static let primaryBot = SidecarRoutes(rawValue: 1 << 6)
    /// PATCH /api/bots/:id {voiceNotes} from the owner's phone (BA11).
    public static let voiceNotes = SidecarRoutes(rawValue: 1 << 7)
    /// GET /api/me/harness-connectors, the owner's claude.ai connectors (PL7).
    public static let harnessConnectors = SidecarRoutes(rawValue: 1 << 8)
    /// GET /api/me/achievements, POST events, PUT settings: the owner's own
    /// achievements (ST9, D1).
    public static let achievements = SidecarRoutes(rawValue: 1 << 9)

    /// What a sidecar of this release serves: all of the above (S1, D1, D3,
    /// and the voice engine route ship with this version of the desktop). An
    /// older desktop answers 403 and the view shows that error.
    public static let current: SidecarRoutes = [
        .parallelStop, .roomMemory, .advancedPanel, .voiceEngine, .harnessCommands, .botActivity, .primaryBot, .voiceNotes,
        .harnessConnectors, .achievements,
    ]
}

/// One gated surface. Named for what the person sees, with the matrix row
/// (docs/superpowers/specs/2026-10-03-ios-feature-parity-matrix.md) beside it.
public enum SurfaceFeature: String, CaseIterable, Hashable, Sendable {
    // Chat and messages
    /// Reply with a quote (CO2, MS8).
    case replyQuote
    /// Regenerate the last reply (MS5).
    case regenerate
    /// Speak a reply (MS4).
    case speakReply
    /// Emoji reactions (MS10).
    case reactions
    /// Pin a message, the pinned banner (MS9, RM17 pin; D2).
    case messagePin
    /// Inspector: run log, events, raw (MS24). Admin only.
    case inspector
    /// Find in this conversation, `GET /api/search?threadId=` (MS11).
    case findInConversation
    /// Quote selected text as a citation in the next message (CO8).
    case citationQuote

    // Composer (WP3)
    /// The engine's own slash commands in the "/" menu (CO9). Sidecars wait
    /// on S1; Sagax's own commands (`/learn`, `/setup`, `/goal`) always show.
    case engineCommands
    /// A busy send the bot routes (`routeWhileBusy`, CO15; the chooser is gone since 2026-10-18).
    case busySendChoice
    /// Steer a held send into the running turn (CO14, RM5).
    case queueSteer
    /// Compact the conversation (CO24).
    case compactConversation
    /// Stop a room's running turn (RM4).
    case roomInterrupt
    /// Paste an image or a long text as a chip (CO5).
    case pasteAttachment
    /// "@" and "#" suggestions above the field (CO11, CO12, RM9).
    case composerSuggestions

    // Cards
    /// Parallel task card: Stop (TH8). Sidecars wait on S1.
    case parallelTaskStop

    // Bot panel
    /// "What this bot does" (`GET /api/bots/:id/overview`, BA1): admin only
    /// for a client session.
    case botOverview
    /// The workspace voice engine (BA12). `PUT /api/config` is refused by
    /// every sidecar and is admin only on a server.
    case voiceEngineSettings
    /// Skills, memory, history, prompt preview, presets (D1, WP16).
    case advancedBotPanel
    /// The advanced panel's Access section with its switches (browser,
    /// connected apps, MCP servers, always allowed): an admin session only.
    /// Every other pairing reads it (BA6): the sidecar and a client session
    /// refuse those fields.
    case botAccessEdit
    /// Who can see it (BA14): `PATCH {visibility}` is an admin's, and only
    /// on a served workspace that is not an organization server (the
    /// grants replace it there).
    case botVisibility
    /// Shared with (BA15) and Perspicax profiles (BA16): organization
    /// servers only; the server decides who may change them.
    case botSharing
    case botPerspicax
    /// The bot's Slack app in the organisation's Admin (BA17): a server
    /// answers the link; the sidecar has no route.
    case botSlack
    /// Skills an organization package offers (BA4, OrgSkillsCard): admin.
    case orgSkillsLibrary
    /// A bot's Claude Code plugins (Connect apps "For <bot>" on the web,
    /// `PluginsPanel.tsx`, `plugins/BotPluginCard.tsx`):
    /// `/api/bots/:id/plugins` is a server route (admin, or a client on an
    /// organization server: `orgDirectory` in request-auth.ts); the sidecar
    /// does not list it.
    case botPlugins
    /// Settings > My connections (`MyConnectionsSettings.tsx`): a person's
    /// own GitHub and MCP servers, on an organization server only
    /// (`/api/me/connections`; the sidecar does not list it).
    case myConnections
    /// More > Model's Backup models (`ModelSection.tsx` FallbackChain):
    /// PATCH /api/bots/:id {fallback} is an admin field (neither the
    /// sidecar's companion fields nor a client session's).
    case botFallback
    /// More > Permissions' Sending on your behalf (`OutboundControl`): the
    /// same admin field rule as the backup models.
    case botOutbound
    /// Saved command rules (BA9): read and remove pass both gates (the
    /// handler holds a client session to the bot's owner).
    case commandAllowlist
    /// Adding a command rule stays admin.
    case commandAllowlistAdd
    /// Duplicate a bot (BA19): `POST /api/bots` and a member-field PATCH;
    /// a client session only on an organization server (its own bots).
    case duplicateBot
    /// The phone's extras beyond the remote client: pin bot, delete bot,
    /// picture framing (D4).
    case botOwnerExtras
    /// New bot (SB31): `POST /api/bots` passes both gates.
    case createBot
    /// New bot's team, and "New bot here" on a team (NB3): a member's new
    /// bot may not name a section (server `memberBotFieldViolation`); the
    /// owner's sidecar and an admin may.
    case createBotTeam
    /// New bot's presets as starting roles (NB2): `GET /api/bot-presets` is
    /// admin scoped on a server and opened on the sidecar by D1. The
    /// built-in roles need no route and show everywhere.
    case createBotPresets
    /// MCP servers, read-only, with their sign-in and its status (PL8, PL9):
    /// the sidecar serves the listing and the OAuth start and status; a
    /// client session does not (admin).
    case mcpServers
    /// The owner's own claude.ai connectors, read-only (PL7). Sidecars wait
    /// on S1; a client session reads its own.
    case harnessConnectors
    /// The server-wide switch for Claude connectors
    /// (`PUT /api/harness-connectors/settings`): admin only.
    case harnessConnectorsSetting
    /// What the bot is doing: Activity card, history, detail, stop and
    /// steer (BP10). Sidecars wait on S1.
    case botActivity
    /// Make or replace the Primary Bot (SB28): the handler checks the owner.
    case primaryBot
    /// The open chat's files with search, kinds, sort, copy path and show
    /// in chat (BF1, BF3, BF4): both gates pass `GET /api/threads/:id/files`.
    case threadFiles
    /// Delete a routine from the bot profile (BP12).
    case routineDelete
    /// Per-bot usage (BP14): read from the bot's own threads.
    case botUsage
    /// Voice notes allowed (BA11): a member may not set it; the owner's
    /// sidecar may (S1).
    case voiceNotesSetting
    /// Skin rarities, locks, style 2D / 3D and moves of the character
    /// editor (BP6-BP8): the look fields pass every gate.
    case characterExtras

    // Threads
    /// Thread folders: new, rename, icon, delete, reorder (SB19, SB20).
    /// The sidecar serves the projects routes; a server keeps them for the
    /// admin scope. Filing a thread in an existing folder (TH5) is a thread
    /// edit every pairing may make.
    case threadFolders

    // Sidebar (WP6)
    /// Rename, add or remove bots, delete a server section (SB4): PATCH,
    /// PUT and DELETE /api/sidebar-sections are admin only on a server and
    /// refused by every sidecar. An organization server's sections are the
    /// person's own instead (SB2), which every session may edit.
    case sectionManagement

    // Rooms
    /// Room memory tab (RM8, D3). Sidecars wait on S1.
    case roomMemory
    /// Rename, move, edit instructions, members, who answers (RM14-RM19):
    /// hidden by the remote client, a server admin's or an organization's.
    case roomManagement
    /// Delete a room (RM16).
    case roomDelete

    // Automations and organization
    /// Cancel a queued, running or waiting run (AU8): both gates pass
    /// `POST /api/routine-runs/:id/cancel`.
    case routineRunCancel
    /// Mark a run seen, mark all read, the unseen-failure badge (AU9).
    case routineRunsSeen
    /// The editor's advanced fields: window, end, overlap, results thread,
    /// cron, team goal (AU12-AU14); `PATCH /api/routines/:id` passes both.
    case routineAdvancedEditor
    /// Routine attachments (AU14): uploaded through `POST /api/files`.
    case routineAttachments
    /// Scheduled calls (AU16). Admin only.
    case scheduledCalls
    /// Routines act in my name (AU19). Organization servers only.
    case orgRoutineDelegation
    /// Webhooks (AU17): host only, never on the phone.
    case webhooks

    // Settings (WP12)
    /// Settings > Achievements (ST9): the person's own record. Both gates
    /// pass the routes; the remote client hides the page, D1 opens it.
    case achievements
    /// Settings > Organization (ST8): an organization server only.
    case organizationSettings
    /// Usage > History, `GET /api/usage?groupBy=` (ST10): admin scope on a
    /// server; the owner's sidecar passes `GET /api/usage`.
    case usageHistory

    /// Templates, the team library (the desktop sidebar's place): the
    /// remote client hides it, a client session may not reach it; an admin
    /// session browses the catalog (`GET /api/team-library/catalog`).
    case templates
    /// Browse Bots, the organisation bot catalogue (the desktop sidebar's
    /// place that replaced Templates): `/api/bot-catalog` is in CLIENT_ALLOW
    /// and the remote client hides it (no sidecar route).
    case browseBots

    // Team map and people (WP15)
    /// The Team map, read-only (TM1): `GET /api/team-map` passes both gates
    /// and the remote client shows the page. Arranging a bot inside its own
    /// team (TM2) is kept on the phone and goes with it.
    case teamMap
    /// Move a bot to another team from the Team map (`POST
    /// /api/sidebar-sections`): the remote client never offers it
    /// (`canManage` is false) and a client session may not file bots.
    case teamMapMove
    /// The person sheet, people's names on room lines, and direct
    /// conversations between people (RM21, RM22): organization servers only.
    case people

    // Home, menus and settings (iPhone navigation parity)
    /// Rename Bot from its row (`PATCH /api/bots/:id/profile`): the owner's
    /// sidecar and an admin session; a client session only for its own bot
    /// on an organization server (member fields), which the menu checks.
    case renameBot
    /// Archive a bot and the Archived bots list (`PATCH /api/bots/:id`
    /// `{hidden}`): an admin session only; the sidecar and a client
    /// session refuse the field, and the remote client hides both.
    case archiveBot
    /// Settings > Experimental (`PUT /api/config` features): admin scope.
    case experimentalSettings
}

public struct SurfaceGate: Hashable, Sendable {
    public var scope: PairingScope
    /// An organization server (people signed in with Pulsatrix).
    public var organization: Bool
    /// Approved sidecar routes the paired desktop is known to serve.
    public var sidecarRoutes: SidecarRoutes

    public init(scope: PairingScope, organization: Bool = false, sidecarRoutes: SidecarRoutes = .current) {
        self.scope = scope
        self.organization = organization
        self.sidecarRoutes = sidecarRoutes
    }

    /// The gate for a live pairing. `account` (`GET /api/auth/session`)
    /// marks an organization server by naming a principal.
    public init(connection: Connection, account: AuthSession? = nil, sidecarRoutes: SidecarRoutes = .current) {
        let scope: PairingScope
        if !connection.pairedWithServer {
            scope = .sidecar
        } else if connection.serverScopes?.contains("admin") == true {
            scope = .serverAdmin
        } else {
            scope = .serverClient
        }
        self.init(
            scope: scope,
            organization: connection.pairedWithServer && account?.principalId?.isEmpty == false,
            sidecarRoutes: sidecarRoutes
        )
    }

    /// Nothing paired: show nothing that needs a computer's consent.
    public static let unpaired = SurfaceGate(scope: .serverClient)

    public func allows(_ feature: SurfaceFeature) -> Bool {
        switch feature {
        case .replyQuote, .regenerate, .speakReply, .reactions, .messagePin, .createBot:
            return true
        // Search and citations pass both gates; the remote client shows them.
        case .findInConversation, .citationQuote:
            return true
        case .threadFiles, .routineDelete, .botUsage, .characterExtras:
            return true
        case .routineRunCancel, .routineRunsSeen, .routineAdvancedEditor, .routineAttachments:
            return true
        case .botActivity:
            return scope != .sidecar || sidecarRoutes.contains(.botActivity)
        case .primaryBot:
            return scope != .sidecar || sidecarRoutes.contains(.primaryBot)
        case .voiceNotesSetting:
            switch scope {
            case .serverAdmin: return true
            case .serverClient: return false
            case .sidecar: return sidecarRoutes.contains(.voiceNotes)
            }
        // Every composer route passes both gates (companion `ALLOWED`, server
        // `CLIENT_ALLOW`); the remote client shows each of them.
        case .busySendChoice, .queueSteer, .compactConversation, .roomInterrupt, .pasteAttachment, .composerSuggestions:
            return true
        case .engineCommands:
            return scope != .sidecar || sidecarRoutes.contains(.harnessCommands)
        case .inspector, .scheduledCalls, .sectionManagement:
            return scope == .serverAdmin
        case .botOverview, .botOwnerExtras, .threadFolders, .mcpServers:
            return scope != .serverClient
        case .harnessConnectorsSetting:
            return scope == .serverAdmin
        case .harnessConnectors:
            return scope != .sidecar || sidecarRoutes.contains(.harnessConnectors)
        case .parallelTaskStop:
            return scope != .sidecar || sidecarRoutes.contains(.parallelStop)
        case .voiceEngineSettings:
            switch scope {
            case .serverAdmin: return true
            case .serverClient: return false
            case .sidecar: return sidecarRoutes.contains(.voiceEngine)
            }
        case .createBotTeam:
            return scope != .serverClient
        case .createBotPresets:
            switch scope {
            case .serverAdmin: return true
            case .serverClient: return false
            case .sidecar: return sidecarRoutes.contains(.advancedPanel)
            }
        case .advancedBotPanel:
            switch scope {
            case .serverAdmin: return true
            case .serverClient: return false
            case .sidecar: return sidecarRoutes.contains(.advancedPanel)
            }
        case .roomMemory:
            return scope != .sidecar || sidecarRoutes.contains(.roomMemory)
        case .botAccessEdit, .orgSkillsLibrary, .commandAllowlistAdd:
            return scope == .serverAdmin
        case .botVisibility:
            return scope == .serverAdmin && !organization
        case .botSharing, .botPerspicax:
            return organization
        case .botPlugins:
            return scope == .serverAdmin || (scope == .serverClient && organization)
        case .myConnections:
            return scope != .sidecar && organization
        case .botFallback, .botOutbound:
            return scope == .serverAdmin
        case .botSlack:
            return scope != .sidecar
        case .commandAllowlist:
            return true
        case .duplicateBot:
            return scope != .serverClient || organization
        case .roomManagement, .roomDelete:
            return scope == .serverAdmin || (scope == .serverClient && organization)
        case .orgRoutineDelegation:
            return organization
        case .webhooks:
            return false
        case .achievements:
            return scope != .sidecar || sidecarRoutes.contains(.achievements)
        case .organizationSettings:
            return organization
        case .usageHistory:
            return scope != .serverClient
        case .teamMap:
            return true
        case .templates:
            return scope == .serverAdmin
        case .browseBots:
            return scope != .sidecar
        case .teamMapMove:
            return scope == .serverAdmin
        case .people:
            return organization
        case .renameBot:
            return scope != .serverClient || organization
        case .archiveBot, .experimentalSettings:
            return scope == .serverAdmin
        }
    }
}

extension Connection {
    /// This pairing's gate, without the organization flag (which needs the
    /// signed-in session).
    public var surfaceGate: SurfaceGate { SurfaceGate(connection: self) }
}
