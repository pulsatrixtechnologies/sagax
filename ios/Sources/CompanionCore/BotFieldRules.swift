// Which bot fields a signed-in person may save, and which permissions their
// profile holds: the phone's copy of `shared/viewer-capabilities.ts`
// (CLIENT_BOT_PATCH_FIELDS, MEMBER_BOT_FIELDS) and `shared/permissions.ts`
// (BOT_FIELD_PERMISSIONS, the member defaults, the keys every member always
// holds). The desktop reads them through `src/lib/bot-capabilities.ts` and
// `src/lib/viewer.ts`; the server enforces the same split in the bot PATCH
// handler (memberBotFieldRefusal). `BotFieldRulesParityTests` reads the
// TypeScript files and fails when this copy drifts.
//
// 2026-10-26 ("Autonomy first"): an organization member's bots run in their
// own environment, so what the server lets the owner change, the phone
// shows to the owner. Never to a person who does not own the bot.
import Foundation

public enum BotFieldRules {
    /// How a bot looks in the list: any session may change these on a bot
    /// it can see (`CLIENT_BOT_PATCH_FIELDS`).
    public static let clientFields: Set<String> = [
        "unread", "pinned", "pinnedMessageId", "color", "mascotExpression", "mascotBody", "mascotSkin", "mascotLook",
        "avatarCrop", "avatarZoom", "avatarFocusX", "avatarFocusY",
    ]

    /// What an organization member sets on a bot they own with no further
    /// permission (`MEMBER_BOT_FIELDS`).
    public static let memberFields: Set<String> = clientFields.union([
        "name", "title", "description", "soul", "notifications", "avatarUrl", "modelSelection", "requireAvailableModel",
    ])

    /// The other fields the owner sets with a permission of their profile
    /// (`BOT_FIELD_PERMISSIONS`). A field missing here stays an admin's.
    public static let fieldPermissions: [String: String] = [
        "approvalMode": "bots.approvalLevel",
        "autoApprove": "bots.approvalLevel",
        "acknowledgeLocalAuto": "bots.approvalLevel",
        "proactiveMode": "bots.approvalLevel",
        // Standing grants: the owner's own (mirror of shared/permissions.ts, #1138).
        "alwaysAllow": "bots.approvalLevel",
        "memoryEnabled": "bots.behaviour",
        "teamMemorySharing": "bots.behaviour",
        "memoryUpkeep": "bots.behaviour",
        "voiceNotes": "bots.behaviour",
        "emailDrafts": "bots.behaviour",
        "fallback": "bots.behaviour",
        "parkDirectMessages": "bots.behaviour",
        "maxConcurrentThreads": "bots.behaviour",
        "maxParallelPerPerson": "bots.behaviour",
        "loopGuard": "bots.behaviour",
        "busySend": "bots.behaviour",
        "automaticRecovery": "bots.behaviour",
        "computer": "bots.create",
        "browser": "bots.create",
        "cloudBackend": "bots.computer",
        "autoStartVps": "bots.computer",
        "browserProfile": "bots.computer",
        "toolScope": "bots.tools",
        "mcpServers": "bots.tools",
        "mcpAccounts": "bots.tools",
        "outbound": "bots.tools",
        "peers": "bots.tools",
        "approvePeerComms": "bots.tools",
        "allowedRecipients": "bots.tools",
        "acknowledgePeerScope": "bots.tools",
        "hidden": "bots.create",
        "threadId": "bots.create",
        "chiefOfStaff": "bots.create",
        "managedSections": "bots.create",
        "visibility": "sharing.visibility",
        "section": "sharing.visibility",
        "cwd": "folders.botWorkingFolder",
    ]

    /// What a plain member holds when the server sends no list
    /// (`MEMBER_DEFAULT_PERMISSIONS`).
    public static let memberDefaultPermissions: Set<String> = [
        "bots.create", "bots.approvalLevel", "bots.fullAccess", "bots.behaviour", "bots.tools",
        "sharing.grants", "sharing.visibility", "apps.ownIntegrations",
        "clients.botsRead", "clients.botsMessage", "clients.routinesRun", "clients.routinesRead", "clients.routinesWrite", "clients.agentsCreate",
        // a member default since #1098 (shared/permissions.ts)
        "security.triage",
        // a person's own working folders (shared/permissions.ts, folders group)
        "folders.botWorkingFolder", "folders.roomWorkingFolder",
    ]

    /// The keys about a person's own things that every member holds,
    /// whatever Perspicax sends (`MEMBER_ALWAYS_PERMISSIONS`; the server adds
    /// them to the list in server/org-permissions.ts).
    public static let memberAlwaysPermissions: Set<String> = [
        "bots.create", "bots.approvalLevel", "bots.fullAccess", "bots.behaviour", "bots.tools",
        "sharing.grants", "sharing.visibility", "apps.ownIntegrations",
        "clients.botsRead", "clients.botsMessage", "clients.routinesRun", "clients.routinesRead", "clients.routinesWrite", "clients.agentsCreate",
        "folders.botWorkingFolder", "folders.roomWorkingFolder",
    ]
}

public extension SurfaceGate {
    /// An organization member on a server session: the only pairing whose
    /// rights depend on the bot's owner and the person's permissions.
    var isOrgMemberSession: Bool {
        scope == .serverClient && organization && viewer?.isOperator != true
            && (viewer?.role ?? "member") == "member"
    }

    /// `viewerBotsReadOnly`: a Perspicax admin lets this person use the bots
    /// shared with them only.
    var botsReadOnly: Bool { organization && viewer?.botsReadOnly == true }

