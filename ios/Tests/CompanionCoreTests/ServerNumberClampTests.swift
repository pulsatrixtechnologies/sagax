import XCTest
@testable import CompanionCore

/// Numbers a bot or the server writes never trap `Int(_:)` (2026-11-01 audit).
final class ServerNumberClampTests: XCTestCase {
    func testWidgetIntegersAreClampedAndFinite() throws {
        let node = ChatWidgetNode(type: "grid", id: "n1", props: ["colSpan": .number(1e20), "rows": .number(-3), "step": .number(2.7)])
        XCTAssertEqual(node.integer("colSpan", in: 1...12), 12)
        XCTAssertEqual(node.integer("rows", in: 1...40), 1)
        XCTAssertEqual(node.integer("step", in: 1...100), 2)
        XCTAssertNil(node.integer("missing", in: 1...3))
    }

    func testDurationsOfAbsurdLengthDoNotTrap() {
        XCTAssertEqual(BotActivityRules.duration(.nan), "0s")
        XCTAssertFalse(BotActivityRules.duration(1e300).isEmpty)
    }
}
