// iPad I4/I4b: the bot panel's Library tab (was Files; `bot-settings/FilesSection.tsx`):
// the open conversation's files from GET /api/threads/:id/files, with the
// search field and the grid / list switch (y 347), the kind chips with
// their counts (12/16, radius full; the chosen one `bg-ink text-app`), who
// sent it and the sort (two `select`s, 33 tall), then the list: a 40 pt
// thumbnail, the name 13 and "Bot attached · 14 B · Sep 30, 2026, 11:33 AM"
// 11, and three 28 pt actions (show in chat, download, copy path). The
// filtering and counting are `ThreadFileRules` (CompanionCore), shared with
// the phone's ThreadFilesView. The bot's links are one more chip, Links,
// drawn by the phone's LinksTab (JC 2026-10-18).
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

    @State private var files: [ThreadFile]?
    @State private var failed = false
    @State private var query = ThreadFileQuery()
    @AppStorage("omb-files-view") private var pickedView = ""
    @State private var previewing: IdentifiedURL?
    @State private var sharing: IdentifiedURL?
    @State private var working: String?
    @State private var status: String?
    /// The bot's links, one more chip (`BotLibraryChip.links`), as on the phone.
    @State private var showingLinks = false
    @StateObject private var links = LibraryLoader<BotLink>()

    private var threadId: String { bot.threadId }
    private var all: [ThreadFile] { files ?? [] }
    private var counts: [ThreadFileFilter: Int] { ThreadFileRules.counts(all, origin: query.origin, search: query.search) }
    /// Only kinds that have files (or the chosen one), and only with two
    /// kinds or more to choose between (`visibleFilters`, FilesSection.tsx).
    private var chips: [ThreadFileFilter] { ThreadFileRules.visibleFilters(counts: counts, selected: query.filter) }
    private var linkCount: Int { links.page?.total ?? links.page?.items.count ?? 0 }
    private var selectedChip: BotLibraryChip { showingLinks ? .links : .files(query.filter) }
    private var allChips: [BotLibraryChip] { BotLibraryChip.visible(counts: counts, selected: selectedChip, links: linkCount) }
    private var shown: [ThreadFile] {
        var effective = query
        if chips.isEmpty { effective.filter = .all }
        return ThreadFileRules.visible(all, query: effective)
    }
    private var grid: Bool {
        if pickedView == "grid" { return true }
        if pickedView == "list" { return false }
        return query.filter == .image || query.filter == .video
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            AnyView(searchRow)
            if !allChips.isEmpty { AnyView(chipRow) }
            if !showingLinks { AnyView(selects) }
            if let status {
                Label(status, systemImage: "checkmark")
                    .font(theme.font(12))
                    .foregroundStyle(theme.success)
            }
            if showingLinks {
                AnyView(LinksTab(bot: bot, loader: links, onShowMessage: { link in jump(link) }).padding(.horizontal, -Theme.Profile.cardMargin))
            } else {
                AnyView(content)
            }
        }
        .padding(.top, 8)
        .padding(.leading, 17)
        .padding(.trailing, 16)
        .padding(.bottom, 24)
        .task(id: threadId) {
            await load()
            guard let client = session.profileClient else { return }
            let botId = bot.id
            links.loadFirst { cursor, limit in try await client.botLinks(botId: botId, cursor: cursor, limit: limit) }
        }
        .sheet(item: $previewing) { item in ProfileQuickLook(url: item.url).ignoresSafeArea() }
        .sheet(item: $sharing) { item in ProfileShareSheet(items: [item.url]) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-panel-files")
    }

    // MARK: Controls

    private var searchRow: some View {
        HStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 13))
                    .foregroundStyle(theme.inkSecondary)
                TextField("", text: $query.search, prompt: Text("Search files").foregroundColor(theme.inkSecondary))
                    .font(theme.font(13))
                    .foregroundStyle(theme.ink)
                    .tint(theme.focus)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            .padding(.horizontal, 10)
            .frame(height: 34)
            .background(theme.elevated, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
            HStack(spacing: 0) {
                viewButton("square.grid.2x2", on: grid, label: "Grid view") { pickedView = "grid" }
                viewButton("list.bullet", on: !grid, label: "List view") { pickedView = "list" }
            }
            .padding(2)
            .frame(height: 34)
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
        }
    }

    private func viewButton(_ symbol: String, on: Bool, label: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 12.5))
                .foregroundStyle(on ? theme.ink : theme.inkSecondary)
                .frame(width: 28, height: 28)
                .background(on ? theme.elevatedHover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private var chipRow: some View {
        PanelFlow(spacing: 6, lineSpacing: 6) {
            ForEach(allChips, id: \.self) { chip in
                let selected = selectedChip == chip
                Button {
                    switch chip {
                    case let .files(filter):
                        showingLinks = false
                        query.filter = filter
                    case .links:
                        showingLinks = true
                    }
                } label: {
                    HStack(spacing: 6) {
                        Text(verbatim: chipName(chip))
                            .foregroundStyle(selected ? theme.app : theme.inkSecondary)
                        Text(verbatim: "\(chipCount(chip))")
                            .monospacedDigit()
                            .foregroundStyle(selected ? theme.app.opacity(0.7) : theme.inkTertiary)
                    }
                    .font(theme.font(12))
                    .padding(.horizontal, 11) // px-2.5 inside a 1 pt border
                    .frame(height: 26)
                    .background(selected ? theme.ink : .clear, in: Capsule())
                    .overlay(Capsule().strokeBorder(selected ? .clear : theme.hairlineWeak, lineWidth: 1))
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier("desktop-files-chip.\(chipId(chip))")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Filter files by type"))
    }

    private func chipName(_ chip: BotLibraryChip) -> String {
        switch chip {
        case let .files(filter): ThreadFilesView.filterName(filter)
        case .links: String(localized: "Links")
        }
    }

    private func chipCount(_ chip: BotLibraryChip) -> Int {
        switch chip {
        case let .files(filter): counts[filter] ?? 0
        case .links: linkCount
        }
    }

    private func chipId(_ chip: BotLibraryChip) -> String {
        switch chip {
        case let .files(filter): filter.rawValue
        case .links: "links"
        }
    }

    private var selects: some View {
        HStack(spacing: 8) {
            Menu {
                Picker(String(localized: "Show files from"), selection: $query.origin) {
                    ForEach(ThreadFileOrigin.allCases, id: \.self) { Text(ThreadFilesView.originName($0)).tag($0) }
                }
            } label: {
                selectLabel(ThreadFilesView.originName(query.origin))
            }
            .accessibilityLabel(Text("Show files from"))
            Menu {
                Picker(String(localized: "Sort files"), selection: $query.sort) {
                    ForEach(ThreadFileSort.allCases, id: \.self) { Text(ThreadFilesView.sortName($0)).tag($0) }
                }
            } label: {
                selectLabel(ThreadFilesView.sortName(query.sort))
            }
            .accessibilityLabel(Text("Sort files"))
        }
    }

    private func selectLabel(_ text: String) -> some View {
        HStack(spacing: 4) {
            Text(verbatim: text)
                .font(theme.font(12.5))
                .foregroundStyle(theme.ink)
                .lineLimit(1)
            Spacer(minLength: 0)
            Image(systemName: "chevron.down")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(theme.ink)
        }
        .padding(.leading, 13)
        .padding(.trailing, 6)
        .frame(maxWidth: .infinity)
        .frame(height: 33)
        .background(theme.elevated, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
        .contentShape(Rectangle())
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        if files == nil && !failed {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Loading files…").font(theme.font(13)).foregroundStyle(theme.inkSecondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 40)
        } else if files == nil {
            VStack(spacing: 8) {
                Text("Couldn't load this chat's files.").font(theme.font(13)).foregroundStyle(theme.inkSecondary)
                PanelButton(title: "Retry", systemImage: "arrow.counterclockwise") { Task { await load() } }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 40)
        } else if shown.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "folder")
                    .font(.system(size: 18))
                Text(emptyText)
                    .font(theme.font(13))
                    .multilineTextAlignment(.center)
            }
            .foregroundStyle(theme.inkSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 48)
            .padding(.horizontal, 24)
        } else if grid {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 8)], spacing: 8) {
                ForEach(shown) { file in tile(file) }
            }
        } else {
            VStack(spacing: 0) {
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, file in
                    row(file)
                    if index < shown.count - 1 {
                        Rectangle().fill(theme.hairlineWeak).frame(height: 1)
                    }
                }
            }
        }
    }

    private var emptyText: String {
        let search = query.search.trimmingCharacters(in: .whitespacesAndNewlines)
        if !search.isEmpty { return String(localized: "Nothing matches “\(search)”") }
        return String(localized: "No files in this chat yet.")
    }

    private func row(_ file: ThreadFile) -> some View {
        HStack(spacing: 10) {
            Button { open(file) } label: {
                HStack(spacing: 10) {
                    PanelFileThumbnail(threadId: threadId, file: file, iconSize: 17)
                        .frame(width: 40, height: 40)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    VStack(alignment: .leading, spacing: 0) {
                        Text(verbatim: file.name)
                            .font(theme.font(13))
                            .foregroundStyle(theme.ink)
                            .lineLimit(1)
                            .frame(height: 19.5)
                        Text(verbatim: meta(file))
                            .font(theme.font(11))
                            .foregroundStyle(theme.inkSecondary)
                            .lineLimit(1)
                            .frame(height: 16.5)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .contentShape(Rectangle())
                .opacity(file.available ? 1 : 0.6)
            }
            .buttonStyle(.plain)
            .disabled(!file.available)
            .accessibilityLabel(Text("Open \(file.name)"))
            .accessibilityIdentifier("desktop-file.\(file.name)")
            actions(file)
        }
        .frame(height: 56)
    }

    private func tile(_ file: ThreadFile) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { open(file) } label: {
                PanelFileThumbnail(threadId: threadId, file: file, iconSize: 24)
                    .aspectRatio(1, contentMode: .fill)
                    .clipped()
            }
            .buttonStyle(.plain)
            .disabled(!file.available)
            VStack(alignment: .leading, spacing: 0) {
                Text(verbatim: file.name).font(theme.font(12)).foregroundStyle(theme.ink).lineLimit(1)
                Text(verbatim: file.available ? (file.size.map(DesktopFileSize.format) ?? ThreadFilesView.sourceName(file.source)) : String(localized: "Not on this computer"))
                    .font(theme.font(10.5))
                    .foregroundStyle(theme.inkSecondary)
                    .lineLimit(1)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
        }
        .overlay(alignment: .topTrailing) {
            actions(file)
                .background(theme.panel.opacity(0.9), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .padding(4)
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
        .opacity(file.available ? 1 : 0.6)
    }

    private func actions(_ file: ThreadFile) -> some View {
        HStack(spacing: 2) {
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

    private func actionButton(_ symbol: String, label: LocalizedStringKey, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 13))
                .foregroundStyle(theme.inkSecondary)
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
        guard let client = session.profileClient else { failed = true; return }
        do {
            files = try await client.threadFiles(threadId: threadId)
            failed = false
        } catch {
            failed = true
        }
    }

    private func jump(_ file: ThreadFile) {
        if !docked { model.togglePanel() }
        Task { await session.jump(to: file.messageId, inThread: threadId) }
    }

    /// Go to message on a link: the chat beside the panel switches to the
    /// link's conversation in place when it is another one.
    private func jump(_ link: BotLink) {
        guard let messageId = link.messageId else { return }
        let target = link.threadId ?? threadId
        let botId = bot.id
        if !docked { model.togglePanel() }
        Task { await session.showLinkMessage(messageId, botId: botId, threadId: target) }
    }

    private func open(_ file: ThreadFile) {
        guard file.available else { return }
        Task { await fetch(file, share: false) }
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

    private func meta(_ file: ThreadFile) -> String {
        let when = Self.when(file.at)
        guard file.available else { return "\(String(localized: "Not on this computer")) · \(when)" }
        return [ThreadFilesView.sourceName(file.source), file.size.map(DesktopFileSize.format), when]
            .compactMap { $0 }
            .joined(separator: " · ")
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
                image = UIImage(data: data)
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
