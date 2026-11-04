// Changing several bots at once from the home selection (Edit N bots): the
// phone's mirror of `shared/bulk-bot-edit.ts`. Every field is "do not
// change" until it is touched; only touched fields are sent, bot by bot,
// through the same routes as the bot's own editor (PATCH /api/bots/:id, the
// grants route), so each bot is journaled as an individual
// edit and refused for its own reasons. A list (Shared with, the MCP servers
// of Access) changes by Add, Remove or Replace with. The
// bots' values before are kept so the last bulk change can be undone the
// same way.
import Foundation

// MARK: - A JSON value

/// A field value as it rides the PATCH body, comparable without regard to
/// key order (`stableValueKey`).
public indirect enum BulkValue: Hashable, Sendable, Encodable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([BulkValue])
    case object([String: BulkValue])

    public static func strings(_ items: [String]) -> BulkValue { .array(items.map(BulkValue.string)) }

    /// A JSON object read by `JSONSerialization`.
    public init(json: Any?) {
        switch json {
        case nil, is NSNull: self = .null
        case let number as NSNumber:
            // NSNumber carries JSON booleans too
            if CFGetTypeID(number) == CFBooleanGetTypeID() { self = .bool(number.boolValue) } else { self = .number(number.doubleValue) }
        case let text as String: self = .string(text)
        case let list as [Any]: self = .array(list.map { BulkValue(json: $0) })
        case let dict as [String: Any]: self = .object(dict.mapValues { BulkValue(json: $0) })
        default: self = .null
        }
    }

    /// Any Encodable value as it would be sent.
    public static func encoding<T: Encodable>(_ value: T) -> BulkValue {
        guard let data = try? JSONEncoder().encode(value),
              let json = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        else { return .null }
        return BulkValue(json: json)
    }

    public var isNull: Bool { self == .null }

    public var stringValue: String? { if case let .string(text) = self { return text } else { return nil } }
    public var boolValue: Bool? { if case let .bool(on) = self { return on } else { return nil } }
    public var stringList: [String]? {
        guard case let .array(items) = self else { return nil }
        return items.compactMap(\.stringValue)
    }

    public func decoded<T: Decodable>(as type: T.Type) -> T? {
        guard let data = try? JSONEncoder().encode(self) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    /// `stableValueKey`: a JSON text that does not depend on key order.
    public var stableKey: String {
        switch self {
        case .null: return "null"
        case let .bool(on): return on ? "true" : "false"
        case let .number(value):
            if value.rounded() == value, abs(value) < 1e15 { return String(Int64(value)) }
            return String(value)
        case let .string(text):
            let data = (try? JSONEncoder().encode(text)) ?? Data()
            return String(decoding: data, as: UTF8.self)
        case let .array(items): return "[" + items.map(\.stableKey).joined(separator: ",") + "]"
        case let .object(dict):
            let entries = dict.sorted { $0.key < $1.key }
            return "{" + entries.map { BulkValue.string($0.key).stableKey + ":" + $0.value.stableKey }.joined(separator: ",") + "}"
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case let .bool(on): try c.encode(on)
        case let .number(value):
            if value.rounded() == value, abs(value) < 1e15 { try c.encode(Int64(value)) } else { try c.encode(value) }
        case let .string(text): try c.encode(text)
        case let .array(items): try c.encode(items)
        case let .object(dict): try c.encode(dict)
        }
    }
}

/// A patch: field name to value. A field absent is "do not change".
public typealias BulkPatch = [String: BulkValue]

// MARK: - Lists

public enum BulkListMode: String, CaseIterable, Hashable, Sendable {
    case add, remove, replace
}

public struct BulkListEdit: Hashable, Sendable {
    public var mode: BulkListMode
    public var items: [String]

    public init(mode: BulkListMode, items: [String]) {
        self.mode = mode
        self.items = items
    }
}

/// One value the bots share, or each bot's own.
public enum BulkCommonValue<Value: Hashable & Sendable>: Hashable, Sendable {
    case same(Value?)
    case mixed([BulkBotValue<Value>])

    public var isMixed: Bool { if case .mixed = self { return true } else { return false } }
    public var shared: Value? { if case let .same(value) = self { return value } else { return nil } }
}

public struct BulkBotValue<Value: Hashable & Sendable>: Hashable, Sendable {
    public var botId: String
    public var value: Value?

    public init(botId: String, value: Value?) {
        self.botId = botId
        self.value = value
    }
}

