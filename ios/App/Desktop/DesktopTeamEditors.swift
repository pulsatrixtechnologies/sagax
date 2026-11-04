// iPad final sweep (2026-11-03): the Team map team ⋯ menu's three editors,
// as the desktop draws them in its DetailPanel:
//   - Move bots to <team> (TeamDialog.tsx, managing): the bots of the team
//     checked, uncheck to send one to Unassigned, check to bring one in;
//   - Shared instructions (TeamMapPage.tsx SectionContextDialog): the text
//     every bot of the team reads at the start of each turn, its byte limit;
//   - Team memory (TeamMemoryDialog.tsx): what waits (Remember, Skip), what
//     is shared by kind (edit the detail, remove), Add an entry.
import SwiftUI
import CompanionCore

/// The desktop's DetailPanel: a titled sheet with its footer of pills.
private struct DesktopDetailPanel<Content: View, Footer: View>: View {
    @Environment(\.desktopTheme) private var theme
    let title: Text
    var hint: Text?
    let close: () -> Void
    let closeLabel: Text
    @ViewBuilder let content: () -> Content
    @ViewBuilder let footer: () -> Footer

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    title.font(theme.font(15, .semibold)).foregroundStyle(theme.ink)
                    if let hint { hint.font(theme.font(12)).foregroundStyle(theme.inkSecondary) }
                }
                Spacer()
                Button(action: close) {
                    Image(systemName: "xmark").font(.system(size: 12, weight: .medium)).foregroundStyle(theme.inkSecondary).frame(width: 30, height: 30)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(closeLabel)
            }
            .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 12)
            ScrollView { content().padding(.horizontal, 20).padding(.bottom, 16) }
            HStack(spacing: 8) { footer() }
                .padding(.horizontal, 20).padding(.vertical, 12)
                .overlay(alignment: .top) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1) }
        }
        .background(theme.panel)
    }
}

private struct Pill: View {
    @Environment(\.desktopTheme) private var theme
    let label: Text
    var primary = false
    var icon: String?
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon { Image(systemName: icon).font(.system(size: 11, weight: .semibold)) }
                label.font(theme.font(13, .medium))
            }
            .foregroundStyle(primary ? theme.panel : theme.ink)
            .padding(.horizontal, 14).frame(height: 32)
            .background(Capsule().fill(primary ? theme.ink : theme.raised))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Move bots to <team>

struct DesktopTeamBotsSheet: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let section: String
    let label: String
    let close: () -> Void
    @State private var picked: Set<String> = []
    @State private var initial: Set<String> = []
    @State private var saving = false
    @State private var error = ""

    private var bots: [Bot] { session.state.bots.filter { $0.hidden != true } }

    var body: some View {
        let add = picked.subtracting(initial), remove = initial.subtracting(picked)
        DesktopDetailPanel(title: Text(initial.isEmpty ? "Add bots" : "Add or remove bots"), close: close, closeLabel: Text("Close team dialog")) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Existing bots").font(theme.font(12.5, .medium)).foregroundStyle(theme.inkSecondary)
                Text("\(String(localized: "Checked bots belong to this team. Uncheck a bot to move it to Unassigned.")) \(String(localized: "Moving changes who they can work with and which shared instructions they read. Their chats stay with them."))")
                    .font(theme.font(12)).foregroundStyle(theme.inkTertiary)
                VStack(spacing: 0) {
                    ForEach(bots) { bot in
                        Button { if picked.contains(bot.id) { picked.remove(bot.id) } else { picked.insert(bot.id) } } label: {
                            HStack(spacing: 10) {
                                Image(systemName: picked.contains(bot.id) ? "checkmark.square.fill" : "square")
                                    .foregroundStyle(picked.contains(bot.id) ? theme.accent : theme.inkTertiary)
                                BotMascotView(bot: bot, size: 24).frame(width: 24, height: 24)
                                Text(verbatim: bot.name).font(theme.font(13)).foregroundStyle(theme.ink)
                                Spacer()
                                Text(verbatim: (bot.section ?? "").isEmpty ? String(localized: "Unassigned") : bot.section ?? "")
                                    .font(theme.font(11.5)).foregroundStyle(theme.inkTertiary)
                            }
                            .padding(.horizontal, 12).frame(minHeight: 40)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(picked.contains(bot.id) ? .isSelected : [])
                        .accessibilityIdentifier("team-bots.\(bot.id)")
                    }
                }
                .background(theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                if !error.isEmpty { Text(verbatim: error).font(theme.font(12)).foregroundStyle(theme.danger) }
            }
        } footer: {
            Spacer()
            Pill(label: Text("Cancel")) { close() }
            Pill(label: saving ? Text("Saving…") : Text("Save"), primary: true) {
                Task { await save(add: Array(add), remove: Array(remove)) }
            }
            .disabled(saving || (add.isEmpty && remove.isEmpty))
            .opacity(add.isEmpty && remove.isEmpty ? 0.5 : 1)
            .accessibilityIdentifier("team-bots.save")
        }
        .onAppear {
            initial = Set(bots.filter { ($0.section ?? "").trimmingCharacters(in: .whitespaces) == section }.map(\.id))
            picked = initial
        }
    }

    private func save(add: [String], remove: [String]) async {
        guard let client = session.settingsClient else { return }
        saving = true
        do {
            _ = try await client.manageSectionBots(section: section, add: add, remove: remove)
            await session.refresh()
            close()
        } catch {
            self.error = error.localizedDescription
            saving = false
        }
    }
}

