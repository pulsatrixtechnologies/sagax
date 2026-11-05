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

    /// The preview of a note chosen on the map (the desktop opens it in the
    /// notes view on a double click).
    var preview: ((DesktopMemoryPage.Entry) -> Void)?
    /// The notes' excerpts the page read from their bodies (the cards' second line).
    var excerpts: [String: String] = [:]

    enum Layout: String, CaseIterable { case graph, brain, columns }

    @State private var query = ""
    @State private var focus = "all"
    @State private var layout: Layout = DesktopBrainMap.parityLayout
    @State private var tag = ""
    /// The timeline: 0...60, 60 is today.
    @State private var step = 60
    @State private var playing = false
    private static let steps = 60

    private static var parityLayout: Layout {
        #if DEBUG
        switch ParityLaunch.current?.iPadScreen {
        case .memoryMapRadial?: return .brain
        case .memoryMapColumns?: return .columns
        default: break
        }
        #endif
        return .graph
    }
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

    private func brain(_ tiers: [MapTier], hidden: Set<String>? = nil) -> MemoryBrain.Brain {
        let shown = focus == "all" ? tiers : tiers.filter { $0.id == focus }
        return MemoryBrain.build(tiers: shown.map { tier in
            MemoryBrain.Tier(scope: tier.id, name: tier.name, notes: tier.entries.filter { !(hidden?.contains($0.id) ?? false) }.map { entry in
                MemoryBrain.Note(id: entry.id, title: entry.row.title, topic: tier.topic(entry),
                                 tags: entry.row.tags ?? [], updated: entry.row.updatedAt)
            })
        }, rootLabel: String(localized: "All memory"), untitled: String(localized: "Untitled"))
    }

    private var shownEntries: [DesktopMemoryPage.Entry] {
        focus == "all" ? entries : (tiers.first { $0.id == focus }?.entries ?? [])
    }

    /// The notes the timeline's cursor has not reached yet.
    private var hidden: Set<String>? {
        guard step < Self.steps else { return nil }
        let dates = shownEntries.compactMap(\.row.updatedAt)
        let now = Date().timeIntervalSince1970 * 1000
        let start = dates.min() ?? now
        let cursor = start + (now - start) * Double(step) / Double(Self.steps)
        return Set(shownEntries.filter { ($0.row.updatedAt ?? 0) > cursor }.map(\.id))
    }

    private var cursorDate: Date {
        let dates = shownEntries.compactMap(\.row.updatedAt)
        let now = Date().timeIntervalSince1970 * 1000
        let start = dates.min() ?? now
        return Date(timeIntervalSince1970: (start + (now - start) * Double(step) / Double(Self.steps)) / 1000)
    }

    /// The search and the tag: the notes they keep lit; nil, nothing dimmed.
    private var matches: Set<String>? {
        let words = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !words.isEmpty || !tag.isEmpty else { return nil }
        return Set(shownEntries.filter { (words.isEmpty || $0.row.title.lowercased().contains(words)) && (tag.isEmpty || ($0.row.tags ?? []).contains(tag)) }.map(\.id))
    }

    private var graphNotes: [MemoryGraph.Note] {
        tiers.flatMap { tier in
            tier.entries.filter { _ in focus == "all" || tier.id == focus }.map { entry -> MemoryGraph.Note in
                let folder = tier.id == "mine" ? [entry.source.name, entry.row.folder].compactMap { $0 }.joined(separator: " / ") : (entry.row.folder ?? "")
                return MemoryGraph.Note(key: entry.id, title: entry.row.title, tier: tier.id, tierName: tier.name, folderPath: folder,
                                        tags: entry.row.tags ?? [], body: entry.row.excerpt, path: entry.row.path, createdAt: entry.row.updatedAt)
            }
        }
    }

    var body: some View {
        let tiers = self.tiers
        let hidden = self.hidden
        let brain = self.brain(tiers, hidden: hidden)
        let lit = MemoryBrain.spotlight(brain, query: query)
        let shown = shownEntries
        let tags = Array(Set(shown.flatMap { $0.row.tags ?? [] })).sorted()
        VStack(alignment: .leading, spacing: 12) {
            // the toolbar: Find on the map, a chip per tier, the layout, the count
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    DesktopIconView(icon: .search, size: 14).foregroundStyle(theme.inkSecondary)
                    TextField(text: $query, prompt: Text("Find on the map").foregroundColor(theme.inkTertiary)) { Text("Find on the map") }
                        .font(theme.font(13))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                .padding(.horizontal, 12)
                .frame(width: 240, height: 32)
                .background(theme.panel, in: Capsule())
                .overlay(Capsule().strokeBorder(theme.hairline.opacity(0.6), lineWidth: 1))
                chip(id: "all", label: Text("All memory"), colour: nil, count: nil)
                ForEach(tiers) { tier in
                    chip(id: tier.id, label: Text(verbatim: tier.name), colour: tier.colour, count: tier.entries.count)
                }
                layoutSwitch
                Spacer(minLength: 0)
            }
            HStack {
                Spacer()
                Text(countLine(brain: brain, shown: shown)).font(theme.font(12.5)).foregroundStyle(theme.inkSecondary).monospacedDigit()
            }
            Group {
                switch layout {
                case .graph:
                    if shown.isEmpty {
                        empty
                    } else {
                        DesktopMemoryGraph(notes: graphNotes, tierColor: { id in tiers.first { $0.id == id }?.colour ?? theme.accent },
                                           matches: matches, hidden: hidden,
                                           onPreview: { key in if let entry = entries.first(where: { $0.id == key }) { (preview ?? open)(entry) } },
                                           onOpen: { key in if let entry = entries.first(where: { $0.id == key }) { open(entry) } },
                                           onAnimate: { step = 0; playing = true },
                                           overlay: tags.isEmpty ? nil : AnyView(tagMenu(tags)))
                    }
                case .brain: radial(brain: brain, lit: lit, tiers: tiers, tags: tags)
                case .columns: columns(tiers: tiers, hidden: hidden)
                }
            }
            .frame(minHeight: 420)
            if !shown.isEmpty { timeline(brain: brain, shown: shown, hidden: hidden) }
            Text("Drag to move, scroll or pinch to zoom, press a note to open it.").font(theme.font(12)).foregroundStyle(theme.inkTertiary)
        }
        .padding(16)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-memory-map")
        .task(id: playing) {
            guard playing else { return }
            while playing, step < Self.steps {
                try? await Task.sleep(nanoseconds: 80_000_000)
                step += 1
            }
            playing = false
        }
    }

    private func countLine(brain: MemoryBrain.Brain, shown: [DesktopMemoryPage.Entry]) -> String {
        if let matches { return String(localized: "\(String(matches.count)) notes found") }
        return String(localized: "\(String(layout == .brain ? brain.notes : shown.count)) notes, \(String(0)) links")
    }

    private var empty: some View {
        Text("No note on the map yet. Write the first one.").font(theme.font(13)).foregroundStyle(theme.inkSecondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(theme.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    /// MiniSegment: Graph, Radial, Columns.
    private var layoutSwitch: some View {
        HStack(spacing: 2) {
            ForEach(Layout.allCases, id: \.self) { option in
                Button { layout = option } label: {
                    Text(layoutLabel(option)).font(theme.font(12, layout == option ? .medium : .regular))
                        .foregroundStyle(layout == option ? theme.ink : theme.inkSecondary)
                        .padding(.horizontal, 10).frame(height: 26)
                        .background(layout == option ? theme.raised : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(layout == option ? .isSelected : [])
                .accessibilityIdentifier("desktop-memory-map.layout.\(option.rawValue)")
            }
        }
        .padding(2)
        .accessibilityLabel(Text("Map layout"))
    }

    private func layoutLabel(_ layout: Layout) -> LocalizedStringKey {
        switch layout {
        case .graph: "Graph"
        case .brain: "Radial"
        case .columns: "Columns"
        }
    }

    private func tagMenu(_ tags: [String]) -> some View {
        Menu {
            Button { tag = "" } label: { Text("All tags") }
            ForEach(tags, id: \.self) { value in Button { tag = value } label: { Text(verbatim: value) } }
        } label: {
            HStack(spacing: 6) {
                Text(tag.isEmpty ? String(localized: "All tags") : tag).font(theme.font(12.5)).foregroundStyle(theme.ink)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 9)).foregroundStyle(theme.inkTertiary)
            }
            .padding(.horizontal, 10).frame(height: 32)
            .background(theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.6), lineWidth: 1))
        }
        .accessibilityLabel(Text("Tag on the map"))
    }

    /// The timeline under the map: play, the slider, "Today · n notes".
    private func timeline(brain: MemoryBrain.Brain, shown: [DesktopMemoryPage.Entry], hidden: Set<String>?) -> some View {
        let visible = shown.count - (hidden?.count ?? 0)
        let when = step >= Self.steps ? String(localized: "Today") : cursorDate.formatted(date: .abbreviated, time: .omitted)
        return HStack(spacing: 12) {
            Button {
                if !playing, step >= Self.steps { step = 0 }
                playing.toggle()
            } label: {
                DesktopIconView(icon: playing ? .pause : .play, size: 14).foregroundStyle(theme.ink)
                    .frame(width: 32, height: 32).background(theme.raised, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(playing ? Text("Pause the timeline") : Text("Play the timeline"))
            .accessibilityIdentifier("desktop-memory-map.play")
            DesktopRangeSlider(value: Binding(get: { Double(step) }, set: { playing = false; step = Int($0.rounded()) }), range: 0...Double(Self.steps))
                .accessibilityLabel(Text("Timeline"))
            Text("\(when) · \(String(layout == .brain ? brain.notes : visible)) notes").font(theme.font(12.5)).foregroundStyle(theme.inkSecondary).monospacedDigit()
                .fixedSize()
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(theme.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
    }

    /// Radial: the console's brain (BrainMap.tsx).
    private func radial(brain: MemoryBrain.Brain, lit: Set<Int>?, tiers: [MapTier], tags: [String]) -> some View {
        GeometryReader { geometry in
            // BrainMap.tsx `fitView`: `brainBounds` (the outer ring and 120), pad 24, 0.04 to 2.2
            let bound = (brain.rings.last ?? 0) + 120
            let fitScale = max(0.04, min(2.2, min((geometry.size.width - 48) / (bound * 2), (geometry.size.height - 48) / (bound * 2))))
            let base = (scale: fitScale, tx: geometry.size.width / 2, ty: geometry.size.height / 2)
            let s = base.scale * zoom * pinch
            let tx = base.tx + pan.width + drag.width
            let ty = base.ty + pan.height + drag.height
            ZStack(alignment: .topLeading) {
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
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                if !tags.isEmpty { tagMenu(tags).padding(8) }
                HStack(alignment: .bottom, spacing: 8) {
                    radialMinimap(brain: brain, tiers: tiers, s: s, tx: tx, ty: ty, size: geometry.size)
                    VStack(spacing: 4) {
                        zoomButton(.plus) { zoom = min(6, zoom * 1.25) }
                        zoomButton(.minus) { zoom = max(0.3, zoom / 1.25) }
                        zoomButton(.maximize2) { zoom = 1; pan = .zero }
                    }
                }
                .padding(8)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
            }
        }
        .background(theme.panel.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
    }

    /// The minimap (132 pt, bottom-2 right-[52px]): every node as a dot in
    /// its tier's colour, and where the screen is, in the ink at 0.8.
    private func radialMinimap(brain: MemoryBrain.Brain, tiers: [MapTier], s: Double, tx: Double, ty: Double, size: CGSize) -> some View {
        Canvas { context, mini in
            // `brainBounds`: the outer ring and 120 around it
            let bound = (brain.rings.last ?? 0) + 120
            let ms = min(mini.width, mini.height) / (bound * 2)
            let cx = mini.width / 2, cy = mini.height / 2
            for node in brain.nodes {
                let colour = node.kind == .root ? theme.accent : (tiers.first { $0.id == node.scope }?.colour ?? theme.accent)
                let r = node.kind == .root ? 3.0 : node.kind == .note ? 0.9 : 1.8
                let stale = node.age >= MemoryBrain.staleDays && node.kind == .note
                context.fill(Path(ellipseIn: CGRect(x: cx + node.x * ms - r, y: cy + node.y * ms - r, width: r * 2, height: r * 2)),
                             with: .color(colour.opacity(stale ? 0.35 : 0.9)))
            }
            // the screen's rectangle in the world
            let wx0 = (0 - tx) / s, wy0 = (0 - ty) / s
            let frame = CGRect(x: cx + wx0 * ms, y: cy + wy0 * ms, width: size.width / s * ms, height: size.height / s * ms)
            context.stroke(Path(frame), with: .color(theme.ink.opacity(0.8)), lineWidth: 1.5)
        }
        .frame(width: 132, height: 132)
        .background(theme.panel.opacity(0.9), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.6), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityLabel(Text("Minimap"))
        .accessibilityIdentifier("desktop-memory-map.minimap")
    }

    private struct ColumnCard {
        enum Kind { case source, folder, note }
        var id: String
        var kind: Kind
        var x: Double
        var y: Double
        var title: String
        var detail: String?
        var colour: Color
        var parent: String?
    }

    /// `notesPerRow` (lib/memory-map.ts).
    private static func notesPerRow(_ count: Int) -> Int { count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4 }

    /// Columns (MemoryMapCanvas.tsx, lib/memory-map.ts `layoutMemoryMapNodes`):
    /// each tier a source card, its folders in their order, the notes in a
    /// grid per folder; 168 x 56 cards, GAP 16, clusters 40 apart, columns
    /// 56 apart, tiers 120 apart; fitted (pad 48, 35 to 120 %).
    private func columns(tiers: [MapTier], hidden: Set<String>?) -> some View {
        let cardW = 168.0, cardH = 56.0, gap = 16.0, clusterGap = 40.0, colGap = 56.0, origin = 40.0, groupGap = 120.0
        var cards: [ColumnCard] = []
        var offsetX = 0.0
        for tier in tiers where !tier.entries.isEmpty && (focus == "all" || focus == tier.id) {
            let shown = tier.entries.filter { !(hidden?.contains($0.id) ?? false) }
            var keys: [String] = []
            for entry in shown where !keys.contains(tier.topic(entry)) { keys.append(tier.topic(entry)) }
            let sourceId = "t:\(tier.id)"
            cards.append(ColumnCard(id: sourceId, kind: .source, x: offsetX + origin, y: origin, title: tier.name, detail: nil, colour: tier.colour, parent: nil))
            var clusterY = origin
            var maxX = offsetX + origin + cardW
            for key in keys {
                let notes = shown.filter { tier.topic($0) == key }
                let folderX = offsetX + origin + cardW + colGap
                let folderId = "f:\(tier.id):\(key)"
                cards.append(ColumnCard(id: folderId, kind: .folder, x: folderX, y: clusterY, title: key, detail: "\(notes.count)", colour: tier.colour, parent: sourceId))
                let notesX = folderX + cardW + colGap
                let perRow = Self.notesPerRow(notes.count)
                var bottom = clusterY + cardH
                for (index, entry) in notes.enumerated() {
                    let x = notesX + Double(index % perRow) * (cardW + gap)
                    let y = clusterY + Double(index / perRow) * (cardH + gap)
                    cards.append(ColumnCard(id: "n:\(entry.id)", kind: .note, x: x, y: y, title: entry.row.title, detail: excerpts[entry.id] ?? entry.row.excerpt, colour: tier.colour, parent: folderId))
                    bottom = max(bottom, y + cardH)
                    maxX = max(maxX, x + cardW)
                }
                clusterY = bottom + clusterGap
            }
            offsetX = maxX + groupGap
        }
        let minX = cards.map(\.x).min() ?? 0, minY = cards.map(\.y).min() ?? 0
        let maxX = (cards.map(\.x).max() ?? 0) + cardW, maxY = (cards.map(\.y).max() ?? 0) + cardH
        return GeometryReader { geometry in
            let pad = 48.0
            let base = min(1.2, max(0.35, min((geometry.size.width - pad * 2) / max(1, maxX - minX), (geometry.size.height - pad * 2) / max(1, maxY - minY))))
            let s = min(2.4, max(0.35, base * zoom * pinch))
            let tx = (geometry.size.width - (minX + maxX) * s) / 2 + pan.width + drag.width
            let ty = (geometry.size.height - (minY + maxY) * s) / 2 + pan.height + drag.height
            ZStack(alignment: .bottom) {
                Canvas { context, _ in
                    let byId = Dictionary(uniqueKeysWithValues: cards.map { ($0.id, $0) })
                    for card in cards {
                        guard let parentId = card.parent, let parent = byId[parentId] else { continue }
                        var path = Path()
                        path.move(to: CGPoint(x: tx + (parent.x + cardW) * s, y: ty + (parent.y + cardH / 2) * s))
                        path.addLine(to: CGPoint(x: tx + card.x * s, y: ty + (card.y + cardH / 2) * s))
                        context.stroke(path, with: .color(theme.hairline), lineWidth: 1)
                    }
                    for card in cards {
                        let rect = CGRect(x: tx + card.x * s, y: ty + card.y * s, width: cardW * s, height: cardH * s)
                        let shape = RoundedRectangle(cornerRadius: 12 * s, style: .continuous).path(in: rect)
                        context.fill(shape, with: .color(card.kind == .note ? theme.card : theme.raised.opacity(0.8)))
                        context.stroke(shape, with: .color(theme.hairline.opacity(card.kind == .note ? 0.5 : 0.4)), lineWidth: 1)
                        let leadX = rect.minX + 12 * s
                        if card.kind == .note {
                            context.fill(Path(ellipseIn: CGRect(x: leadX, y: rect.midY - 4 * s, width: 8 * s, height: 8 * s)), with: .color(card.colour))
                        } else {
                            var icon = context
                            icon.translateBy(x: leadX, y: rect.midY - 7 * s)
                            icon.scaleBy(x: 14 * s / 24, y: 14 * s / 24)
                            for d in (card.kind == .source ? DesktopIcon.brain : DesktopIcon.folder).paths {
                                icon.stroke(Path(SVGPath.cached(d)), with: .color(theme.inkSecondary), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                            }
                        }
                        let textX = leadX + (card.kind == .note ? 16 : 22) * s
                        let hasDetail = !(card.detail ?? "").isEmpty
                        let title = Text(verbatim: card.title).font(theme.font(12.5 * s, .medium)).foregroundColor(theme.ink)
                        context.draw(title, in: CGRect(x: textX, y: rect.midY - (hasDetail ? 15 : 8) * s, width: rect.maxX - 12 * s - textX, height: 17 * s))
                        if let detail = card.detail, !detail.isEmpty {
                            let line = Text(verbatim: detail).font(theme.font(10.5 * s)).foregroundColor(theme.inkSecondary)
                            context.draw(line, in: CGRect(x: textX, y: rect.midY + 2 * s, width: rect.maxX - 12 * s - textX, height: 14 * s))
                        }
                    }
                }
                .gesture(SimultaneousGesture(
                    MagnificationGesture().onChanged { pinch = $0 }.onEnded { zoom = min(6, max(0.3, zoom * $0)); pinch = 1 },
                    DragGesture().onChanged { drag = $0.translation }.onEnded { pan.width += $0.translation.width; pan.height += $0.translation.height; drag = .zero }
                ))
                .simultaneousGesture(SpatialTapGesture().onEnded { value in
                    for card in cards where card.kind == .note {
                        let rect = CGRect(x: tx + card.x * s, y: ty + card.y * s, width: cardW * s, height: cardH * s)
                        if rect.contains(value.location), let entry = entries.first(where: { "n:\($0.id)" == card.id }) { open(entry); return }
                    }
                })
                .accessibilityLabel(Text("Map of the memory"))
                HStack(alignment: .bottom, spacing: 12) {
                    columnsMinimap(cards: cards, cardW: cardW, cardH: cardH, bounds: CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY),
                                   s: s, tx: tx, ty: ty, size: geometry.size)
                    Spacer(minLength: 0)
                    HStack(spacing: 2) {
                        columnsZoomButton(.minus, 15) { zoom = max(0.3, zoom / 1.2) }
                        Button { zoom = 1; pan = .zero } label: {
                            Text(verbatim: "\(Int((s * 100).rounded()))%").font(theme.font(11)).monospacedDigit().foregroundStyle(theme.inkSecondary)
                                .frame(minWidth: 48, minHeight: 34)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("Fit"))
                        .accessibilityIdentifier("desktop-memory-map.zoom")
                        columnsZoomButton(.maximize2, 14) { zoom = 1; pan = .zero }
                        columnsZoomButton(.plus, 15) { zoom = min(6, zoom * 1.2) }
                    }
                    .padding(4)
                    .background(theme.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.6), lineWidth: 1))
                    .shadow(color: .black.opacity(0.08), radius: 1, y: 1)
                }
                .padding(20)
            }
        }
        .background(theme.panel.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
    }

    private func columnsZoomButton(_ icon: DesktopIcon, _ size: CGFloat, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            DesktopIconView(icon: icon, size: size).foregroundStyle(theme.inkSecondary).frame(width: 36, height: 36).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
    }

    /// The console's minimap (168 x 104 at most, the map's proportions):
    /// every card in small, the screen as an accent frame.
    private func columnsMinimap(cards: [ColumnCard], cardW: Double, cardH: Double, bounds: CGRect, s: Double, tx: Double, ty: Double, size: CGSize) -> some View {
        let pad = 40.0
        let world = bounds.insetBy(dx: -pad, dy: -pad)
        let fit = min(168 / world.width, 104 / world.height)
        let boxW = max(48, world.width * fit), boxH = max(32, world.height * fit)
        return Canvas { context, box in
            let scale = min(box.width / world.width, box.height / world.height)
            let ox = (box.width - world.width * scale) / 2, oy = (box.height - world.height * scale) / 2
            func map(_ r: CGRect) -> CGRect {
                CGRect(x: ox + (r.minX - world.minX) * scale, y: oy + (r.minY - world.minY) * scale, width: r.width * scale, height: r.height * scale)
            }
            for card in cards {
                let rect = map(CGRect(x: card.x, y: card.y, width: cardW, height: cardH))
                context.fill(Path(roundedRect: rect, cornerRadius: 8 * scale), with: .color(card.kind == .note ? theme.inkTertiary.opacity(0.5) : theme.inkSecondary))
            }
            let screen = map(CGRect(x: -tx / s, y: -ty / s, width: size.width / s, height: size.height / s))
            context.fill(Path(screen), with: .color(theme.accent.opacity(0.1)))
            context.stroke(Path(screen), with: .color(theme.accent), lineWidth: 1.5)
        }
        .frame(width: boxW, height: boxH)
        .background(theme.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.6), lineWidth: 1))
        .accessibilityLabel(Text("Minimap"))
        .accessibilityIdentifier("desktop-memory-map.columns-minimap")
    }

    private func chip(id: String, label: Text, colour: Color?, count: Int?) -> some View {
        let on = focus == id
        return Button { focus = focus == id && id != "all" ? "all" : id; zoom = 1; pan = .zero } label: {
            HStack(spacing: 6) {
                if let colour { Circle().fill(colour).frame(width: 7, height: 7) }
                label.font(theme.font(12.5)).foregroundStyle(on ? theme.ink : theme.inkSecondary)
                if let count { Text(verbatim: "\(count)").font(theme.font(11.5)).foregroundStyle(theme.inkTertiary) }
            }
            .padding(.horizontal, 12).frame(height: 32)
            .fixedSize()
            .background(on ? theme.raised : Color.clear, in: Capsule())
            .overlay(Capsule().strokeBorder(on ? theme.accent.opacity(0.6) : theme.hairline.opacity(0.6), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
    }

    /// BrainMap.tsx's `button`: a 32 pt circle, hairline/60, the panel, a 16 pt icon.
    private func zoomButton(_ icon: DesktopIcon, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            DesktopIconView(icon: icon, size: 16).foregroundStyle(theme.inkSecondary).frame(width: 32, height: 32)
                .background(theme.panel, in: Circle())
                .overlay(Circle().strokeBorder(theme.hairline.opacity(0.6), lineWidth: 1))
                .shadow(color: .black.opacity(0.08), radius: 1, y: 1)
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
        // nodes: a ring in the card's colour around a branch (BrainMap.tsx)
        for (index, node) in brain.nodes.enumerated() {
            let p = point(node)
            let r = MemoryBrain.nodeSize(node, scale: s)
            let dim = lit.map { !$0.contains(index) } ?? false
            let fill = node.kind == .root ? theme.accent : colour(node)
            // the glow: the root most, then recent notes and branches
            let glow = node.kind == .root ? 1 : node.kind == .note ? node.recency * 0.8 : 0.35 + 0.5 * node.recency
            if glow > 0.05, !dim {
                let g = r * (node.kind == .root ? 5 : 4.2) / 2
                context.fill(Path(ellipseIn: CGRect(x: p.x - g, y: p.y - g, width: g * 2, height: g * 2)),
                             with: .radialGradient(Gradient(colors: [fill.opacity(0.55 * glow), fill.opacity(0)]), center: p, startRadius: 0, endRadius: g))
            }
            let circle = Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2))
            context.fill(circle, with: .color(fill.opacity(dim ? 0.15 : (node.age >= MemoryBrain.staleDays && node.kind == .note ? 0.5 : 1))))
            if node.kind != .note {
                context.stroke(circle, with: .color(theme.card.opacity(dim ? 0.3 : 1)), lineWidth: node.kind == .root ? 2.5 : 1.5)
            }
        }
        // labels (`planLabels`): a leaf's along its ray, flipped on the left
        // half; a branch's in a capsule beside it, toward the outside, the
        // root's under it; a leaf is named once two leaves are 11 pt apart
        let outer = brain.rings.last ?? 0
        let leafGap = (2 * Double.pi * outer) / Double(max(1, brain.notes)) * 0.84 * s
        var placed: [CGRect] = []
        for (index, node) in brain.nodes.enumerated() {
            let dim = lit.map { !$0.contains(index) } ?? false
            guard !dim else { continue }
            let p = point(node)
            let r = MemoryBrain.nodeSize(node, scale: s)
            if node.kind == .note {
                guard leafGap >= 11 || (lit?.contains(index) ?? false) else { continue }
                let label = node.label.count > 34 ? String(node.label.prefix(33)) + "…" : node.label
                let left = cos(node.angle) < 0
                let angle = left ? node.angle + .pi : node.angle
                let start = CGPoint(x: p.x + cos(node.angle) * (r + 5), y: p.y + sin(node.angle) * (r + 5))
                var layer = context
                layer.translateBy(x: start.x, y: start.y)
                layer.rotate(by: .radians(angle))
                let text = layer.resolve(Text(verbatim: label).font(theme.font(11, .medium)).foregroundColor(theme.inkSecondary))
                layer.draw(text, at: .zero, anchor: left ? .trailing : .leading)
            } else {
                let size: CGFloat = node.kind == .root ? 14 : node.kind == .tier ? 13 : 12
                let label = node.label.count > (node.kind == .topic ? 28 : 36) ? String(node.label.prefix(node.kind == .topic ? 27 : 35)) + "…" : node.label
                let text = context.resolve(Text(verbatim: label).font(theme.font(size, node.kind == .topic ? .medium : .semibold)).foregroundColor(theme.ink))
                let w = text.measure(in: CGSize(width: 400, height: 40)).width + 12
                let h = size + 8
                let centre: CGPoint = node.kind == .root
                    ? CGPoint(x: p.x, y: p.y + r + 6 + h / 2)
                    : CGPoint(x: p.x + cos(node.angle) * (r + 4 + w / 2) * 0.9, y: p.y + sin(node.angle) * (r + 4 + h / 2))
                let box = CGRect(x: centre.x - w / 2, y: centre.y - h / 2, width: w, height: h)
                if placed.contains(where: { $0.intersects(box.insetBy(dx: 2, dy: 2)) }) { continue }
                placed.append(box)
                // the root's and a tier's in a bordered capsule; a topic's is the
                // map's own colour (the desktop's card, which is its ground)
                if node.kind != .topic {
                    let capsule = Path(roundedRect: box, cornerRadius: h / 2)
                    context.fill(capsule, with: .color(theme.card.opacity(0.92)))
                    context.stroke(capsule, with: .color((node.kind == .root ? theme.accent : colour(node)).opacity(0.6)), lineWidth: 1)
                }
                context.draw(text, at: CGPoint(x: centre.x, y: centre.y + 0.5), anchor: .center)
            }
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
                // MemoryTagsView.tsx: h2 20 semibold, the line 13 (mt-1)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Tags").font(theme.font(20, .semibold)).foregroundStyle(theme.ink)
                    Text("The tags your notes carry, the most used, and those to tidy up.").font(theme.font(13)).foregroundStyle(theme.inkSecondary)
                }
                // No Perspicax tag namespaces here: the desktop's layout
                // without them, the Free tags card then two cards side by side.
                DesktopStatCard(title: Text("Free tags"), value: "\(free.count)", caption: Text("Outside every namespace"))
                HStack(alignment: .top, spacing: 16) {
                    section(Text("Free tags"), hint: Text("Tags outside every namespace, with their notes")) {
                        if free.isEmpty { Text("No free tag.").font(theme.font(13)).foregroundStyle(theme.inkSecondary).frame(height: 19.5) }
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
                            Text("No tag on any note yet.").font(theme.font(13)).foregroundStyle(theme.inkSecondary).frame(height: 19.5)
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
            .padding(24)
        }
    }

    /// `MemoryCard`: the title 14 semibold and its aside 12.5 (pt-4 pb-2),
    /// the body px-4 pb-4, a hairline/50 border on the panel.
    private func section<Content: View>(_ title: Text, hint: Text?, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                title.font(theme.font(14, .semibold)).foregroundStyle(theme.ink).frame(height: 20)
                Spacer(minLength: 8)
                hint?.font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
            }
            .padding(.top, 16).padding(.bottom, 8)
            content()
                .padding(.bottom, 16)
        }
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
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
                // MemoryQualityView.tsx: h2 20 semibold, the line 13 under it (mt-1)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Quality").font(theme.font(20, .semibold)).foregroundStyle(theme.ink)
                    Text("How the memory holds up: its size, its age, its doubles, its writes.").font(theme.font(13)).foregroundStyle(theme.inkSecondary)
                }
                // Health | Journal (the desktop's segmented pair)
                HStack(spacing: 2) {
                    segment(.health, Text("Health"))
                    segment(.journal, Text("Journal"))
                }
                .padding(2)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
                if view == .health {
                    // the grid's row: every tile as tall as the tallest, top aligned
                    HStack(alignment: .top, spacing: 12) {
                        DesktopStatCard(title: Text("Active notes"), value: "\(entries.count)", caption: nil)
                        DesktopStatCard(title: Text("In review"), value: "0", caption: Text("Proposals waiting"))
                        DesktopStatCard(title: Text("Aging"), value: "\(aging)", caption: Text("No change in \(String(Int(Self.agingDays))) days"))
                        DesktopStatCard(title: Text("Duplicates"), value: "\(duplicates)", caption: Text("Same title in one tier"))
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    HStack(alignment: .top, spacing: 16) {
                        let weeks = weekly()
                        chart(title: Text("Active notes per tier, 26 weeks"), hint: weeks.isEmpty ? nil : Text("Today's notes by the week they were written.")) {
                            if weeks.isEmpty {
                                Text("Nothing to chart yet.").font(theme.font(13)).foregroundStyle(theme.inkSecondary).frame(height: 19.5)
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
                                Text("Nothing to chart yet.").font(theme.font(13)).foregroundStyle(theme.inkSecondary).frame(height: 19.5)
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
            .padding(24)
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

    /// `MemoryCard`: rounded-xl, a hairline/50 border, the panel; the title
    /// 14 semibold (pt-4, pb-2), the body px-4 pb-4.
    private func chart<Content: View>(title: Text, hint: Text?, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            title.font(theme.font(14, .semibold)).foregroundStyle(theme.ink).frame(height: 20)
                .padding(.top, 16).padding(.bottom, 8)
            VStack(alignment: .leading, spacing: 4) {
                content()
                if let hint { hint.font(theme.font(11.5)).foregroundStyle(theme.inkTertiary) }
            }
            .padding(.bottom, 16)
        }
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
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
        // StatGrid's tile: px-4 py-3, 12 label, 22/28 semibold, 11.5 caption (mt-0.5)
        VStack(alignment: .leading, spacing: 0) {
            title.font(theme.font(12)).foregroundStyle(theme.inkSecondary).lineLimit(1).frame(height: 16)
            Text(verbatim: value).font(theme.font(22, .semibold)).foregroundStyle(theme.ink).monospacedDigit()
                .frame(height: 28).padding(.top, 4)
            caption?.font(theme.font(11.5)).foregroundStyle(theme.inkTertiary).lineLimit(1).frame(height: 16).padding(.top, 2)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(theme.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
    }
}


/// `<input type="range">` with `accent-color` as Chromium draws it: a 4 pt
/// track, its filled part in the accent, a 16 pt accent knob.
struct DesktopRangeSlider: View {
    @Environment(\.desktopTheme) private var theme
    @Binding var value: Double
    let range: ClosedRange<Double>
    var step: Double = 1

    var body: some View {
        GeometryReader { proxy in
            let knob: CGFloat = 16
            let span = max(1, proxy.size.width - knob)
            let fraction = (value - range.lowerBound) / max(1, range.upperBound - range.lowerBound)
            let x = CGFloat(fraction) * span
            ZStack(alignment: .leading) {
                Capsule().fill(theme.ink.opacity(0.25)).frame(height: 4).padding(.horizontal, knob / 2)
                Capsule().fill(theme.accent).frame(width: x, height: 4).padding(.leading, knob / 2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Circle().fill(theme.accent).frame(width: knob, height: knob).offset(x: x)
            }
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { drag in
                let f = min(1, max(0, (drag.location.x - knob / 2) / span))
                let raw = range.lowerBound + Double(f) * (range.upperBound - range.lowerBound)
                value = (raw / step).rounded() * step
            })
        }
        .frame(height: 20)
        .accessibilityElement()
        .accessibilityValue(Text(verbatim: "\(Int(value))"))
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: value = min(range.upperBound, value + step)
            case .decrement: value = max(range.lowerBound, value - step)
            @unknown default: break
            }
        }
    }
}
