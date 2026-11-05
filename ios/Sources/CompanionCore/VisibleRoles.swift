// Visible roles (2026-11-05, #2016): the Perspicax role a tool step ran
// under, a role fact shown as a banner row, and the "Agit comme" card at a
// role transition. The wire types are shared/wire.ts `tool.role`,
// `tool.roleNotice` and `card.roleTransition` (shared/perspicax-roles.ts);
// the words are the desktop's RoleChip.tsx, RoleNoticeRow.tsx and
// RoleTransitionCard.tsx, read from the app's catalog through `StepWords`.
import Foundation

/// A role by slug and name. An empty slug is "Moi": the person's own access.
public struct RoleRef: Codable, Hashable, Sendable {
    public var slug: String
    public var name: String

    public init(slug: String, name: String) {
        self.slug = slug
        self.name = name
    }

    enum CodingKeys: String, CodingKey { case slug, name }

    public init(from decoder: Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        slug = (try? box.decodeIfPresent(String.self, forKey: .slug)) ?? ""
        name = (try? box.decodeIfPresent(String.self, forKey: .name)) ?? ""
    }
}

/// The role one Perspicax call ran under (`tool.role`).
public struct ToolRole: Codable, Hashable, Sendable {
    public var slug: String
    public var name: String
    /// default | routine | person | switch | fallback | rule. An unknown
    /// reason reads as the chat default.
    public var reason: String
    /// fallback / rule: the tool whose read was refused under `previous`.
    public var refusedTool: String? = nil
    /// fallback / rule / switch: the role before this step.
    public var previous: RoleRef? = nil
    /// The person "Moi" is: "au nom de <person>".
    public var person: String? = nil

    public init(slug: String, name: String, reason: String, refusedTool: String? = nil, previous: RoleRef? = nil, person: String? = nil) {
        self.slug = slug
        self.name = name
        self.reason = reason
        self.refusedTool = refusedTool
        self.previous = previous
        self.person = person
    }

    enum CodingKeys: String, CodingKey { case slug, name, reason, refusedTool, previous, person }

    public init(from decoder: Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        slug = (try? box.decodeIfPresent(String.self, forKey: .slug)) ?? ""
        name = (try? box.decodeIfPresent(String.self, forKey: .name)) ?? ""
        reason = (try? box.decodeIfPresent(String.self, forKey: .reason)) ?? "default"
        refusedTool = try? box.decodeIfPresent(String.self, forKey: .refusedTool)
        previous = try? box.decodeIfPresent(RoleRef.self, forKey: .previous)
        person = try? box.decodeIfPresent(String.self, forKey: .person)
    }

    public var ref: RoleRef { RoleRef(slug: slug, name: name) }
}

/// A ConnectWise permission an administrator would grant (CwPermission).
public struct CwPermission: Codable, Hashable, Sendable {
    /// CW REST path family, `schedule/entries`; "" when the tool is not CW.
    public var path: String
    /// Security role module, `Service Desk`; "" when unknown.
    public var module: String
    /// Security role function, `Service Tickets`; else the path.
    public var function: String
    /// Inquire | Add | Edit | Delete.
    public var operation: String

    public init(path: String, module: String, function: String, operation: String) {
        self.path = path
        self.module = module
        self.function = function
        self.operation = operation
    }

    enum CodingKeys: String, CodingKey {
        case path, module, operation
        case function = "func"
    }

    public init(from decoder: Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        path = (try? box.decodeIfPresent(String.self, forKey: .path)) ?? ""
        module = (try? box.decodeIfPresent(String.self, forKey: .module)) ?? ""
        function = (try? box.decodeIfPresent(String.self, forKey: .function)) ?? ""
        operation = (try? box.decodeIfPresent(String.self, forKey: .operation)) ?? "Inquire"
    }
}

/// A role fact shown as a banner row (`tool.roleNotice`).
public struct RoleNotice: Codable, Hashable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case lapsed
        case writeRefused = "write_refused"
        case readRefused = "read_refused"
    }

    public var kind: Kind
    public var role: RoleRef
    public var tool: String
    public var permission: CwPermission? = nil
    /// The person the bot acts for (the "Moi" of this thread).
    public var person: String? = nil
    /// `cw_member:<identifier>` behind the role.
    public var target: String? = nil

    public init(kind: Kind, role: RoleRef, tool: String, permission: CwPermission? = nil, person: String? = nil, target: String? = nil) {
        self.kind = kind
        self.role = role
        self.tool = tool
        self.permission = permission
        self.person = person
        self.target = target
    }

    /// The ConnectWise member behind the role, from `cw_member:<id>`.
    public var member: String? {
        guard let target, target.hasPrefix("cw_member:") else { return nil }
        let id = String(target.dropFirst("cw_member:".count))
        return id.isEmpty ? nil : id
    }
}

/// How an "Agit comme" card was (or is) answered.
public enum RoleTransitionChoice: String, Codable, Hashable, Sendable, CaseIterable {
    case `continue`, stay, always
}

