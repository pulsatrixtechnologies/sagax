// iPad lot 5b (2026-11-03): Memory > Map > Graph, the desktop's
// Obsidian-like graph (MemoryGraph.tsx) over CompanionCore's MemoryGraph:
// the force layout settling frame by frame, thin grey links, round nodes in
// the tier's colour, labels fading in with the zoom, a tap lighting a note
// and its neighbours (the desktop's hover) and previewing it, a double tap
// opening it, a node dragged pinned, pinch and drag to move, the minimap,
// zoom in, out and fit, and the settings panel (Filters, Groups, Display,
// Forces) kept per person like the desktop's `sagax.memoryGraph.v1`.
import SwiftUI
import UIKit
import CompanionCore

@MainActor
final class MemoryGraphEngine: ObservableObject {
    @Published private(set) var frame = 0
    @Published var settings: MemoryGraph.Settings {
        didSet { if settings != oldValue { save() } }
    }
    private(set) var model = MemoryGraph.build([], filters: MemoryGraph.Filters())
    private(set) var sim = MemoryGraph.Simulation(links: [], n: 0)
    var view = MemoryGraph.View(s: 1, tx: 0, ty: 0)
    var size: CGSize = .zero
    var autoFit = true
    var selected = -1
    private var notesKey = ""

    private static let key = "sagax.memoryGraph.v1"

    init() {
        if let data = UserDefaults.standard.data(forKey: Self.key),
           let read = try? JSONDecoder().decode(MemoryGraph.Settings.self, from: data) {
            settings = read.cleaned()
        } else {
            settings = MemoryGraph.Settings()
        }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(settings.cleaned()) { UserDefaults.standard.set(data, forKey: Self.key) }
    }

    /// The model rebuilt when the notes or the filters change; the nodes
    /// already placed keep their place.
    func update(notes: [MemoryGraph.Note], focusKey: String?, depth: Int) {
        let key = notes.map { "\($0.key)|\($0.title)|\($0.tags.joined(separator: ","))" }.joined(separator: ";")
            + "#\(settings.filters.search)|\(settings.filters.tags)|\(settings.filters.attachments)|\(settings.filters.existingOnly)|\(settings.filters.orphans)|\(settings.filters.folders)#\(focusKey ?? "")|\(depth)"
        guard key != notesKey else { return }
        notesKey = key
        var next = MemoryGraph.build(notes, filters: settings.filters)
        if let focusKey, depth > 0, let at = next.index["n:\(focusKey)"] {
            let near = MemoryGraph.withinDepth(next, at, depth)
            let keys = Set(near.compactMap { next.nodes[$0].key })
            next = MemoryGraph.build(notes.filter { keys.contains($0.key) }, filters: settings.filters)
        }
        var known: [String: (Double, Double)] = [:]
        for (i, node) in model.nodes.enumerated() where i < sim.n { known[node.id] = (sim.x[i], sim.y[i]) }
        let built = next
        sim = MemoryGraph.Simulation(links: built.links, n: built.nodes.count, seed: 1, forces: settings.forces) { i in
            if let hit = known[built.nodes[i].id] { return (hit.0, hit.1) }
            for neighbour in built.adjacency[i] {
                if let at = known[built.nodes[neighbour].id] {
                    let a = Double(MemoryGraph.stableIndex(built.nodes[i].id, 360)) / 360 * .pi * 2
                    return (at.0 + cos(a) * 12, at.1 + sin(a) * 12)
                }
            }
            return nil
        }
        if !known.isEmpty { sim.alpha = 0.3 }
        model = built
        selected = -1
        autoFit = true
        frame += 1
    }

    func applyForces() {
        guard sim.forces != settings.forces else { return }
        sim.forces = settings.forces
        sim.reheat(0.5)
    }

    /// One animation frame: a few ticks while it moves, the view following
    /// the whole graph until the person moves it.
    func step() {
        guard !sim.settled() else { return }
        let start = Date()
        var n = 0
        repeat { sim.tick(); n += 1 } while n < 3 && Date().timeIntervalSince(start) < 0.006 && !sim.settled()
        if autoFit { fit(animated: false) }
        frame += 1
    }

    var settled: Bool { sim.settled() }

    func fit(animated: Bool = true) {
        guard size.width > 0 else { return }
        view = MemoryGraph.fit(MemoryGraph.bounds(sim), width: size.width, height: size.height)
        frame += 1
    }

