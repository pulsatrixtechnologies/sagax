// Rules and the bot folder (desktop WorkspaceFilesSection.tsx) in the
// markdown editor: RULES.md with its counter; the whole tree with create
// file/folder, upload any type, rename, move, delete (confirm with the
// file count for a non-empty folder). Core files SOUL.md / MEMORY.md /
// RULES.md keep their Every turn badge and cannot be deleted or moved.
import CompanionCore
import SwiftUI
import UniformTypeIdentifiers

/// "Rules" and "Files" under a bot's instructions.
struct BotWorkspaceShortcuts: View {
    @EnvironmentObject private var session: Session
    let bot: Bot
    @State private var open: BotWorkspaceSheet?

    var body: some View {
        if session.surfaceGate.scope != .sidecar {
            HStack(spacing: 10) {
                Button { open = .rules } label: { Label("Rules", systemImage: "list.bullet.rectangle") }
                    .accessibilityIdentifier("workspace-rules")
                Button { open = .docs } label: { Label("Files", systemImage: "folder") }
                    .accessibilityIdentifier("workspace-docs")
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .font(.subheadline.weight(.medium))
            .sheet(item: $open) { sheet in
                NavigationStack {
                    switch sheet {
                    case .rules: BotWorkspaceDocEditor(bot: bot, path: BotWorkspaceFiles.rulesPath)
                    case .docs: BotDocsList(bot: bot)
                    }
                }
                .environmentObject(session)
            }
        }
    }
}

enum BotWorkspaceSheet: String, Identifiable {
    case rules, docs
    var id: String { rawValue }
}

/// The bot folder tree: create, upload, rename, move, delete.
struct BotDocsList: View {
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    let bot: Bot
    @State private var listing: BotWorkspaceListing?
    @State private var failure: String?
    @State private var expanded: Set<String> = []
    @State private var naming: Naming?
    @State private var name = ""
    @State private var renaming: BotWorkspaceEntry?
    @State private var moving: BotWorkspaceEntry?
    @State private var creating: String?
    @State private var deleting: DeleteAsk?
    @State private var importer = false
    @State private var uploadParent: String?

    private struct Naming: Identifiable {
        enum Kind { case file, folder }
        var id: String { "\(kind)-\(parent ?? "root")" }
        var kind: Kind
        var parent: String?
    }

    private struct DeleteAsk: Identifiable {
        var id: String { path }
        var path: String
        var name: String
        var count: Int?
    }

    private var rows: [BotWorkspaceEntry] {
        guard let listing else { return [] }
        let listedDirs = Set(listing.entries.filter(\.isDirectory).map(\.path))
        return listing.entries.filter { entry in
            var parent = parentPath(entry.path)
            while let current = parent {
                if listedDirs.contains(current), !expanded.contains(current) { return false }
                parent = parentPath(current)
            }
            return true
        }
    }

