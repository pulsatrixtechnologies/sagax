import XCTest
@testable import CompanionCore

final class BotEditSearchTests: XCTestCase {
    private func found(_ query: String, _ context: BotEditContext = .everything) -> [BotEditItem] {
        BotEditSearch.results(query, context: context) { $0.rawValue }
    }

    func testEmptyQueryReturnsNothing() {
        XCTAssertTrue(found("").isEmpty)
        XCTAssertTrue(found("   ").isEmpty)
    }

    func testAWordLeadsToItsRowInFrenchAndEnglish() {
        XCTAssertEqual(found("mascotte").first, .avatar)
        XCTAssertEqual(found("mascot").first, .avatar)
        XCTAssertEqual(found("moteur").first, .model)
        XCTAssertEqual(found("engine").first, .model)
        XCTAssertFalse(found("moteur").contains(.identity))
        XCTAssertFalse(found("engine").contains(.identity))
        XCTAssertTrue(found("voix").contains(.callVoice))
        XCTAssertTrue(found("horaire").contains(.routines))
        XCTAssertTrue(found("approbation").contains(.approvals))
        // Tools and apps opens Access directly (lot 2); the Access leaf is gone.
        XCTAssertTrue(found("MCP").contains(.toolsApps))
        XCTAssertFalse(found("MCP").contains(.access))
        XCTAssertTrue(found("modele").contains(.model))
    }

    func testALabelRanksBeforeTheIndex() {
        XCTAssertEqual(found("model").first, .model)
    }

    func testNothingMatches() {
        XCTAssertTrue(found("zzzxq").isEmpty)
    }

    func testARowTheContextDoesNotReachIsNotOffered() {
        let context = BotEditContext(sections: [.model], archive: false, delete: false)
        XCTAssertFalse(found("slack", context).contains(.slack))
        XCTAssertTrue(found("moteur", context).contains(.model))
    }

    func testArchiveAndDeleteAreNeverResults() {
        XCTAssertFalse(found("archive").contains(.archive))
        XCTAssertFalse(found("delete").contains(.delete))
    }
}
