// Mirrors src/lib/memory-folders.test.ts.
import XCTest
@testable import CompanionCore

final class MemoryFoldersTests: XCTestCase {
    private let bots = [
        LinkBot(id: "ember", name: "Ember", color: "orange", section: ""),
        LinkBot(id: "kat", name: "Osprey", section: "built-in"),
        LinkBot(id: "old", name: "Old", section: "", hidden: true),
    ]
    private let routines = [LinkRoutine(name: "Morning tidy", botId: "ember"), LinkRoutine(name: "Report", botId: "kat")]

    func testLinksABotsMemoryToTheBotWithItsRoutines() {
        let link = MemoryFolders.botSourceLink(MemoryManagerSource(id: "bot:ember", kind: .bot, name: "Ember", mayWrite: true, botId: "ember", linked: true), bots: bots, routines: routines)
        XCTAssertTrue(MemoryFolders.isLinked(link))
        XCTAssertEqual(MemoryFolders.botNames(link), "Ember")
        XCTAssertEqual(link.routines, ["Morning tidy"])
        // the server's word stands when the page does not hold the bot
        let far = MemoryFolders.botSourceLink(MemoryManagerSource(id: "bot:far", kind: .bot, name: "Far", mayWrite: true, botId: "far"), bots: bots, routines: routines)
        XCTAssertTrue(MemoryFolders.isLinked(far))
    }

    func testLeavesATemporaryAgentsMemoryUnlinked() {
        let source = MemoryManagerSource(id: "bot:perf", kind: .bot, name: "perf-test-061", mayWrite: true, botId: "perf", linked: false)
        XCTAssertFalse(MemoryFolders.isLinked(MemoryFolders.botSourceLink(source, bots: bots, routines: routines)))
    }

    func testLinksAPerspicaxSagaxBotFolderToThatBotWhileItExists() {
        XCTAssertEqual(MemoryFolders.botNames(MemoryFolders.pxFolderLink("sagax-osprey", bots: bots, routines: routines)), "Osprey")
        XCTAssertFalse(MemoryFolders.isLinked(MemoryFolders.pxFolderLink("sagax-old", bots: bots, routines: routines)))
        XCTAssertFalse(MemoryFolders.isLinked(MemoryFolders.pxFolderLink("notes", bots: bots, routines: routines)))
    }

    func testSaysWhichBotsReadATeamSectionsFoldersNoneOwningThem() {
        let link = MemoryFolders.teamFolderLink(section: "built-in", bots: bots)
        XCTAssertFalse(MemoryFolders.isLinked(link))
        XCTAssertEqual(link.readBy, ["Osprey"])
        XCTAssertEqual(MemoryFolders.teamFolderLink(section: "", bots: bots).readBy, ["Ember"])
    }

    func testDeleteFolderIsGreyedWithTheReason() {
        let linked = MemoryFolders.pxFolderLink("sagax-osprey", bots: bots, routines: routines)
        XCTAssertEqual(MemoryFolders.deleteBlock(link: linked, isTeam: false, mayWrite: true), .linked(bots: "Osprey"))
        XCTAssertEqual(MemoryFolders.deleteBlock(link: .unlinked, isTeam: true, mayWrite: true), .teamKind)
        XCTAssertEqual(MemoryFolders.deleteBlock(link: .unlinked, isTeam: false, mayWrite: false), .readOnly)
        XCTAssertNil(MemoryFolders.deleteBlock(link: .unlinked, isTeam: false, mayWrite: true))
    }

    func testTheSourceReadsLinkedFromTheServer() throws {
        let json = #"{"id":"bot:perf","kind":"bot","name":"perf","mayWrite":true,"botId":"perf","linked":false}"#
        let source = try JSONDecoder().decode(MemoryManagerSource.self, from: Data(json.utf8))
        XCTAssertEqual(source.linked, false)
    }
}