// MARK: - Shared instructions

struct DesktopSectionContextSheet: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let section: String
    let label: String
    let close: () -> Void
    @State private var text = ""
    @State private var saved = ""
    @State private var maxBytes = 8192
    @State private var loading = true
    @State private var saving = false
    @State private var error = ""
    @State private var confirmingDiscard = false

    private var bytes: Int { text.utf8.count }

    var body: some View {
        DesktopDetailPanel(title: Text("\(label) shared instructions"),
                           hint: Text("Shared instructions shown to every bot in this team at the start of each turn. Only you can edit them."),
                           close: requestClose, closeLabel: Text("Close shared instructions")) {
            VStack(alignment: .leading, spacing: 8) {
                if loading {
                    ProgressView().frame(maxWidth: .infinity, minHeight: 160)
                } else {
                    TextEditor(text: $text)
                        .font(theme.font(13))
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 260)
                        .padding(8)
                        .background(theme.inset, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
                        .accessibilityIdentifier("section-context.text")
                    HStack {
                        Spacer()
                        Text(verbatim: "\(bytes) / \(maxBytes)").font(theme.font(11.5)).monospacedDigit()
                            .foregroundStyle(bytes > maxBytes ? theme.danger : theme.inkTertiary)
                    }
                }
                if !error.isEmpty { Text(verbatim: error).font(theme.font(12)).foregroundStyle(theme.danger) }
            }
        } footer: {
            Spacer()
            Pill(label: Text("Cancel")) { requestClose() }
            Pill(label: Text("Save shared instructions"), primary: true, icon: "square.and.arrow.down") { Task { await save() } }
                .disabled(loading || saving || text == saved || bytes > maxBytes)
                .opacity(loading || text == saved || bytes > maxBytes ? 0.5 : 1)
                .accessibilityIdentifier("section-context.save")
        }
        .task {
            guard let client = session.settingsClient else { return }
            do {
                let context = try await client.sectionContext(section: section)
                text = context.text; saved = context.text; maxBytes = context.maxBytes
            } catch { self.error = error.localizedDescription }
            loading = false
        }
        .confirmationDialog(String(localized: "Discard unsaved changes to these shared instructions?"), isPresented: $confirmingDiscard, titleVisibility: .visible) {
            Button(String(localized: "Discard"), role: .destructive) { close() }
        }
    }

    private func requestClose() {
        guard !saving else { return }
        if text != saved { confirmingDiscard = true } else { close() }
    }

    private func save() async {
        guard let client = session.settingsClient else { return }
        saving = true
        defer { saving = false }
        do {
            let context = try await client.saveSectionContext(section: section, text: text)
            text = context.text; saved = context.text; maxBytes = context.maxBytes
            error = ""
        } catch { self.error = error.localizedDescription }
    }
}

