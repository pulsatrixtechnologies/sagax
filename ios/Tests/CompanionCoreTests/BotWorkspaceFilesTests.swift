// Rules and docs on iOS (#269): the desktop's workspace-files.ts helpers.
import Foundation
import XCTest
@testable import CompanionCore

final class BotWorkspaceFilesTests: XCTestCase {
    func testPathsTheFileRouteServes() {
        XCTAssertTrue(BotWorkspaceFiles.isDoc("RULES.md"))
        XCTAssertTrue(BotWorkspaceFiles.isDoc("docs/plan.md"))
        XCTAssertFalse(BotWorkspaceFiles.isDoc("docs/a/b.md"))
        XCTAssertFalse(BotWorkspaceFiles.isDoc("MEMORY.md"))
        XCTAssertFalse(BotWorkspaceFiles.isDoc("docs/plan.txt"))
    }

    func testCoreAndJoin() {
        XCTAssertTrue(BotWorkspaceFiles.isCore("RULES.md"))
        XCTAssertTrue(BotWorkspaceFiles.isCore("MEMORY.md"))
        XCTAssertFalse(BotWorkspaceFiles.isCore("docs/a.md"))
        XCTAssertEqual(BotWorkspaceFiles.join(parent: nil, name: "a.txt"), "a.txt")
        XCTAssertEqual(BotWorkspaceFiles.join(parent: "inbox", name: "a.txt"), "inbox/a.txt")
    }

    func testDocPathFromAName() {
        XCTAssertEqual(BotWorkspaceFiles.docPath(fromName: "Plan de match"), "docs/Plan de match.md")
        XCTAssertEqual(BotWorkspaceFiles.docPath(fromName: "docs/notes.MD"), "docs/notes.md")
        XCTAssertEqual(BotWorkspaceFiles.docPath(fromName: "a/b?c"), "docs/a-b-c.md")
        XCTAssertNil(BotWorkspaceFiles.docPath(fromName: "  "))
        XCTAssertNil(BotWorkspaceFiles.docPath(fromName: "---"))
    }

    func testRulesCountWhatLoads() {
        let raw = "# Rules\n<!-- a hint\nover lines -->\n\n\n\n- Never send mail\n- Ask first"
        XCTAssertEqual(BotWorkspaceFiles.effectiveRules(raw), "# Rules\n\n- Never send mail\n- Ask first")
        let count = BotWorkspaceFiles.rulesCount(raw)
        XCTAssertEqual(count.lines, 4)
        XCTAssertFalse(count.over)
        XCTAssertTrue(BotWorkspaceFiles.rulesCount(String(repeating: "x\n", count: 61)).over)
    }

    func testListingKeepsDocsByName() throws {
        let json = ##"{"entries":[{"path":"docs/b.md","kind":"file"},{"path":"RULES.md","kind":"file"},{"path":"docs/A.md","kind":"file"},{"path":"docs","kind":"dir"},{"path":"notes.txt","kind":"file"}],"rulesTemplate":"# Rules"}"##
        let listing = try JSONDecoder().decode(BotWorkspaceListing.self, from: Data(json.utf8))
        XCTAssertEqual(listing.docs.map(\.path), ["docs/A.md", "docs/b.md"])
        XCTAssertEqual(listing.rulesTemplate, "# Rules")
    }
}
