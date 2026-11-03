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
                Image(systemName: playing ? "pause.fill" : "play.fill").font(.system(size: 11)).foregroundStyle(theme.ink)
                    .frame(width: 32, height: 32).background(theme.raised, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(playing ? Text("Pause the timeline") : Text("Play the timeline"))
            .accessibilityIdentifier("desktop-memory-map.play")
            Slider(value: Binding(get: { Double(step) }, set: { playing = false; step = Int($0.rounded()) }), in: 0...Double(Self.steps))
                .tint(theme.accent)
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
            let base = MemoryBrain.fit(brain, width: geometry.size.width, height: geometry.size.height)
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
                        zoomButton("plus") { zoom = min(6, zoom * 1.25) }
                        zoomButton("minus") { zoom = max(0.3, zoom / 1.25) }
                        zoomButton("arrow.up.left.and.arrow.down.right") { zoom = 1; pan = .zero }
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

    private func radialMinimap(brain: MemoryBrain.Brain, tiers: [MapTier], s: Double, tx: Double, ty: Double, size: CGSize) -> some View {
        Canvas { context, mini in
            let fit = MemoryBrain.fit(brain, width: mini.width, height: mini.height, pad: 8)
            for node in brain.nodes {
                let colour = node.kind == .root ? theme.accent : (tiers.first { $0.id == node.scope }?.colour ?? theme.accent)
                context.fill(Path(ellipseIn: CGRect(x: node.x * fit.scale + fit.tx - 1, y: node.y * fit.scale + fit.ty - 1, width: 2, height: 2)), with: .color(colour.opacity(0.9)))
            }
            let x0 = (0 - tx) / s * fit.scale + fit.tx, y0 = (0 - ty) / s * fit.scale + fit.ty
            context.stroke(Path(CGRect(x: x0, y: y0, width: size.width / s * fit.scale, height: size.height / s * fit.scale)), with: .color(theme.accent), lineWidth: 1.5)
        }
        .frame(width: 96, height: 96)
        .background(theme.panel.opacity(0.9), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.6), lineWidth: 1))
        .accessibilityLabel(Text("Minimap"))
    }

    /// Columns (MemoryMapCanvas, Team map's look): the tier, its folders,
    /// the notes as cards, joined by lines, zoomed to fit.
    private func columns(tiers: [MapTier], hidden: Set<String>?) -> some View {
        let cardW = 150.0, cardH = 34.0, gap = 12.0, colGap = 70.0
        var cards: [(id: String, x: Double, y: Double, title: String, detail: String?, colour: Color, parent: String?)] = []
        var y = 0.0
        for tier in tiers where !tier.entries.isEmpty && (focus == "all" || focus == tier.id) {
            let groups = Dictionary(grouping: tier.entries.filter { !(hidden?.contains($0.id) ?? false) }, by: { tier.topic($0) })
            let keys = groups.keys.sorted()
            let tierY = y
            cards.append(("t:\(tier.id)", 0, tierY, tier.name, nil, tier.colour, nil))
            for key in keys {
                let notes = groups[key] ?? []
                cards.append(("f:\(tier.id):\(key)", cardW + colGap, y, key, nil, tier.colour, "t:\(tier.id)"))
                for (i, entry) in notes.enumerated() {
                    cards.append(("n:\(entry.id)", (cardW + colGap) * 2, y + Double(i) * (cardH + gap), entry.row.title, entry.row.excerpt, tier.colour, "f:\(tier.id):\(key)"))
                }
                y += Double(max(1, notes.count)) * (cardH + gap)
            }
            y += 24
        }
        let width = (cardW + colGap) * 2 + cardW, height = max(cardH, y)
        return GeometryReader { geometry in
            let base = min(1, min((geometry.size.width - 48) / width, (geometry.size.height - 48) / height))
            let s = max(0.2, base * zoom * pinch)
            let tx = (geometry.size.width - width * s) / 2 + pan.width + drag.width
            let ty = 24 + pan.height + drag.height
            ZStack(alignment: .bottomTrailing) {
                Canvas { context, _ in
                    let byId = Dictionary(uniqueKeysWithValues: cards.map { ($0.id, $0) })
                    for card in cards {
                        guard let parentId = card.parent, let parent = byId[parentId] else { continue }
                        var path = Path()
                        path.move(to: CGPoint(x: tx + (parent.x + cardW) * s, y: ty + (parent.y + cardH / 2) * s))
                        path.addLine(to: CGPoint(x: tx + card.x * s, y: ty + (card.y + cardH / 2) * s))
                        context.stroke(path, with: .color(theme.inkTertiary.opacity(0.35)), lineWidth: 1)
                    }
                    for card in cards {
                        let rect = CGRect(x: tx + card.x * s, y: ty + card.y * s, width: cardW * s, height: cardH * s)
                        let shape = RoundedRectangle(cornerRadius: 6 * s, style: .continuous).path(in: rect)
                        context.fill(shape, with: .color(theme.card))
                        context.stroke(shape, with: .color(theme.hairline.opacity(0.5)), lineWidth: 1)
                        context.fill(Path(ellipseIn: CGRect(x: rect.minX + 8 * s, y: rect.minY + 9 * s, width: 6 * s, height: 6 * s)), with: .color(card.colour))
                        context.draw(Text(verbatim: card.title).font(theme.font(max(6, 11 * s), .medium)).foregroundColor(theme.ink),
                                     at: CGPoint(x: rect.minX + 20 * s, y: rect.minY + 12 * s), anchor: .leading)
                        if let detail = card.detail, !detail.isEmpty {
                            context.draw(Text(verbatim: String(detail.prefix(28))).font(theme.font(max(5, 9 * s))).foregroundColor(theme.inkSecondary),
                                         at: CGPoint(x: rect.minX + 20 * s, y: rect.minY + 25 * s), anchor: .leading)
                        }
                    }
                }
                .gesture(SimultaneousGesture(
                    MagnificationGesture().onChanged { pinch = $0 }.onEnded { zoom = min(6, max(0.3, zoom * $0)); pinch = 1 },
                    DragGesture().onChanged { drag = $0.translation }.onEnded { pan.width += $0.translation.width; pan.height += $0.translation.height; drag = .zero }
                ))
                .simultaneousGesture(SpatialTapGesture().onEnded { value in
                    for card in cards where card.id.hasPrefix("n:") {
                        let rect = CGRect(x: tx + card.x * s, y: ty + card.y * s, width: cardW * s, height: cardH * s)
                        if rect.contains(value.location), let entry = entries.first(where: { "n:\($0.id)" == card.id }) { open(entry); return }
                    }
                })
                .accessibilityLabel(Text("Map of the memory"))
                HStack(spacing: 2) {
                    zoomButton("minus") { zoom = max(0.3, zoom / 1.25) }
                    Text(verbatim: "\(Int((s * 100).rounded())) %").font(theme.font(11.5)).foregroundStyle(theme.inkSecondary).frame(width: 48)
                    zoomButton("arrow.up.left.and.arrow.down.right") { zoom = 1; pan = .zero }
                    zoomButton("plus") { zoom = min(6, zoom * 1.25) }
                }
                .padding(4)
                .background(theme.panel, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
                .padding(12)
            }
        }
        .background(theme.panel.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
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
