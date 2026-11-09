// The stable prefix a streamed reply is cut at (#3017, L03): only blank
// lines outside a code fence split, so the settled part never re-parses.
import XCTest
@testable import CompanionCore

final class MarkdownStreamSplitTests: XCTestCase {
    private func prefix(_ source: String) -> String {
        let cut = MarkdownStreamSplit.stablePrefixLength(source)
        return String(decoding: Array(source.utf8)[0..<cut], as: UTF8.self)
    }

    func testNoBlankLineHasNoStablePrefix() {
        XCTAssertEqual(MarkdownStreamSplit.stablePrefixLength("one line still growing"), 0)
    }

    func testCutsAfterTheLastBlankLine() {
        let cut = prefix("First paragraph.\n\nSecond paragraph.\n\nThird, growing")
        XCTAssertTrue(cut.hasSuffix("Second paragraph.\n\n"))
        XCTAssertFalse(cut.contains("Third"))
    }

    func testBlankLinesInsideAnOpenFenceDoNotCut() {
        XCTAssertEqual(prefix("Intro\n\n```swift\nlet a = 1\n\nlet b = 2\n"), "Intro\n\n")
    }
}
