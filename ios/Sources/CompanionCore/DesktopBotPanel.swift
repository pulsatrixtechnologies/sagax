import Foundation

// The bot panel (iPad docked, iPhone full screen): which tabs a pairing
// shows and which sections its persona editor lists, in the desktop's order,
// and that list's search. The desktop's own rules are
// `bot-settings/panel-tabs.ts` (Details, Library, Computer; no More tab
// since the persona editor) and `lib/persona-sections.ts` with
// `bot-settings/sections.ts` (the order, the labels' keywords): every other
// section opens from the panel's "Edit persona" button. What a pairing may
// reach comes from `SurfaceGate`: a section the computer can only refuse is
// not listed.

/// A tab of the bot panel.
public enum DesktopPanelTab: String, CaseIterable, Hashable, Sendable {
    /// Coding and Activity (live work), then the routines.
    case details
    /// The bot's files (was Files).
    case library
    case computer

    /// The tabs this pairing shows, in order: the desktop's three, for
    /// every pairing (the persona editor holds the rest).
    public static func visible(gate: SurfaceGate, slack: Bool = false) -> [DesktopPanelTab] {
        [.details, .library, .computer]
    }
}

/// The persona editor (`PersonaEditorModal.tsx`): the panel's "Edit
/// persona" button opens a searchable list of every section but identity
/// and routines (Details holds those).
public enum DesktopPersonaEditor {
    /// Whether the panel offers "Edit persona": one of its sections is
    /// reachable on this pairing.
    public static func offered(gate: SurfaceGate, slack: Bool = false) -> Bool {
        !DesktopPanelSection.visible(gate: gate, slack: slack).isEmpty
    }
}

/// A section of the persona editor (`BOT_SECTIONS` less identity and
/// routines, which Details holds).
public enum DesktopPanelSection: String, CaseIterable, Hashable, Sendable {
    case overview, slack, soul, skills, memory, access, worksOn, model, permissions, voice
    case visibility, sharing, perspicax, history, usage

    /// Search words beside the label (`sections.ts` keywords).
    public var keywords: [String] {
        switch self {
        case .overview: ["summary", "status", "what it does", "won't", "prompt", "what the model sees"]
        case .slack: ["slack", "slack app", "admin", "message", "direct messages", "mentions"]
        case .soul: ["standing instructions", "instructions", "persona", "rules", "soul.md"]
        case .skills: ["skills", "learned", "procedures", "teach"]
        case .memory: ["memory", "notes", "remember", "topics"]
        case .access: ["works on", "computer", "vm", "cloud", "vps", "folder", "workspace", "browser", "webhooks", "always allow", "grants", "tool selection", "tools", "mcp", "allow", "exclude"]
        case .worksOn: ["works on", "computer", "auto", "cloud", "local vm", "vm", "this computer", "browser", "off", "where it works"]
        case .model: ["engine", "model", "provider", "cli", "effort"]
        case .permissions: ["auto mode", "approve", "auto approve", "review", "routine approvals", "peers", "contact", "coordination", "chief of staff", "section"]
        case .voice: ["voice", "alerts", "notifications", "speak"]
        case .visibility: ["visibility", "who can see", "private", "people", "admins", "members", "access", "hide"]
        case .sharing: ["share", "sharing", "people", "grant", "who can use", "members", "directory"]
        case .perspicax: ["perspicax", "mcp", "profile", "profiles", "tools", "connectwise"]
        case .history: ["history", "changes", "undo", "rollback", "log"]
        case .usage: ["tokens", "cost", "billing"]
        }
    }

    /// Whether this pairing reaches the section. `slack`: the server
    /// answered a link to the bot's Slack app.
    public func reachable(gate: SurfaceGate, slack: Bool) -> Bool {
        switch self {
        case .overview: gate.allows(.botOverview)
        case .slack: gate.allows(.botSlack) && slack
        case .soul, .skills, .memory, .access, .model, .permissions, .history:
            gate.allows(.advancedBotPanel)
        case .voice: true
        case .visibility: gate.allows(.botVisibility)
        case .sharing: gate.allows(.botSharing)
        case .perspicax: gate.allows(.botPerspicax)
        // its own item on a server signed in with Perspicax only (Access
        // holds it everywhere else)
        case .worksOn: gate.allows(.botPerspicax) && gate.allows(.advancedBotPanel)
        case .usage: gate.allows(.botUsage)
        }
    }

