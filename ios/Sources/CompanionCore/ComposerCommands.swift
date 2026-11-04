// The composer's "/" menu (feature parity matrix CO9, CO10, CO24): Sagax's
// own commands and the engine's (Claude Code, Codex), as the desktop builds
// them. Ported from shared/harness-commands.ts and src/lib/composer-commands.ts;
// the engine list comes from GET /api/bots/:id/harness-commands
// (src/lib/harness-commands.ts).
import Foundation

// MARK: - The engine's commands

/// `HarnessCommandGroup`: where a command is listed.
public enum HarnessCommandGroup: String, Codable, Hashable, Sendable {
    case engine, plugins, mcp
}

/// `HarnessCommandUnavailable`: why a listed command cannot run from the chat.
public enum HarnessCommandUnavailable: String, Codable, Hashable, Sendable {
    /// Needs the engine's own terminal UI.
    case interactive
    /// Sagax manages it (model, effort, sessions, approvals, MCP).
    case managed
}

/// One engine command (`HarnessCommand` in shared/harness-commands.ts).
public struct HarnessCommand: Codable, Hashable, Sendable {
    /// The engine's own name, without the slash.
    public var name: String
    public var description: String
    public var argumentHint: String?
    public var aliases: [String]?
    public var group: HarnessCommandGroup
    public var unavailable: HarnessCommandUnavailable?
    /// Codex: the skill file the turn hands to the engine.
    public var path: String?

    public init(
        name: String,
        description: String = "",
        argumentHint: String? = nil,
        aliases: [String]? = nil,
        group: HarnessCommandGroup = .engine,
        unavailable: HarnessCommandUnavailable? = nil,
        path: String? = nil
    ) {
        self.name = name
        self.description = description
        self.argumentHint = argumentHint
        self.aliases = aliases
        self.group = group
        self.unavailable = unavailable
        self.path = path
    }

    private enum CodingKeys: String, CodingKey {
        case name, description, argumentHint, aliases, group, unavailable, path
    }

    /// Lenient like the desktop's cache: a group or reason this build does
    /// not know reads as the engine group and as runnable.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        description = (try? c.decodeIfPresent(String.self, forKey: .description)) ?? ""
        argumentHint = (try? c.decodeIfPresent(String.self, forKey: .argumentHint)).flatMap { $0?.isEmpty == false ? $0 : nil }
        aliases = try? c.decodeIfPresent([String].self, forKey: .aliases)
        group = (try? c.decodeIfPresent(HarnessCommandGroup.self, forKey: .group)) ?? .engine
        unavailable = try? c.decodeIfPresent(HarnessCommandUnavailable.self, forKey: .unavailable)
        path = try? c.decodeIfPresent(String.self, forKey: .path)
    }
}

/// `HarnessCommandsAnswer`: the route's answer. A failed read is an empty,
/// unavailable list: the menu still shows Sagax's own commands.
public struct HarnessCommandsAnswer: Decodable, Hashable, Sendable {
    public var available: Bool
    public var engine: String?
    public var commands: [HarnessCommand]
    public var reason: String?

    public init(available: Bool, engine: String? = nil, commands: [HarnessCommand] = [], reason: String? = nil) {
        self.available = available
        self.engine = engine
        self.commands = commands
        self.reason = reason
    }

    public static let unavailable = HarnessCommandsAnswer(available: false, reason: "unavailable")

    private enum CodingKeys: String, CodingKey { case available, engine, commands, reason }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        available = (try? c.decodeIfPresent(Bool.self, forKey: .available)) == true
        engine = try? c.decodeIfPresent(String.self, forKey: .engine)
        commands = ((try? c.decodeIfPresent([Lossy<HarnessCommand>].self, forKey: .commands)) ?? nil)?
            .compactMap(\.value) ?? []
        reason = try? c.decodeIfPresent(String.self, forKey: .reason)
    }
}

// MARK: - Names

