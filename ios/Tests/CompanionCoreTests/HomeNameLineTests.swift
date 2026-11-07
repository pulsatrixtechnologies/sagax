import XCTest
@testable import CompanionCore

final class HomeNameLineTests: XCTestCase {
    func testRoleSitsOnItsOwnLineUnderTheName() {
        let lines = HomeNameLine.lines(name: "Scout", role: "Researcher")
        XCTAssertEqual(lines.name, "Scout")
        XCTAssertEqual(lines.role, "Researcher")
        XCTAssertFalse(lines.name.contains("·"))
    }

    func testNoRoleLeavesTheName() {
        XCTAssertEqual(HomeNameLine.lines(name: "Scout", role: "").name, "Scout")
        XCTAssertNil(HomeNameLine.lines(name: "Scout", role: "").role)
        XCTAssertNil(HomeNameLine.lines(name: "Scout", role: "  ").role)
    }

    func testRoleIsTrimmed() {
        XCTAssertEqual(HomeNameLine.lines(name: "Ara", role: "  Admin ").role, "Admin")
    }

    func testARoleAlreadyInTheNameIsNotRepeated() {
        let lines = HomeNameLine.lines(name: "Osprey Ops lead", role: "ops lead")
        XCTAssertEqual(lines.name, "Osprey Ops lead")
        XCTAssertNil(lines.role)
    }
}