    /// The persona editor's list for this pairing, in the desktop's order.
    public static func visible(gate: SurfaceGate, slack: Bool = false) -> [DesktopPanelSection] {
        allCases.filter { $0.reachable(gate: gate, slack: slack) }
    }

    /// The list's search (`sectionMatches`): the label or a keyword holds
    /// the query, ignoring case and surrounding spaces. An empty query
    /// matches everything.
    public func matches(_ query: String, label: String) -> Bool {
        let wanted = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !wanted.isEmpty else { return true }
        return ([rawValue, label] + keywords).contains { $0.lowercased().contains(wanted) }
    }
}

/// The editor's six groups (`persona-sections.ts` `PERSONA_GROUPS`, JC
/// 2026-10-14): Profile, Instructions, Memory and files, Model and tools,
/// Behavior, History and usage. A group's page shows its sections one under
/// the other; a section folded into another on the desktop (Who can see
/// it and Shared with in the Overview, Slack and Works on in Access)
/// follows its host's group.
public enum DesktopPanelGroup: String, CaseIterable, Hashable, Sendable {
    case profile, instructions, memoryFiles, modelTools, behavior, activity

    /// Every section the group may hold, in the order it draws them.
    public var sections: [DesktopPanelSection] {
        switch self {
        case .profile: [.overview, .visibility, .sharing]
        case .instructions: [.soul, .skills]
        case .memoryFiles: [.memory]
        case .modelTools: [.model, .access, .worksOn, .slack, .perspicax]
        case .behavior: [.permissions, .voice]
        case .activity: [.history, .usage]
        }
    }

    /// The group that shows a section.
    public static func of(_ section: DesktopPanelSection) -> DesktopPanelGroup {
        allCases.first { $0.sections.contains(section) } ?? .profile
    }

    /// The groups with at least one of `visible`, in order.
    public static func visible(_ visible: [DesktopPanelSection]) -> [DesktopPanelGroup] {
        allCases.filter { !$0.sections(in: visible).isEmpty }
    }

    /// The group's sections this pairing lists.
    public func sections(in visible: [DesktopPanelSection]) -> [DesktopPanelSection] {
        sections.filter(visible.contains)
    }

    /// The list's search: the group's label, or one of its sections'.
    public func matches(_ query: String, label: String, visible: [DesktopPanelSection], sectionLabel: (DesktopPanelSection) -> String) -> Bool {
        let wanted = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !wanted.isEmpty else { return true }
        if label.lowercased().contains(wanted) { return true }
        return sections(in: visible).contains { $0.matches(query, label: sectionLabel($0)) }
    }
}

/// The iPhone's Edit bot groups, in the desktop editor's own order
/// (`persona-sections.ts` `PERSONA_GROUPS`: Instructions, Model and tools,
/// Security, Activity) under the inline identity block (avatar, name, label,
/// description), which is the Profile group's home. Grok Bot's phone editor
/// has no Profile list and no search: the three pages Profile held are moved,
/// not dropped. Who can see it and Shared with join Security (they are access
/// rules); the read-only Overview (what the model sees, export) opens Activity.
public enum PhoneBotEditGroup: String, CaseIterable, Hashable, Sendable {
    case instructions, modelTools, security, activity

    public var sections: [DesktopPanelSection] {
        switch self {
        case .instructions: [.soul, .skills, .memory]
        case .modelTools: [.model, .worksOn, .access, .slack, .voice]
        case .security: [.permissions, .perspicax, .visibility, .sharing]
        case .activity: [.overview, .usage, .history]
        }
    }

    /// The groups with at least one of `visible`, in order.
    public static func visible(_ visible: [DesktopPanelSection]) -> [PhoneBotEditGroup] {
        allCases.filter { !$0.sections(in: visible).isEmpty }
    }

    /// The group's sections this pairing lists.
    public func sections(in visible: [DesktopPanelSection]) -> [DesktopPanelSection] {
        sections.filter(visible.contains)
    }
}

/// Where the panel sits at a window width (spec "At each iPad width"): docked
/// beside the chat from 1024 pt, over the leading edge below.
public enum DesktopPanelPlacement: Equatable, Sendable {
    case docked, overlay