public enum ComposerCommandNames {
    /// `SAGAX_COMMAND_NAMES`: Sagax's own commands win a collision.
    public static let sagax = ["goal", "learn", "loop", "setup"]
    /// `ENGINE_COMMAND_PREFIX`: reaches an engine command a Sagax one shadows.
    public static let enginePrefix = "engine:"

    public static func isSagax(_ name: String) -> Bool {
        sagax.contains(name.lowercased())
    }

    /// `engineCommandLabel`: `/name`, or `/engine:name` when Sagax owns it.
    public static func label(_ command: HarnessCommand) -> String {
        isSagax(command.name) ? "/\(enginePrefix)\(command.name)" : "/\(command.name)"
    }
}

// MARK: - The "/" being typed

/// `ComposerSlashTrigger`: the slash token the menu completes.
public struct ComposerSlashTrigger: Hashable, Sendable {
    public var query: String
    /// Character offsets into the draft.
    public var start: Int
    public var end: Int

    public init(query: String, start: Int, end: Int) {
        self.query = query
        self.start = start
        self.end = end
    }

    /// `composerSlashTrigger`: only at the beginning of a draft, while the
    /// first token is being typed. The phone's caret is the draft's end.
    public static func at(_ text: String, caret: Int? = nil) -> ComposerSlashTrigger? {
        let characters = Array(text)
        let end = max(0, min(characters.count, caret ?? characters.count))
        let prefix = String(characters[0..<end])
        guard prefix.hasPrefix("/") else { return nil }
        let query = String(prefix.dropFirst())
        guard query.allSatisfy(Self.isTokenCharacter) else { return nil }
        return ComposerSlashTrigger(query: query, start: 0, end: end)
    }

    /// `[\w.:-]`
    static func isTokenCharacter(_ character: Character) -> Bool {
        character == "." || character == ":" || character == "-" || character == "_"
            || character.isLetter || character.isNumber
    }

    /// `replaceComposerSlashTrigger`: the draft with the token replaced.
    public func replacing(in text: String, with replacement: String) -> String {
        let characters = Array(text)
        let lower = min(start, characters.count), upper = min(end, characters.count)
        return String(characters[0..<lower]) + replacement + String(characters[upper...])
    }
}

/// `goalTextFromComposer`: a typed `/goal …` in a room. Nil for an ordinary
/// message; empty when the command still needs its goal.
public func goalTextFromComposer(_ text: String) -> String? {
    let lower = text.lowercased()
    guard lower.hasPrefix("/goal") else { return nil }
    let rest = text.dropFirst(5)
    if rest.isEmpty { return "" }
    guard let first = rest.first, first.isWhitespace else { return nil }
    return String(rest.drop(while: \.isWhitespace))
}

// MARK: - Sagax's commands

/// `ComposerSlashCommand`: one of Sagax's own composer commands.
public enum SagaxSlashCommand: String, CaseIterable, Hashable, Sendable {
    /// A goal: a room's bounded team goal, or (2026-10-30) one bot's goal
    /// it works on until done (server/solo-goal.ts).
    case goal
    /// Draft a reusable skill from the conversation.
    case learn
    /// The bot interviews the person and sets itself up.
    case setup
    /// A repeating prompt in this chat, written as a routine
    /// (src/lib/composer-loop.ts).
    case loop
    /// `/loop status`: this bot's loops (the routine list).
    case loopStatus = "loop-status"
    /// `/loop stop`: turns this bot's loops off.
    case loopStop = "loop-stop"

    /// `/goal`, `/loop status`.
    public var label: String { "/" + rawValue.replacingOccurrences(of: "-", with: " ") }

    /// The names the query matches (`[label without the slash, id]`).
    public var names: [String] { [String(label.dropFirst()).lowercased(), rawValue] }

    /// The heading it is listed under (`sagaxCommandGroup`): Goal for /goal.
    public var group: ComposerMenuItem.Group { self == .goal ? .goal : .sagax }