    func radius(_ i: Int) -> Double {
        MemoryGraph.nodeRadius(degree: model.nodes[i].degree, kind: model.nodes[i].kind, size: settings.display.nodeSize)
    }

    func node(at point: CGPoint, visible: [Bool]) -> Int {
        MemoryGraph.nodeAt(sim, radius: radius, view: view, x: point.x, y: point.y, slack: 8, visible: { visible.indices.contains($0) ? visible[$0] : true })
    }

    func zoom(by factor: Double, at point: CGPoint? = nil) {
        let p = point ?? CGPoint(x: size.width / 2, y: size.height / 2)
        view = MemoryGraph.zoom(view, around: p.x, p.y, by: factor)
        autoFit = false
        frame += 1
    }

    func pan(_ delta: CGSize) {
        view.tx += delta.width
        view.ty += delta.height
        autoFit = false
        frame += 1
    }

    func world(_ point: CGPoint) -> (Double, Double) {
        ((point.x - view.tx) / view.s, (point.y - view.ty) / view.s)
    }

    func touch() { frame += 1 }
}

struct DesktopMemoryGraph: View {
    @Environment(\.desktopTheme) private var theme
    let notes: [MemoryGraph.Note]
    let tierColor: (String) -> Color
    /// The search's matches (note keys); nil: nothing dimmed.
    let matches: Set<String>?
    /// The timeline: the notes not written yet at its cursor.
    let hidden: Set<String>?
    var focusKey: String?
    var depth = 0
    let onPreview: (String) -> Void
    let onOpen: (String) -> Void
    let onAnimate: () -> Void
    var overlay: AnyView?

    @StateObject private var engine = MemoryGraphEngine()
    @State private var lastDrag: CGSize = .zero
    @State private var dragNode = -1
    @State private var pinchBase: Double = 1

