// iPad lot 5b: the Obsidian-like memory graph (MemoryGraph.swift), the same
// rules as src/lib/memory-graph.test.ts.
import XCTest
@testable import CompanionCore

final class MemoryGraphTests: XCTestCase {
    private func note(_ key: String, _ title: String, folder: String = "Atlas / Topics", tags: [String] = [], body: String? = nil, path: String? = nil) -> MemoryGraph.Note {
        MemoryGraph.Note(key: key, title: title, tier: "bot:atlas", tierName: "Atlas", folderPath: folder, tags: tags, body: body, path: path)
    }

    private func ring(_ n: Int) -> [MemoryGraph.Note] {
        (0..<n).map { i in note("k\(i)", "Note \(i)", folder: i % 3 == 0 ? "Atlas / Logs" : "Atlas / Topics", body: "[[Note \((i + 1) % n)]] [[Note \((i * 7) % n)]]") }
    }

    func testBodyRefsReadLinksEmbedsAndImages() {
        let refs = MemoryGraph.bodyRefs("See [[Dining|the dining note]] and [[Travel#Trains]], ![[map.png]], ![x](files/plan%20a.pdf)")
        XCTAssertEqual(refs.notes, ["dining", "travel"])
        XCTAssertEqual(refs.attachments, ["map.png", "plan a.pdf"])
    }

    func testLinksAndTheFolderHierarchy() {
        let notes = [note("a", "Dining", body: "[[Travel]] [[Nowhere]]"), note("b", "Travel", path: "memory/travel.md"), note("c", "Run 1", folder: "Atlas / Logs")]
        var flatFilters = MemoryGraph.Filters(); flatFilters.folders = false; flatFilters.existingOnly = true
        let flat = MemoryGraph.build(notes, filters: flatFilters)
        XCTAssertEqual(flat.nodes.map(\.id), ["n:a", "n:b", "n:c"])
        XCTAssertEqual(flat.noteLinks, 1)
        let tree = MemoryGraph.build(notes, filters: MemoryGraph.Filters())
        let ids = tree.nodes.map(\.id)
        for id in ["g:nowhere", "r:bot:atlas", "f:bot:atlas:Atlas / Topics", "f:bot:atlas:Atlas / Logs"] { XCTAssertTrue(ids.contains(id), id) }
        let run = tree.index["n:c"]!
        XCTAssertEqual(tree.nodes[tree.nodes[run].parent].id, "f:bot:atlas:Atlas / Logs")
    }

    func testOrphansTagsAndAttachments() {
        let notes = [note("a", "A", tags: ["work"], body: "[[B]] ![[x.png]]"), note("b", "B"), note("c", "Alone")]
        var filters = MemoryGraph.Filters(); filters.folders = false; filters.orphans = false; filters.tags = true; filters.attachments = true
        let g = MemoryGraph.build(notes, filters: filters)
        let ids = g.nodes.map(\.id)
        XCTAssertFalse(ids.contains("n:c"))
        for id in ["n:a", "n:b", "t:work", "a:x.png"] { XCTAssertTrue(ids.contains(id), id) }
        for link in g.links { XCTAssertTrue(g.nodes.indices.contains(link.source) && g.nodes.indices.contains(link.target)) }
    }

    func testQueries() {
        let m = { (q: String) in MemoryGraph.matches(label: "Weekly review", folderPath: "Reading / Weekly", tags: ["#work", "area/home"], kind: .note, tierName: "My memory", query: q) }
        XCTAssertTrue(m("tag:#work"))
        XCTAssertTrue(m("tag:area"))
        XCTAssertTrue(m("path:reading weekly"))
        XCTAssertTrue(m("tier:memory"))
        XCTAssertFalse(m("tag:home"))
    }