    /// What picking it puts in the draft (`pickCommand`): `/learn `,
    /// `/setup `, `/loop `; goal switches the send mode and inserts nothing;
    /// the loop subcommands run at once.
    public var insertion: String {
        switch self {
        case .goal, .loopStatus, .loopStop: return ""
        case .learn: return "/learn "
        case .setup: return "/setup "
        case .loop: return "/loop "
        }
    }

    /// Runs when picked instead of going into the draft.
    public var runsAtOnce: Bool { self == .loopStatus || self == .loopStop }

    /// The commands the desktop offers here (`commandCandidates`): `/goal`
    /// in a 1:1 or a room (not a DM); `/learn` while skill authoring is on
    /// and an engine that would answer mounts the agents tools; `/setup`
    /// for one bot whose engine mounts them; `/loop` and its subcommands
    /// in a 1:1 or a room (not a DM).
    public static func offered(isRoom: Bool, isDM: Bool, skillAuthoring: Bool, supportsAgents: Bool) -> [SagaxSlashCommand] {
        var out: [SagaxSlashCommand] = []
        let conversation = !isRoom || !isDM
        if conversation { out.append(.goal) }
        if skillAuthoring && supportsAgents { out.append(.learn) }
        if !isRoom && supportsAgents { out.append(.setup) }
        if conversation { out += [.loop, .loopStatus, .loopStop] }
        return out
    }
}

// MARK: - /loop

/// `LoopCommand` (src/lib/composer-loop.ts): the typed `/loop …`.
public enum LoopCommand: Hashable, Sendable {
    case incomplete
    case status
    case stop(name: String)
    case start(everyMinutes: Int, prompt: String, raised: Bool, capped: Bool)

    /// `LOOP_MIN_MINUTES`, `LOOP_MAX_MINUTES`.
    public static let minMinutes = 5
    public static let maxMinutes = 1_440

    /// `parseLoopCommand`: nil when the text is not that command.
    public static func parse(_ text: String) -> LoopCommand? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = trimmed.lowercased()
        guard lower.hasPrefix("/loop") else { return nil }
        let after = trimmed.dropFirst(5)
        if let first = after.first, !first.isWhitespace { return nil }
        let rest = after.trimmingCharacters(in: .whitespacesAndNewlines)
        if rest.isEmpty { return .incomplete }
        let words = rest.split(whereSeparator: \.isWhitespace).map(String.init)
        let word = words[0].lowercased()
        let tail = Array(words.dropFirst())
        if word == "status" && tail.isEmpty { return .status }
        if word == "stop" { return .stop(name: tail.joined(separator: " ")) }
        guard let raw = rawMinutes(word), raw >= 1 else { return .incomplete }
        let prompt = tail.joined(separator: " ")
        guard !prompt.isEmpty else { return .incomplete }
        return .start(
            everyMinutes: min(maxMinutes, max(minMinutes, raw)), prompt: prompt,
            raised: raw < minMinutes, capped: raw > maxMinutes
        )
    }

    /// `5m`, `2h`, `1d` in minutes; nil for anything else.
    static func rawMinutes(_ token: String) -> Int? {
        guard let unit = token.last, "mhd".contains(unit) else { return nil }
        let digits = token.dropLast()
        guard !digits.isEmpty, digits.allSatisfy(\.isASCIIDigit), let count = Int(digits) else { return nil }
        switch unit {
        case "h": return count * 60
        case "d": return count * 1_440
        default: return count
        }
    }

    /// `loopRoutineName`: "Loop 5m check the board", at most 80 characters.
    public static func routineName(everyMinutes: Int, prompt: String) -> String {
        let cadence: String
        if everyMinutes >= 60 && everyMinutes % 60 == 0 {
            cadence = everyMinutes % 1_440 == 0 ? "\(everyMinutes / 1_440)d" : "\(everyMinutes / 60)h"
        } else {
            cadence = "\(everyMinutes)m"
        }
        let collapsed = prompt.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        let title = String(collapsed.prefix(42)).trimmingCharacters(in: .whitespaces)
        return String("Loop \(cadence) \(title)".prefix(80))
    }

    /// The routines `/loop stop [name]` turns off (`runLoopCommand`): this
    /// bot's enabled interval routines whose name or prompt holds the name,
    /// else, with no name, the ones `/loop` wrote ("Loop …").
    public static func stopTargets(_ routines: [Routine], botId: String, name: String) -> [Routine] {
        let mine = routines.filter { $0.botId == botId && $0.schedule.type == .interval && $0.enabled != false }
        let named = name.lowercased()
        if named.isEmpty { return mine.filter { $0.name.hasPrefix("Loop ") } }
        return mine.filter { $0.name.lowercased().contains(named) || $0.prompt.lowercased().contains(named) }
    }
}