    public static let dockMinWidth: Double = 1024
    public static let defaultWidth: Double = 360
    public static let minWidth: Double = 320
    public static let maxWidth: Double = 720

    public static func at(windowWidth: Double) -> DesktopPanelPlacement {
        windowWidth >= dockMinWidth ? .docked : .overlay
    }

    /// A stored or dragged width, held to the desktop's 320 to 720
    /// (`SETTINGS_MIN_WIDTH`, `SETTINGS_MAX_WIDTH`); nothing stored is 360.
    public static func clampedWidth(_ width: Double?) -> Double {
        guard let width, width.isFinite, width > 0 else { return defaultWidth }
        return min(maxWidth, max(minWidth, width))
    }
}

/// Details > Routines (`RoutineList.tsx` grouped, `routine-display.ts`).
public enum DesktopRoutineList {
    public enum State: Equatable, Sendable { case active, paused, finished }

    /// Active first, then the soonest next run, then by name.
    public static func sorted(_ routines: [Routine]) -> [Routine] {
        routines.sorted { a, b in
            if a.enabled != b.enabled { return a.enabled }
            let left = a.nextRunAt ?? .infinity, right = b.nextRunAt ?? .infinity
            if left != right { return left < right }
            return a.name.localizedCompare(b.name) == .orderedAscending
        }
    }

    /// The line under the name: a consumed one-shot is finished, not paused.
    public static func state(_ routine: Routine, now: Date = Date()) -> State {
        if routine.schedule.type == .once, routine.nextRunAt == nil,
           let at = routine.schedule.at, at <= now.timeIntervalSince1970 * 1000 {
            return .finished
        }
        return routine.enabled ? .active : .paused
    }

    /// The bot's own routines.
    public static func of(botId: String, in routines: [Routine]) -> [Routine] {
        sorted(routines.filter { $0.botId == botId })
    }
}

/// The Library tab's sizes (`formatSize`): bytes under 1 KB, else one
/// decimal of KB or MB, base 1024.
public enum DesktopFileSize {
    public static func format(_ bytes: Int) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        if bytes < 1024 * 1024 { return String(format: "%.1f KB", Double(bytes) / 1024) }
        return String(format: "%.1f MB", Double(bytes) / (1024 * 1024))
    }
}

/// The panel's own bot fields (`PATCH /api/bots/:id`): Permissions (Chief
/// of Staff, ask before contacting other bots, the approval level) and
/// Access (works on, cloud backend, working folder). The server takes them
/// from an admin session only; `SurfaceGate.botAccessEdit` says when to send.
public struct BotPanelPatch: Encodable, Hashable, Sendable {
    public var chiefOfStaff: Bool?
    public var approvePeerComms: Bool?
    public var approvalMode: String?
    /// Full access asks for a confirmation (`FullAccessWarning`).
    public var confirmFullAccess: Bool?
    public var applyToAllThreads: Bool?
    public var computer: String?
    public var cloudBackend: String?
    public var cwd: String?
    /// Works on: Browser turns the bot's own browser switch on with it.
    public var browser: Bool?

    public init(chiefOfStaff: Bool? = nil, approvePeerComms: Bool? = nil, approvalMode: String? = nil,
                confirmFullAccess: Bool? = nil, applyToAllThreads: Bool? = nil, computer: String? = nil,
                cloudBackend: String? = nil, cwd: String? = nil, browser: Bool? = nil) {
        self.browser = browser
        self.chiefOfStaff = chiefOfStaff
        self.approvePeerComms = approvePeerComms
        self.approvalMode = approvalMode
        self.confirmFullAccess = confirmFullAccess
        self.applyToAllThreads = applyToAllThreads
        self.computer = computer
        self.cloudBackend = cloudBackend
        self.cwd = cwd
    }

    public var isEmpty: Bool { self == BotPanelPatch() }

    /// Full access always carries its confirmation; the other levels never.
    public static func approval(_ level: ApprovalLevel, allThreads: Bool = true) -> BotPanelPatch {
        level == .full
            ? BotPanelPatch(approvalMode: level.rawValue, confirmFullAccess: true, applyToAllThreads: allThreads)
            : BotPanelPatch(approvalMode: level.rawValue)
    }
}

/// Where a bot works (`WorksOnSetting`): the six choices of the Access
/// section, in the desktop's order. Absent is Auto.
public enum DesktopWorksOn: String, CaseIterable, Hashable, Sendable {
    case auto, cloud, vm, local, browser, off