    var body: some View {
        List {
            Section {
                if let listing {
                    if listing.entries.isEmpty {
                        Text("No files yet.").foregroundStyle(Theme.textSecondary)
                    }
                    ForEach(rows) { entry in
                        row(entry)
                    }
                } else if let failure {
                    Text(verbatim: failure).foregroundStyle(Theme.textSecondary)
                } else {
                    ProgressView()
                }
            } footer: {
                Text("Everything in this bot's folder. SOUL.md, MEMORY.md and RULES.md stay in place.")
            }
        }
        .navigationTitle("Files")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: String.self) { path in
            BotWorkspaceDocEditor(bot: bot, path: path, startsNew: path == creating)
        }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("File") { naming = Naming(kind: .file, parent: nil) }
                    Button("Folder") { naming = Naming(kind: .folder, parent: nil) }
                    Button("Upload") { uploadParent = nil; importer = true }
                } label: {
                    Label("New", systemImage: "plus")
                }
                .accessibilityIdentifier("workspace-new-doc")
            }
        }
        .alert(naming?.kind == .folder ? "New folder" : "New file", isPresented: Binding(get: { naming != nil }, set: { if !$0 { naming = nil } })) {
            TextField("Name", text: $name)
            Button("Cancel", role: .cancel) {}
            Button("Create") {
                guard let naming else { return }
                Task { await create(naming) }
            }
        }
        .alert("Rename", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $name)
            Button("Cancel", role: .cancel) {}
            Button("Rename") { if let entry = renaming { Task { await rename(entry) } } }
        }
        .confirmationDialog(
            deleteTitle,
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let deleting { Task { await confirmDelete(deleting) } }
            }
            Button("Cancel", role: .cancel) {}
        }
        .sheet(item: $moving) { entry in
            NavigationStack {
                List {
                    Button("Bot folder") { Task { await move(entry, to: nil) } }
                    ForEach(listing?.entries.filter(\.isDirectory) ?? [], id: \.path) { folder in
                        Button("\(folder.path)/") { Task { await move(entry, to: folder.path) } }
                    }
                }
                .navigationTitle("Move to…")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { moving = nil } } }
            }
        }
        .fileImporter(isPresented: $importer, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            Task { await upload(result) }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private var deleteTitle: String {
        guard let deleting else { return String(localized: "Delete?") }
        if let count = deleting.count, count > 0 {
            return String(format: String(localized: "Delete %@ and its %lld files? This cannot be undone."), deleting.name, Int64(count))
        }
        return String(format: String(localized: "Delete %@?"), deleting.name)
    }

    @ViewBuilder
    private func row(_ entry: BotWorkspaceEntry) -> some View {
        let depth = entry.path.split(separator: "/").count - 1
        HStack(spacing: 8) {
            Color.clear.frame(width: CGFloat(depth) * 14)
            if entry.isDirectory {
                Button {
                    if expanded.contains(entry.path) { expanded.remove(entry.path) }
                    else { expanded.insert(entry.path) }
                } label: {
                    Label(entry.name + "/", systemImage: expanded.contains(entry.path) ? "folder.fill" : "folder")
                }
                .buttonStyle(.plain)
            } else if entry.markdown == true, entry.editable == true || BotWorkspaceFiles.isDoc(entry.path) {
                NavigationLink(value: entry.path) {
                    Label(entry.name, systemImage: "doc.text")
                }
            } else {
                Label(entry.name, systemImage: iconName(for: entry))
            }
            Spacer(minLength: 0)
            if entry.load == "every-turn" {
                Text("Every turn")
                    .font(.caption2)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Theme.accent.opacity(0.15), in: Capsule())
            }
            if let bytes = entry.bytes, !entry.isDirectory {
                Text(ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file))
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .contextMenu {
            if !entry.isCore {
                Button("Rename") { name = entry.name; renaming = entry }
                Button("Move to…") { moving = entry }
                if entry.isDirectory {
                    Button("Upload into this folder") { uploadParent = entry.path; importer = true }
                    Button("New file here") { naming = Naming(kind: .file, parent: entry.path) }
                    Button("New folder here") { naming = Naming(kind: .folder, parent: entry.path) }
                }
                Button("Delete", role: .destructive) { Task { await askDelete(entry) } }
            }
            if !entry.isDirectory {
                Button("Download") { Task { await download(entry) } }
            }
        }
    }

    private func iconName(for entry: BotWorkspaceEntry) -> String {
        let lower = entry.name.lowercased()
        if lower.hasSuffix(".pdf") { return "doc.richtext" }
        if ["png", "jpg", "jpeg", "gif", "webp"].contains(where: { lower.hasSuffix(".\($0)") }) { return "photo" }
        return "doc"
    }

    private func parentPath(_ path: String) -> String? {
        guard let slash = path.lastIndex(of: "/") else { return nil }
        return String(path[..<slash])
    }

    private func load() async {
        guard let client = session.profileClient else { return }
        do { listing = try await client.botWorkspace(botId: bot.id) } catch { failure = error.localizedDescription }
    }

    private func create(_ naming: Naming) async {
        guard let client = session.profileClient else { return }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let path = BotWorkspaceFiles.join(parent: naming.parent, name: trimmed)
        do {
            if naming.kind == .folder {
                try await client.createWorkspaceFolder(botId: bot.id, path: path)
                if let parent = naming.parent { expanded.insert(parent) }
                expanded.insert(path)
            } else {
                let text = trimmed.lowercased().hasSuffix(".md") ? "# \(trimmed.replacingOccurrences(of: ".md", with: "", options: .caseInsensitive))\n" : ""
                try await client.createWorkspaceFile(botId: bot.id, path: path, text: text)
                if BotWorkspaceFiles.isDoc(path) || path.lowercased().hasSuffix(".md") {
                    creating = path
                }
                if let parent = naming.parent { expanded.insert(parent) }
            }
            self.naming = nil
            name = ""
            await load()
        } catch { session.actionError = error.localizedDescription }
    }

    private func rename(_ entry: BotWorkspaceEntry) async {
        guard let client = session.profileClient else { return }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let to = BotWorkspaceFiles.join(parent: parentPath(entry.path), name: trimmed)
        guard to != entry.path else { return }
        do {
            try await client.renameWorkspaceEntry(botId: bot.id, from: entry.path, to: to)
            renaming = nil
            await load()
        } catch { session.actionError = error.localizedDescription }
    }

    private func move(_ entry: BotWorkspaceEntry, to folder: String?) async {
        guard let client = session.profileClient else { return }
        let dest = BotWorkspaceFiles.join(parent: folder, name: entry.name)
        do {
            try await client.renameWorkspaceEntry(botId: bot.id, from: entry.path, to: dest)
            moving = nil
            if let folder { expanded.insert(folder) }
            await load()
        } catch { session.actionError = error.localizedDescription }
    }

    private func askDelete(_ entry: BotWorkspaceEntry) async {
        var count: Int?
        if entry.isDirectory, let client = session.profileClient {
            count = try? await client.countWorkspaceFiles(botId: bot.id, path: entry.path)
        }
        deleting = DeleteAsk(path: entry.path, name: entry.name, count: count)
    }

    private func confirmDelete(_ ask: DeleteAsk) async {
        guard let client = session.profileClient else { return }
        do {
            try await client.deleteWorkspaceEntry(botId: bot.id, path: ask.path, recursive: true)
            deleting = nil
            await load()
        } catch { session.actionError = error.localizedDescription }
    }

    private func upload(_ result: Result<[URL], Error>) async {
        guard let client = session.profileClient else { return }
        do {
            let urls = try result.get()
            for url in urls {
                guard url.startAccessingSecurityScopedResource() else { continue }
                defer { url.stopAccessingSecurityScopedResource() }
                let data = try Data(contentsOf: url)
                let path = BotWorkspaceFiles.join(parent: uploadParent, name: url.lastPathComponent)
                try await client.uploadWorkspaceFile(botId: bot.id, path: path, data: data)
            }
            if let uploadParent { expanded.insert(uploadParent) }
            await load()
        } catch { session.actionError = error.localizedDescription }
    }

    private func download(_ entry: BotWorkspaceEntry) async {
        guard let client = session.profileClient else { return }
        do {
            let data = try await client.downloadWorkspaceFile(botId: bot.id, path: entry.path)
            let temp = FileManager.default.temporaryDirectory.appendingPathComponent(entry.name)
            try data.write(to: temp, options: .atomic)
            await MainActor.run {
                let activity = UIActivityViewController(activityItems: [temp], applicationActivities: nil)
                UIApplication.shared.connectedScenes
                    .compactMap { $0 as? UIWindowScene }
                    .flatMap(\.windows)
                    .first { $0.isKeyWindow }?
                    .rootViewController?
                    .present(activity, animated: true)
            }
        } catch { session.actionError = error.localizedDescription }
    }
}

