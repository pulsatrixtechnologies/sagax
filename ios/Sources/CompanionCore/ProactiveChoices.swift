import Foundation

// #3465 (lot 8 of #3408): the person's proactive choices on the phone and
// the tablet, read and written in the same store as the desktop
// (`shared/proactive-choices.ts`, `GET` and `PUT /api/me/proactive`).
//
// Settings, Notifications, « Ce que je reçois » and a bot's « Ce que ce bot
// suit pour toi » draw the rows `ProactiveReceiveRules.domainRows` builds,
// the same rows as the desktop's `ProactiveReceiveSettings.tsx`: a domain
// is drawn only when one of the person's bots can carry it, a watch only
// when it runs on that bot. Absent means off: nothing here is on by default.
// Labels only on screen: a domain, a watch or a bot is named, never shown
// by its identifier.

/// `{ fr?, en? }`: the organization's own label for a domain.
public struct ProactiveLocalizedText: Codable, Hashable, Sendable {
    public var fr: String?
    public var en: String?

    public init(fr: String? = nil, en: String? = nil) {
        self.fr = fr
        self.en = en
    }

    /// The label in the interface's language, else the other one.
    public func text(french: Bool) -> String? {
        let first = french ? fr : en
        let second = french ? en : fr
        return [first, second].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.first { !$0.isEmpty }
    }
}

/// One watch of an eligible domain (`ReceiveWatch`).
public struct ProactiveReceiveWatch: Codable, Hashable, Sendable {
    public var id: String
    public var summary: String
    public var cadence: String
    public var runsOn: [String]
    public var lastAlertAt: Double?

    public init(id: String, summary: String, cadence: String, runsOn: [String], lastAlertAt: Double? = nil) {
        self.id = id
        self.summary = summary
        self.cadence = cadence
        self.runsOn = runsOn
        self.lastAlertAt = lastAlertAt
    }

    private enum CodingKeys: String, CodingKey { case id, summary, cadence, runsOn, lastAlertAt }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        summary = (try? container.decodeIfPresent(String.self, forKey: .summary)) ?? ""
        cadence = (try? container.decodeIfPresent(String.self, forKey: .cadence)) ?? ""
        runsOn = (try? container.decodeIfPresent([String].self, forKey: .runsOn)) ?? []
        lastAlertAt = try? container.decodeIfPresent(Double.self, forKey: .lastAlertAt)
    }
}

/// One domain the person can choose (`ReceiveDomain`).
public struct ProactiveReceiveDomain: Codable, Hashable, Sendable {
    public var domain: String
    public var label: ProactiveLocalizedText
    public var audience: ProactiveLocalizedText?
    public var carriers: [String]
    public var watches: [ProactiveReceiveWatch]
    public var lastAlertAt: Double?

    public init(domain: String, label: ProactiveLocalizedText, audience: ProactiveLocalizedText? = nil, carriers: [String],
                watches: [ProactiveReceiveWatch], lastAlertAt: Double? = nil) {
        self.domain = domain
        self.label = label
        self.audience = audience
        self.carriers = carriers
        self.watches = watches
        self.lastAlertAt = lastAlertAt
    }

    private enum CodingKeys: String, CodingKey { case domain, label, audience, carriers, watches, lastAlertAt }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        domain = try container.decode(String.self, forKey: .domain)
        label = (try? container.decodeIfPresent(ProactiveLocalizedText.self, forKey: .label)) ?? ProactiveLocalizedText()
        audience = try? container.decodeIfPresent(ProactiveLocalizedText.self, forKey: .audience)
        carriers = (try? container.decodeIfPresent([String].self, forKey: .carriers)) ?? []
        watches = (try? container.decodeIfPresent([Lossy<ProactiveReceiveWatch>].self, forKey: .watches))?.compactMap(\.value) ?? []
        lastAlertAt = try? container.decodeIfPresent(Double.self, forKey: .lastAlertAt)
    }
}

/// One bot of the person and the ambient rows it can draw (`ReceiveBot`):
/// an absent field is a row that cannot work there.
public struct ProactiveReceiveBot: Codable, Hashable, Sendable {
    public var id: String
    public var brief: Bool
    public var screen: Bool?
    public var checklist: Bool?

    public init(id: String, brief: Bool, screen: Bool? = nil, checklist: Bool? = nil) {
        self.id = id
        self.brief = brief
        self.screen = screen
        self.checklist = checklist
    }

