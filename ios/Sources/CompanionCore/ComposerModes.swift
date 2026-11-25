// Composer mode selection and model menu navigation on iPhone and iPad.
import Foundation

public enum ComposerMode: String, CaseIterable, Hashable, Sendable {
    case auto, fast, expert, heavy, build

    /// The modes that pick a model by their own rule (everything but Auto).
    public static let forced: [ComposerMode] = [.fast, .expert, .heavy, .build]
}

public enum ComposerModes {
    /// The mode a selection is in: nil for a model the person pinned (Manual).
    /// A stored value that is no mode reads as plain Auto.
    public static func mode(of selection: ModelSelection) -> ComposerMode? {
        guard selection.auto == true else { return nil }
        if let raw = selection.mode, let mode = ComposerMode(rawValue: raw), mode != .auto { return mode }
        return .auto
    }

    /// The selection a mode writes: the bot's engine and fallback model stay,
    /// the Auto flag goes on, the mode is stored for Fast, Expert and Heavy;
    /// a variant goes; plain Auto keeps (or starts) its Optimize choice.
    public static func selection(_ selection: ModelSelection, for mode: ComposerMode) -> ModelSelection {
        var next = selection
        next.auto = true
        next.variant = nil
        if mode == .auto {
            next.mode = nil
            next.autoOptimize = selection.autoOptimize ?? .balance
        } else {
            next.mode = mode.rawValue
            next.autoOptimize = nil
        }
        return next
    }

    // MARK: Manual (D-20261119-083, the desktop's manualProviders, src/lib/model-menu.ts)

    /// What Manual lists: the bot's model, the starred favorites, then every
    /// provider with each of its accounts.
    public struct ManualList: Hashable, Sendable {
        /// The bot's model ("Use Ara's model"); never Auto (a mode, above).
        public var top: [ModelMenuRow]
        /// The starred models still offered, as they were starred; they keep
        /// their account and badge (no heading names it here).
        public var favorites: [ModelMenuRow]
        public var providers: [ManualProvider]
    }

    /// One provider (Claude, OpenAI, Grok, Local) and its accounts.
    public struct ManualProvider: Hashable, Sendable, Identifiable {
        public var key: String
        public var label: String
        public var accounts: [ManualAccount]
        public var id: String { key }
        /// The model in use is one of its rows.
        public var current: Bool { accounts.contains { $0.rows.contains(where: \.current) } }
    }

    /// One account of a provider: the sign-in or key its models run on.
    public struct ManualAccount: Hashable, Sendable, Identifiable {
        /// Why an account cannot run a turn now (the desktop's "Signed out",
        /// "Not responding").
        public enum State: String, Hashable, Sendable { case signedOut, notResponding }
        public var instanceId: String
        /// Its name, while the provider has two or more accounts or this one
        /// cannot run; nil for a provider's only account that runs.
        public var label: String?
        public var state: State?
        /// Its models; none for a signed-out account (its heading and state stay).
        public var rows: [ModelMenuRow]
        public var id: String { instanceId }
    }

    /// D-20261119-083 (owner, M-20261119-077): every model grouped by
    /// provider, then by the account it runs on, each account with its state;
    /// an account with no model it can run now (signed out) keeps its heading
    /// and its state. The heading names the account, so the rows under it
    /// drop their own account words and the "Special access" badge (a model
    /// only one account offers is listed under it alone). `sections` is
    /// `ModelMenu.sections` (one per engine, then Local); `instances` every
    /// engine of the person, a signed-out one included.
    public static func manual(
        _ sections: [ModelMenuSection],
        favorites: [String],
        instances: [Instance],
        allowedEngines: [String]?,
        organization: Bool,
        selectedId: String,
        labels: ModelMenuLabels,
        engineLabel: (Instance) -> String
    ) -> ManualList {
        let root = ModelMenu.root(sections, favorites: favorites)
        let listed = ModelPickerRules.listed(instances, allowed: allowedEngines, organization: organization, selectedId: selectedId)
        let ordered = listed.filter { $0.instanceId == selectedId } + listed.filter { $0.instanceId != selectedId }
        var providerOrder: [String] = []
        var members: [String: [Instance]] = [:]
        let providerOf = Dictionary(ordered.map { ($0.instanceId, engineLabel($0)) }, uniquingKeysWith: { first, _ in first })
        func place(_ instance: Instance) {
            let key = providerOf[instance.instanceId] ?? instance.instanceId
            if members[key] == nil { providerOrder.append(key) }
            if !(members[key] ?? []).contains(where: { $0.instanceId == instance.instanceId }) { members[key, default: []].append(instance) }
        }
        // the providers in the menu's order, then the accounts that list nothing now
        for section in sections where section.label != nil && section.key != ModelMenu.localSectionKey {
            if let instance = ordered.first(where: { $0.instanceId == section.key }) { place(instance) }
        }
        for instance in ordered where manualState(instance, organization: organization) != nil { place(instance) }
        func rowsOf(_ instanceId: String) -> [ModelMenuRow] {
            (sections.first { $0.key == instanceId }?.rows ?? []).map { row in
                var shown = row
                shown.account = nil
                shown.badge = nil
                shown.badgeHint = nil
                return shown
            }
        }
        var providers: [ManualProvider] = providerOrder.map { key in
            let accounts = members[key] ?? []
            return ManualProvider(key: key, label: key, accounts: accounts.enumerated().map { index, instance in
                let state = manualState(instance, organization: organization)
                let named = accounts.count >= 2 || state != nil
                let label = named
                    ? (ModelMenu.accountWords(displayName: instance.displayName, email: instance.snapshot.account?.email, providerLabel: key)
                        ?? (accounts.count >= 2 ? labels.accountNumbered(index + 1) : instance.displayName ?? labels.accountNumbered(1)))
                    : nil
                return ManualAccount(instanceId: instance.instanceId, label: label, state: state, rows: rowsOf(instance.instanceId))
            })
        }
        if let local = sections.first(where: { $0.key == ModelMenu.localSectionKey }), !local.rows.isEmpty {
            providers.append(ManualProvider(key: local.key, label: local.label ?? labels.local, accounts: [ManualAccount(instanceId: local.key, label: nil, state: nil, rows: local.rows)]))
        }
        return ManualList(top: root.top.filter { $0.kind == .follow }, favorites: root.favorites, providers: providers)
    }

