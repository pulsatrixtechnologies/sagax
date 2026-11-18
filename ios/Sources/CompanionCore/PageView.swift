// A page a bot made, as the app shows it (2026-10-28, the desktop's page
// view: src/components/PublishedPages.tsx PagePublishCard,
// src/components/PageViewer.tsx PageSurface, src/components/PageShare.tsx,
// src/components/PageComposerParts.tsx, src/lib/open-page.ts and
// shared/data-context.ts withPageContext). Everything here is pure, so the
// phone and the desktop agree on:
//   - the card's line under the title (where this version stands);
//   - the preview address the app draws (`bare=1`, its theme, the place);
//   - the place a page's frame reports (`sagax-page-scroll`, only a number);
//   - the requests one Share gesture sends (`sharePlan`);
//   - the bot's one line over the floating composer;
//   - the page a message sent from the open page is about (`dataContext.page`).
import Foundation

// MARK: - Wire

/// The page a message was sent from (`dataContext.page`): shown on the
/// message as a chip, and given to the bot with its current source. Its
/// title is the page's, never an instruction.
public struct PageContextRef: Codable, Hashable, Sendable {
    public var pageId: String
    public var title: String
    public var version: Int?
    /// The passage the person selected and asked about (#4099,
    /// `dataContext.page.selection`): the annotation anchor, cut by the same
    /// limits as the desktop's.
    public var selection: PageQuote?

    public init(pageId: String, title: String, version: Int? = nil, selection: PageQuote? = nil) {
        self.pageId = pageId
        self.title = title
        self.version = version
        self.selection = selection
    }

    public init(from decoder: Decoder) throws {
        let values = try? decoder.container(keyedBy: CodingKeys.self)
        pageId = (try? values?.decodeIfPresent(String.self, forKey: .pageId)) ?? ""
        title = (try? values?.decodeIfPresent(String.self, forKey: .title)) ?? ""
        version = (try? values?.decodeIfPresent(Int.self, forKey: .version)) ?? nil
        selection = (try? values?.decodeIfPresent(PageQuote.self, forKey: .selection)) ?? nil
    }

    /// A page id the routes accept: the chip draws only then.
    public var isDrawable: Bool { PublishedPagesRules.validID(pageId) }

    /// The JSON the message route takes.
    public var body: [String: Any] {
        var body: [String: Any] = ["pageId": pageId, "title": title]
        if let version { body["version"] = version }
        if let selection { body["selection"] = selection.body }
        return body
    }

    private enum CodingKeys: String, CodingKey { case pageId, title, version, selection }
}

/// A passage of a page (shared/page-threads.ts `PageQuote`): its words and a
/// little of what comes before and after, to find it again, and where it
/// sits. Page text: data, never an instruction.
public struct PageQuote: Codable, Hashable, Sendable {
    public var kind: String
    public var quote: String
    public var prefix: String
    public var suffix: String
    public var path: String
    public var tag: String

    public init(kind: String = "text", quote: String, prefix: String = "", suffix: String = "", path: String = "", tag: String = "") {
        self.kind = kind
        self.quote = quote
        self.prefix = prefix
        self.suffix = suffix
        self.path = path
        self.tag = tag
    }

    /// THREAD_LIMITS: the words the server keeps.
    public static let quoteChars = 500
    public static let contextChars = 64
    public static let pathChars = 240
    public static let tagChars = 32

    /// The JSON the message route takes.
    public var body: [String: Any] {
        ["kind": kind, "quote": quote, "prefix": prefix, "suffix": suffix, "path": path, "tag": tag]
    }

    /// An anchor as the frame posts it, checked and cut; nil for no words.
    init?(frame value: Any?) {
        guard let record = value as? [String: Any] else { return nil }
        let kind = record["kind"] as? String == "element" ? "element" : "text"
        func line(_ key: String, _ max: Int) -> String {
            guard let text = record[key] as? String else { return "" }
            let flat = String(text.unicodeScalars.map { $0.value < 32 || $0.value == 127 ? " " : Character($0) })
            return String(flat.prefix(max))
        }
        let quote = line("quote", Self.quoteChars)
        guard !quote.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        self.init(kind: kind, quote: quote, prefix: line("prefix", Self.contextChars), suffix: line("suffix", Self.contextChars),
                  path: line("path", Self.pathChars), tag: line("tag", Self.tagChars))
    }
}

