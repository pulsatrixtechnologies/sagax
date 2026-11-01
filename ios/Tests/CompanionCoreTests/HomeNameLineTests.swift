import XCTest
@testable import CompanionCore

final class HomeNameLineTests: XCTestCase {
    func testNameAndRoleShareOneLine() {
        XCTAssertEqual(HomeNameLine.text(name: "Scout", role: "Researcher"), "Scout · Researcher")
    }

    func testNoRoleLeavesTheName() {
        XCTAssertEqual(HomeNameLine.text(name: "Scout", role: ""), "Scout")
        XCTAssertEqual(HomeNameLine.text(name: "Scout", role: "  "), "Scout")
    }

    func testARoleAlreadyInTheNameIsNotRepeated() {
        XCTAssertEqual(HomeNameLine.text(name: "Katarina · Ops lead", role: "ops lead"), "Katarina · Ops lead")
    }
}
