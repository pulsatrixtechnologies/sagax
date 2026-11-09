// Rules, the desktop's rule sets (`RulesSetsPage.tsx`, #3030): RULES.md is
// the first set, every other set is rules/<slug>.md, each with a name, an
// order and an on/off switch. Sets that are on load in that order right
// after the Personality. A text save carries the hash it was read at; a 409
// (the bot wrote it meanwhile) offers Reload or Save mine anyway.
import CompanionCore
import SwiftUI

struct BotRuleSetsPage: View {
    @EnvironmentObject private var session: Session
    let bot: Bot

    @State private var listing: RulesListing?
    @State private var failure: String?
    @State private var busy = false
    @State private var naming: Naming?
    @State private var nameDraft = ""
    @State private var deleting: RuleSetWire?
    @State private var editing: RuleSetWire?

    /// The name alert: a new set, or a rename of one.
    private enum Naming: Identifiable {
        case create
        case rename(RuleSetWire)
        var id: String {
            switch self {
            case .create: "create"
            case let .rename(set): "rename.\(set.id)"
            }
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("When it wants to… it should… Per-action approvals are in Before it acts.")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.horizontal, Theme.Profile.cardMargin + 4)
                    .accessibilityIdentifier("rule-sets.intro")
                content
            }
            .padding(.vertical, 16)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(Text("Rules"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(isPresented: Binding(get: { editing != nil }, set: { if !$0 { editing = nil } })) {
            if let editing {
                BotRuleSetEditor(bot: bot, ruleSet: editing) { listing = $0 }
            }
        }
        .alert(
            namingTitle,
            isPresented: Binding(get: { naming != nil }, set: { if !$0 { naming = nil } })
        ) {
            TextField("Name of the new set", text: $nameDraft)
                .accessibilityIdentifier("rule-sets.name-field")
            Button("Cancel", role: .cancel) {}
            Button("Save") { commitName() }
                .disabled(nameDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .confirmationDialog(
            Text("Delete"),
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .hidden,
            presenting: deleting
        ) { set in
            Button("Delete", role: .destructive) { run { try await $0.deleteRuleSet(botId: bot.id, setId: set.id) } }
            Button("Cancel", role: .cancel) {}
        } message: { set in
            Text("Delete the rule set “\(name(of: set))” and its rules? Its text can be restored from History.")
        }
        .task(id: bot.id) { await load() }
        .refreshable { await load() }
        .accessibilityIdentifier("rule-sets")
    }

    private var namingTitle: Text {
        if case .rename = naming { return Text("Rename") }
        return Text("Add a set")
    }

    @ViewBuilder
    private var content: some View {
        if let listing {
            if listing.sets.isEmpty {
                Text("No rule set. Add one to give this bot hard constraints.")
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.horizontal, Theme.Profile.cardMargin + 4)
            } else {
                ProfileCard {
                    ForEach(Array(listing.sets.enumerated()), id: \.element.id) { index, set in
                        if index > 0 { ProfileDivider() }
                        row(set, index: index, count: listing.sets.count)
                    }
                }
                Text("Sets that are on load in this order, right after the Personality.")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textTertiary)
                    .padding(.horizontal, Theme.Profile.cardMargin + 4)
            }
            if listing.sets.count < listing.maxSets {
                Button {
                    Haptics.selection()
                    nameDraft = ""
                    naming = .create
                } label: {
                    Label("Add a set", systemImage: "plus")
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.textPrimary)
                        .padding(.horizontal, 14)
                        .frame(height: 36)
                        .background(Theme.cardRaised, in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(busy)
                .padding(.horizontal, Theme.Profile.cardMargin)
                .accessibilityIdentifier("rule-sets.add")
            } else {
                Text("A bot has at most \(listing.maxSets) rule sets.")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textTertiary)
                    .padding(.horizontal, Theme.Profile.cardMargin + 4)
            }
        } else if let failure {
            VStack(alignment: .leading, spacing: 8) {
                Text(verbatim: failure).foregroundStyle(Theme.textSecondary)
                Button("Retry") { Task { await load() } }
                    .accessibilityIdentifier("rule-sets.retry")
            }
            .padding(.horizontal, Theme.Profile.cardMargin + 4)
        } else {
            ProgressView().frame(maxWidth: .infinity).padding(.top, 24)
        }
    }

    private func name(of set: RuleSetWire) -> String {
        set.name ?? String(localized: "Rules")
    }

    private func subtitle(_ set: RuleSetWire) -> String {
        guard set.enabled else { return String(localized: "Off") }
        let total = set.ruleCount
        return total == 0 ? String(localized: "No rule")
            : total == 1 ? String(localized: "1 rule") : String(localized: "\(total) rules")
    }

    private func row(_ set: RuleSetWire, index: Int, count: Int) -> some View {
        HStack(spacing: 4) {
            Button {
                Haptics.selection()
                editing = set
            } label: {
                ProfileRow(
                    icon: ProfileRowIcon(systemImage: "list.bullet.rectangle", size: 16),
                    title: Text(verbatim: name(of: set)),
                    subtitle: Text(verbatim: subtitle(set)),
                    height: Theme.Profile.routineRow
                )
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("rule-sets.row.\(set.id)")
            Toggle(isOn: Binding(
                get: { set.enabled },
                set: { on in run { try await $0.setRuleSetEnabled(botId: bot.id, setId: set.id, enabled: on) } }
            )) { Text(verbatim: name(of: set)) }
                .labelsHidden()
                .disabled(busy)
                .accessibilityIdentifier("rule-sets.toggle.\(set.id)")
            Menu {
                if index > 0 {
                    Button { move(set, by: -1) } label: { Label("Move \(name(of: set)) up", systemImage: "arrow.up") }
                }
                if index < count - 1 {
                    Button { move(set, by: 1) } label: { Label("Move \(name(of: set)) down", systemImage: "arrow.down") }
                }
                // the default set (RULES.md) keeps its name and stays
                if set.id != "rules" {
                    Button {
                        nameDraft = set.name ?? ""
                        naming = .rename(set)
                    } label: { Label("Rename", systemImage: "pencil") }
                    Button(role: .destructive) { deleting = set } label: {
                        Label("Delete \(name(of: set))", systemImage: "trash")
                    }
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(width: 36, height: 44)
                    .contentShape(Rectangle())
            }
            .disabled(busy)
            .accessibilityLabel(Text("More"))
            .accessibilityIdentifier("rule-sets.menu.\(set.id)")
            .padding(.trailing, 8)
        }
    }

    private func move(_ set: RuleSetWire, by offset: Int) {
        guard var ids = listing?.sets.map(\.id), let from = ids.firstIndex(of: set.id) else { return }
        let to = from + offset
        guard ids.indices.contains(to) else { return }
        ids.swapAt(from, to)
        run { try await $0.reorderRuleSets(botId: bot.id, ids: ids) }
    }

    private func commitName() {
        let typed = String(nameDraft.trimmingCharacters(in: .whitespacesAndNewlines).prefix(listing?.maxNameLength ?? 60))
        guard !typed.isEmpty, let naming else { return }
        switch naming {
        case .create: run { try await $0.createRuleSet(botId: bot.id, name: typed) }
        case let .rename(set): run { try await $0.renameRuleSet(botId: bot.id, setId: set.id, name: typed) }
        }
    }

    private func run(_ call: @escaping (CompanionClient) async throws -> RulesListing) {
        guard let client = session.settingsClient else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                listing = try await call(client)
                Haptics.selection()
            } catch {
                session.actionError = error.localizedDescription
            }
        }
    }

    private func load() async {
        guard let client = session.settingsClient else { return }
        do {
            listing = try await client.ruleSets(botId: bot.id)
            failure = nil
        } catch {
            failure = error.localizedDescription
        }
    }
}

/// One set's text: Save / Cancel, a discard question when there are edits,
/// and the 409 choice when the bot saved the file meanwhile.
struct BotRuleSetEditor: View {
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    let bot: Bot
    let ruleSet: RuleSetWire
    let onSaved: (RulesListing) -> Void

