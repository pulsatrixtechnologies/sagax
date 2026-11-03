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
        XCTAssertEqual(HomeNameLine.text(name: "Osprey · Ops lead", role: "ops lead"), "Osprey · Ops lead")
    }
}