// MARK: - Team memory

struct DesktopTeamMemorySheet: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let section: String
    let label: String
    let close: () -> Void
    @State private var entries: [TeamMemoryEntry]?
    @State private var error = ""
    @State private var busy = false
    @State private var adding = false
    @State private var draft = (kind: "term", name: "", detail: "")
    @State private var details: [String: String] = [:]

    private static let kinds = ["person", "place", "decision", "term"]

    private func kindTitle(_ kind: String) -> LocalizedStringKey {
        switch kind { case "person": "People"; case "place": "Places"; case "decision": "Decisions"; default: "Terms" }
    }

    private func kindOne(_ kind: String) -> LocalizedStringKey {
        switch kind { case "person": "Person"; case "place": "Place"; case "decision": "Decision"; default: "Term" }
    }

    var body: some View {
        let proposed = (entries ?? []).filter { $0.status == "proposed" }
        let shared = (entries ?? []).filter { $0.status != "proposed" }
        DesktopDetailPanel(title: Text("\(label) team memory"),
                           hint: Text("People, places, decisions and terms every bot in this section shares. Every bot proposal waits for a member of this team, or an organization admin, before it is shared. Your own additions are shared immediately. Edit or remove anything."),
                           close: close, closeLabel: Text("Close team memory")) {
            VStack(alignment: .leading, spacing: 16) {
                if entries == nil && error.isEmpty { ProgressView().frame(maxWidth: .infinity, minHeight: 160).accessibilityLabel(Text("Loading team memory")) }
                if !error.isEmpty { Text(verbatim: error).font(theme.font(12.5)).foregroundStyle(theme.danger) }
                if !proposed.isEmpty {
                    group(Text("Waiting for you"), count: proposed.count) {
                        ForEach(proposed) { entry in
                            HStack(alignment: .top, spacing: 10) {
                                VStack(alignment: .leading, spacing: 2) {
                                    (Text(kindOne(entry.kind)).foregroundColor(theme.inkSecondary) + Text(verbatim: " · ").foregroundColor(theme.inkSecondary)
                                     + Text(verbatim: entry.name).foregroundColor(theme.ink) + Text(verbatim: ": \(entry.detail)").foregroundColor(theme.ink))
                                        .font(theme.font(13))
                                    if let bot = entry.source?.botName, !bot.isEmpty {
                                        Text("from \(bot)").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                                    }
                                }
                                Spacer()
                                Pill(label: Text("Skip")) { run { try await $0.deleteTeamMemory(section: section, id: entry.id) } }
                                Pill(label: Text("Remember"), primary: true, icon: "checkmark") { run { try await $0.acceptTeamMemory(section: section, id: entry.id) } }
                            }
                            .padding(.horizontal, 14).padding(.vertical, 10)
                        }
                    }
                }
                if entries != nil, shared.isEmpty, proposed.isEmpty {
                    Text("Nothing shared yet. Review what bots propose as they learn who is who and where things live, or add one yourself below.")
                        .font(theme.font(13)).foregroundStyle(theme.inkSecondary).multilineTextAlignment(.center)
                        .padding(.vertical, 24).frame(maxWidth: .infinity)
                        .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                if !shared.isEmpty {
                    group(Text("Shared"), count: nil) {
                        ForEach(Self.kinds, id: \.self) { kind in
                            let rows = shared.filter { $0.kind == kind }
                            if !rows.isEmpty {
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Text(kindTitle(kind)).font(theme.font(12.5, .medium)).foregroundStyle(theme.ink)
                                        Spacer()
                                        Text(verbatim: "\(rows.count)").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                                    }
                                    ForEach(rows) { entry in
                                        HStack(alignment: .top, spacing: 8) {
                                            VStack(alignment: .leading, spacing: 4) {
                                                Text(verbatim: entry.name).font(theme.font(13)).foregroundStyle(theme.ink)
                                                TextField(text: Binding(get: { details[entry.id] ?? entry.detail }, set: { details[entry.id] = $0 }),
                                                          prompt: Text("What every bot should know about it")) { Text("\(entry.name) detail") }
                                                    .font(theme.font(12.5))
                                                    .padding(.horizontal, 8).frame(height: 30)
                                                    .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                                    .onSubmit {
                                                        let detail = details[entry.id] ?? entry.detail
                                                        run { try await $0.editTeamMemoryDetail(section: section, id: entry.id, detail: detail) }
                                                    }
                                                Text(verbatim: "\(entry.source?.botName.flatMap { $0.isEmpty ? nil : $0 } ?? String(localized: "you")) · \(Date(timeIntervalSince1970: (entry.updatedAt ?? 0) / 1000).formatted(date: .abbreviated, time: .omitted))")
                                                    .font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                                            }
                                            Button(role: .destructive) { run { try await $0.deleteTeamMemory(section: section, id: entry.id) } } label: {
                                                Image(systemName: "trash").font(.system(size: 12)).foregroundStyle(theme.inkSecondary).frame(width: 28, height: 28)
                                            }
                                            .buttonStyle(.plain)
                                            .accessibilityLabel(Text("Remove \(entry.name)"))
                                        }
                                    }
                                }
                                .padding(.horizontal, 14).padding(.vertical, 10)
                            }
                        }
                    }
                }
                if adding {
                    group(Text("Add an entry"), count: nil) {
                        VStack(alignment: .leading, spacing: 8) {
                            Picker(selection: $draft.kind) {
                                ForEach(Self.kinds, id: \.self) { kind in Text(kindOne(kind)).tag(kind) }
                            } label: { Text("Kind") }
                            .pickerStyle(.segmented)
                            TextField(text: $draft.name) { Text("Name") }
                                .font(theme.font(13)).padding(.horizontal, 8).frame(height: 32)
                                .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            TextField(text: $draft.detail, prompt: Text("What every bot should know about it")) { Text("Detail") }
                                .font(theme.font(13)).padding(.horizontal, 8).frame(height: 32)
                                .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            HStack {
                                Spacer()
                                Pill(label: Text("Cancel")) { adding = false }
                                Pill(label: busy ? Text("Adding…") : Text("Add"), primary: true) {
                                    let entry = draft
                                    run({ try await $0.createTeamMemory(section: section, kind: entry.kind, name: entry.name, detail: entry.detail) }) {
                                        draft = (entry.kind, "", ""); adding = false
                                    }
                                }
                                .disabled(draft.name.trimmingCharacters(in: .whitespaces).isEmpty || draft.detail.trimmingCharacters(in: .whitespaces).isEmpty)
                            }
                        }
                        .padding(14)
                    }
                }
            }
        } footer: {
            if !adding, entries != nil {
                Pill(label: Text("Add an entry"), icon: "plus") { adding = true }
                    .accessibilityIdentifier("team-memory.add")
            }
            Spacer()
            Pill(label: Text("Done"), primary: true) { close() }
        }
        .task { await load() }
    }

    private func group<Content: View>(_ title: Text, count: Int?, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                title.font(theme.font(12.5, .medium)).foregroundStyle(theme.inkSecondary)
                Spacer()
                if let count { Text(verbatim: "\(count)").font(theme.font(12.5)).foregroundStyle(theme.inkSecondary) }
            }
            VStack(alignment: .leading, spacing: 0) { content() }
                .background(theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    private func load() async {
        guard let client = session.settingsClient else { return }
        do { entries = try await client.teamMemory(section: section).entries; error = "" }
        catch { self.error = error.localizedDescription }
    }

    private func run(_ action: @escaping (CompanionClient) async throws -> Void, then: (() -> Void)? = nil) {
        guard !busy, let client = session.settingsClient else { return }
        busy = true
        Task {
            do { try await action(client); then?() } catch { self.error = error.localizedDescription }
            busy = false
            await load()
        }
    }
}
