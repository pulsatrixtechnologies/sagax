// iPad lot 5 (2026-11-03): the memory map read as a brain, ported from
// src/lib/memory-brain.ts (itself the Perspicax console's, PTI, Apache-2.0):
// the radial layout (the root at the centre, the tiers then the topics on
// concentric rings, the notes as leaves on the outer ring), how recent each
// branch is, the edge style, the node size and the search spotlight. The
// tests pin the same rules as scripts/memory-brain.test.mjs.
import Foundation

public enum MemoryBrain {
    public static let dayMs: Double = 86_400_000
    public static let staleDays: Double = 30
    public static let leafSpacing: Double = 15

    public enum Kind: String, Sendable { case root, tier, topic, note }

    public struct Note: Sendable {
        public var id: String
        public var title: String
        public var topic: String
        public var tags: [String]
        /// Epoch milliseconds; nil when unknown.
        public var updated: Double?
        public init(id: String, title: String, topic: String, tags: [String] = [], updated: Double? = nil) {
            self.id = id; self.title = title; self.topic = topic; self.tags = tags; self.updated = updated
        }
    }

    public struct Tier: Sendable {
        public var scope: String
        public var name: String
        public var notes: [Note]
        public init(scope: String, name: String, notes: [Note]) { self.scope = scope; self.name = name; self.notes = notes }
    }

    public struct Node: Sendable {
        public var key: String
        public var kind: Kind
        public var parent: Int
        public var depth: Int
        public var label: String
        public var scope: String
        public var noteId: String
        public var tags: [String] = []
        public var recency: Double = 0
        public var age: Double = .infinity
        public var count: Int = 0
        public var angle: Double = 0
        public var radius: Double = 0
        public var x: Double = 0
        public var y: Double = 0
    }

    public struct Brain: Sendable {
        public var nodes: [Node]
        public var children: [[Int]]
        public var rings: [Double]
        public var notes: Int
    }

    /// `recencyOf`: 1 for a change today, 0 at `staleDays` and beyond, eased.
    public static func recency(updated: Double?, now: Double) -> (recency: Double, age: Double) {
        guard let updated else { return (0, .infinity) }
        let age = max(0, (now - updated) / dayMs)
        if age >= staleDays { return (0, age) }
        let r = 1 - age / staleDays
        return (r * r, age)
    }

    /// `buildBrain` with every tier in view (focus "all").
    public static func build(tiers: [Tier], rootLabel: String, untitled: String, now: Double = Date().timeIntervalSince1970 * 1000) -> Brain {
        var nodes: [Node] = []
        var children: [[Int]] = []
        func add(_ node: Node) -> Int {
            nodes.append(node)
            children.append([])
            if node.parent >= 0 { children[node.parent].append(nodes.count - 1) }
            return nodes.count - 1
        }
        _ = add(Node(key: "root", kind: .root, parent: -1, depth: 0, label: rootLabel, scope: "", noteId: ""))
        for tier in tiers {
            let t = add(Node(key: "tier:\(tier.scope)", kind: .tier, parent: 0, depth: 1, label: tier.name, scope: tier.scope, noteId: ""))
            let topics = Dictionary(grouping: tier.notes, by: \.topic)
            for topic in topics.keys.sorted(by: { $0.localizedCompare($1) == .orderedAscending }) {
                let tp = add(Node(key: "topic:\(tier.scope)/\(topic)", kind: .topic, parent: t, depth: 2, label: topic, scope: tier.scope, noteId: ""))
                for note in topics[topic] ?? [] {
                    var node = Node(key: "\(tier.scope)/\(note.id)", kind: .note, parent: tp, depth: 3,
                                    label: note.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? untitled : note.title,
                                    scope: tier.scope, noteId: note.id)
                    node.tags = note.tags
                    let fresh = recency(updated: note.updated, now: now)
                    node.recency = fresh.recency
                    node.age = fresh.age
                    _ = add(node)
                }
            }
        }
        for index in stride(from: nodes.count - 1, through: 0, by: -1) {
            if nodes[index].kind == .note { nodes[index].count = 1 }
            let parent = nodes[index].parent
            guard parent >= 0 else { continue }
            nodes[parent].count += nodes[index].count
            nodes[parent].recency = max(nodes[parent].recency, nodes[index].recency)
            nodes[parent].age = min(nodes[parent].age, nodes[index].age)
        }
        var brain = Brain(nodes: nodes, children: children, rings: [], notes: nodes.filter { $0.kind == .note }.count)
        layout(&brain)
        return brain
    }

