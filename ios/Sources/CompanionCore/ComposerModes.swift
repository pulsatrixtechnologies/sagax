// The composer's mode menu on the phone and the iPad (#5091, the desktop's
// #5088, owner 2026-11-19, M-20261119-077, D-20261119-083): Auto, Fast,
// Expert, Heavy, then Manual (the person's own pinned model). A mode never
// names a model: the server maps it, every turn, to the best models the
// person can use (server/models/model-mode.ts). It rides the Auto flag
// (`auto: true` plus `mode`), as on the desktop (shared/model-mode.ts).
// Manual is every model, the starred favorites first, then each provider
// and each account it runs on.
import Foundation

public enum ComposerMode: String, CaseIterable, Hashable, Sendable {
    case auto, fast, expert, heavy

    /// The modes that pick a model by their own rule (everything but Auto).
    public static let forced: [ComposerMode] = [.fast, .expert, .heavy]
}

public enum ComposerModes {
    /// The mode a selection is in: nil for a model the person pinned (Manual).
    /// A stored value that is no mode (Build, gone) reads as plain Auto.
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