    func testNeighbourhoodAndDepth() {
        let notes = [note("a", "A", body: "[[B]] [[C]]"), note("b", "B"), note("c", "C", body: "[[D]]"), note("d", "D")]
        var filters = MemoryGraph.Filters(); filters.folders = false
        let g = MemoryGraph.build(notes, filters: filters)
        let a = g.index["n:a"]!
        XCTAssertEqual(MemoryGraph.neighbourSet(g, a).map { g.nodes[$0].id }.sorted(), ["n:a", "n:b", "n:c"])
        XCTAssertTrue(MemoryGraph.neighbourSet(g, -1).isEmpty)
        XCTAssertEqual(MemoryGraph.withinDepth(g, a, 2).map { g.nodes[$0].id }.sorted(), ["n:a", "n:b", "n:c", "n:d"])
    }

    func testSeededAndSettles() {
        let g = MemoryGraph.build(ring(120), filters: MemoryGraph.Filters())
        let one = MemoryGraph.Simulation(links: g.links, n: g.nodes.count, seed: 1)
        let two = MemoryGraph.Simulation(links: g.links, n: g.nodes.count, seed: 1)
        for _ in 0..<20 { one.tick(); two.tick() }
        XCTAssertEqual(one.x, two.x)
        let sim = MemoryGraph.Simulation(links: g.links, n: g.nodes.count, seed: 1)
        let ticks = sim.settle()
        XCTAssertTrue(sim.settled())
        XCTAssertLessThan(ticks, 4000)
        XCTAssertTrue(sim.x.allSatisfy(\.isFinite))
        let dist = { (a: Int, b: Int) in hypot(sim.x[a] - sim.x[b], sim.y[a] - sim.y[b]) }
        let linked = g.links.reduce(0.0) { $0 + dist($1.source, $1.target) } / Double(g.links.count)
        var any = 0.0
        for i in 0..<120 { any += dist(i, (i * 37 + 11) % sim.n) }
        XCTAssertLessThan(linked, any / 120)
    }

    func testPinnedAndStart() {
        let g = MemoryGraph.build(ring(30), filters: MemoryGraph.Filters())
        let sim = MemoryGraph.Simulation(links: g.links, n: g.nodes.count, seed: 2)
        sim.settle()
        sim.pin(0, 500, 500); sim.alphaTarget = 0.3; sim.reheat(0.3)
        for _ in 0..<30 { sim.tick() }
        XCTAssertEqual(sim.x[0], 500); XCTAssertEqual(sim.y[0], 500)
        sim.release(0); sim.alphaTarget = 0
        sim.settle()
        XCTAssertTrue(sim.settled())
        let placed = MemoryGraph.Simulation(links: [], n: 2, start: { $0 == 0 ? (40, -10) : nil })
        XCTAssertEqual(placed.x[0], 40); XCTAssertEqual(placed.y[0], -10)
    }

    func testLabelFadeRadiusAndSettings() {
        XCTAssertEqual(MemoryGraph.labelOpacity(0.3), 0)
        XCTAssertEqual(MemoryGraph.labelOpacity(2), 1)
        XCTAssertEqual(MemoryGraph.labelOpacity(0.8, threshold: 1), 0)
        XCTAssertEqual(MemoryGraph.labelOpacity(0.8, threshold: -1), 1)
        XCTAssertLessThan(MemoryGraph.nodeRadius(degree: 0, kind: .note), MemoryGraph.nodeRadius(degree: 9, kind: .note))
        XCTAssertLessThan(MemoryGraph.nodeRadius(degree: 400, kind: .note), MemoryGraph.nodeRadius(degree: 0, kind: .note) * 5)
        var settings = MemoryGraph.Settings()
        settings.forces.repel = 99
        settings.groups = [.init(query: "x", color: "red"), .init(query: "y", color: "#AABBCC")]
        let clean = settings.cleaned()
        XCTAssertEqual(clean.forces.repel, 20)
        XCTAssertEqual(clean.groups, [.init(query: "y", color: "#aabbcc")])
        XCTAssertEqual(MemoryGraph.stableIndex("bot:a/notes", 6), MemoryGraph.stableIndex("bot:a/notes", 6))
    }
}
