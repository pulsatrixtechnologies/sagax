import Foundation

// Wire models for the bot profile (parity screens 03 to 10) and its routine
// screens (05, 06). Each type mirrors one server route
// (server/routes/bot-library.ts, server/index.ts `PATCH /api/bots/:id`);
// the payloads are listed in docs/ios-companion.md, "Visual parity routes".

// MARK: - PATCH /api/bots/:id (profile edits)

/// One profile edit through the generic bot route. Only the fields set are
/// sent. A member may change the look and the picture framing of any bot;
/// the name, instructions, notifications and picture belong to the owner or
/// an admin (`server/auth/request-auth.ts` `memberBotFieldViolation`).
public struct BotProfileEdit: Encodable, Equatable, Sendable {
    public enum AvatarURL: Equatable, Sendable {
        case set(String)
        case clear
    }

    public var color: String?
    public var mascotLook: MascotLook?
    public var mascotSkin: MascotSkin?
    public var avatarCrop: AvatarCrop?
    /// The server clamps zoom to 1...3 and focus to 0...1.
    public var avatarZoom: Double?
    public var avatarFocusX: Double?
    public var avatarFocusY: Double?
    public var avatarUrl: AvatarURL?
    public var notifications: Bool?
    public var soul: String?
    /// Let the bot send spoken notes (`voiceNotes`).
    public var voiceNotes: Bool?

    public init(
        color: String? = nil,
        mascotLook: MascotLook? = nil,
        mascotSkin: MascotSkin? = nil,
        avatarCrop: AvatarCrop? = nil,
        avatarZoom: Double? = nil,
        avatarFocusX: Double? = nil,
        avatarFocusY: Double? = nil,
        avatarUrl: AvatarURL? = nil,
        notifications: Bool? = nil,
        soul: String? = nil,
        voiceNotes: Bool? = nil
    ) {
        self.color = color
        self.mascotLook = mascotLook
        self.mascotSkin = mascotSkin
        self.avatarCrop = avatarCrop
        self.avatarZoom = avatarZoom
        self.avatarFocusX = avatarFocusX
        self.avatarFocusY = avatarFocusY
        self.avatarUrl = avatarUrl
        self.notifications = notifications
        self.soul = soul
        self.voiceNotes = voiceNotes
    }

    /// The desktop's "Reset to default" (`BotProfileAvatarCard.tsx`): the owl
    /// in green, no skin, no picture.
    public static let resetLook = BotProfileEdit(
        color: "green", mascotLook: .owl, mascotSkin: MascotSkin.none, avatarCrop: .mascot, avatarUrl: .clear
    )

    /// Lot 9: the Avatar sheet keeps a local draft until Done. Builds the
    /// PATCH from the baseline look to the draft; `clearsPicture` is set when
    /// the person tapped Reset (picture goes with the default look).
    public static func lookDiff(
        fromColor: String, fromLook: MascotLook, fromSkin: MascotSkin,
        toColor: String, toLook: MascotLook, toSkin: MascotSkin,
        clearsPicture: Bool
    ) -> BotProfileEdit {
        var edit = BotProfileEdit()
        if toColor != fromColor { edit.color = toColor }
        if toLook != fromLook { edit.mascotLook = toLook }
        if toSkin != fromSkin { edit.mascotSkin = toSkin }
        if clearsPicture {
            edit.avatarCrop = .mascot
            edit.avatarUrl = .clear
        }
        return edit
    }

    public var isEmpty: Bool {
        color == nil && mascotLook == nil && mascotSkin == nil && avatarCrop == nil && avatarZoom == nil
            && avatarFocusX == nil && avatarFocusY == nil && avatarUrl == nil && notifications == nil && soul == nil && voiceNotes == nil
    }

