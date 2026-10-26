import Foundation

// The desktop's custom-rule editor (CustomRulesCard.tsx), not a second
// matcher. `compile` is shared/custom-rules.ts `compileRule` for the words
// the form warns on (recognized, a shell family, an exact command). The
// server still compiles the saved rule and is the one that decides.

public enum CustomRuleBehavior: String, Codable, CaseIterable, Equatable, Sendable {
    case allow, ask, deny

    public var label: String {
        switch self {
        case .allow: "Allow automatically"
        case .ask: "Ask first"
        case .deny: "Refuse"
        }
    }
}

public enum CustomRuleRisk: String, Codable, CaseIterable, Equatable, Sendable {
    case destructive, irreversible, money
    case externalSend = "external-send"

    public var label: String {
        switch self {
        case .destructive: "deletions"
        case .irreversible: "irreversible actions"
        case .money: "money"
        case .externalSend: "external sends"
        }
    }
}

public struct CustomRuleRow: Identifiable, Equatable, Sendable {
    public var id: String
    public var botId: String?
    public var when: String
    public var behavior: CustomRuleBehavior
    public var riskScope: [CustomRuleRisk]
    public var enabled: Bool
    public var org: Bool
    public var createdAt: Double
    public var recognized: Bool

    public init(id: String, botId: String?, when: String, behavior: CustomRuleBehavior, riskScope: [CustomRuleRisk] = [], enabled: Bool = true, org: Bool = false, createdAt: Double = 0, recognized: Bool = true) {
        self.id = id
        self.botId = botId
        self.when = when
        self.behavior = behavior
        self.riskScope = riskScope
        self.enabled = enabled
        self.org = org
        self.createdAt = createdAt
        self.recognized = recognized
    }
}

extension CustomRuleRow: Decodable {
    private struct Compiled: Decodable { var recognized: Bool? }
    private enum CodingKeys: String, CodingKey {
        case id, botId, when, behavior, riskScope, enabled, org, createdAt, compiled
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        botId = try c.decodeIfPresent(String.self, forKey: .botId)
        when = try c.decode(String.self, forKey: .when)
        behavior = try c.decode(CustomRuleBehavior.self, forKey: .behavior)
        riskScope = ((try? c.decode([String].self, forKey: .riskScope)) ?? []).compactMap(CustomRuleRisk.init(rawValue:))
        enabled = (try? c.decodeIfPresent(Bool.self, forKey: .enabled)) ?? true
        org = (try? c.decodeIfPresent(Bool.self, forKey: .org)) ?? false
        createdAt = (try? c.decodeIfPresent(Double.self, forKey: .createdAt)) ?? 0
        recognized = (try? c.decodeIfPresent(Compiled.self, forKey: .compiled))?.recognized ?? true
    }
}

public struct CustomRuleList: Equatable, Sendable {
    public var rules: [CustomRuleRow]
    public var alwaysAllow: Bool
}

extension CustomRuleList: Decodable {
    private struct Policy: Decodable { var alwaysAllow: Bool? }
    private enum CodingKeys: String, CodingKey { case rules, orgPolicy }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rules = try c.decodeIfPresent([CustomRuleRow].self, forKey: .rules) ?? []
        let policy = try c.decodeIfPresent(Policy.self, forKey: .orgPolicy)
        // Missing policy means the grants are on, as the desktop reads it.
        alwaysAllow = policy?.alwaysAllow != false
    }
}

public struct RuleTextPart: Equatable, Sendable {
    public enum Kind: Equatable, Sendable { case same, removed, added }
    public var text: String
    public var kind: Kind
}

public struct CustomRulePreview: Equatable, Sendable {
    public var recognized: Bool
    public var shellFamily: Bool
    public var commands: [String]
    public var actions: [String]
    public var tools: [String]
    public var paths: [String]
}

public enum ApprovalGrantError: Error, LocalizedError, Equatable, Sendable {
    case status(code: Int, apiCode: String?, message: String?, recipients: Bool)

