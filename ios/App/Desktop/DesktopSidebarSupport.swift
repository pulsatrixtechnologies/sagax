// iPad I2: what the desktop sidebar needs around it in the shell: the
// hardware-keyboard commands (KB1, KB2; src/lib/keyboard-shortcuts.ts and
// App.tsx), the prompts behind its menus (rename and delete a bot, and the
// WP5, WP6 and WP11 presenters, mounted once) and the keyboard shortcuts
// list. Connected apps is the Plugins modal (I5, DesktopPlugins.swift).
import SwiftUI
import UIKit
import CompanionCore

// MARK: - Keyboard

/// ⌘K palette, ⌘N New, ⌘1 to ⌘9 a bot, ⌘⇧[ / ⌘⇧] previous and next bot,
/// ⌘/ the shortcuts, ⌘\ the sidebar rail (⌘, Settings is the app menu's,
/// CompanionApp.swift). Invisible buttons:
/// iPadOS lists them in its ⌘ overlay under these titles.
struct DesktopKeyCommands: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel

    var body: some View {
        ZStack {
            command("Search", key: "k") { model.menu = nil; model.modal = .search }
            command("New", key: "n") {
                model.menu = model.menu?.kind == .new ? nil : DesktopMenuRequest(kind: .new, anchor: newAnchor)
            }
            ForEach(1..<10, id: \.self) { number in
                command("Jump to bot \(number)", key: KeyEquivalent(Character("\(number)"))) {
                    if model.menu?.kind == .new, let activate = model.composeActivate {
                        activate(number - 1)
                        return
                    }
                    model.menu = nil
                    model.jump(to: number - 1, in: session)
                }
            }
            command("Previous bot", key: "[", modifiers: [.command, .shift]) { model.step(-1, in: session) }
            command("Next bot", key: "]", modifiers: [.command, .shift]) { model.step(1, in: session) }
            command("Keyboard shortcuts", key: "/") { model.modal = .shortcuts }
            command("Toggle sidebar", key: "\\") { model.toggleCollapsed() }
        }
        .opacity(0)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// Under the round New button (brand row, or the rail's second circle).
    private var newAnchor: CGPoint {
        // the head starts at the top without the logo (6 + 36 + 4), under the 36 pt band with it
        let brand = SidebarLogoRuntime.isBrandVisible(UserDefaults.standard.object(forKey: SidebarLogoPreference.key) as? Bool ?? SidebarLogoPreference.defaultEnabled)
        return model.density == .icons ? CGPoint(x: 21.5, y: 124) : CGPoint(x: model.sidebarWidth - 49, y: brand ? 82 : 46)
    }

    private func command(
        _ title: LocalizedStringKey, key: KeyEquivalent, modifiers: EventModifiers = .command, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) { Text(title) }
            .keyboardShortcut(key, modifiers: modifiers)
    }
}

// MARK: - Prompts

struct DesktopSidebarPrompts: ViewModifier {
    @ObservedObject var model: DesktopShellModel
    @EnvironmentObject private var session: Session