    private enum CodingKeys: String, CodingKey {
        case color, mascotLook, mascotSkin, avatarCrop, avatarZoom, avatarFocusX, avatarFocusY, avatarUrl, notifications, soul, voiceNotes
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encodeIfPresent(color, forKey: .color)
        try values.encodeIfPresent(mascotLook, forKey: .mascotLook)
        try values.encodeIfPresent(mascotSkin, forKey: .mascotSkin)
        try values.encodeIfPresent(avatarCrop, forKey: .avatarCrop)
        try values.encodeIfPresent(avatarZoom, forKey: .avatarZoom)
        try values.encodeIfPresent(avatarFocusX, forKey: .avatarFocusX)
        try values.encodeIfPresent(avatarFocusY, forKey: .avatarFocusY)
        switch avatarUrl {
        case let .set(path): try values.encode(path, forKey: .avatarUrl)
        case .clear: try values.encodeNil(forKey: .avatarUrl)
        case nil: break
        }
        try values.encodeIfPresent(notifications, forKey: .notifications)
        try values.encodeIfPresent(soul, forKey: .soul)
        try values.encodeIfPresent(voiceNotes, forKey: .voiceNotes)
    }
}

// MARK: - GET /api/bots/:id/links

/// One URL found in the bot's messages: newest first, one per URL.
public struct BotLink: Decodable, Hashable, Identifiable, Sendable {
    public var url: String
    public var domain: String
    public var title: String?
    public var messageId: String?
    public var threadId: String?
    public var at: Double

    public var id: String { url }

    private enum CodingKeys: String, CodingKey { case url, domain, title, messageId, threadId, at }

    public init(url: String, domain: String? = nil, title: String? = nil, messageId: String? = nil, threadId: String? = nil, at: Double = 0) {
        self.url = LinkAddress.cleaned(url)
        self.domain = domain.flatMap { $0.isEmpty ? nil : $0 } ?? LinkAddress.host(of: self.url) ?? self.url
        self.title = title
        self.messageId = messageId
        self.threadId = threadId
        self.at = at
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            url: values.decode(String.self, forKey: .url),
            domain: values.decodeIfPresent(String.self, forKey: .domain),
            title: values.decodeIfPresent(String.self, forKey: .title),
            messageId: values.decodeIfPresent(String.self, forKey: .messageId),
            threadId: values.decodeIfPresent(String.self, forKey: .threadId),
            at: values.decodeIfPresent(Double.self, forKey: .at) ?? 0
        )
    }

    /// Only web addresses open in the in-app browser.
    public var webURL: URL? {
        guard let parsed = URL(string: url), let scheme = parsed.scheme?.lowercased(),
              scheme == "https" || scheme == "http", parsed.host != nil
        else { return nil }
        return parsed
    }

    /// Whether the phone can open it: an address on the computer itself
    /// (localhost, 127.0.0.1, ::1) or its private network (10.x, 192.168.x,
    /// a `.local` name) only answers there.
    public var reach: LinkReach {
        guard let host = LinkAddress.host(of: url) else { return .computer }
        return LinkAddress.isComputerOnly(host: host) ? .computer : .web
    }

    /// The address as a person reads it: decoded, without the scheme or a
    /// lone trailing slash.
    public var readableAddress: String { LinkAddress.readable(url) }

    /// The row's title before a page preview names it: the Markdown link's
    /// text, else the domain.
    public var fallbackTitle: String {
        if let title, !title.isEmpty { return title }
        return domain
    }
}

/// Where a link opens.
public enum LinkReach: Sendable, Equatable {
    /// A public web page: the in-app browser.
    case web
    /// Only from the computer that wrote it: copy it, never open it here.
    case computer
}

/// Link addresses as the Links tab reads them.
public enum LinkAddress {
    /// The delimiters a message wraps a link in and that are never part of
    /// it, raw or percent-encoded (a Markdown code mark is `%60`). Older
    /// computers sent them; the server strips them now.
    private static let trailingRaw = CharacterSet(charactersIn: "`\"'<>.,;:!?*_~\u{00BB}\u{201D}\u{2019}")
    private static let trailingEncoded = ["%60", "%22", "%27", "%3C", "%3E", "%5B", "%5D", "%C2%BB", "%E2%80%9D", "%E2%80%99"]

    public static func cleaned(_ raw: String) -> String {
        var url = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let tick = url.firstIndex(of: "`") { url = String(url[..<tick]) }
        var previous = ""
        while previous != url {
            previous = url
            while let last = url.unicodeScalars.last, trailingRaw.contains(last) { url.unicodeScalars.removeLast() }
            for code in trailingEncoded where url.uppercased().hasSuffix(code) {
                url = String(url.dropLast(code.count))
            }
        }
        return url
    }

