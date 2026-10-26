import Foundation

// Phone tools (audit row 81, JC 2026-10-21): a bot asks this iPhone for
// something only the phone knows. The wire contract is shared/phone-tools.ts;
// the routes are server/routes/phone-tools.ts. Everything here is pure: the
// requests, the card's choices, when a request may run, and the shaping of
// each answer so the phone sends only what was asked. The iOS calls
// (Core Location, Contacts, EventKit, Photos, Shortcuts, the pasteboard)
// live in the app target (Features/PhoneTools).

/// The tools a bot may ask this phone for.
public enum PhoneTool: String, CaseIterable, Codable, Sendable, Identifiable {
    case location, contacts, reminders, calendar, photos, shortcut, clipboard, status
    /// "Scanner avec l'iPhone" (audit row 84): only the person's own
    /// computer asks it, from the vault's New card form; never a bot.
    case cardScan = "card_scan"

    public var id: String { rawValue }

    /// "Toujours permettre" is never offered: a shortcut can do anything,
    /// the clipboard may hold a password, a photo is picked by hand anyway,
    /// a card is scanned by hand each time.
    public var onceOnly: Bool { self == .shortcut || self == .clipboard || self == .photos || self == .cardScan }

    /// The person's computer asked, not a bot.
    public var fromComputer: Bool { self == .cardScan }
}

/// A request waiting on this phone (GET /api/me/phone-tools/requests).
public struct PhoneToolRequest: Decodable, Equatable, Sendable, Identifiable {
    public var id: String
    /// Nil for a tool this build does not know: the card offers Refuser only.
    public var tool: PhoneTool?
    public var args: [String: WidgetJSON]
    public var access: String
    public var botId: String
    public var botName: String
    public var threadId: String
    public var allowAlways: Bool
    public var preApproved: Bool
    public var createdAt: Double
    public var expiresAt: Double

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        id = try row.decode(String.self, forKey: .id)
        tool = PhoneTool(rawValue: (try? row.decode(String.self, forKey: .tool)) ?? "")
        args = (try? row.decode([String: WidgetJSON].self, forKey: .args)) ?? [:]
        access = (try? row.decode(String.self, forKey: .access)) ?? "read"
        botId = try row.decode(String.self, forKey: .botId)
        botName = (try? row.decode(String.self, forKey: .botName)) ?? ""
        threadId = (try? row.decode(String.self, forKey: .threadId)) ?? ""
        allowAlways = (try? row.decode(Bool.self, forKey: .allowAlways)) ?? false
        preApproved = (try? row.decode(Bool.self, forKey: .preApproved)) ?? false
        createdAt = (try? row.decode(Double.self, forKey: .createdAt)) ?? 0
        expiresAt = (try? row.decode(Double.self, forKey: .expiresAt)) ?? 0
    }

    private enum CodingKeys: String, CodingKey {
        case id, tool, args, access, botId, botName, threadId, allowAlways, preApproved, createdAt, expiresAt
    }

    public func string(_ key: String) -> String? {
        guard let value = args[key]?.string?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }

    public func int(_ key: String) -> Int? { args[key]?.number.map { Int($0) } }
    public func flag(_ key: String) -> Bool { args[key]?.bool ?? false }
    /// Why the bot asks, as it wrote it (shown on the card).
    public var reason: String? { string("reason") }
    /// `create` on reminders and the calendar; nil for the other tools.
    public var action: String? { string("action") }
    public var writes: Bool { access == "write" }
}

public struct PhoneToolRequests: Decodable, Sendable {
    public var requests: [PhoneToolRequest]
}

/// What the person decided on the card.
public enum PhoneToolDecision: String, Codable, Sendable {
    case deny, once, always
}

/// The answer the phone sends back. A refusal carries no result.
public struct PhoneToolAnswer: Encodable, Equatable, Sendable {
    public var decision: PhoneToolDecision
    public var result: WidgetJSON?
    public var error: String?

