// The person's own preferences beyond the sidebar that the phone now reads
// and writes (shared/user-preferences.ts): language, the skin's colour
// variant, the bot colour as accent, HD mascots, the bot panel's Suggestions
// card, read receipts, the notification sound and the Automations page's
// scope. They travel in the same record as the sidebar values
// (`SidebarPrefs`, GET/PATCH /api/me/preferences, the `preferences` frame),
// so a change on the desktop reaches the phone within seconds and the other
// way round. Each reader below is the desktop module's own, value for value.
import Foundation

/// The keys, exactly as the desktop names them.
public enum PersonPrefKey {
    /// The app language: a locale code, "" for the system (src/lib/language-preference.ts).
    public static let language = "omb-language"
    public static let skinTint = DesktopAppearanceKeys.skinTint
    public static let skinDepth = DesktopAppearanceKeys.skinDepth
    /// "1": the open bot's colour is the accent (src/lib/bot-accent.ts).
    public static let botAccent = BotAccent.key
    /// "1": 1:1 assistant bubbles wear the bot's colour (BotBubble.swift).
    public static let botBubble = BotBubble.key
    /// "on" | "off"; absent is on (src/lib/hd-mascots-preference.ts).
    public static let hdMascots = HdMascots.preferenceKey
    /// "1" | "0"; absent is shown (src/lib/panel-visibility.ts).
    public static let showSuggestions = "sagax.showSuggestions.v1"
    /// "off" stops read receipts both ways; absent is on (server/messages/read-receipts.ts).
    public static let readReceipts = "sagax.readReceipts.v1"
    /// Which sound a notification plays (src/lib/notification-sound.ts).
    public static let notificationSound = NotificationSoundChoice.key
    /// The Automations page's scope and filters, per person (src/lib/routine-scope-prefs.ts).
    public static let routineScope = RoutineScopePrefs.key
    /// "on" | "off"; absent is on: a reply grows as it is written
    /// (src/lib/stream-replies-preference.ts).
    public static let streamReplies = "sagax.streamReplies.v1"

    public static let all = [language, skinTint, skinDepth, botAccent, botBubble, hdMascots, showSuggestions, readReceipts, notificationSound, routineScope, streamReplies]
}

public extension SidebarPrefKey {
    /// Every key the phone keeps in step with the person's record.
    static let synced = all + PersonPrefKey.all
}

// MARK: - Typed reads and edits

public extension SidebarPrefs {
    /// The stored language choice as the desktop wrote it; nil when never chosen.
    var languageCode: String? { values[PersonPrefKey.language] }

    mutating func setLanguageCode(_ code: String) {
        values[PersonPrefKey.language] = code
    }

    var skinTint: String? { values[PersonPrefKey.skinTint] }
    var skinDepth: SkinDepth { values[PersonPrefKey.skinDepth].flatMap(SkinDepth.init(rawValue:)) ?? .accent }

    /// `botAccentEnabled`: on only when "1".
    var botAccent: Bool { values[PersonPrefKey.botAccent] == "1" }

    /// `setBotAccentEnabled`: "1", or the key removed.
    mutating func setBotAccent(_ on: Bool) {
        values[PersonPrefKey.botAccent] = on ? "1" : nil
    }

    /// On only when "1". Absent leaves bubbles in the skin's colour.
    var botBubble: Bool { values[PersonPrefKey.botBubble] == "1" }

    mutating func setBotBubble(_ on: Bool) {
        values[PersonPrefKey.botBubble] = on ? "1" : nil
    }

    var hdMascots: Bool { HdMascots.enabled(values[PersonPrefKey.hdMascots]) }

    mutating func setHdMascots(_ on: Bool) {
        values[PersonPrefKey.hdMascots] = on ? "on" : "off"
    }

    /// Replies shown as they are written: on unless "off".
    var streamReplies: Bool { values[PersonPrefKey.streamReplies] != "off" }

    mutating func setStreamReplies(_ on: Bool) {
        values[PersonPrefKey.streamReplies] = on ? "on" : "off"
    }