private extension Character {
    var isASCIIDigit: Bool { isASCII && isNumber }
}

// MARK: - The bot's skills

/// `SlashSkill`: one of the bot's enabled skills, run for one turn by sending
/// `/name` (shared/skill-command.ts; the server expands it on every engine).
public struct SlashSkill: Hashable, Sendable {
    public var name: String
    public var description: String
    public init(name: String, description: String = "") {
        self.name = name
        self.description = description
    }

    /// `offersSkillCommand`: a valid skill name that no Sagax command owns.
    public static func offered(_ name: String) -> Bool {
        guard (1...64).contains(name.count), SagaxSlashCommand(rawValue: name) == nil else { return false }
        return name.split(separator: "-", omittingEmptySubsequences: false).allSatisfy { part in
            !part.isEmpty && part.allSatisfy { ($0.isASCII && $0.isLowercase) || ($0.isASCII && $0.isNumber) }
        }
    }

    /// `enabledSlashSkills`: the enabled skills a `/name` can reach, by name.
    public static func menu(_ skills: [ManagedSkill]) -> [SlashSkill] {
        var seen = Set<String>()
        return skills
            .filter { $0.enabled && offered($0.name) && seen.insert($0.name).inserted }
            .sorted { $0.name < $1.name }
            .map { SlashSkill(name: $0.name, description: $0.description) }
    }
}

// MARK: - The menu

/// One row of the "/" menu (`ComposerMenuItem`).
public struct ComposerMenuItem: Hashable, Identifiable, Sendable {
    public enum Kind: Hashable, Sendable {
        case sagax(SagaxSlashCommand)
        case skill(SlashSkill)
        case engine(HarnessCommand)
    }

    public enum Group: String, CaseIterable, Hashable, Sendable {
        case goal, sagax, skills, engine, plugins, mcp
    }

    public var kind: Kind
    public var key: String
    public var group: Group
    public var label: String
    public var description: String
    public var argumentHint: String?
    public var unavailable: HarnessCommandUnavailable?
    /// In a room: the bot whose engine lists it.
    public var bot: MenuBot?
    /// In a room that names no single bot: the mention picking it adds.
    public var mentionPrefix: String?

    public struct MenuBot: Hashable, Sendable {
        public var id: String
        public var name: String
        public init(id: String, name: String) { self.id = id; self.name = name }
    }

    public var id: String { key }

    /// `composerMenuSection`: the heading a row starts under.
    public var section: String {
        if case .engine = kind, let bot { return "bot:\(bot.id)" }
        return group.rawValue
    }

    /// `pickCommand`: what picking the row puts in place of the slash token.
    /// Nil for a row the chat cannot run (it stays listed with its reason).
    public var insertion: String? {
        switch kind {
        case let .sagax(command): return command.insertion
        case .skill: return "\(label) "
        case .engine:
            if unavailable != nil { return nil }
            return "\(mentionPrefix ?? "")\(label) "
        }
    }
}

public enum ComposerCommandMenu {
    static let limit = 80
    /// The fewest rows a bot keeps in a room's "/" menu.
    static let groupMinimumPerBot = 8

