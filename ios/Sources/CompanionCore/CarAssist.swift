// Sagax in the car (docs/ios-carplay.md): Siri reaches a bot by its name
// (a call or a message), a CallKit call carries the bot in its handle, and
// the CarPlay screen lists the recent bots and shows the call's state.
// Everything here is the decision, not the drawing: the app wires it to
// Intents, CallKit and CarPlay (App/CarAssist), and `swift test` covers it.
//
// Apple's CarPlay rules this follows (CarPlay Developer Guide, October 2026):
// never show a message's content on the car's screen, never ask the person
// to pick up the iPhone, voice first, short answers.
import Foundation

/// A bot or a channel Siri or the car can reach: its id, its name, the
/// thread a message lands in, when it last spoke. Never a message's
/// content, which the car's screen must not show.
public struct CarContact: Equatable, Sendable, Identifiable {
    public enum Kind: String, Sendable { case bot, room }
    public let kind: Kind
    public let id: String
    public let name: String
    public let threadId: String
    /// Seconds since 1970, the newest message or the creation.
    public let latestActivity: Double

    public init(kind: Kind, id: String, name: String, threadId: String, latestActivity: Double) {
        self.kind = kind
        self.id = id
        self.name = name
        self.threadId = threadId
        self.latestActivity = latestActivity
    }

    /// Where a message to this contact goes (Chat.destination's two cases).
    public var destination: MessageDestination {
        switch kind {
        case .bot: .bot(id: id, threadId: threadId)
        case .room: .room(id: id, threadId: threadId)
        }
    }
}

/// Who Siri found for the name it heard.
public enum CarMatch: Equatable, Sendable {
    case one(CarContact)
    /// Several bots answer to that name: Siri asks which one.
    case several([CarContact])
    case none
}

public enum CarDirectory {
    /// The car's list: a short one the driver can take in at a glance, the
    /// bots used last. CarPlay may show fewer (`CPListTemplate.maximumItemCount`).
    public static let carLimit = 12

    /// Every bot and channel the person can reach, the most recent first.
    /// A hidden bot and a conversation with a person are left out: Siri
    /// talks to bots and channels here, not to colleagues.
    public static func contacts(bots: [Bot], rooms: [Room] = []) -> [CarContact] {
        let botRows = bots.filter { $0.hidden != true }.map { bot in
            CarContact(
                kind: .bot, id: bot.id, name: bot.name,
                // the bot's one conversation (SingleStream), as the share sheet does
                threadId: SingleStream.home(of: bot) ?? bot.threadId,
                latestActivity: bot.messages?.map(\.at).max() ?? bot.createdAt
            )
        }
        let roomRows = rooms.filter { $0.peopleDm != true && $0.dm != true }.map { room in
            CarContact(
                kind: .room, id: room.id, name: room.name, threadId: room.threadId,
                latestActivity: room.messages?.map(\.at).max() ?? room.createdAt
            )
        }
        return (botRows + roomRows).sorted {
            $0.latestActivity == $1.latestActivity
                ? $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
                : $0.latestActivity > $1.latestActivity
        }
    }

    /// The car's list: bots only (a call is with one bot), most recent first.
    public static func recentBots(_ contacts: [CarContact], limit: Int = carLimit) -> [CarContact] {
        Array(contacts.filter { $0.kind == .bot }.prefix(max(0, limit)))
    }

    /// The bot or channel for a name Siri heard. Same name exactly first,
    /// then a name that starts with what was said, then one that contains
    /// it. Case, accents, punctuation and a leading article do not count
    /// ("appelle l'Éclaireur" finds "Éclaireur").
    public static func resolve(_ spoken: String, in contacts: [CarContact]) -> CarMatch {
        let heard = normalized(spoken)
        guard !heard.isEmpty else { return .none }
        let keyed = contacts.map { (contact: $0, key: normalized($0.name)) }
        let tiers: [(String) -> Bool] = [
            { $0 == heard },
            { $0.hasPrefix(heard) || $0.split(separator: " ").contains { $0.hasPrefix(heard) } },
            { $0.contains(heard) || heard.contains($0) && !$0.isEmpty },
        ]
        for tier in tiers {
            let found = keyed.filter { tier($0.key) }.map(\.contact)
            if found.count == 1 { return .one(found[0]) }
            if found.count > 1 { return .several(found) }
        }
        return .none
    }

    /// The contact a Siri request names. A reply to an announced message
    /// carries the conversation (the thread the banner donated) and the
    /// sender's id; a new message carries only the name that was said.
    public static func route(
        conversationId: String?,
        personIds: [String],
        spokenNames: [String],
        in contacts: [CarContact]
    ) -> CarMatch {
        if let conversationId, !conversationId.isEmpty,
           let found = contacts.first(where: { $0.threadId == conversationId || $0.id == conversationId }) {
            return .one(found)
        }
        for id in personIds where !id.isEmpty {
            if let botId = CarCallHandle.contactId(from: id), let found = contacts.first(where: { $0.id == botId }) {
                return .one(found)
            }
            if let found = contacts.first(where: { $0.id == id }) { return .one(found) }
        }
        let names = spokenNames.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        guard let first = names.first else { return .none }
        // one bot at a time: a message to two names is the first one's
        return resolve(first, in: contacts)
    }

    /// Lowercased, without accents or punctuation, without a leading
    /// article or "bot".
    public static func normalized(_ name: String) -> String {
        let folded = name.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        let spaced = folded.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) ? Character($0) : " " }
        var words = String(spaced).split(separator: " ").map(String.init)
        let leading: Set<String> = ["le", "la", "les", "l", "the", "a", "an", "mon", "ma", "my", "bot", "robot", "agent"]
        while words.count > 1, let first = words.first, leading.contains(first) { words.removeFirst() }
        return words.joined(separator: " ")
    }
}