    private enum CodingKeys: String, CodingKey { case id, brief, screen, checklist }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        brief = (try? container.decodeIfPresent(Bool.self, forKey: .brief)) ?? false
        screen = try? container.decodeIfPresent(Bool.self, forKey: .screen)
        checklist = try? container.decodeIfPresent(Bool.self, forKey: .checklist)
    }
}

/// `receive` of `GET /api/me/proactive?view=all` (`ReceiveView`).
public struct ProactiveReceiveView: Codable, Hashable, Sendable {
    public var bots: [ProactiveReceiveBot]
    public var domains: [ProactiveReceiveDomain]
    public var unavailable: String?

    public init(bots: [ProactiveReceiveBot], domains: [ProactiveReceiveDomain], unavailable: String? = nil) {
        self.bots = bots
        self.domains = domains
        self.unavailable = unavailable
    }

    private enum CodingKeys: String, CodingKey { case bots, domains, unavailable }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        bots = (try? container.decodeIfPresent([Lossy<ProactiveReceiveBot>].self, forKey: .bots))?.compactMap(\.value) ?? []
        domains = (try? container.decodeIfPresent([Lossy<ProactiveReceiveDomain>].self, forKey: .domains))?.compactMap(\.value) ?? []
        unavailable = try? container.decodeIfPresent(String.self, forKey: .unavailable)
    }
}

/// A watch the person switched off (`WatchOff`).
public struct ProactiveWatchOff: Codable, Hashable, Sendable {
    public var at: Double
    public var via: String

    public init(at: Double, via: String) {
        self.at = at
        self.via = via
    }
}

/// Where one domain stands for the person (`DomainChoice`).
public struct ProactiveDomainChoice: Codable, Hashable, Sendable {
    public enum State: String, Codable, Hashable, Sendable {
        case on, off, never
    }

    public var state: State
    /// The one bot of the person that carries this domain (state on).
    public var botId: String?
    public var watchesOff: [String: ProactiveWatchOff]?
    public var coversReads: Bool?
    public var at: Double
    public var via: String
    public var by: String

    public init(state: State, botId: String? = nil, watchesOff: [String: ProactiveWatchOff]? = nil, coversReads: Bool? = nil,
                at: Double, via: String, by: String) {
        self.state = state
        self.botId = botId
        self.watchesOff = watchesOff
        self.coversReads = coversReads
        self.at = at
        self.via = via
        self.by = by
    }

    private enum CodingKeys: String, CodingKey { case state, botId, watchesOff, coversReads, at, via, by }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        state = try container.decode(State.self, forKey: .state)
        botId = try? container.decodeIfPresent(String.self, forKey: .botId)
        watchesOff = (try? container.decodeIfPresent(LossyMap<ProactiveWatchOff>.self, forKey: .watchesOff))?.items
        coversReads = try? container.decodeIfPresent(Bool.self, forKey: .coversReads)
        at = (try? container.decodeIfPresent(Double.self, forKey: .at)) ?? 0
        via = (try? container.decodeIfPresent(String.self, forKey: .via)) ?? "settings"
        by = (try? container.decodeIfPresent(String.self, forKey: .by)) ?? ""
    }
}

/// The answer of `GET` (and the `domains` of `PUT`) `/api/me/proactive`.
public struct ProactiveChoicesAnswer: Decodable, Hashable, Sendable {
    public var domains: [String: ProactiveDomainChoice]
    /// Absent on an older server: nothing to draw.
    public var receive: ProactiveReceiveView?

    private enum CodingKeys: String, CodingKey { case domains, receive }

    public init(domains: [String: ProactiveDomainChoice], receive: ProactiveReceiveView? = nil) {
        self.domains = domains
        self.receive = receive
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        domains = (try? container.decodeIfPresent(LossyMap<ProactiveDomainChoice>.self, forKey: .domains))?.items ?? [:]
        receive = try? container.decodeIfPresent(ProactiveReceiveView.self, forKey: .receive)
    }
}

/// What the person's pages draw: their choices and the server's listing.
public struct ProactiveReceiveState: Hashable, Sendable {
    public var choices: [String: ProactiveDomainChoice]
    public var receive: ProactiveReceiveView

    public init(choices: [String: ProactiveDomainChoice], receive: ProactiveReceiveView) {
        self.choices = choices
        self.receive = receive
    }

    /// The state an answer draws, or nil when the server has no `receive`.
    public init?(_ answer: ProactiveChoicesAnswer) {
        guard let receive = answer.receive else { return nil }
        self.init(choices: answer.domains, receive: receive)
    }
}

