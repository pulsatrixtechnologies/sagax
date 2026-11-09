// The bot panel's Library tab on the iPhone, as the desktop draws it
// (`bot-settings/LibraryTab.tsx`): the conversation's files
// (GET /api/threads/:id/files) and the bot's artifacts
// (GET /api/bots/:id/artifacts) in one list, no search, no filter. What the
// person pinned sits on top under "Pinned"; the rest is grouped "This week"
// and "Older", each group in a card, one line per item: the icon and the
// name, with the pin and a menu. A file opens in Quick Look and an artifact
// in the widget sandbox. The bot's pages (2026-10-28) are in the same list
// with their icon; a page opens whole, and its menu has Open, Share…,
// Pin/Unpin and Delete… (asked first). A pin is kept on the server. The bot's links
// (GET /api/bots/:id/links) stay one more chip, Links, when there are some.
// It draws inside the panel's scroll view.
import CompanionCore
import SwiftUI
import UIKit

struct ThreadFilesView: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    /// Show the file's message in the chat; the host closes what covers it.
    let onShowInChat: (ThreadFile) -> Void
    /// Show a link's message in its conversation (Go to message).
    var onShowLink: ((BotLink) -> Void)? = nil

    @EnvironmentObject private var session: Session
    @StateObject private var library = BotLibraryModel()
    @State private var showingLinks = false
    @StateObject private var links = LibraryLoader<BotLink>()
    @State private var previewing: IdentifiedURL?
    /// Older shows five rows until "Show more".
    @State private var olderExpanded = false
    @State private var sharing: IdentifiedURL?
    @State private var opened: BotArtifact?
    @State private var openedPage: PublishedPageSummary?
    @State private var sharingPage: PublishedPageSummary?
    @State private var deletingPage: PublishedPageSummary?
    @State private var pagesPolicy = PagesPolicy.default
    @State private var working: String?
    @State private var status: String?

    init(bot: Bot, start: BotLibraryChip = .files(.all), onShowInChat: @escaping (ThreadFile) -> Void, onShowLink: ((BotLink) -> Void)? = nil) {
        self.bot = bot
        self.onShowInChat = onShowInChat
        self.onShowLink = onShowLink
        _showingLinks = State(initialValue: start == .links)
    }

    private var threadId: String { bot.threadId }
    private var linkCount: Int { links.page?.total ?? links.page?.items.count ?? 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if linkCount > 0 { AnyView(chips) }
            if showingLinks {
                AnyView(LinksTab(bot: bot, loader: links, onShowMessage: onShowLink))
            } else {
                AnyView(content)
            }
        }
        .overlay(alignment: .top) {
            // "Path copied", as the panel's own Copied toast
            if let status {
                Text(verbatim: status)
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.textPrimary)
                    .padding(.horizontal, 18)
                    .frame(height: 40)
                    .themeGlass(Capsule(), interactive: false)
                    .transition(.opacity)
                    .accessibilityIdentifier("thread-files-status")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("thread-files")
        .task(id: threadId) {
            await load()
            guard let client = session.profileClient else { return }
            let botId = bot.id
            links.loadFirst { cursor, limit in try await client.botLinks(botId: botId, cursor: cursor, limit: limit) }
        }
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
    }

    // MARK: Chips

    /// Files and Links, only when the bot has links to switch to.
    private var chips: some View {
        HStack(spacing: 6) {
            chip(String(localized: "Files"), count: (library.files?.count ?? 0) + library.artifacts.count, on: !showingLinks, id: "files") { showingLinks = false }
            chip(String(localized: "Links"), count: linkCount, on: showingLinks, id: "links") { showingLinks = true }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Theme.Profile.cardMargin)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Library views"))
    }

    private func chip(_ title: String, count: Int, on selected: Bool, id: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            HStack(spacing: 5) {
                Text(verbatim: title)
                Text(verbatim: "\(count)")
                    .monospacedDigit()
                    .foregroundStyle(selected ? Theme.bg.opacity(0.7) : Theme.textTertiary)
            }
            .font(Theme.Profile.labelFont)
            .foregroundStyle(selected ? Theme.bg : Theme.textSecondary)
            .padding(.horizontal, 10)
            .frame(height: 28)
            .background(selected ? Theme.textPrimary : Theme.card, in: Capsule())
            .overlay(Capsule().strokeBorder(selected ? Color.clear : Theme.hairline))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("thread-files-chip.\(id)")
    }

    // MARK: List

    @ViewBuilder private var content: some View {
        let groups = library.groups()
        if library.files == nil, !library.failed {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Loading files…")
            }
            .font(Theme.Font.body)
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 40)
        } else if library.files == nil {
            VStack(spacing: 10) {
                Text("Couldn't load this chat's files.")
                Button(String(localized: "Retry")) { Task { await load() } }
            }
            .font(Theme.Font.body)
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 40)
        } else if groups.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "folder")
                Text("Files and artifacts from this chat show up here.").multilineTextAlignment(.center)
            }
            .font(Theme.Font.body)
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 30)
            .padding(.vertical, 40)
            .accessibilityIdentifier("thread-files-empty")
        } else {
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
                ProfileSectionLabel(text: title)
                ProfileCard {
                    ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                        if index > 0 { ProfileDivider() }
                        row(entry)
                    }
                }
                if more {
                    Button {
                        Haptics.selection()
                        olderExpanded = true
                    } label: {
                        Text("Show more")
                            .font(Theme.Profile.labelFont)
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.horizontal, 4)
                            .frame(minHeight: 32)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("library-show-more")
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("library-group.\(id)")
        }
    }

    /// The item (open) beside its pin and its menu: three separate buttons.
    private func row(_ entry: LibraryEntry) -> some View {
        let name = Self.name(entry)
        let available = Self.available(entry)
        return HStack(spacing: 0) {
            Button { open(entry) } label: {
                HStack(spacing: 10) {
                    LibraryEntryGlyph(threadId: threadId, entry: entry, size: 28)
                        .frame(width: Theme.Profile.iconColumn, alignment: .center)
                    Text(verbatim: name)
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if case let .artifact(artifact) = entry, artifact.needsAttention {
                        Circle().fill(Theme.warning).frame(width: 7, height: 7).accessibilityHidden(true)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!available)
            .contextMenu { actions(entry) }
            .accessibilityIdentifier(Self.identifier(entry))
            Button {
                Haptics.selection()
                Task { await pin(entry, !entry.pinned) }
            } label: {
                Image(systemName: entry.pinned ? "pin.fill" : "pin")
                    .font(.system(size: 14))
                    .foregroundStyle(entry.pinned ? Theme.accent : Theme.textSecondary)
                    .frame(width: 40, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(entry.pinned ? "Unpin" : "Pin"))
            .accessibilityIdentifier("library-pin.\(name)")
            if case let .file(file) = entry, working == file.id {
                ProgressView().controlSize(.small).frame(width: 44, height: 44)
            } else {
                Menu { actions(entry) } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel(Text("More"))
                .accessibilityIdentifier("library-actions.\(name)")
            }
        }
        .frame(minHeight: Theme.Profile.fileRow)
        .padding(.leading, 4)
        .opacity(available ? 1 : 0.6)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private func actions(_ entry: LibraryEntry) -> some View {
        Button(entry.pinned ? String(localized: "Unpin") : String(localized: "Pin"), systemImage: entry.pinned ? "pin.slash" : "pin") {
            Task { await pin(entry, !entry.pinned) }
        }
        switch entry {
        case let .file(file):
            Button(String(localized: "Show in chat"), systemImage: "bubble.left") { onShowInChat(file) }
                .accessibilityIdentifier("thread-file-show")
            Button(String(localized: "Download"), systemImage: "arrow.down.circle") { Task { await fetch(file, share: true) } }
                .disabled(!file.available)
            if let path = ThreadFileRules.copyablePath(of: file) {
                Button(String(localized: "Copy path"), systemImage: "doc.on.doc") { copy(path) }
                    .accessibilityIdentifier("thread-file-copy-path")
            }
        case let .artifact(artifact):
            Button(String(localized: "Open"), systemImage: "macwindow") { opened = artifact }
        case let .page(page):
            Button(String(localized: "Open"), systemImage: "doc.richtext") { openedPage = page }
                .accessibilityIdentifier("library-page-open")
            Button(String(localized: "Share…"), systemImage: "square.and.arrow.up") { sharingPage = page }
                .accessibilityIdentifier("library-page-share")
            Button(String(localized: "Delete…"), systemImage: "trash", role: .destructive) { deletingPage = page }
                .accessibilityIdentifier("library-page-delete")
        }
    }

    static func name(_ entry: LibraryEntry) -> String {
        switch entry {
        case let .file(file): file.name
        case let .artifact(artifact): artifact.title
        case let .page(page): page.title.isEmpty ? String(localized: "Untitled page") : page.title
        }
    }

    static func available(_ entry: LibraryEntry) -> Bool {
        if case let .file(file) = entry { return file.available }
        return true
    }

    static func symbol(_ entry: LibraryEntry) -> String {
        switch entry {
        case let .file(file): ThreadFileThumbnail.symbol(ThreadFileRules.kind(of: file))
        case .artifact: "macwindow"
        case .page: "chart.bar.doc.horizontal"
        }
    }

    static func identifier(_ entry: LibraryEntry) -> String {
        switch entry {
        case let .file(file): "thread-file.\(file.name)"
        case let .artifact(artifact): "library-artifact.\(artifact.id)"
        case let .page(page): "library-page.\(page.id)"
        }
    }

    // MARK: Actions

    private func load() async {
        guard let client = session.profileClient else { return }
        await library.load(client: client, threadId: threadId, botId: bot.id, withArtifacts: session.surfaceGate.allows(.botArtifacts))
        pagesPolicy = await client.pagesPolicy()
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

    private func pin(_ entry: LibraryEntry, _ pinned: Bool) async {
        guard let client = session.profileClient else { return }
        do {
            try await library.setPinned(entry, pinned, client: client, threadId: threadId)
        } catch {
            session.actionError = error.localizedDescription
        }
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
        // the pasteboard can stall the main thread (a simulator syncing it
        // with its Mac): write it off the main thread, after the feedback
        Task.detached(priority: .userInitiated) { UIPasteboard.general.string = path }
        Task {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            withAnimation { status = nil }
        }
    }

    // MARK: Words

    private func meta(_ file: ThreadFile) -> String {
        let when = Date(timeIntervalSince1970: file.at / 1000).formatted(date: .abbreviated, time: .shortened)
        guard file.available else { return "\(String(localized: "Not on this computer")) · \(when)" }
        return [Self.sourceName(file.source), file.size.map(Self.size), when].compactMap { $0 }.joined(separator: " · ")
    }

    static func size(_ bytes: Int) -> String { ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file) }

    static func sourceName(_ source: ThreadFile.Source) -> String {
        switch source {
        case .upload: String(localized: "You sent")
        case .attachment: String(localized: "Bot attached")
        case .link: String(localized: "Bot linked")
        case .written, .unknown: String(localized: "Bot wrote")
        }
    }

    static func filterName(_ filter: ThreadFileFilter) -> String {
        switch filter {
        case .all: String(localized: "All")
        case .image: String(localized: "Images")
        case .video: String(localized: "Videos")
        case .audio: String(localized: "Audio")
        case .document: String(localized: "Documents")
        case .code: String(localized: "Code")
        case .other: String(localized: "Other")
        }
    }

    static func originName(_ origin: ThreadFileOrigin) -> String {
        switch origin {
        case .all: String(localized: "Everyone")
        case .bot: String(localized: "From the bot")
        case .you: String(localized: "From you")
        }
    }

    static func sortName(_ sort: ThreadFileSort) -> String {
        switch sort {
        case .newest: String(localized: "Newest")
        case .name: String(localized: "Name")
        case .size: String(localized: "Size")
        }
    }
}

/// An image file's thumbnail (`preview=1`), or its kind's symbol.
struct ThreadFileThumbnail: View {
    @Environment(\.themePalette) var themePalette
    let threadId: String
    let file: ThreadFile
    /// Fixed side; nil fills the space it is given.
    let size: CGFloat?

    @EnvironmentObject private var session: Session
    @State private var image: UIImage?

    private var kind: ThreadFileKind { ThreadFileRules.kind(of: file) }

    var body: some View {
        ZStack {
            Theme.inset
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Image(systemName: Self.symbol(kind))
                    .font(.system(size: size.map { $0 * 0.5 } ?? 24))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
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
