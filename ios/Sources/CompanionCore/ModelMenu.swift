// The composer's model menu (desktop #477, #478, #518): with an empty
// search its root is Auto, the bot's model, the current model when neither
// of them is it, the person's favorites, then one row per provider that
// opens its models in a submenu. A search lists every provider's matches
// flat. In Simple mode the providers sit behind one "All models ›" row.
// Only the models that can run a turn now are offered; the model in use
// stays, checked, saying it does not respond.
//
// Ported from src/lib/model-menu.ts, src/lib/model-favorites.ts,
// src/lib/model-health.ts and the menu sections of ModelPicker.tsx. The
// phone has no per-person engine list (`/api/me/engines`), so on an
// organization server the server's own answer for each engine stands, as
// on the desktop while that list loads.
import Foundation

public struct ModelMenuRow: Hashable, Sendable, Identifiable {
    public enum Kind: String, Hashable, Sendable { case auto, follow, model }

    /// Unique in the list: a model's favorite key (`ModelFavorites.key`).
    public var key: String
    public var kind: Kind
    public var instanceId: String?
    public var modelId: String?
    /// The model's name, in primary ink.
    public var label: String
    /// Its effort, variant or origin, in secondary ink.
    public var detail: String?
    /// Short markers after the detail (Default, Loaded).
    public var tags: [String] = []
    /// The choice in effect: checked.
    public var current: Bool
    /// More words the search matches (the engine's name, the model id).
    public var keywords: String?
    /// The model in use cannot run a turn now: said beside it.
    public var notResponding = false

    public var id: String { key }

    public init(key: String, kind: Kind, instanceId: String? = nil, modelId: String? = nil, label: String, detail: String? = nil, tags: [String] = [], current: Bool, keywords: String? = nil, notResponding: Bool = false) {
        self.key = key
        self.kind = kind
        self.instanceId = instanceId
        self.modelId = modelId
        self.label = label
        self.detail = detail
        self.tags = tags
        self.current = current
        self.keywords = keywords
        self.notResponding = notResponding
    }
}

public struct ModelMenuSection: Hashable, Sendable, Identifiable {
    public var key: String
    /// The heading (a provider, Local); none for the top rows.
    public var label: String?
    public var rows: [ModelMenuRow]

    public var id: String { key }

    public init(key: String, label: String? = nil, rows: [ModelMenuRow]) {
        self.key = key
        self.label = label
        self.rows = rows
    }
}

public struct ModelMenuProvider: Hashable, Sendable, Identifiable {
    public var section: ModelMenuSection
    /// The current model is one of its rows.
    public var current: Bool
    public var id: String { section.key }
}

public struct ModelMenuRoot: Hashable, Sendable {
    /// Auto, the bot's model: the section without a heading.
    public var top: [ModelMenuRow]
    /// The model in effect when no top row is checked and it is no favorite.
    public var current: ModelMenuRow?
    /// The starred models still offered, in the order they were starred.
    public var favorites: [ModelMenuRow]
    public var providers: [ModelMenuProvider]
}

/// The words the sections carry, in the person's language.
public struct ModelMenuLabels: Sendable {
    public var auto: String
    public var autoHint: String
    public var useBotModel: @Sendable (String) -> String
    public var local: String
    public var defaultTag: String
    public var loadedTag: String

    public init(auto: String, autoHint: String, useBotModel: @escaping @Sendable (String) -> String, local: String, defaultTag: String, loadedTag: String) {
        self.auto = auto
        self.autoHint = autoHint
        self.useBotModel = useBotModel
        self.local = local
        self.defaultTag = defaultTag
        self.loadedTag = loadedTag
    }
}

public enum ModelMenu {
    /// Models that run on this computer: their own section, whatever engine runs them.
    public static let localSectionKey = "local:this-computer"

    // MARK: Search