    /// The host, lowercased, an IPv6 literal without its brackets.
    public static func host(of url: String) -> String? {
        guard let components = URLComponents(string: url), var host = components.host, !host.isEmpty else { return nil }
        if host.hasPrefix("["), host.hasSuffix("]") { host = String(host.dropFirst().dropLast()) }
        return host.lowercased()
    }

    /// Loopback, unspecified, link-local and private addresses, `localhost`
    /// and `.local` / `.localhost` / `.lan` / `.home.arpa` names, and a
    /// single-label name (a machine on the computer's network).
    public static func isComputerOnly(host raw: String) -> Bool {
        let host = raw.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]."))
        if host.isEmpty || host == "localhost" { return true }
        for suffix in [".localhost", ".local", ".lan", ".home.arpa", ".internal"] where host.hasSuffix(suffix) { return true }
        if host.contains(":") { return isPrivateIPv6(host) }
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        let octets = parts.compactMap { UInt8($0) }
        if parts.count == 4, octets.count == 4 {
            switch (octets[0], octets[1]) {
            case (0, _), (10, _), (127, _), (169, 254), (192, 168): return true
            case (172, 16...31): return true
            default: return false
            }
        }
        return parts.count == 1
    }

    private static func isPrivateIPv6(_ host: String) -> Bool {
        let address = host.split(separator: "%").first.map(String.init) ?? host
        if address == "::1" || address == "::" { return true }
        if address.hasPrefix("::ffff:") {
            // an IPv4-mapped address, dotted or as two hex words (URL.href
            // writes [::ffff:127.0.0.1] as [::ffff:7f00:1])
            let mapped = String(address.dropFirst(7))
            if mapped.contains(".") { return isComputerOnly(host: mapped) }
            let words = mapped.split(separator: ":").compactMap { UInt16($0, radix: 16) }
            guard words.count == 2 else { return false }
            return isComputerOnly(host: "\(words[0] >> 8).\(words[0] & 0xFF).\(words[1] >> 8).\(words[1] & 0xFF)")
        }
        guard let first = address.split(separator: ":", omittingEmptySubsequences: false).first,
              let word = UInt16(first, radix: 16) else { return false }
        return word & 0xFE00 == 0xFC00 || word & 0xFFC0 == 0xFE80
    }

    /// Decoded, without `https://` or a lone trailing slash.
    public static func readable(_ url: String) -> String {
        var text = url.removingPercentEncoding ?? url
        for scheme in ["https://", "http://"] where text.lowercased().hasPrefix(scheme) {
            text = String(text.dropFirst(scheme.count))
        }
        if text.hasSuffix("/"), text.dropLast().contains("/") == false { text.removeLast() }
        return text
    }
}

/// A page of a list: the items, the cursor for the next page (nil at the
/// end) and the total count.
public struct LibraryPage<Item: Sendable & Hashable>: Sendable, Equatable {
    public var items: [Item]
    public var nextCursor: String?
    public var total: Int

    public init(items: [Item], nextCursor: String?, total: Int) {
        self.items = items
        self.nextCursor = nextCursor
        self.total = total
    }

    public var hasMore: Bool { nextCursor != nil }

    /// This page appended to an earlier one, without repeating an item.
    public func appending(_ next: LibraryPage<Item>) -> LibraryPage<Item> {
        var seen = Set(items)
        let added = next.items.filter { seen.insert($0).inserted }
        return LibraryPage(items: items + added, nextCursor: next.nextCursor, total: next.total)
    }
}

struct BotLinksResponse: Decodable {
    var links: [BotLink]
    var nextCursor: String?
    var total: Int?
}

// MARK: - GET /api/bots/:id/files

public enum BotFileKind: String, Codable, Sendable {
    case media, file
}

/// One file of the bot's threads (Media and Files tabs). `url` and
/// `previewUrl` are the existing `/api/threads/:id/files/:fileId` routes.
public struct BotLibraryFile: Decodable, Hashable, Identifiable, Sendable {
    public var id: String
    public var threadId: String
    public var messageId: String?
    public var name: String
    public var mime: String?
    public var size: Int?
    public var available: Bool
    public var at: Double
    public var kind: BotFileKind
    public var url: String
    public var previewUrl: String?

