// iPad lot 5b (2026-11-03): Memory > Map > Graph, the desktop's
// Obsidian-like graph view, ported from src/lib/memory-graph.ts and
// src/lib/memory-graph-settings.ts. The model (one node per note, tags,
// attachments, links to notes that do not exist yet, the tier and folder
// hierarchy), the force simulation (centre, repel, link force and link
// distance, d3-force style, seeded and still once settled) and the view
// helpers (fit, hit test, neighbourhood, radius, label fade). The repel is
// the exact pairwise sum where the desktop uses Barnes-Hut: the same force
// law, fine for the few hundred notes a person keeps.
import Foundation

public enum MemoryGraph {
    // MARK: Model

    public enum NodeKind: String, Sendable { case note, ghost, attachment, tag, folder, tier }
    public enum LinkKind: String, Sendable { case link, folder, tag, attachment }

    public struct Note: Sendable {
        public var key: String
        public var title: String
        public var tier: String
        public var tierName: String
        public var folderPath: String
        public var tags: [String]
        public var body: String?
        public var path: String?
        public var createdAt: Double?
        public init(key: String, title: String, tier: String, tierName: String, folderPath: String, tags: [String] = [],
                    body: String? = nil, path: String? = nil, createdAt: Double? = nil) {
            self.key = key; self.title = title; self.tier = tier; self.tierName = tierName; self.folderPath = folderPath
            self.tags = tags; self.body = body; self.path = path; self.createdAt = createdAt
        }
    }

    public struct Node: Sendable {
        public var id: String
        public var kind: NodeKind
        public var label: String
        public var tier: String
        public var key: String?
        public var folderPath: String
        public var tags: [String]
        public var degree = 0
        public var parent = -1
    }

    public struct Link: Sendable, Equatable {
        public var source: Int
        public var target: Int
        public var kind: LinkKind
    }

    public struct Model: Sendable {
        public var nodes: [Node]
        public var links: [Link]
        public var adjacency: [[Int]]
        public var index: [String: Int]
        public var noteLinks: Int
    }

    public struct Filters: Codable, Equatable, Sendable {
        public var search = ""
        public var tags = false
        public var attachments = false
        public var existingOnly = false
        public var orphans = true
        public var folders = true
        public init() {}
    }

