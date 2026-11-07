// iPad: the group panel's Library tab (desktop `GroupLibraryTab` in
// bot-settings/LibraryTab.tsx): the group conversation's files
// (GET /api/threads/:id/files) and the pages made in one of the group's
// conversations (`groupThreadIds`), in the bot Library's list: Pinned, Today,
// This week, Older, one rounded card per group. A row opens the file (Quick
// Look) or the page; a long press offers Pin, Show in chat, Download, Copy
// path, or Share and Delete for a page. The data is `BotLibraryModel`, the
// bot Library's own, so a pin is kept on the server the same way.
// The desktop also lists the artifacts made in the group's conversations:
// the iPad artifact list carries no conversation id yet, so they are not
// listed here (no artifact of another conversation shows by mistake).
import SwiftUI
import UIKit
import CompanionCore

struct GroupPanelLibrary: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let room: Room
    /// Below 1024 the panel covers the chat: a jump closes it.
    let docked: Bool

    @StateObject private var library = BotLibraryModel()
    @State private var openedPage: PublishedPageSummary?
    @State private var sharingPage: PublishedPageSummary?
    @State private var deletingPage: PublishedPageSummary?
    @State private var pagesPolicy = PagesPolicy.default
    @State private var previewing: IdentifiedURL?
    @State private var olderExpanded = false
    @State private var sharing: IdentifiedURL?
    @State private var opened: BotArtifact?
    @State private var working: String?
    @State private var status: String?
    @State private var hoveredRow: String?

    private var threadId: String { room.threadId }

    /// `groupThreadIds`: the group conversation and its tasks' conversations.
    static func threads(of room: Room) -> Set<String> {
        var ids: Set<String> = []
        if !room.threadId.isEmpty { ids.insert(room.threadId) }
        for task in room.tasks ?? [] where !task.threadId.isEmpty { ids.insert(task.threadId) }
        return ids
    }

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
        .task(id: Self.threads(of: room).sorted().joined(separator: ",")) { await load() }
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
        .accessibilityIdentifier("group-panel.library")
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
            .accessibilityIdentifier("group-panel.library-failed")
        } else if library.groups().isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "folder")
                    .font(.system(size: 18))
                Text("Files and pages from this group show up here.")
                    .font(theme.font(13))
                    .multilineTextAlignment(.center)
            }
            .foregroundStyle(theme.inkSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 48)
            .padding(.horizontal, 24)
            .accessibilityIdentifier("group-panel.library-empty")
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
                    .accessibilityIdentifier("group-panel.library-show-more")
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("group-panel.library-group.\(id)")
        }
    }

    /// A page lives in its own conversation: its glyph reads from there.
    private func entryThread(_ entry: LibraryEntry) -> String {
        if case let .page(page) = entry, !page.threadId.isEmpty { return page.threadId }
        return threadId
    }

    private func row(_ entry: LibraryEntry) -> some View {
        let name = ThreadFilesView.name(entry)
        let available = ThreadFilesView.available(entry)
        return HStack(spacing: 6) {
            Button { open(entry) } label: {
                HStack(spacing: 8) {
                    LibraryEntryGlyph(threadId: entryThread(entry), entry: entry, size: 24, secondary: theme.inkSecondary)
                    Text(verbatim: name)
                        .font(theme.font(13))
                        .foregroundStyle(theme.ink)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .contentShape(Rectangle())
                .opacity(available ? 1 : 0.6)
            }
            .buttonStyle(.plain)
            .disabled(!available)
            .accessibilityLabel(Text("Open \(name)"))
            .accessibilityIdentifier("group-panel.file.\(name)")
            if hoveredRow == entry.id { actions(entry) }
            Menu { menuItems(entry) } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.inkTertiary)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("More actions"))
            .accessibilityIdentifier("group-panel.file-menu.\(name)")
        }
        .frame(minHeight: 40)
        .padding(.horizontal, 8)
        .contentShape(Rectangle())
        .onHover { inside in hoveredRow = inside ? entry.id : (hoveredRow == entry.id ? nil : hoveredRow) }
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
            if case let .file(file) = entry {
                actionButton("bubble.left", label: "Show in chat") { jump(file) }
                if working == file.id {
                    ProgressView().controlSize(.mini).frame(width: 28, height: 28)
                } else {
                    actionButton("arrow.down.to.line", label: "Download", disabled: !file.available) {
                        Task { await fetch(file, share: true) }
                    }
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

    /// The group conversation's files, then the pages of every group
    /// conversation (the bot filter of the model is replaced by the threads).
    private func load() async {
        guard let client = session.profileClient else { library.failed = true; return }
        await library.load(client: client, threadId: threadId, botId: "", withArtifacts: false)
        let threads = Self.threads(of: room)
        if let all = try? await client.publishedPages() {
            library.pages = all
                .filter { threads.contains($0.threadId) }
                .sorted { $0.updatedAt != $1.updatedAt ? $0.updatedAt > $1.updatedAt : $0.id < $1.id }
        }
        pagesPolicy = await client.pagesPolicy()
    }

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
}