/// The confirmations that ride with a patch (`BULK_CONSENT_KEYS`): never a
/// field to compare, show or undo.
public enum BulkBotEdit {
    public static let consentKeys: Set<String> = [
        "confirmFullAccess", "acknowledgeLocalAuto", "acknowledgePeerScope", "applyToAllThreads", "threadId", "stepUp",
    ]

    /// The list a bot ends with. Add keeps the bot's order and appends what
    /// it lacks; Remove drops the items; Replace is exactly the items.
    public static func applyListEdit(_ current: [String], _ edit: BulkListEdit) -> [String] {
        let items = unique(edit.items)
        switch edit.mode {
        case .replace: return items
        case .remove:
            let gone = Set(items)
            return current.filter { !gone.contains($0) }
        case .add:
            let have = Set(current)
            return current + items.filter { !have.contains($0) }
        }
    }

    /// Whether a list edit changes this bot's list at all.
    public static func listEditChanges(_ current: [String], _ edit: BulkListEdit) -> Bool {
        applyListEdit(current, edit) != current
    }

    /// The items every bot has: what Replace starts from.
    public static func commonListItems(_ lists: [[String]]) -> [String] {
        guard let first = lists.first else { return [] }
        let rest = lists.dropFirst().map(Set.init)
        return first.filter { item in rest.allSatisfy { $0.contains(item) } }
    }

    /// `stableValueKey` of an optional value (nil and null are "not set").
    public static func stableValueKey(_ value: BulkValue?) -> String { (value ?? .null).stableKey }

    /// `commonValue`: one value when every bot has it, else each bot's own.
    public static func commonValue(_ rows: [BulkBotValue<BulkValue>]) -> BulkCommonValue<BulkValue> {
        guard let first = rows.first else { return .same(nil) }
        let key = stableValueKey(first.value)
        if rows.allSatisfy({ stableValueKey($0.value) == key }) { return .same(first.value) }
        return .mixed(rows)
    }

    /// The same for any comparable value (a grant list, a profile list).
    public static func commonValue<Value: Hashable & Sendable>(_ rows: [BulkBotValue<Value>]) -> BulkCommonValue<Value> {
        guard let first = rows.first else { return .same(nil) }
        if rows.allSatisfy({ $0.value == first.value }) { return .same(first.value) }
        return .mixed(rows)
    }

    /// The fields a patch changes (its consent flags left out).
    public static func patchFields(_ patch: BulkPatch) -> [String] {
        patch.keys.filter { !consentKeys.contains($0) }.sorted()
    }

    /// A field this bot already has at the patch's value is not sent again;
    /// a patch with nothing left is empty (its consents go too).
    public static func patchForBot(_ bot: BulkPatch, _ patch: BulkPatch) -> BulkPatch {
        var out: BulkPatch = [:]
        var changes = false
        for (key, value) in patch {
            if consentKeys.contains(key) { out[key] = value; continue }
            if stableValueKey(bot[key]) == stableValueKey(value) { continue }
            out[key] = value
            changes = true
        }
        return changes ? out : [:]
    }

    /// What puts the patched fields back: each field's value before (a
    /// field that was not set goes back to null).
    public static func revertPatch(_ before: BulkPatch, _ patch: BulkPatch) -> BulkPatch {
        var out: BulkPatch = [:]
        for key in patchFields(patch) { out[key] = before[key] ?? .null }
        return out
    }

    /// Full access always carries its confirmation, as the bot's own editor
    /// sends it (`BotPanelPatch.approval(.full)`); the other levels never.
    ///
    /// A new model names the bot's thread (`botLevelPatch`, #1674): the
    /// bot's model changes and that thread follows it, as in Edit bot. A bot
    /// with several threads refuses a model change that names none.
    public static func withConsents(_ patch: BulkPatch, threadId: String? = nil) -> BulkPatch {
        var out = patch
        out.removeValue(forKey: "threadId")
        if patch["approvalMode"] == .string(ApprovalLevel.full.rawValue) {
            out["confirmFullAccess"] = .bool(true)
            out["applyToAllThreads"] = .bool(true)
        }
        if let threadId, !threadId.isEmpty, let model = patch["modelSelection"], model != .null {
            out["threadId"] = .string(threadId)
        }
        return out
    }

    // MARK: Grants