    /// Lower case, accents dropped: "élevé" matches "eleve".
    public static func fold(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).lowercased()
    }

    /// Every word of the query must appear in the row's name, detail, tags,
    /// keywords or its section's heading. Sections left empty are dropped.
    public static func filter(_ sections: [ModelMenuSection], query: String) -> [ModelMenuSection] {
        let words = fold(query).split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard !words.isEmpty else { return sections.filter { !$0.rows.isEmpty } }
        return sections.compactMap { section in
            let rows = section.rows.filter { row in
                let haystack = fold(([section.label, row.label, row.detail] + row.tags.map(Optional.some) + [row.keywords, row.modelId])
                    .compactMap { $0 }.joined(separator: " "))
                return words.allSatisfy { haystack.contains($0) }
            }
            return rows.isEmpty ? nil : ModelMenuSection(key: section.key, label: section.label, rows: rows)
        }
    }

    // MARK: Root

    /// The root of the menu. The top section is the one without a
    /// heading; every other section is a provider.
    public static func root(_ sections: [ModelMenuSection], favorites: [String]) -> ModelMenuRoot {
        let top = sections.filter { $0.label == nil }.flatMap(\.rows)
        let engines = sections.filter { $0.label != nil && !$0.rows.isEmpty }
        let models = engines.flatMap { $0.rows.filter { $0.kind == .model } }
        let starred = favorites.compactMap { key in models.first { $0.key == key } }
        let current = top.contains(where: \.current) ? nil : models.first(where: \.current)
        return ModelMenuRoot(
            top: top,
            current: current.flatMap { favorites.contains($0.key) ? nil : $0 },
            favorites: starred,
            providers: engines.map { ModelMenuProvider(section: $0, current: $0.rows.contains(where: \.current)) }
        )
    }

    // MARK: Health (src/lib/model-health.ts)

    /// The engine runs turns: installed and started on the computer.
    public static func engineRuns(_ instance: Instance) -> Bool {
        instance.snapshot.isAvailable
    }

    /// Whether this model of this engine can run a turn now.
    public static func modelUsable(_ instance: Instance, modelId: String, organization: Bool) -> Bool {
        guard engineRuns(instance), let option = instance.models.options.first(where: { $0.id == modelId }) else { return false }
        let local = Set(ModelPickerRules.groups(instance.models.options, organization: organization).local.map(\.id))
        // an organization server never offers its own custom models
        if organization && option.custom == true && !local.contains(option.id) { return false }
        if local.contains(option.id) { return true }
        // a cloud model needs a sign-in or a key
        return organization || instance.snapshot.authenticated != false
    }

    // MARK: Sections (ModelPicker.tsx `menuSections`)

    /// Auto and the bot's model, each provider the bot can use with only
    /// its models that run, then Local. `follows` is nil outside a thread
    /// (or on an older server); `engineLabel` names a provider.
    public static func sections(
        instances: [Instance],
        selection: ModelSelection,
        botModel: ModelSelection,
        botName: String,
        follows: Bool?,
        organization: Bool,
        allowedEngines: [String]?,
        disabledModels: [String]? = nil,
        myDisabledModels: [String]? = nil,
        labels: ModelMenuLabels,
        engineLabel: (Instance) -> String
    ) -> [ModelMenuSection] {
        let disabled = Set((disabledModels ?? []) + (myDisabledModels ?? []))
        let modelOn: (String, String) -> Bool = { !disabled.contains("\($0)/\($1)") }
        let autoOn = selection.auto == true
        let botInstance = instances.first { $0.instanceId == botModel.instanceId }
        let botOption = botInstance?.models.options.first { $0.id == botModel.model }
        var top = [ModelMenuRow(key: "auto", kind: .auto, label: labels.auto, detail: labels.autoHint, current: autoOn)]
        if let follows, botModel.auto == true || modelOn(botModel.instanceId, botModel.model) {
            top.append(ModelMenuRow(
                key: "follow", kind: .follow, label: labels.useBotModel(botName),
                detail: botOption?.label ?? botModel.model, current: follows,
                keywords: botName,
                notResponding: botInstance.map { !modelUsable($0, modelId: botModel.model, organization: organization) } ?? false
            ))
        }
        let pinned = !autoOn && follows != true
        let listed = ModelPickerRules.listed(instances, allowed: allowedEngines, organization: organization, selectedId: selection.instanceId)
        let ordered = listed.filter { $0.instanceId == selection.instanceId } + listed.filter { $0.instanceId != selection.instanceId }
        let menuInstances = ordered.filter { instance in
            guard engineRuns(instance) else { return false }
            return !organization || instance.instanceId == selection.instanceId || ModelPickerRules.engineAllowed(allowedEngines, instance.instanceId)
        }
        // the bot's own engine when it cannot run: the model in use still shows
        let hidden = pinned ? ordered.filter { $0.instanceId == selection.instanceId && !engineRuns($0) } : []
        let currentModel = selection.model

        var sections = [ModelMenuSection(key: "top", rows: top)]
        var localRows: [ModelMenuRow] = []
        for instance in hidden + menuInstances {
            let groups = ModelPickerRules.groups(instance.models.options, organization: organization)
            let localIds = Set(groups.local.map(\.id))
            let ownCurrent = pinned && instance.instanceId == selection.instanceId
            let wanted = ownCurrent ? (currentModel.isEmpty ? instance.models.default : currentModel) : nil
            var rows: [ModelMenuRow] = []
            for option in groups.cloud + groups.local {
                guard modelOn(instance.instanceId, option.id) else { continue }
                let isCurrent = option.id == wanted
                let usable = modelUsable(instance, modelId: option.id, organization: organization)
                guard isCurrent || usable else { continue }
                var tags: [String] = []
                if option.id == instance.models.default { tags.append(labels.defaultTag) }
                if option.loaded == true { tags.append(labels.loadedTag) }
                rows.append(ModelMenuRow(
                    key: ModelFavorites.key(instanceId: instance.instanceId, modelId: option.id), kind: .model,
                    instanceId: instance.instanceId, modelId: option.id, label: option.label, detail: groups.local.contains(where: { $0.id == option.id }) ? option.subtext : nil, tags: tags,
                    current: isCurrent, keywords: [instance.displayName, option.id].compactMap { $0 }.joined(separator: " "),
                    notResponding: isCurrent && !usable
                ))
            }
            localRows += rows.filter { localIds.contains($0.modelId ?? "") }
            let cloud = rows.filter { !localIds.contains($0.modelId ?? "") }
            if !cloud.isEmpty { sections.append(ModelMenuSection(key: instance.instanceId, label: engineLabel(instance), rows: cloud)) }
        }
        let unique = uniqueLocalRows(localRows, localTag: labels.local)
        if !unique.isEmpty { sections.append(ModelMenuSection(key: localSectionKey, label: labels.local, rows: unique)) }
        return sections
    }

    /// Every engine may offer the same local model: each once, the one in
    /// use kept. The label is the model name alone; the server shows as the
    /// detail (shared by, server) only when it applies.
    static func uniqueLocalRows(_ rows: [ModelMenuRow], localTag: String) -> [ModelMenuRow] {
        var order: [String] = []
        var kept: [String: ModelMenuRow] = [:]
        for row in rows {
            let id = row.modelId ?? row.key
            if let existing = kept[id], !(row.current && !existing.current) { continue }
            var next = row
            next.tags = row.tags.filter { $0 != localTag && $0.lowercased() != "local" }
            if kept[id] == nil { order.append(id) }
            kept[id] = next
        }
        return order.compactMap { kept[$0] }
    }

    // MARK: Simple or Advanced (src/lib/interface-mode.ts)

    /// The synced preference that holds the choice.
    public static let interfaceModeKey = "sagax.interfaceMode.v1"

    /// Advanced unless Simple was chosen (2026-10-16: Advanced is the
    /// default for everyone, solo or organization, any role). The one-time
    /// move of a stored Simple to Advanced runs on the desktop and the
    /// organization server; this app only reads the choice.
    public static func isSimple(stored: String?) -> Bool {
        stored == "simple"
    }
}