/// The selection's box in the page frame's viewport, in CSS pixels (points).
public struct PageSelectionRect: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var w: Double
    public var h: Double

    public init(x: Double, y: Double, w: Double, h: Double) {
        self.x = x
        self.y = y
        self.w = w
        self.h = h
    }
}

/// What the page's frame said about the selection (shared/page-selection.ts).
public enum PageSelectionUpdate: Equatable, Sendable {
    case selected(PageQuote, PageSelectionRect)
    case cleared
}

/// `Message.dataContext` (shared/wire.ts): the Data result or the page the
/// person was viewing when they sent the message. A field of another shape
/// never loses the message.
public struct MessageDataContext: Codable, Hashable, Sendable {
    public var cardId: String?
    public var draftSql: String?
    public var page: PageContextRef?

    public init(cardId: String? = nil, draftSql: String? = nil, page: PageContextRef? = nil) {
        self.cardId = cardId
        self.draftSql = draftSql
        self.page = page
    }

    public init(from decoder: Decoder) throws {
        let values = try? decoder.container(keyedBy: CodingKeys.self)
        cardId = (try? values?.decodeIfPresent(String.self, forKey: .cardId)) ?? nil
        draftSql = (try? values?.decodeIfPresent(String.self, forKey: .draftSql)) ?? nil
        page = (try? values?.decodeIfPresent(PageContextRef.self, forKey: .page)) ?? nil
    }

    private enum CodingKeys: String, CodingKey { case cardId, draftSql, page }
}

/// The people and teams a page's person invited to read it (Share > Add
/// people or groups). Principal ids and team ids, never a name.
public struct PageInvites: Codable, Hashable, Sendable {
    public var people: [String]
    public var teams: [String]

    public static let none = PageInvites(people: [], teams: [])

    public init(people: [String], teams: [String]) {
        self.people = people
        self.teams = teams
    }

    public init(from decoder: Decoder) throws {
        let values = try? decoder.container(keyedBy: CodingKeys.self)
        people = ((try? values?.decodeIfPresent([String].self, forKey: .people)) ?? nil) ?? []
        teams = ((try? values?.decodeIfPresent([String].self, forKey: .teams)) ?? nil) ?? []
    }

    private enum CodingKeys: String, CodingKey { case people, teams }
}

/// The page open over a conversation: one at a time per chat screen. The
/// conversation stays under it, so closing it returns to the same place.
public struct OpenPageRef: Hashable, Identifiable, Sendable {
    public var pageId: String
    public var botId: String
    public var threadId: String
    /// The title known when it was opened (the card's), until the page answers.
    public var title: String
    /// The version to show first; nil: the newest.
    public var version: Int?
    /// Milliseconds: the bot's line over the composer shows what came after.
    public var openedAt: Double

    public var id: String { pageId }

    public init(pageId: String, botId: String, threadId: String, title: String, version: Int? = nil, openedAt: Double) {
        self.pageId = pageId
        self.botId = botId
        self.threadId = threadId
        self.title = title
        self.version = version
        self.openedAt = openedAt
    }
}

public enum PageTheme: String, Sendable {
    case light, dark
}

/// Where the card's version stands (`pageCardState`).
public enum PageCardState: String, Sendable {
    case proposed, published, declined, superseded, revoked, draft
}

/// The bot's one line over the floating composer (`pageBotStatusLine`).
public enum PageBotStatus: Hashable, Sendable {
    case working
    case reply(String)
}

// MARK: - Rules

public enum PageViewRules {
    /// The message a preview frame posts while its reader scrolls.
    public static let scrollMessage = "sagax-page-scroll"
    /// The farthest place the app asks a preview to restore.
    public static let scrollMax = 10_000_000
    /// A title's longest length (PAGE_LIMITS.title).
    public static let titleMax = 120

    /// The card's line under the title. Nil until the version is in the page.
    public static func cardState(page: PublishedPageSummary?, version: Int) -> PageCardState? {
        guard let page, let entry = page.versions.first(where: { $0.n == version }) else { return nil }
        if page.status == "published", page.currentVersion == version { return .published }
        if entry.state == "declined" { return .declined }
        if let current = page.currentVersion, current > version { return .superseded }
        if page.versions.contains(where: { $0.n > version }) { return .superseded }
        if page.status == "revoked" { return .revoked }
        return page.status == "published" ? .proposed : .draft
    }

