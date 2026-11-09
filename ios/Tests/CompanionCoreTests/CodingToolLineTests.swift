import XCTest
@testable import CompanionCore

final class CodingToolLineTests: XCTestCase {
    func testReadLine() {
        let line = CodingToolLines.line(for: .read(id: "r", paths: ["src/a.ts"]))
        XCTAssertEqual(line.name, "Read")
        XCTAssertEqual(line.arg, "src/a.ts")
    }

    func testReadManyUsesBaseNames() {
        let line = CodingToolLines.readsLine(paths: ["src/a.ts", "lib/b.ts"])
        XCTAssertEqual(line.arg, "a.ts, b.ts")
    }

    func testBashStripsLeadingCd() {
        XCTAssertEqual(CodingToolLines.shortCommand("cd /repo && pnpm test"), "pnpm test")
    }

    func testWaitCommands() {
        XCTAssertTrue(CodingToolLines.isWaitCommand("sleep 5 && pgrep node"))
        XCTAssertFalse(CodingToolLines.isWaitCommand("pnpm test"))
    }

    func testPreviewCountsRemainingLines() {
        let p = CodingToolLines.preview("\none\ntwo\nthree\nfour\nfive\n")
        XCTAssertEqual(p.lines, ["one", "two", "three"])
        XCTAssertEqual(p.more, 2)
    }

    func testDuration() {
        XCTAssertEqual(CodingToolLines.duration(4000), "4s")
        XCTAssertEqual(CodingToolLines.duration(65000), "1m 05s")
        XCTAssertEqual(CodingToolLines.duration(200), "<1s")
        XCTAssertNil(CodingToolLines.duration(nil))
    }
}
