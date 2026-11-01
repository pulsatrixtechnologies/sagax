// Export as zip and Import from zip on iOS (desktop #271: PersonaOverview.tsx
// "Export as zip", BotZipImport.tsx, docs/bot-package.md). Export downloads
// the zip and hands it to the share sheet; import reads a file from Files,
// shows the server's preview (what is created, what needs a step, what is
// left out), lets the person name the copy and bring conversations and
// sharing, and only then creates the bot. Cancelling lets the staged file go.
import CompanionCore
import SwiftUI
import UniformTypeIdentifiers

// MARK: - Export

/// "Export as zip" at the foot of a bot's overview, for its owner (the
/// desktop's `showBotZipExport`).
struct BotZipExportSection: View {
    @EnvironmentObject private var session: Session
    let bot: Bot
    @State private var exporting = false

    private var shown: Bool {
        session.surfaceGate.scope != .sidecar && (session.canAdminister || PrimaryBotRules.viewerOwns(bot, viewerId: session.roomViewer.actorId))
    }

    var body: some View {
        if shown {
            Section {
                Button { exporting = true } label: { Label("Export as zip", systemImage: "square.and.arrow.up") }
                    .accessibilityIdentifier("bot-export-zip")
            }
            .sheet(isPresented: $exporting) { BotZipExportSheet(bot: bot) { exporting = false } }
        }
    }
}

private struct BotZipShareFile: Identifiable {
    let url: URL
    var id: String { url.path }
}

struct BotZipExportSheet: View {
    @EnvironmentObject private var session: Session
    let bot: Bot
    let close: () -> Void
    @State private var conversations = false
    @State private var sharing = false
    @State private var working = false
    @State private var started = false
    @State private var file: BotZipShareFile?

    private var hasSharing: Bool { !(bot.grants ?? []).isEmpty || bot.visibility != nil }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Download \(bot.name) whole: identity, instructions, memory, docs, skills, plugins, settings, routines and webhooks. Secrets and tokens never leave.")
                        .font(.footnote)
                }
                Section {
                    Toggle(isOn: $conversations) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Include conversations")
                            Text("Threads, messages and their attachments. Off by default.").font(.caption).foregroundStyle(Theme.textSecondary)
                        }
                    }
                    if hasSharing { Toggle("Include sharing", isOn: $sharing) }
                }
                .tint(Theme.toggleOn)
                if started {
                    Text("The download has started.").foregroundStyle(Theme.textSecondary)
                }
            }
            .navigationTitle("Export as zip")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(started ? "Close" : "Cancel", action: close) }
                ToolbarItem(placement: .confirmationAction) {
                    if working { ProgressView() } else {
                        Button("Download") { Task { await download() } }
                            .accessibilityIdentifier("bot-export-download")
                    }
                }
            }
            .sheet(item: $file) { file in ActivityShareSheet(items: [file.url]) }
        }
        .presentationDetents([.medium, .large])
    }

    private func download() async {
        guard let client = session.profileClient else { return }
        working = true
        defer { working = false }
        do {
            let url = try await client.exportBotZip(botId: bot.id, name: bot.name, conversations: conversations, sharing: sharing && hasSharing)
            started = true
            file = BotZipShareFile(url: url)
        } catch { session.actionError = error.localizedDescription }
    }
}

// MARK: - Import

/// "Import a bot from zip": pick, preview, confirm. `imported` gets the new
/// bot once the phone holds it.
struct BotZipImportSheet: View {
    @EnvironmentObject private var session: Session
    let close: () -> Void
    let imported: (Bot?) -> Void

    @State private var picking = false
    @State private var reading = false
    @State private var staged: BotZipStaged?
    @State private var name = ""
    @State private var conversations = false
    @State private var sharing = false
    @State private var importing = false
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            Form {
                if let staged {
                    preview(staged.preview)
                } else {
                    Section {
                        Button { picking = true } label: { Label("Choose a .sagaxbot.zip file", systemImage: "doc.zipper") }
                            .disabled(reading)
                            .accessibilityIdentifier("bot-import-choose")
                        if reading { HStack { Text("Reading the file…"); Spacer(); ProgressView() } }
                    } footer: {
                        Text("A .sagaxbot.zip holds one bot, whole. Nothing is created before you confirm. An older Sagax package file works too.")
                    }
                }
                if let failure {
                    Section { Text(verbatim: failure).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Import a bot from zip")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { Task { await discard(); close() } } }
                if staged != nil {
                    ToolbarItem(placement: .confirmationAction) {
                        if importing { ProgressView() } else {
                            Button("Import") { Task { await runImport() } }
                                .accessibilityIdentifier("bot-import-confirm")
                        }
                    }
                }
            }
            .fileImporter(isPresented: $picking, allowedContentTypes: Self.types, allowsMultipleSelection: false) { result in
                if case let .success(urls) = result, let url = urls.first { Task { await upload(url) } }
            }
            .interactiveDismissDisabled(staged != nil)
        }
    }

