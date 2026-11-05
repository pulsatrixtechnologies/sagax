// Memory > Import on the iPad (src/components/memory-manager/MemoryImportDialog.tsx,
// 2026-11-03): an Obsidian vault into Sagax memory, in the desktop's centred
// window. A folder or the vault's .zip (the Files picker, security-scoped);
// where it lands (a tier and a folder, by default My memory and a new folder
// named after the vault); the options; a dry run that counts notes, folders,
// links, tags and attachments, lists conflicts, what is left out (a
// secret-looking file is never read into a note) and the first rows; then the
// import with its progress, which can be stopped and run again (what is there
// already is skipped). The rules and the writes are CompanionCore's
// (MemoryVaultImport.swift, Client+MemoryImport.swift).
//
//     DesktopMemoryImportSheet(sources: sources, onImported: { count in ... }, onDone: { close() })
//
// Put it in an overlay or a ZStack over the page: it draws its own scrim and
// box (DesktopModalFrame). `onDone` is the close.
import CompanionCore
import SwiftUI
import UniformTypeIdentifiers

/// The app's language for the sheet's formatted lines (`%@` placeholders, as the desktop's `{name}`).
enum DesktopMemoryText {
    static func l(_ key: String, _ args: String...) -> String {
        let format = AppStrings.localized(key)
        return args.isEmpty ? format : String(format: format, arguments: args.map { $0 as CVarArg })
    }
}

private func L(_ key: String, _ args: String...) -> String {
    let format = AppStrings.localized(key)
    return args.isEmpty ? format : String(format: format, arguments: args.map { $0 as CVarArg })
}

// MARK: - Model

@MainActor
final class DesktopMemoryImportModel: ObservableObject {
    struct Destination: Identifiable, Hashable {
        var id: String
        var label: String
        var target: VaultImportTarget
    }

    @Published var destinations: [Destination] = []
    @Published var destinationId = ""
    @Published var folder = ""
    @Published var options = VaultImportOptions.default
    @Published private(set) var source: VaultSource?
    @Published private(set) var reading = false
    @Published private(set) var error = ""
    @Published private(set) var plan: VaultPlan?
    @Published private(set) var progress: VaultImportProgress?
    @Published private(set) var running = false
    @Published private(set) var folders: [String] = []

    private var client: CompanionClient?
    private var scoped: URL?
    private var existing: [String: [VaultExistingNote]] = [:]
    private var foldersByDestination: [String: [String]] = [:]
    private var refreshTask: Task<Void, Never>?
    private var runTask: Task<Void, Never>?

    var destination: Destination? { destinations.first { $0.id == destinationId } ?? destinations.first }

    func start(session: Session, sources: [MemoryManagerSource]) async {
        client = session.settingsClient
        var out: [Destination] = []
        var tree: PerspicaxTree?
        if sources.contains(where: { $0.kind == .perspicax }) { tree = try? await client?.perspicaxMemoryTree() }
        let mine = L("My memory")
        if let me = tree?.tiers.first(where: { $0.kind == "me" }), me.mayWrite {
            out.append(Destination(id: "px:\(me.scope)", label: mine, target: .perspicax(scope: me.scope)))
        }
        for source in sources where source.kind == .bot && source.mayWrite && source.linked != false {
            guard let botId = source.botId else { continue }
            out.append(Destination(id: source.id, label: "\(mine) / \(source.name)", target: .bot(botId: botId)))
        }
        for tier in tree?.tiers ?? [] where tier.kind != "me" && tier.mayWrite {
            out.append(Destination(id: "px:\(tier.scope)", label: tier.kind == "org" ? L("Organization") : tier.name, target: .perspicax(scope: tier.scope)))
        }
        destinations = out
        if destinationId.isEmpty { destinationId = out.first?.id ?? "" }
    }

    func releaseScope() {
        scoped?.stopAccessingSecurityScopedResource()
        scoped = nil
        refreshTask?.cancel()
    }

    // MARK: reading

