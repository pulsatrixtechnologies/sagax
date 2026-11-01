import XCTest
@testable import CompanionCore

final class LongTranscriptTests: XCTestCase {
    func testMessagesAreChainedOldestFirst() {
        let rows = LongTranscript.messages(count: 5, idPrefix: "t", baseAt: 1000)
        XCTAssertEqual(rows.map(\.id), ["t-0", "t-1", "t-2", "t-3", "t-4"])
        XCTAssertEqual(rows.map(\.role), [.user, .bot, .user, .bot, .user])
        XCTAssertNil(rows[0].parentId)
        XCTAssertEqual(rows[1].parentId, "t-0")
        XCTAssertEqual(rows[4].parentId, "t-3")
        XCTAssertEqual(rows[4].at, 1000 + 4 * 60_000)
    }

    func testDefaultPreviewCount() {
        XCTAssertNil(LongTranscript.previewCount(in: ["-store-preview"]))
        XCTAssertEqual(LongTranscript.previewCount(in: ["-long-transcript-preview"]), 2000)
        XCTAssertEqual(LongTranscript.previewCount(in: ["-long-transcript-preview", "250"]), 250)
        XCTAssertEqual(LongTranscript.previewCount(in: ["-long-transcript-preview", "nope"]), 2000)
    }

    func testEmptyCount() {
        XCTAssertTrue(LongTranscript.messages(count: 0).isEmpty)
        XCTAssertTrue(LongTranscript.messages(count: -3).isEmpty)
    }
}
