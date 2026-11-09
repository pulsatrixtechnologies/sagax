// iPad: the bot panel's Library tab (`bot-settings/LibraryTab.tsx`): the open
// conversation's files from GET /api/threads/:id/files in one list, no search,
// no filter, no grid. What the person pinned sits on top under "Pinned"; the
// rest is grouped "This week" and "Older", each group in a rounded card, one
// line per file: the kind's icon and the name, with the pin and the actions
// (show in chat, download, copy path). The bot's artifacts are in the same
// list and open in the widget sandbox. The grouping is `LibraryRules`
// (CompanionCore); a pin is kept on the server (`setThreadFilePin`, the
// artifact's favorite flag) so it is the same on the desktop. No chips
// above the list: the owner kept a Links chip on 2026-10-18 while the
// desktop had one; the desktop's Library dropped it (LibraryTab.tsx, the
// list alone), so the iPad follows (sweep 2026-11-03). The bot's links stay
// on the phone's profile (LinksTab).
import SwiftUI
import UIKit
import CompanionCore

struct BotPanelFiles: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot
    /// Below 1024 the panel covers the chat: a jump closes it
    /// (`max-width: 1023px` in FilesSection.tsx).
    let docked: Bool

    @StateObject private var library = BotLibraryModel()
    @State private var opened: BotArtifact?
    /// A page of this bot (2026-10-28): open, Share, Delete (asked first).
    @State private var openedPage: PublishedPageSummary?
    @State private var sharingPage: PublishedPageSummary?
    @State private var deletingPage: PublishedPageSummary?
    @State private var pagesPolicy = PagesPolicy.default
    @State private var previewing: IdentifiedURL?
    /// Older shows five rows until "Show more".
    @State private var olderExpanded = false
    @State private var sharing: IdentifiedURL?
    @State private var working: String?
    @State private var status: String?
    /// The row under the pointer (its actions show).
    @State private var hoveredRow: String?

    private var threadId: String { bot.threadId }
    private var all: [ThreadFile] { library.files ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let status {
                Label(status, systemImage: "checkmark")
                    .font(theme.font(12))
                    .foregroundStyle(theme.success)
            }
            AnyView(content)
        }
        .padding(.top, 8)
        .padding(.leading, 17)
        .padding(.trailing, 16)
        .padding(.bottom, 24)
        .task(id: threadId) { await load() }
        .sheet(item: $previewing) { item in ProfileQuickLook(url: item.url).ignoresSafeArea() }
        .sheet(item: $sharing) { item in ProfileShareSheet(items: [item.url]) }
        .sheet(item: $opened) { artifact in BotArtifactSheet(artifact: artifact) }
        .fullScreenCover(item: $openedPage) { page in
            PageFullScreen(pageId: page.id, title: page.title) { library.replace($0) }
                .environmentObject(session)
        }
        .sheet(item: $sharingPage) { page in
            if let version = PageViewRules.versionToShow(page: page, asked: nil) {
                PageShareSheet(page: page, version: version, policy: pagesPolicy) { library.replace($0) }
                    .environmentObject(session)
            }
        }
        .confirmationDialog(
            String(localized: "Delete this page and all its versions?"),
            isPresented: Binding(get: { deletingPage != nil }, set: { if !$0 { deletingPage = nil } }),
            titleVisibility: .visible
        ) {
            Button(String(localized: "Delete"), role: .destructive) {
                if let page = deletingPage { Task { await deletePage(page) } }
            }
            Button(String(localized: "Cancel"), role: .cancel) {}
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-panel-files")
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        if library.files == nil && !library.failed {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Loading files…").font(theme.font(13)).foregroundStyle(theme.inkSecondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 40)
        } else if library.files == nil {
            VStack(spacing: 8) {
                Text("Couldn't load this chat's files.").font(theme.font(13)).foregroundStyle(theme.inkSecondary)
                PanelButton(title: "Retry", systemImage: "arrow.counterclockwise") { Task { await load() } }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 40)
        } else if library.groups().isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "folder")
                    .font(.system(size: 18))
                Text("Files and artifacts from this chat show up here.")
                    .font(theme.font(13))
                    .multilineTextAlignment(.center)
            }
            .foregroundStyle(theme.inkSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 48)
            .padding(.horizontal, 24)
        } else {
            let groups = library.groups()
            VStack(alignment: .leading, spacing: 16) {
                group("pinned", title: "Pinned", entries: groups.pinned)
                group("today", title: "Today", entries: groups.today)
                group("this-week", title: "This week", entries: groups.thisWeek)
                group("older", title: "Older", entries: LibraryOlder.shown(groups.older, expanded: olderExpanded),
                      more: LibraryOlder.hidesRows(groups.older, expanded: olderExpanded))
            }
        }
    }

    /// One titled card; nothing when the group is empty.
    @ViewBuilder
    private func group(_ id: String, title: LocalizedStringKey, entries: [LibraryEntry], more: Bool = false) -> some View {
        if !entries.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(theme.font(12, .medium))
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 2)
                VStack(spacing: 0) {
                    ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                        row(entry)
                        if index < entries.count - 1 {
                            Rectangle().fill(theme.hairlineWeak).frame(height: 1)
                        }
                    }
                }
                .padding(.horizontal, 10)
                .background(theme.elevated, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
                if more {
                    Button { olderExpanded = true } label: {
                        Text("Show more")
                            .font(theme.font(12))
                            .foregroundStyle(theme.inkSecondary)
                            .padding(.horizontal, 2)
                            .frame(minHeight: 28)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("desktop-library-show-more")
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("desktop-library-group.\(id)")
        }
    }

    private func row(_ entry: LibraryEntry) -> some View {
        let name = ThreadFilesView.name(entry)
        let available = ThreadFilesView.available(entry)
        return HStack(spacing: 6) {
            Button { open(entry) } label: {
                HStack(spacing: 8) {
                    LibraryEntryGlyph(threadId: threadId, entry: entry, size: 24, secondary: theme.inkSecondary)
                    Text(verbatim: name)
                        .font(theme.font(13))
                        .foregroundStyle(theme.ink)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if case let .artifact(artifact) = entry, artifact.needsAttention {
                        Circle().fill(Theme.warning).frame(width: 6, height: 6).accessibilityHidden(true)
                    }
                }
                .contentShape(Rectangle())
                .opacity(available ? 1 : 0.6)
            }
            .buttonStyle(.plain)
            .disabled(!available)
            .accessibilityLabel(Text("Open \(name)"))
            .accessibilityIdentifier("desktop-file.\(name)")
            // the desktop shows a row's actions on hover; a finger reaches
            // them by a long press (the same items)
            if hoveredRow == ThreadFilesView.name(entry) { actions(entry) }
        }
        .frame(minHeight: 40)
        .padding(.horizontal, 8)
        .contentShape(Rectangle())
        .onHover { inside in hoveredRow = inside ? ThreadFilesView.name(entry) : (hoveredRow == ThreadFilesView.name(entry) ? nil : hoveredRow) }
        .contextMenu { menuItems(entry) }
    }

    @ViewBuilder
    private func menuItems(_ entry: LibraryEntry) -> some View {
        Button(entry.pinned ? String(localized: "Unpin") : String(localized: "Pin"), systemImage: "pin") { Task { await setPinned(entry, !entry.pinned) } }
        if case let .page(page) = entry {
            Button(String(localized: "Share…"), systemImage: "square.and.arrow.up") { sharingPage = page }
            Button(String(localized: "Delete…"), systemImage: "trash", role: .destructive) { deletingPage = page }
        }
        if case let .file(file) = entry {
            Button(String(localized: "Show in chat"), systemImage: "bubble.left") { jump(file) }
            if file.available {
                Button(String(localized: "Download"), systemImage: "arrow.down.to.line") { Task { await fetch(file, share: true) } }
                if let path = ThreadFileRules.copyablePath(of: file) {
                    Button(String(localized: "Copy path"), systemImage: "square.on.square") { copy(path) }
                }
            }
        }
    }

    private func actions(_ entry: LibraryEntry) -> some View {
        HStack(spacing: 2) {
            actionButton(entry.pinned ? "pin.fill" : "pin", label: entry.pinned ? "Unpin" : "Pin", tint: entry.pinned ? theme.accent : nil) {
                Task { await setPinned(entry, !entry.pinned) }
            }
            if case let .page(page) = entry {
                actionButton("square.and.arrow.up", label: "Share…") { sharingPage = page }
                actionButton("trash", label: "Delete…") { deletingPage = page }
            }
            if case let .file(file) = entry {
                actionButton("bubble.left", label: "Show in chat") { jump(file) }
                if working == file.id {
                    ProgressView().controlSize(.mini).frame(width: 28, height: 28)
                } else {
                    actionButton("arrow.down.to.line", label: "Download", disabled: !file.available) {
                        Task { await fetch(file, share: true) }
                    }
                }
                if file.available, let path = ThreadFileRules.copyablePath(of: file) {
                    actionButton("square.on.square", label: "Copy path") { copy(path) }
                }
            }
        }
    }

    private func actionButton(_ symbol: String, label: LocalizedStringKey, disabled: Bool = false, tint: Color? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 13))
                .foregroundStyle(tint ?? theme.inkSecondary)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
        .hoverEffect(.highlight)
        .accessibilityLabel(Text(label))
    }

    // MARK: Actions

    private func load() async {
        guard let client = session.profileClient else { library.failed = true; return }
        await library.load(client: client, threadId: threadId, botId: bot.id, withArtifacts: session.surfaceGate.allows(.botArtifacts))
        pagesPolicy = await client.pagesPolicy()
    }

    /// The pin shows at once and the server keeps it; a refusal puts it back.
    private func setPinned(_ entry: LibraryEntry, _ pinned: Bool) async {
        guard let client = session.profileClient else { return }
        do {
            try await library.setPinned(entry, pinned, client: client, threadId: threadId)
        } catch {
            session.actionError = error.localizedDescription
        }
    }

    private func deletePage(_ page: PublishedPageSummary) async {
        deletingPage = nil
        guard let client = session.profileClient else { return }
        do {
            try await library.delete(page, client: client)
        } catch {
            session.actionError = error.localizedDescription
        }
    }

    private func jump(_ file: ThreadFile) {
        if !docked { model.togglePanel() }
        Task { await session.jump(to: file.messageId, inThread: threadId) }
    }

    private func open(_ entry: LibraryEntry) {
        switch entry {
        case let .file(file):
            guard file.available else { return }
            Task { await fetch(file, share: false) }
        case let .artifact(artifact):
            opened = artifact
        case let .page(page):
            openedPage = page
        }
    }

    /// The file's bytes into a private temporary folder, then Quick Look
    /// (open) or the share sheet (download).
    private func fetch(_ file: ThreadFile, share: Bool) async {
        guard working == nil, let client = session.profileClient else { return }
        working = file.id
        defer { working = nil }
        do {
            let data = try await client.threadFileData(threadId: threadId, fileId: file.id, preview: false)
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("thread-files/\(file.id)", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let base = (file.name as NSString).lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)
            let url = folder.appendingPathComponent(base.isEmpty ? "file-\(file.id)" : base)
            try data.write(to: url, options: [.atomic, .completeFileProtection])
            if share { sharing = IdentifiedURL(url: url) } else { previewing = IdentifiedURL(url: url) }
        } catch {
            session.actionError = error.localizedDescription
        }
    }

    private func copy(_ path: String) {
        withAnimation { status = String(localized: "Path copied") }
        Task.detached(priority: .userInitiated) { UIPasteboard.general.string = path }
        Task {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            withAnimation { status = nil }
        }
    }

    /// `dateStyle: medium, timeStyle: short`, as Intl writes it
    /// ("Sep 30, 2026, 11:33 AM").
    static func when(_ at: Double) -> String {
        // Intl joins the two with a comma, where Foundation says "at"
        let date = Date(timeIntervalSince1970: at / 1000)
        return "\(date.formatted(.dateTime.month(.abbreviated).day().year())), \(date.formatted(date: .omitted, time: .shortened))"
    }
}

/// An image file's thumbnail (`preview=1`), or its kind's glyph on `inset`.
struct PanelFileThumbnail: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let threadId: String
    let file: ThreadFile
    var iconSize: CGFloat = 17

    @State private var image: UIImage?

    private var kind: ThreadFileKind { ThreadFileRules.kind(of: file) }

    var body: some View {
        ZStack {
            theme.inset
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Image(systemName: Self.symbol(kind))
                    .font(.system(size: iconSize * 0.85))
                    .foregroundStyle(theme.inkSecondary)
            }
        }
        .task(id: file.id) {
            guard kind == .image, file.available, image == nil, let client = session.profileClient else { return }
            if let data = try? await client.threadFileData(threadId: threadId, fileId: file.id, preview: true) {
                image = await ImageDecoding.prepared(data)
            }
        }
        .accessibilityHidden(true)
    }

    static func symbol(_ kind: ThreadFileKind) -> String {
        switch kind {
        case .image: "photo"
        case .video: "film"
        case .audio: "music.note"
        case .document: "doc.text"
        case .code: "chevron.left.forwardslash.chevron.right"
        case .archive: "doc.zipper"
        case .other: "doc"
        }
    }
}