    public static func fold(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).lowercased()
    }

    private static let attachment = try! NSRegularExpression(
        pattern: #"\.(png|jpe?g|gif|webp|svg|bmp|avif|heic|pdf|mp3|m4a|wav|ogg|mp4|mov|webm|csv|xlsx?|docx?|pptx?|zip|txt|json)$"#,
        options: [.caseInsensitive])
    private static let wiki = try! NSRegularExpression(pattern: #"(!?)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]"#)
    private static let image = try! NSRegularExpression(pattern: #"!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)"#)

    private static func isAttachment(_ text: String) -> Bool {
        attachment.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    private static func baseName(_ path: String) -> String {
        path.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? path
    }

    /// `bodyRefs`: the [[links]] (folded) and the attachments (file names).
    public static func bodyRefs(_ body: String) -> (notes: [String], attachments: [String]) {
        var notes: [String] = [], files: [String] = []
        let range = NSRange(body.startIndex..., in: body)
        for match in wiki.matches(in: body, range: range) {
            guard let r = Range(match.range(at: 2), in: body) else { continue }
            let target = body[r].trimmingCharacters(in: .whitespaces)
            if target.isEmpty { continue }
            if isAttachment(target) {
                let name = baseName(target)
                if !files.contains(name) { files.append(name) }
            } else {
                var stem = target
                if stem.lowercased().hasSuffix(".md") { stem = String(stem.dropLast(3)) }
                let folded = fold(stem)
                if !notes.contains(folded) { notes.append(folded) }
            }
        }
        for match in image.matches(in: body, range: range) {
            guard let r = Range(match.range(at: 1), in: body) else { continue }
            let raw = String(body[r])
            let target = raw.removingPercentEncoding ?? raw
            if target.range(of: #"^[a-z]+://"#, options: [.regularExpression, .caseInsensitive]) != nil || target.hasPrefix("data:") { continue }
            if isAttachment(target) {
                let name = baseName(target)
                if !files.contains(name) { files.append(name) }
            }
        }
        return (notes, files)
    }

    /// "Atlas / Topics" -> ["Atlas", "Topics"].
    public static func folderSegments(_ path: String) -> [String] {
        path.components(separatedBy: "/").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    /// `matchesQuery`: tag:, path: (folder:), tier:, file:, or plain words.
    public static func matches(label: String, folderPath: String, tags: [String], kind: NodeKind, tierName: String?, query: String) -> Bool {
        let words = fold(query).split(whereSeparator: \.isWhitespace).map(String.init)
        if words.isEmpty { return true }
        let title = fold(label), folder = fold(folderPath)
        let folded = tags.map { fold($0).replacingOccurrences(of: #"^#"#, with: "", options: .regularExpression) }
        return words.allSatisfy { word in
            let parts = word.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
            let op = parts.count == 2 && !parts[0].isEmpty ? parts[0] : ""
            let value = op.isEmpty ? word : parts[1]
            switch op {
            case "tag":
                let want = value.replacingOccurrences(of: #"^#"#, with: "", options: .regularExpression)
                if want.isEmpty { return true }
                return folded.contains { $0 == want || $0.hasPrefix("\(want)/") || $0.hasPrefix("\(want):") }
                    || (kind == .tag && title.replacingOccurrences(of: #"^#"#, with: "", options: .regularExpression) == want)
            case "path", "folder": return folder.contains(value)
            case "tier": return fold(tierName ?? "").contains(value)
            case "file": return title.contains(value)
            default: return title.contains(value) || folder.contains(value)
            }
        }
    }

    /// `buildGraph`: the notes through the settings panel's filters.
    public static func build(_ notes: [Note], filters: Filters) -> Model {
        var nodes: [Node] = []
        var index: [String: Int] = [:]
        var linkSet = Set<String>()
        var links: [Link] = []
        func add(_ node: Node) -> Int {
            if let known = index[node.id] { return known }
            nodes.append(node)
            index[node.id] = nodes.count - 1
            return nodes.count - 1
        }
        func link(_ a: Int, _ b: Int, _ kind: LinkKind) -> Bool {
            if a == b { return false }
            let id = a < b ? "\(a)|\(b)" : "\(b)|\(a)"
            if linkSet.contains(id) { return false }
            linkSet.insert(id)
            links.append(Link(source: a, target: b, kind: kind))
            return true
        }
        var tierNames: [String: String] = [:]
        for note in notes { tierNames[note.tier] = note.tierName }
        let search = filters.search.trimmingCharacters(in: .whitespaces)
        let kept = notes.filter { search.isEmpty || matches(label: $0.title, folderPath: $0.folderPath, tags: $0.tags, kind: .note, tierName: $0.tierName, query: filters.search) }
        for note in kept {
            _ = add(Node(id: "n:\(note.key)", kind: .note, label: note.title, tier: note.tier, key: note.key, folderPath: note.folderPath, tags: note.tags))
        }
        var byName: [String: Int] = [:]
        for note in kept {
            let at = index["n:\(note.key)"]!
            byName[fold(note.title.trimmingCharacters(in: .whitespaces))] = at
            if let path = note.path {
                var file = baseName(path)
                if file.lowercased().hasSuffix(".md") { file = String(file.dropLast(3)) }
                let folded = fold(file)
                if !folded.isEmpty, byName[folded] == nil { byName[folded] = at }
            }
        }
        var noteLinks = 0
        for note in kept {
            guard let body = note.body else { continue }
            let from = index["n:\(note.key)"]!
            let refs = bodyRefs(body)
            for target in refs.notes {
                if let to = byName[target] {
                    if link(from, to, .link) { noteLinks += 1 }
                } else if !filters.existingOnly {
                    _ = link(from, add(Node(id: "g:\(target)", kind: .ghost, label: target, tier: "", folderPath: "", tags: [])), .link)
                }
            }
            if filters.attachments {
                for file in refs.attachments {
                    _ = link(from, add(Node(id: "a:\(file.lowercased())", kind: .attachment, label: file, tier: "", folderPath: "", tags: [])), .attachment)
                }
            }
        }
        if filters.tags {
            for note in kept {
                let from = index["n:\(note.key)"]!
                for tag in note.tags {
                    let name = tag.hasPrefix("#") ? String(tag.dropFirst()) : tag
                    if name.isEmpty { continue }
                    _ = link(from, add(Node(id: "t:\(name.lowercased())", kind: .tag, label: "#\(name)", tier: "", folderPath: "", tags: [name])), .tag)
                }
            }
        }
        if filters.folders {
            for note in kept {
                let from = index["n:\(note.key)"]!
                var parent = add(Node(id: "r:\(note.tier)", kind: .tier, label: tierNames[note.tier].flatMap { $0.isEmpty ? nil : $0 } ?? note.tier,
                                      tier: note.tier, folderPath: "", tags: []))
                let segments = folderSegments(note.folderPath)
                let skip = !segments.isEmpty && fold(segments[0]) == fold(note.tierName) ? 1 : 0
                var path = ""
                for (i, segment) in segments.enumerated() {
                    path = path.isEmpty ? segment : "\(path) / \(segment)"
                    if i < skip { continue }
                    var folder = Node(id: "f:\(note.tier):\(path)", kind: .folder, label: segment, tier: note.tier, folderPath: path, tags: [])
                    folder.parent = parent
                    let at = add(folder)
                    _ = link(parent, at, .folder)
                    parent = at
                }
                nodes[from].parent = parent
                _ = link(parent, from, .folder)
            }
        }
        if !filters.orphans {
            var linked = [Bool](repeating: false, count: nodes.count)
            for edge in links { linked[edge.source] = true; linked[edge.target] = true }
            if nodes.indices.contains(where: { !linked[$0] && nodes[$0].kind == .note }) {
                var remap = [Int](repeating: -1, count: nodes.count)
                var kept: [Node] = []
                for (i, node) in nodes.enumerated() where !(node.kind == .note && !linked[i]) {
                    remap[i] = kept.count
                    kept.append(node)
                }
                for i in kept.indices { kept[i].parent = kept[i].parent >= 0 ? remap[kept[i].parent] : -1 }
                links = links.map { Link(source: remap[$0.source], target: remap[$0.target], kind: $0.kind) }
                nodes = kept
                index = [:]
                for (i, node) in nodes.enumerated() { index[node.id] = i }
            }
        }
        var adjacency = [[Int]](repeating: [], count: nodes.count)
        for edge in links {
            adjacency[edge.source].append(edge.target)
            adjacency[edge.target].append(edge.source)
            nodes[edge.source].degree += 1
            nodes[edge.target].degree += 1
        }
        return Model(nodes: nodes, links: links, adjacency: adjacency, index: index, noteLinks: noteLinks)
    }

    public static func neighbourSet(_ model: Model, _ node: Int) -> Set<Int> {
        guard model.adjacency.indices.contains(node) else { return [] }
        return Set([node] + model.adjacency[node])
    }

    /// Everything within `depth` hops (Obsidian's local graph).
    public static func withinDepth(_ model: Model, _ node: Int, _ depth: Int) -> Set<Int> {
        var out: Set<Int> = [node]
        var edge = [node]
        for _ in 0..<depth {
            var next: [Int] = []
            for at in edge { for n in model.adjacency[at] where !out.contains(n) { out.insert(n); next.append(n) } }
            edge = next
        }
        return out
    }

    // MARK: Forces

    public struct Forces: Codable, Equatable, Sendable {
        public var center = 0.5
        public var repel = 10.0
        public var link = 1.0
        public var linkDistance = 250.0
        public init() {}
    }

    private static let distanceScale = 0.2
    private static let repelScale = 14.0
    private static let centerScale = 0.06
    private static let distanceMax2 = 1600.0 * 1600.0

    /// mulberry32, as the desktop seeds it.
    public struct SeededRandom {
        private var a: UInt32
        public init(seed: UInt32) { a = seed }
        public mutating func next() -> Double {
            a = a &+ 0x6d2b79f5
            var t = a
            t = (t ^ (t >> 15)) &* (t | 1)
            t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
            return Double(t ^ (t >> 14)) / 4_294_967_296
        }
    }

    public final class Simulation {
        public let n: Int
        public var x: [Double], y: [Double], vx: [Double], vy: [Double]
        public var fx: [Double], fy: [Double]
        public var alpha = 1.0
        public var alphaTarget = 0.0
        public let alphaMin = 0.001
        public var forces: Forces
        private var rng: SeededRandom
        private let src: [Int], dst: [Int], bias: [Double], strength: [Double]

        public init(links: [Link], n: Int, seed: UInt32 = 1, forces: Forces = Forces(), start: ((Int) -> (x: Double, y: Double)?)? = nil) {
            self.n = n
            self.forces = forces
            rng = SeededRandom(seed: seed)
            x = .init(repeating: 0, count: n); y = x; vx = x; vy = x
            fx = .init(repeating: .nan, count: n); fy = fx
            var count = [Double](repeating: 0, count: n)
            for edge in links { count[edge.source] += 1; count[edge.target] += 1 }
            let turn = rng.next() * .pi * 2
            let golden = Double.pi * (3 - 5.0.squareRoot())
            var placed = 0.0
            for i in 0..<n {
                if let at = start?(i), at.x.isFinite, at.y.isFinite { x[i] = at.x; y[i] = at.y; continue }
                let r = 10 * (0.5 + placed).squareRoot()
                let a = turn + placed * golden
                x[i] = r * cos(a); y[i] = r * sin(a)
                placed += 1
            }
            src = links.map(\.source); dst = links.map(\.target)
            bias = links.map { count[$0.source] / (count[$0.source] + count[$0.target]) }
            strength = links.map { 1 / max(1, min(count[$0.source], count[$0.target])) }
        }

        private func jiggle() -> Double { (rng.next() - 0.5) * 1e-6 }

        public func tick() {
            let decay = 1 - pow(alphaMin, 1.0 / 300)
            alpha += (alphaTarget - alpha) * decay
            let distance = max(1, forces.linkDistance * MemoryGraph.distanceScale)
            if forces.link > 0 {
                for k in src.indices {
                    let s = src[k], t = dst[k]
                    var dx = x[t] + vx[t] - x[s] - vx[s]
                    var dy = y[t] + vy[t] - y[s] - vy[s]
                    if dx == 0 { dx = jiggle() }
                    if dy == 0 { dy = jiggle() }
                    var l = (dx * dx + dy * dy).squareRoot()
                    l = ((l - distance) / l) * alpha * forces.link * strength[k]
                    dx *= l; dy *= l
                    let b = bias[k]
                    vx[t] -= dx * b; vy[t] -= dy * b
                    vx[s] += dx * (1 - b); vy[s] += dy * (1 - b)
                }
            }
            if forces.repel > 0, n > 1 {
                let f0 = -forces.repel * MemoryGraph.repelScale * alpha
                for i in 0..<n {
                    var ax = 0.0, ay = 0.0
                    let xi = x[i], yi = y[i]
                    for j in 0..<n where j != i {
                        var dx = x[j] - xi, dy = y[j] - yi
                        if dx == 0 { dx = jiggle() }
                        if dy == 0 { dy = jiggle() }
                        var l2 = dx * dx + dy * dy
                        if l2 >= MemoryGraph.distanceMax2 { continue }
                        if l2 < 1 { l2 = l2.squareRoot() }
                        let f = f0 / l2
                        ax += dx * f; ay += dy * f
                    }
                    vx[i] += ax; vy[i] += ay
                }
            }
            if forces.center > 0 {
                let k = forces.center * MemoryGraph.centerScale * alpha
                for i in 0..<n { vx[i] -= x[i] * k; vy[i] -= y[i] * k }
            }
            for i in 0..<n {
                if !fx[i].isNaN { x[i] = fx[i]; y[i] = fy[i]; vx[i] = 0; vy[i] = 0; continue }
                vx[i] *= 0.6; vy[i] *= 0.6
                x[i] += vx[i]; y[i] += vy[i]
            }
        }

        public func settled() -> Bool { alpha < alphaMin && alphaTarget < alphaMin }
        public func reheat(_ to: Double = 0.3) { alpha = max(alpha, to) }
        public func pin(_ i: Int, _ px: Double, _ py: Double) { fx[i] = px; fy[i] = py }
        public func release(_ i: Int) { fx[i] = .nan; fy[i] = .nan }

        @discardableResult
        public func settle(max: Int = 1000) -> Int {
            var ticks = 0
            while !settled(), ticks < max { tick(); ticks += 1 }
            return ticks
        }
    }

    // MARK: View

    public struct View: Equatable, Sendable {
        public var s: Double
        public var tx: Double
        public var ty: Double
        public init(s: Double, tx: Double, ty: Double) { self.s = s; self.tx = tx; self.ty = ty }
    }

    public static let minZoom = 0.05
    public static let maxZoom = 8.0

    /// `nodeRadius`, world units.
    public static func nodeRadius(degree: Int, kind: NodeKind, size: Double = 1) -> Double {
        let base: Double = kind == .tier ? 7 : kind == .folder ? 4.5 : kind == .note ? 4 : 3.2
        return size * (base + min(12, Double(degree).squareRoot() * 1.35))
    }

    /// `labelOpacity`: Obsidian's text fade.
    public static func labelOpacity(_ s: Double, threshold: Double = 0) -> Double {
        let start = 0.55 * pow(2, threshold)
        let end = start * 1.75
        if s <= start { return 0 }
        if s >= end { return 1 }
        return (log(s) - log(start)) / (log(end) - log(start))
    }

    public struct Bounds: Sendable { public var minX, minY, maxX, maxY: Double }

    public static func bounds(_ sim: Simulation, only: ((Int) -> Bool)? = nil) -> Bounds? {
        var b = Bounds(minX: .infinity, minY: .infinity, maxX: -.infinity, maxY: -.infinity)
        for i in 0..<sim.n where only?(i) ?? true {
            b.minX = min(b.minX, sim.x[i]); b.maxX = max(b.maxX, sim.x[i])
            b.minY = min(b.minY, sim.y[i]); b.maxY = max(b.maxY, sim.y[i])
        }
        return b.minX.isFinite ? b : nil
    }

    public static func fit(_ b: Bounds?, width w: Double, height h: Double, pad: Double = 48, maxZoom: Double = 2) -> View {
        guard let b else { return View(s: 1, tx: w / 2, ty: h / 2) }
        let bw = max(1, b.maxX - b.minX), bh = max(1, b.maxY - b.minY)
        let s = max(minZoom, min(maxZoom, (w - pad * 2) / bw, (h - pad * 2) / bh))
        return View(s: s, tx: w / 2 - (b.minX + b.maxX) / 2 * s, ty: h / 2 - (b.minY + b.maxY) / 2 * s)
    }

    public static func nodeAt(_ sim: Simulation, radius: (Int) -> Double, view v: View, x px: Double, y py: Double, slack: Double = 4,
                              visible: ((Int) -> Bool)? = nil) -> Int {
        let wx = (px - v.tx) / v.s, wy = (py - v.ty) / v.s
        var best = -1, bestD = Double.infinity
        for i in 0..<sim.n where visible?(i) ?? true {
            let d = ((sim.x[i] - wx) * (sim.x[i] - wx) + (sim.y[i] - wy) * (sim.y[i] - wy)).squareRoot()
            if d <= radius(i) + slack / v.s, d < bestD { best = i; bestD = d }
        }
        return best
    }

    public static func zoom(_ v: View, around px: Double, _ py: Double, by factor: Double) -> View {
        let s = max(minZoom, min(maxZoom, v.s * factor))
        let k = s / v.s
        return View(s: s, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k)
    }

    // MARK: Settings (memory-graph-settings.ts)

    public enum ColorBy: String, Codable, Sendable { case tier, folder }

    public struct Group: Codable, Equatable, Sendable {
        public var query: String
        public var color: String
        public init(query: String, color: String) { self.query = query; self.color = color }
    }

    public struct Display: Codable, Equatable, Sendable {
        public var arrows = false
        public var textFade = 0.0
        public var nodeSize = 1.0
        public var linkThickness = 1.0
        public init() {}
    }

    public struct Settings: Codable, Equatable, Sendable {
        public var filters = Filters()
        public var colorBy = ColorBy.tier
        public var groups: [Group] = []
        public var display = Display()
        public var forces = Forces()
        public var open = false
        public var sections: [String: Bool] = ["filters": true, "groups": false, "display": false, "forces": false]
        public init() {}

        /// `cleanGraphSettings`: the ranges clamped, bad groups dropped.
        public func cleaned() -> Settings {
            var out = self
            func clamp(_ v: Double, _ r: ClosedRange<Double>) -> Double { v.isFinite ? min(r.upperBound, max(r.lowerBound, v)) : r.lowerBound }
            out.forces.center = clamp(forces.center, 0...1)
            out.forces.repel = clamp(forces.repel, 0...20)
            out.forces.link = clamp(forces.link, 0...1)
            out.forces.linkDistance = clamp(forces.linkDistance, 30...500)
            out.display.textFade = clamp(display.textFade, -3...3)
            out.display.nodeSize = clamp(display.nodeSize, 0.25...3)
            out.display.linkThickness = clamp(display.linkThickness, 0.25...3)
            out.filters.search = String(filters.search.prefix(200))
            out.groups = Array(groups.filter { $0.color.range(of: #"^#[0-9a-fA-F]{6}$"#, options: .regularExpression) != nil }
                .prefix(12).map { Group(query: String($0.query.prefix(200)), color: $0.color.lowercased()) })
            return out
        }
    }

    public static let groupSwatches = ["#e5484d", "#f5a524", "#30a46c", "#3e8ef7", "#8e4ec6", "#e93d82", "#12a594", "#978365"]

    /// `stableIndex`: a string's stable slot among `count` (folder colours).
    public static func stableIndex(_ text: String, _ count: Int) -> Int {
        var h: UInt32 = 2_166_136_261
        for unit in text.utf16 { h = (h ^ UInt32(unit)) &* 16_777_619 }
        return Int(h % UInt32(max(1, count)))
    }
}