    func read(url: URL) {
        releaseScope()
        error = ""
        progress = nil
        reading = true
        if url.startAccessingSecurityScopedResource() { scoped = url }
        let isZip = url.pathExtension.lowercased() == "zip"
        Task {
            do {
                let next = try await Task.detached(priority: .userInitiated) { () -> VaultSource in
                    isZip ? try VaultSource.readZip(at: url) : try VaultSource.readFolder(at: url)
                }.value
                source = next
                folder = next.name
                existing = [:]
                await refresh(debounce: false)
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription.map(AppStrings.localized) ?? error.localizedDescription
            }
            reading = false
        }
    }

    func failed(_ cause: Error) {
        error = cause.localizedDescription
    }

    // MARK: planning

    /// The destination's notes (once), the bodies of those a conflict is decided against, then the plan.
    func scheduleRefresh() {
        refreshTask?.cancel()
        refreshTask = Task { await refresh(debounce: true) }
    }

    private func refresh(debounce: Bool) async {
        guard let source, let destination else { plan = nil; return }
        if debounce {
            try? await Task.sleep(nanoseconds: 250_000_000)
            if Task.isCancelled { return }
        }
        if existing[destination.id] == nil {
            do {
                let found: (existing: [VaultExistingNote], folders: [String])
                if let client { found = try await client.vaultDestinationNotes(destination.target) } else { found = ([], []) }
                existing[destination.id] = found.existing
                foldersByDestination[destination.id] = found.folders
            } catch {
                self.error = error.localizedDescription
                existing[destination.id] = []
            }
        }
        folders = foldersByDestination[destination.id] ?? []
        var notes = existing[destination.id] ?? []
        let input = VaultPlanInput(vaultName: source.name, files: source.files, options: options, destination: destination.target.kind, folder: folder, existing: notes)
        // A first plan that skips every conflict names the notes whose text is worth fetching.
        var probe = input
        probe.options.conflict = .skip
        let first = await Task.detached { ObsidianVault.plan(probe) }.value
        let keys = Set(first.notes.filter { $0.conflict && $0.action != .unchanged }.map { ObsidianVault.existingKey(folder: $0.folder, title: $0.title) })
        if !keys.isEmpty, let client {
            notes = await client.vaultFillBodies(notes, target: destination.target, keys: keys)
            existing[destination.id] = notes
        }
        if Task.isCancelled { return }
        var final = input
        final.existing = notes
        plan = await Task.detached { ObsidianVault.plan(final) }.value
    }

    // MARK: running

    func startImport(onImported: ((Int) -> Void)?) {
        guard let plan, let source, let destination, let client else { return }
        error = ""
        running = true
        let conflict = options.conflict
        runTask = Task {
            let result = await VaultImportRunner.run(
                plan: plan, source: source, target: destination.target, conflict: conflict,
                writers: ClientVaultWriters(client: client),
                onProgress: { progress in Task { @MainActor in if self.running { self.progress = progress } } }
            )
            progress = result
            running = false
            runTask = nil
            let written = result.tally(.written)
            if written > 0 { onImported?(written) }
            // what was written is there now: a run again skips it
            existing[destination.id] = nil
            await refresh(debounce: false)
        }
    }

    func stop() { runTask?.cancel() }
}

private extension VaultImportTarget {
    var kind: VaultDestination {
        switch self {
        case .bot: .bot
        case .perspicax: .perspicax
        }
    }
}

// MARK: - The window

struct DesktopMemoryImportSheet: View {
    let sources: [MemoryManagerSource]
    var onImported: ((Int) -> Void)? = nil
    let onDone: () -> Void

    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @StateObject private var model = DesktopMemoryImportModel()
    @State private var picking = false
    @State private var pickTypes: [UTType] = [.folder]
    @State private var skippedOpen = false

    init(sources: [MemoryManagerSource], onImported: ((Int) -> Void)? = nil, onDone: @escaping () -> Void) {
        self.sources = sources
        self.onImported = onImported
        self.onDone = onDone
    }