    /// The Suggestions card: shown unless "0".
    var showSuggestions: Bool { values[PersonPrefKey.showSuggestions] != "0" }

    mutating func setShowSuggestions(_ on: Bool) {
        values[PersonPrefKey.showSuggestions] = on ? "1" : "0"
    }

    /// "Send read receipts": on unless "off".
    var readReceipts: Bool { values[PersonPrefKey.readReceipts] != "off" }

    /// On removes the key, off stores "off" (src/lib/read-receipt-preference.ts).
    mutating func setReadReceipts(_ on: Bool) {
        values[PersonPrefKey.readReceipts] = on ? nil : "off"
    }

    var notificationSound: NotificationSoundChoice { NotificationSoundChoice.parse(values[PersonPrefKey.notificationSound]) }

    mutating func setNotificationSound(_ choice: NotificationSoundChoice) {
        values[PersonPrefKey.notificationSound] = choice.rawValue
    }

    func routineScope(for principalId: String?) -> RoutineScopePrefs {
        RoutineScopePrefs.read(values[PersonPrefKey.routineScope], principalId: principalId)
    }

    mutating func setRoutineScope(_ prefs: RoutineScopePrefs, for principalId: String?) {
        values[PersonPrefKey.routineScope] = RoutineScopePrefs.write(prefs, principalId: principalId, over: values[PersonPrefKey.routineScope])
    }
}

// MARK: - Language

/// The phone's language choice against the desktop's `omb-language`.
public enum PersonLanguage {
    /// The phone's stored choice ("system", "en", "fr", "pt-BR") as the
    /// desktop stores it: "" for the system, lower-case codes ("pt-br").
    public static func stored(fromApp choice: String) -> String {
        choice == "system" || choice.isEmpty ? "" : choice.lowercased()
    }

    /// The phone's choice for a stored value, nil when the phone has no
    /// such language (the phone then keeps its own).
    public static func app(fromStored code: String, available: [String]) -> String? {
        let wanted = code.trimmingCharacters(in: .whitespaces).lowercased()
        if wanted.isEmpty { return "system" }
        if let exact = available.first(where: { $0.lowercased() == wanted }) { return exact }
        let base = wanted.split(separator: "-").first.map(String.init) ?? wanted
        return available.first { $0.lowercased().split(separator: "-").first.map(String.init) == base }
    }
}

// MARK: - Notification sound

/// Settings > Notifications > Notification sound (parity 2E): the platform's
/// own sound, or one of five short tones. On the phone the tones are bundled
/// files (`notify-<id>.caf`) drawn from the desktop's notes.
public enum NotificationSoundChoice: String, CaseIterable, Sendable {
    case system
    case tick
    case doubleTick = "double-tick"
    case chimeA = "chime-a"
    case chimeB = "chime-b"
    case blip

    public static let key = "sagax.notificationSound.v1"

    /// Anything unknown is the system sound.
    public static func parse(_ raw: String?) -> NotificationSoundChoice {
        raw.flatMap(NotificationSoundChoice.init(rawValue:)) ?? .system
    }

    /// The bundled file, nil for the system sound.
    public var fileName: String? { self == .system ? nil : "notify-\(rawValue).caf" }

    /// The desktop's label key (`settings.notificationSound.<id>`), in English.
    public var label: String {
        switch self {
        case .system: "System"
        case .tick: "Tick"
        case .doubleTick: "Double tick"
        case .chimeA: "Chime A"
        case .chimeB: "Chime B"
        case .blip: "Blip"
        }
    }
}

// MARK: - Automations scope

/// The Automations page's scope and filters, remembered per person
/// (src/lib/routine-scope-prefs.ts): one JSON object keyed by principal id
/// (lower case, "local" without one), the newest last, at most twenty.
public struct RoutineScopePrefs: Equatable, Sendable {
    public static let key = "sagax.routineScope.v1"
    static let maxPeople = 20

    public var scope: RoutineScope
    public var teamId: String?
    public var botId: String?
    public var ownerId: String?
    public var status: RoutineScopeStatus?