    public init(decision: PhoneToolDecision, result: WidgetJSON? = nil, error: String? = nil) {
        self.decision = decision
        self.result = result
        self.error = error.map { String($0.prefix(300)) }
    }

    public static let denied = PhoneToolAnswer(decision: .deny)

    /// A refusal the phone made itself, with the reason the bot reads.
    public static func refused(_ reason: String) -> PhoneToolAnswer {
        PhoneToolAnswer(decision: .deny, error: reason)
    }
}

/// A "Toujours permettre" saved for one bot and one tool.
public struct PhoneToolGrant: Decodable, Equatable, Sendable, Identifiable {
    public var botId: String
    public var botName: String?
    public var tool: String
    public var access: String
    public var key: String
    public var id: String { "\(botId)/\(key)" }
}

public struct PhoneToolGrants: Decodable, Sendable {
    public var grants: [PhoneToolGrant]
}

/// The card's rules, as the approval card everywhere else in Sagax:
/// Refuser / Toujours permettre (one tap) / Permettre une fois, one card
/// per yes. Never answered from the lock screen.
public enum PhoneToolRules {
    public enum Choice: String, Equatable, Sendable {
        case deny, always, once
    }

    /// The buttons the card shows, in their order.
    public static func choices(for request: PhoneToolRequest) -> [Choice] {
        guard let tool = request.tool else { return [.deny] }
        return request.allowAlways && !tool.onceOnly ? [.deny, .always, .once] : [.deny, .once]
    }

    public static func decision(_ choice: Choice) -> PhoneToolDecision {
        switch choice {
        case .deny: .deny
        case .always: .always
        case .once: .once
        }
    }

    /// A request covered by "Toujours permettre" runs without a card, but
    /// only while the app is open on screen (the phone is unlocked), only
    /// for a tool this phone offers, and never once it expired.
    public static func runsWithoutCard(_ request: PhoneToolRequest, appActive: Bool, offered: Set<PhoneTool>, protectedTransport: Bool = true, now: Date = Date()) -> Bool {
        guard appActive, protectedTransport, request.preApproved, let tool = request.tool, !tool.onceOnly, offered.contains(tool) else { return false }
        return !isExpired(request, now: now)
    }

    public static func isExpired(_ request: PhoneToolRequest, now: Date = Date()) -> Bool {
        request.expiresAt > 0 && now.timeIntervalSince1970 * 1000 >= request.expiresAt
    }

    /// JC 2026-10-21: phone tools only over HTTPS or Tailscale. On plain
    /// local Wi-Fi the answers would cross the network in clear, so the
    /// phone offers nothing and refuses with this reason (the bot reads it).
    public static func transportRefusal(protectedTransport: Bool) -> String? {
        protectedTransport ? nil : "The phone is on plain local Wi-Fi: phone tools need a secure connection (HTTPS or Tailscale). Tell the person; they can turn on Secure phone access or Tailscale, then ask again."
    }

    /// What the phone tells the server when it registers.
    public static func transport(protectedTransport: Bool) -> String {
        protectedTransport ? "protected" : "local"
    }

    /// The tools this phone offers: the person's switches in Settings,
    /// all on until they turn one off.
    public static func offered(disabled: Set<String>) -> [PhoneTool] {
        PhoneTool.allCases.filter { !disabled.contains($0.rawValue) }
    }
}

/// One contact as the phone read it, before shaping.
public struct PhoneContact: Equatable, Sendable {
    public var name: String
    public var phones: [String]
    public var emails: [String]
    public var addresses: [String]
    public var birthday: String?
    public var organization: String?

    public init(name: String, phones: [String] = [], emails: [String] = [], addresses: [String] = [], birthday: String? = nil, organization: String? = nil) {
        self.name = name
        self.phones = phones
        self.emails = emails
        self.addresses = addresses
        self.birthday = birthday
        self.organization = organization
    }
}