/// The models a person starred (src/lib/model-favorites.ts): stored under
/// the synced preference `sagax.modelFavorites.v1` as `[[instanceId,
/// modelId], ...]`, oldest first. A favorite whose engine or model is gone
/// is kept and simply not shown.
public enum ModelFavorites {
    public static let preferenceKey = "sagax.modelFavorites.v1"
    /// A bound, not a quota: the value must fit one preference (8 KiB).
    public static let max = 40
    private static let maxId = 200

    /// The id of a favorite, the same as the menu row's key for that model.
    public static func key(instanceId: String, modelId: String) -> String {
        "\(instanceId)\u{0}\(modelId)"
    }

    static func split(_ key: String) -> (String, String)? {
        guard let at = key.firstIndex(of: "\u{0}"), at > key.startIndex, key.index(after: at) < key.endIndex else { return nil }
        return (String(key[..<at]), String(key[key.index(after: at)...]))
    }

    public static func parse(_ raw: String?) -> [String] {
        guard let raw, let data = raw.data(using: .utf8),
              let entries = (try? JSONSerialization.jsonObject(with: data)) as? [Any] else { return [] }
        var keys: [String] = []
        for entry in entries {
            guard let pair = entry as? [Any], pair.count == 2,
                  let instanceId = pair[0] as? String, let modelId = pair[1] as? String,
                  !instanceId.isEmpty, !modelId.isEmpty, instanceId.utf16.count <= maxId, modelId.utf16.count <= maxId,
                  !instanceId.contains("\u{0}") else { continue }
            let key = key(instanceId: instanceId, modelId: modelId)
            if !keys.contains(key) { keys.append(key) }
        }
        return Array(keys.suffix(max))
    }