    /// The preview wrapper's query the app draws (`previewSrc`): no banner
    /// inside the app, its theme, the place to keep. Only this server's own
    /// wrapper path; nil for anything else.
    /// `skin` is the person's skin tokens (`ContentTheme.skinParam`), sent
    /// with a theme only: the page's default theme takes the skin's colors.
    public static func previewQuery(bare: Bool, theme: PageTheme?, y: Int?, annotate: Bool = false, skin: String? = nil) -> [URLQueryItem] {
        var items: [URLQueryItem] = []
        if annotate { items.append(URLQueryItem(name: "annotate", value: "1")) }
        if bare { items.append(URLQueryItem(name: "bare", value: "1")) }
        if let theme {
            items.append(URLQueryItem(name: "theme", value: theme.rawValue))
            if let skin, skin.range(of: #"^[A-Za-z0-9_-]{1,4096}$"#, options: .regularExpression) != nil {
                items.append(URLQueryItem(name: "skin", value: skin))
            }
        }
        if let y, (0...scrollMax).contains(y) { items.append(URLQueryItem(name: "y", value: String(y))) }
        return items
    }

    /// `previewSrc`: the path with its query, or nil when the path is not
    /// this server's preview wrapper.
    public static func previewSrc(_ path: String, bare: Bool, theme: PageTheme?, y: Int?, annotate: Bool = false, skin: String? = nil) -> String? {
        guard let safe = PagePreview.src(path), safe == path else { return nil }
        let query = previewQuery(bare: bare, theme: theme, y: y, annotate: annotate, skin: skin)
        guard !query.isEmpty else { return safe }
        return safe + "?" + query.map { "\($0.name)=\($0.value ?? "")" }.joined(separator: "&")
    }

    /// A scroll report from the preview (`parseScrollMessage`): only a whole
    /// number of pixels, else nil. The page's own scripts can post the same
    /// message; it is only ever used to place the next drawing.
    public static func parseScroll(_ data: Any?) -> Int? {
        guard let record = data as? [String: Any] else { return nil }
        guard record["type"] as? String == scrollMessage else { return nil }
        guard let v = record["v"] as? NSNumber, !isBool(v), v.doubleValue == 1 else { return nil }
        guard let raw = record["y"] as? NSNumber, !isBool(raw) else { return nil }
        let y = raw.doubleValue
        guard y.isFinite, y == y.rounded(), y >= 0, y <= Double(scrollMax) else { return nil }
        return Int(y)
    }

    private static func isBool(_ number: NSNumber) -> Bool {
        CFGetTypeID(number) == CFBooleanGetTypeID()
    }

    /// The message a preview frame posts about the person's selection.
    public static let selectionMessage = "sagax-page-selection"
    /// Far outside any page the frame can draw: a coordinate past it is not one.
    private static let rectLimit = 1_000_000.0

    /// A selection message from the preview (`parsePageSelectionMessage`): an
    /// anchor with a finite box, or a clear. The page's own scripts can post
    /// the same message: the box only places an overlay of the app.
    public static func parseSelection(_ data: Any?) -> PageSelectionUpdate? {
        guard let record = data as? [String: Any] else { return nil }
        guard record["type"] as? String == selectionMessage else { return nil }
        guard let v = record["v"] as? NSNumber, !isBool(v), v.doubleValue == 1 else { return nil }
        if record["anchor"] is NSNull { return .cleared }
        guard let anchor = PageQuote(frame: record["anchor"]), let box = record["rect"] as? [String: Any] else { return nil }
        func number(_ key: String, min: Double) -> Double? {
            guard let raw = box[key] as? NSNumber, !isBool(raw) else { return nil }
            let value = raw.doubleValue
            return value.isFinite && value >= min && value <= rectLimit ? value.rounded() : nil
        }
        guard let x = number("x", min: -rectLimit), let y = number("y", min: -rectLimit),
              let w = number("w", min: 0), let h = number("h", min: 0) else { return nil }
        return .selected(anchor, PageSelectionRect(x: x, y: y, w: w, h: h))
    }

    /// The message the app posts to the page's frame: follow this passage in
    /// the version just drawn, or drop the selection (nil), as JSON the web
    /// view's script posts to its frame.
    public static func selectionRequestJSON(_ anchor: PageQuote?) -> String {
        var message: [String: Any] = ["type": selectionMessage, "v": 1]
        message["anchor"] = anchor?.body ?? NSNull()
        let data = try? JSONSerialization.data(withJSONObject: message, options: [.sortedKeys])
        return data.flatMap { String(data: $0, encoding: .utf8) } ?? "null"
    }