/// One reminder or event as the phone read it.
public struct PhoneReminder: Equatable, Sendable {
    public var title: String
    public var due: Date?
    public var list: String?
    public init(title: String, due: Date? = nil, list: String? = nil) {
        self.title = title
        self.due = due
        self.list = list
    }
}

public struct PhoneEvent: Equatable, Sendable {
    public var title: String
    public var start: Date
    public var end: Date
    public var allDay: Bool
    public var location: String?
    public var calendar: String?
    public init(title: String, start: Date, end: Date, allDay: Bool = false, location: String? = nil, calendar: String? = nil) {
        self.title = title
        self.start = start
        self.end = end
        self.allDay = allDay
        self.location = location
        self.calendar = calendar
    }
}

/// Each answer cut down to what the request asked for, before it leaves
/// the phone. The server cuts it again (shared/phone-tools.ts).
public enum PhoneToolShaping {
    public static let contactFields = ["phone", "email", "address", "birthday", "organization"]

    /// The contact fields asked for (phone and email when none were named).
    public static func requestedFields(_ request: PhoneToolRequest) -> Set<String> {
        let named = (request.args["fields"]?.array ?? []).compactMap(\.string).filter(contactFields.contains)
        return Set(named.isEmpty ? ["phone", "email"] : named)
    }

    public static func contactLimit(_ request: PhoneToolRequest) -> Int {
        min(max(request.int("limit") ?? 5, 1), 10)
    }

    public static func contacts(_ found: [PhoneContact], for request: PhoneToolRequest) -> WidgetJSON {
        let fields = requestedFields(request)
        let rows: [WidgetJSON] = found.prefix(contactLimit(request)).map { contact in
            var row: [String: WidgetJSON] = ["name": .string(String(contact.name.prefix(200)))]
            if fields.contains("phone"), !contact.phones.isEmpty { row["phones"] = .array(contact.phones.prefix(5).map { .string(String($0.prefix(60))) }) }
            if fields.contains("email"), !contact.emails.isEmpty { row["emails"] = .array(contact.emails.prefix(5).map { .string(String($0.prefix(200))) }) }
            if fields.contains("address"), !contact.addresses.isEmpty { row["addresses"] = .array(contact.addresses.prefix(3).map { .string(String($0.prefix(300))) }) }
            if fields.contains("birthday"), let birthday = contact.birthday { row["birthday"] = .string(String(birthday.prefix(20))) }
            if fields.contains("organization"), let organization = contact.organization, !organization.isEmpty { row["organization"] = .string(String(organization.prefix(200))) }
            return .object(row)
        }
        return .object(["contacts": .array(rows)])
    }

    /// About 100 m unless the bot asked precise (about 10 cm).
    public static func location(latitude: Double, longitude: Double, accuracy: Double?, at: Date, precise: Bool) -> WidgetJSON {
        let digits = precise ? 6.0 : 3.0
        let scale = pow(10, digits)
        var row: [String: WidgetJSON] = [
            "latitude": .number((latitude * scale).rounded() / scale),
            "longitude": .number((longitude * scale).rounded() / scale),
            "at": .string(iso(at)),
        ]
        if let accuracy, accuracy >= 0 { row["accuracyMeters"] = .number(precise ? accuracy.rounded() : max(accuracy.rounded(), 100)) }
        return .object(row)
    }

    public static func reminders(_ found: [PhoneReminder], limit: Int?) -> WidgetJSON {
        let rows: [WidgetJSON] = found.prefix(min(max(limit ?? 20, 1), 50)).map(reminderRow)
        return .object(["reminders": .array(rows)])
    }

    public static func createdReminder(_ reminder: PhoneReminder) -> WidgetJSON {
        .object(["created": reminderRow(reminder)])
    }

    public static func events(_ found: [PhoneEvent], limit: Int?) -> WidgetJSON {
        let rows: [WidgetJSON] = found.sorted { $0.start < $1.start }.prefix(min(max(limit ?? 50, 1), 100)).map(eventRow)
        return .object(["events": .array(rows)])
    }