    public static func of(_ bot: Bot) -> DesktopWorksOn {
        bot.computer.flatMap(DesktopWorksOn.init(rawValue:)) ?? .auto
    }

    /// The value written: "auto" (the server reads it as Auto and clears
    /// the field), "off", or a place an older build offered.
    public var stored: String { rawValue }
}

/// One webhook as Edit persona > Access lists it (`GET /api/webhooks`, the
/// fields of `shared/webhooks.ts` the card shows; the credential never
/// rides this list).
public struct WebhookListing: Decodable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var botId: String
    public var enabled: Bool
    public var deliveryCount: Int
    /// Public path id. The bearer token never rides this list.
    public var endpointId: String?
    public var lastReceivedAt: Double?
    /// Typed source (`github`, `slack`, ...). Nil on a plain bearer webhook.
    public var sourceType: String?
    public var sourceEvents: [String]
    /// Read-only filter line (`repo: acme/app`). Empty when there is none.
    public var sourceFilters: String
    /// The signing secret is set on the computer. The value is never here.
    public var signingSecretSet: Bool

    public init(
        id: String, name: String, botId: String, enabled: Bool, deliveryCount: Int,
        endpointId: String? = nil, lastReceivedAt: Double? = nil, sourceType: String? = nil,
        sourceEvents: [String] = [], sourceFilters: String = "", signingSecretSet: Bool = false
    ) {
        self.id = id
        self.name = name
        self.botId = botId
        self.enabled = enabled
        self.deliveryCount = deliveryCount
        self.endpointId = endpointId
        self.lastReceivedAt = lastReceivedAt
        self.sourceType = sourceType
        self.sourceEvents = sourceEvents
        self.sourceFilters = sourceFilters
        self.signingSecretSet = signingSecretSet
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, botId, enabled, deliveryCount, endpointId, lastReceivedAt, source, signingSecretSet
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        botId = (try? c.decode(String.self, forKey: .botId)) ?? ""
        enabled = (try? c.decode(Bool.self, forKey: .enabled)) ?? false
        deliveryCount = (try? c.decode(Int.self, forKey: .deliveryCount)) ?? 0
        endpointId = try? c.decodeIfPresent(String.self, forKey: .endpointId)
        lastReceivedAt = try? c.decodeIfPresent(Double.self, forKey: .lastReceivedAt)
        signingSecretSet = (try? c.decodeIfPresent(Bool.self, forKey: .signingSecretSet)) ?? false
        if let source = try? c.decode(WebhookSourceWire.self, forKey: .source) {
            sourceType = source.type
            sourceEvents = source.events ?? []
            sourceFilters = WebhookPublicURL.filtersLine(source.filters ?? [:])
        } else {
            sourceType = nil
            sourceEvents = []
            sourceFilters = ""
        }
    }
}

/// A typed trigger's public fields. Filters that are not a list of strings
/// are dropped. A secret is not a field of this object.
private struct WebhookSourceWire: Decodable {
    var type: String?
    var events: [String]?
    var filters: [String: [String]]?

    private enum CodingKeys: String, CodingKey { case type, events, filters }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = try c.decodeIfPresent(String.self, forKey: .type)
        events = try c.decodeIfPresent([String].self, forKey: .events)
        filters = try? c.decode([String: [String]].self, forKey: .filters)
    }
}

/// Where deliveries land, without a token (`ingress` on `GET /api/webhooks`).
public struct WebhookIngress: Decodable, Hashable, Sendable {
    public var available: Bool
    public var baseUrl: String
}