    var body: some View {
        let _ = engine.frame
        let visible = visibleNodes
        let lit = litNodes
        let colours = nodeColours
        GeometryReader { geometry in
            ZStack(alignment: .topLeading) {
                Canvas { context, size in
                    draw(&context, size: size, visible: visible, lit: lit, colours: colours)
                }
                .onAppear { engine.size = geometry.size; engine.fit(animated: false) }
                .onValueChange(of: geometry.size) { size in
                    engine.size = size
                    engine.fit(animated: false)
                }
                .contentShape(Rectangle())
                .gesture(dragGesture(visible: visible))
                .simultaneousGesture(MagnificationGesture()
                    .onChanged { value in engine.zoom(by: value / pinchBase); pinchBase = value }
                    .onEnded { _ in pinchBase = 1 })
                .simultaneousGesture(SpatialTapGesture(count: 2).onEnded { value in
                    let at = engine.node(at: value.location, visible: visible)
                    if at >= 0, let key = engine.model.nodes[at].key { onOpen(key) }
                })
                .simultaneousGesture(SpatialTapGesture().onEnded { value in
                    let at = engine.node(at: value.location, visible: visible)
                    engine.selected = at
                    engine.touch()
                    if at >= 0, let key = engine.model.nodes[at].key { onPreview(key) }
                })
                .accessibilityLabel(Text("Graph of the notes"))
                if engine.model.nodes.isEmpty {
                    Text("No note matches these filters.").font(theme.font(13)).foregroundStyle(theme.inkSecondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                if let overlay { overlay.padding(8) }
                DesktopGraphSettingsPanel(settings: $engine.settings, onAnimate: onAnimate)
                    .frame(maxWidth: .infinity, alignment: .topTrailing)
                    .padding(8)
                HStack(alignment: .bottom, spacing: 8) {
                    minimap(visible: visible, colours: colours)
                    VStack(spacing: 4) {
                        control("plus", Text("Zoom in")) { engine.zoom(by: 1.35) }
                        control("minus", Text("Zoom out")) { engine.zoom(by: 1 / 1.35) }
                        control("arrow.up.left.and.arrow.down.right", Text("Fit")) { engine.autoFit = true; engine.fit() }
                    }
                }
                .padding(8)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
            }
        }
        .background(theme.panel)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-memory-graph")
        .onAppear { engine.update(notes: notes, focusKey: focusKey, depth: depth) }
        // the simulation's frames: a few ticks every 16 ms until it rests
        .task {
            while !Task.isCancelled {
                if !engine.settled { engine.step() }
                try? await Task.sleep(nanoseconds: 16_000_000)
            }
        }
        .onValueChange(of: notesSignature) { _ in engine.update(notes: notes, focusKey: focusKey, depth: depth) }
        .onValueChange(of: engine.settings.filters) { _ in engine.update(notes: notes, focusKey: focusKey, depth: depth) }
        .onValueChange(of: engine.settings.forces) { _ in engine.applyForces() }
    }

    private var notesSignature: String {
        notes.map(\.key).joined(separator: "|") + "#\(focusKey ?? "")|\(depth)"
    }

    // MARK: What each node shows

    private var visibleNodes: [Bool] {
        let model = engine.model
        guard let hidden, !hidden.isEmpty else { return Array(repeating: true, count: model.nodes.count) }
        var out = Array(repeating: false, count: model.nodes.count)
        for (i, node) in model.nodes.enumerated() where node.kind == .note {
            guard let key = node.key, !hidden.contains(key) else { continue }
            out[i] = true
            var up = node.parent
            while up >= 0, !out[up] { out[up] = true; up = model.nodes[up].parent }
            for next in model.adjacency[i] where [.tag, .ghost, .attachment].contains(model.nodes[next].kind) { out[next] = true }
        }
        return out
    }

    private var litNodes: [Bool]? {
        guard let matches else { return nil }
        return engine.model.nodes.map { $0.key.map(matches.contains) ?? false }
    }

    private static let folderPalette: [(DesktopTheme) -> Color] = [
        { $0.warning }, { _ in Color(red: 0xf4 / 255, green: 0x8a / 255, blue: 0x29 / 255) }, { $0.danger },
        { DesktopMemoryPage.mix($0.accent, $0.danger, 0.55) }, { DesktopMemoryPage.mix($0.success, $0.accent, 0.5) },
        { DesktopMemoryPage.mix($0.warning, $0.danger, 0.55) },
    ]

    private var nodeColours: [Color] {
        let settings = engine.settings
        let groups = settings.groups.filter { !$0.query.trimmingCharacters(in: .whitespaces).isEmpty }
        var tierNames: [String: String] = [:]
        for note in notes { tierNames[note.tier] = note.tierName }
        let tagColour = DesktopMemoryPage.mix(theme.success, theme.inkSecondary, 0.55)
        return engine.model.nodes.map { node in
            switch node.kind {
            case .ghost: return theme.inkTertiary
            case .tag: return tagColour
            case .attachment: return theme.warning
            default: break
            }
            if node.kind == .note {
                for group in groups where MemoryGraph.matches(label: node.label, folderPath: node.folderPath, tags: node.tags, kind: node.kind, tierName: tierNames[node.tier], query: group.query) {
                    return Color(graphHex: group.color) ?? theme.accent
                }
            }
            if settings.colorBy == .folder, node.kind != .tier, let top = MemoryGraph.folderSegments(node.folderPath).first {
                return Self.folderPalette[MemoryGraph.stableIndex("\(node.tier)/\(top)", Self.folderPalette.count)](theme)
            }
            return tierColor(node.tier)
        }
    }

    // MARK: Drawing (the desktop's draw())

    private func draw(_ context: inout GraphicsContext, size: CGSize, visible: [Bool], lit: [Bool]?, colours: [Color]) {
        let model = engine.model, sim = engine.sim, v = engine.view
        guard sim.n == model.nodes.count else { return }
        let display = engine.settings.display
        let hov = engine.selected
        let near: Set<Int>? = hov >= 0 ? MemoryGraph.neighbourSet(model, hov) : nil
        func sx(_ i: Int) -> CGFloat { sim.x[i] * v.s + v.tx }
        func sy(_ i: Int) -> CGFloat { sim.y[i] * v.s + v.ty }
        let width = max(0.35, display.linkThickness * min(1.6, max(0.5, v.s)))
        let baseAlpha = theme.dark ? 0.32 : 0.42
        var plain = Path(), bright = Path(), arrows = Path(), arrowsBright = Path()
        for edge in model.links {
            let a = edge.source, b = edge.target
            guard visible[a], visible[b] else { continue }
            let hot = near != nil && (a == hov || b == hov)
            let start = CGPoint(x: sx(a), y: sy(a)), end = CGPoint(x: sx(b), y: sy(b))
            if hot { bright.move(to: start); bright.addLine(to: end) } else { plain.move(to: start); plain.addLine(to: end) }
            if display.arrows, edge.kind == .link {
                let dx = end.x - start.x, dy = end.y - start.y
                let len = hypot(dx, dy), r = engine.radius(b) * v.s
                if len > r + 6 {
                    let ux = dx / len, uy = dy / len
                    let tip = CGPoint(x: end.x - ux * r, y: end.y - uy * r)
                    let head = max(4, 5 * min(1.5, v.s))
                    var arrow = Path()
                    arrow.move(to: tip)
                    arrow.addLine(to: CGPoint(x: tip.x - ux * head - uy * head * 0.5, y: tip.y - uy * head + ux * head * 0.5))
                    arrow.addLine(to: CGPoint(x: tip.x - ux * head + uy * head * 0.5, y: tip.y - uy * head - ux * head * 0.5))
                    arrow.closeSubpath()
                    if hot { arrowsBright.addPath(arrow) } else { arrows.addPath(arrow) }
                }
            }
        }
        let mix: Double = near == nil ? 0 : 1
        context.opacity = baseAlpha * (1 - 0.75 * mix) * (lit != nil ? 0.5 : 1)
        context.stroke(plain, with: .color(theme.inkTertiary), lineWidth: width)
        context.fill(arrows, with: .color(theme.inkTertiary))
        if near != nil {
            context.opacity = max(baseAlpha, 0.9)
            context.stroke(bright, with: .color(theme.accent), lineWidth: width * 1.4)
            context.fill(arrowsBright, with: .color(theme.accent))
        }
        for i in 0..<sim.n where visible[i] {
            let r = max(1.2, engine.radius(i) * v.s)
            let x = sx(i), y = sy(i)
            if x < -r || x > size.width + r || y < -r || y > size.height + r { continue }
            var alpha = 1.0
            if let lit, !lit[i] { alpha = 0.18 }
            if let near, !near.contains(i) { alpha *= 0.22 }
            context.opacity = alpha
            context.fill(Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)), with: .color(i == hov ? theme.accent : colours[i]))
        }
        if let focusKey, let focus = model.index["n:\(focusKey)"], visible[focus] {
            context.opacity = 1
            let r = max(1.2, engine.radius(focus) * v.s) + 4
            context.stroke(Path(ellipseIn: CGRect(x: sx(focus) - r, y: sy(focus) - r, width: r * 2, height: r * 2)), with: .color(theme.accent), lineWidth: 2)
        }
        let fade = MemoryGraph.labelOpacity(v.s, threshold: display.textFade)
        guard fade > 0.01 || near != nil else { context.opacity = 1; return }
        let fontSize = (max(10, min(15, 11 * max(1, v.s).squareRoot()))).rounded()
        for i in 0..<sim.n where visible[i] {
            let mine = near?.contains(i) ?? false
            var alpha = mine ? 1 : fade * (near != nil ? 0.15 : 1)
            if let lit, !lit[i], !mine { alpha *= 0.25 }
            if alpha < 0.02 { continue }
            let x = sx(i), y = sy(i)
            if x < -40 || x > size.width + 40 || y < -40 || y > size.height + 40 { continue }
            context.opacity = alpha
            let label = model.nodes[i].label
            let text = Text(verbatim: label.count > 48 ? String(label.prefix(47)) + "…" : label).font(theme.font(fontSize)).foregroundColor(theme.ink)
            context.draw(text, at: CGPoint(x: x, y: y + max(1.2, engine.radius(i) * v.s) + 3), anchor: .top)
        }
        context.opacity = 1
    }