    private enum CodingKeys: String, CodingKey { case id, threadId, messageId, name, mime, size, available, at, kind, url, previewUrl }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        threadId = try values.decode(String.self, forKey: .threadId)
        messageId = try values.decodeIfPresent(String.self, forKey: .messageId)
        name = try values.decodeIfPresent(String.self, forKey: .name) ?? ""
        mime = try values.decodeIfPresent(String.self, forKey: .mime)
        size = try values.decodeIfPresent(Int.self, forKey: .size)
        available = try values.decodeIfPresent(Bool.self, forKey: .available) ?? true
        at = try values.decodeIfPresent(Double.self, forKey: .at) ?? 0
        let rawKind = try values.decodeIfPresent(String.self, forKey: .kind)
        kind = rawKind.flatMap(BotFileKind.init(rawValue:)) ?? ((mime ?? "").hasPrefix("image/") ? .media : .file)
        url = try values.decodeIfPresent(String.self, forKey: .url) ?? "/api/threads/\(threadId)/files/\(id)"
        previewUrl = try values.decodeIfPresent(String.self, forKey: .previewUrl)
    }

    /// A safe name for the downloaded copy (Quick Look shows it).
    public var localFileName: String {
        let base = (name as NSString).lastPathComponent
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return base.isEmpty ? "file-\(id)" : base
    }
}

struct BotFilesResponse: Decodable {
    var files: [BotLibraryFile]
    var nextCursor: String?
    var total: Int?
}

// MARK: - POST /api/bots/:id/export

/// The bot as a single-bot team package (v2): no chats, no header values or
/// keys. `document` is kept as the server's JSON bytes so nothing is lost.
public struct BotExport: Sendable, Equatable {
    public var document: Data
    public var filename: String?
    public var redacted: Int
    public var skipped: Int

    /// What the share sheet carries: `<Bot name>.json`.
    public static func shareFileName(botName: String) -> String {
        let cleaned = botName.unicodeScalars
            .map { CharacterSet(charactersIn: "/\\:?%*|\"<>").contains($0) || CharacterSet.controlCharacters.contains($0) ? "-" : String($0) }
            .joined()
            .trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: ".")))
        return "\(cleaned.isEmpty ? "Bot" : String(cleaned.prefix(80))).json"
    }

    static func decode(_ data: Data) throws -> BotExport {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let document = object["document"], JSONSerialization.isValidJSONObject(document)
        else { throw APIError.transport("The server did not return a bot package.") }
        let bytes = try JSONSerialization.data(withJSONObject: document, options: [.prettyPrinted, .sortedKeys])
        func count(_ value: Any?) -> Int {
            if let array = value as? [Any] { return array.count }
            if let number = value as? Int { return number }
            return 0
        }
        return BotExport(
            document: bytes,
            filename: object["filename"] as? String,
            redacted: count(object["redacted"]),
            skipped: count(object["skipped"])
        )
    }
}

// MARK: - Routine presentation

public extension Routine {
    /// "Next run" on the routine screen: nil when nothing is scheduled.
    /// `dueNow` when the time has come (or passed and the run is pending).
    enum NextRun: Equatable, Sendable {
        case none
        case dueNow
        case at(Date)
    }

    func nextRun(now: Date = Date()) -> NextRun {
        guard enabled, let next = nextRunAt else { return .none }
        let date = Date(timeIntervalSince1970: next / 1_000)
        return date <= now ? .dueNow : .at(date)
    }
}

public extension RoutineSchedule {
    /// The parts of a human schedule line ("Every Monday at 7:00 AM") the app
    /// localizes: which days, and the time of day.
    enum DayPattern: Equatable, Sendable {
        case everyDay
        case weekdays
        case weekends
        /// One or more days, 0 = Sunday, in order.
        case days([Int])
        case none
    }