/// The URL a person may read. A typed trigger is `/sources/<id>` (the
/// provider signs it). A bearer webhook is `/hooks/<id>` and the token
/// stays on the computer. Anything that could hide a path is refused.
public enum WebhookPublicURL {
    public static func make(baseURL: String?, endpointId: String?, typed: Bool) -> String? {
        guard let endpointId else { return nil }
        let id = endpointId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty, id.range(of: #"^[A-Za-z0-9_-]{1,128}$"#, options: .regularExpression) != nil else { return nil }
        let path = (typed ? "/sources/" : "/hooks/") + id
        let base = (baseURL ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !base.isEmpty else { return path }
        let trimmed = base.hasSuffix("/") ? String(base.dropLast()) : base
        guard trimmed.hasPrefix("https://") || trimmed.hasPrefix("http://") else { return path }
        guard !trimmed.contains(" ") else { return path }
        return trimmed + path
    }

    /// Brand names, never translated (`TRIGGER_SOURCES` labels).
    public static func sourceLabel(_ type: String) -> String {
        switch type {
        case "github": "GitHub"
        case "gitlab": "GitLab"
        case "slack": "Slack"
        case "teams": "Microsoft Teams"
        case "email": "Outlook"
        case "calendar": "Outlook Calendar"
        case "sentry": "Sentry"
        case "pagerduty": "PagerDuty"
        case "linear": "Linear"
        // not a brand: the app translates it (Localizable "Bot email")
        case "botmail": "Bot email"
        default: type
        }
    }

    /// English label of each typed trigger event kind, the desktop's
    /// `triggers.event.*` words and the app catalog's keys. A kind this
    /// build does not know is shown as sent.
    public static let eventLabels: [String: String] = [
        "pr.opened": "Pull request opened",
        "pr.updated": "Pull request updated (new commits)",
        "pr.merged": "Pull request merged",
        "pr.closed": "Pull request closed without merge",
        "pr.review_requested": "Review requested",
        "pr.review_submitted": "Any review submitted",
        "pr.review_approved": "Review approves",
        "pr.review_changes_requested": "Review requests changes",
        "pr.review_commented": "Review comments only",
        "pr.comment": "PR comment posted",
        "pr.review_comment": "Inline review comment",
        "pr.thread_resolved": "Review thread resolved",
        "pr.thread_reopened": "Review thread reopened",
        "ci.failed": "CI failed",
        "ci.succeeded": "CI succeeded",
        "issue.opened": "Issue opened",
        "push": "Push",
        "release.published": "Release published",
        "mr.opened": "Merge request opened",
        "mr.merged": "Merge request merged",
        "mr.closed": "Merge request closed",
        "pipeline.failed": "Pipeline failed",
        "pipeline.succeeded": "Pipeline succeeded",
        "mention": "@mention of the app",
        "reaction": "Reaction added",
        "message": "Message in a channel",
        "message.created": "New message",
        "message.updated": "Message edited",
        "email.received": "Email received",
        "event.created": "Event created",
        "event.updated": "Event updated",
        "event.cancelled": "Event cancelled",
        "event.starting": "Event starting (connector)",
        "issue.created": "Issue created",
        "issue.resolved": "Issue resolved",
        "issue.assigned": "Issue assigned",
        "issue.archived": "Issue archived",
        "issue.unresolved": "Issue unresolved again",
        "alert.triggered": "Alert triggered",
        "error.created": "Error captured",
        "incident.triggered": "Incident triggered",
        "incident.acknowledged": "Incident acknowledged",
        "incident.escalated": "Incident escalated",
        "incident.reassigned": "Incident reassigned",
        "incident.resolved": "Incident resolved",
        "issue.updated": "Issue updated",
        "issue.status_changed": "Issue status changed",
        "issue.removed": "Issue removed",
        "comment.created": "Comment added",
        "cycle.completed": "Cycle completed",
    ]

    public static func eventLabel(_ kind: String) -> String? {
        eventLabels[kind]
    }

    public static func filtersLine(_ filters: [String: [String]]) -> String {
        filters.keys.sorted().compactMap { key in
            let values = (filters[key] ?? []).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
            guard !values.isEmpty else { return nil }
            return "\(key): \(values.joined(separator: ", "))"
        }.joined(separator: " · ")
    }
}

public struct WebhooksResponse: Decodable, Sendable {
    public var webhooks: [WebhookListing]
    public var ingress: WebhookIngress?

    private enum CodingKeys: String, CodingKey { case webhooks, ingress }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        webhooks = (try? c.decode([WebhookListing].self, forKey: .webhooks)) ?? []
        ingress = try? c.decode(WebhookIngress.self, forKey: .ingress)
    }

    /// One bot's webhooks, in the server's order.
    public func of(botId: String) -> [WebhookListing] { webhooks.filter { $0.botId == botId } }
}

private struct WebhookOneResponse: Decodable {
    var webhook: WebhookListing
}

public extension CompanionClient {
    /// `GET /api/webhooks`: the triggers (Edit persona > Access's Webhooks card).
    func webhooks() async throws -> WebhooksResponse {
        try await send(makeRequest("GET", "/api/webhooks"), as: WebhooksResponse.self)
    }