    public var errorDescription: String? {
        switch self {
        case let .status(_, apiCode, message, recipients):
            return recipients
                ? AllowedRecipients.failureText(apiCode: apiCode, serverMessage: message)
                : CustomRuleEditor.failureText(apiCode: apiCode, serverMessage: message)
        }
    }
}

/// Who may edit. The phone's config has no `bots.tools` bit, so a member
/// who owns the bot is offered the save and the server still refuses a
/// profile that lacks it.
public enum ApprovalGrantGate {
    public static func managesRules(role: String?, principalId: String?, ownerUserId: String?) -> Bool {
        if role != "member" { return true }
        return owns(principalId, ownerUserId)
    }

    public static func editsRecipients(role: String?, botsReadOnly: Bool, principalId: String?, ownerUserId: String?) -> Bool {
        if botsReadOnly { return false }
        if role != "member" { return true }
        return owns(principalId, ownerUserId)
    }

    private static func owns(_ principalId: String?, _ ownerUserId: String?) -> Bool {
        let principal = principalId?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        let owner = ownerUserId?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        return !principal.isEmpty && principal == owner
    }
}

public enum CustomRuleEditor {
    public static let maximumText = 500

    /// `compileRule` for the form. `home` is optional, as the desktop form
    /// calls it with none.
    public static func compile(_ when: String, home: String? = nil) -> CustomRulePreview {
        RuleCompiler.compile(when, home: home)
    }

    public static func normalizePath(_ raw: String, home: String? = nil) -> String? {
        RuleCompiler.normalizePath(raw, home: home)
    }

    /// The rules one bot meets, the organization's first.
    public static func ordered(_ rules: [CustomRuleRow], forBot botId: String) -> [CustomRuleRow] {
        let matching = rules
            .filter { $0.botId == botId || $0.botId == nil }
            .sorted { a, b in
                let aAll = a.botId == nil
                let bAll = b.botId == nil
                if aAll != bAll { return !aAll }
                return a.createdAt < b.createdAt
            }
        return matching.filter(\.org) + matching.filter { !$0.org }
    }

    /// One rule per chosen bot. An empty choice is not a target.
    public static func saveTargets(botId: String, allBots: Bool, chosen: [String]?) -> [String?] {
        if let chosen, !chosen.isEmpty { return chosen }
        return [allBots ? nil : botId]
    }

    /// True when Save stays disabled (CustomRuleForm `blocked`).
    public static func isBlocked(when: String, behavior: CustomRuleBehavior, choosing: Bool, chosenEmpty: Bool, allowOff: Bool, fromCard: Bool = false) -> Bool {
        let trimmed = when.trimmingCharacters(in: .whitespacesAndNewlines)
        let compiled = trimmed.isEmpty ? nil : compile(trimmed)
        let shellFamily = behavior == .allow && compiled?.shellFamily == true
        let exactOutside = behavior == .allow && !fromCard && (compiled?.commands.isEmpty == false)
        return shellFamily || exactOutside || (choosing && chosenEmpty) || (allowOff && behavior == .allow)
    }

    public static func failureText(apiCode: String?, serverMessage: String?) -> String {
        switch apiCode {
        case "org_always_allow_off":
            return "Your organization requires an approval each time: Always allow is off and your \"Allow automatically\" rules are paused. \"Ask first\" and \"Refuse\" rules still apply."
        case "org_rule_locked":
            return "Required by your administrator. You cannot change or delete this rule."
        case "rule_not_covering":
            return "This rule would not cover this request. Make it match the action, or tick the kind of action it is."
        case "shell_family_allow":
            return "For the shell, only exact commands can be allowed automatically. Write \"the exact command `...`\", or choose Ask first or Refuse."
        case "exact_command_from_card":
            return "An exact command can be allowed only from its approval card (Always allow this): it is then bound to this bot, this tool and the session's launch folder (the shell may change folder between commands)."
        case "exact_command_no_cwd":
            return "This command has no known launch folder, so it cannot be allowed automatically. Allow it once instead."
        case "exact_command_one_bot":
            return "An exact command is allowed for the bot that asked it only, never for all your bots."
        default:
            return "Couldn't save: \(serverMessage ?? "Something went wrong.")"
        }
    }

