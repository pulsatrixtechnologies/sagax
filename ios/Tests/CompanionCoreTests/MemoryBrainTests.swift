// iPad lot 5: the radial memory brain (MemoryBrain.swift), as
// src/lib/memory-brain.ts lays it out.
import XCTest
@testable import CompanionCore

final class MemoryBrainTests: XCTestCase {
    private let now = 1_800_000_000_000.0

    private func sample() -> MemoryBrain.Brain {
        MemoryBrain.build(tiers: [
            .init(scope: "bot:a", name: "Orion", notes: [
                .init(id: "1", title: "MEMORY.md", topic: "notes", updated: now),
                .init(id: "2", title: "", topic: "logs", updated: now - 40 * MemoryBrain.dayMs),
            ]),
            .init(scope: "team:general", name: "General", notes: []),
        ], rootLabel: "All", untitled: "Untitled", now: now)
    }

    func testTheTreeIsRootTiersTopicsNotes() {
        let brain = sample()
        XCTAssertEqual(brain.nodes.map(\.kind), [.root, .tier, .topic, .note, .topic, .note, .tier])
        XCTAssertEqual(brain.notes, 2)
        XCTAssertEqual(brain.nodes[0].count, 2)
        XCTAssertEqual(brain.nodes[5].label, "MEMORY.md", "topics sorted: logs before notes")
        XCTAssertEqual(brain.nodes[3].label, "Untitled")
    }

    func testRingsGrowOutwardAndTheRootSitsAtTheCentre() {
        let brain = sample()
        XCTAssertEqual(brain.rings.count, 4)
        XCTAssertEqual(brain.rings[0], 0)
        XCTAssertLessThan(brain.rings[1], brain.rings[2])
        XCTAssertLessThan(brain.rings[2], brain.rings[3])
        XCTAssertEqual(brain.nodes[0].x, 0, accuracy: 1e-9)
        for node in brain.nodes where node.kind == .note {
            XCTAssertEqual((node.x * node.x + node.y * node.y).squareRoot(), brain.rings[3], accuracy: 1e-6)
        }
    }

    func testRecencyAndTheStaleLine() {
        XCTAssertEqual(MemoryBrain.recency(updated: now, now: now).recency, 1, accuracy: 1e-9)
        XCTAssertEqual(MemoryBrain.recency(updated: now - 31 * MemoryBrain.dayMs, now: now).recency, 0)
        let stale = sample().nodes[3]
        XCTAssertEqual(MemoryBrain.edgeStyle(stale).alpha, 0.32, accuracy: 1e-9)
    }

    func testTheSpotlightLightsMatchesAndTheirAncestors() {
        let brain = sample()
        XCTAssertNil(MemoryBrain.spotlight(brain, query: " "))
        let lit = MemoryBrain.spotlight(brain, query: "memory") ?? []
        XCTAssertTrue(lit.contains(5))
        XCTAssertTrue(lit.contains(4) && lit.contains(1) && lit.contains(0))
        XCTAssertFalse(lit.contains(6))
    }
}