/// One file in the markdown editor, saved with the hash it was read at.
struct BotWorkspaceDocEditor: View {
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    let bot: Bot
    let path: String
    var startsNew = false

    @State private var doc: MemoryDoc?
    @State private var draft = ""
    @State private var failure: String?
    @State private var saving = false
    @State private var conflict: (current: String, hash: String)?
    @State private var template: String?

    private var isRules: Bool { path == BotWorkspaceFiles.rulesPath }
    private var dirty: Bool { doc.map { $0.text != draft } ?? false }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if isRules {
                    Text("Rules load every turn, after the instructions. Keep them short: what the bot must always or never do.")
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                }
                if doc != nil {
                    MarkdownEditor(
                        text: $draft, minHeight: 320, footer: footer.text, footerIsWarning: footer.over,
                        accessibilityLabel: isRules ? String(localized: "Rules") : (path as NSString).lastPathComponent,
                        identifier: isRules ? "rules-editor" : "doc-editor"
                    )
                } else if let failure {
                    Text(verbatim: failure).foregroundStyle(Theme.textSecondary)
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
            .padding()
        }
        .navigationTitle(isRules ? String(localized: "Rules") : (path as NSString).lastPathComponent)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if isRules {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { Task { await save(expectedHash: doc?.hash) } }
                    .disabled(!dirty || saving)
                    .accessibilityIdentifier("workspace-save")
            }
        }
        .alert("This file changed", isPresented: Binding(get: { conflict != nil }, set: { if !$0 { conflict = nil } })) {
            Button("Reload") {
                if let conflict { doc = MemoryDoc(path: path, text: conflict.current, hash: conflict.hash); draft = conflict.current }
            }
            Button("Overwrite with mine", role: .destructive) {
                let hash = conflict?.hash
                Task { await save(expectedHash: hash) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The bot or someone else saved it since you opened it.")
        }
        .task { await load() }
    }

    private var footer: (text: String?, over: Bool) {
        guard isRules else { return (nil, false) }
        let count = BotWorkspaceFiles.rulesCount(draft)
        return (String(localized: "\(count.lines) of \(BotWorkspaceFiles.maxRulesLines) lines · \(count.bytes.formatted()) of \(BotWorkspaceFiles.maxRulesBytes.formatted()) bytes load each turn"), count.over)
    }

    private func load() async {
        guard let client = session.profileClient else { return }
        do {
            let loaded = try await client.workspaceDoc(botId: bot.id, path: path)
            doc = loaded
            draft = loaded.text
            // a new RULES.md starts from the server's template
            if isRules, loaded.exists == false, loaded.text.isEmpty,
               let template = try? await client.botWorkspace(botId: bot.id).rulesTemplate {
                draft = template
            }
        } catch { failure = error.localizedDescription }
    }

    private func save(expectedHash: String?) async {
        guard let client = session.profileClient else { return }
        saving = true
        defer { saving = false }
        do {
            switch try await client.saveWorkspaceDoc(botId: bot.id, path: path, text: draft, expectedHash: expectedHash) {
            case let .saved(saved, _):
                doc = saved
                Haptics.selection()
            case let .conflict(current, hash):
                conflict = (current, hash)
            }
        } catch { session.actionError = error.localizedDescription }
    }
}