    public static func createdEvent(_ event: PhoneEvent) -> WidgetJSON {
        .object(["created": eventRow(event)])
    }

    public static func clipboard(_ text: String?) -> WidgetJSON {
        guard let text, !text.isEmpty else { return .object(["empty": .bool(true)]) }
        return .object(["text": .string(String(text.prefix(4_000)))])
    }

    /// The network as NWPath reports it, in the wire's words.
    public static func status(batteryLevel: Float?, batteryState: String?, lowPowerMode: Bool, network: (status: String, type: String?, expensive: Bool, constrained: Bool)?, focused: Bool?) -> WidgetJSON {
        var row: [String: WidgetJSON] = ["lowPowerMode": .bool(lowPowerMode)]
        var battery: [String: WidgetJSON] = [:]
        if let batteryLevel, batteryLevel >= 0 { battery["level"] = .number((Double(batteryLevel) * 100).rounded() / 100) }
        if let batteryState { battery["state"] = .string(batteryState) }
        if !battery.isEmpty { row["battery"] = .object(battery) }
        if let network {
            var net: [String: WidgetJSON] = ["status": .string(network.status), "expensive": .bool(network.expensive), "constrained": .bool(network.constrained)]
            if let type = network.type { net["type"] = .string(type) }
            row["network"] = .object(net)
        }
        if let focused { row["focus"] = .object(["focused": .bool(focused)]) }
        return .object(row)
    }

    /// Picked photos: base64 JPEG, already downscaled by the app.
    public static func photos(_ jpegs: [Data], max: Int?) -> WidgetJSON {
        let limit = Swift.min(Swift.max(max ?? 1, 1), 3)
        return .object(["images": .array(jpegs.prefix(limit).map { .object(["mimeType": .string("image/jpeg"), "data": .string($0.base64EncodedString())]) })])
    }

    /// The longest side a picked photo keeps: enough to read a receipt.
    public static let photoMaxSide: Double = 1_280

    public static func scaledSize(width: Double, height: Double, maxSide: Double = photoMaxSide) -> (width: Double, height: Double) {
        let side = Swift.max(width, height)
        guard side > maxSide, side > 0 else { return (width, height) }
        let factor = maxSide / side
        return ((width * factor).rounded(), (height * factor).rounded())
    }

    /// A card read on this phone, for the computer's New card form: the
    /// number, the expiry and the name. There is no security code here:
    /// it is never read and never sent.
    public static func scannedCard(number: String, expMonth: Int?, expYear: Int?, holder: String?) -> WidgetJSON {
        var row: [String: WidgetJSON] = ["number": .string(number.filter { $0.isASCII && $0.isNumber })]
        if let expMonth, (1...12).contains(expMonth) { row["expMonth"] = .number(Double(expMonth)) }
        if let expYear, (2000...2100).contains(expYear) { row["expYear"] = .number(Double(expYear)) }
        if let holder, !holder.isEmpty { row["holder"] = .string(String(holder.prefix(80))) }
        return .object(row)
    }

    /// The last four digits, for the card that confirms what goes.
    public static func maskedNumber(_ number: String) -> String {
        let digits = number.filter { $0.isASCII && $0.isNumber }
        return "•••• " + String(digits.suffix(4))
    }

    /// shortcuts://run-shortcut for a name the person has, with text input.
    public static func shortcutURL(name: String, input: String?) -> URL? {
        var components = URLComponents()
        components.scheme = "shortcuts"
        components.host = "run-shortcut"
        var items = [URLQueryItem(name: "name", value: name)]
        if let input, !input.isEmpty {
            items.append(URLQueryItem(name: "input", value: "text"))
            items.append(URLQueryItem(name: "text", value: String(input.prefix(1_000))))
        }
        components.queryItems = items
        return components.url
    }