    static let types: [UTType] = [.zip, .json, UTType(filenameExtension: "md") ?? .plainText]

    @ViewBuilder private func preview(_ preview: BotZipPreview) -> some View {
        Section {
            Text(verbatim: preview.name).font(.headline)
            if preview.isLegacy {
                Text("An older Sagax package").font(.footnote).foregroundStyle(Theme.textSecondary)
            } else if let version = preview.appVersion, let at = preview.exportedAt {
                Text("Exported by Sagax \(version) on \(Date(timeIntervalSince1970: at / 1000).formatted(date: .abbreviated, time: .omitted))")
                    .font(.footnote).foregroundStyle(Theme.textSecondary)
            }
            TextField("Name", text: $name)
                .onSubmit { Task { await rename() } }
                .accessibilityIdentifier("bot-import-name")
            if preview.hasConversations { Toggle("Include conversations", isOn: $conversations).tint(Theme.toggleOn) }
            if preview.hasSharing { Toggle("Include sharing", isOn: $sharing).tint(Theme.toggleOn) }
        }
        lines("Will be created", preview.created, warning: false)
        lines("Needs a step after import", preview.needsAction, warning: true)
        lines("Left out", preview.skipped, warning: false)
        Section {
            DisclosureGroup("Never in a zip") {
                Text("Tokens and secrets: marketplace tokens, webhook tokens, MCP values and connected app credentials (names only).")
                Text("Engine sessions, live and unread state, and this server's receipts.")
                Text("Achievements and personal settings: they belong to a person, not to the bot.")
                Text("Rooms with other bots and context files of routines.")
            }
            .font(.footnote)
        }
    }

    @ViewBuilder private func lines(_ title: LocalizedStringKey, _ lines: [BotZipPreviewLine], warning: Bool) -> some View {
        if !lines.isEmpty {
            Section(title) {
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    Text(verbatim: line.detail)
                        .font(.footnote)
                        .foregroundStyle(warning ? Color.orange : Theme.textPrimary)
                }
            }
        }
    }

    private func upload(_ url: URL) async {
        guard let client = session.profileClient else { return }
        failure = nil
        reading = true
        defer { reading = false }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            guard size <= BotZipRules.maximumBytes else { failure = String(localized: "The file is larger than 512 MB."); return }
            // up to 512 MB: read off the main thread (it froze the sheet)
            let data = try await Task.detached(priority: .userInitiated) { try Data(contentsOf: url, options: .mappedIfSafe) }.value
            let result = try await client.uploadBotZip(data)
            staged = result
            name = result.preview.importName
            conversations = false
            sharing = false
        } catch { failure = error.localizedDescription }
    }

    /// The name field's blur: the server says what the copy will be called.
    private func rename() async {
        guard let client = session.profileClient, let staged else { return }
        guard let typed = BotZipRules.importName(name, preview: staged.preview) else { return }
        do {
            let preview = try await client.previewBotZip(id: staged.id, name: typed)
            self.staged = BotZipStaged(id: staged.id, preview: preview)
            name = preview.importName
        } catch { failure = error.localizedDescription }
    }

    private func runImport() async {
        guard let client = session.profileClient, let staged else { return }
        importing = true
        defer { importing = false }
        do {
            let result = try await client.importBotZip(
                id: staged.id, name: BotZipRules.importName(name, preview: staged.preview),
                conversations: conversations && staged.preview.hasConversations, sharing: sharing && staged.preview.hasSharing
            )
            self.staged = nil
            await session.refresh()
            imported(session.state.bot(result.botId))
        } catch { failure = error.localizedDescription }
    }

    private func discard() async {
        guard let staged, let client = session.profileClient else { return }
        try? await client.discardBotZip(id: staged.id)
    }
}