    /// Where the composer goes in a page of `width` by `height`
    /// (`selectionComposerPlace`): 10 under the passage, over it when there
    /// is no room under (and more above), never past a side, never under the
    /// docked composer's `inset`.
    public static func selectionComposerPlace(rect: PageSelectionRect, width: Double, height: Double, inset: Double = composerBottomInset) -> (left: Double, width: Double, top: Double?, bottom: Double?) {
        let boxWidth = max(0, min(Self.composerWidth, width - 2 * composerEdge))
        let left = min(max(composerEdge, rect.x), max(composerEdge, width - boxWidth - composerEdge))
        let under = rect.y + rect.h + composerGap
        let below = height - inset - composerEdge - min(under, height - (48 + inset))
        let above = rect.y - composerGap - composerEdge
        if height <= 0 || below >= composerMaxHeight || (above < composerMaxHeight && above <= below) {
            return (left, boxWidth, height <= 0 ? under : max(composerEdge, min(under, height - (48 + inset))), nil)
        }
        return (left, boxWidth, nil, height - rect.y + composerGap)
    }

    public static let composerWidth = 360.0
    public static let composerEdge = 8.0
    public static let composerGap = 10.0
    public static let composerMaxHeight = 144.0
    public static let composerBottomInset = 96.0

    /// The version a page opens on (`pageVersionToShow`): the one asked for,
    /// else the newest, else the published one.
    public static func versionToShow(page: PublishedPageSummary?, asked: Int?) -> Int? {
        guard let page else { return asked }
        if let asked, page.versions.contains(where: { $0.n == asked }) { return asked }
        return page.versions.map(\.n).max() ?? page.currentVersion
    }

    /// A newer version than the one on screen, when the conversation names
    /// one (`newerVersion`): the page is drawn again with it, in place.
    public static func newerVersion(shown: Int?, latest: Int?) -> Int? {
        guard let latest else { return nil }
        guard let shown else { return latest }
        return latest > shown ? latest : nil
    }

    /// What undoing the bot's edit of a passage takes (`undoEditPlan`): the
    /// version asked about published again when the bot's version is the
    /// published one, else the bot's version declined when it is a proposal.
    public static func undoSteps(page: PublishedPageSummary, from: Int, to: Int) -> [PageShareStep] {
        if page.status == "published", page.currentVersion == to {
            return PageShareRules.plan(page: page, version: from, change: .version)
        }
        if page.versions.first(where: { $0.n == to })?.state == "proposed" {
            return [PageShareStep(method: "POST", path: "/decline", body: ["version": to])]
        }
        return []
    }

    /// A newer version from the conversation, unless the person sent it back
    /// with Undo (`skipped` and below) (`followedVersion`).
    public static func followedVersion(_ newer: Int?, skipped: Int) -> Int? {
        guard let newer, newer > skipped else { return nil }
        return newer
    }

    /// The newest version of a page the conversation names (its cards).
    public static func latestVersion(in messages: [Message], pageId: String) -> Int? {
        messages.compactMap { $0.pagePublish }.filter { $0.pageId == pageId }.map(\.version).max()
    }

