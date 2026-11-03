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
    @AppStorage("sagax.memory.pins.v1") private var pinsRaw = ""

    private var pins: Set<String> { Set(pinsRaw.split(separator: "\n").map(String.init)) }
    private var sources: [MemoryManagerSource] { model.sources ?? [] }

    var body: some View {
        VStack(spacing: 0) {
            header
                #if DEBUG
                .onAppear {
                    switch ParityLaunch.current?.iPadScreen {
                    case .memoryMap?: tab = .map
                    case .memoryTags?: tab = .tags
                    case .memoryQuality?: tab = .quality
                    default: break
                    }
                }
                #endif
            switch tab {
            case .notes:
                HStack(spacing: 0) {
                    explorer.frame(width: 240)
                    Rectangle().fill(theme.hairline.opacity(0.4)).frame(width: 1)
                    Group {
                        if let opened {
                            noteView(opened)
                        } else {
                            notesList
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            case .map: mapView
            case .tags: tagsView
            case .quality: qualityView
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.app)
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

    private var explorer: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    DesktopIconView(icon: .search, size: 13).foregroundStyle(theme.inkSecondary)
                    TextField(text: $query, prompt: Text("Open a note").foregroundColor(theme.inkSecondary)) { Text("Open a note") }
                        .font(theme.font(12.5))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("desktop-memory.search")
                }
                .padding(.horizontal, 10)
                .frame(height: 32)
                .background(theme.ink.opacity(0.03), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
                .padding(.bottom, 8)
                group(Text("Lists"))
                placeRow(.all, Text("All notes"), .fileText, count(.all))
                placeRow(.teams, Text("Teams"), .users, count(.teams))
                placeRow(.pinned, Text("Pinned"), .pin, count(.pinned))
                placeRow(.recent, Text("Recent"), .calendarClock, count(.recent))
                placeRow(.review, Text("Review"), .eye, count(.review))
                group(Text("Tiers")).padding(.top, 10)
                let bots = sources.filter { $0.kind == .bot }
                if !bots.isEmpty {
                    HStack(spacing: 6) {
                        DesktopIconView(icon: .chevronRight, size: 11).rotationEffect(.degrees(90)).foregroundStyle(theme.inkSecondary)
                        Circle().fill(theme.success).frame(width: 7, height: 7)
                        DesktopText(Text("My memory"), size: 12.5, weight: .medium, line: 18)
                        Spacer(minLength: 0)
                        DesktopText(Text(verbatim: "\(entries.filter { $0.source.kind == .bot }.count)"), size: 11.5, line: 16, color: \.inkSecondary)
                    }
                    .padding(.horizontal, 8).frame(height: 30)
                    ForEach(bots) { source in
                        placeRow(.source(source.id), Text(verbatim: source.name), .bot, count(.source(source.id)))
                            .padding(.leading, 12)
                    }
                }
                ForEach(sources.filter { $0.kind != .bot }) { source in
                    Button { place = .source(source.id); opened = nil } label: {
                        HStack(spacing: 6) {
                            DesktopIconView(icon: .chevronRight, size: 11).rotationEffect(.degrees(90)).foregroundStyle(theme.inkSecondary)
                            Circle().fill(tierColor(source)).frame(width: 7, height: 7)
                            DesktopText(Text(verbatim: source.name), size: 12.5, weight: .medium, line: 18).lineLimit(1)
                            Spacer(minLength: 0)
                            DesktopText(Text(verbatim: "\(count(.source(source.id)))"), size: 11.5, line: 16, color: \.inkSecondary)
                        }
                        .padding(.horizontal, 8).frame(minHeight: 30)
                        .background(place == .source(source.id) ? theme.selected : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if count(.source(source.id)) == 0 {
                        DesktopText(Text("No folders yet."), size: 12, line: 16, color: \.inkTertiary)
                            .padding(.leading, 30).frame(height: 22)
                    }
                }
            }
            .padding(12)
        }
    }

    private func group(_ title: Text) -> some View {
        DesktopText(title, size: 11, weight: .medium, line: 14, color: \.inkTertiary)
            .textCase(.uppercase)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
    }

    private func placeRow(_ target: Place, _ title: Text, _ icon: DesktopIcon, _ count: Int) -> some View {
        Button { place = target; opened = nil; checked = [] } label: {
            HStack(spacing: 8) {
                DesktopIconView(icon: icon, size: 14).foregroundStyle(theme.inkSecondary)
                DesktopText(title, size: 12.5, line: 18).lineLimit(1)
                Spacer(minLength: 0)
                DesktopText(Text(verbatim: "\(count)"), size: 11.5, line: 16, color: \.inkSecondary).monospacedDigit()
            }
            .padding(.horizontal, 8)
            .frame(minHeight: 32)
            .background(place == target ? theme.selected : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(place == target ? .isSelected : [])
    }

    // MARK: List (MemoryNotesList.tsx)

    private var shown: [Entry] {
        var rows = entries(in: place)
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
                if let source = currentWritableSource {
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
                HStack(spacing: 8) {
                    DesktopIconView(icon: .search, size: 13).foregroundStyle(theme.inkSecondary)
                    TextField(text: $query, prompt: Text("Search (tag:, folder:, author:, tier:, has:)").foregroundColor(theme.inkSecondary)) { Text("Search") }
                        .font(theme.font(12.5))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                .padding(.horizontal, 10)
                .frame(width: 280, height: 32)
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline, lineWidth: 1))
                Menu {
                    Button("All tags") { tagFilter = nil }
                    ForEach(allTags, id: \.self) { tag in Button(tag) { tagFilter = tag } }
                } label: {
                    HStack(spacing: 6) {
                        DesktopIconView(icon: .eye, size: 12)
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
        }, sources: sources)
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

    private func tierColor(_ source: MemoryManagerSource) -> Color {
        switch source.kind {
        case .bot: theme.success
        case .team: theme.warning
        case .perspicax: theme.accent
        }
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

    private func sortLabel(_ sort: Sort) -> LocalizedStringKey {
        switch sort {
        case .changed: "Changed"
        case .title: "Title"
        case .manual: "Manual"
        }
    }
}