    /// Pause or resume a trigger the computer already has. Creating,
    /// rotating and revealing a secret stay on the computer: this body is
    /// only `enabled`.
    func setWebhookEnabled(id: String, enabled: Bool) async throws -> WebhookListing {
        guard Self.validRouteID(id) else { throw APIError.badURL }
        return try await send(
            try makeRequest("PATCH", "/api/webhooks/\(id)", body: ["enabled": enabled, "verificationPending": false]),
            as: WebhookOneResponse.self
        ).webhook
    }

    /// `PATCH /api/bots/:id` with the panel's own fields.
    func patchBotSettings(botId: String, patch: BotPanelPatch) async throws -> Bot {
        try await send(patchBotSettingsRequest(botId: botId, patch: patch), as: BotResponse.self).bot
    }

    func patchBotSettingsRequest(botId: String, patch: BotPanelPatch) throws -> URLRequest {
        guard Self.validRouteID(botId), !patch.isEmpty else { throw APIError.badURL }
        return try makeRequest("PATCH", "/api/bots/\(botId)", encodedBody: patch)
    }
}

/// What the Computer tab's screen shows (`ComputerPanel` phases, the ones a
/// paired iPad can tell): Auto, Off and Browser never create or wake a
/// computer, so they show a live frame only when one is streaming; a bot
/// pinned to a computer asks it for a picture.
public enum DesktopComputerPhase: Equatable, Sendable {
    /// A picture to draw.
    case picture
    /// "This bot's computer is off".
    case off
    /// "This bot works in the built-in browser — no desktop here".
    case browser
    /// Waiting for the pinned computer's first picture.
    case waiting

    public static func of(worksOn: DesktopWorksOn, hasPicture: Bool) -> DesktopComputerPhase {
        switch worksOn {
        case .off: return .off
        case .browser: return .browser
        case .auto: return hasPicture ? .picture : .off
        case .cloud, .vm, .local: return hasPicture ? .picture : .waiting
        }
    }

    /// Whether the tab may poll the computer for screenshots.
    public static func polls(_ worksOn: DesktopWorksOn) -> Bool {
        switch worksOn {
        case .cloud, .vm, .local: true
        case .auto, .off, .browser: false
        }
    }
}

/// `whenLabel` (src/lib/schedule-label.ts): the time for today, else the
/// short month and day.
public enum DesktopWhenLabel {
    public static func label(_ ms: Double, now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current) -> String {
        let date = Date(timeIntervalSince1970: ms / 1000)
        if calendar.isDate(date, inSameDayAs: now) {
            return date.formatted(Date.FormatStyle(date: .omitted, time: .shortened, locale: locale, calendar: calendar, timeZone: calendar.timeZone))
        }
        return date.formatted(Date.FormatStyle(locale: locale, calendar: calendar, timeZone: calendar.timeZone).month(.abbreviated).day())
    }
}

/// The panel's name, label and description, edited where they show
/// (`InlineEditableText.tsx` `inlineEditCommit`): what leaving the field
/// saves. Nothing when the trimmed text did not change or a required value
/// was emptied; otherwise the trimmed text (an empty optional value clears).
public enum DesktopInlineEdit {
    public static func commit(draft: String, current: String, required: Bool) -> String? {
        let next = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        if next == current.trimmingCharacters(in: .whitespacesAndNewlines) { return nil }
        if required && next.isEmpty { return nil }
        return next
    }
}

/// Edit persona > Access's Works on choices and their notes (`AccessSection.tsx`
/// with `src/lib/place.ts` and `src/lib/feature-flags.ts`).
public enum DesktopWorksOnRules {
    /// Whether this server offers a place (`placeOffered`): every place on
    /// an organization server; an OMB Cloud home has no "this computer" and
    /// no Local VM; elsewhere Cloud only while a Boat or VPS computer is
    /// switched on.
    public static func offered(_ place: DesktopWorksOn, config: ConfigStatus?, organization: Bool) -> Bool {
        switch place {
        case .auto, .off: return true
        default: break
        }
        if organization { return true }
        if config?.cloudHome == true { return place != .local && place != .vm }
        if place == .cloud { return cloudComputersOffered(config) }
        return true
    }