    /// The title a rename sends: one line, trimmed, at most 120 characters;
    /// nil when there is nothing to send.
    public static func renameTitle(draft: String, current: String) -> String? {
        let line = draft.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).joined(separator: " ")
        let title = String(line.prefix(titleMax)).trimmingCharacters(in: .whitespaces)
        return title.isEmpty || title == current ? nil : title
    }

    /// `pageBotStatusLine`: working, or the bot's newest text since the page
    /// was opened, on one line; nil when there is nothing new.
    public static func statusLine(messages: [Message], busy: Bool, openedAt: Double) -> PageBotStatus? {
        if busy { return .working }
        for message in messages.reversed() {
            if message.at < openedAt { return nil }
            guard message.role == .bot, message.kind == .text, let text = message.text,
                  !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
            let line = oneLine(text)
            guard !line.isEmpty else { return nil }
            if line.count > 160 {
                return .reply(String(line.prefix(159)).trimmingCharacters(in: .whitespaces) + "…")
            }
            return .reply(line)
        }
        return nil
    }

    /// Markdown marks off, then every run of white space as one space.
    static func oneLine(_ text: String) -> String {
        let lines = text.components(separatedBy: "\n").map { line -> String in
            var line = line
            if let range = line.range(of: #"^\s{0,3}(#{1,6}|>)\s"#, options: .regularExpression) {
                line.removeSubrange(range)
            }
            return line
        }
        let joined = lines.joined(separator: "\n")
            .replacingOccurrences(of: "**", with: "")
            .replacingOccurrences(of: "__", with: "")
            .replacingOccurrences(of: "`", with: "")
        return joined.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).joined(separator: " ")
    }

    /// `withPageContext`: the page a message is about, when the page is open
    /// over this bot's conversation. Never for an empty send, another bot,
    /// or an opening command (`/…`, the save-run-as-skill line).
    public static func pageContext(text: String, page: OpenPageRef?, title: String, version: Int?, botId: String?) -> PageContextRef? {
        guard !text.isEmpty, let page, let botId, page.botId == botId else { return nil }
        let opening = text.drop(while: { $0.isWhitespace || $0.isNewline })
        if opening.hasPrefix("/") || opening.hasPrefix(saveRunAsSkillLine) { return nil }
        return PageContextRef(pageId: page.pageId, title: title, version: version)
    }

    /// shared/learn-request.ts SAVE_RUN_AS_SKILL_LINE: parsed by the server
    /// before the model reads the turn, so it never carries a page.
    public static let saveRunAsSkillLine = RunSteps.saveRunAsSkillLine
}

// MARK: - Places

/// How far down each page its reader last was (`rememberPagePlace`), in
/// memory for this app run: a page the bot changes, or a page opened again,
/// is drawn at the same place. Only numbers.
public final class PagePlaces: @unchecked Sendable {
    public static let shared = PagePlaces()
    public static let maxPlaces = 200

    private let lock = NSLock()
    private var order: [String] = []
    private var places: [String: Int] = [:]

    public init() {}

    public func remember(_ pageId: String, y: Int) {
        guard PublishedPagesRules.validID(pageId), (0...PageViewRules.scrollMax).contains(y) else { return }
        lock.lock(); defer { lock.unlock() }
        order.removeAll { $0 == pageId }
        order.append(pageId)
        places[pageId] = y
        while order.count > Self.maxPlaces {
            places[order.removeFirst()] = nil
        }
    }

    /// 0 for a page not read yet.
    public func place(_ pageId: String) -> Int {
        lock.lock(); defer { lock.unlock() }
        return places[pageId] ?? 0
    }
}

// MARK: - Share

/// One gesture in Share (`ShareChange`).
public enum PageShareChange: Hashable, Sendable {
    case access(PublishedPageAccess)
    case invites(PageInvites)
    case link
    case expiry(hours: Int)
    case version
    case stop
}

/// One request a Share gesture sends (`ShareStep`). `path` comes after
/// `/api/pages/<id>`.
public struct PageShareStep: Hashable, @unchecked Sendable {
    public var method: String
    public var path: String
    public var body: [String: AnyHashable]

    public init(method: String, path: String, body: [String: AnyHashable]) {
        self.method = method
        self.path = path
        self.body = body
    }

    /// The body as the request writes it (NSNull for a null).
    public var json: [String: Any] {
        body.mapValues { $0.base }
    }
}

public enum PageShareRules {
    /// The requests one Share gesture sends, in order (`sharePlan`). A page
    /// not shared yet is published (the version on screen) by the gesture
    /// itself; a shared one is changed in place.
    public static func plan(page: PublishedPageSummary, version: Int, change: PageShareChange, now: Date = Date()) -> [PageShareStep] {
        let shared = page.status == "published"
        let nowMs = now.timeIntervalSince1970 * 1000
        func publish(_ access: String) -> PageShareStep {
            let expiresAt: AnyHashable
            if let at = page.expiresAt, at > nowMs { expiresAt = AnyHashable(at) } else { expiresAt = AnyHashable(NSNull()) }
            return PageShareStep(method: "POST", path: "/publish", body: ["version": version, "access": access, "expiresAt": expiresAt])
        }
        switch change {
        case let .access(access):
            if !shared { return [publish(access.rawValue)] }
            return access.rawValue == page.access ? [] : [PageShareStep(method: "PATCH", path: "", body: ["access": access.rawValue])]
        case let .invites(invites):
            let invite = PageShareStep(method: "POST", path: "/invite", body: ["people": invites.people, "teams": invites.teams])
            return shared ? [invite] : [invite, publish(page.access)]
        case .link:
            return shared ? [] : [publish(page.access)]
        case let .expiry(hours):
            guard shared else { return [] }
            let at: AnyHashable = PublishedPagesRules.expiresAt(hours: hours, now: now).map { AnyHashable($0) } ?? AnyHashable(NSNull())
            return [PageShareStep(method: "PATCH", path: "", body: ["expiresAt": at])]
        case .version:
            return shared && page.currentVersion != version ? [publish(page.access)] : []
        case .stop:
            return shared ? [PageShareStep(method: "POST", path: "/revoke", body: [:])] : []
        }
    }

