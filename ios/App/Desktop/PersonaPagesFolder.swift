// Edit bot > Bot folder, Access (iPad, round 4 of the parity sweep): WorkspaceFilesSection.tsx, AccessSection.tsx.
//
// Bot folder: the "Use memory" switch (MemoryToggleCard), the intro line with
// its help, New / Upload and the folder's "..." options (upkeep and the
// memory's change log, MemoryFolderOptions.tsx), then one card listing
// SOUL.md, the folder's files and folders (size or budget, dates, the load
// chip, a "..." per row, a checkbox for bulk move / delete). A row opens in
// place: SOUL.md is the Personality page, RULES.md and docs/ the iPad's
// workspace editor, MEMORY.md and memory/ the memory editor; any other file
// downloads.
//
// Access: MCP servers (one switch each, Manage in Capabilities), the
// background brief, the browser while Experimental features has it, and
// "More options" folded: the working folder, webhooks, always allowed.
import CompanionCore
import SwiftUI
import UIKit

private func L(_ key: String) -> String { AppStrings.localized(key) }
private func LF(_ key: String, _ args: String...) -> String {
    String(format: AppStrings.localized(key), arguments: args.map { $0 as CVarArg })
}

/// `formatBytes` (src/lib/memory.ts): "211 B", "23.4 KB" in the app's language.
private func folderBytes(_ bytes: Int) -> String {
    if bytes < 1024 { return LF("%@ B", "\(bytes)") }
    let kb = (Double(bytes) / 102.4).rounded() / 10
    let number = NumberFormatter()
    number.maximumFractionDigits = 1
    number.minimumFractionDigits = 0
    return LF("%@ KB", number.string(from: NSNumber(value: kb)) ?? "\(kb)")
}

/// Lucide icons the folder draws that the shared sets do not carry (lucide-react 0.539, ISC).
private enum FolderIcon {
    static let file = ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4"]
    static let fileText = file + ["M10 9H8", "M16 13H8", "M16 17H8"]
    static let filePlus = file + ["M9 15h6", "M12 18v-6"]
    static let image = ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z", "M7 9A2 2 0 1 0 11 9A2 2 0 1 0 7 9Z", "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"]
    static let folder = ["M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"]
    static let folderInput = ["M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1", "M2 13h10", "m9 16 3-3-3-3"]
    static let ellipsis = ["M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"]
    static let chevronRight = ["m9 18 6-6-6-6"]
    static let check = ["M20 6 9 17l-5-5"]
    static let chevronDown = ["m6 9 6 6 6-6"]
    static let arrowUpRight = ["M7 7h10v10", "M7 17 17 7"]
    static let externalLink = ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"]
}

private struct FolderIconView: View {
    let paths: [String]
    var size: CGFloat = 14
    var strokeWidth: CGFloat = 2