    func body(content: Content) -> some View {
        content
            .threadActionsPresenter(model.threadActions)
            .sidebarSectionActionsPresenter(model.sectionActions)
            .roomActionsPresenter(model.roomActions)
            .alert("Rename Bot", isPresented: Binding(
                get: { model.renamingBot != nil },
                set: { if !$0 { model.renamingBot = nil } }
            )) {
                TextField("Name", text: $model.renameDraft)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("desktop-rename-field")
                Button("Cancel", role: .cancel) { model.renamingBot = nil }
                Button("Save") { commitRename() }
                    .accessibilityIdentifier("desktop-rename-save")
            }
            .confirmationDialog(
                Text("Archive \(model.archivingBot?.name ?? "")?"),
                isPresented: Binding(
                    get: { model.archivingBot != nil },
                    set: { if !$0 { model.archivingBot = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Archive") { confirmArchive() }
                    .accessibilityIdentifier("desktop-archive-confirm")
                Button("Cancel", role: .cancel) { model.archivingBot = nil }
            } message: {
                Text("\(model.archivingBot?.name ?? "") leaves the sidebar, but every conversation is kept. You can restore it any time from Archived bots.")
            }
            .sheet(isPresented: Binding(
                get: { model.sharingTeam != nil },
                set: { if !$0 { model.sharingTeam = nil } }
            )) {
                if let team = model.sharingTeam {
                    DesktopShareTeamSheet(team: team) { model.sharingTeam = nil }
                        .environmentObject(session)
                }
            }
            .sheet(isPresented: Binding(
                get: { model.sharingBotLink != nil },
                set: { if !$0 { model.sharingBotLink = nil } }
            )) {
                if let link = model.sharingBotLink {
                    DesktopActivityView(items: [link]) { model.sharingBotLink = nil }
                }
            }
            .sheet(item: $model.replacingPrimary) { bot in
                PrimaryBotPicker(currentId: bot.id, viewerId: DesktopSidebarFlags.shared.viewerId) { _ in }
                    .environmentObject(session)
            }
            .confirmationDialog(
                Text("Delete \(model.deletingBot?.name ?? "")?"),
                isPresented: Binding(
                    get: { model.deletingBot != nil },
                    set: { if !$0 { model.deletingBot = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) { confirmDelete() }
                    .accessibilityIdentifier("desktop-delete-confirm")
                Button("Cancel", role: .cancel) { model.deletingBot = nil }
            } message: {
                Text("The bot and its conversations will be deleted. This cannot be undone.")
            }
    }

    /// The desktop renames in place; on iPad, the same `PATCH /profile`.
    private func commitRename() {
        guard let bot = model.renamingBot else { return }
        model.renamingBot = nil
        let name = model.renameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name != bot.name else { return }
        Task { _ = await session.updateProfile(BotProfilePatch(name: name), for: bot) }
    }

    private func confirmArchive() {
        guard let bot = model.archivingBot else { return }
        model.archivingBot = nil
        Task { await DesktopBotArchiving.set(bot, archived: true, session: session, model: model) }
    }

    private func confirmDelete() {
        guard let bot = model.deletingBot else { return }
        model.deletingBot = nil
        Task {
            guard let client = session.profileClient else { return }
            do {
                try await client.deleteBot(botId: bot.id)
                if model.selected?.id == bot.id { model.selected = nil }
                session.applyBotDeleted(bot.id)
            } catch {
                session.actionError = error.localizedDescription
            }
        }
    }
}

/// Archive (`PATCH /api/bots/:id { hidden }`, as the desktop's
/// `archiveBot`): the bot leaves the sidebar with its conversations kept;
/// the selection moves to another active bot. Restore sends false.
@MainActor
enum DesktopBotArchiving {
    static func set(_ bot: Bot, archived: Bool, session: Session, model: DesktopShellModel) async {
        guard let client = session.profileClient else { return }
        if archived, DesktopBotArchive.block(bot, in: session.state.bots) != nil { return }
        do {
            let updated = try await client.patchBot(botId: bot.id, patch: BotPatch(hidden: archived))
            session.applyProfileBot(updated)
            if archived, model.selected?.id == bot.id {
                model.selected = session.state.bots.first { $0.hidden != true && $0.id != bot.id }.map(Chat.bot)
            }
        } catch {
            session.actionError = error.localizedDescription
        }
    }
}

// MARK: - Sheets

/// Share team…: the server packs the team (every skill and the starter
/// notes, never chat history; keys redacted), then the share sheet takes
/// the file (the desktop saves it).
struct DesktopShareTeamSheet: View {
    @EnvironmentObject private var session: Session
    let team: String
    let close: () -> Void
    @State private var file: URL?
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            Group {
                if let file {
                    DesktopActivityView(items: [file]) { close() }
                } else if let failure {
                    VStack(spacing: 12) {
                        Text(verbatim: failure).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        Button("Close", action: close)
                    }
                    .padding()
                } else {
                    VStack(spacing: 12) {
                        ProgressView()
                        Text("Packing \(team)…").foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle(Text("Share team…"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: close) } }
        }
        .task {
            guard let client = session.profileClient else { failure = String(localized: "Not connected"); return }
            do {
                let package = try await client.exportTeam(team)
                let url = FileManager.default.temporaryDirectory.appendingPathComponent(package.filename)
                try package.data.write(to: url, options: .atomic)
                file = url
            } catch {
                failure = error.localizedDescription
            }
        }
        .accessibilityIdentifier("desktop-share-team")
    }
}

/// The system share sheet in a sheet.
struct DesktopActivityView: UIViewControllerRepresentable {
    let items: [Any]
    let done: () -> Void

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
        controller.completionWithItemsHandler = { _, _, _, _ in done() }
        return controller
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// The sidebar place that was Templates opens Browse Bots (#253, #259):
/// the catalogue, with the templates folded in (BrowseBotsView.swift).
struct DesktopTemplatesSheet: View {
    let close: () -> Void

    var body: some View {
        BrowseBotsSheet(close: close)
            .accessibilityIdentifier("desktop-templates")
    }
}