    private static func rank(_ query: String, names: [String], description: String) -> Int? {
        if query.isEmpty { return 0 }
        if names.contains(where: { $0.hasPrefix(query) }) { return 0 }
        if names.contains(where: { ($0.split(separator: ":").last.map(String.init) ?? $0).hasPrefix(query) }) { return 1 }
        // one typed letter is the start of a name, never a name or a
        // description that merely contains it
        if query.count >= 2, names.contains(where: { $0.contains(query) }) { return 2 }
        // a description only after the names, from the start of a word, three letters or more
        if query.count >= 3, !query.contains(" "),
           description.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).contains(where: { $0.hasPrefix(query) }) {
            return 3
        }
        return nil
    }

    /// `composerCommandMenu`: Sagax's commands first, then the bot's skills,
    /// then the engine's by group; within a group the closest names first,
    /// what the chat cannot run last. An engine command a skill shadows is
    /// left out: `/name` runs the skill.
    public static func items(
        sagax: [SagaxSlashCommand],
        sagaxDescription: (SagaxSlashCommand) -> String = { _ in "" },
        sagaxHint: (SagaxSlashCommand) -> String? = { _ in nil },
        skills: [SlashSkill] = [],
        engine: [HarnessCommand],
        query rawQuery: String
    ) -> [ComposerMenuItem] {
        let query = rawQuery.lowercased()
        var ranked: [(item: ComposerMenuItem, rank: Int, order: Int)] = []
        for (order, command) in sagax.enumerated() {
            let description = sagaxDescription(command)
            guard let rank = rank(query, names: command.names, description: description) else { continue }
            ranked.append((ComposerMenuItem(
                kind: .sagax(command), key: "sagax:\(command.rawValue)", group: command.group,
                label: command.label, description: description, argumentHint: sagaxHint(command)
            ), rank, order))
        }
        var skillNames = Set<String>()
        for (order, skill) in skills.enumerated() where SlashSkill.offered(skill.name) && skillNames.insert(skill.name).inserted {
            guard let rank = rank(query, names: [skill.name], description: skill.description) else { continue }
            ranked.append((ComposerMenuItem(
                kind: .skill(skill), key: "skill:\(skill.name)", group: .skills,
                label: "/\(skill.name)", description: skill.description
            ), rank, order))
        }
        for (order, command) in engine.enumerated() {
            let label = ComposerCommandNames.label(command)
            if skillNames.contains(String(label.dropFirst())) { continue }
            let names = [String(label.dropFirst()).lowercased(), command.name.lowercased()]
                + (command.aliases ?? []).map { $0.lowercased() }
            guard let rank = rank(query, names: names, description: command.description) else { continue }
            let group: ComposerMenuItem.Group
            switch command.group {
            case .engine: group = .engine
            case .plugins: group = .plugins
            case .mcp: group = .mcp
            }
            ranked.append((ComposerMenuItem(
                kind: .engine(command), key: "engine:\(command.name)", group: group, label: label,
                description: command.description, argumentHint: command.argumentHint,
                unavailable: command.unavailable
            ), rank + (command.unavailable != nil ? 10 : 0), order))
        }
        let groupIndex = { (group: ComposerMenuItem.Group) in ComposerMenuItem.Group.allCases.firstIndex(of: group) ?? 0 }
        ranked.sort { a, b in
            let ga = groupIndex(a.item.group), gb = groupIndex(b.item.group)
            if ga != gb { return ga < gb }
            if a.rank != b.rank { return a.rank < b.rank }
            return a.order < b.order
        }
        return ranked.prefix(limit).map(\.item)
    }

    /// `groupMenuLimitPerBot`.
    public static func limitPerBot(_ bots: Int) -> Int {
        guard bots > 0 else { return 0 }
        return max(groupMinimumPerBot, limit / bots)
    }

    /// One bot's engine commands in a room's menu.
    public struct RoomEngineCommands: Hashable, Sendable {
        public var bot: ComposerMenuItem.MenuBot
        public var commands: [HarnessCommand]
        /// Picking one adds `@Name ` in front.
        public var mention: Bool
        public init(bot: ComposerMenuItem.MenuBot, commands: [HarnessCommand], mention: Bool) {
            self.bot = bot
            self.commands = commands
            self.mention = mention
        }
    }

    /// `composerGroupCommandMenu`: Sagax's commands, then each bot's engine
    /// commands under that bot's name, capped per bot.
    public static func roomItems(
        sagax: [SagaxSlashCommand],
        sagaxDescription: (SagaxSlashCommand) -> String = { _ in "" },
        sagaxHint: (SagaxSlashCommand) -> String? = { _ in nil },
        sets: [RoomEngineCommands],
        query: String
    ) -> [ComposerMenuItem] {
        var out = items(sagax: sagax, sagaxDescription: sagaxDescription, sagaxHint: sagaxHint, engine: [], query: query)
        let perBot = limitPerBot(sets.count)
        for set in sets {
            var shown = 0
            for var item in items(sagax: [], engine: set.commands, query: query) {
                if shown >= perBot { break }
                item.key = "bot:\(set.bot.id):\(item.key)"
                item.bot = set.bot
                if set.mention { item.mentionPrefix = "@\(set.bot.name) " }
                out.append(item)
                shown += 1
            }
        }
        return out
    }
}