    var body: some View {
        Canvas { context, canvas in
            let scale = canvas.width / 24
            context.scaleBy(x: scale, y: scale)
            let style = StrokeStyle(lineWidth: strokeWidth, lineCap: .round, lineJoin: .round)
            for d in paths {
                context.stroke(Path(SVGPath.cached(d)), with: .foreground, style: style)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// `PaneSection`: the grey heading (13/18) with its help outside, then the
/// `rounded-xl border-[0.5px] border-border bg-elevated px-3.5 py-3` card.
private struct FolderPaneSection<Content: View>: View {
    @Environment(\.desktopTheme) private var theme
    var title: String?
    var help: String?
    var identifier = ""
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title {
                HStack(spacing: 6) {
                    DesktopText(verbatim: title, size: 13, line: 18, color: \.inkSecondary)
                        .fixedSize()
                    if let help { DesktopHelpTip(help: Text(verbatim: help)) }
                }
                .frame(minHeight: 24)
                .padding(.horizontal, 4)
                .accessibilityAddTraits(.isHeader)
            }
            VStack(alignment: .leading, spacing: 0, content: content)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .desktopHairlineBox(radius: 12)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier)
    }
}

/// `ui-button`: the control pill (31.5 tall), an icon before the label.
private struct FolderPill: View {
    var icon: [String]?
    let title: String
    var danger = false
    var identifier = ""
    let action: () -> Void

    var body: some View {
        Button(action: action) { FolderPillLabel(icon: icon, title: title, danger: danger) }
            // `.ui-button`: 30 tall, px 13, fully round, the hover fill
            .buttonStyle(DesktopButtonStyle(kind: .hover, height: 30, horizontal: 13, radius: 15))
            .accessibilityIdentifier(identifier)
    }
}

private struct FolderPillLabel: View {
    @Environment(\.desktopTheme) private var theme
    var icon: [String]?
    let title: String
    var danger = false

    var body: some View {
        HStack(spacing: 6) {
            if let icon { FolderIconView(paths: icon, size: 14) }
            Text(verbatim: title)
        }
        .foregroundStyle(danger ? theme.danger : theme.ink)
    }
}

// MARK: - Bot folder

enum PersonaFolderDestination: Hashable {
    /// RULES.md or docs/<name>.md: /workspace/file.
    case doc(String)
    /// MEMORY.md or memory/…: /memory/file.
    case memory(String)
}

/// Bot folder (bot-settings/WorkspaceFilesSection.tsx). `replacesStack`:
/// true once this view draws the whole page (the window then stops
/// drawing the phone's file list with the memory under it).
struct PersonaBotFolderPage: View {
    static let replacesStack = true
    @Environment(\.desktopTheme) private var theme
    let bot: Bot
    let slackURL: URL?
    let memory: Bool

    var body: some View {
        ScrollView {
            PersonaBotFolderBody(bot: bot, memory: memory)
                .padding(.horizontal, 32)
                .padding(.top, 8)
                .padding(.bottom, 24)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .background(theme.app)
        .toolbar(.hidden, for: .navigationBar)
        .navigationDestination(for: PersonaFolderDestination.self) { destination in
            PersonaFolderDestinationView(bot: bot, destination: destination)
        }
    }
}

/// Where a folder row opens: the workspace editor or the memory editor.
private struct PersonaFolderDestinationView: View {
    let bot: Bot
    let destination: PersonaFolderDestination

    var body: some View {
        switch destination {
        case let .doc(path): BotWorkspaceDocEditor(bot: bot, path: path, startsNew: false)
        case let .memory(path): PersonaMemoryDocEditor(bot: bot, path: path)
        }
    }
}

private struct PersonaBotFolderBody: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var mode = DesktopInterfaceMode.shared
    let bot: Bot
    let memory: Bool

    @StateObject private var memoryModel: BotMemoryModel
    @State private var listing: BotWorkspaceListing?
    @State private var error: String?
    @State private var busy = false
    @State private var expanded: Set<String> = []
    @State private var selected: Set<String> = []
    @State private var creating: Creating?
    @State private var createParent: String?
    @State private var newName = ""
    @State private var renaming: String?
    @State private var renameText = ""
    @State private var moving: Moving?
    @State private var removing: Removing?
    @State private var showOptions = false
    @State private var importer = false
    @State private var uploadParent: String?
    @State private var uploading: String?
    /// A file just created opens in its editor (`setOpen` after `create`).
    @State private var pushed: PersonaFolderDestination?

    enum Creating { case file, folder, topic }

    struct Moving: Identifiable {
        var id: String { paths.joined(separator: "|") }
        var paths: [String]
    }

    struct Removing: Identifiable {
        var id: String { paths.joined(separator: "|") }
        var paths: [String]
        var name: String
        var count: Int?
    }

    init(bot: Bot, memory: Bool) {
        self.bot = bot
        self.memory = memory
        _memoryModel = StateObject(wrappedValue: BotMemoryModel(botId: bot.id))
    }

    private var memoryEnabled: Bool { bot.memoryEnabled != false }
    private var memoryEditable: Bool { memory && session.surfaceGate.allows(.advancedBotPanel, bot: bot) }
    private var switchColor: Color? { BubbleColors.user(botColor: bot.color)?.fill.color }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if memory { memoryToggle }
            intro
            toolbar
            if let creating { createCard(creating) }
            if !selected.isEmpty { bulkBar }
            if let uploading {
                DesktopText(verbatim: LF("Uploading %@…", uploading), size: 12.5, line: 18.75, color: \.inkSecondary)
            }
            if showOptions, memoryEditable { optionsCard }
            if let notice = memoryModel.notice, showOptions {
                DesktopText(verbatim: notice, size: 12.5, line: 18.75, color: \.inkSecondary)
            }
            if let error {
                DesktopText(verbatim: error, size: 12.5, line: 18.75, color: \.danger)
                    .accessibilityIdentifier("persona-folder.error")
            }
            if listing == nil, error == nil {
                DesktopText(verbatim: L("Loading files…"), size: 12.5, line: 18.75, color: \.inkSecondary)
            }
            if listing != nil { list }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("persona-folder")
        .task(id: bot.id) {
            memoryModel.client = session.profileClient
            await load()
            if memory { await memoryModel.refresh() }
        }
        .navigationDestination(isPresented: Binding(get: { pushed != nil }, set: { if !$0 { pushed = nil } })) {
            if let pushed { PersonaFolderDestinationView(bot: bot, destination: pushed) }
        }
        .fileImporter(isPresented: $importer, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            Task { await upload(result) }
        }
        .sheet(item: $moving) { move in
            NavigationStack {
                List {
                    Button(L("Bot folder")) { Task { await movePaths(move.paths, to: nil) } }
                        .accessibilityIdentifier("persona-folder.move-to.root")
                    ForEach(folders, id: \.self) { folder in
                        Button { Task { await movePaths(move.paths, to: folder) } } label: { Text(verbatim: "\(folder)/") }
                            .accessibilityIdentifier("persona-folder.move-to.\(folder)")
                    }
                }
                .navigationTitle(L("Move to…"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { moving = nil } } }
            }
            .presentationDetents([.medium])
        }
        .confirmationDialog(
            removing.map { $0.paths.count > 1 ? L("Delete") : LF("Delete %@", $0.name) } ?? "",
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            titleVisibility: .visible,
            presenting: removing
        ) { target in
            Button(L("Delete"), role: .destructive) { Task { await confirmDelete(target) } }
            Button(L("Cancel"), role: .cancel) {}
        } message: { target in
            Text(verbatim: deleteBody(target))
        }
    }

    // MARK: Header

    /// `MemoryToggleCard`: Use memory, its help, the switch in the bot's colour.
    private var memoryToggle: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    DesktopText(verbatim: L("Use memory"), size: 13, line: 18)
                        .fixedSize()
                    DesktopHelpTip(help: Text(verbatim: L("Off stops memory prompts, recall, native memory tools, upkeep, and automatic turn logs. Existing files remain available for review.")))
                }
                if bot.busy == true {
                    DesktopText(verbatim: L("Stop this bot's turn before changing this setting.").trimmingCharacters(in: .whitespaces),
                                size: 12, line: 19.5, color: \.inkSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            PanelSwitch(label: LocalizedStringKey(L("Use memory")), isOn: memoryEnabled,
                        disabled: !memoryEditable || busy || bot.busy == true, onColor: switchColor) { on in
                Task { await patch(BotAccessPatch(memoryEnabled: on)) }
            }
            .accessibilityIdentifier("persona-folder.memory-switch")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .desktopHairlineBox(radius: 12)
    }

    private var intro: some View {
        HStack(spacing: 6) {
            DesktopText(verbatim: L("Everything in this bot's folder."), size: 13, line: 19.5, color: \.inkSecondary)
                .fixedSize()
            DesktopHelpTip(help: introHelp)
        }
    }

    private var introHelp: Text {
        let intro = Text(verbatim: L("Everything in this bot's folder, and when each file reaches the bot. Put reference documents (procedures, templates, lists) in docs/: the bot sees their names every turn and reads one when it needs it."))
        guard mode.advanced, let path = memoryModel.overview?.workspacePath, !path.isEmpty else { return intro }
        return intro + Text(verbatim: "\n\n") + Text(verbatim: DisplayHygiene.displayWorkspacePath(path)).font(Theme.mono(12))
    }

    private var toolbar: some View {
        HStack(spacing: 8) {
            Menu {
                Button { startCreate(.file) } label: { Label(L("File"), systemImage: "doc") }
                    .accessibilityIdentifier("persona-folder.new.file")
                Button { startCreate(.folder) } label: { Label(L("Folder"), systemImage: "folder") }
                    .accessibilityIdentifier("persona-folder.new.folder")
                if memoryEditable {
                    Button { startCreate(.topic) } label: { Label(L("Memory topic"), systemImage: "doc") }
                        .accessibilityIdentifier("persona-folder.new.topic")
                }
            } label: {
                FolderPillLabel(icon: FolderIcon.filePlus, title: L("New"))
                    .font(theme.font(13))
                    .padding(.horizontal, 13)
                    .frame(height: 30)
                    .background(theme.hover, in: Capsule())
                    .contentShape(Rectangle())
            }
            .disabled(busy)
            .accessibilityLabel(Text(verbatim: L("What to create")))
            .accessibilityIdentifier("persona-folder.new")
            FolderPill(icon: DesktopSettingsIcon.upload.paths, title: L("Upload"), identifier: "persona-folder.upload") {
                uploadParent = nil
                importer = true
            }
            .disabled(busy)
            Spacer(minLength: 0)
            if memoryEditable {
                Button { showOptions.toggle() } label: {
                    FolderIconView(paths: FolderIcon.ellipsis, size: 16)
                        .foregroundStyle(theme.inkSecondary)
                        .padding(6)
                        .background(showOptions ? theme.control : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: L("Folder options")))
                .accessibilityValue(Text(showOptions ? "On" : "Off"))
                .accessibilityIdentifier("persona-folder.options")
            }
        }
    }

    private func createCard(_ kind: Creating) -> some View {
        let placeholder = switch kind {
        case .topic: L("New topic name, e.g. clients")
        case .folder: L("New folder name")
        case .file: L("New file name")
        }
        return HStack(spacing: 8) {
            TextField("", text: $newName, prompt: Text(verbatim: placeholder).foregroundColor(theme.inkSecondary))
                .font(theme.font(13))
                .foregroundStyle(theme.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .onSubmit { Task { await create() } }
                .padding(.horizontal, 10)
                .frame(maxWidth: 240, minHeight: 31.5)
                .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
                .accessibilityLabel(Text(verbatim: kind == .topic ? L("New topic name") : kind == .folder ? L("Name of the new folder") : L("Name of the new file")))
                .accessibilityIdentifier("persona-folder.new-name")
            FolderPill(title: L("Create"), identifier: "persona-folder.create") { Task { await create() } }
                .disabled(busy || newName.trimmingCharacters(in: .whitespaces).isEmpty)
            Button(L("Cancel")) { creating = nil }
                .buttonStyle(DesktopButtonStyle(kind: .ghost, size: 12.5, height: 28, horizontal: 8, radius: 6))
            Spacer(minLength: 0)
        }
        .padding(8)
        .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .desktopHairlineBox(radius: 12)
    }

    private var bulkBar: some View {
        HStack(spacing: 8) {
            DesktopText(verbatim: LF("%@ selected in the bot folder", "\(selected.count)"), size: 12.5, line: 18.75, color: \.inkSecondary)
                .fixedSize()
            FolderPill(icon: FolderIcon.folderInput, title: L("Move to…"), identifier: "persona-folder.bulk-move") {
                moving = Moving(paths: Array(selected).sorted())
            }
            .disabled(busy)
            FolderPill(icon: DesktopSettingsIcon.trash2.paths, title: L("Delete"), danger: true, identifier: "persona-folder.bulk-delete") {
                Task { await askDelete(Array(selected).sorted()) }
            }
            .disabled(busy)
            Button(L("Cancel")) { selected = [] }
                .buttonStyle(DesktopButtonStyle(kind: .ghost, size: 12.5, height: 28, horizontal: 8, radius: 6))
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .desktopHairlineBox(radius: 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("persona-folder.bulk")
    }

    // MARK: Options (MemoryFolderOptions)

    private var optionsCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            if memoryEnabled {
                FolderPaneSection(title: L("Upkeep")) {
                    HStack(spacing: 16) {
                        HStack(spacing: 6) {
                            DesktopText(verbatim: L("Tidy memory automatically"), size: 13, line: 18).fixedSize()
                            DesktopHelpTip(help: Text(verbatim: L("Saves facts from chats, tidies the notes each night, and keeps every change so you can undo it.")))
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        PanelSwitch(label: LocalizedStringKey(L("Tidy memory automatically")), isOn: bot.memoryUpkeep != false,
                                    disabled: !memoryEditable || busy, onColor: switchColor) { on in
                            Task { await patch(BotAccessPatch(memoryUpkeep: on)) }
                        }
                        .accessibilityIdentifier("persona-folder.upkeep-switch")
                    }
                    if bot.memoryUpkeep != false {
                        HStack(spacing: 12) {
                            FolderPill(title: memoryModel.tidying ? L("Tidying…") : L("Tidy up now"), identifier: "persona-folder.tidy") {
                                Task {
                                    await memoryModel.tidy()
                                    await load()
                                }
                            }
                            .disabled(memoryModel.tidying)
                            DesktopText(verbatim: upkeepLine, size: 12.5, line: 18.75, color: \.inkSecondary)
                        }
                        .padding(.top, 12)
                    }
                }
            }
            FolderPaneSection(title: L("Changes"), help: L("Every change to these files, whoever made it. Undo puts a file back the way it was before that change.")) {
                journal
            }
        }
        .padding(12)
        .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .desktopHairlineBox(radius: 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("persona-folder.options-card")
    }

    private var upkeepLine: String {
        var line = memoryModel.upkeep?.lastTidy.map {
            LF("Tidied %@: %@.", BotAdvancedWording.ago($0.at), BotAdvancedWording.tidySummary($0).lowercased())
        } ?? L("Not tidied yet.")
        if let capture = memoryModel.upkeep?.lastCapture {
            let receipt = BotAdvancedWording.captureReceipt(capture)
            if !receipt.isEmpty { line += " " + receipt }
        }
        return line
    }

    @ViewBuilder
    private var journal: some View {
        if let rows = memoryModel.journal {
            if rows.isEmpty {
                DesktopText(verbatim: L("No changes recorded yet."), size: 13, line: 19.5, color: \.inkSecondary)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(rows) { row in
                        HStack(alignment: .top, spacing: 12) {
                            DesktopText(verbatim: [BotAdvancedWording.journalSummary(row, botName: bot.name), BotAdvancedWording.ago(row.at),
                                                   BotAdvancedWording.journalSource(row)].compactMap { $0 }.joined(separator: " · "),
                                        size: 13, line: 21.125)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            if row.canRevert {
                                Button {
                                    Task {
                                        await memoryModel.revert(row)
                                        await load()
                                    }
                                } label: {
                                    HStack(spacing: 4) {
                                        DesktopSettingsIconView(icon: .rotateCcw, size: 12)
                                        Text(verbatim: memoryModel.reverting == row.id ? L("Undoing…") : L("Undo"))
                                    }
                                    .font(theme.font(12, .medium))
                                    .foregroundStyle(theme.accentText)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 4)
                                }
                                .buttonStyle(.plain)
                                .disabled(memoryModel.reverting != nil || !memoryEditable)
                            } else {
                                Text(verbatim: L("Can't undo")).font(theme.font(11.5)).foregroundStyle(theme.inkSecondary)
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                }
            }
        } else {
            DesktopText(verbatim: L("Loading…"), size: 13, line: 19.5, color: \.inkSecondary)
        }
    }

    // MARK: The list

    private struct Row: Identifiable {
        var id: String { path }
        var path: String
        var isDirectory: Bool
        var load: String?
        var bytes: Int?
        var modifiedAt: Double?
        var createdAt: Double? = nil
        var lastUsedAt: Double? = nil
        var forgotten = false
        var editable: Bool
        var markdown: Bool
        /// SOUL.md, from the listing's own entry: it opens the Personality page.
        var soul: Bool
        var name: String { path.split(separator: "/").last.map(String.init) ?? path }
        var depth: Int { path.split(separator: "/").count - 1 }
        var core: Bool { soul || BotWorkspaceFiles.isCore(path) }
    }

    private var rows: [Row] {
        guard let listing else { return [] }
        var all: [Row] = []
        if let soul = listing.soul {
            all.append(Row(path: soul.path ?? "SOUL.md", isDirectory: false, load: soul.load ?? "every-turn", bytes: soul.bytes,
                           modifiedAt: soul.modifiedAt, createdAt: soul.createdAt, lastUsedAt: soul.lastUsedAt,
                           editable: false, markdown: true, soul: true))
        }
        let listedDirs = Set(listing.entries.filter(\.isDirectory).map(\.path))
        for entry in listing.entries where entry.path != (listing.soul?.path ?? "SOUL.md") {
            var parent = parentPath(entry.path)
            var visible = true
            while let current = parent {
                if listedDirs.contains(current), !expanded.contains(current) { visible = false; break }
                parent = parentPath(current)
            }
            guard visible else { continue }
            all.append(Row(path: entry.path, isDirectory: entry.isDirectory, load: entry.load, bytes: entry.bytes,
                           modifiedAt: entry.modifiedAt, createdAt: entry.createdAt, lastUsedAt: entry.lastUsedAt, forgotten: entry.forgotten == true,
                           editable: entry.editable == true, markdown: entry.markdown == true, soul: false))
        }
        return all
    }

    private var folders: [String] { (listing?.entries ?? []).filter(\.isDirectory).map(\.path) }

    private var list: some View {
        let shown = rows
        return VStack(spacing: 0) {
            ForEach(Array(shown.enumerated()), id: \.element.id) { index, row in
                rowView(row)
                if index < shown.count - 1 { Rectangle().fill(theme.hairline40).frame(height: 1) }
            }
            if shown.count == 1, listing?.entries.isEmpty == true {
                Rectangle().fill(theme.hairline40).frame(height: 1)
                DesktopText(verbatim: L("No files yet."), size: 12.5, line: 18.75, color: \.inkSecondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .desktopHairlineBox(radius: 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("persona-folder.list")
    }

    private func icon(for row: Row) -> [String] {
        if row.isDirectory { return FolderIcon.folder }
        let lower = row.name.lowercased()
        if ["png", "jpg", "jpeg", "gif", "webp", "heic", "svg"].contains(where: { lower.hasSuffix(".\($0)") }) { return FolderIcon.image }
        if ["md", "txt", "pdf", "doc", "docx", "rtf", "csv", "json"].contains(where: { lower.hasSuffix(".\($0)") }) { return FolderIcon.fileText }
        return FolderIcon.file
    }

    private func rowView(_ row: Row) -> some View {
        let open = expanded.contains(row.path)
        return VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 8) {
                if !row.core { checkbox(row) }
                if row.isDirectory {
                    Button { toggle(row.path) } label: {
                        HStack(spacing: 8) {
                            FolderIconView(paths: FolderIcon.chevronRight, size: 12)
                                .rotationEffect(.degrees(open ? 90 : 0))
                            FolderIconView(paths: FolderIcon.folder, size: 14)
                            Text(verbatim: "\(row.name)/")
                                .font(theme.font(13))
                                .lineLimit(1)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .foregroundStyle(theme.inkSecondary)
                        .frame(minHeight: 22)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(verbatim: LF(open ? "Collapse %@" : "Expand %@", row.name)))
                    .accessibilityValue(Text(open ? "On" : "Off"))
                    .accessibilityIdentifier("persona-folder.toggle.\(row.path)")
                } else {
                    Color.clear.frame(width: 12, height: 1)
                    FolderIconView(paths: icon(for: row), size: 14).foregroundStyle(theme.inkSecondary)
                    if renaming == row.path {
                        TextField("", text: $renameText)
                            .font(theme.font(13))
                            .foregroundStyle(theme.ink)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.done)
                            .onSubmit { Task { await rename(row) } }
                            .padding(.horizontal, 8)
                            .frame(minHeight: 26)
                            .background(theme.inset, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                            .accessibilityLabel(Text(verbatim: L("New name")))
                            .accessibilityIdentifier("persona-folder.rename-input")
                    } else {
                        openButton(row)
                    }
                    if row.forgotten {
                        // `data-forgotten-badge`: no use in 30 days
                        Text(verbatim: L("Forgotten"))
                            .font(theme.font(11))
                            .foregroundStyle(theme.warning)
                            .padding(.horizontal, 8)
                            .frame(height: 20)
                            .background(theme.warning.opacity(0.15), in: Capsule())
                            .fixedSize()
                            .accessibilityIdentifier("persona-folder.forgotten.\(row.path)")
                    }
                    if !row.isDirectory { loadChip(row.load ?? "on-demand") }
                }
                rowMenu(row)
            }
            .padding(.leading, CGFloat(row.depth) * 16)
            if mode.advanced, !row.isDirectory {
                DesktopText(verbatim: details(row), size: 11.5, line: 17.25, color: \.inkTertiary)
                    .padding(.leading, CGFloat(row.depth) * 16 + 42)
                    .accessibilityIdentifier("persona-folder.details.\(row.path)")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("persona-folder.row.\(row.path)")
    }

    private func checkbox(_ row: Row) -> some View {
        let checked = selected.contains(row.path)
        return Button {
            if checked { selected.remove(row.path) } else { selected.insert(row.path) }
        } label: {
            ZStack {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(checked ? theme.accent : .clear)
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .strokeBorder(checked ? theme.accent : theme.hairline, lineWidth: 1)
                if checked {
                    FolderIconView(paths: FolderIcon.check, size: 10, strokeWidth: 3).foregroundStyle(.white)
                }
            }
            .frame(width: 16, height: 16)
            .frame(minWidth: 16, minHeight: 22)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: LF("Select %@", row.name)))
        .accessibilityValue(Text(checked ? "On" : "Off"))
        .accessibilityIdentifier("persona-folder.select.\(row.path)")
    }

    @ViewBuilder
    private func openButton(_ row: Row) -> some View {
        let label = Text(verbatim: row.name)
            .font(theme.font(13))
            .foregroundStyle(theme.ink)
            .lineLimit(1)
            .frame(maxWidth: .infinity, minHeight: 22, alignment: .leading)
            .contentShape(Rectangle())
        if let destination = destination(row) {
            NavigationLink(value: destination) { label }
                .buttonStyle(.plain)
                .accessibilityIdentifier("persona-folder.open.\(row.path)")
        } else {
            Button {
                if row.soul { model.personaPage = .soul } else { Task { await download(row.path) } }
            } label: { label }
                .buttonStyle(.plain)
                .accessibilityIdentifier("persona-folder.open.\(row.path)")
        }
    }

    /// Where a tap opens it in place (`openEntry`): RULES.md and docs/ in
    /// the workspace editor, MEMORY.md and memory/ in the memory editor.
    private func destination(_ row: Row) -> PersonaFolderDestination? {
        guard !row.soul, !row.isDirectory, row.markdown else { return nil }
        if BotWorkspaceFiles.isDoc(row.path) { return .doc(row.path) }
        if row.editable, memoryEditable, row.path == "MEMORY.md" || row.path.hasPrefix("memory/") { return .memory(row.path) }
        return nil
    }

    /// `LoadBadge`: Every turn, On demand, Never loaded.
    private func loadChip(_ load: String) -> some View {
        let (title, fill, ink): (String, Color, Color) = switch load {
        case "every-turn": (L("Every turn"), theme.accent.opacity(0.15), theme.ink)
        case "never": (L("Never loaded"), .clear, theme.inkTertiary)
        default: (L("On demand"), theme.raised, theme.inkSecondary)
        }
        return Text(verbatim: title)
            .font(theme.font(11))
            .foregroundStyle(ink)
            .padding(.horizontal, 8)
            .frame(height: 20)
            .background(fill, in: Capsule())
            .overlay { if load == "never" { Capsule().strokeBorder(theme.hairline40, lineWidth: 1) } }
            .fixedSize()
    }

    private func rowMenu(_ row: Row) -> some View {
        Menu {
            if !row.core {
                Button { renameText = row.name; renaming = row.path } label: { Label(LF("Rename %@", row.name), systemImage: "pencil") }
                Button { moving = Moving(paths: [row.path]) } label: { Label(L("Move to…"), systemImage: "folder") }
            }
            if row.isDirectory {
                Button { uploadParent = row.path; importer = true } label: { Label(L("Upload into this folder"), systemImage: "square.and.arrow.up") }
            }
            if !row.isDirectory, !row.soul {
                Button { Task { await download(row.path) } } label: { Label(LF("Download %@", row.name), systemImage: "square.and.arrow.down") }
            }
            if !row.core {
                Button(role: .destructive) { Task { await askDelete([row.path]) } } label: { Label(LF("Delete %@", row.name), systemImage: "trash") }
            }
        } label: {
            FolderIconView(paths: FolderIcon.ellipsis, size: 14)
                .foregroundStyle(theme.inkSecondary)
                .padding(4)
                .contentShape(Rectangle())
        }
        .disabled(busy)
        .accessibilityLabel(Text(verbatim: LF("Actions for %@", row.name)))
        .accessibilityIdentifier("persona-folder.menu.\(row.path)")
    }

    /// `entryDetails`: size or budget, dates (Advanced only).
    private func details(_ row: Row) -> String {
        var parts: [String] = []
        if row.soul, let maxBytes = listing?.soul?.budget?.maxBytes {
            // budgetBytes: "372 B / 23.4 KB"
            parts.append(LF("%@ / %@", folderBytes(row.bytes ?? 0), folderBytes(maxBytes)))
        } else if row.path == "MEMORY.md", let index = memoryModel.overview?.index {
            parts.append(LF("%@ / %@ lines · %@ / %@", "\(index.lines)", "\(index.maxLines)", folderBytes(index.bytes), folderBytes(index.maxBytes)))
        } else {
            parts.append(folderBytes(row.bytes ?? 0))
        }
        if let created = row.createdAt { parts.append(LF("created %@", BotAdvancedWording.ago(created))) }
        if let modified = row.modifiedAt { parts.append(LF("modified %@", BotAdvancedWording.ago(modified))) }
        parts.append(row.lastUsedAt.map { LF("file last used %@", BotAdvancedWording.ago($0)) } ?? L("not used yet"))
        return parts.joined(separator: " · ")
    }

    // MARK: Work

    private func parentPath(_ path: String) -> String? {
        guard let slash = path.lastIndex(of: "/") else { return nil }
        return String(path[..<slash])
    }

    private func reveal(_ path: String) {
        var parent = parentPath(path)
        while let current = parent {
            expanded.insert(current)
            parent = parentPath(current)
        }
    }

    private func toggle(_ path: String) {
        if expanded.contains(path) { expanded.remove(path) } else { expanded.insert(path) }
    }

    private func startCreate(_ kind: Creating, parent: String? = nil) {
        creating = kind
        createParent = parent
        newName = ""
    }

    /// `safeFileName`: no slashes, no leading dots, at most 190 characters.
    private func safeName(_ name: String) -> String? {
        var stem = name.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: "\\", with: "-")
        while stem.hasPrefix(".") { stem.removeFirst() }
        return stem.isEmpty || stem.count > 190 ? nil : stem
    }

    private func load() async {
        guard let client = session.profileClient else { return }
        do {
            listing = try await client.botWorkspace(botId: bot.id)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func run(_ work: () async throws -> Void) async {
        busy = true
        error = nil
        defer { busy = false }
        do { try await work() } catch { self.error = error.localizedDescription }
    }

    private func patch(_ patch: BotAccessPatch) async {
        guard let client = session.profileClient else { return }
        await run { session.applyProfileBot(try await client.patchBotAccess(botId: bot.id, patch: patch)) }
    }

    private func create() async {
        guard let kind = creating, let client = session.profileClient, let name = safeName(newName) else { return }
        await run {
            switch kind {
            case .topic:
                guard let file = MemoryRules.topicFileName(newName) else {
                    throw FolderFailure(L("Give the topic a name: letters, numbers, spaces, dots or dashes."))
                }
                let path = "memory/\(file)"
                // the empty file's hash: a topic that already exists is refused
                let empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
                if case .conflict = try await client.saveMemoryDoc(botId: bot.id, path: path, text: MemoryRules.topicTemplate(file), expectedHash: empty) {
                    throw FolderFailure(LF("%@ already exists.", path))
                }
                creating = nil
                newName = ""
                await load()
                reveal(path)
                await memoryModel.refresh()
                pushed = .memory(path)
            case .folder:
                let path = BotWorkspaceFiles.join(parent: createParent, name: name)
                try await client.createWorkspaceFolder(botId: bot.id, path: path)
                creating = nil
                newName = ""
                await load()
                reveal(path)
                expanded.insert(path)
            case .file:
                let path = BotWorkspaceFiles.join(parent: createParent, name: name)
                let markdown = name.lowercased().hasSuffix(".md")
                let text = markdown ? "# \(name.replacingOccurrences(of: ".md", with: "", options: [.caseInsensitive, .anchored, .backwards]))\n" : ""
                try await client.createWorkspaceFile(botId: bot.id, path: path, text: text)
                creating = nil
                newName = ""
                await load()
                reveal(path)
                if BotWorkspaceFiles.isDoc(path) { pushed = .doc(path) }
                else if markdown, memoryEditable, path.hasPrefix("memory/") { pushed = .memory(path) }
            }
        }
    }

    private func rename(_ row: Row) async {
        guard let client = session.profileClient else { return }
        guard !row.core else { error = L("SOUL.md, MEMORY.md and RULES.md stay in place."); renaming = nil; return }
        guard let name = safeName(renameText) else { error = L("Use a name with letters, digits, spaces, dots, dashes or underscores."); return }
        let target = BotWorkspaceFiles.join(parent: parentPath(row.path), name: name)
        guard target != row.path else { renaming = nil; return }
        await run {
            try await client.renameWorkspaceEntry(botId: bot.id, from: row.path, to: target)
            renaming = nil
            await load()
        }
    }

    private func movePaths(_ paths: [String], to folder: String?) async {
        guard let client = session.profileClient else { return }
        let usable = paths.filter { !BotWorkspaceFiles.isCore($0) }
        guard !usable.isEmpty else { error = L("SOUL.md, MEMORY.md and RULES.md stay in place."); moving = nil; return }
        await run {
            for path in usable {
                let name = path.split(separator: "/").last.map(String.init) ?? path
                let to = BotWorkspaceFiles.join(parent: folder, name: name)
                if to == path || to.hasPrefix("\(path)/") { continue }
                try await client.renameWorkspaceEntry(botId: bot.id, from: path, to: to)
            }
            selected = []
            moving = nil
            await load()
            if let folder { reveal(folder); expanded.insert(folder) }
        }
    }

    private func askDelete(_ paths: [String]) async {
        let usable = paths.filter { !BotWorkspaceFiles.isCore($0) && $0 != "SOUL.md" }
        guard !usable.isEmpty else { error = L("SOUL.md, MEMORY.md and RULES.md stay in place."); return }
        var count: Int?
        if usable.count == 1, let only = usable.first, folders.contains(only), let client = session.profileClient {
            count = (try? await client.countWorkspaceFiles(botId: bot.id, path: only)) ?? 0
        }
        let name = usable.count == 1 ? (usable[0].split(separator: "/").last.map(String.init) ?? usable[0]) : ""
        removing = Removing(paths: usable, name: name, count: count)
    }

    private func deleteBody(_ target: Removing) -> String {
        if target.paths.count > 1 { return LF("Delete %@ items? This cannot be undone.", "\(target.paths.count)") }
        if let count = target.count, count > 0 { return LF("Delete %@ and its %@ files? This cannot be undone.", target.name, "\(count)") }
        return LF("Delete %@? The change is kept in Changes and can be undone there.", target.paths.first ?? target.name)
    }

    private func confirmDelete(_ target: Removing) async {
        guard let client = session.profileClient else { return }
        removing = nil
        await run {
            for path in target.paths {
                try await client.deleteWorkspaceEntry(botId: bot.id, path: path, recursive: true)
            }
            selected = []
            await load()
            if memory { await memoryModel.refresh() }
        }
    }

    private func upload(_ result: Result<[URL], Error>) async {
        guard let client = session.profileClient else { return }
        let max = listing?.uploadMaxBytes ?? 250 * 1024 * 1024
        await run {
            for url in try result.get() {
                guard url.startAccessingSecurityScopedResource() else { continue }
                defer { url.stopAccessingSecurityScopedResource() }
                let data = try Data(contentsOf: url)
                guard data.count <= max else { error = LF("Each file must be under %@.", folderBytes(max)); continue }
                guard let name = safeName(url.lastPathComponent) else { error = L("Use a name with letters, digits, spaces, dots, dashes or underscores."); continue }
                let path = BotWorkspaceFiles.join(parent: uploadParent, name: name)
                uploading = name
                defer { uploading = nil }
                do { try await client.uploadWorkspaceFile(botId: bot.id, path: path, data: data) }
                catch { throw FolderFailure(LF("Could not upload %@.", name)) }
                reveal(path)
            }
            if let uploadParent { expanded.insert(uploadParent) }
            await load()
        }
    }

    private func download(_ path: String) async {
        guard let client = session.profileClient else { return }
        await run {
            let data = try await client.downloadWorkspaceFile(botId: bot.id, path: path)
            let name = path.split(separator: "/").last.map(String.init) ?? path
            let temp = FileManager.default.temporaryDirectory.appendingPathComponent(name)
            try data.write(to: temp, options: .atomic)
            let activity = UIActivityViewController(activityItems: [temp], applicationActivities: nil)
            let root = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .first { $0.isKeyWindow }?
                .rootViewController
            var top = root
            while let presented = top?.presentedViewController { top = presented }
            activity.popoverPresentationController?.sourceView = top?.view
            activity.popoverPresentationController?.sourceRect = CGRect(x: (top?.view.bounds.midX ?? 0), y: (top?.view.bounds.midY ?? 0), width: 1, height: 1)
            top?.present(activity, animated: true)
        }
    }
}

private struct FolderFailure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

/// MEMORY.md or a memory/ file in the markdown editor, saved with the hash
/// it was read at (`saveMemoryDoc`); a log under memory/log/ is read only.
struct PersonaMemoryDocEditor: View {
    @EnvironmentObject private var session: Session
    let bot: Bot
    let path: String

    @State private var doc: MemoryDoc?
    @State private var draft = ""
    @State private var failure: String?
    @State private var saving = false
    @State private var conflict: (current: String, hash: String)?

    private var readOnly: Bool { MemoryRules.readOnly(path) }
    private var dirty: Bool { doc.map { $0.text != draft } ?? false }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if readOnly {
                    Text(verbatim: L("Read only here. Download it, or edit it where it belongs."))
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                }
                if doc != nil {
                    MarkdownEditor(text: $draft, minHeight: 320, footer: path,
                                   accessibilityLabel: (path as NSString).lastPathComponent, identifier: "memory-doc-editor")
                        .disabled(readOnly)
                } else if let failure {
                    Text(verbatim: failure).foregroundStyle(Theme.textSecondary)
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
            .padding()
        }
        .navigationTitle((path as NSString).lastPathComponent)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !readOnly {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Save")) { Task { await save(expectedHash: doc?.hash) } }
                        .disabled(!dirty || saving)
                        .accessibilityIdentifier("memory-doc-save")
                }
            }
        }
        .alert(L("This file changed since you opened it, probably the bot. Reload its version, or save yours over it."),
               isPresented: Binding(get: { conflict != nil }, set: { if !$0 { conflict = nil } })) {
            Button(L("Reload")) {
                if let conflict { doc = MemoryDoc(path: path, text: conflict.current, hash: conflict.hash); draft = conflict.current }
            }
            Button(L("Save mine anyway"), role: .destructive) {
                let hash = conflict?.hash
                Task { await save(expectedHash: hash) }
            }
            Button(L("Cancel"), role: .cancel) {}
        }
        .task { await load() }
    }

    private func load() async {
        guard let client = session.profileClient else { return }
        do {
            let loaded = try await client.memoryDoc(botId: bot.id, path: path)
            doc = loaded
            draft = loaded.text
        } catch { failure = error.localizedDescription }
    }

    private func save(expectedHash: String?) async {
        guard let client = session.profileClient else { return }
        saving = true
        defer { saving = false }
        do {
            switch try await client.saveMemoryDoc(botId: bot.id, path: path, text: draft, expectedHash: expectedHash) {
            case let .saved(saved, _):
                doc = saved
                draft = saved.text
            case let .conflict(current, hash):
                conflict = (current, hash)
            }
        } catch { session.actionError = error.localizedDescription }
    }
}

// MARK: - Access

/// Access (bot-settings/AccessSection.tsx).
struct PersonaAccessPage: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot
    let slackURL: URL?

    @State private var config: ConfigStatus?
    @State private var instances: [Instance] = []
    @State private var servers: [MCPServerListing]?
    @State private var serversFailed = false
    @State private var webhooks: [WebhookListing]?
    @State private var openRoutine: Routine?
    @State private var folder = ""
    @State private var saving = false
    @State private var moreOpen = false
    /// BackgroundBriefCard's GET /api/bots/:id/background-brief.
    @State private var brief: BotBackgroundBrief?
    @State private var briefError: String?

    private var canEdit: Bool { session.surfaceGate.allows(.botAccessEdit, bot: bot) }
    private func edits(_ field: String) -> Bool { canEdit && session.canEditBotField(bot, field) }
    private var organization: Bool { session.surfaceGate.organization }
    private var worksOn: DesktopWorksOn { DesktopWorksOn.of(bot) }
    private var engine: Instance? { instances.first { $0.instanceId == bot.modelSelection.instanceId } }
    private var modelCanBrowse: Bool { engine?.capabilities?.browserMcp == true && engine?.driverKind != "boxAgent" }
    private var browserSelectable: Bool { DesktopWorksOnRules.browserSelectable(config: config, modelCanBrowse: modelCanBrowse) }
    private var switchColor: Color? { BubbleColors.user(botColor: bot.color)?.fill.color }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            if !organization, worksOn == .auto || bot.computer == "cloud",
               DesktopWorksOnRules.showsCloudBackend(worksOn: worksOn, config: config, organization: organization) {
                cloudBackend
            }
            mcpSection
            briefSection
            if DesktopWorksOnRules.browserFeature(config) { browserSection }
            moreOptions
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("persona-access")
        .onAppear { folder = bot.cwd ?? "" }
        .onChange(of: bot.cwd) { cwd in folder = cwd ?? "" }
        .sheet(item: $openRoutine) { routine in
            NavigationStack { RoutineDetailView(routine: routine) }
        }
        .task {
            config = await session.configStatus()
            instances = await DesktopModelCatalog.shared.instances(session)
        }
        .task(id: bot.id) {
            if let client = session.profileClient ?? session.settingsClient {
                brief = try? await client.botBackgroundBrief(botId: bot.id)
            }
            await loadServers()
            if let client = session.profileClient {
                webhooks = (try? await client.webhooks())?.of(botId: bot.id) ?? []
            }
        }
    }

    // MARK: Cloud backend

    private var cloudBackend: some View {
        let backend = bot.cloudBackend ?? "box"
        return FolderPaneSection(identifier: "persona-access.cloud") {
            if bot.computer == nil {
                (Text(verbatim: L("Auto and cloud computers.")).font(theme.font(11.5, .medium)).foregroundColor(theme.ink)
                 + Text(verbatim: " " + L("Auto may reuse the cloud computer below when it is already running. Opening these settings never creates or wakes one.")))
                    .font(theme.font(11.5))
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .padding(.bottom, 12)
            }
            Text("Cloud backend").font(theme.font(12, .medium)).foregroundStyle(theme.ink)
            Text("Boat is the default hosted computer. Choose Self-hosted VPS to use your SSH-configured Linux Docker host.")
                .font(theme.font(11.5))
                .foregroundStyle(theme.inkSecondary)
                .padding(.top, 2)
            HStack(spacing: 0) {
                backendButton("Boat", value: "box", on: backend == "box")
                Rectangle().fill(theme.hairline40).frame(width: 1)
                backendButton("Self-hosted VPS", value: "vps", on: backend == "vps")
            }
            .frame(height: 30)
            .padding(1)
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .padding(.top, 8)
        }
    }

    private func backendButton(_ title: LocalizedStringKey, value: String, on: Bool) -> some View {
        Button {
            guard !on else { return }
            Task { _ = await sendPanelPatch(BotPanelPatch(cloudBackend: value), bot: bot, session: session) }
        } label: {
            Text(title)
                .font(theme.font(12))
                .foregroundStyle(on ? theme.ink : theme.inkSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(on ? theme.raised : .clear)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!edits("cloudBackend"))
    }

    // MARK: MCP servers

    private var mcpSection: some View {
        FolderPaneSection(title: L("MCP servers"),
                          help: L("Controls which servers are offered to this bot. Individual tool approvals depend on the model provider and approval mode."),
                          identifier: "persona-access.mcp") {
            if serversFailed {
                HStack(spacing: 4) {
                    Text(verbatim: L("Could not refresh MCP servers.")).font(theme.font(12)).foregroundStyle(theme.danger)
                    Button { Task { await loadServers() } } label: {
                        Text(verbatim: L("Retry")).font(theme.font(12)).underline().foregroundStyle(theme.danger)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.bottom, 8)
            }
            if let servers {
                if servers.isEmpty {
                    DesktopText(verbatim: L("No MCP servers added yet."), size: 12.5, line: 18.75, color: \.inkSecondary)
                        .accessibilityIdentifier("persona-access.mcp-empty")
                } else {
                    let mounted = Set(AccessRules.mounted(servers, own: bot.mcpServers).map(\.name))
                    VStack(spacing: 0) {
                        ForEach(Array(servers.enumerated()), id: \.element.id) { index, server in
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 0) {
                                    Text(verbatim: server.name)
                                        .font(Theme.mono(12.5))
                                        .foregroundStyle(theme.ink)
                                        .lineLimit(1)
                                    if server.enabled == false {
                                        DesktopText(verbatim: L("Switched off in Capabilities > Installed. Test it and turn it on there first."),
                                                    size: 11.5, line: 17.25, color: \.inkSecondary)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                PanelSwitch(label: LocalizedStringKey(LF("Let this bot use %@", server.name)), isOn: mounted.contains(server.name),
                                            disabled: !edits("mcpServers") || server.enabled == false || bot.busy == true || saving || serversFailed,
                                            onColor: switchColor) { _ in
                                    access(BotAccessPatch(mcpServers: AccessRules.toggledMcp(servers, own: bot.mcpServers, name: server.name)))
                                }
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .frame(minHeight: 44)
                            .accessibilityElement(children: .contain)
                            .accessibilityIdentifier("persona-access.mcp.\(server.name)")
                            if index < servers.count - 1 { Rectangle().fill(theme.hairline40).frame(height: 1) }
                        }
                    }
                    .padding(.horizontal, -14)
                    .padding(.top, -4)
                }
            } else if !serversFailed {
                DesktopText(verbatim: L("Loading MCP servers…"), size: 12.5, line: 18.75, color: \.inkSecondary)
            }
            HStack(spacing: 8) {
                Button {
                    model.personaOpen = false
                    model.pluginsTab = .mcp
                    model.modal = .plugins
                } label: {
                    HStack(spacing: 4) {
                        Text(verbatim: L("Manage in Capabilities")).font(theme.font(12.5, .medium))
                        FolderIconView(paths: FolderIcon.arrowUpRight, size: 13)
                    }
                    .foregroundStyle(theme.accentText)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("persona-access.manage-mcp")
                Spacer(minLength: 0)
                if edits("mcpServers"), bot.mcpServers != nil, let servers, !servers.isEmpty {
                    FolderPill(title: L("Use every enabled server"), identifier: "persona-access.mcp-use-all") { clearMcp() }
                        .disabled(bot.busy == true || saving || serversFailed)
                }
            }
            .padding(.top, 12)
            if bot.busy == true {
                DesktopText(verbatim: L("Wait until this bot finishes all active tasks before changing its MCP servers."),
                            size: 12, line: 18, color: \.inkSecondary)
                    .padding(.top, 8)
            }
        }
    }

    // MARK: Background brief

    /// `BackgroundBriefCard` (GET / PUT /api/bots/:id/background-brief):
    /// on with its daily time, the line about the connected apps, the link.
    private var briefSection: some View {
        let on = brief?.settings.enabled ?? false
        return FolderPaneSection(title: L("Background brief"), identifier: "persona-access.brief") {
            HStack(spacing: 8) {
                PanelSwitch(label: LocalizedStringKey(L("Send the brief every day at")), isOn: on, disabled: brief == nil, onColor: switchColor) { value in
                    saveBrief(enabled: value)
                }
                .accessibilityIdentifier("persona-access.brief-switch")
                Text(verbatim: L("Send the brief every day at")).font(theme.font(12.5)).foregroundStyle(theme.ink)
                DatePicker("", selection: briefTime, displayedComponents: .hourAndMinute)
                    .labelsHidden()
                    .datePickerStyle(.compact)
                    .disabled(brief == nil || !on)
                    .accessibilityLabel(Text(verbatim: L("Time of the daily brief")))
                    .accessibilityIdentifier("persona-access.brief-time")
                Spacer(minLength: 0)
            }
            .padding(.bottom, 8)
            if brief?.notice == "no_apps" {
                DesktopText(verbatim: L("No app is connected. The queue stays empty."), size: 15, weight: .medium, line: 22)
            }
            if let briefError {
                DesktopText(verbatim: briefError, size: 12, line: 16, color: \.danger)
            }
            Button { readBrief() } label: {
                Text(verbatim: L("Read connectors and MCP servers"))
                    .font(theme.font(12.5))
                    .underline()
                    .foregroundStyle(theme.inkSecondary)
            }
            .buttonStyle(.plain)
            .padding(.top, 8)
        }
    }

    /// `at` (HH:MM, the brief's time zone shown as the device's).
    private var briefTime: Binding<Date> {
        Binding(get: {
            let parts = (brief?.settings.at ?? "08:00").split(separator: ":").compactMap { Int($0) }
            var components = DateComponents()
            components.hour = parts.first ?? 8
            components.minute = parts.count > 1 ? parts[1] : 0
            return Calendar.current.date(from: components) ?? Date()
        }, set: { date in
            let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
            saveBrief(at: String(format: "%02d:%02d", parts.hour ?? 8, parts.minute ?? 0))
        })
    }

    /// `read()`: one pass over the connected apps, then the card reloads.
    private func readBrief() {
        guard let client = session.profileClient ?? session.settingsClient else { return }
        let botId = bot.id
        briefError = nil
        Task {
            do {
                try await client.runBotBackgroundBriefPass(botId: botId)
                brief = try? await client.botBackgroundBrief(botId: botId)
            } catch {
                briefError = error.localizedDescription
            }
        }
    }

    private func saveBrief(enabled: Bool? = nil, at: String? = nil) {
        guard let client = session.profileClient ?? session.settingsClient else { return }
        let botId = bot.id
        Task {
            let zone = at == nil ? nil : TimeZone.current.identifier
            if let saved = try? await client.setBotBackgroundBrief(botId: botId, enabled: enabled, at: at, timeZone: zone) {
                brief?.settings = saved
            }
        }
    }

    // MARK: Browser

    private var browserSection: some View {
        let on = bot.browser != false && worksOn != .off
        return FolderPaneSection(title: L("Browser"), identifier: "persona-access.browser") {
            HStack(spacing: 16) {
                DesktopText(verbatim: browserDetail, size: 13, line: 19.5, color: \.inkSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                PanelSwitch(label: LocalizedStringKey(L("Give this bot a built-in browser")), isOn: on,
                            disabled: !edits("browser") || worksOn == .off || (!on && !browserSelectable), onColor: switchColor) { value in
                    access(BotAccessPatch(browser: value))
                }
            }
        }
    }

    private var browserDetail: String {
        if !DesktopWorksOnRules.browserAvailable(config) {
            switch DesktopWorksOnRules.browserBlock(config: config) {
            case .notInstalled: return String(localized: "The browser engine is not installed on this server yet. Enable the browser switches in App Settings → Experimental and the bot's Access settings, then open Bot's computer → Browser to install it. Or run `sagax browser install` on the server.")
            case let .server(reason): return reason
            case .noEngine: return String(localized: "This server has no browser engine.")
            case .featureOff: return String(localized: "The built-in browser is switched off under App Settings → Experimental")
            case .model: return String(localized: "This model cannot use the built-in browser")
            }
        }
        if !modelCanBrowse { return L("This bot's current model cannot use the built-in browser.") }
        if worksOn == .off { return L("Workspace is set to Off, so this bot has no browser. Pick another destination above to give it one.") }
        return bot.browser != false ? L("This bot has its own browser with its own logins.") : L("Keep the built-in browser unavailable to this bot.")
    }

    // MARK: More options

    /// `AdvancedFold`: a card row with its chevron, the folded sections below.
    private var moreOptions: some View {
        VStack(alignment: .leading, spacing: 20) {
            Button { moreOpen.toggle() } label: {
                HStack(spacing: 12) {
                    Text(verbatim: L("More options")).font(theme.font(13)).foregroundStyle(theme.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    FolderIconView(paths: FolderIcon.chevronDown, size: 14)
                        .foregroundStyle(theme.inkSecondary)
                        .rotationEffect(.degrees(moreOpen ? 180 : 0))
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .frame(minHeight: 40)
                .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .desktopHairlineBox(radius: 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(Text(moreOpen ? "On" : "Off"))
            .accessibilityIdentifier("persona-access.more")
            if moreOpen {
                folderSection
                webhooksSection
                alwaysSection
            }
        }
    }

    private var folderSection: some View {
        FolderPaneSection(title: L("Working folder"), help: L("Where this bot runs its shell and file tools."), identifier: "persona-access.folder") {
            HStack(spacing: 8) {
                PanelTextField(placeholder: LocalizedStringKey(L("Private bot folder, or an absolute path")), text: $folder, mono: true)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .disabled(!edits("cwd"))
                    .accessibilityIdentifier("persona-access.folder-field")
                FolderPill(title: L("Save"), identifier: "persona-access.folder-save") {
                    Task {
                        saving = true
                        _ = await sendPanelPatch(BotPanelPatch(cwd: folder.trimmingCharacters(in: .whitespacesAndNewlines)), bot: bot, session: session)
                        saving = false
                    }
                }
                .disabled(!edits("cwd") || saving || folder == (bot.cwd ?? ""))
            }
        }
    }

    private var webhooksSection: some View {
        FolderPaneSection(title: L("Webhooks"), help: L("A routine’s webhook is managed in that routine; a webhook of its own, in Automations."),
                          identifier: "persona-access.webhooks") {
            if let webhooks, !webhooks.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(webhooks.enumerated()), id: \.element.id) { index, webhook in
                        HStack(spacing: 8) {
                            Text(verbatim: webhook.name).font(theme.font(13)).foregroundStyle(theme.ink).lineLimit(1)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            let status = RoutineWebhook.status(webhook)
                            HStack(spacing: 6) {
                                Circle().fill(status != .paused ? theme.success : theme.inkTertiary).frame(width: 6, height: 6)
                                Text(verbatim: RoutineWebhookPanel.statusLabel(status))
                            }
                            .font(theme.font(11.5))
                            .foregroundStyle(status != .paused ? theme.success : theme.inkSecondary)
                            Text(verbatim: LF("%@ deliveries", "\(webhook.deliveryCount)")).font(theme.font(11.5)).foregroundStyle(theme.inkSecondary)
                            Button { Task { await openWebhook(webhook) } } label: {
                                HStack(spacing: 4) {
                                    Text(verbatim: webhook.routineId != nil ? L("Open the routine") : L("Open in Automations"))
                                    FolderIconView(paths: FolderIcon.externalLink, size: 12)
                                }
                                .font(theme.font(11.5, .medium))
                                .foregroundStyle(theme.accentText)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        if index < webhooks.count - 1 { Rectangle().fill(theme.hairline40).frame(height: 1) }
                    }
                }
                .padding(.horizontal, -14)
                .padding(.vertical, -4)
            } else {
                DesktopText(verbatim: L("No webhooks for this bot."), size: 12.5, line: 18.75, color: \.inkSecondary)
            }
        }
    }

    private func openWebhook(_ webhook: WebhookListing) async {
        guard let routineId = webhook.routineId else {
            model.personaOpen = false
            model.show(.automations)
            return
        }
        openRoutine = await session.loadRoutines().routines.first { $0.id == routineId }
    }

    private var alwaysSection: some View {
        let always = bot.alwaysAllow ?? []
        return FolderPaneSection(title: L("Always allowed"), help: L("Tools this bot no longer asks about."), identifier: "persona-access.always") {
            if always.isEmpty {
                DesktopText(verbatim: L("Nothing allowed yet."), size: 12.5, line: 18.75, color: \.inkSecondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(always.enumerated()), id: \.element) { index, entry in
                        HStack(spacing: 12) {
                            Text(verbatim: entry).font(Theme.mono(12.5)).foregroundStyle(theme.ink).lineLimit(1)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            FolderPill(title: L("Remove")) { access(BotAccessPatch(alwaysAllow: always.filter { $0 != entry })) }
                                .disabled(!edits("alwaysAllow") || saving)
                                .accessibilityLabel(Text(verbatim: LF("Remove %@ from always allowed", entry)))
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .frame(minHeight: 44)
                        if index < always.count - 1 { Rectangle().fill(theme.hairline40).frame(height: 1) }
                    }
                }
                .padding(.horizontal, -14)
                .padding(.vertical, -4)
            }
        }
    }

    // MARK: Writes

    private func loadServers() async {
        guard let client = session.profileClient else { return }
        do {
            servers = try await client.mcpServers().servers
            serversFailed = false
        } catch {
            serversFailed = true
        }
    }

    private func access(_ patch: BotAccessPatch) {
        guard canEdit, let client = session.profileClient else { return }
        saving = true
        Task {
            defer { saving = false }
            do { session.applyProfileBot(try await client.patchBotAccess(botId: bot.id, patch: patch)) }
            catch { session.actionError = error.localizedDescription }
        }
    }

    /// `mcpServers: null`: back to every enabled server.
    private func clearMcp() {
        guard let client = session.profileClient else { return }
        saving = true
        Task {
            defer { saving = false }
            do { session.applyProfileBot(try await client.clearBotMcpServers(botId: bot.id)) }
            catch { session.actionError = error.localizedDescription }
        }
    }
}
