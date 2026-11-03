// iPad lot 5 (2026-11-03): Memory > Map, Tags and Quality, the desktop's
// (memory-manager/BrainMap.tsx, MemoryTagsView.tsx, MemoryQualityView.tsx).
// The map is the radial brain (CompanionCore's MemoryBrain, the port of
// src/lib/memory-brain.ts): pinch to zoom, drag to pan, search to light
// the matches, a note opens on tap. Tags and Quality read the same notes.
import SwiftUI
import UIKit
import Charts
import CompanionCore

// MARK: - Map

struct DesktopBrainMap: View {
    @Environment(\.desktopTheme) private var theme
    let entries: [DesktopMemoryPage.Entry]
    let colorOf: (MemoryManagerSource) -> Color
    let open: (DesktopMemoryPage.Entry) -> Void

    /// Every tier the person reads, empty ones too (the chips show 0).
    let sources: [MemoryManagerSource]

    @State private var query = ""
    @State private var focus = "all"
    @State private var zoom: Double = 1
    @State private var pinch: Double = 1
    @State private var pan: CGSize = .zero
    @State private var drag: CGSize = .zero

    /// The desktop's tiers: every bot's memory is one tier, "My memory",
    /// with a branch per bot; a team or Perspicax source is its own tier.
    private struct MapTier: Identifiable {
        var id: String
        var name: String
        var colour: Color
        var entries: [DesktopMemoryPage.Entry]
        var topic: (DesktopMemoryPage.Entry) -> String
    }

    private var tiers: [MapTier] {
        var out: [MapTier] = []
        let bots = sources.filter { $0.kind == .bot }
        if let first = bots.first {
            out.append(MapTier(id: "mine", name: String(localized: "My memory"), colour: colorOf(first),
                               entries: entries.filter { $0.source.kind == .bot }, topic: { $0.source.name }))
        }
        for source in sources where source.kind != .bot {
            out.append(MapTier(id: source.id, name: source.name, colour: colorOf(source),
                               entries: entries.filter { $0.source.id == source.id }, topic: { $0.row.folder ?? source.name }))
        }
        return out
    }

    private func brain(_ tiers: [MapTier]) -> MemoryBrain.Brain {
        let shown = focus == "all" ? tiers : tiers.filter { $0.id == focus }
        return MemoryBrain.build(tiers: shown.map { tier in
            MemoryBrain.Tier(scope: tier.id, name: tier.name, notes: tier.entries.map { entry in
                MemoryBrain.Note(id: entry.id, title: entry.row.title, topic: tier.topic(entry),
                                 tags: entry.row.tags ?? [], updated: entry.row.updatedAt)
            })
        }, rootLabel: String(localized: "All memory"), untitled: String(localized: "Untitled"))
    }