/// An "Agit comme" card (`card.roleTransition`), answered through
/// `POST /api/bots/:botId/cards/:messageId/role-transition`, never typed.
public struct RoleTransitionCard: Codable, Hashable, Sendable {
    public var botId: String
    public var botName: String
    /// The person the bot acts for: "au nom de <person>".
    public var person: String
    public var from: RoleRef
    public var to: RoleRef
    public var reason: String
    public var refusedTool: String? = nil
    /// CW path of the refused read ("" for a switch).
    public var path: String? = nil
    /// Whether the reader may save "Toujours ainsi" (the bot's owner).
    public var canAlways: Bool? = nil
    /// Once answered.
    public var choice: RoleTransitionChoice? = nil

    public init(botId: String, botName: String, person: String, from: RoleRef, to: RoleRef, reason: String,
                refusedTool: String? = nil, path: String? = nil, canAlways: Bool? = nil, choice: RoleTransitionChoice? = nil) {
        self.botId = botId
        self.botName = botName
        self.person = person
        self.from = from
        self.to = to
        self.reason = reason
        self.refusedTool = refusedTool
        self.path = path
        self.canAlways = canAlways
        self.choice = choice
    }

    enum CodingKeys: String, CodingKey { case botId, botName, person, from, to, reason, refusedTool, path, canAlways, choice }

    public init(from decoder: Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        botId = try box.decode(String.self, forKey: .botId)
        botName = (try? box.decodeIfPresent(String.self, forKey: .botName)) ?? ""
        person = (try? box.decodeIfPresent(String.self, forKey: .person)) ?? ""
        from = try box.decode(RoleRef.self, forKey: .from)
        to = try box.decode(RoleRef.self, forKey: .to)
        reason = (try? box.decodeIfPresent(String.self, forKey: .reason)) ?? "switch"
        refusedTool = try? box.decodeIfPresent(String.self, forKey: .refusedTool)
        path = try? box.decodeIfPresent(String.self, forKey: .path)
        canAlways = try? box.decodeIfPresent(Bool.self, forKey: .canAlways)
        // an unknown choice still settles the card: it reads as Continue
        if box.contains(.choice), let raw = try? box.decodeIfPresent(String.self, forKey: .choice) {
            choice = RoleTransitionChoice(rawValue: raw) ?? .continue
        }
    }
}

/// The words and rules of the three role surfaces, as the desktop draws them.
public enum VisibleRoles {
    /// Whether a name is an id a person cannot read (the app passes
    /// `HumanID.isOpaque`); a UUID anywhere in it always counts.
    public typealias Opaque = (String) -> Bool