    var body: some View {
        DesktopModalFrame(width: 700, background: \.panel, close: { if !model.running { onDone() } }) {
            VStack(alignment: .leading, spacing: 0) {
                header
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        pickers
                        status
                        if !model.error.isEmpty { alert }
                        if model.source != nil, model.destination != nil { configured }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                }
                footer
            }
        }
        .fileImporter(isPresented: $picking, allowedContentTypes: pickTypes, allowsMultipleSelection: false) { result in
            switch result {
            case .success(let urls): if let url = urls.first { model.read(url: url) }
            case .failure(let cause): model.failed(cause)
            }
        }
        .task { await model.start(session: session, sources: sources) }
        .onDisappear { model.releaseScope() }
        .onChange(of: model.destinationId) { _ in model.scheduleRefresh() }
        .onChange(of: model.folder) { _ in model.scheduleRefresh() }
        .onChange(of: model.options) { _ in model.scheduleRefresh() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-memory-import")
    }

    // MARK: pieces

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                DesktopText(Text("Import an Obsidian vault"), size: 17, weight: .semibold, line: 24, tracking: -0.136)
                DesktopText(Text("Notes, folders, links and tags from a vault folder or its .zip."), size: 12.5, line: 18, color: \.inkSecondary)
            }
            Spacer(minLength: 0)
            DesktopCloseButton(label: "Close", identifier: "desktop-memory-import.close") { if !model.running { onDone() } }
                .opacity(model.running ? 0.4 : 1)
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 8)
    }

    private var pickers: some View {
        HStack(spacing: 8) {
            pickButton(Text("Choose a folder"), icon: .folderOpen, types: [.folder], id: "folder")
            pickButton(Text("Choose a .zip"), icon: .fileArchive, types: [.zip], id: "zip")
        }
    }

    private func pickButton(_ label: Text, icon: ImportIcon, types: [UTType], id: String) -> some View {
        Button {
            pickTypes = types
            picking = true
        } label: {
            HStack(spacing: 8) {
                if model.reading && id == "folder" {
                    ProgressView().controlSize(.small)
                } else {
                    ImportIconView(icon: icon, size: 16)
                }
                label.font(theme.font(13)).foregroundStyle(theme.ink)
            }
            .frame(maxWidth: .infinity, minHeight: 56)
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            .contentShape(Rectangle())
        }
        .buttonStyle(DesktopHoverFill(radius: 12))
        .disabled(model.reading || model.running)
        .opacity(model.reading || model.running ? 0.6 : 1)
        .accessibilityIdentifier("desktop-memory-import.pick.\(id)")
    }

    private var status: some View {
        let line: String
        if model.reading {
            line = L("Reading the vault…")
        } else if let source = model.source {
            line = L("%@: %@ files", source.name, String(source.files.count))
        } else {
            line = L("At most %@ files, %@ MB a note, %@ MB an image or PDF.", String(VaultLimits.files), String(max(1, VaultLimits.noteBytes / (1024 * 1024))), String(VaultLimits.attachmentBytes / (1024 * 1024)))
        }
        return DesktopText(verbatim: line, size: 12, line: 16, color: \.inkSecondary)
    }

    private var alert: some View {
        Text(verbatim: model.error)
            .font(theme.font(12.5))
            .foregroundStyle(theme.danger)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.danger.opacity(0.10), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .accessibilityIdentifier("desktop-memory-import.error")
    }

    @ViewBuilder
    private var configured: some View {
        if let destination = model.destination {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    fieldLabel(Text("Where"))
                    DesktopSelect(
                        options: model.destinations.map { ($0.id, $0.label) },
                        selection: destination.id,
                        label: Text("Where"),
                        identifier: "desktop-memory-import.destination",
                        disabled: model.running
                    ) { model.destinationId = $0 }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .leading, spacing: 6) {
                    fieldLabel(Text("Folder"))
                    folderField
                    if destination.target.kind == .bot {
                        DesktopText(Text("A bot’s memory has no folders: the folder starts each note’s name."), size: 11.5, line: 16, color: \.inkTertiary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            optionsBlock
            if let plan = model.plan, model.progress == nil { preview(plan) }
            if let progress = model.progress { progressBlock(progress) }
        }
    }

    private func fieldLabel(_ text: Text) -> some View {
        DesktopText(text, size: 12, weight: .medium, line: 16, color: \.inkSecondary)
    }

    private var folderField: some View {
        HStack(spacing: 0) {
            TextField(text: $model.folder) { Text("Folder") }
                .font(theme.font(13))
                .foregroundStyle(theme.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .disabled(model.running)
                .accessibilityIdentifier("desktop-memory-import.folder")
            if !model.folders.isEmpty {
                Menu {
                    ForEach(model.folders, id: \.self) { name in
                        Button(name) { model.folder = name }
                    }
                } label: {
                    ImportIconView(icon: .chevronDown, size: 12).foregroundStyle(theme.inkSecondary).frame(width: 28, height: 28)
                }
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 33)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.border, lineWidth: 0.5))
        .opacity(model.running ? 0.5 : 1)
    }

    private var optionsBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            fieldLabel(Text("Options"))
            LazyVGrid(columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)], alignment: .leading, spacing: 6) {
                option(\.keepStructure, Text("Keep the folder structure"), id: "keepStructure")
                option(\.wikilinks, Text("Turn [[wikilinks]] into note links"), id: "wikilinks")
                option(\.tags, Text("Turn #tags and front matter tags into tags"), id: "tags")
                option(\.properties, Text("Keep the front matter as properties"), id: "properties")
                option(\.attachments, Text("Copy images and PDFs embedded with ![[...]]"), id: "attachments")
                option(\.skipSystem, Text("Skip .obsidian/ and .trash/"), id: "skipSystem")
            }
            HStack(spacing: 8) {
                DesktopText(Text("When a note of that name is there"), size: 12.5, line: 18, color: \.inkSecondary)
                DesktopSelect(
                    options: [
                        (VaultConflict.skip, L("Skip it")),
                        (.rename, L("Import it under a new name")),
                        (.overwrite, L("Replace it")),
                    ],
                    selection: model.options.conflict,
                    label: Text("When a note of that name is there"),
                    identifier: "desktop-memory-import.conflict",
                    disabled: model.running
                ) { model.options.conflict = $0 }
                Spacer(minLength: 0)
            }
            .padding(.top, 4)
        }
        .disabled(model.running)
    }

    private func option(_ keyPath: WritableKeyPath<VaultImportOptions, Bool>, _ label: Text, id: String) -> some View {
        let on = model.options[keyPath: keyPath]
        return Button { model.options[keyPath: keyPath].toggle() } label: {
            HStack(alignment: .top, spacing: 8) {
                ZStack {
                    RoundedRectangle(cornerRadius: 4, style: .continuous).fill(on ? theme.accent : .clear)
                    RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(on ? theme.accent : theme.borderStrong, lineWidth: 1)
                    if on { DesktopSettingsIconView(icon: .check, size: 11, strokeWidth: 3).foregroundStyle(theme.accentInk) }
                }
                .frame(width: 16, height: 16)
                .padding(.top, 1)
                label.font(theme.font(12.5)).foregroundStyle(theme.ink).multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityIdentifier("desktop-memory-import.option.\(id)")
    }

    // MARK: preview

    private func preview(_ plan: VaultPlan) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            fieldLabel(Text("Preview"))
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 8)], spacing: 8) {
                count(Text("Notes"), plan.counts.notes, "notes")
                count(Text("Folders"), plan.counts.folders, "folders")
                count(Text("Links"), plan.counts.links, "links")
                count(Text("Tags"), plan.counts.tags, "tags")
                count(Text("Attachments"), plan.counts.attachments, "attachments")
                count(Text("Conflicts"), plan.counts.conflicts, "conflicts")
            }
            if plan.counts.unchanged > 0 {
                DesktopText(verbatim: L("%@ already there word for word: left as they are.", String(plan.counts.unchanged)), size: 12, line: 16, color: \.inkSecondary)
            }
            if plan.counts.secrets > 0 {
                Text(verbatim: L("%@ files look like they hold a secret: they are never imported.", String(plan.counts.secrets)))
                    .font(theme.font(12.5))
                    .foregroundStyle(theme.ink)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.warning.opacity(0.10), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .accessibilityIdentifier("desktop-memory-import.secrets")
            }
            VStack(alignment: .leading, spacing: 4) {
                DesktopText(Text("First notes"), size: 12, weight: .medium, line: 16, color: \.inkSecondary)
                VStack(spacing: 0) {
                    ForEach(Array(plan.notes.prefix(8).enumerated()), id: \.offset) { index, note in
                        if index > 0 { Rectangle().fill(theme.hairlineWeak).frame(height: 0.5) }
                        HStack(spacing: 8) {
                            Text(verbatim: note.title).font(theme.font(12.5)).foregroundStyle(theme.ink).lineLimit(1)
                            Spacer(minLength: 0)
                            if !note.folder.isEmpty {
                                Text(verbatim: note.folder).font(theme.font(12.5)).foregroundStyle(theme.inkTertiary).lineLimit(1).frame(maxWidth: 220, alignment: .trailing)
                            }
                            actionBadge(note.action)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .accessibilityElement(children: .combine)
                    }
                    if plan.notes.isEmpty {
                        Text("Nothing to import").font(theme.font(12.5)).foregroundStyle(theme.inkSecondary).padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
                .accessibilityIdentifier("desktop-memory-import.rows")
            }
            if !plan.skipped.isEmpty { skipped(plan.skipped) }
        }
        .accessibilityIdentifier("desktop-memory-import.preview")
    }

    private func count(_ label: Text, _ value: Int, _ id: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            label.font(theme.font(11)).foregroundStyle(theme.inkSecondary)
            Text(verbatim: String(value)).font(theme.font(17, .semibold)).monospacedDigit().foregroundStyle(theme.ink)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.raised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("desktop-memory-import.count.\(id)")
    }

    private func actionBadge(_ action: VaultPlannedAction) -> some View {
        let label: String
        let fill: Color
        let ink: Color
        switch action {
        case .create: label = L("New (vault note)"); fill = theme.success.opacity(0.15); ink = theme.success
        case .rename: label = L("New name"); fill = theme.warning.opacity(0.15); ink = theme.warning
        case .overwrite: label = L("Replaces"); fill = theme.danger.opacity(0.10); ink = theme.danger
        case .skip: label = L("Skipped"); fill = theme.raised; ink = theme.inkSecondary
        case .unchanged: label = L("Unchanged (vault note)"); fill = theme.raised; ink = theme.inkSecondary
        }
        return Text(verbatim: label)
            .font(theme.font(11))
            .foregroundStyle(ink)
            .padding(.horizontal, 8)
            .padding(.vertical, 1)
            .background(fill, in: Capsule())
            .accessibilityIdentifier("desktop-memory-import.action.\(action.rawValue)")
    }

    private func skipped(_ list: [VaultSkipped]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Button { skippedOpen.toggle() } label: {
                HStack(spacing: 6) {
                    ImportIconView(icon: skippedOpen ? .chevronDown : .chevronRight, size: 12)
                    Text(verbatim: L("Left out (%@)", String(list.count))).font(theme.font(12.5))
                }
                .foregroundStyle(theme.inkSecondary)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("desktop-memory-import.skipped")
            if skippedOpen {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(list.prefix(200).enumerated()), id: \.offset) { _, entry in
                        HStack(spacing: 8) {
                            // the path only, never a file's text
                            Text(verbatim: entry.path).font(theme.font(12.5)).foregroundStyle(theme.ink).lineLimit(1)
                            Spacer(minLength: 0)
                            Text(verbatim: Self.reasonLabel(entry.reason.rawValue)).font(theme.font(12.5)).foregroundStyle(theme.inkTertiary)
                        }
                    }
                }
                .frame(maxHeight: 140)
            }
        }
    }

    static func reasonLabel(_ reason: String) -> String {
        switch reason {
        case "unsafe_path": L("Path outside the vault")
        case "system": L("Obsidian settings or trash")
        case "hidden": L("Hidden file")
        case "secret": L("Looks like a secret")
        case "too_large": L("Too large")
        case "empty": L("Empty")
        case "unsupported": L("Not a note, an image or a PDF")
        case "limit": L("Over the vault’s limit")
        case "attachment_unsupported": L("Perspicax keeps no attachments")
        case "exists": L("Already there")
        case "invalid": L("Refused (vault note)")
        default: reason
        }
    }

    // MARK: progress

    private func progressLine(_ progress: VaultImportProgress) -> String {
        if model.running {
            return L("Importing… %@ of %@", String(progress.done), String(progress.total))
        } else if progress.cancelled {
            return L("Stopped after %@ of %@. Run it again to finish: what is there already is skipped.", String(progress.done), String(progress.total))
        }
        return L("Done: %@ written, %@ unchanged, %@ skipped, %@ refused.", String(progress.tally(.written)), String(progress.tally(.unchanged)), String(progress.tally(.skipped)), String(progress.tally(.refused)))
    }

    private func progressBlock(_ progress: VaultImportProgress) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(theme.raised)
                    Capsule().fill(theme.accent)
                        .frame(width: proxy.size.width * (progress.total > 0 ? CGFloat(progress.done) / CGFloat(progress.total) : 1))
                }
            }
            .frame(height: 6)
            .accessibilityElement()
            .accessibilityValue(Text(verbatim: "\(progress.done)/\(progress.total)"))
            DesktopText(verbatim: progressLine(progress), size: 12.5, line: 18)
            if !progress.refused.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(progress.refused.enumerated()), id: \.offset) { _, outcome in
                        HStack(spacing: 8) {
                            Text(verbatim: outcome.title).font(theme.font(12.5)).foregroundStyle(theme.ink).lineLimit(1)
                            Spacer(minLength: 0)
                            Text(verbatim: Self.reasonLabel(outcome.reason ?? "")).font(theme.font(12.5)).foregroundStyle(theme.danger).lineLimit(1)
                        }
                    }
                }
                .frame(maxHeight: 140)
                .accessibilityIdentifier("desktop-memory-import.refused")
            }
        }
        .accessibilityIdentifier("desktop-memory-import.progress")
    }

    // MARK: footer

    private var footer: some View {
        let finished = model.progress != nil && !model.running
        return VStack(spacing: 0) {
            Rectangle().fill(theme.hairlineWeak).frame(height: 0.5)
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                if model.running {
                    Button { model.stop() } label: { Text("Stop") }
                        .buttonStyle(DesktopButtonStyle(kind: .outline, radius: 16))
                        .accessibilityIdentifier("desktop-memory-import.stop")
                } else {
                    Button(action: onDone) { finished ? Text("Close") : Text("Cancel") }
                        .buttonStyle(DesktopButtonStyle(kind: .outline, radius: 16))
                        .accessibilityIdentifier("desktop-memory-import.cancel")
                }
                if !model.running, let plan = model.plan {
                    let nothing = plan.counts.notes == 0 && plan.counts.attachments == 0
                    Button { model.startImport(onImported: onImported) } label: {
                        if finished, model.progress?.cancelled == true {
                            Text("Run again")
                        } else if plan.counts.notes > 0 {
                            Text(verbatim: L("Import %@ notes", String(plan.counts.notes)))
                        } else {
                            Text("Nothing to import")
                        }
                    }
                    .buttonStyle(DesktopButtonStyle(kind: .accent, radius: 16))
                    .disabled(nothing)
                    .accessibilityIdentifier("desktop-memory-import.start")
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
    }
}

// MARK: - Icons the sheet draws (lucide, ISC)

enum ImportIcon {
    case folderOpen, fileArchive, chevronDown, chevronRight

    var paths: [String] {
        switch self {
        case .folderOpen: ["m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"]
        case .fileArchive: ["M10 12v-1", "M10 18v-2", "M10 7V6", "M14 2v4a2 2 0 0 0 2 2h4", "M15.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v16", "M10 20a2 2 0 0 0 2-2v-2h-4v2a2 2 0 0 0 2 2Z"]
        case .chevronDown: ["m6 9 6 6 6-6"]
        case .chevronRight: ["m9 18 6-6-6-6"]
        }
    }
}

struct ImportIconView: View {
    let icon: ImportIcon
    var size: CGFloat = 16

    var body: some View {
        Canvas { context, canvas in
            context.scaleBy(x: canvas.width / 24, y: canvas.width / 24)
            for d in icon.paths {
                context.stroke(Path(SVGPath.cached(d)), with: .foreground, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
