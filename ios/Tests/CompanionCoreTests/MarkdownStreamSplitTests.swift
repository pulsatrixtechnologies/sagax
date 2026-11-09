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

    func testAnIndentedContinuationIsNotCut() {
        // '- item' then an indented line after a blank belongs to the item
        XCTAssertEqual(MarkdownStreamSplit.stablePrefixLength("- item\n\n  more of it"), 0)
    }

    func testFootnotesAndLinkDefinitionsAreNeverCut() {
        XCTAssertEqual(MarkdownStreamSplit.stablePrefixLength("See [^1].\n\nMore\n\n[^1]: note"), 0)
        XCTAssertEqual(MarkdownStreamSplit.stablePrefixLength("See [a][x].\n\n[x]: https://example.com"), 0)
    }

    /// The point of the cut: the parts parsed apart are the whole parsed
    /// once, so the reply does not jump when it settles.
    func testHeadPlusTailParsesLikeTheWhole() {
        let samples = [
            "First paragraph.\n\nSecond paragraph.\n\nThird",
            "- one\n- two\n\n- three\n\nAfter the list",
            "- item\n\n  more of it\n\nNext",
            "1. a\n2. b\n\nText after",
            "# Title\n\nBody text\n\n```swift\nlet a = 1\n\nlet b = 2\n```\n\nEnd",
            "> quoted\n\n> again\n\nplain",
            "| a | b |\n| - | - |\n| 1 | 2 |\n\nAfter the table",
            "Intro\n\n\n\nTwo blank lines above",
            // #3029: the shapes a reply streams most, each cut at every byte
            "1. a\n\n2. b\n\n3. c\n\nDone",
            "- a\n  - nested\n\n- b\n\nAfter",
            "- [ ] todo\n\n- [x] done\n\nText",
            "Title\n=====\n\nBody\n\nSub\n---\n\nMore",
            "Text\n\n---\n\nAfter the rule",
            "> [!NOTE]\n> body\n\n> [!WARNING]\n> other\n\nPlain",
            "| a | b |\n| - | - |\n| 1 | 2 |\n\n| c | d |\n| - | - |\n| 3 | 4 |",
            "Para one\nstill one\n\n## Heading\n\n~~~\ncode\n\nmore\n~~~\n\nTail",
            "Look: ![pic](https://x.y/a.png)\n\nNext line",
            "<details>\n<summary>s</summary>\n\nbody\n\n</details>\n\nAfter",
            "$$\nx^2\n\ny\n$$\n\nAfter math",
            "* star\n\n+ plus\n\n1) paren\n\nEnd",
            "Para\n\n    indented code\n\n    more code\n\nBack",
        ]
        for sample in samples {
            for end in stride(from: 1, through: sample.utf8.count, by: 1) {
                let bytes = Array(sample.utf8)[0..<end]
                guard let partial = String(bytes: bytes, encoding: .utf8) else { continue }
                let (stable, tail) = MarkdownStreamSplit.split(partial)
                guard !stable.isEmpty else { continue }
                let apart = Markdown.blocks(stable) + (tail.isEmpty ? [] : Markdown.blocks(tail))
                XCTAssertEqual(apart, Markdown.blocks(partial), "split of \(partial.debugDescription)")
            }
        }
    }
}
