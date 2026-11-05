// iPad lot 3: the command palette's order and ranking (DesktopPalette.swift),
// the desktop's palette-commands.ts and palette-rank.ts.
import XCTest
@testable import CompanionCore

final class DesktopPaletteTests: XCTestCase {
    private func item(_ id: String, _ group: DesktopPaletteGroup, _ label: String, words: [String] = []) -> DesktopPaletteItem<String> {
        DesktopPaletteItem(id: id, group: group, label: label, words: words, action: id)
    }

    func testTiersFollowTheDesktop() {
        XCTAssertEqual(DesktopPalette.tier(label: "Réglages", query: "reg"), 0, "prefix, accents folded")
        XCTAssertEqual(DesktopPalette.tier(label: "Open settings", query: "set"), 1, "start of a word")
        XCTAssertEqual(DesktopPalette.tier(label: "Keepler", query: "epl"), 2, "substring")
        XCTAssertEqual(DesktopPalette.tier(label: "Orion", query: "anal", words: ["Analyst"]), 3, "a search word")
        XCTAssertEqual(DesktopPalette.tier(label: "Nouvelle conversation", query: "nvconv"), 4, "letters in order")
        XCTAssertNil(DesktopPalette.tier(label: "Orion", query: "zz"))
    }

    func testNoQueryPutsRecentFirstAndTakesItOutOfItsGroup() {
        let items = [
            item("room:a", .conversations, "Peer Managers"),
            item("bot:1", .bots, "Orion"), item("bot:2", .bots, "Liora"),
            item("cmd:settings", .settings, "Open settings"),
        ]
        let sections = DesktopPalette.sections(items: items, query: "", recents: ["bot:2", "missing"])
        XCTAssertEqual(sections.map(\.group), [.recent, .conversations, .bots, .settings])
        XCTAssertEqual(sections[0].items.map(\.id), ["bot:2"])
        XCTAssertEqual(sections[2].items.map(\.id), ["bot:1"])
    }

    func testAQueryRanksEachGroupAndAddsTheMessages() {
        let items = [item("bot:1", .bots, "Aurora"), item("bot:2", .bots, "Laura"), item("cmd:routines", .navigation, "Routines")]
        let hit = item("msg:1", .messages, "Ara")
        let sections = DesktopPalette.sections(items: items, query: "aur", recents: ["bot:1"], messages: [hit])
        XCTAssertEqual(sections.map(\.group), [.bots, .messages], "no Recent while typing")
        XCTAssertEqual(sections[0].items.map(\.id), ["bot:1", "bot:2"], "prefix before substring")
    }

    func testRememberKeepsFiveWithoutRepeats() {
        let recents = DesktopPalette.remember("c", in: ["a", "b", "c", "d", "e", "f"])
        XCTAssertEqual(recents, ["c", "a", "b", "d", "e"])
    }
}