    /// Shared with: the grants to put (PUT) and to take away (DELETE) for one
    /// bot. Each person or team keeps the level chosen for it (a person
    /// already there at another level moves to it); Remove ignores levels.
    public static func grantSteps(_ current: [BotGrantRecord], _ mode: BulkListMode, _ wanted: [BotGrantRecord]) -> BulkGrantSteps {
        var byTarget: [String: GrantLevel] = [:]
        for grant in current { byTarget[grant.target] = grant.level }
        // one per target: the last level given wins, the first place stays
        var order: [String] = []
        var levels: [String: GrantLevel] = [:]
        for grant in wanted {
            if levels[grant.target] == nil { order.append(grant.target) }
            levels[grant.target] = grant.level
        }
        let unique = order.map { BotGrantRecord(target: $0, level: levels[$0]!) }
        if mode == .remove {
            return BulkGrantSteps(put: [], remove: unique.map(\.target).filter { byTarget[$0] != nil })
        }
        let put = unique.filter { byTarget[$0.target] != $0.level }
        let keep = Set(order)
        let remove = mode == .replace ? current.map(\.target).filter { !keep.contains($0) } : []
        return BulkGrantSteps(put: put, remove: remove)
    }

    /// What puts a bot's grants back as they were.
    public static func grantRevertSteps(before: [BotGrantRecord], after: [BotGrantRecord]) -> BulkGrantSteps {
        let was = Set(before.map(\.target))
        var now: [String: GrantLevel] = [:]
        for grant in after { now[grant.target] = grant.level }
        return BulkGrantSteps(
            put: before.filter { now[$0.target] != $0.level },
            remove: after.map(\.target).filter { !was.contains($0) }
        )
    }

    // MARK: MCP servers

    /// The MCP servers a bot mounts after a list edit. A bot without its own
    /// list mounts every enabled server; the edit starts from that set.
    public static func mcpServersAfter(_ current: [String]?, enabled: [String], _ edit: BulkListEdit) -> [String] {
        applyListEdit(current ?? enabled, edit)
    }

    // MARK: Outcomes

    public static func outcomeCounts(_ outcomes: [BulkBotOutcome]) -> BulkOutcomeCounts {
        BulkOutcomeCounts(
            ok: outcomes.filter { $0.ok && !$0.skipped }.count,
            failed: outcomes.filter { !$0.ok }.count,
            skipped: outcomes.filter { $0.ok && $0.skipped }.count
        )
    }

    private static func unique(_ items: [String]) -> [String] {
        var seen = Set<String>()
        return items.filter { seen.insert($0).inserted }
    }
}

/// Shared with's edit: Add, Remove or Replace with these grants.
public struct BulkGrantEdit: Hashable, Sendable {
    public var mode: BulkListMode
    public var items: [BotGrantRecord]

    public init(mode: BulkListMode, items: [BotGrantRecord]) {
        self.mode = mode
        self.items = items
    }
}

public struct BulkGrantSteps: Hashable, Sendable {
    public var put: [BotGrantRecord]
    public var remove: [String]

    public init(put: [BotGrantRecord], remove: [String]) {
        self.put = put
        self.remove = remove
    }

    public var isEmpty: Bool { put.isEmpty && remove.isEmpty }
}

/// One bot's outcome. `skipped`: nothing to change for it.
public struct BulkBotOutcome: Hashable, Sendable, Identifiable {
    public var botId: String
    public var ok: Bool
    public var skipped: Bool
    /// Why the bot refused, in the server's words.
    public var reasons: [String]

    public var id: String { botId }

    public init(botId: String, ok: Bool, skipped: Bool = false, reasons: [String] = []) {
        self.botId = botId
        self.ok = ok
        self.skipped = skipped
        self.reasons = reasons
    }
}

public struct BulkOutcomeCounts: Hashable, Sendable {
    public var ok: Int
    public var failed: Int
    public var skipped: Int
}

// MARK: - The bot's fields

/// The fields of the bot's own editor that a bulk change reaches through
/// `PATCH /api/bots/:id`, in the sheet's order.
public enum BulkBotField: String, CaseIterable, Hashable, Sendable {
    case modelSelection, computer, mcpServers, browser, notifications, speakReplies, voice, approvalMode

    /// The value as the editor shows it and the server takes it back: a
    /// default the record leaves out is spelled out (browser on, replies not
    /// read aloud, the workspace voice), so "not set" and the default read
    /// the same and an undo sends a value the route accepts.
    public func value(of bot: Bot) -> BulkValue {
        switch self {
        case .modelSelection: return .encoding(bot.modelSelection)
        case .computer:
            guard let place = bot.computer, !place.isEmpty, place != "auto" else { return .null }
            return .string(place)
        case .mcpServers: return bot.mcpServers.map(BulkValue.strings) ?? .null
        case .browser: return .bool(bot.browser != false)
        case .notifications: return .bool(bot.notifications)
        case .speakReplies: return .bool(bot.speakReplies == true)
        case .voice: return .string(bot.voice ?? "")
        case .approvalMode:
            return .string(ApprovalLevel.of(approvalMode: bot.approvalSettingMode, autoApprove: bot.autoApprove).rawValue)
        }
    }