/// The CallKit handle of a call with a bot: the system hands it back when
/// the person calls again from the car, Siri or the call screen, so it names
/// the bot by id. The caller name stays the bot's name.
public enum CarCallHandle {
    public static let botPrefix = "sagax-bot:"
    public static let roomPrefix = "sagax-room:"

    public static func value(kind: CarContact.Kind, id: String) -> String {
        (kind == .bot ? botPrefix : roomPrefix) + id
    }

    /// The bot or channel id in a handle this app made; nil for anything else.
    public static func contactId(from value: String?) -> String? {
        guard let value else { return nil }
        for prefix in [botPrefix, roomPrefix] where value.hasPrefix(prefix) {
            let id = String(value.dropFirst(prefix.count))
            return id.isEmpty ? nil : id
        }
        return nil
    }
}

/// One ask waiting for the person, as the car's "To answer" list shows it:
/// the bot, the card's title, never the command's text on the screen.
public struct CarApproval: Equatable, Sendable, Identifiable {
    public let requestId: String
    public let threadId: String
    public let botId: String
    public let botName: String
    /// The card's title, short enough for a list row.
    public let title: String
    /// The command or detail, for the spoken ask only (DrivingSafety cuts it).
    public let detail: String
    public let at: Double
    public var id: String { requestId }
}

public enum CarApprovals {
    /// How many asks the list shows (a glance, CarPlay allows more).
    public static let limit = 8
    public static let titleLimit = 40

    /// The open tool approvals, newest first, that can be judged by ear: a
    /// learned skill (a document), a question and a phone-call consent wait
    /// for the phone (DrivingSafety), and an ask only an admin answers is
    /// not the person's.
    public static func items(in state: CompanionState) -> [CarApproval] {
        var out: [CarApproval] = []
        for entry in state.pendingApprovals {
            let card = entry.message.card
            guard let card, let requestId = card.requestId, card.tool != nil, card.skillRequest == nil,
                  card.questionRequest == nil, card.phoneCallConsent == nil, card.adminApproval != true,
                  entry.message.ownerWait == nil
            else { continue }
            let name: String
            let ownerId: String
            switch state.chat(forThread: entry.threadId) {
            case let .bot(bot)?: (name, ownerId) = (bot.name, bot.id)
            case let .room(room)?: (name, ownerId) = (room.name, room.id)
            case nil: continue
            }
            out.append(CarApproval(
                requestId: requestId, threadId: entry.threadId, botId: ownerId, botName: name,
                title: clipped(card.title), detail: card.subtitle, at: entry.message.at
            ))
            if out.count == limit { break }
        }
        return out
    }

    static func clipped(_ title: String) -> String {
        let text = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count > titleLimit else { return text }
        let cut = String(text.prefix(titleLimit))
        if let space = cut.lastIndex(of: " ") { return String(cut[..<space]) + "…" }
        return cut + "…"
    }
}

extension CarDirectory {
    /// The Bots tab: every bot by name, so the driver finds one by place.
    public static func alphabeticalBots(_ contacts: [CarContact], limit: Int = carLimit) -> [CarContact] {
        let bots = contacts.filter { $0.kind == .bot }.sorted {
            $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
        return Array(bots.prefix(max(0, limit)))
    }
}

/// What a call does differently while the phone is in the car (CarPlay or a
/// car's audio): an approval is answered by voice, or waits for the phone;
/// nothing tells the person to look at the screen.
public enum DrivingSafety {
    public enum Approval: Equatable, Sendable {
        /// asked aloud, answered aloud (allow once, deny, yes, no)
        case byVoice
        /// too much to judge by ear: it waits, the person can still say no
        case waitsForPhone
    }

    /// A learned skill is a document to read before it is enabled: it
    /// waits. A command, a routine or a profile is asked aloud, short.
    public static func approval(_ kind: CallPrompt.ApprovalKind) -> Approval {
        switch kind {
        case .skill: .waitsForPhone
        case .command, .routine, .profile: .byVoice
        }
    }

    /// How much of a command is read aloud.
    public static let spokenDetailLimit = 160
    public static let drivingSpokenDetailLimit = 80

    /// The command's detail as the call says it: shorter in the car, cut at
    /// a word.
    public static func spokenDetail(_ detail: String, driving: Bool) -> String {
        let text = detail.trimmingCharacters(in: .whitespacesAndNewlines)
        let limit = driving ? drivingSpokenDetailLimit : spokenDetailLimit
        guard text.count > limit else { return text }
        let cut = String(text.prefix(limit))
        guard driving, let space = cut.lastIndex(of: " ") else { return cut }
        return String(cut[..<space])
    }
}

/// The CarPlay voice screen's state for a call's state. The template takes
/// at most five states; these are the five.
public enum CarVoiceState: String, CaseIterable, Sendable {
    case connecting, listening, thinking, speaking, paused

    /// Nil once the call has ended (the screen goes back to the list).
    public init?(_ state: CallState) {
        if state.phase == .ended { return nil }
        if state.muted || state.phase == .held { self = .paused; return }
        switch state.phase {
        case .connecting: self = .connecting
        case .listening, .hearing, .interrupted: self = .listening
        case .thinking: self = .thinking
        case .speaking: self = .speaking
        case .held, .ended: self = .paused
        }
    }
}