    public init(scope: RoutineScope = .mine, teamId: String? = nil, botId: String? = nil, ownerId: String? = nil, status: RoutineScopeStatus? = nil) {
        self.scope = scope
        self.teamId = teamId
        self.botId = botId
        self.ownerId = ownerId
        self.status = status
    }

    public init(query: RoutineScopeQuery, botId: String? = nil) {
        self.init(scope: query.scope, teamId: query.teamId, botId: botId, ownerId: query.ownerId, status: query.status)
    }

    /// The listing's query (the bot filter stays on the phone).
    public var query: RoutineScopeQuery {
        RoutineScopeQuery(scope: scope, teamId: teamId, ownerId: ownerId, status: status)
    }

    static func personKey(_ principalId: String?) -> String {
        let trimmed = principalId?.trimmingCharacters(in: .whitespaces).lowercased() ?? ""
        return trimmed.isEmpty ? "local" : trimmed
    }

    private static func validID(_ value: Any?) -> String? {
        guard let text = value as? String, (1...128).contains(text.count),
              text.range(of: #"^[\w.:@-]+$"#, options: .regularExpression) != nil else { return nil }
        return text
    }

    /// `cleanRoutineScopePrefs`: what this build understands, else Mine.
    static func clean(_ value: Any?) -> RoutineScopePrefs {
        guard let raw = value as? [String: Any] else { return RoutineScopePrefs() }
        return RoutineScopePrefs(
            scope: (raw["scope"] as? String).flatMap(RoutineScope.init(rawValue:)) ?? .mine,
            teamId: validID(raw["teamId"]), botId: validID(raw["botId"]), ownerId: validID(raw["ownerId"]),
            status: (raw["status"] as? String).flatMap(RoutineScopeStatus.init(rawValue:))
        )
    }

    private static func object(_ raw: String?) -> [String: Any] {
        guard let raw, let data = raw.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return parsed
    }

    /// `readRoutineScopePrefs`.
    public static func read(_ raw: String?, principalId: String?) -> RoutineScopePrefs {
        clean(object(raw)[personKey(principalId)])
    }

    private var json: [String: Any] {
        var out: [String: Any] = ["scope": scope.rawValue]
        if let teamId { out["teamId"] = teamId }
        if let botId { out["botId"] = botId }
        if let ownerId { out["ownerId"] = ownerId }
        if let status { out["status"] = status.rawValue }
        return out
    }

    /// `writeRoutineScopePrefs`: this person's choice last, the oldest
    /// people dropped past twenty. Key order is the JSON's own, so the
    /// stored text keeps the order the desktop reads as age.
    public static func write(_ prefs: RoutineScopePrefs, principalId: String?, over raw: String?) -> String {
        let key = personKey(principalId)
        var entries = orderedEntries(raw).filter { $0.key != key }
        entries.append((key, clean(prefs.json).json))
        entries = Array(entries.suffix(maxPeople))
        let parts = entries.compactMap { entry -> String? in
            guard let keyData = try? JSONSerialization.data(withJSONObject: entry.key, options: [.fragmentsAllowed]),
                  let valueData = try? JSONSerialization.data(withJSONObject: entry.value, options: [.sortedKeys]) else { return nil }
            return String(decoding: keyData, as: UTF8.self) + ":" + String(decoding: valueData, as: UTF8.self)
        }
        return "{" + parts.joined(separator: ",") + "}"
    }

    /// The stored people in their stored order (JSONSerialization forgets it).
    private static func orderedEntries(_ raw: String?) -> [(key: String, value: Any)] {
        let parsed = object(raw)
        guard !parsed.isEmpty, let raw else { return [] }
        var found: [(Int, String)] = []
        for key in parsed.keys {
            guard let keyData = try? JSONSerialization.data(withJSONObject: key, options: [.fragmentsAllowed]) else { continue }
            let quoted = String(decoding: keyData, as: UTF8.self) + ":"
            let position = raw.range(of: quoted).map { raw.distance(from: raw.startIndex, to: $0.lowerBound) } ?? Int.max
            found.append((position, key))
        }
        return found.sorted { $0.0 < $1.0 }.map { (key: $0.1, value: parsed[$0.1] as Any) }
    }
}