    /// The desktop's account state (EngineSetup needsSignIn, engineRuns): a
    /// tool that runs but is signed out, else one that does not run. An
    /// organization's server signs its engines in itself.
    public static func manualState(_ instance: Instance, organization: Bool) -> ManualAccount.State? {
        if !ModelMenu.engineRuns(instance) { return .notResponding }
        if !organization && instance.snapshot.authenticated == false { return .signedOut }
        return nil
    }

    /// The Manual list a search keeps: every word in a row's name, detail,
    /// tags or keywords, or its provider's or account's name. Accounts and
    /// providers left empty go; the bot's model and the favorites are
    /// searched the same way.
    public static func filter(_ list: ManualList, query: String) -> ManualList {
        let words = ModelMenu.fold(query).split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard !words.isEmpty else { return list }
        let keep = { (rows: [ModelMenuRow], heading: String?) -> [ModelMenuRow] in
            ModelMenu.filter([ModelMenuSection(key: "q", label: heading, rows: rows)], query: query).first?.rows ?? []
        }
        let providers = list.providers.compactMap { provider -> ManualProvider? in
            let accounts = provider.accounts.compactMap { account -> ManualAccount? in
                let rows = keep(account.rows, [provider.label, account.label].compactMap { $0 }.joined(separator: " "))
                return rows.isEmpty ? nil : ManualAccount(instanceId: account.instanceId, label: account.label, state: account.state, rows: rows)
            }
            return accounts.isEmpty ? nil : ManualProvider(key: provider.key, label: provider.label, accounts: accounts)
        }
        return ManualList(top: keep(list.top, nil), favorites: keep(list.favorites, nil), providers: providers)
    }
}

extension ComposerModes {
    public struct Preview: Decodable, Sendable {
        public struct Pick: Decodable, Sendable {
            public var instanceId: String
            public var model: String
        }
        public struct Resolution: Decodable, Sendable {
            public var pick: Pick?
            public var effort: String?
        }
        public struct Excluded: Decodable, Sendable {
            public var instanceId: String
            public var model: String?
            public var reason: String
        }
        public var excluded: [Excluded]?
        public var modes: [String: Resolution]?
        public var pick: Pick?
    }

    public static func offered(_ preview: Preview?) -> [ComposerMode] {
        ComposerMode.allCases.filter { $0 == .auto || preview?.modes == nil || preview?.modes?[$0.rawValue]?.pick != nil }
    }

    public struct Reasoning: Equatable, Sendable {
        public var shown: Bool
        public var disabled: Bool
        public var value: String?
        public var choices: [String?]
        public var variants: [ModelVariantOption]?

        public func label(_ level: String?, automatic: Bool) -> String {
            if let variants {
                guard let level else { return String(localized: "Use session setting") }
                return variants.first { $0.id == level }.map(ModelVariantRules.label) ?? level
            }
            guard let level else { return automatic ? String(localized: "Auto") : String(localized: "Default") }
            let name = UltracodeEffort.label(level)
            return Bundle.main.localizedString(forKey: "model.effortLevel.\(level)", value: name, table: nil)
        }

        public func choosing(_ level: String?, in selection: ModelSelection) -> ModelSelection {
            var next = selection
            if variants != nil {
                next.variant = level
                next.effort = nil
            } else { next.effort = level }
            return next
        }
    }