    var body: some View {
        let tiers = self.tiers
        let brain = self.brain(tiers)
        let lit = MemoryBrain.spotlight(brain, query: query)
        VStack(alignment: .leading, spacing: 10) {
            // the toolbar: Find on the map, then a chip per tier
            HStack(spacing: 8) {
                HStack(spacing: 8) {
                    DesktopIconView(icon: .search, size: 13).foregroundStyle(theme.inkSecondary)
                    TextField(text: $query, prompt: Text("Find on the map").foregroundColor(theme.inkSecondary)) { Text("Find on the map") }
                        .font(theme.font(12.5))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                .padding(.horizontal, 10)
                .frame(width: 220, height: 30)
                .background(theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        chip(id: "all", label: Text("All memory"), colour: nil, count: nil)
                        ForEach(tiers) { tier in
                            chip(id: tier.id, label: Text(verbatim: tier.name), colour: tier.colour, count: tier.entries.count)
                        }
                    }
                }
            }
            HStack {
                Spacer()
                Text("\(String(brain.notes)) notes, \(String(0)) links").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
            }
            GeometryReader { geometry in
                let base = MemoryBrain.fit(brain, width: geometry.size.width, height: geometry.size.height)
                let s = base.scale * zoom * pinch
                let tx = base.tx + pan.width + drag.width
                let ty = base.ty + pan.height + drag.height
                ZStack {
                    Canvas { context, _ in
                        draw(brain, lit: lit, colours: tiers, in: &context, s: s, tx: tx, ty: ty)
                    }
                    .gesture(SimultaneousGesture(
                        MagnificationGesture().onChanged { pinch = $0 }.onEnded { zoom = min(6, max(0.3, zoom * $0)); pinch = 1 },
                        DragGesture().onChanged { drag = $0.translation }.onEnded { pan.width += $0.translation.width; pan.height += $0.translation.height; drag = .zero }
                    ))
                    .simultaneousGesture(SpatialTapGesture().onEnded { value in
                        tap(brain, at: value.location, s: s, tx: tx, ty: ty)
                    })
                    .accessibilityLabel(Text("Map of the memory"))
                    if brain.notes == 0 {
                        Text("No note on the map yet. Write the first one.").font(theme.font(13)).foregroundStyle(theme.inkSecondary)
                    }
                    VStack(spacing: 4) {
                        zoomButton("plus") { zoom = min(6, zoom * 1.25) }
                        zoomButton("minus") { zoom = max(0.3, zoom / 1.25) }
                        zoomButton("arrow.up.left.and.arrow.down.right") { zoom = 1; pan = .zero }
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                }
            }
            .background(theme.panel.opacity(0.5))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
            Text("Drag to move, scroll or pinch to zoom, press a note to open it.").font(theme.font(11.5)).foregroundStyle(theme.inkTertiary)
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
        .accessibilityIdentifier("desktop-memory-map")
    }

    private func chip(id: String, label: Text, colour: Color?, count: Int?) -> some View {
        let on = focus == id
        return Button { focus = id; zoom = 1; pan = .zero } label: {
            HStack(spacing: 6) {
                if let colour { Circle().fill(colour).frame(width: 7, height: 7) }
                label.font(theme.font(12, on ? .medium : .regular)).foregroundStyle(on ? theme.ink : theme.inkSecondary)
                if let count { Text(verbatim: "\(count)").font(theme.font(11.5)).foregroundStyle(theme.inkTertiary) }
            }
            .padding(.horizontal, 10).frame(height: 28)
            .background(on ? theme.raised : Color.clear, in: Capsule())
            .overlay(Capsule().strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
    }

    private func zoomButton(_ symbol: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 11, weight: .medium)).foregroundStyle(theme.inkSecondary).frame(width: 30, height: 30)
                .background(theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
    }

    private func draw(_ brain: MemoryBrain.Brain, lit: Set<Int>?, colours tiers: [MapTier], in context: inout GraphicsContext, s: Double, tx: Double, ty: Double) {
        func colour(_ node: MemoryBrain.Node) -> Color { tiers.first { $0.id == node.scope }?.colour ?? theme.accent }
        func point(_ node: MemoryBrain.Node) -> CGPoint { CGPoint(x: node.x * s + tx, y: node.y * s + ty) }
        // edges, parent to child, as curves toward the centre
        for (index, node) in brain.nodes.enumerated() where node.parent >= 0 {
            let parent = brain.nodes[node.parent]
            let style = MemoryBrain.edgeStyle(node)
            let dim = lit.map { !$0.contains(index) } ?? false
            var path = Path()
            let a = point(parent), b = point(node)
            path.move(to: a)
            let mid = CGPoint(x: (a.x + b.x) / 2 * 0.98 + tx * 0.02, y: (a.y + b.y) / 2 * 0.98 + ty * 0.02)
            path.addQuadCurve(to: b, control: mid)
            let tint = style.tinted ? colour(node) : theme.inkTertiary
            context.stroke(path, with: .color(tint.opacity(dim ? 0.08 : style.alpha)), lineWidth: style.width * min(1.4, max(0.6, s.squareRoot())))
        }
        // nodes and labels
        for (index, node) in brain.nodes.enumerated() {
            let p = point(node)
            let r = MemoryBrain.nodeSize(node, scale: s)
            let dim = lit.map { !$0.contains(index) } ?? false
            let fill = node.kind == .root ? theme.accent : colour(node)
            context.fill(Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)), with: .color(fill.opacity(dim ? 0.15 : (node.age >= MemoryBrain.staleDays && node.kind == .note ? 0.5 : 1))))
            let showsLabel = node.kind != .note || s > 0.45 || (lit?.contains(index) ?? false)
            guard showsLabel, !dim else { continue }
            let size: CGFloat = node.kind == .root ? 14 : node.kind == .tier ? 13 : node.kind == .topic ? 12 : 11
            let text = Text(verbatim: node.label).font(theme.font(size, node.kind == .note ? .regular : .medium)).foregroundColor(node.kind == .note ? theme.inkSecondary : theme.ink)
            let outward = node.kind == .root ? CGPoint(x: p.x, y: p.y + r + 10) : CGPoint(x: p.x + cos(node.angle) * (r + 8), y: p.y + sin(node.angle) * (r + 8))
            let anchor: UnitPoint = node.kind == .root ? .top : (cos(node.angle) >= 0 ? .leading : .trailing)
            context.draw(text, at: outward, anchor: anchor)
        }
    }

    private func tap(_ brain: MemoryBrain.Brain, at location: CGPoint, s: Double, tx: Double, ty: Double) {
        var best: (Int, Double)?
        for (index, node) in brain.nodes.enumerated() where node.kind == .note {
            let dx = node.x * s + tx - location.x, dy = node.y * s + ty - location.y
            let d = (dx * dx + dy * dy).squareRoot()
            if d < max(14, MemoryBrain.nodeSize(node, scale: s) + 6), d < (best?.1 ?? .infinity) { best = (index, d) }
        }
        guard let (index, _) = best else { return }
        let node = brain.nodes[index]
        if let entry = entries.first(where: { $0.id == node.noteId }) { open(entry) }
    }
}

// MARK: - Tags (MemoryTagsView.tsx)

struct DesktopMemoryTags: View {
    @Environment(\.desktopTheme) private var theme
    let entries: [DesktopMemoryPage.Entry]
    let filter: (String) -> Void