    // MARK: Gestures

    private func dragGesture(visible: [Bool]) -> some Gesture {
        DragGesture(minimumDistance: 2)
            .onChanged { value in
                if lastDrag == .zero, dragNode < 0 {
                    let at = engine.node(at: value.startLocation, visible: visible)
                    dragNode = at >= 0 ? at : -2
                    if at >= 0 { engine.sim.alphaTarget = 0.3; engine.sim.reheat(0.3) }
                }
                if dragNode >= 0 {
                    let world = engine.world(value.location)
                    engine.sim.pin(dragNode, world.0, world.1)
                    engine.autoFit = false
                    engine.touch()
                } else {
                    engine.pan(CGSize(width: value.translation.width - lastDrag.width, height: value.translation.height - lastDrag.height))
                }
                lastDrag = value.translation
            }
            .onEnded { _ in
                if dragNode >= 0 { engine.sim.release(dragNode); engine.sim.alphaTarget = 0 }
                dragNode = -1
                lastDrag = .zero
            }
    }

    // MARK: Minimap and controls

    private func minimap(visible: [Bool], colours: [Color]) -> some View {
        Canvas { context, size in
            let sim = engine.sim
            guard let b = MemoryGraph.bounds(sim, only: { visible.indices.contains($0) && visible[$0] }) else { return }
            let fit = MemoryGraph.fit(b, width: size.width, height: size.height, pad: 8, maxZoom: 100)
            context.opacity = 0.9
            for i in 0..<sim.n where visible.indices.contains(i) && visible[i] {
                context.fill(Path(CGRect(x: sim.x[i] * fit.s + fit.tx - 1, y: sim.y[i] * fit.s + fit.ty - 1, width: 2, height: 2)), with: .color(colours.indices.contains(i) ? colours[i] : theme.inkTertiary))
            }
            let v = engine.view
            let x0 = (0 - v.tx) / v.s * fit.s + fit.tx, y0 = (0 - v.ty) / v.s * fit.s + fit.ty
            context.opacity = 1
            context.stroke(Path(CGRect(x: x0, y: y0, width: engine.size.width / v.s * fit.s, height: engine.size.height / v.s * fit.s)), with: .color(theme.accent), lineWidth: 1.5)
        }
        .frame(width: 132, height: 132)
        .background(theme.panel.opacity(0.9), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.6), lineWidth: 1))
        .gesture(DragGesture(minimumDistance: 0).onChanged { value in
            let sim = engine.sim
            guard let b = MemoryGraph.bounds(sim) else { return }
            let fit = MemoryGraph.fit(b, width: 132, height: 132, pad: 8, maxZoom: 100)
            let wx = (value.location.x - fit.tx) / fit.s, wy = (value.location.y - fit.ty) / fit.s
            engine.view.tx = engine.size.width / 2 - wx * engine.view.s
            engine.view.ty = engine.size.height / 2 - wy * engine.view.s
            engine.autoFit = false
            engine.touch()
        })
        .accessibilityLabel(Text("Minimap"))
    }

    private func control(_ symbol: String, _ label: Text, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 13, weight: .medium)).foregroundStyle(theme.inkSecondary).frame(width: 32, height: 32)
                .background(theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(label)
    }
}