    /// `viewerOwnsBot`: an admin session and the owner's own sidecar own
    /// every bot; an organization member owns a bot whose owner is their
    /// principal. A bot without a recorded owner is the operator's, never a
    /// member's.
    func ownsBot(ownerUserId: String?) -> Bool {
        switch scope {
        case .serverAdmin, .sidecar: return true
        case .serverClient:
            let principal = viewer?.principalId?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
            let owner = ownerUserId?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
            return !principal.isEmpty && principal == owner
        }
    }

    func ownsBot(_ bot: Bot) -> Bool { ownsBot(ownerUserId: bot.ownerUserId) }

    /// `viewerCan`: whether the viewer's profile includes a permission. An
    /// admin session and the sidecar hold every key; an organization member
    /// the list the server sent (else the member defaults) plus the keys
    /// every member holds. A client session on a personal server holds none:
    /// its rights are the session scope's.
    func can(_ permission: String) -> Bool {
        switch scope {
        case .serverAdmin, .sidecar: return true
        case .serverClient:
            guard organization else { return false }
            if viewer?.isOperator == true || viewer?.role == "admin" || viewer?.role == "owner" { return true }
            let held = viewer?.permissions.map(Set.init) ?? BotFieldRules.memberDefaultPermissions
            return held.contains(permission) || BotFieldRules.memberAlwaysPermissions.contains(permission)
        }
    }

    /// `canEditBotField`: a read-only person changes nothing; an admin
    /// session every field; an organization member the member fields and
    /// the fields their permissions open on a bot they own, and only how
    /// any other bot looks. A client session on a personal server keeps how
    /// a bot looks.
    func canEditBotField(ownerUserId: String?, _ field: String, draft: Bool = false) -> Bool {
        if botsReadOnly { return false }
        switch scope {
        case .serverAdmin, .sidecar: return true
        case .serverClient:
            guard organization else { return BotFieldRules.clientFields.contains(field) }
            if draft || ownsBot(ownerUserId: ownerUserId) {
                if BotFieldRules.memberFields.contains(field) { return true }
                guard let permission = BotFieldRules.fieldPermissions[field] else { return false }
                return can(permission)
            }
            return BotFieldRules.clientFields.contains(field)
        }
    }

    /// An organization member who archives and restores their own bots
    /// (`hidden`, bots.create): the Archived bots list is theirs too.
    var archivesOwnBots: Bool {
        isOrgMemberSession && !botsReadOnly && can("bots.create")
    }

    /// The bots this pairing may restore from Archived bots: every one for
    /// an admin, a member's own on an organization server.
    func restorableArchivedBots(_ bots: [Bot]) -> [Bot] {
        bots.filter { $0.hidden == true && allows(.archiveBot, bot: $0) }
    }

    func canEditBotField(_ bot: Bot, _ field: String) -> Bool {
        canEditBotField(ownerUserId: bot.ownerUserId, field)
    }

    /// A feature for one bot: what the pairing allows anyway, or what the
    /// server lets this bot's owner do (an organization member on their own
    /// bot, with the permission the server checks). Never on a bot the
    /// person does not own.
    func allows(_ feature: SurfaceFeature, bot: Bot?) -> Bool {
        if allows(feature) { return true }
        guard let bot else { return false }
        return ownerMay(feature, ownerUserId: bot.ownerUserId)
    }

    func allows(_ feature: SurfaceFeature, ownerUserId: String?) -> Bool {
        allows(feature) || ownerMay(feature, ownerUserId: ownerUserId)
    }

    /// The owner's part of `allows(_:bot:)`. Each case names the server
    /// route or field it relies on; a feature the server keeps from a
    /// client session stays out of this list.
    private func ownerMay(_ feature: SurfaceFeature, ownerUserId: String?) -> Bool {
        guard isOrgMemberSession, !botsReadOnly, ownsBot(ownerUserId: ownerUserId) else { return false }
        switch feature {
        // Soul, skills, memory, history, rules: the owner's routes
        // (CLIENT_ALLOW, "same gate as the Soul edit"); access, model and
        // permissions: the member fields and BOT_FIELD_PERMISSIONS.
        case .advancedBotPanel:
            return can("bots.create")
        // Browser, Works on (bots.create), MCP servers and tools (bots.tools),
        // the approval level (bots.approvalLevel). Each control asks for its
        // own field (`canEditBotField`).
        case .botAccessEdit:
            return can("bots.create") || can("bots.tools") || can("bots.approvalLevel")
        // GET /api/bots/:id/overview: the handler answers the bot's owner.
        case .botOverview:
            return true
        // Delete (`memberOwnsBot`, which needs bot creation), pin and
        // framing (look fields).
        case .botOwnerExtras:
            return can("bots.create")
        // `hidden`: BOT_FIELD_PERMISSIONS, bots.create.
        case .archiveBot:
            return can("bots.create")
        // `voiceNotes`: bots.behaviour.
        case .voiceNotesSetting:
            return can("bots.behaviour")
        // Read from the conversation the app already holds; nothing fetched.
        case .inspector:
            return true
        // 2026-10-26 (#1098): the folders of their bot's threads
        // (/api/bots/:id/projects), its prompt preview
        // (/api/bots/:id/system-prompt): the handlers answer the bot's owner.
        case .threadFolders, .promptPreview:
            return true
        // `fallback`: BOT_FIELD_PERMISSIONS, bots.behaviour.
        case .botFallback:
            return can("bots.behaviour")
        // #1098: `outbound`: BOT_FIELD_PERMISSIONS, bots.tools; its count
        // (GET /api/bots/:id/outbound) answers the owner.
        case .botOutbound:
            return can("bots.tools")
        // #1098: POST /api/bots/:id/avatar/generate, `ownerOrAdminOf`
        // (`memberOwnsBot`, which needs bot creation).
        case .botAvatarGenerate:
            return can("bots.create")
        default:
            return false
        }
    }
}