    /// A Boat or a VPS computer may be chosen (`cloudComputersOffered`).
    public static func cloudComputersOffered(_ config: ConfigStatus?) -> Bool {
        config?.features?.boatComputer == true || config?.features?.vpsComputer == true
    }

    /// The choices, in the desktop's order: Auto and Off only. Workspace is
    /// always Auto (JC 2026-10-18): the bot picks where each task runs among
    /// the places it may use, so none is offered. Off stays: it gives the
    /// bot no computer and no browser at all.
    public static func choices(config: ConfigStatus?, organization: Bool) -> [DesktopWorksOn] {
        [.auto, .off]
    }

    /// The server has a browser engine (`browserAvailable`).
    public static func browserAvailable(_ config: ConfigStatus?) -> Bool {
        config?.browserEngine?.kind == "engine"
    }

    /// The built-in browser switch in Experimental features.
    public static func browserFeature(_ config: ConfigStatus?) -> Bool {
        config?.features?.browser == true
    }

    /// "Works on: Browser" may be chosen (`browserSelectable`).
    public static func browserSelectable(config: ConfigStatus?, modelCanBrowse: Bool) -> Bool {
        browserAvailable(config) && browserFeature(config) && modelCanBrowse
    }

    /// Why Browser cannot be chosen (`browserDisabledReason`).
    public enum BrowserBlock: Equatable, Sendable {
        /// The engine is not installed yet (`browser.notInstalled`).
        case notInstalled
        /// The server's own words.
        case server(String)
        /// `browser.noEngine`.
        case noEngine
        /// Switched off under Experimental features.
        case featureOff
        /// The bot's model cannot use the browser.
        case model
    }

    public static func browserBlock(config: ConfigStatus?) -> BrowserBlock {
        if !browserAvailable(config) {
            let engine = config?.browserEngine
            if engine?.kind == "unavailable", engine?.installable == true { return .notInstalled }
            if engine?.kind == "unavailable", let reason = engine?.reason, !reason.isEmpty { return .server(reason) }
            return .noEngine
        }
        return browserFeature(config) ? .model : .featureOff
    }

    /// The Auto note and the cloud backend show for Auto or Cloud when a
    /// cloud computer is on offer (never on an organization server).
    public static func showsCloudBackend(worksOn: DesktopWorksOn, config: ConfigStatus?, organization: Bool) -> Bool {
        guard !organization, worksOn == .auto || worksOn == .cloud else { return false }
        return config?.cloudHome == true || cloudComputersOffered(config)
    }
}

// MARK: - The iPhone's bot panel

// The iPhone shows the same panel as the iPad and the desktop
// (`BotSettingsDialog.tsx`): the same tabs and persona sections, from the same
// `DesktopPanelTab` / `DesktopPanelSection` rules, full screen. What is the
// phone's own is below: the doors into it, the bot's actions in its top
// bar, and the Library's chips (the conversation's files by kind, and the
// bot's links as one more chip).

/// A way into the bot panel and the tab it opens on.
public enum BotPanelDoor: String, CaseIterable, Hashable, Sendable {
    /// The chat's name capsule (a long press is Threads).
    case nameCapsule
    /// The + sheet's "Bot settings".
    case plusSettings
    /// The chat's computer button.
    case computerButton
    /// The + sheet's Computer.
    case plusComputer

    public var tab: DesktopPanelTab {
        switch self {
        case .nameCapsule, .plusSettings: .details
        case .computerButton, .plusComputer: .computer
        }
    }
}

/// The bot's own actions, in the panel's top bar menu. The desktop keeps
/// them in the sidebar row's menu (Duplicate, Primary Bot, Delete) and has
/// no per-bot template share; the phone has no sidebar under the panel, so
/// they sit together in one menu, each once.
public enum BotPanelAction: String, CaseIterable, Hashable, Sendable {
    case shareTemplate, copyId, duplicate, makePrimary, replacePrimary, delete