// MARK: - Rooms

/// A room member, as the room's "/" menu sees it.
public struct RoomCommandMember: Hashable, Sendable {
    public var id: String
    public var name: String
    public var hidden: Bool
    public init(id: String, name: String, hidden: Bool = false) {
        self.id = id
        self.name = name
        self.hidden = hidden
    }
}

public enum RoomCommandRouting {
    /// `leadingMention`: a leading `@Name` (the longest active member name,
    /// not the start of a longer word) and where the rest starts.
    public static func leadingMention(_ text: String, members: [RoomCommandMember]) -> (member: RoomCommandMember, rest: Int)? {
        let characters = Array(text)
        guard let start = characters.firstIndex(where: { !$0.isWhitespace }), characters[start] == "@" else { return nil }
        let lower = String(characters[(start + 1)...]).lowercased()
        let member = members
            .filter { !$0.hidden && !$0.name.trimmingCharacters(in: .whitespaces).isEmpty }
            .sorted { $0.name.count > $1.name.count }
            .first { candidate in
                let name = candidate.name.lowercased()
                guard lower.hasPrefix(name) else { return false }
                guard let next = lower.dropFirst(name.count).first else { return true }
                return !(next.isLetter || next.isNumber || next == "_")
            }
        guard let member else { return nil }
        var rest = start + 1 + member.name.count
        while rest < characters.count, characters[rest].isWhitespace { rest += 1 }
        return (member, rest)
    }

    /// `composerGroupSlashTrigger`: the "/" at the start, or right after a
    /// leading `@Bot ` (that bot's commands only).
    public static func slash(_ text: String, members: [RoomCommandMember]) -> (trigger: ComposerSlashTrigger, botId: String?)? {
        if let plain = ComposerSlashTrigger.at(text) { return (plain, nil) }
        let characters = Array(text)
        guard let mention = leadingMention(text, members: members), mention.rest <= characters.count,
              mention.rest > 0, characters[mention.rest - 1].isWhitespace
        else { return nil }
        let tail = String(characters[mention.rest...])
        guard tail.hasPrefix("/") else { return nil }
        let query = String(tail.dropFirst())
        guard query.allSatisfy(ComposerSlashTrigger.isTokenCharacter) else { return nil }
        return (ComposerSlashTrigger(query: query, start: mention.rest, end: characters.count), mention.member.id)
    }

    /// `groupCommandTargets`: the mentioned bot, else the lead when it
    /// answers alone, else every active member (each picked command then
    /// starts with that bot's mention).
    public static func targets(botId: String?, members: [RoomCommandMember], defaultResponder: GroupResponder) -> [(member: RoomCommandMember, mention: Bool)] {
        let available = members.filter { !$0.hidden }
        if let botId {
            return available.first { $0.id == botId }.map { [($0, false)] } ?? []
        }
        if defaultResponder.kind == "member", let lead = available.first(where: { $0.id == defaultResponder.botId }) {
            return [(lead, false)]
        }
        return available.map { ($0, true) }
    }
}