    /// The SurfaceGate field a control asks for (`canEditBotField`).
    public var gateField: String { rawValue }

    public static func snapshot(_ bot: Bot) -> BulkPatch {
        var out: BulkPatch = [:]
        for field in allCases { out[field.rawValue] = field.value(of: bot) }
        return out
    }
}

// MARK: - The plan

/// What a bulk change asks for: the fields to set, and the list edits.
public struct BulkBotEditPlan: Hashable, Sendable {
    /// Fields of `BulkBotField`; consents are added per bot.
    public var fields: BulkPatch
    /// The MCP servers of Access, by Add, Remove or Replace with.
    public var mcpServers: BulkListEdit?
    /// Shared with: each person or team with the level chosen for it.
    public var grants: BulkGrantEdit?

    public init(fields: BulkPatch = [:], mcpServers: BulkListEdit? = nil, grants: BulkGrantEdit? = nil) {
        self.fields = fields
        self.mcpServers = mcpServers
        self.grants = grants
    }

    public var isEmpty: Bool { fields.isEmpty && mcpServers == nil && grants == nil }

    /// The PATCH body for one bot: the touched fields it does not already
    /// have, the MCP list it ends with, and the consents they need.
    public func patch(for bot: Bot, enabledServers: [String]) -> BulkPatch {
        var wanted = fields
        // a bot that mounts every enabled server keeps doing so while the
        // edit leaves that set as it is
        if let mcpServers, BulkBotEdit.listEditChanges(bot.mcpServers ?? enabledServers, mcpServers) {
            wanted["mcpServers"] = .strings(BulkBotEdit.mcpServersAfter(bot.mcpServers, enabled: enabledServers, mcpServers))
        }
        let patch = BulkBotEdit.patchForBot(BulkBotField.snapshot(bot), wanted)
        return patch.isEmpty ? [:] : BulkBotEdit.withConsents(patch, threadId: bot.threadId)
    }
}

/// One line of the summary before Apply: "Model → X".
public struct BulkSummaryLine: Hashable, Sendable {
    public var field: String
    public var value: String

    public init(field: String, value: String) {
        self.field = field
        self.value = value
    }
}

public enum BulkSummary {
    /// "4 bots · Model → X · Voice → Y", the lines joined in order.
    public static func text(botCount: Int, botsWord: (Int) -> String, lines: [BulkSummaryLine]) -> String {
        ([botsWord(botCount)] + lines.map { "\($0.field) → \($0.value)" }).joined(separator: " · ")
    }

    /// A list edit read out: "+ a, b", "− a", "= a, b" (none: "nothing").
    public static func listValue(_ edit: BulkListEdit, label: (String) -> String, none: String) -> String {
        let names = edit.items.map(label)
        let joined = names.isEmpty ? none : names.joined(separator: ", ")
        switch edit.mode {
        case .add: return "+ " + joined
        case .remove: return "- " + joined
        case .replace: return "= " + joined
        }
    }
}

// MARK: - Applying and undoing

/// The routes a bulk change goes through: the same as the bot's own editor.
public protocol BulkBotEditAPI: Sendable {
    func patchBotFields(botId: String, patch: BulkPatch) async throws -> Bot
    func botGrants(botId: String) async throws -> BotGrants
    func putGrant(botId: String, target: String, level: GrantLevel) async throws -> BotGrants
    func removeGrant(botId: String, target: String) async throws -> BotGrants
}

extension CompanionClient: BulkBotEditAPI {
    /// `PATCH /api/bots/:id` with exactly these fields (null clears).
    public func patchBotFields(botId: String, patch: BulkPatch) async throws -> Bot {
        try await send(patchBotFieldsRequest(botId: botId, patch: patch), as: BotResponse.self).bot
    }

    public func patchBotFieldsRequest(botId: String, patch: BulkPatch) throws -> URLRequest {
        guard Self.validRouteID(botId), !patch.isEmpty else { throw APIError.badURL }
        return try makeRequest("PATCH", "/api/bots/\(botId)", encodedBody: patch)
    }
}

/// What one bot had before the change, for the undo.
public struct BulkBotUndo: Hashable, Sendable {
    public var botId: String
    /// The bot's thread a model change names (`withConsents`).
    public var threadId: String?
    /// The fields to send back (`revertPatch`), consents added when sent.
    public var patch: BulkPatch
    public var grantsBefore: [BotGrantRecord]?
    public var grantsAfter: [BotGrantRecord]?

