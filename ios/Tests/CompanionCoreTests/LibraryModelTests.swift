// The Library tab's model: files and artifacts in one list, pinned on top,
// then this week, then older, newest first (`src/lib/library-items.ts`); the
// artifact reads and pin; the document an artifact runs in.
import XCTest
@testable import CompanionCore

final class LibraryModelTests: XCTestCase {
    private let day = 24.0 * 3_600_000
    private let now = 1_800_000_000_000.0

    /// A fixed zone, so "today" is the same day on every machine.
    private let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    private func file(_ id: String, daysAgo: Double, pinned: Bool = false) -> ThreadFile {
        ThreadFile(id: id, source: .written, name: "\(id).md", at: now - daysAgo * day, pinned: pinned)
    }

    private func picture(_ name: String, mime: String? = nil, available: Bool = true) -> ThreadFile {
        ThreadFile(id: name, source: .written, name: name, mime: mime, at: now, available: available)
    }

    private func artifact(_ id: String, daysAgo: Double, favorite: Bool = false) -> BotArtifact {
        BotArtifact(id: id, title: id, favorite: favorite, updatedAt: now - daysAgo * day)
    }

    func testMixesFilesAndArtifactsByPeriodNewestFirst() {
        let groups = LibraryRules.groups(
            files: [file("c", daysAgo: 12), file("a", daysAgo: 1)],
            artifacts: [artifact("art_2", daysAgo: 20), artifact("art_1", daysAgo: 0.5)],
            now: now,
            calendar: utc
        )
        XCTAssertEqual(groups.pinned, [])
        XCTAssertEqual(groups.thisWeek.map(\.id), ["artifact:art_1", "file:a"])
        XCTAssertEqual(groups.older.map(\.id), ["file:c", "artifact:art_2"])
    }

    func testPinnedFilesAndArtifactsComeFirstAndAreNotListedAgain() {
        let groups = LibraryRules.groups(
            files: [file("a", daysAgo: 1), file("old", daysAgo: 40, pinned: true)],
            artifacts: [artifact("art_1", daysAgo: 30, favorite: true)],
            now: now,
            calendar: utc
        )
        XCTAssertEqual(groups.pinned.map(\.id), ["artifact:art_1", "file:old"])
        XCTAssertEqual(groups.thisWeek.map(\.id), ["file:a"])
        XCTAssertEqual(groups.older, [])
    }

    func testFilesThatShareATimestampSortByNameNotById() {
        let alpha = ThreadFile(id: "zzz", source: .written, name: "Alpha.md", at: now)
        let zulu = ThreadFile(id: "aaa", source: .written, name: "Zulu.md", at: now)
        let groups = LibraryRules.groups(files: [alpha, zulu], artifacts: [], now: now, calendar: utc)
        XCTAssertEqual(groups.today.map(\.orderName), ["Alpha.md", "Zulu.md"])
    }

    func testTheSevenDayEdgeIsOlderAndNothingIsEmpty() {
        let groups = LibraryRules.groups(files: [file("edge", daysAgo: 7), file("in", daysAgo: 6.99)], artifacts: [], now: now, calendar: utc)
        XCTAssertEqual(groups.thisWeek.map(\.id), ["file:in"])
        XCTAssertEqual(groups.older.map(\.id), ["file:edge"])
        XCTAssertTrue(LibraryRules.groups(files: [], artifacts: [], now: now, calendar: utc).isEmpty)
    }

    func testTodayIsTheCalendarDayThenThisWeekThenOlder() {
        // now is 08:00 UTC: 2 h ago is today, 10 h ago is yesterday.
        let groups = LibraryRules.groups(
            files: [file("now", daysAgo: 2.0 / 24), file("yesterday", daysAgo: 10.0 / 24), file("old", daysAgo: 9)],
            artifacts: [], now: now, calendar: utc
        )
        XCTAssertEqual(groups.today.map(\.id), ["file:now"])
        XCTAssertEqual(groups.thisWeek.map(\.id), ["file:yesterday"])
        XCTAssertEqual(groups.older.map(\.id), ["file:old"])
        XCTAssertFalse(groups.isEmpty)
        XCTAssertEqual(LibraryRules.olderPreview, 5)
    }