    /// `layoutBrain`: each subtree an arc in proportion to its leaves, a gap
    /// between siblings that grows toward the centre, each depth on its
    /// ring, the outer ring wide enough for `leafSpacing` per leaf.
    public static func layout(_ brain: inout Brain) {
        let count = brain.nodes.count
        guard count > 0 else { return }
        var weight = Array(repeating: 0.0, count: count)
        for i in stride(from: count - 1, through: 0, by: -1) {
            weight[i] = brain.children[i].isEmpty ? 1 : brain.children[i].reduce(0) { $0 + weight[$1] }
        }
        let maxDepth = brain.nodes.map(\.depth).max() ?? 0
        let leaves = max(1, weight[0])
        let gapShare = 0.16
        let outer = max(160 * Double(max(1, maxDepth)), (leaves * leafSpacing) / (2 * .pi * (1 - gapShare)))
        var rings = [0.0]
        if maxDepth >= 1 {
            for d in 1...maxDepth {
                let f = d == maxDepth ? 1 : maxDepth == 2 ? 0.45 : 0.26 + (0.4 * Double(d - 1)) / Double(max(1, maxDepth - 2))
                rings.append(max(Double(d) * 110, outer * f))
            }
        }
        brain.rings = rings
        func place(_ i: Int, _ from: Double, _ to: Double) {
            brain.nodes[i].angle = (from + to) / 2
            brain.nodes[i].radius = brain.nodes[i].depth < rings.count ? rings[brain.nodes[i].depth] : 0
            brain.nodes[i].x = cos(brain.nodes[i].angle) * brain.nodes[i].radius
            brain.nodes[i].y = sin(brain.nodes[i].angle) * brain.nodes[i].radius
            let kids = brain.children[i]
            guard !kids.isEmpty else { return }
            let span = to - from
            let share = kids.count > 1 ? (brain.nodes[kids[0]].kind == .note ? 0.04 : brain.nodes[i].depth == 0 ? gapShare : 0.1) : 0
            let gap = (span * share) / Double(kids.count)
            let total = kids.reduce(0) { $0 + weight[$1] }
            var at = from + gap / 2
            for child in kids {
                let w = ((span - gap * Double(kids.count)) * weight[child]) / (total == 0 ? 1 : total)
                place(child, at, at + w)
                at += w + gap
            }
        }
        place(0, -.pi / 2, 3 * .pi / 2)
    }

    /// `edgeStyle`: a stale branch thin and faint, a fresh one thicker and tinted.
    public static func edgeStyle(_ node: Node) -> (width: Double, alpha: Double, tinted: Bool) {
        if node.age >= staleDays { return (node.kind == .note ? 0.7 : 1, 0.32, false) }
        let base = node.kind == .note ? 0.9 : node.kind == .topic ? 1.6 : 2.4
        return (base + node.recency * (node.kind == .note ? 1.8 : 2.6), 0.45 + 0.5 * node.recency, true)
    }

    /// `nodeSize`: a node's radius on screen at zoom `s`.
    public static func nodeSize(_ node: Node, scale s: Double) -> Double {
        let z = min(1.6, max(0.55, s.squareRoot()))
        switch node.kind {
        case .root: return 15 * z + 4
        case .tier: return (7 + min(5, Double(node.count).squareRoot())) * z
        case .topic: return (3.5 + min(4, Double(node.count).squareRoot() * 0.8)) * z
        case .note: return 2.6 * z
        }
    }

    /// `spotlight`: the nodes whose label matches (accents folded) and
    /// their ancestors; nil for an empty query (nothing dimmed).
    public static func spotlight(_ brain: Brain, query: String) -> Set<Int>? {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
        guard !q.isEmpty else { return nil }
        var lit = Set<Int>()
        for (i, node) in brain.nodes.enumerated() where node.label.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).contains(q) {
            var at = i
            while at >= 0, lit.insert(at).inserted || at == i { at = brain.nodes[at].parent }
        }
        return lit
    }

    /// Fit the whole brain in a `width` x `height` view with `pad`.
    public static func fit(_ brain: Brain, width: Double, height: Double, pad: Double = 24) -> (scale: Double, tx: Double, ty: Double) {
        let outer = (brain.rings.last ?? 100) + 40
        let s = max(0.05, min((width - pad * 2) / (outer * 2), (height - pad * 2) / (outer * 2)))
        return (s, width / 2, height / 2)
    }
}
