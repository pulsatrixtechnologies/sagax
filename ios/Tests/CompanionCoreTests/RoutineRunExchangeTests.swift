import XCTest
@testable import CompanionCore

final class RoutineRunExchangeTests: XCTestCase {
    func testShortInstructionsStayWhole() {
        XCTAssertEqual(RoutineRunExchange.instructionPreview("  Check the inbox.\n"), "Check the inbox.")
    }

    func testLongInstructionsAreTrimmed() {
        let long = String(repeating: "a", count: RoutineRunExchange.instructionLimit + 50)
        let preview = RoutineRunExchange.instructionPreview(long)
        XCTAssertEqual(preview.count, RoutineRunExchange.instructionLimit + 1)
        XCTAssertTrue(preview.hasSuffix("…"))
    }
}