/// One domain as a page draws it (`DomainRowModel` of the desktop).
public struct ProactiveDomainRow: Hashable, Sendable, Identifiable {
    public struct Watch: Hashable, Sendable, Identifiable {
        public var id: String
        public var summary: String
        public var cadence: String
        public var on: Bool
        public var lastAlertAt: Double?
    }

    public var id: String { domain }
    public var domain: String
    public var label: String
    public var on: Bool
    /// « Ne plus proposer »: still turned on from here.
    public var never: Bool
    /// The bot that carries it when on; the one a yes from here goes to when off.
    public var botId: String
    public var carriers: [String]
    /// Stored on with a bot that can no longer carry it ("" when that bot
    /// is not known): drawn off with the pause stated.
    public var pausedOn: String?
    public var watches: [Watch]
    public var lastAlertAt: Double?
}

public enum ProactiveReceiveRules {
    /// The query of the GET that adds `receive` (`PROACTIVE_RECEIVE_VIEW`).
    public static let path = "/api/me/proactive"
    public static let view = "all"

    /// The rows of the person's domains, as the desktop's `domainRows`.
    /// With `botId` (the bot page), only the domains that bot can carry,
    /// each on when that bot carries it; a yes from there moves it there.
    public static func domainRows(_ state: ProactiveReceiveState, botId: String? = nil, french: Bool) -> [ProactiveDomainRow] {
        state.receive.domains.compactMap { row in
            if let botId, !row.carriers.contains(botId) { return nil }
            let choice = state.choices[row.domain]
            let stored: String? = {
                guard choice?.state == .on, let carrier = choice?.botId, row.carriers.contains(carrier) else { return nil }
                return carrier
            }()
            guard let carrier = botId ?? stored ?? row.carriers.first else { return nil }
            let on = stored != nil && (botId.map { stored == $0 } ?? true)
            let pausedOn: String? = choice?.state == .on && stored == nil ? (choice?.botId ?? "") : nil
            let watches = row.watches
                .filter { $0.runsOn.contains(carrier) }
                .map { watch in
                    ProactiveDomainRow.Watch(
                        id: watch.id, summary: watch.summary, cadence: watch.cadence,
                        on: choice?.watchesOff?[watch.id] == nil, lastAlertAt: watch.lastAlertAt
                    )
                }
            guard !watches.isEmpty else { return nil }
            return ProactiveDomainRow(
                domain: row.domain, label: row.label.text(french: french) ?? row.domain, on: on, never: choice?.state == .never,
                botId: carrier, carriers: row.carriers, pausedOn: pausedOn, watches: watches, lastAlertAt: row.lastAlertAt
            )
        }
    }

    /// The bot that carries the domain elsewhere, for the bot page's note:
    /// only a bot that can still carry it (a paused one is the row's own).
    public static func carriedElsewhere(_ state: ProactiveReceiveState, row: ProactiveDomainRow, botId: String) -> String? {
        guard let choice = state.choices[row.domain], choice.state == .on, let elsewhere = choice.botId,
              elsewhere != botId, row.carriers.contains(elsewhere) else { return nil }
        return elsewhere
    }

    /// The domain switched on (with its carrier) or off, drawn before the
    /// server answers; the answer then wins.
    public static func settingDomain(_ state: ProactiveReceiveState, row: ProactiveDomainRow, on: Bool, botId: String? = nil,
                                     now: Double = Date().timeIntervalSince1970 * 1000) -> ProactiveReceiveState {
        var next = state
        var choice = state.choices[row.domain] ?? ProactiveDomainChoice(state: .off, at: now, via: "settings", by: "")
        choice.state = on ? .on : .off
        choice.botId = on ? (botId ?? row.botId) : nil
        next.choices[row.domain] = choice
        return next
    }

    /// One watch switched, drawn before the server answers.
    public static func settingWatch(_ state: ProactiveReceiveState, domain: String, watch: String, on: Bool,
                                    now: Double = Date().timeIntervalSince1970 * 1000) -> ProactiveReceiveState {
        var next = state
        var choice = state.choices[domain] ?? ProactiveDomainChoice(state: .off, at: now, via: "settings", by: "")
        var off = choice.watchesOff ?? [:]
        if on { off[watch] = nil } else { off[watch] = ProactiveWatchOff(at: now, via: "settings") }
        choice.watchesOff = off.isEmpty ? nil : off
        next.choices[domain] = choice
        return next
    }