    public static func serialize(_ keys: [String]) -> String {
        let pairs = keys.suffix(max).compactMap(split).map { [$0.0, $0.1] }
        guard let data = try? JSONSerialization.data(withJSONObject: pairs, options: [.withoutEscapingSlashes]) else { return "[]" }
        return String(decoding: data, as: UTF8.self)
    }

    /// Adds the model at the end, or removes it when it is already there.
    public static func toggled(_ keys: [String], _ key: String) -> [String] {
        guard split(key) != nil else { return keys }
        return keys.contains(key) ? keys.filter { $0 != key } : Array((keys + [key]).suffix(max))
    }
}

/// The providers a person pinned to the model menu (src/lib/model-provider-pins.ts):
/// the synced preference `sagax.modelProviderPins.v1`, a JSON array of provider
/// ids (the section keys, in the order pinned), at most `max`. The menu lists
/// those providers and "All models" opens the rest, each with its pin. With
/// nothing pinned the menu shows the bot's own provider and the two providers
/// whose models the person starred most (the catalog's order after that).
public enum ModelProviderPins {
    public static let preferenceKey = "sagax.modelProviderPins.v1"
    public static let max = 3
    private static let maxId = 200

    /// What the menu knows of one provider.
    public struct Candidate: Equatable, Sendable {
        public var key: String
        /// How many of its models the person starred.
        public var starred: Int
        /// The bot's model is one of its models.
        public var current: Bool

        public init(key: String, starred: Int, current: Bool) {
            self.key = key
            self.starred = starred
            self.current = current
        }
    }

    public enum Change: Equatable, Sendable {
        case pins([String])
        /// A fourth pin: nothing changes; say to unpin one first.
        case full
    }

    public static func parse(_ raw: String?) -> [String] {
        guard let raw, let data = raw.data(using: .utf8),
              let entries = (try? JSONSerialization.jsonObject(with: data)) as? [Any] else { return [] }
        var pins: [String] = []
        for entry in entries {
            guard let key = entry as? String, !key.isEmpty, key.utf16.count <= maxId, !pins.contains(key) else { continue }
            pins.append(key)
        }
        return Array(pins.prefix(max))
    }

    public static func serialize(_ pins: [String]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: Array(pins.prefix(max)), options: [.withoutEscapingSlashes]) else { return "[]" }
        return String(decoding: data, as: UTF8.self)
    }

    /// The current provider, then the most starred (a tie keeps the catalog's order).
    public static func defaults(_ candidates: [Candidate]) -> [String] {
        let current = candidates.filter(\.current).map(\.key)
        let rest = candidates.enumerated()
            .filter { !$0.element.current }
            .sorted { $0.element.starred != $1.element.starred ? $0.element.starred > $1.element.starred : $0.offset < $1.offset }
            .map(\.element.key)
        return Array((current + rest).prefix(max))
    }

    /// The pins in effect: the person's own (those whose provider is still
    /// listed), else the default.
    public static func effective(stored: [String], candidates: [Candidate]) -> [String] {
        let listed = Set(candidates.map(\.key))
        let own = stored.filter { listed.contains($0) }
        return own.isEmpty ? defaults(candidates) : own
    }

    /// Pins the provider, or unpins it when pinned. A fourth pin is refused.
    public static func toggled(_ pins: [String], _ key: String) -> Change {
        if pins.contains(key) { return .pins(pins.filter { $0 != key }) }
        if pins.count >= max { return .full }
        return .pins(pins + [key])
    }
}