    public init(botId: String, threadId: String? = nil, patch: BulkPatch = [:], grantsBefore: [BotGrantRecord]? = nil,
                grantsAfter: [BotGrantRecord]? = nil) {
        self.botId = botId
        self.threadId = threadId
        self.patch = patch
        self.grantsBefore = grantsBefore
        self.grantsAfter = grantsAfter
    }

    public var isEmpty: Bool { patch.isEmpty && grantsBefore == nil }
}

/// The result of a bulk change: one outcome per bot, the bots as the server
/// answered them, and what undoes it.
public struct BulkBotEditResult: Sendable {
    public var outcomes: [BulkBotOutcome]
    public var updated: [Bot]
    public var undo: [BulkBotUndo]

    public init(outcomes: [BulkBotOutcome] = [], updated: [Bot] = [], undo: [BulkBotUndo] = []) {
        self.outcomes = outcomes
        self.updated = updated
        self.undo = undo
    }
}

public enum BulkBotEditRunner {
    /// Applies the plan in series, bot by bot: the PATCH, then the grants.
    /// A bot that refuses one step keeps the
    /// others' results; its outcome carries every reason.
    public static func apply(
        _ plan: BulkBotEditPlan, bots: [Bot], enabledServers: [String], api: BulkBotEditAPI,
        reason: @Sendable (Error) -> String
    ) async -> BulkBotEditResult {
        var result = BulkBotEditResult()
        for bot in bots {
            var reasons: [String] = []
            var changed = false
            var undo = BulkBotUndo(botId: bot.id, threadId: bot.threadId)
            let patch = plan.patch(for: bot, enabledServers: enabledServers)
            if !patch.isEmpty {
                do {
                    let updated = try await api.patchBotFields(botId: bot.id, patch: patch)
                    result.updated.append(updated)
                    undo.patch = BulkBotEdit.revertPatch(BulkBotField.snapshot(bot), patch)
                    changed = true
                } catch {
                    reasons.append(reason(error))
                }
            }
            if let edit = plan.grants {
                do {
                    let before = try await api.botGrants(botId: bot.id).grants.map { BotGrantRecord(target: $0.target, level: $0.level) }
                    let steps = BulkBotEdit.grantSteps(before, edit.mode, edit.items)
                    if !steps.isEmpty {
                        var after = before
                        for grant in steps.put {
                            do { after = try await api.putGrant(botId: bot.id, target: grant.target, level: grant.level).records }
                            catch { reasons.append(reason(error)) }
                        }
                        for target in steps.remove {
                            do { after = try await api.removeGrant(botId: bot.id, target: target).records }
                            catch { reasons.append(reason(error)) }
                        }
                        if after != before {
                            undo.grantsBefore = before
                            undo.grantsAfter = after
                            changed = true
                        }
                    }
                } catch {
                    reasons.append(reason(error))
                }
            }
            if !undo.isEmpty { result.undo.append(undo) }
            result.outcomes.append(BulkBotOutcome(botId: bot.id, ok: reasons.isEmpty, skipped: reasons.isEmpty && !changed, reasons: reasons))
        }
        return result
    }

    /// Puts each bot back as it was before the last bulk change, through the
    /// same routes: the fields and grants.
    public static func undo(_ steps: [BulkBotUndo], api: BulkBotEditAPI, reason: @Sendable (Error) -> String) async -> BulkBotEditResult {
        var result = BulkBotEditResult()
        for step in steps {
            var reasons: [String] = []
            if !step.patch.isEmpty {
                do { result.updated.append(try await api.patchBotFields(botId: step.botId, patch: BulkBotEdit.withConsents(step.patch, threadId: step.threadId))) }
                catch { reasons.append(reason(error)) }
            }
            if let before = step.grantsBefore, let after = step.grantsAfter {
                let revert = BulkBotEdit.grantRevertSteps(before: before, after: after)
                for grant in revert.put {
                    do { _ = try await api.putGrant(botId: step.botId, target: grant.target, level: grant.level) }
                    catch { reasons.append(reason(error)) }
                }
                for target in revert.remove {
                    do { _ = try await api.removeGrant(botId: step.botId, target: target) }
                    catch { reasons.append(reason(error)) }
                }
            }
            result.outcomes.append(BulkBotOutcome(botId: step.botId, ok: reasons.isEmpty, reasons: reasons))
        }
        return result
    }
}

public extension BotGrants {
    /// The grants as records (target and level).
    var records: [BotGrantRecord] { grants.map { BotGrantRecord(target: $0.target, level: $0.level) } }
}