    public static func reasoning(selection: ModelSelection, instances: [Instance], preview: Preview?) -> Reasoning {
        let mode = mode(of: selection)
        let resolution = mode.flatMap { preview?.modes?[$0.rawValue] }
        if mode == .fast || mode == .expert || mode == .heavy {
            return Reasoning(shown: resolution?.effort != nil, disabled: true, value: resolution?.effort, choices: [])
        }
        let pick = resolution?.pick ?? (mode == .auto ? preview?.pick : nil)
        let instance = instances.first { $0.instanceId == (pick?.instanceId ?? selection.instanceId) }
        let option = instance?.models.options.first { $0.id == (pick?.model ?? selection.model) }
        if instance?.capabilities?.modelVariants == true {
            let variants = option?.variants ?? []
            let value = selection.variant
            return Reasoning(shown: !variants.isEmpty || value != nil, disabled: false, value: value, choices: [nil] + variants.map { $0.id }, variants: variants)
        }
        let engine = instance?.capabilities?.effortLevels ?? []
        let levels = ModelEffort.pickerLevels(option, engine: engine)
        guard !levels.isEmpty else { return Reasoning(shown: false, disabled: true, choices: []) }
        let fallback = mode == .auto ? nil : ModelEffort.defaultLevel(option, engine: engine)
        let chosen = selection.effort.flatMap { levels.contains($0) ? $0 : nil }
        return Reasoning(shown: true, disabled: false, value: chosen ?? fallback,
                         choices: (fallback == nil ? [nil] : []) + levels.map(Optional.some))
    }

    public enum Panel: Hashable {
        case root, reasoning, providers, accounts(String), models(String, String)
    }

    public static func open(_ provider: ManualProvider) -> Panel {
        guard provider.accounts.count == 1, let account = provider.accounts.first else { return .accounts(provider.id) }
        return .models(provider.id, account.id)
    }

    public static func settle(_ panel: Panel, providers: [ManualProvider]) -> Panel {
        switch panel {
        case let .accounts(id):
            return providers.first { $0.id == id }.map(open) ?? .providers
        case let .models(id, account):
            guard let provider = providers.first(where: { $0.id == id }) else { return .providers }
            return provider.accounts.contains { $0.id == account } ? panel : open(provider)
        default: return panel
        }
    }

    public static func back(_ panel: Panel, providers: [ManualProvider]) -> Panel {
        switch panel {
        case let .models(id, _):
            return providers.first { $0.id == id }?.accounts.count ?? 0 > 1 ? .accounts(id) : .providers
        case .accounts: return .providers
        default: return .root
        }
    }

    /// The person's credentials decide which organization engines and Grok subscription models run.
    public static func organizationInstances(_ instances: [Instance], mine: [MyEngine], models: [String: Set<String>], allowed: [String]?, ownOutside: Bool) -> [Instance] {
        instances.compactMap { instance in
            let access = mine.first { $0.instanceId == instance.instanceId }
            let own = access?.myTurns == "key" || access?.myTurns == "subscription"
            guard ModelPickerRules.engineAllowed(allowed, instance.instanceId) || (own && ownOutside) else { return nil }
            if let access, access.unavailable || (!own && access.myTurns != "org-key") { return nil }
            var offered = instance
            if let ids = models[instance.instanceId], !ids.isEmpty {
                offered.models.options.removeAll { $0.custom != true && !ids.contains($0.id) }
            }
            return offered
        }
    }

    public static func usable(_ list: ManualList, thisComputer: String, excluded: [Preview.Excluded]? = nil) -> ManualList {
        let exclusions = (excluded ?? []).filter { ["limit", "reconnect", "credentials", "refused", "modelOff", "policy"].contains($0.reason) }
        func excludedFromMenu(_ row: ModelMenuRow) -> Bool {
            exclusions.contains { $0.instanceId == row.instanceId && ($0.model == nil || $0.model == row.modelId) }
        }
        var result = list
        result.providers = list.providers.compactMap { provider in
            var next = provider
            next.accounts = provider.accounts.compactMap { account in
                guard account.state == nil else { return nil }
                var runnable = account
                runnable.rows = account.rows.filter { !$0.notResponding && !excludedFromMenu($0) }
                return runnable.rows.isEmpty ? nil : runnable
            }
            if next.key != ModelMenu.localSectionKey {
                var seen = Set<String>()
                for account in next.accounts.indices {
                    for index in next.accounts[account].rows.indices {
                        guard let model = next.accounts[account].rows[index].modelId else { continue }
                        next.accounts[account].rows[index].pinAccount = !seen.insert(model).inserted
                    }
                }
            } else {
                let rows = next.accounts.flatMap { $0.rows }
                var servers: [ManualAccount] = []
                for var row in rows {
                    let server = row.detail ?? ""
                    row.detail = nil
                    if let index = servers.firstIndex(where: { $0.id == server }) {
                        servers[index].rows.append(row)
                    } else {
                        servers.append(ManualAccount(instanceId: server, label: server.isEmpty ? thisComputer : server, rows: [row]))
                    }
                }
                next.accounts = servers
            }
            return next.accounts.isEmpty ? nil : next
        }
        let keys = Set(result.providers.flatMap { $0.accounts.flatMap { $0.rows.map { $0.key } } })
        result.favorites = list.favorites.filter { keys.contains($0.key) }
        result.top = list.top.filter { row in
            guard !row.notResponding, !excludedFromMenu(row) else { return false }
            guard let instance = row.instanceId, let model = row.modelId else { return true }
            return keys.contains(ModelFavorites.key(instanceId: instance, modelId: model))
        }
        return result
    }
}