    var dayPattern: DayPattern {
        let days = Array(Set((weekdays ?? []).filter { (0..<7).contains($0) })).sorted()
        switch days {
        case []: return .none
        case [0, 1, 2, 3, 4, 5, 6]: return .everyDay
        case [1, 2, 3, 4, 5]: return .weekdays
        case [0, 6]: return .weekends
        default: return .days(days)
        }
    }

    /// `daily.time` ("07:00") as hour and minute.
    var timeOfDay: (hour: Int, minute: Int)? {
        guard let time else { return nil }
        let parts = time.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2, (0..<24).contains(parts[0]), (0..<60).contains(parts[1]) else { return nil }
        return (parts[0], parts[1])
    }

    /// A cron schedule a sentence can say ("Weekdays at 8:11 AM",
    /// "Weekdays at 12:17 PM and 4:17 PM", "Weekdays at 8:15 AM and 12:30 PM"
    /// from "15 8 * * 1-5; 30 12 * * 1-5"): one minute per expression, one or more hours,
    /// every day of the month and every month, and any day-of-week list or
    /// range. Nil for anything else (steps, day-of-month or month limits),
    /// which is shown raw.
    struct CronWording: Equatable, Sendable {
        public var days: DayPattern
        /// Minutes after midnight, in order.
        public var minutesOfDay: [Int]
        /// The zone the times are in, when the schedule names one.
        public var timeZone: String?
    }

    var cronWording: CronWording? {
        guard type == .cron, let expression else { return nil }
        // 2026-10-29: several expressions joined by ";" (one per minute of a
        // day) say their times together when their days are the same.
        let parts = expression.split(separator: ";", omittingEmptySubsequences: false)
            .map { $0.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init) }
            .filter { !$0.isEmpty }
        guard let first = parts.first, first.count == 5,
              first[2] == "*" || first[2] == "?",
              first[3] == "*"
        else { return nil }
        var minutesOfDay = Set<Int>()
        for fields in parts {
            guard fields.count == 5, fields[2...] == first[2...],
                  let minute = Int(fields[0]), (0..<60).contains(minute)
            else { return nil }
            for part in fields[1].split(separator: ",", omittingEmptySubsequences: false) {
                guard let hour = Int(part), (0..<24).contains(hour) else { return nil }
                minutesOfDay.insert(hour * 60 + minute)
            }
        }
        guard let days = Self.cronDays(first[4]) else { return nil }
        let pattern = RoutineSchedule(type: .daily, weekdays: days).dayPattern
        let zone = timeZone.flatMap { $0.isEmpty ? nil : $0 }
        return CronWording(
            days: pattern,
            minutesOfDay: minutesOfDay.sorted(),
            timeZone: zone
        )
    }

    /// Day-of-week field: `*`, numbers (0 or 7 = Sunday), three-letter
    /// names, ranges and lists. Nil for steps or anything unknown.
    private static func cronDays(_ field: String) -> [Int]? {
        if field == "*" || field == "?" { return Array(0..<7) }
        let names = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
        func day(_ text: Substring) -> Int? {
            if let number = Int(text), (0...7).contains(number) { return number % 7 }
            return names.firstIndex(of: text.uppercased())
        }
        var days = Set<Int>()
        for part in field.split(separator: ",", omittingEmptySubsequences: false) {
            let bounds = part.split(separator: "-", omittingEmptySubsequences: false)
            switch bounds.count {
            case 1:
                guard let one = day(bounds[0]) else { return nil }
                days.insert(one)
            case 2:
                guard let low = day(bounds[0]), let rawHigh = bounds[1].isEmpty ? nil : bounds[1],
                      var high = Int(rawHigh).map({ $0 }) ?? names.firstIndex(of: rawHigh.uppercased())
                else { return nil }
                // "1-7" runs Monday to Sunday
                if high == 0, low > 0 { high = 7 }
                guard (0...7).contains(high), low <= high else { return nil }
                for value in low...high { days.insert(value % 7) }
            default:
                return nil
            }
        }
        return days.sorted()
    }

    /// An interval in whole hours ("Every 2 hours"): the hour count, else nil.
    var intervalHours: Int? {
        guard type == .interval, let minutes = everyMinutes, minutes >= 60, minutes % 60 == 0 else { return nil }
        return minutes / 60
    }
}