    @State private var draft: String
    @State private var base: String
    @State private var hash: String
    @State private var saving = false
    @State private var conflict: (current: String, hash: String)?
    @State private var confirmingDiscard = false
    @State private var savedNote = false

    init(bot: Bot, ruleSet: RuleSetWire, onSaved: @escaping (RulesListing) -> Void) {
        self.bot = bot
        self.ruleSet = ruleSet
        self.onSaved = onSaved
        _draft = State(initialValue: ruleSet.text)
        _base = State(initialValue: ruleSet.text)
        _hash = State(initialValue: ruleSet.hash)
    }

    private var dirty: Bool { draft != base }
    private var title: String { ruleSet.name ?? String(localized: "Rules") }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if !ruleSet.enabled {
                    Text("This set is off: it does not load until you turn it on.")
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                }
                MarkdownEditor(
                    text: $draft, minHeight: 320,
                    accessibilityLabel: title,
                    identifier: "rule-set-editor"
                )
                if savedNote {
                    Text("Saved. The next turn uses it.")
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("rule-set-editor.saved")
                }
            }
            .padding()
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(Text(verbatim: title))
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(dirty)
        .toolbar {
            if dirty {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { confirmingDiscard = true }
                        .accessibilityIdentifier("rule-set-editor.cancel")
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { Task { await save(expectedHash: hash) } }
                    .disabled(!dirty || saving)
                    .accessibilityIdentifier("rule-set-editor.save")
            }
        }
        .confirmationDialog(Text("Discard changes?"), isPresented: $confirmingDiscard, titleVisibility: .visible) {
            Button("Discard changes", role: .destructive) {
                draft = base
                dismiss()
            }
            Button("Keep editing", role: .cancel) {}
        }
        .alert(
            Text("This file changed"),
            isPresented: Binding(get: { conflict != nil }, set: { if !$0 { conflict = nil } })
        ) {
            Button("Reload") {
                if let conflict {
                    base = conflict.current
                    draft = conflict.current
                    hash = conflict.hash
                }
            }
            Button("Save mine anyway", role: .destructive) {
                let fresh = conflict?.hash
                Task { await save(expectedHash: fresh) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This file changed since you opened it, probably the bot. Reload its version, or save yours over it.")
        }
    }

    private func save(expectedHash: String?) async {
        guard let client = session.settingsClient else { return }
        saving = true
        defer { saving = false }
        do {
            switch try await client.saveRuleSetText(botId: bot.id, setId: ruleSet.id, text: draft, expectedHash: expectedHash) {
            case let .saved(listing):
                base = draft
                hash = listing.sets.first { $0.id == ruleSet.id }?.hash ?? hash
                savedNote = true
                onSaved(listing)
                Haptics.selection()
            case let .conflict(current, currentHash):
                conflict = (current, currentHash)
            }
        } catch {
            session.actionError = error.localizedDescription
        }
    }
}