    private static let uuid = try! NSRegularExpression(
        pattern: "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    )

    static func containsUuid(_ text: String) -> Bool {
        uuid.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    private static func readable(_ text: String, _ opaque: Opaque) -> Bool {
        !text.isEmpty && !opaque(text) && !containsUuid(text)
    }

    /// The role's name in words ("" slug is "Moi"), never an opaque id.
    public static func label(_ role: RoleRef, words: StepWords, opaque: Opaque = { _ in false }) -> String {
        if role.slug.isEmpty { return words.t("roles.me") }
        let name = role.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if readable(name, opaque) { return name }
        return readable(role.slug, opaque) ? role.slug : words.t("roles.chip.unnamed")
    }

    /// Whether the step's role differs from the one before it (the accent).
    public static func changed(_ role: ToolRole) -> Bool {
        guard let previous = role.previous else { return false }
        return previous.slug != role.slug
    }

    /// A refused read answered under "Moi" (or by the owner's rule): the
    /// warning tint.
    public static func warns(_ role: ToolRole) -> Bool {
        role.reason == "fallback" || role.reason == "rule"
    }

    /// The tooltip line: the role id, or whose access "Moi" is.
    public static func detail(_ role: ToolRole, words: StepWords, opaque: Opaque = { _ in false }) -> String? {
        if !role.slug.isEmpty {
            return readable(role.slug, opaque) ? words.t("roles.chip.idTooltip", ["id": role.slug]) : nil
        }
        guard let person = role.person?.trimmingCharacters(in: .whitespacesAndNewlines), !person.isEmpty else { return nil }
        return words.t("roles.chip.meTooltip", ["person": person])
    }

    /// A tool id in words: its own part, no server, no underscores.
    public static func toolWords(_ tool: String) -> String {
        let name = StepLabel.parseToolId(tool.trimmingCharacters(in: .whitespacesAndNewlines)).name
        return name.replacingOccurrences(of: #"_+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    /// "Why this role", in one sentence.
    public static func why(_ role: ToolRole, words: StepWords, opaque: Opaque = { _ in false }) -> String {
        let from = role.previous.map { label($0, words: words, opaque: opaque) } ?? ""
        let person = role.person?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty ?? words.t("roles.me")
        switch role.reason {
        case "routine": return words.t("roles.why.routine")
        case "person": return words.t("roles.why.person")
        case "switch": return from.isEmpty ? words.t("roles.why.routine") : words.t("roles.why.switch", ["from": from])
        case "fallback":
            return words.t("roles.why.fallback", [
                "from": from.nonEmpty ?? words.t("roles.chip.unnamed"),
                "tool": toolWords(role.refusedTool ?? ""),
                "person": person,
            ])
        case "rule":
            return words.t("roles.why.rule", ["from": from.nonEmpty ?? words.t("roles.chip.unnamed"), "person": person])
        default: return words.t("roles.why.default")
        }
    }

    /// The banner row's sentence.
    public static func noticeText(_ notice: RoleNotice, botName: String?, words: StepWords, opaque: Opaque = { _ in false }) -> String {
        let role = label(notice.role, words: words, opaque: opaque)
        switch notice.kind {
        case .lapsed: return words.t("roles.notice.lapsed", ["role": role])
        case .writeRefused:
            let bot = botName?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty ?? words.t("ids.deletedBot")
            return words.t("roles.notice.writeRefusedShort", ["role": role, "bot": bot])
        case .readRefused: return words.t("roles.notice.readRefusedShort", ["role": role])
        }
    }

    /// "Service Desk › Service Tickets (service/tickets) · Modifier".
    public static func permissionText(_ permission: CwPermission, words: StepWords) -> String {
        let area = permission.module.isEmpty ? permission.function : "\(permission.module) › \(permission.function)"
        let key: String
        switch permission.operation {
        case "Inquire": key = "roles.op.inquire"
        case "Add": key = "roles.op.add"
        case "Edit": key = "roles.op.edit"
        default: key = "roles.op.delete"
        }
        return "\(area)\(permission.path.isEmpty ? "" : " (\(permission.path))") · \(words.t(key))"
    }

    /// The banner's second line: the missing permission and whose security
    /// role it is. Nil without a permission.
    public static func missingLine(_ notice: RoleNotice, words: StepWords) -> String? {
        guard let permission = notice.permission else { return nil }
        let line = words.t("roles.notice.missingLine", ["permission": permissionText(permission, words: words)])
        guard let member = notice.member else { return line }
        return "\(line) · \(words.t("roles.notice.target", ["member": member]))"
    }

    /// The card's title: "Agit comme <role>".
    public static func transitionTitle(_ card: RoleTransitionCard, words: StepWords, opaque: Opaque = { _ in false }) -> String {
        words.t("roles.transition.title", ["role": label(card.to, words: words, opaque: opaque)])
    }

    /// The card's sentence in the reader's language.
    public static func transitionText(_ card: RoleTransitionCard, words: StepWords, opaque: Opaque = { _ in false }) -> String {
        let from = label(card.from, words: words, opaque: opaque)
        let to = label(card.to, words: words, opaque: opaque)
        let person = card.person.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty ?? words.t("roles.me")
        let bot = card.botName.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty ?? words.t("ids.deletedBot")
        if card.reason == "fallback" {
            // the refused thing in words: its CW path when known, else the tool
            let tool: String
            if let path = card.path, !path.isEmpty { tool = "« \(path) »" }
            else if let refused = card.refusedTool, !refused.isEmpty { tool = toolWords(refused) }
            else { tool = "" }
            return words.t("roles.transition.fallback", ["bot": bot, "from": from, "to": to, "tool": tool, "person": person])
        }
        return words.t("roles.transition.switch", ["bot": bot, "from": from, "to": to, "person": person])
    }

    /// The card's choices in order: Continue, Stay in <from>, and Always
    /// only for the bot's owner (`canAlways`).
    public static func choices(_ card: RoleTransitionCard, words: StepWords, opaque: Opaque = { _ in false }) -> [(choice: RoleTransitionChoice, label: String)] {
        let from = label(card.from, words: words, opaque: opaque)
        var out: [(RoleTransitionChoice, String)] = [
            (.continue, words.t("roles.transition.continue")),
            (.stay, words.t("roles.transition.stay", ["role": from])),
        ]
        if card.canAlways == true { out.append((.always, words.t("roles.transition.always"))) }
        return out
    }

    /// The answer a settled card shows.
    public static func answeredText(_ choice: RoleTransitionChoice, card: RoleTransitionCard, words: StepWords, opaque: Opaque = { _ in false }) -> String {
        switch choice {
        case .continue: return words.t("roles.transition.answered.continue")
        case .stay: return words.t("roles.transition.answered.stay", ["role": label(card.from, words: words, opaque: opaque)])
        case .always: return words.t("roles.transition.answered.always")
        }
    }

    /// The choice a settled card carries: its own, else the option the
    /// server marked (`card.answered` is the picked option's words).
    public static func settledChoice(_ card: OptionCard) -> RoleTransitionChoice? {
        guard let transition = card.roleTransition else { return nil }
        if let choice = transition.choice { return choice }
        guard let answered = card.answered else { return nil }
        switch card.options.firstIndex(of: answered) {
        case 1: return .stay
        case 2: return .always
        default: return .continue
        }
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