    /// What this pairing may do with this bot, in menu order.
    public static func available(gate: SurfaceGate, bot: Bot, viewerId: String) -> [BotPanelAction] {
        var out: [BotPanelAction] = [.shareTemplate, .copyId]
        if gate.allows(.duplicateBot) { out.append(.duplicate) }
        if gate.allows(.primaryBot) {
            switch PrimaryBotRules.menuAction(for: bot, viewerId: viewerId) {
            case .make: out.append(.makePrimary)
            case .replace: out.append(.replacePrimary)
            case nil: break
            }
        }
        // D4: an owner's or an admin's, not a client session's
        if gate.allows(.botOwnerExtras) { out.append(.delete) }
        return out
    }
}

/// A chip of the Library tab: a kind of the conversation's files
/// (`FilesSection.tsx` `visibleFilters`), or the bot's links.
public enum BotLibraryChip: Hashable, Sendable {
    case files(ThreadFileFilter)
    case links

    public var fileFilter: ThreadFileFilter? {
        if case let .files(filter) = self { return filter }
        return nil
    }

    /// The chips to show: the files' kinds as the desktop shows them (two
    /// kinds or more), then Links when the bot has any. With links and a
    /// single kind of file, All stands for the files.
    public static func visible(counts: [ThreadFileFilter: Int], selected: BotLibraryChip, links: Int) -> [BotLibraryChip] {
        let kinds = ThreadFileRules.visibleFilters(counts: counts, selected: selected.fileFilter ?? .all).map(BotLibraryChip.files)
        guard links > 0 || selected == .links else { return kinds }
        return (kinds.isEmpty ? [.files(.all)] : kinds) + [.links]
    }
}

// MARK: - The bot's one "..." menu

/// One entry of the bot's one "..." menu (`BotActionsMenu.tsx`, JC
/// 2026-10-14): Edit bot, Rename, the Primary Bot entry; Export the
/// conversation (copy, download) and the bot (.zip); Archive, and in the
/// desktop's Advanced mode the Inspector. It replaced the mascot's menu,
/// the editor Overview's quick actions and the Primary bot button. "Put on
/// the desktop" floats a window: desktop only.
public enum BotActionsMenuItem: String, CaseIterable, Hashable, Sendable {
    case editBot, rename, makePrimary, replacePrimary
    case copyConversation, downloadConversation, exportZip
    case archive, inspector
}

public struct BotActionsMenuPlan: Hashable, Sendable {
    /// The entries, one group per run between the desktop's dividers; the
    /// second group is the export, under its heading.
    public var groups: [[BotActionsMenuItem]]
    /// Set when Archive is shown but may not run now (the desktop's hint).
    public var archiveBlock: BotArchiveBlock?

    public var items: [BotActionsMenuItem] { groups.flatMap { $0 } }

    public func enables(_ item: BotActionsMenuItem) -> Bool {
        item != .archive || archiveBlock == nil
    }

    /// - Parameters:
    ///   - viewerId: the viewer as the server knows them; nil keeps the
    ///     Primary Bot entry out, as the sidebar's menu does.
    ///   - editable: the pairing lists at least one section of the editor.
    ///   - zipExport: `showBotZipExport` (the bot's owner or an admin, not
    ///     through a sidecar).
    ///   - inspector: the Inspector is offered where the pairing shows it.
    ///   - activeBotCount: bots not archived, for Archive's "keep one".
    public init(gate: SurfaceGate, bot: Bot, viewerId: String?, editable: Bool, zipExport: Bool,
                inspector: Bool = false, activeBotCount: Int) {
        var first: [BotActionsMenuItem] = []
        if editable { first.append(.editBot) }
        if gate.allows(.renameBot), gate.scope != .serverClient || viewerId.map({ PrimaryBotRules.viewerOwns(bot, viewerId: $0) }) == true {
            first.append(.rename)
        }
        if let viewerId, gate.allows(.primaryBot) {
            switch PrimaryBotRules.menuAction(for: bot, viewerId: viewerId) {
            case .make: first.append(.makePrimary)
            case .replace: first.append(.replacePrimary)
            case nil: break
            }
        }
        var export: [BotActionsMenuItem] = [.copyConversation, .downloadConversation]
        if zipExport { export.append(.exportZip) }
        var last: [BotActionsMenuItem] = []
        var block: BotArchiveBlock?
        if gate.allows(.archiveBot) {
            last.append(.archive)
            if bot.chiefOfStaff == true { block = .primary } else if activeBotCount <= 1 { block = .lastActive }
        }
        if inspector, gate.allows(.inspector) { last.append(.inspector) }
        groups = [first, export, last].filter { !$0.isEmpty }
        archiveBlock = block
    }
}