    /// A bot's ambient row switched (brief, screen, checklist).
    public static func settingBot(_ state: ProactiveReceiveState, botId: String, brief: Bool? = nil, screen: Bool? = nil,
                                  checklist: Bool? = nil) -> ProactiveReceiveState {
        var next = state
        next.receive.bots = state.receive.bots.map { bot in
            guard bot.id == botId else { return bot }
            var changed = bot
            if let brief { changed.brief = brief }
            if let screen { changed.screen = screen }
            if let checklist { changed.checklist = checklist }
            return changed
        }
        return next
    }

    /// "Every 15 min", "Every day at 08:00", "Every Sunday at 08:00"; nil
    /// for a cadence this app does not read (never the raw value).
    public static func cadenceText(_ cadence: String, locale: Locale = .current) -> String? {
        let raw = cadence.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let match = groups(raw, #"^(\d{1,4})(m|h)$"#) {
            let count = Int(match[0]) ?? 0
            let hours = match[1] == "h" ? count : (count % 60 == 0 ? count / 60 : 0)
            if hours == 1 { return String(localized: "Every hour") }
            if hours > 1 { return String(localized: "Every \(hours) hours") }
            return String(localized: "Every \(count) min")
        }
        if let match = groups(raw, #"^daily@(\d{1,2}):(\d{2})$"#) {
            return String(localized: "Every day at \(pad(match[0])):\(match[1])")
        }
        if let match = groups(raw, #"^weekly:([a-z]{3})@(\d{1,2}):(\d{2})$"#),
           let index = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].firstIndex(of: match[0]) {
            var calendar = Calendar(identifier: .gregorian)
            calendar.locale = locale
            let day = calendar.standaloneWeekdaySymbols[index]
            let shown = locale.identifier.lowercased().hasPrefix("fr") ? day.lowercased() : day
            return String(localized: "Every \(shown) at \(pad(match[1])):\(match[2])")
        }
        return nil
    }

    private static func groups(_ text: String, _ pattern: String) -> [String]? {
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
        return (1..<match.numberOfRanges).map { index in
            Range(match.range(at: index), in: text).map { String(text[$0]) } ?? ""
        }
    }

    private static func pad(_ hour: String) -> String { hour.count == 1 ? "0\(hour)" : hour }
}

/// #3465: the two exits on every alert of a chosen watch, under its run
/// card (the desktop's `WatchAlertExits.tsx`, #3457): « Arrêter cette
/// veille » switches off the watches the alert reported, « Arrêter ce
/// domaine » turns their domain off. Both act at once, with no
/// confirmation, through `PUT /api/me/proactive` (via "alert"), so the
/// watch loop stops reading too. One quiet line then says what stopped.
public enum WatchAlertExit: String, Hashable, Sendable {
    case watch, domain
}

/// One body of `PUT /api/me/proactive` (`ChoiceChange`).
public struct ProactiveChoiceChange: Hashable, Sendable {
    public var domain: String
    public var watch: String?
    public var on: Bool?
    public var state: ProactiveDomainChoice.State?
    public var via: String

    public init(domain: String, watch: String? = nil, on: Bool? = nil, state: ProactiveDomainChoice.State? = nil, via: String) {
        self.domain = domain
        self.watch = watch
        self.on = on
        self.state = state
        self.via = via
    }

    var body: [String: Any] {
        var body: [String: Any] = ["domain": domain, "via": via]
        if let watch { body["watch"] = watch }
        if let on { body["on"] = on }
        if let state { body["state"] = state.rawValue }
        return body
    }
}

public enum WatchAlertRules {
    /// The watches an alert run reported, when it is a watch alert.
    public static func alert(of run: RoutineRunCard?) -> [RoutineRunCard.WatchRef]? {
        guard let run, run.wakeTopic == "watch", !run.watches.isEmpty else { return nil }
        return run.watches
    }

    /// The bodies one exit sends: each reported watch off, or each of
    /// their domains off (once).
    public static func changes(_ watches: [RoutineRunCard.WatchRef], exit: WatchAlertExit) -> [ProactiveChoiceChange] {
        switch exit {
        case .watch:
            return watches.map { ProactiveChoiceChange(domain: $0.domain, watch: $0.id, on: false, via: "alert") }
        case .domain:
            var seen: [String] = []
            for watch in watches where !seen.contains(watch.domain) { seen.append(watch.domain) }
            return seen.map { ProactiveChoiceChange(domain: $0, state: .off, via: "alert") }
        }
    }

