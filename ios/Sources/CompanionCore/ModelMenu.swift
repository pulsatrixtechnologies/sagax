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
    public var pinAccount = false
    /// M-20261119-015: the account this row runs on (the name the person
    /// gave it, else its address), while the provider has two or more.
    public var account: String?
    /// M-20261119-015: "Special access": only this one of the person's
    /// sign-in accounts offers the model (shared/model-accounts.ts).
    public var badge: String?
    /// The badge's explanation ("Only <account> offers this model").
    public var badgeHint: String?

    public var id: String { key }

    public init(key: String, kind: Kind, instanceId: String? = nil, modelId: String? = nil, label: String, detail: String? = nil, tags: [String] = [], current: Bool, keywords: String? = nil, notResponding: Bool = false, account: String? = nil, badge: String? = nil, badgeHint: String? = nil) {
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
        self.account = account
        self.badge = badge
        self.badgeHint = badgeHint
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
    /// M-20261119-015: the badge of a model only one account offers.
    public var specialAccess: String
    public var specialAccessHint: @Sendable (String) -> String
    /// An account with neither a name nor an address ("Account 2").
    public var accountNumbered: @Sendable (Int) -> String

    public init(
        auto: String, autoHint: String, useBotModel: @escaping @Sendable (String) -> String, local: String, defaultTag: String, loadedTag: String,
        specialAccess: String = "Special access",
        specialAccessHint: @escaping @Sendable (String) -> String = { "Only \($0) offers this model" },
        accountNumbered: @escaping @Sendable (Int) -> String = { "Account \($0)" }
    ) {
        self.auto = auto
        self.autoHint = autoHint
        self.useBotModel = useBotModel
        self.local = local
        self.defaultTag = defaultTag
        self.loadedTag = loadedTag
        self.specialAccess = specialAccess
        self.specialAccessHint = specialAccessHint
        self.accountNumbered = accountNumbered
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
                key: "follow", kind: .follow, instanceId: botModel.auto == true ? nil : botModel.instanceId,
                modelId: botModel.auto == true ? nil : botModel.model, label: labels.useBotModel(botName),
                detail: botOption?.label ?? botModel.model, current: follows,
                keywords: botName,
                notResponding: botModel.auto != true && (botInstance.map { !modelUsable($0, modelId: botModel.model, organization: organization) } ?? false)
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
        sections = namingAccounts(sections, instances: hidden + menuInstances, labels: labels, engineLabel: engineLabel)
        let unique = uniqueLocalRows(localRows, localTag: labels.local)
        if !unique.isEmpty { sections.append(ModelMenuSection(key: localSectionKey, label: labels.local, rows: unique)) }
        return sections
    }

    // MARK: Accounts (shared/model-accounts.ts, M-20261119-015)

    /// A tool's own name never names an account (shared/harness-matrix.ts HARNESS_TOOL_NAME).
    static let toolNames: Set<String> = [
        "claude code", "claude api", "codex", "grok", "xai api", "pi", "openai-compatible", "mistral", "groq", "cerebras",
        "meta", "antigravity", "gemini cli", "opencode", "qwen code", "cline", "cursor",
    ]

    /// The words that name an account: the name the person gave it, else its
    /// sign-in address; nil with neither (the caller numbers it).
    public static func accountWords(displayName: String?, email: String?, providerLabel: String) -> String? {
        let name = displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let provider = providerLabel.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if !name.isEmpty, name.lowercased() != provider, !toolNames.contains(name.lowercased()) { return name }
        let address = email?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return address.isEmpty ? nil : address
    }

    /// Sign-ins of one tool are accounts (several Claude accounts, several
    /// ChatGPT plans); two tools of one sign-in (Codex and the ChatGPT plan)
    /// are not, nor a pasted key or an engine with no catalogue of its own.
    static func signInKind(_ instance: Instance) -> String? {
        guard instance.access != "api", instance.access != "custom" else { return nil }
        return "\(instance.driverKind):\(instance.snapshot.chatgptPlan == true ? "plan" : "tool")"
    }

    /// The person's accounts beside `instance`: the sign-ins of the same tool
    /// under the same provider name, in order (it among them).
    static func providerAccounts(of instance: Instance, among instances: [Instance], engineLabel: (Instance) -> String) -> [Instance] {
        guard let kind = signInKind(instance) else { return [] }
        let label = engineLabel(instance)
        var seen = Set<String>()
        return instances.filter { signInKind($0) == kind && engineLabel($0) == label && seen.insert($0.instanceId).inserted }
    }

    /// The account an engine stands for, while its provider has two or more
    /// accounts among `instances` (the menu, the composer's chip); nil otherwise.
    public static func accountLabel(_ instance: Instance, among instances: [Instance], labels: ModelMenuLabels, engineLabel: (Instance) -> String) -> String? {
        let accounts = providerAccounts(of: instance, among: instances, engineLabel: engineLabel)
        guard accounts.count >= 2, let at = accounts.firstIndex(where: { $0.instanceId == instance.instanceId }) else { return nil }
        return accountWords(displayName: instance.displayName, email: instance.snapshot.account?.email, providerLabel: engineLabel(instance))
            ?? labels.accountNumbered(at + 1)
    }

    /// Each engine is its own section here: while a provider has two or more
    /// accounts, each heading and row says its account, and a model only one
    /// of the sign-in accounts offers wears the "Special access" badge.
    static func namingAccounts(_ sections: [ModelMenuSection], instances: [Instance], labels: ModelMenuLabels, engineLabel: (Instance) -> String) -> [ModelMenuSection] {
        let listed = instances.filter { instance in sections.contains { $0.key == instance.instanceId } }
        return sections.map { section in
            guard let instance = listed.first(where: { $0.instanceId == section.key }),
                  let account = accountLabel(instance, among: listed, labels: labels, engineLabel: engineLabel) else { return section }
            // the badge reads the connected sign-ins' own lists (shared/provider-catalog.ts
            // onlyAccount), never the rows shown now: a signed-out account kept for the
            // bot's model lists no model of the other account as its alone
            let connected = providerAccounts(of: instance, among: listed, engineLabel: engineLabel)
                .filter { engineRuns($0) && $0.snapshot.authenticated != false }
            let badged = connected.count >= 2 && connected.contains { $0.instanceId == instance.instanceId }
            var next = section
            next.label = "\(engineLabel(instance)) · \(account)"
            next.rows = section.rows.map { row in
                var row = row
                row.account = account
                if badged, let model = row.modelId {
                    let offering = connected.filter { other in other.models.options.contains { $0.id == model } }
                    if offering.count == 1 {
                        row.badge = labels.specialAccess
                        row.badgeHint = labels.specialAccessHint(account)
                    }
                }
                return row
            }
            return next
        }
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

/// The models a person starred (src/lib/model-favorites.ts): the server's
/// own list, `favoriteModels` of `GET`/`PUT /api/me/models`, each
/// `"<engine>/<model>"` (`modelKey`, shared/offered-models.ts), oldest first,
/// at most 40, 300 characters each. A favorite whose engine or model is gone
/// is kept and simply not shown. The menu row's key is the same string.
public enum ModelFavorites {
    /// The server's bounds (server/config.ts).
    public static let max = 40
    public static let maxKey = 300
    /// The device's old record, before the list lived on the server: it is
    /// read once to move its stars over, then dropped.
    public static let legacyPreferenceKey = "sagax.modelFavorites.v1"

    /// The id of a favorite: the server's key, also the menu row's key for that model.
    public static func key(instanceId: String, modelId: String) -> String {
        "\(instanceId)/\(modelId)"
    }

    /// Only the first slash splits: a model id may hold one (OpenRouter's "vendor/model").
    static func split(_ key: String) -> (String, String)? {
        guard let at = key.firstIndex(of: "/"), at > key.startIndex, key.index(after: at) < key.endIndex else { return nil }
        return (String(key[..<at]), String(key[key.index(after: at)...]))
    }

    /// The list as the server sends it: broken or repeated entries dropped, the newest 40 kept.
    public static func clean(_ list: [String]) -> [String] {
        var keys: [String] = []
        for key in list where split(key) != nil && key.utf16.count <= maxKey && !keys.contains(key) {
            keys.append(key)
        }
        return Array(keys.suffix(max))
    }

    /// Adds the model at the end, or removes it when it is already there.
    public static func toggled(_ keys: [String], _ key: String) -> [String] {
        guard split(key) != nil, key.utf16.count <= maxKey else { return keys }
        return keys.contains(key) ? keys.filter { $0 != key } : Array((keys + [key]).suffix(max))
    }

    /// The device's old record (`[[instanceId, modelId], ...]`) as server keys.
    public static func parseLegacy(_ raw: String?) -> [String] {
        guard let raw, let data = raw.data(using: .utf8),
              let entries = (try? JSONSerialization.jsonObject(with: data)) as? [Any] else { return [] }
        return clean(entries.compactMap { entry in
            guard let pair = entry as? [Any], pair.count == 2,
                  let instanceId = pair[0] as? String, let modelId = pair[1] as? String,
                  !instanceId.isEmpty, !modelId.isEmpty, !instanceId.contains("/") else { return nil }
            return key(instanceId: instanceId, modelId: modelId)
        })
    }
}