    /// `ruleTextDiff`: removed and added words while a rule is edited.
    public static func textDiff(before: String, after: String) -> [RuleTextPart] {
        let split = { (text: String) -> [String] in
            guard let regex = try? NSRegularExpression(pattern: #"\S+\s*"#) else { return [] }
            let ns = text as NSString
            return regex.matches(in: text, range: NSRange(location: 0, length: ns.length)).map { ns.substring(with: $0.range) }
        }
        let a = split(before)
        let b = split(after)
        var parts: [RuleTextPart] = []
        func push(_ text: String, _ kind: RuleTextPart.Kind) {
            if var last = parts.last, last.kind == kind {
                last.text += text
                parts[parts.count - 1] = last
            } else {
                parts.append(RuleTextPart(text: text, kind: kind))
            }
        }
        if a.count > 200 || b.count > 200 {
            if !before.isEmpty { push(before, .removed) }
            if !after.isEmpty { push(after, .added) }
            return parts
        }
        let key = { (word: String) in word.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        var table = Array(repeating: Array(repeating: 0, count: b.count + 1), count: a.count + 1)
        if a.count > 0 {
            for i in stride(from: a.count - 1, through: 0, by: -1) {
                for j in stride(from: b.count - 1, through: 0, by: -1) {
                    table[i][j] = key(a[i]) == key(b[j]) ? table[i + 1][j + 1] + 1 : max(table[i + 1][j], table[i][j + 1])
                }
            }
        }
        var i = 0
        var j = 0
        while i < a.count && j < b.count {
            if key(a[i]) == key(b[j]) {
                push(b[j], .same)
                i += 1
                j += 1
            } else if table[i + 1][j] >= table[i][j + 1] {
                push(a[i], .removed)
                i += 1
            } else {
                push(b[j], .added)
                j += 1
            }
        }
        while i < a.count { push(a[i], .removed); i += 1 }
        while j < b.count { push(b[j], .added); j += 1 }
        return parts
    }
}

// MARK: - compileRule

private enum RuleAction: String, CaseIterable {
    case read, write, delete, command, send, web, payment
}

private enum RuleObject: String, CaseIterable {
    case file, mail, web, command
}

private enum RuleCompiler {
    static func compile(_ when: String, home: String?) -> CustomRulePreview {
        let clipped = String(when.prefix(CustomRuleEditor.maximumText))
        var commands: [String] = []
        let text = replacingExactCommands(clipped, into: &commands)
        let list = words(text)
        var actions = RuleAction.allCases.filter { has(list, words: actionWords[$0] ?? []) }
        var objects = RuleObject.allCases.filter { has(list, words: objectWords[$0] ?? []) }
        if !actions.contains(.send), (list.contains("message") || list.contains("messages")), actions.isEmpty {
            actions.append(.send)
        }
        if objects.contains(.mail), actions.isEmpty { actions.append(.send) }
        if objects.contains(.web), let index = actions.firstIndex(of: .web) { actions.remove(at: index) }
        if objects.contains(.web), actions.isEmpty { actions.append(.read) }
        if objects.contains(.command), !actions.contains(.command) { actions.append(.command) }
        var paths: [String] = []
        if let regex = try? NSRegularExpression(pattern: #"(?:^|[\s«"'(])((?:~|\.{1,2})?/[^\s,;«»"'()]*)"#) {
            let ns = text as NSString
            for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) where match.range(at: 1).location != NSNotFound {
                let raw = ns.substring(with: match.range(at: 1))
                guard let path = normalizePath(raw, home: home), path != "/", !paths.contains(path) else { continue }
                paths.append(path)
            }
        }
        if !paths.isEmpty, !objects.contains(.file) { objects.append(.file) }
        if !commands.isEmpty, !actions.contains(.command) { actions.append(.command) }
        var tools: [String] = []
        if let regex = try? NSRegularExpression(pattern: #"`([^`\s]{2,120})`"#) {
            let ns = text as NSString
            for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) where match.range(at: 1).location != NSNotFound {
                let name = ns.substring(with: match.range(at: 1)).lowercased().replacingOccurrences(of: #"^mcp__"#, with: "", options: .regularExpression)
                if !tools.contains(name) { tools.append(name) }
            }
        }
        let folded = fold(text)
        if let regex = try? NSRegularExpression(pattern: #"\b(?:outil|tool)\s+([a-z0-9][a-z0-9_.-]{2,120})"#) {
            let ns = folded as NSString
            for match in regex.matches(in: folded, range: NSRange(location: 0, length: ns.length)) where match.range(at: 1).location != NSNotFound {
                let name = ns.substring(with: match.range(at: 1)).replacingOccurrences(of: #"^mcp__"#, with: "", options: .regularExpression)
                if !tools.contains(name) { tools.append(name) }
            }
        }
        let products = productWords.contains { has(list, words: $0) }
        let recognized = !actions.isEmpty || !tools.isEmpty || products || !commands.isEmpty
        let shellFamily = actions.contains(.command) && commands.isEmpty
        return CustomRulePreview(recognized: recognized, shellFamily: shellFamily, commands: commands, actions: actions.map(\.rawValue), tools: tools, paths: paths)
    }

    static func normalizePath(_ raw: String, home: String?) -> String? {
        var path = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if path.first == "\"" || path.first == "'" { path.removeFirst() }
        if path.last == "\"" || path.last == "'" { path.removeLast() }
        if path.isEmpty { return nil }
        if path.range(of: #"[\*\?\[\]\{\}]"#, options: .regularExpression) != nil { return nil }
        path = path.replacingOccurrences(of: #"^\$HOME(?=/|$)"#, with: "~", options: .regularExpression)
        path = path.replacingOccurrences(of: #"^\$\{HOME\}(?=/|$)"#, with: "~", options: .regularExpression)
        if path.hasPrefix("~"), path.count > 1, path.dropFirst().first != "/" { return nil }
        let homeRoot: String? = {
            guard let home, home != "/" else { return nil }
            return home.replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
        }()
        if let homeRoot, path == homeRoot || path.hasPrefix(homeRoot + "/") {
            path = "~" + path.dropFirst(homeRoot.count)
        }
        guard path.hasPrefix("/") || path.hasPrefix("~") else { return nil }
        let root = path.hasPrefix("~") ? "~" : ""
        var parts: [String] = []
        for part in path.dropFirst(root.count).split(separator: "/", omittingEmptySubsequences: false) {
            if part.isEmpty || part == "." { continue }
            if part == ".." {
                if parts.isEmpty { return nil }
                parts.removeLast()
                continue
            }
            parts.append(String(part))
        }
        let joined = "\(root)/\(parts.joined(separator: "/"))"
        if joined == "~/" { return "~" }
        let trimmed = joined.hasSuffix("/") && joined != "/" ? String(joined.dropLast()) : joined
        return trimmed.isEmpty ? "/" : trimmed
    }

    private static func replacingExactCommands(_ text: String, into commands: inout [String]) -> String {
        guard let regex = try? NSRegularExpression(pattern: #"(?:commande exacte|exact command)\s*`([^`]{1,400})`"#, options: [.caseInsensitive]) else { return text }
        let ns = text as NSString
        let matches = regex.matches(in: text, range: NSRange(location: 0, length: ns.length))
        guard !matches.isEmpty else { return text }
        var result = ""
        var cursor = text.startIndex
        for match in matches {
            guard let whole = Range(match.range, in: text) else { continue }
            result += text[cursor..<whole.lowerBound]
            result += " "
            if match.range(at: 1).location != NSNotFound, let range = Range(match.range(at: 1), in: text) {
                let folded = normalizeCommand(String(text[range]))
                if !folded.isEmpty { commands.append(folded) }
            }
            cursor = whole.upperBound
        }
        result += text[cursor...]
        return result
    }

    private static func normalizeCommand(_ line: String) -> String {
        line.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: #"[ \t]+"#, with: " ", options: .regularExpression)
    }

    private static func fold(_ text: String) -> String {
        let stripped = text.applyingTransform(.stripDiacritics, reverse: false) ?? text
        var out = ""
        for scalar in stripped.lowercased().unicodeScalars {
            if scalar == "\u{2019}" || scalar == "\u{2018}" { out.append("'") }
            else { out.unicodeScalars.append(scalar) }
        }
        return out
    }

    private static func words(_ text: String) -> [String] {
        let cleared = fold(text).replacingOccurrences(of: "`[^`]*`", with: " ", options: .regularExpression)
        return cleared.split { character in
            guard let scalar = character.unicodeScalars.first, character.unicodeScalars.count == 1 else { return true }
            let value = scalar.value
            let word = (value >= 97 && value <= 122) || (value >= 48 && value <= 57) || scalar == "'" || scalar == "-"
            return !word
        }.flatMap { piece in
            piece.split(separator: "'").map(String.init).filter { !$0.isEmpty }
        }
    }

    private static func has(_ list: [String], words: [String]) -> Bool {
        words.contains { list.contains($0) }
    }

    private static let actionWords: [RuleAction: [String]] = [
        .read: ["lire", "lecture", "lis", "lit", "consulter", "consultation", "voir", "afficher", "lister", "liste", "chercher", "rechercher", "read", "reading", "reads", "view", "list", "search", "get", "fetch", "open", "ouvrir", "regarder"],
        .write: ["ecrire", "ecriture", "modifier", "modification", "modifications", "creer", "creation", "editer", "edition", "enregistrer", "sauvegarder", "renommer", "deplacer", "copier", "write", "writing", "edit", "edits", "create", "update", "save", "modify", "rename", "move", "copy", "changer", "change", "changes"],
        .delete: ["supprimer", "suppression", "suppressions", "effacer", "detruire", "retirer", "delete", "deletion", "remove", "erase", "destroy", "rm"],
        .command: ["commande", "commandes", "terminal", "shell", "executer", "execution", "script", "scripts", "command", "commands", "run", "bash", "lancer"],
        .send: ["envoyer", "envoi", "envois", "publier", "poster", "repondre", "reponse", "transferer", "send", "sending", "post", "reply", "publish", "forward", "sms", "texto"],
        .web: ["web", "internet", "naviguer", "navigation", "site", "sites", "browse", "browser", "navigateur", "url"],
        .payment: ["payer", "paiement", "paiements", "achat", "achats", "acheter", "facturer", "rembourser", "remboursement", "virement", "pay", "payment", "payments", "purchase", "buy", "charge", "refund", "transfer", "money", "argent"],
    ]

    private static let objectWords: [RuleObject: [String]] = [
        .file: ["fichier", "fichiers", "dossier", "dossiers", "document", "documents", "file", "files", "folder", "folders", "directory", "directories", "repertoire"],
        .mail: ["courriel", "courriels", "email", "emails", "e-mail", "e-mails", "mail", "mails", "messagerie"],
        .web: ["page", "pages", "site", "sites", "web"],
        .command: ["commande", "commandes", "command", "commands", "terminal", "shell"],
    ]

    private static let productWords: [[String]] = [
        ["connectwise", "cw", "psa"],
        ["github"],
        ["slack"],
        ["outlook", "microsoft", "m365", "office", "office365"],
        ["gmail"],
        ["teams"],
        ["calendrier", "agenda", "calendar"],
        ["twilio"],
        ["bookstack"],
        ["tailscale"],
        ["perspicax"],
    ]
}