    /// The invite lists with one more person or team, or one fewer (`withInvite`).
    public static func withInvite(_ invites: PageInvites?, person: Bool, id: String, add: Bool) -> PageInvites {
        var current = invites ?? .none
        let rest = (person ? current.people : current.teams).filter { $0.lowercased() != id.lowercased() }
        let next = add ? rest + [id] : rest
        if person { current.people = next } else { current.teams = next }
        return current
    }

    /// Teams whose name matches, not already invited (`teamCandidates`).
    public static func teamCandidates(_ teams: [OrgDirectoryTeam], invited: [String], query: String, limit: Int = 8) -> [OrgDirectoryTeam] {
        let taken = Set(invited.map { $0.lowercased() })
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return Array(teams.filter { !taken.contains($0.id.lowercased()) && (q.isEmpty || $0.name.lowercased().contains(q)) }.prefix(limit))
    }

    /// The access the general-access rows show checked: a page not shared
    /// yet reads as "People you invite" until a gesture shares it.
    public static func shownAccess(_ page: PublishedPageSummary) -> PublishedPageAccess {
        page.status == "published" ? (PublishedPageAccess(rawValue: page.access) ?? .private) : .private
    }

    /// A row the person cannot choose: a public link while the organization
    /// turned them off (unless the page already is one).
    public static func isOff(_ access: PublishedPageAccess, page: PublishedPageSummary, policy: PagesPolicy) -> Bool {
        access == .link && !policy.linkSharing && page.access != "link"
    }

    /// Switching to a public link asks a second press (`needsLinkConfirm`).
    public static func needsLinkConfirm(from current: PublishedPageAccess, to next: PublishedPageAccess) -> Bool {
        next == .link && current != .link
    }
}

// MARK: - Library

public enum PageLibraryRules {
    /// The pages of this bot, newest first.
    public static func pages(_ pages: [PublishedPageSummary], botId: String) -> [PublishedPageSummary] {
        pages.filter { $0.botId == botId }.sorted { $0.updatedAt != $1.updatedAt ? $0.updatedAt > $1.updatedAt : $0.id < $1.id }
    }
}

// MARK: - Client

private struct PageViewPageBody: Decodable {
    var page: PublishedPageSummary?
}

public extension CompanionClient {
    /// The authorized GET for the app's own drawing of a preview path
    /// `PagePreview.src` already accepted: no banner, the app's theme, the
    /// place to keep.
    func pagePreviewRequest(path: String, bare: Bool, theme: PageTheme?, y: Int?, skin: String? = nil) throws -> URLRequest {
        guard let safe = PagePreview.src(path) else { throw APIError.badURL }
        return try makeRequest("GET", safe, query: PageViewRules.previewQuery(bare: bare, theme: theme, y: y, skin: skin))
    }

    /// One step of a Share gesture (or any page change) on the person's
    /// own page; the server checks every rule again.
    func pageStep(id: String, _ step: PageShareStep) async throws -> PublishedPageSummary {
        guard PublishedPagesRules.validID(id), ["", "/publish", "/invite", "/revoke", "/decline"].contains(step.path) else { throw APIError.badURL }
        let answer = try await send(makeRequest(step.method, "/api/pages/\(id)\(step.path)", body: step.json), as: PageViewPageBody.self)
        guard let page = answer.page else {
            throw APIError.transport("The computer sent something this app couldn't read.")
        }
        return page
    }

    /// `PATCH /api/pages/:id { title }`: rename the person's own page.
    func renamePage(id: String, title: String) async throws -> PublishedPageSummary {
        try await pageStep(id: id, PageShareStep(method: "PATCH", path: "", body: ["title": title]))
    }

    /// `PATCH /api/pages/:id { pinned }`.
    func setPagePinned(id: String, pinned: Bool) async throws -> PublishedPageSummary {
        try await pageStep(id: id, PageShareStep(method: "PATCH", path: "", body: ["pinned": pinned]))
    }
}
