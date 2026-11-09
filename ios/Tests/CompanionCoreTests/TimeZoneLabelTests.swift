import XCTest
@testable import CompanionCore

final class TimeZoneLabelTests: XCTestCase {
    func testEasternHasAHumanName() {
        XCTAssertEqual(TimeZoneLabel.human("America/Toronto"), "Eastern Time")
        XCTAssertEqual(TimeZoneLabel.human("America/New_York"), "Eastern Time")
    }

    func testUtcAndUnknown() {
        XCTAssertEqual(TimeZoneLabel.human("UTC"), "UTC")
        XCTAssertEqual(TimeZoneLabel.human("Nowhere/Land_X"), "Nowhere/Land X")
    }

    func testDetailedKeepsTheId() {
        XCTAssertEqual(TimeZoneLabel.detailed("America/Toronto"), "Eastern Time (America/Toronto)")
    }
}