    /// What stopped, in words: the watches' own lines or the domains'
    /// labels from the person's listing; nil when the listing does not
    /// name each of them (never an id).
    public static func stoppedLabel(_ watches: [RoutineRunCard.WatchRef], exit: WatchAlertExit,
                                    listed: [ProactiveReceiveDomain], french: Bool) -> String? {
        let named: [String?]
        switch exit {
        case .watch:
            named = watches.map { watch in
                listed.first { $0.domain == watch.domain }?.watches.first { $0.id == watch.id }?.summary
                    .trimmingCharacters(in: .whitespacesAndNewlines).nonEmptyValue
            }
        case .domain:
            var seen: [String] = []
            for watch in watches where !seen.contains(watch.domain) { seen.append(watch.domain) }
            named = seen.map { domain in listed.first { $0.domain == domain }?.label.text(french: french) }
        }
        guard !named.isEmpty, named.allSatisfy({ $0 != nil }) else { return nil }
        var unique: [String] = []
        for name in named.compactMap({ $0 }) where !unique.contains(name) { unique.append(name) }
        return unique.joined(separator: ", ")
    }

    /// The quiet line under the card once an exit acted.
    public static func stoppedLine(_ exit: WatchAlertExit, label: String?) -> String {
        switch (exit, label) {
        case let (.watch, label?):
            return String(localized: "Watch stopped: \(label). You can turn it back on in Settings, Notifications.")
        case (.watch, nil):
            return String(localized: "This watch is stopped. You can turn it back on in Settings, Notifications.")
        case let (.domain, label?):
            return String(localized: "Domain stopped: \(label). None of its alerts will come. You can turn it back on in Settings, Notifications.")
        case (.domain, nil):
            return String(localized: "This domain is stopped. None of its alerts will come. You can turn it back on in Settings, Notifications.")
        }
    }
}

private extension String {
    var nonEmptyValue: String? { isEmpty ? nil : self }
}

/// A map that keeps the entries it can read and drops the others.
struct LossyMap<Value: Decodable>: Decodable {
    var items: [String: Value]

    private struct Key: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: Key.self)
        var items: [String: Value] = [:]
        for key in container.allKeys {
            if let value = try? container.decode(Value.self, forKey: key) { items[key.stringValue] = value }
        }
        self.items = items
    }
}

public extension CompanionClient {
    /// `GET /api/me/proactive?view=all`: the person's choices and what their
    /// pages draw.
    func proactiveReceive() async throws -> ProactiveChoicesAnswer {
        try await send(
            makeRequest("GET", ProactiveReceiveRules.path, query: [URLQueryItem(name: "view", value: ProactiveReceiveRules.view)]),
            as: ProactiveChoicesAnswer.self
        )
    }

    /// One change of the person's choices (`PUT /api/me/proactive`): the
    /// alert's exits send theirs with `via: "alert"`.
    @discardableResult
    func setProactiveChoice(_ change: ProactiveChoiceChange) async throws -> [String: ProactiveDomainChoice] {
        try await send(makeRequest("PUT", ProactiveReceiveRules.path, body: change.body), as: ProactiveChoicesAnswer.self).domains
    }

    /// `PUT { domain, state: on|off, botId? }` from the settings.
    @discardableResult
    func setProactiveDomain(_ domain: String, on: Bool, botId: String? = nil) async throws -> [String: ProactiveDomainChoice] {
        var body: [String: Any] = ["domain": domain, "state": on ? "on" : "off", "via": "settings"]
        if on, let botId { body["botId"] = botId }
        return try await send(makeRequest("PUT", ProactiveReceiveRules.path, body: body), as: ProactiveChoicesAnswer.self).domains
    }

    /// `PUT { domain, watch, on }` from the settings.
    @discardableResult
    func setProactiveWatch(domain: String, watch: String, on: Bool) async throws -> [String: ProactiveDomainChoice] {
        let body: [String: Any] = ["domain": domain, "watch": watch, "on": on, "via": "settings"]
        return try await send(makeRequest("PUT", ProactiveReceiveRules.path, body: body), as: ProactiveChoicesAnswer.self).domains
    }

    /// A bot's ambient rows (`PUT /api/bots/:id/background-brief`): the
    /// brief and the screen context with the phone's time zone; the
    /// checklist alone, as the desktop (no vote, no memory line).
    func setProactiveBotRow(botId: String, brief: Bool? = nil, screen: Bool? = nil, checklist: Bool? = nil,
                            timeZone: String = TimeZone.current.identifier) async throws {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        var body: [String: Any] = [:]
        if let checklist {
            body["checklist"] = checklist
        } else {
            if let brief { body["enabled"] = brief }
            if let screen { body["screenContext"] = screen }
            body["timeZone"] = timeZone
        }
        try await send(makeRequest("PUT", "/api/bots/\(botId)/background-brief", body: body))
    }
}
