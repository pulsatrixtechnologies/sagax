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

    /// Lot 5: detail shows Instruction body when present; empty uses placeholder.
    func testInstructionBodySkipsBlankPrompt() {
        XCTAssertEqual(RoutineDetailSections.instructionBody("  Read the inbox.  "), "Read the inbox.")
        XCTAssertNil(RoutineDetailSections.instructionBody("   "))
        XCTAssertNil(RoutineDetailSections.instructionBody(""))
    }

    /// Lot 5: Webhook section only for a webhook trigger.
    func testWebhookSectionOnlyForWebhookSchedule() {
        XCTAssertTrue(RoutineDetailSections.showsWebhook(RoutineSchedule(type: .webhook)))
        XCTAssertFalse(RoutineDetailSections.showsWebhook(RoutineSchedule(type: .cron, expression: "0 8 * * 1-5")))
        XCTAssertFalse(RoutineDetailSections.showsWebhook(RoutineSchedule(type: .daily, time: "08:00")))
        XCTAssertFalse(RoutineDetailSections.showsWebhook(RoutineSchedule(type: .event)))
    }
}
