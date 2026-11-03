// iPad lot 4 (2026-11-03): Memory as the desktop's full page of the main
// column (src/components/memory-manager/MemoryManagerPanel.tsx, the
// Perspicax console's shape): the header with Notes | Map | Tags | Quality,
// "+ New note", the ⋯ menu and close; Notes puts the explorer on the left
// (Lists: All notes, Teams, Pinned, Recent, Review; Tiers: My memory with
// each bot, the team sections, the Perspicax tiers) and the list beside it,
// a note opening as a page in place of the list. Every number is one the
// server gives: each source is read the way the phone's manager reads it.
import SwiftUI
import UIKit
import CompanionCore

struct DesktopMemoryPage: View {
    enum Tab: String, CaseIterable { case notes, map, tags, quality }
    enum Place: Hashable {
        case all, teams, pinned, recent, review
        case source(String)
    }
    enum Sort: String, CaseIterable { case changed, title, manual }

    struct Entry: Identifiable, Hashable {
        var source: MemoryManagerSource
        var row: MemoryNoteRow
        var id: String { "\(source.id)|\(row.id)" }
    }

    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var shell: DesktopShellModel
    @StateObject private var model = MemoryManagerModel()
    @State private var tab: Tab = .notes
    @State private var place: Place = .all
    @State private var entries: [Entry] = []
    @State private var loading = true
    @State private var query = ""
    @State private var sort: Sort = .changed
    @State private var tagFilter: String?
    @State private var opened: Entry?
    @State private var creating: MemoryManagerSource?
    @State private var checked: Set<String> = []
    /// The right rail: nil until the page knows its width (open from 1280).
    @State private var railOpen: Bool?
    @State private var collapsed: Set<String> = []
    @State private var importing = false
    @State private var pendingDelete: DesktopMemoryFolderRequest?
    @State private var notice: String?
    enum ListView: String, CaseIterable { case active, all, archived, stale }
    @State private var listView: ListView = .active
    @AppStorage("sagax.memory.pins.v1") private var pinsRaw = ""

