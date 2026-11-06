import Foundation
import XCTest
@testable import CompanionCore

final class PlanUsageTests: XCTestCase {
    func testDecodesAndFormats() throws {
        let json = #"""
        {"fetchedAt":"2026-10-04T12:00:00.000Z","providers":[
          {"id":"claude","name":"Claude","driver":"claude","plan":"Max","ok":true,"error":null,
           "fiveHour":{"available":true,"remainingPercent":72,"usedPercent":28,"resetsAt":"2026-10-04T14:30:00.000Z"},
           "weekly":{"available":false,"remainingPercent":null,"usedPercent":null,"resetsAt":null},
           "extra":[{"label":"Opus","remainingPercent":10,"usedPercent":90,"resetsAt":null}]},
          {"id":"codex","name":"ChatGPT plan","driver":"codex","plan":null,"ok":false,"error":"Sign in again in Codex",
           "fiveHour":{"available":false,"remainingPercent":null,"usedPercent":null,"resetsAt":null},
           "weekly":{"available":false,"remainingPercent":null,"usedPercent":null,"resetsAt":null},"extra":[]}]}
        """#
        let report = try JSONDecoder().decode(PlanUsageReport.self, from: Data(json.utf8))
        XCTAssertEqual(report.providers.count, 2)
        XCTAssertEqual(report.providers[1].error, "Sign in again in Codex")
        let now = ISO8601DateFormatter().date(from: "2026-10-04T12:00:00Z")!
        XCTAssertEqual(PlanUsageRules.resetDistance("2026-10-04T14:30:00.000Z", now: now), "2h 30m")
        XCTAssertEqual(PlanUsageRules.resetDistance("2026-10-06T15:00:00Z", now: now), "2d 3h")
        XCTAssertNil(PlanUsageRules.resetDistance("2026-10-04T11:00:00Z", now: now))
        XCTAssertEqual(PlanUsageRules.tone(used: 90), .danger)
        XCTAssertEqual(PlanUsageRules.tone(used: 70), .warning)
        XCTAssertEqual(PlanUsageRules.tone(used: 10), .success)
        XCTAssertFalse(PlanUsageRules.hasDueReset(report, now: now))
        XCTAssertTrue(PlanUsageRules.hasDueReset(report, now: now.addingTimeInterval(4 * 3600)))
        XCTAssertEqual(PlanUsageRules.connected(report).map(\.id), ["claude"])
        XCTAssertTrue(PlanUsageRules.connected(nil).isEmpty)
    }
}
