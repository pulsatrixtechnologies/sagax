import XCTest
@testable import CompanionCore

final class DesktopBotSelectionTests: XCTestCase {
    private func bot(_ id: String, pinned: Bool = false, chief: Bool = false, hidden: Bool = false) -> Bot {
        var bot = Bot(id: id, threadId: "t-\(id)", name: id, title: "", description: "", notifications: true, color: "blue",
                      unread: false, modelSelection: ModelSelection(instanceId: "i", model: "m"), createdAt: 0)
        bot.pinned = pinned
        bot.chiefOfStaff = chief
        bot.hidden = hidden
        return bot
    }

    func testSelectOpensTheModeWithThatBotAndTapsToggle() {
        var selection = DesktopBotSelection()
        XCTAssertFalse(selection.active)
        selection.start(with: "a")
        XCTAssertTrue(selection.active)
        XCTAssertEqual(selection.ids, ["a"])
        selection.toggle("b")
        selection.toggle("a")
        XCTAssertEqual(selection.ids, ["b"])
        // the mode stays open at zero, as the desktop's bar does
        selection.toggle("b")
        XCTAssertTrue(selection.active)
        XCTAssertEqual(selection.ids, [])
        selection.clear()
        XCTAssertFalse(selection.active)
    }

    func testChosenKeepsTheOrderAndDropsGoneBots() {
        var selection = DesktopBotSelection()
        selection.toggle("b"); selection.toggle("gone"); selection.toggle("a")
        XCTAssertEqual(selection.chosen(in: [bot("a"), bot("b")]).map(\.id), ["b", "a"])
    }

    func testPinBecomesUnpinOnlyWhenEveryChosenBotIsPinned() {
        XCTAssertFalse(DesktopBotSelection.allPinned([]))
        XCTAssertFalse(DesktopBotSelection.allPinned([bot("a", pinned: true), bot("b")]))
        XCTAssertTrue(DesktopBotSelection.allPinned([bot("a", pinned: true), bot("b", pinned: true)]))
    }

    func testArchiveSkipsThePrimaryBotAndKeepsOneActiveBot() {
        let all = [bot("chief", chief: true), bot("a"), bot("b"), bot("old", hidden: true)]
        let take = DesktopBotSelection.archivable(all, in: all) { _ in true }
        XCTAssertEqual(take.map(\.id), ["a", "b", "old"].filter { $0 != "old" })
        // three active bots: at most two go
        let three = [bot("a"), bot("b"), bot("c")]
        XCTAssertEqual(DesktopBotSelection.archivable(three, in: three) { _ in true }.map(\.id), ["a", "b"])
        XCTAssertEqual(DesktopBotSelection.archivable(three, in: three) { $0.id != "a" }.map(\.id), ["b", "c"])
    }

    func testBulkOutcomeCounts() {
        let counts = DesktopBulkOutcome.counts([.changed, .skipped, .refused("no"), .changed])
        XCTAssertEqual(counts.ok, 2)
        XCTAssertEqual(counts.failed, 1)
        XCTAssertEqual(counts.skipped, 1)
    }
}