    private var counts: [(tag: String, count: Int)] {
        Dictionary(grouping: entries.flatMap { $0.row.tags ?? [] }, by: { $0 }).map { ($0.key, $0.value.count) }
            .sorted { $0.count != $1.count ? $0.count > $1.count : $0.tag < $1.tag }
    }

    var body: some View {
        let free = counts
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Tags").font(theme.font(17, .semibold)).foregroundStyle(theme.ink)
                    Text("The tags your notes carry, the most used, and those to tidy up.").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                }
                // No Perspicax tag namespaces here: the desktop's layout
                // without them, the Free tags card then two cards side by side.
                DesktopStatCard(title: Text("Free tags"), value: "\(free.count)", caption: Text("Outside every namespace"))
                HStack(alignment: .top, spacing: 12) {
                    section(Text("Free tags"), hint: Text("Tags outside every namespace, with their notes")) {
                        if free.isEmpty { Text("No free tag.").font(theme.font(12.5)).foregroundStyle(theme.inkSecondary) }
                        ForEach(free, id: \.tag) { item in
                            Button { filter(item.tag) } label: {
                                HStack {
                                    Text(verbatim: "#\(item.tag)").font(theme.font(12.5, .medium)).foregroundStyle(theme.accentText)
                                    Spacer()
                                    Text("Notes: \(String(item.count))").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                                }
                                .frame(minHeight: 36)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    section(Text("Most used"), hint: nil) {
                        if free.isEmpty {
                            Text("No tag on any note yet.").font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
                        } else {
                            DesktopChipFlow(spacing: 6) {
                                ForEach(free.prefix(30), id: \.tag) { item in
                                    Button { filter(item.tag) } label: {
                                        Text(verbatim: "#\(item.tag) \(item.count)").font(theme.font(12)).foregroundStyle(theme.accentText)
                                            .padding(.horizontal, 10).frame(minHeight: 30)
                                            .background(theme.accent.opacity(0.12), in: Capsule())
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                }
            }
            .padding(20)
        }
    }

    private func section<Content: View>(_ title: Text, hint: Text?, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                title.font(theme.font(13, .semibold)).foregroundStyle(theme.ink)
                Spacer(minLength: 8)
                hint?.font(theme.font(12)).foregroundStyle(theme.inkSecondary)
            }
            content()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
    }
}

// MARK: - Quality (MemoryQualityView.tsx)

struct DesktopMemoryQuality: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let entries: [DesktopMemoryPage.Entry]
    let colorOf: (MemoryManagerSource) -> Color
    @State private var journal: [(bot: String, row: MemoryJournalRow)] = []

    /// MemoryQualityView.tsx `H`: a note not changed in 180 days is aging.
    private static let agingDays = 180.0
    private enum Pane { case health, journal }
    @State private var view: Pane = .health

    private func segment(_ value: Pane, _ label: Text) -> some View {
        Button { view = value } label: {
            label.font(theme.font(12, view == value ? .medium : .regular))
                .foregroundStyle(view == value ? theme.ink : theme.inkSecondary)
                .padding(.horizontal, 10).frame(height: 26)
                .background(view == value ? theme.raised : Color.clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    var body: some View {
        let now = Date().timeIntervalSince1970 * 1000
        let aging = entries.filter { ($0.row.updatedAt ?? now) < now - Self.agingDays * MemoryBrain.dayMs }.count
        let duplicates = Dictionary(grouping: entries, by: { "\($0.source.id)|\($0.row.title.lowercased())" }).values.filter { $0.count > 1 }.reduce(0) { $0 + $1.count }
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Quality").font(theme.font(17, .semibold)).foregroundStyle(theme.ink)
                    Text("How the memory holds up: its size, its age, its doubles, its writes.").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                }
                // Health | Journal (the desktop's segmented pair)
                HStack(spacing: 2) {
                    segment(.health, Text("Health"))
                    segment(.journal, Text("Journal"))
                }
                .padding(2)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
                if view == .health {
                    HStack(spacing: 12) {
                        DesktopStatCard(title: Text("Active notes"), value: "\(entries.count)", caption: nil)
                        DesktopStatCard(title: Text("In review"), value: "0", caption: Text("Proposals waiting"))
                        DesktopStatCard(title: Text("Aging"), value: "\(aging)", caption: Text("No change in \(String(Int(Self.agingDays))) days"))
                        DesktopStatCard(title: Text("Duplicates"), value: "\(duplicates)", caption: Text("Same title in one tier"))
                    }
                    HStack(alignment: .top, spacing: 12) {
                        let weeks = weekly()
                        chart(title: Text("Active notes per tier, 26 weeks"), hint: weeks.isEmpty ? nil : Text("Today's notes by the week they were written.")) {
                            if weeks.isEmpty {
                                Text("Nothing to chart yet.").font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
                            } else {
                                Chart(weeks, id: \.id) { bar in
                                    BarMark(x: .value("Week", bar.week, unit: .weekOfYear), y: .value("Notes", bar.count))
                                        .foregroundStyle(by: .value("Tier", bar.tier))
                                }
                                .chartLegend(.visible)
                                .frame(height: 180)
                            }
                        }
                        let written = writes()
                        chart(title: Text("Writes per week"), hint: nil) {
                            if written.isEmpty {
                                Text("Nothing to chart yet.").font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
                            } else {
                                Chart(written, id: \.week) { bar in
                                    BarMark(x: .value("Week", bar.week, unit: .weekOfYear), y: .value("Writes", bar.count))
                                        .foregroundStyle(theme.accent)
                                }
                                .frame(height: 140)
                            }
                        }
                    }
                } else {
                VStack(alignment: .leading, spacing: 8) {
                    if journal.isEmpty {
                        Text("No change in the bots' memory journals yet.").font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
                    }
                    ForEach(journal.prefix(50), id: \.row.id) { item in
                        HStack(spacing: 8) {
                            Text(verbatim: item.bot).font(theme.font(12.5, .medium)).foregroundStyle(theme.ink)
                            Text(kindWord(item.row.kind)).font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                            Text(verbatim: item.row.path).font(theme.font(12)).foregroundStyle(theme.inkSecondary).lineLimit(1)
                            Spacer(minLength: 0)
                            Text(verbatim: Date(timeIntervalSince1970: item.row.at / 1000).formatted(date: .abbreviated, time: .shortened))
                                .font(theme.font(11.5)).foregroundStyle(theme.inkTertiary)
                        }
                        .frame(minHeight: 30)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
            .padding(20)
        }
        .task { await loadJournal() }
    }

    private func kindWord(_ kind: MemoryJournalRow.Kind) -> LocalizedStringKey {
        switch kind {
        case .created: "created"
        case .edited: "edited"
        case .deleted: "deleted"
        }
    }

    private struct WeekBar { var id: String; var week: Date; var tier: String; var count: Int }

    private func weekly() -> [WeekBar] {
        let calendar = Calendar.current
        let start = calendar.date(byAdding: .weekOfYear, value: -25, to: Date()) ?? Date()
        var bars: [String: WeekBar] = [:]
        for entry in entries {
            guard let at = entry.row.updatedAt else { continue }
            let date = Date(timeIntervalSince1970: at / 1000)
            guard date >= start, let week = calendar.dateInterval(of: .weekOfYear, for: date)?.start else { continue }
            let key = "\(week.timeIntervalSince1970)|\(entry.source.name)"
            bars[key, default: WeekBar(id: key, week: week, tier: entry.source.kind == .bot ? String(localized: "My memory") : entry.source.name, count: 0)].count += 1
        }
        return bars.values.sorted { $0.week < $1.week }
    }

    private func writes() -> [(week: Date, count: Int)] {
        let calendar = Calendar.current
        let grouped = Dictionary(grouping: journal.compactMap { calendar.dateInterval(of: .weekOfYear, for: Date(timeIntervalSince1970: $0.row.at / 1000))?.start }, by: { $0 })
        return grouped.map { ($0.key, $0.value.count) }.sorted { $0.week < $1.week }
    }

    private func chart<Content: View>(title: Text, hint: Text?, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            title.font(theme.font(13, .semibold)).foregroundStyle(theme.ink)
            if let hint { hint.font(theme.font(12)).foregroundStyle(theme.inkSecondary) }
            content()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func loadJournal() async {
        guard let client = session.settingsClient else { return }
        var all: [(bot: String, row: MemoryJournalRow)] = []
        for source in Set(entries.compactMap { $0.source.kind == .bot ? $0.source : nil }) {
            guard let botId = source.botId, let rows = try? await client.memoryJournal(botId: botId, limit: 20) else { continue }
            all += rows.map { (source.name, $0) }
        }
        journal = all.sorted { $0.row.at > $1.row.at }
    }
}

/// A stat card (`StatCard`): the title, the big number, the caption.
struct DesktopStatCard: View {
    @Environment(\.desktopTheme) private var theme
    let title: Text
    let value: String
    let caption: Text?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            title.font(theme.font(12)).foregroundStyle(theme.inkSecondary)
            Text(verbatim: value).font(theme.font(22, .semibold)).foregroundStyle(theme.ink).monospacedDigit()
            caption?.font(theme.font(11.5)).foregroundStyle(theme.inkTertiary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
    }
}