// MARK: - The settings panel (GraphSettingsPanel)

struct DesktopGraphSettingsPanel: View {
    @Environment(\.desktopTheme) private var theme
    @Binding var settings: MemoryGraph.Settings
    let onAnimate: () -> Void

    var body: some View {
        if settings.open {
            VStack(spacing: 0) {
                HStack(spacing: 4) {
                    Text("Graph settings").font(theme.font(12.5, .semibold)).foregroundStyle(theme.ink)
                    Spacer()
                    iconButton("arrow.counterclockwise", Text("Restore the default settings")) {
                        var reset = MemoryGraph.Settings(); reset.open = true; settings = reset
                    }
                    iconButton("xmark", Text("Close the graph settings")) { settings.open = false }
                }
                .padding(.horizontal, 10).frame(height: 36)
                Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1)
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        section("filters", Text("Filters")) {
                            TextField(text: $settings.filters.search, prompt: Text("Search files…").foregroundColor(theme.inkTertiary)) { Text("Search files…") }
                                .font(theme.font(12.5)).textInputAutocapitalization(.never).autocorrectionDisabled()
                                .padding(.horizontal, 8).frame(height: 28)
                                .background(theme.inset, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                            toggle(Text("Tags"), $settings.filters.tags)
                            toggle(Text("Attachments"), $settings.filters.attachments)
                            toggle(Text("Existing files only"), $settings.filters.existingOnly)
                            toggle(Text("Orphans"), $settings.filters.orphans)
                            toggle(Text("Folders and tiers"), $settings.filters.folders)
                        }
                        section("groups", Text("Groups")) {
                            HStack {
                                Text("Colour by").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                                Spacer()
                                Picker(selection: $settings.colorBy) {
                                    Text("Tier").tag(MemoryGraph.ColorBy.tier)
                                    Text("Folder").tag(MemoryGraph.ColorBy.folder)
                                } label: { Text("Colour by") }
                                .pickerStyle(.segmented).frame(width: 130)
                            }
                            ForEach(settings.groups.indices, id: \.self) { i in
                                HStack(spacing: 6) {
                                    TextField(text: $settings.groups[i].query, prompt: Text("Enter a query…").foregroundColor(theme.inkTertiary)) { Text("Enter a query…") }
                                        .font(theme.font(12)).textInputAutocapitalization(.never).autocorrectionDisabled()
                                        .padding(.horizontal, 6).frame(height: 26)
                                        .background(theme.inset, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                                    ColorPicker("", selection: Binding(
                                        get: { Color(graphHex: settings.groups[i].color) ?? .gray },
                                        set: { settings.groups[i].color = $0.hexString }), supportsOpacity: false).labelsHidden()
                                        .accessibilityLabel(Text("Group colour"))
                                    iconButton("trash", Text("Remove the group")) { settings.groups.remove(at: i) }
                                }
                            }
                            Text("Colour the notes a query finds: tag:#work, path:Topics, tier:Atlas, or words of the title.").font(theme.font(11.5)).foregroundStyle(theme.inkTertiary)
                            Button {
                                settings.groups.append(.init(query: "", color: MemoryGraph.groupSwatches[settings.groups.count % MemoryGraph.groupSwatches.count]))
                            } label: { Text("New group").font(theme.font(12, .medium)).foregroundStyle(theme.ink) }
                                .buttonStyle(.plain)
                                .disabled(settings.groups.count >= 12)
                        }
                        section("display", Text("Display")) {
                            toggle(Text("Arrows"), $settings.display.arrows)
                            slider(Text("Text fade threshold"), $settings.display.textFade, -3...3)
                            slider(Text("Node size"), $settings.display.nodeSize, 0.25...3)
                            slider(Text("Link thickness"), $settings.display.linkThickness, 0.25...3)
                            Button(action: onAnimate) {
                                HStack(spacing: 6) { Image(systemName: "play.fill").font(.system(size: 10)); Text("Animate") }
                                    .font(theme.font(12, .medium)).foregroundStyle(theme.ink)
                                    .padding(.horizontal, 10).frame(height: 28)
                                    .background(theme.raised, in: Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                        section("forces", Text("Forces")) {
                            slider(Text("Centre force"), $settings.forces.center, 0...1)
                            slider(Text("Repel force"), $settings.forces.repel, 0...20)
                            slider(Text("Link force"), $settings.forces.link, 0...1)
                            slider(Text("Link distance"), $settings.forces.linkDistance, 30...500)
                        }
                    }
                }
            }
            .frame(width: 260)
            .frame(maxHeight: 420)
            .background(theme.menu, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
            .shadow(color: .black.opacity(0.18), radius: 12, y: 4)
            .accessibilityIdentifier("desktop-memory-graph.settings")
        } else {
            Button { settings.open = true } label: {
                Image(systemName: "slider.horizontal.3").font(.system(size: 13)).foregroundStyle(theme.inkSecondary).frame(width: 32, height: 32)
                    .background(theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .accessibilityLabel(Text("Graph settings"))
            .accessibilityIdentifier("desktop-memory-graph.settings-open")
        }
    }

    private func section<Content: View>(_ id: String, _ title: Text, @ViewBuilder _ content: () -> Content) -> some View {
        let open = settings.sections[id] ?? false
        return VStack(alignment: .leading, spacing: 8) {
            Button { settings.sections[id] = !open } label: {
                HStack(spacing: 6) {
                    Image(systemName: open ? "chevron.down" : "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(theme.inkTertiary)
                    title.font(theme.font(12.5, .medium)).foregroundStyle(theme.ink)
                    Spacer()
                }
                .frame(height: 30).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open { content() }
        }
        .padding(.horizontal, 10).padding(.bottom, open ? 8 : 0)
    }

    private func toggle(_ label: Text, _ value: Binding<Bool>) -> some View {
        HStack {
            label.font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
            Spacer()
            PanelSwitch(label: "", isOn: value.wrappedValue) { value.wrappedValue = $0 }
        }
    }

    private func slider(_ label: Text, _ value: Binding<Double>, _ range: ClosedRange<Double>) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            label.font(theme.font(12)).foregroundStyle(theme.inkSecondary)
            Slider(value: value, in: range).tint(theme.accent).controlSize(.mini)
        }
    }

    private func iconButton(_ symbol: String, _ label: Text, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 12)).foregroundStyle(theme.inkSecondary).frame(width: 28, height: 28)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

extension Color {
    /// "#rrggbb", nil when it is not one.
    init?(graphHex hex: String) {
        guard hex.count == 7, hex.hasPrefix("#"), let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        self.init(red: Double((value >> 16) & 0xff) / 255, green: Double((value >> 8) & 0xff) / 255, blue: Double(value & 0xff) / 255)
    }

    var hexString: String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a)
        func byte(_ v: CGFloat) -> Int { Int((min(1, max(0, v)) * 255).rounded()) }
        return String(format: "#%02x%02x%02x", byte(r), byte(g), byte(b))
    }
}