    /// An ISO 8601 date the bot sent (with or without fractions or a zone).
    public static func date(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        let full = ISO8601DateFormatter()
        full.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = full.date(from: value) { return date }
        let plain = ISO8601DateFormatter()
        if let date = plain.date(from: value) { return date }
        let day = ISO8601DateFormatter()
        day.formatOptions = [.withFullDate]
        return day.date(from: value)
    }

    public static func iso(_ date: Date) -> String {
        ISO8601DateFormatter().string(from: date)
    }

    private static func reminderRow(_ reminder: PhoneReminder) -> WidgetJSON {
        var row: [String: WidgetJSON] = ["title": .string(String(reminder.title.prefix(200)))]
        if let due = reminder.due { row["due"] = .string(iso(due)) }
        if let list = reminder.list { row["list"] = .string(String(list.prefix(200))) }
        return .object(row)
    }

    private static func eventRow(_ event: PhoneEvent) -> WidgetJSON {
        var row: [String: WidgetJSON] = [
            "title": .string(String(event.title.prefix(200))),
            "start": .string(iso(event.start)),
            "end": .string(iso(event.end)),
            "allDay": .bool(event.allDay),
        ]
        if let location = event.location, !location.isEmpty { row["location"] = .string(String(location.prefix(200))) }
        if let calendar = event.calendar { row["calendar"] = .string(String(calendar.prefix(200))) }
        return .object(row)
    }
}

public extension CompanionClient {
    /// What this phone can do now. Sent when the stream opens and while
    /// the app is open; the server offers a tool only while it is fresh.
    func registerPhoneTools(deviceName: String, tools: [PhoneTool], protectedTransport: Bool) async throws {
        try await send(makeRequest("POST", "/api/me/phone-tools/device", body: [
            "deviceName": String(deviceName.prefix(80)),
            "tools": tools.map(\.rawValue),
            "transport": PhoneToolRules.transport(protectedTransport: protectedTransport),
        ]))
    }

    func phoneToolRequests() async throws -> [PhoneToolRequest] {
        try await send(makeRequest("GET", "/api/me/phone-tools/requests"), as: PhoneToolRequests.self).requests
    }

    func answerPhoneTool(id: String, answer: PhoneToolAnswer) async throws {
        try await send(makeRequest("POST", "/api/me/phone-tools/requests/\(id)", encodedBody: answer))
    }

    func phoneToolGrants() async throws -> [PhoneToolGrant] {
        try await send(makeRequest("GET", "/api/me/phone-tools/grants"), as: PhoneToolGrants.self).grants
    }

    func revokePhoneToolGrant(botId: String, key: String) async throws {
        try await send(makeRequest("DELETE", "/api/me/phone-tools/grants", body: ["botId": botId, "key": key]))
    }
}

/// What a card shows besides its one-line summary (review of #960): every
/// field of a reminder or an event the bot wants to create, a shortcut's
/// whole input, and what the clipboard holds before it goes.
public enum PhoneToolDetails {
    public struct Field: Equatable, Sendable {
        public var key: String
        public var value: String
    }

    public static func fields(_ request: PhoneToolRequest) -> [Field] {
        let keys: [String]
        switch request.tool {
        case .reminders where request.action == "create": keys = ["title", "due", "list", "notes"]
        case .calendar where request.action == "create": keys = ["title", "start", "end", "location", "notes"]
        case .shortcut: keys = ["name", "input"]
        default: keys = []
        }
        return keys.compactMap { key in request.string(key).map { Field(key: key, value: $0) } }
    }

    /// A shortcut can send a message, pay or change things: the card says so.
    public static func warnsOfSideEffects(_ request: PhoneToolRequest) -> Bool {
        request.tool == .shortcut
    }

    /// The start of what the clipboard holds, read before the card shows.
    public static func clipboardPreview(_ text: String?) -> String? {
        guard let text, !text.isEmpty else { return nil }
        return text.count > 200 ? String(text.prefix(200)) + "…" : text
    }
}