    private var pins: Set<String> { Set(pinsRaw.split(separator: "\n").map(String.init)) }
    private var sources: [MemoryManagerSource] { model.sources ?? [] }
    /// The tiers shown (MemoryManagerPanel.tsx): a sidebar section with no
    /// team note is no tier of its own; General always is.
    private var tierSources: [MemoryManagerSource] {
        sources.filter { source in
            !(source.kind == .team && !(source.section ?? "").isEmpty && !entries.contains { $0.source.id == source.id })
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
                #if DEBUG
                .onAppear {
                    switch ParityLaunch.current?.iPadScreen {
                    case .memoryMap?, .memoryMapRadial?, .memoryMapColumns?: tab = .map
                    case .memoryTags?: tab = .tags
                    case .memoryQuality?: tab = .quality
                    default: break
                    }
                }
                #endif
            // RightRail.tsx (2026-11-03): the explorer is the page's right
            // rail on every view, 280 wide, open from 1280 and folded to a
            // 40 strip below; the content takes the rest.
            HStack(spacing: 0) {
                Group {
                    switch tab {
                    case .notes:
                        if let opened { noteView(opened) } else {
                            notesList
                                .background(theme.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
                                .padding(16)
                        }
                    case .map: mapView
                    case .tags: tagsView
                    case .quality: qualityView
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                if railOpen ?? true {
                    explorer
                        .frame(width: 280)
                        .frame(maxHeight: .infinity, alignment: .top)
                        .background(theme.panel)
                        .overlay(alignment: .leading) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(width: 1) }
                        .transition(.move(edge: .trailing))
                } else {
                    railStrip
                }
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width in
                if railOpen == nil { railOpen = width + 240 >= 1280 }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.app)
        // Import (Tidy up, the page's ⋯): the centred window over the page
        .overlay {
            if importing {
                DesktopMemoryImportSheet(sources: sources, onImported: { count in
                    notice = String(localized: "\(String(count)) notes imported")
                    Task { await load() }
                }, onDone: { importing = false })
            }
        }
        .overlay(alignment: .bottom) {
            if let notice {
                Text(verbatim: notice).font(theme.font(12.5)).foregroundStyle(theme.ink)
                    .padding(.horizontal, 14).frame(height: 36)
                    .background(theme.menu, in: Capsule())
                    .padding(.bottom, 20)
                    .task { try? await Task.sleep(nanoseconds: 4_000_000_000); self.notice = nil }
            }
        }
        .desktopMemoryFolderDeleteConfirmation($pendingDelete) { request in
            Task {
                guard let client = session.settingsClient else { return }
                if let done = try? await request.perform(client: client) {
                    notice = String(localized: "\(String(done.count)) notes deleted")
                }
                await load()
            }
        }
        .environmentObject(model)
        .task { await load() }
        .sheet(item: $creating, onDismiss: { Task { await load() } }) { source in
            NavigationStack { MemoryCreatePage(source: source) }
                .environmentObject(model)
                .environmentObject(session)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-memory")
    }

    // MARK: Header

    private var header: some View {
        // content-page.tsx: the title row (Memory, New note, ⋯, close),
        // the views under it
        VStack(alignment: .leading, spacing: 8) {
        HStack(spacing: 16) {
            Text("Memory").font(theme.font(24, .semibold)).tracking(-0.3).foregroundStyle(theme.ink)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            Button { creating = writableSource } label: {
                HStack(spacing: 4) {
                    DesktopIconView(icon: .plus, size: 13, strokeWidth: 2.25)
                    Text("New note").font(theme.font(12.5, .medium))
                }
                .foregroundStyle(Color.white)
                .padding(.horizontal, 14)
                .frame(minHeight: 32)
                .background(theme.accent, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(writableSource == nil)
            .accessibilityIdentifier("desktop-memory.new")
            Menu {
                Button("Refresh", systemImage: "arrow.clockwise") { Task { await load() } }
                if !sources.isEmpty { Button { importing = true } label: { Label("Import", systemImage: "square.and.arrow.down") } }
                if let trash = sources.first(where: { $0.kind == .perspicax }) {
                    Button("Trash", systemImage: "trash") { opened = nil; place = .source(trash.id) }
                }
            } label: {
                DesktopIconView(icon: .ellipsis, size: 16)
                    .foregroundStyle(theme.ink)
                    .frame(width: 36, height: 36)
                    .background(theme.elevated, in: Circle())
                    .overlay(Circle().strokeBorder(theme.hairlineWeak, lineWidth: 0.5))
            }
            .accessibilityLabel(Text("More options"))
            Button { shell.page = nil } label: {
                DesktopIconView(icon: .x, size: 16)
                    .foregroundStyle(theme.ink)
                    .frame(width: 36, height: 36)
                    .background(theme.elevated, in: Circle())
                    .overlay(Circle().strokeBorder(theme.hairlineWeak, lineWidth: 0.5))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Close"))
        }
            HStack(spacing: 2) {
                ForEach(Tab.allCases, id: \.self) { option in
                    Button { tab = option; opened = nil } label: {
                        HStack(spacing: 6) {
                            DesktopIconView(icon: icon(option), size: 13)
                            Text(label(option)).font(theme.font(12.5))
                        }
                        .foregroundStyle(tab == option ? theme.ink : theme.inkSecondary)
                        .padding(.horizontal, 10)
                        .frame(minHeight: 32)
                        .background(tab == option ? theme.card : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(tab == option ? .isSelected : [])
                    .accessibilityIdentifier("desktop-memory.tab.\(option.rawValue)")
                }
            }
            .padding(4)
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 10)
    }

    // MARK: Explorer (MemorySidebar.tsx)

    /// The folded rail (RightRailStrip): the brain icon and the vertical label.
    private var railStrip: some View {
        Button { withAnimation(.easeOut(duration: 0.18)) { railOpen = true } } label: {
            VStack(spacing: 8) {
                DesktopIconView(icon: .brain, size: 16)
                Text("Memory sources").font(theme.font(11)).fixedSize().rotationEffect(.degrees(90)).frame(width: 16, height: 110)
                Spacer(minLength: 0)
            }
            .foregroundStyle(theme.inkSecondary)
            .padding(.vertical, 16)
            .frame(width: 40)
            .frame(maxHeight: .infinity)
            .background(theme.panel)
            .overlay(alignment: .leading) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(width: 1) }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Show memory sources"))
        .accessibilityIdentifier("desktop-memory.rail-show")
    }

    /// MemorySidebar.tsx: the › fold row, Open a note, LISTS, TIERS (My
    /// memory with a folder per bot, each team with its folders), TIDY UP.
    private var explorer: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Button { withAnimation(.easeOut(duration: 0.18)) { railOpen = false } } label: {
                    DesktopIconView(icon: .chevronRight, size: 16).foregroundStyle(theme.inkSecondary).frame(width: 24, height: 24)
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityLabel(Text("Hide memory sources"))
                .accessibilityIdentifier("desktop-memory.rail-hide")
                Spacer()
            }
            .padding(.horizontal, 8).padding(.top, 8)
            ScrollView {
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 8) {
                        DesktopIconView(icon: .search, size: 13).foregroundStyle(theme.inkSecondary)
                        TextField(text: $query, prompt: Text("Open a note").foregroundColor(theme.inkSecondary)) { Text("Open a note") }
                            .font(theme.font(12.5))
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .accessibilityIdentifier("desktop-memory.search")
                        Text(verbatim: "⌘O").font(theme.font(10.5)).foregroundStyle(theme.inkTertiary)
                            .padding(.horizontal, 4).background(theme.raised, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                    }
                    .padding(.horizontal, 10)
                    .frame(height: 32)
                    .background(theme.ink.opacity(0.03), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
                    .padding(.bottom, 6)
                    group(Text("Lists"))
                    placeRow(.all, Text("All notes"), .fileText, count(.all))
                    placeRow(.teams, Text("Teams"), .users, count(.teams))
                    placeRow(.pinned, Text("Pinned"), .pin, count(.pinned))
                    placeRow(.recent, Text("Recent"), .calendarClock, count(.recent))
                    placeRow(.review, Text("Review"), .eye, count(.review))
                    group(Text("Tiers")).padding(.top, 10)
                    let bots = sources.filter { $0.kind == .bot }
                    if !bots.isEmpty {
                        tierHeader(id: "mine", name: Text("My memory"), colour: theme.success, count: entries.filter { $0.source.kind == .bot }.count, place: nil)
                        if !collapsed.contains("mine") {
                            ForEach(bots) { source in
                                folderRow(source: source, colour: MausPalette.color(session.state.bot(source.botId ?? "")?.color ?? ""))
                            }
                        }
                    }
                    ForEach(tierSources.filter { $0.kind != .bot }) { source in
                        tierHeader(id: source.id, name: Text(verbatim: source.name), colour: tierColor(source), count: count(.source(source.id)), place: .source(source.id))
                        if !collapsed.contains(source.id) {
                            let folders = Array(Set(entries.filter { $0.source.id == source.id }.compactMap(\.row.folder))).sorted()
                            if folders.isEmpty {
                                DesktopText(Text("No folders yet."), size: 12, line: 16, color: \.inkTertiary)
                                    .padding(.leading, 30).frame(height: 24)
                            }
                            ForEach(folders, id: \.self) { folder in
                                let link = source.kind == .perspicax
                                    ? MemoryFolders.pxFolderLink(folder, bots: linkBots, routines: [])
                                    : MemoryFolders.teamFolderLink(section: source.section ?? "", bots: linkBots)
                                let ids = entries.filter { $0.source.id == source.id && $0.row.folder == folder }.map(\.row.id)
                                HStack(spacing: 8) {
                                    DesktopIconView(icon: .folderInput, size: 14).foregroundStyle(theme.inkSecondary)
                                    DesktopText(Text(verbatim: folder), size: 13, line: 18).lineLimit(1)
                                    Spacer(minLength: 0)
                                    DesktopText(Text(verbatim: "\(entries.filter { $0.source.id == source.id && $0.row.folder == folder }.count)"), size: 11.5, line: 16, color: \.inkSecondary)
                                }
                                .padding(.leading, 26).padding(.trailing, 8).frame(minHeight: 30)
                                .contextMenu {
                                    DesktopMemoryFolderMenu(link: link, name: folder,
                                                            block: MemoryFolders.deleteBlock(link: link, isTeam: source.kind == .team, mayWrite: source.mayWrite)) {
                                        pendingDelete = DesktopMemoryFolderRequest(name: folder, kind: .perspicax(scope: source.scope ?? "", ids: ids))
                                    }
                                }
                            }
                        }
                    }
                    group(Text("Tidy up")).padding(.top, 10)
                    if let trash = sources.first(where: { $0.kind == .perspicax }) {
                        Button { opened = nil; place = .source(trash.id) } label: {
                            navRow(Text("Trash"), .trash, nil, current: false)
                        }
                        .buttonStyle(.plain)
                    }
                    if !sources.isEmpty {
                        Button { importing = true } label: { navRow(Text("Import"), .folderInput, nil, current: false) }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("desktop-memory.import")
                    }
                }
                .padding(.horizontal, 12).padding(.bottom, 12)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Memory sources"))
        .accessibilityIdentifier("desktop-memory.rail")
    }

    /// A tier: the chevron, its swatch, the name 13 medium and its count.
    private func tierHeader(id: String, name: Text, colour: Color, count: Int, place target: Place?) -> some View {
        HStack(spacing: 6) {
            Button {
                if collapsed.contains(id) { collapsed.remove(id) } else { collapsed.insert(id) }
            } label: {
                DesktopIconView(icon: .chevronRight, size: 11).rotationEffect(.degrees(collapsed.contains(id) ? 0 : 90)).foregroundStyle(theme.inkSecondary)
                    .frame(width: 16, height: 24)
            }
            .buttonStyle(.plain)
            Button { if let target { place = target; opened = nil; tab = .notes } } label: {
                HStack(spacing: 6) {
                    Circle().fill(colour).frame(width: 7, height: 7)
                    DesktopText(name, size: 13, weight: .medium, line: 18).lineLimit(1)
                    Spacer(minLength: 0)
                    DesktopText(Text(verbatim: "\(count)"), size: 11.5, line: 16, color: \.inkSecondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.leading, 2).padding(.trailing, 8).frame(minHeight: 30)
        .background(target != nil && place == target ? theme.selected : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var linkBots: [LinkBot] { session.state.bots.map(LinkBot.init) }

    /// A bot's folder of My memory (MemorySidebar FolderRow): the bot's look
    /// when it is linked, a plain folder and "Not linked" otherwise; its ⋯
    /// (a long press too) says who uses it and offers Delete folder….
    private func folderRow(source: MemoryManagerSource, colour: Color) -> some View {
        let link = MemoryFolders.botSourceLink(source, bots: linkBots, routines: [])
        let block = MemoryFolders.deleteBlock(link: link, isTeam: false, mayWrite: source.mayWrite)
        let notes = entries.filter { $0.source.id == source.id }
        let menu = DesktopMemoryFolderMenu(link: link, name: source.name, block: block) {
            pendingDelete = DesktopMemoryFolderRequest(name: source.name, kind: .bot(
                botId: source.botId ?? source.id,
                paths: notes.compactMap(\.row.path).filter { $0 != "MEMORY.md" },
                clearIndex: notes.contains { $0.row.path == "MEMORY.md" }))
        }
        return HStack(spacing: 0) {
            Button { place = .source(source.id); opened = nil; tab = .notes } label: {
                HStack(spacing: 8) {
                    if MemoryFolders.isLinked(link) {
                        DesktopMemoryLinkHint(link: link).frame(width: 14)
                    } else {
                        DesktopIconView(icon: .folderInput, size: 14).foregroundStyle(theme.inkSecondary)
                    }
                    DesktopText(Text(verbatim: source.name), size: 13, line: 18).lineLimit(1)
                    Spacer(minLength: 0)
                    if !MemoryFolders.isLinked(link) { DesktopMemoryLinkHint(link: link, showsMark: false) }
                    DesktopText(Text(verbatim: "\(count(.source(source.id)))"), size: 11.5, line: 16, color: \.inkSecondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: "\(source.name), \(desktopMemoryLinkTitle(link))"))
        }
        .padding(.leading, 22).padding(.trailing, 8).frame(minHeight: 30)
        .background(place == .source(source.id) ? theme.selected : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .contextMenu { menu }
        .accessibilityIdentifier("desktop-memory.folder.\(source.id)")
    }

    private func navRow(_ title: Text, _ icon: DesktopIcon, _ count: Int?, current: Bool) -> some View {
        HStack(spacing: 8) {
            DesktopIconView(icon: icon, size: 16).foregroundStyle(theme.inkSecondary)
            DesktopText(title, size: 13, line: 18).lineLimit(1)
            Spacer(minLength: 0)
            if let count { DesktopText(Text(verbatim: "\(count)"), size: 11.5, line: 16, color: \.inkSecondary).monospacedDigit() }
        }
        .padding(.horizontal, 8)
        .frame(minHeight: 30)
        .background(current ? theme.selected : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .contentShape(Rectangle())
    }

    private func group(_ title: Text) -> some View {
        DesktopText(title, size: 11, weight: .medium, line: 14, color: \.inkTertiary)
            .textCase(.uppercase)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
    }

    private func placeRow(_ target: Place, _ title: Text, _ icon: DesktopIcon, _ count: Int) -> some View {
        Button { place = target; opened = nil; checked = []; tab = .notes } label: {
            navRow(title, icon, count, current: place == target)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(place == target ? .isSelected : [])
    }

    // MARK: List (MemoryNotesList.tsx)

    private var shown: [Entry] {
        var rows = entries(in: place)
        let staleBefore = Date().timeIntervalSince1970 * 1000 - 180 * 86_400_000
        switch listView {
        case .active: rows = rows.filter { $0.row.kind != "archived" }
        case .all: break
        case .archived: rows = rows.filter { $0.row.kind == "archived" }
        case .stale: rows = rows.filter { $0.row.kind != "archived" && ($0.row.updatedAt ?? staleBefore) < staleBefore }
        }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if !q.isEmpty { rows = rows.filter { "\($0.row.title) \($0.row.excerpt ?? "") \($0.source.name)".lowercased().contains(q) } }
        if let tagFilter { rows = rows.filter { $0.row.tags?.contains(tagFilter) == true } }
        switch sort {
        case .changed: rows.sort { ($0.row.updatedAt ?? 0) > ($1.row.updatedAt ?? 0) }
        case .title: rows.sort { $0.row.title.localizedCaseInsensitiveCompare($1.row.title) == .orderedAscending }
        case .manual: break
        }
        return rows
    }

    private var notesList: some View {
        let rows = shown
        let total = entries(in: place).count
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(placeTitle).font(theme.font(17, .semibold)).foregroundStyle(theme.ink)
                    Text(placeSubtitle).font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                }
                Spacer(minLength: 0)
                if let source = currentWritableSource ?? writableSource {
                    Button { creating = source } label: {
                        HStack(spacing: 4) { DesktopIconView(icon: .plus, size: 12); Text("New note here") }
                            .font(theme.font(12.5)).foregroundStyle(theme.ink)
                            .padding(.horizontal, 10).frame(minHeight: 32)
                            .overlay(Capsule().strokeBorder(theme.hairline, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 10)
            HStack(spacing: 8) {
                // the named view (MemoryNotesList.tsx): Active, All, Archived, Aging
                Menu {
                    ForEach(ListView.allCases, id: \.self) { option in
                        Button { listView = option } label: { Text(String(localized: viewLabel(option))) }
                    }
                } label: {
                    HStack(spacing: 6) {
                        Text("View · \(String(localized: viewLabel(listView)))").font(theme.font(12.5)).foregroundStyle(theme.ink)
                        Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(theme.inkSecondary)
                    }
                    .padding(.horizontal, 10).frame(width: 140, height: 32, alignment: .leading)
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline, lineWidth: 1))
                }
                .accessibilityLabel(Text("Named view"))
                HStack(spacing: 8) {
                    DesktopIconView(icon: .search, size: 13).foregroundStyle(theme.inkSecondary)
                    TextField(text: $query, prompt: Text("Search (tag:, folder:, author:, tier:, has:)").foregroundColor(theme.inkSecondary)) { Text("Search") }
                        .font(theme.font(12.5))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                .padding(.horizontal, 10)
                .frame(width: 150, height: 32)
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline, lineWidth: 1))
                Menu {
                    Button("All tags") { tagFilter = nil }
                    ForEach(allTags, id: \.self) { tag in Button(tag) { tagFilter = tag } }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "line.3.horizontal.decrease").font(.system(size: 11))
                        Text(tagFilter.map { "#\($0)" } ?? String(localized: "Filter"))
                    }
                    .font(theme.font(12.5)).foregroundStyle(theme.ink)
                    .padding(.horizontal, 10).frame(minHeight: 32)
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline, lineWidth: 1))
                }
                Spacer(minLength: 0)
                HStack(spacing: 2) {
                    ForEach(Sort.allCases, id: \.self) { option in
                        Button { sort = option } label: {
                            Text(sortLabel(option)).font(theme.font(12.5))
                                .foregroundStyle(sort == option ? theme.ink : theme.inkSecondary)
                                .padding(.horizontal, 10).frame(minHeight: 32)
                                .background(sort == option ? theme.card : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
                DesktopText(Text("\(rows.count) of \(total)"), size: 12, line: 16, color: \.inkSecondary).monospacedDigit()
            }
            .padding(.horizontal, 20).padding(.bottom, 8)
            HStack(spacing: 10) {
                Button {
                    checked = checked.count == rows.count ? [] : Set(rows.map(\.id))
                } label: {
                    Image(systemName: !rows.isEmpty && checked.count == rows.count ? "checkmark.square.fill" : "square")
                        .foregroundStyle(theme.inkTertiary).frame(width: 24, height: 24)
                }
                .buttonStyle(.plain)
                DesktopText(Text("\(rows.count) notes · tap to open"), size: 12, line: 16, color: \.inkSecondary)
            }
            .padding(.horizontal, 20).padding(.vertical, 4)
            Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1)
            if loading {
                ProgressView().frame(maxWidth: .infinity).padding(24)
            } else if rows.isEmpty {
                DesktopText(Text("No notes here yet."), color: \.inkSecondary).padding(20)
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(rows) { entry in noteRow(entry) }
                }
            }
        }
    }

    private func noteRow(_ entry: Entry) -> some View {
        Button { opened = entry } label: {
            HStack(alignment: .top, spacing: 12) {
                Button {
                    if checked.contains(entry.id) { checked.remove(entry.id) } else { checked.insert(entry.id) }
                } label: {
                    Image(systemName: checked.contains(entry.id) ? "checkmark.square.fill" : "square")
                        .foregroundStyle(checked.contains(entry.id) ? theme.accent : theme.inkTertiary)
                        .frame(width: 24, height: 24)
                }
                .buttonStyle(.plain)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(verbatim: entry.row.title).font(theme.font(13.5, .medium)).foregroundStyle(theme.ink).lineLimit(1)
                        if pins.contains(entry.id) { DesktopIconView(icon: .pin, size: 11).foregroundStyle(theme.inkSecondary) }
                    }
                    if let excerpt = entry.row.excerpt, !excerpt.isEmpty {
                        Text(verbatim: excerpt).font(theme.font(12.5)).foregroundStyle(theme.inkSecondary).lineLimit(2)
                    }
                    HStack(spacing: 6) {
                        Circle().fill(tierColor(entry.source)).frame(width: 7, height: 7)
                        Text(tierLabel(entry.source)).font(theme.font(11.5, .medium)).foregroundStyle(theme.inkSecondary)
                        if entry.source.kind == .bot {
                            Text(verbatim: entry.source.name).font(theme.font(11.5)).foregroundStyle(theme.inkTertiary)
                        }
                        ForEach(entry.row.tags ?? [], id: \.self) { tag in
                            Text(verbatim: "#\(tag)").font(theme.font(11)).foregroundStyle(theme.accentText)
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            .frame(minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(DesktopHoverFill(radius: 0))
        .contextMenu {
            Button(pins.contains(entry.id) ? String(localized: "Unpin") : String(localized: "Pin"), systemImage: "pin") { togglePin(entry) }
        }
        .overlay(alignment: .bottom) { Rectangle().fill(theme.hairline.opacity(0.25)).frame(height: 0.5) }
        .accessibilityIdentifier("desktop-memory.note.\(entry.row.id)")
    }

    private func noteView(_ entry: Entry) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Button { opened = nil } label: {
                    HStack(spacing: 4) {
                        DesktopIconView(icon: .chevronRight, size: 13).rotationEffect(.degrees(180))
                        Text(placeTitle)
                    }
                    .font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
                    .frame(minHeight: 32)
                }
                .buttonStyle(.plain)
                Spacer(minLength: 0)
                Button { togglePin(entry) } label: {
                    DesktopIconView(icon: pins.contains(entry.id) ? .pinOff : .pin, size: 14).foregroundStyle(theme.inkSecondary).frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(pins.contains(entry.id) ? "Unpin" : "Pin"))
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            NavigationStack {
                MemoryNotePage(source: entry.source, noteId: entry.row.id, scope: entry.row.scope, path: entry.row.path)
                    .toolbar(.hidden, for: .navigationBar)
            }
            .id(entry.id)
        }
    }

    // MARK: Map, Tags, Quality

    /// The map: the desktop's radial brain (BrainMap.tsx).
    private var mapView: some View {
        DesktopBrainMap(entries: entries, colorOf: tierColor, open: { entry in
            tab = .notes; place = .source(entry.source.id); opened = entry
        }, sources: tierSources)
    }

    /// Tags (MemoryTagsView.tsx): a tag opens the notes filtered by it.
    private var tagsView: some View {
        DesktopMemoryTags(entries: entries) { tag in tab = .notes; place = .all; tagFilter = tag }
    }

    /// Quality (MemoryQualityView.tsx): health, the 26-week charts, the journal.
    private var qualityView: some View {
        DesktopMemoryQuality(entries: entries, colorOf: tierColor)
    }

    private var allTags: [String] {
        Array(Set(entries.flatMap { $0.row.tags ?? [] })).sorted()
    }

    // MARK: Data

    private func load() async {
        loading = true
        defer { loading = false }
        await model.loadSources(session)
        guard let client = session.settingsClient else { return }
        var all: [Entry] = []
        for source in sources {
            let page: MemoryBrowse?
            switch source.kind {
            case .bot:
                if let botId = source.botId, let overview = try? await client.memoryOverview(botId: botId) {
                    page = MemoryManager.browseBot(overview: overview)
                } else { page = nil }
            case .team:
                page = (try? await client.teamMemory(section: source.section ?? "")).map { MemoryManager.browseTeam(entries: $0.entries) }
            case .perspicax:
                page = (try? await client.perspicaxMemoryTree()).map { MemoryManager.browsePerspicax(tree: $0, scope: source.scope) }
            }
            all += (page?.notes ?? []).map { Entry(source: source, row: $0) }
        }
        entries = all
    }

    private func entries(in place: Place) -> [Entry] {
        let week = Date().timeIntervalSince1970 * 1000 - 7 * 86_400_000
        switch place {
        case .all: return entries
        case .teams: return entries.filter { $0.source.kind == .team }
        case .pinned: return entries.filter { pins.contains($0.id) }
        case .recent: return entries.filter { ($0.row.updatedAt ?? 0) > week }
        case .review: return entries.filter { $0.row.kind == "suggestion" || $0.row.kind == "review" }
        case let .source(id): return entries.filter { $0.source.id == id }
        }
    }

    private func count(_ place: Place) -> Int { entries(in: place).count }

    private var writableSource: MemoryManagerSource? {
        currentWritableSource ?? sources.first { $0.mayWrite && $0.kind != .bot } ?? sources.first { $0.mayWrite }
    }

    private var currentWritableSource: MemoryManagerSource? {
        if case let .source(id) = place, let source = sources.first(where: { $0.id == id }), source.mayWrite { return source }
        return nil
    }

    private func togglePin(_ entry: Entry) {
        var next = pins
        if next.contains(entry.id) { next.remove(entry.id) } else { next.insert(entry.id) }
        pinsRaw = next.sorted().joined(separator: "\n")
    }

    private var placeTitle: LocalizedStringKey {
        switch place {
        case .all: "All notes"
        case .teams: "Teams"
        case .pinned: "Pinned"
        case .recent: "Recent"
        case .review: "Review"
        case let .source(id): LocalizedStringKey(sources.first { $0.id == id }?.name ?? "")
        }
    }

    private var placeSubtitle: LocalizedStringKey {
        switch place {
        case .all: "Everything you can read, every tier."
        case .teams: "The notes your teams share."
        case .pinned: "The notes you pinned on this iPad."
        case .recent: "Changed in the last seven days."
        case .review: "Notes waiting for your review."
        case .source: ""
        }
    }

    private func tierLabel(_ source: MemoryManagerSource) -> LocalizedStringKey {
        switch source.kind {
        case .bot: "My memory"
        case .team: LocalizedStringKey(source.name)
        case .perspicax: "Perspicax"
        }
    }

    /// memory-page.ts tierColor: one's own memory green, the organization
    /// the accent, each team a stable colour by its order.
    private func tierColor(_ source: MemoryManagerSource) -> Color {
        switch source.kind {
        case .bot: return theme.success
        case .perspicax where source.scope == nil || source.scope == "org": return theme.accent
        default:
            let teams = sources.filter { $0.kind != .bot && !($0.kind == .perspicax && ($0.scope == nil || $0.scope == "org")) }
            let index = teams.firstIndex { $0.id == source.id } ?? 0
            let palette = [theme.warning, Self.mix(theme.accent, theme.danger, 0.55), Self.primaryBadge,
                           Self.mix(theme.success, theme.accent, 0.5), theme.danger]
            return palette[index % palette.count]
        }
    }

    /// `--color-primary-badge` (styles.css, the default skin).
    private static let primaryBadge = Color(red: 0xf4 / 255, green: 0x8a / 255, blue: 0x29 / 255)

    /// `color-mix(in srgb, a p, b)`.
    static func mix(_ a: Color, _ b: Color, _ p: Double) -> Color {
        let x = UIColor(a), y = UIColor(b)
        var r1: CGFloat = 0, g1: CGFloat = 0, b1: CGFloat = 0, a1: CGFloat = 0, r2: CGFloat = 0, g2: CGFloat = 0, b2: CGFloat = 0, a2: CGFloat = 0
        x.getRed(&r1, green: &g1, blue: &b1, alpha: &a1)
        y.getRed(&r2, green: &g2, blue: &b2, alpha: &a2)
        let q = CGFloat(p)
        return Color(red: r1 * q + r2 * (1 - q), green: g1 * q + g2 * (1 - q), blue: b1 * q + b2 * (1 - q))
    }

    private func label(_ tab: Tab) -> LocalizedStringKey {
        switch tab {
        case .notes: "Notes"
        case .map: "Map"
        case .tags: "Tags"
        case .quality: "Quality"
        }
    }

    private func icon(_ tab: Tab) -> DesktopIcon {
        switch tab {
        case .notes: .fileText
        case .map: .network
        case .tags: .pin
        case .quality: .activity
        }
    }

    private func viewLabel(_ view: ListView) -> String.LocalizationValue {
        switch view {
        case .active: "Active notes"
        case .all: "All, archived included"
        case .archived: "Archived"
        case .stale: "Aging notes"
        }
    }

    private func sortLabel(_ sort: Sort) -> LocalizedStringKey {
        switch sort {
        case .changed: "Changed"
        case .title: "Title"
        case .manual: "Manual"
        }
    }
}

