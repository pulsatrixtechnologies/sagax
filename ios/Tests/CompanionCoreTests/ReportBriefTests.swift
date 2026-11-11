import Foundation
import XCTest
@testable import CompanionCore

/// The brief of a result (#3581): the server's and the desktop's cases
/// (shared/routine-result.vectors.json), run here too.
final class ReportBriefTests: XCTestCase {
    func testSharedVectors() throws {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("shared/routine-result.vectors.json")
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let cases = try XCTUnwrap(root["cases"] as? [[String: Any]])
        XCTAssertGreaterThan(cases.count, 20)
        for item in cases {
            let name = try XCTUnwrap(item["name"] as? String)
            let from = try XCTUnwrap(ReportBrief.From(rawValue: XCTUnwrap(item["from"] as? String)), name)
            let brief = ReportBrief.of(item["text"] as? String, from: from)
            XCTAssertEqual(brief, item["brief"] as? String, name)
            XCTAssertLessThanOrEqual(brief.count, ReportBrief.max, name)
        }
    }

    func testACardStoredWithoutABriefReadsItFromItsReport() {
        let report = "Here is this morning's pass.\n\nI read 14 new messages.\n\n3 messages need you."
        let stored = RoutineRunCard(runId: "r", routineId: "x", routineName: "Inbox", status: "completed", summary: report)
        XCTAssertEqual(stored.brief, nil)
        XCTAssertEqual(stored.briefText, "3 messages need you.")
        var written = stored
        written.brief = "The server's own line."
        XCTAssertEqual(written.briefText, "The server's own line.")
    }
}