    func testEachTypeWearsItsOwnMark() {
        XCTAssertEqual(ThreadFileRules.glyph(of: picture("chart.png", mime: "image/png")), .thumbnail)
        XCTAssertEqual(ThreadFileRules.glyph(of: picture("photo.JPG")), .thumbnail)
        XCTAssertEqual(ThreadFileRules.glyph(of: picture("logo.svg", mime: "image/svg+xml")), .thumbnail)
        // the server cannot draw HEIC, and a missing file has nothing to draw
        XCTAssertEqual(ThreadFileRules.glyph(of: picture("phone.heic", mime: "image/heic")), .image)
        XCTAssertEqual(ThreadFileRules.glyph(of: picture("gone.png", mime: "image/png", available: false)), .image)
        XCTAssertEqual(ThreadFileRules.glyph(of: picture("dashboard.html", mime: "text/html")), .page)
        XCTAssertEqual(ThreadFileRules.glyph(of: picture("plan.md", mime: "text/markdown")), .document)
        XCTAssertEqual(ThreadFileRules.glyph(of: picture("notes.txt")), .document)
        XCTAssertEqual(ThreadFileRules.glyph(of: picture("export.zip", mime: "application/zip")), .archive)
        XCTAssertEqual(ThreadFileRules.glyph(of: picture("report.pdf", mime: "application/pdf")), .pdf)
        XCTAssertEqual(ThreadFileRules.glyph(of: picture("run.py")), .code)
        XCTAssertEqual(ThreadFileRules.glyph(of: picture("blob.bin", mime: "application/octet-stream")), .other)
        XCTAssertEqual(LibraryEntry.artifact(artifact("art_1", daysAgo: 1)).glyph, .page)
    }

    func testArtifactSummaryDecodesAndFlagsAProblem() throws {
        let json = #"{"id":"art_0000001","botId":"bot-1","title":"Queue","favorite":true,"updatedAt":5,"refresh":{"state":"paused","failures":3}}"#
        let item = try JSONDecoder().decode(BotArtifact.self, from: Data(json.utf8))
        XCTAssertEqual(item.title, "Queue")
        XCTAssertTrue(item.favorite)
        XCTAssertTrue(item.needsAttention)
        let bare = try JSONDecoder().decode(BotArtifact.self, from: Data(#"{"id":"art_0000002"}"#.utf8))
        XCTAssertFalse(bare.favorite)
        XCTAssertFalse(bare.needsAttention)
    }

    func testTheOpenedDocumentCarriesItsHtmlAndLastData() {
        let body = #"{"artifact":{"id":"art_0000001","title":"Queue","html":"<p>hi</p>","data":{"at":9,"value":{"open":3}}}}"#
        let document = BotArtifactDocument.parse(Data(body.utf8))
        XCTAssertEqual(document?.html, "<p>hi</p>")
        XCTAssertEqual(document?.dataJSON, #"{"open":3}"#)
        XCTAssertEqual(document?.dataAt, 9)
        XCTAssertNil(BotArtifactDocument.parse(Data(#"{"artifact":{"title":"x"}}"#.utf8)))
        XCTAssertNil(BotArtifactDocument.parse(Data(#"{"artifact":{"html":"x"}}"#.utf8))?.dataJSON)
    }

    func testTheArtifactRunsInTheWidgetSandboxWithItsDataAndNoWayOutOfTheScriptTag() {
        let document = RichBlocks.artifactDocument(html: "<p>x</p>", dataJSON: #"{"a":"</script><b>"}"#, dataAt: 7, dark: true)
        XCTAssertTrue(document.contains("Content-Security-Policy"))
        XCTAssertTrue(document.contains(#"data:{"a":"\u003c/script\u003e\u003cb\u003e"}"#))
        XCTAssertTrue(document.contains("updatedAt:7"))
        XCTAssertTrue(document.contains("<p>x</p>"))
        XCTAssertTrue(RichBlocks.artifactDocument(html: "", dataJSON: nil, dataAt: nil, dark: false).contains("data:null"))
    }
}
