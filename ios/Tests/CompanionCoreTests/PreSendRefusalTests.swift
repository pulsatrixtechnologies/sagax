// #2013: a turn the engine refused before any prompt went out
// (PreSendRefusal.swift, desktop shared/presend-refusal.ts).
import XCTest
@testable import CompanionCore

final class PreSendRefusalTests: XCTestCase {
    func testKinds() {
        XCTAssertEqual(PreSendRefusal.kind(cause: "Codex has an MCP server outside the selected configuration. Disable native MCP entries for this account before using tool selection."), .configConflict)
        XCTAssertEqual(PreSendRefusal.kind(cause: "You've hit your usage limit. Try again later."), .engineLimit)
        XCTAssertEqual(PreSendRefusal.kind(cause: "Payment required"), .engineLimit)
        XCTAssertEqual(PreSendRefusal.kind(cause: "anything", limitResetsAt: 1_800_000_000_000), .engineLimit)
        XCTAssertEqual(PreSendRefusal.kind(cause: "Codex sign-in expired, sign in again.", setup: true), .signedOut)
        XCTAssertEqual(PreSendRefusal.kind(cause: "Codex is not installed.", setup: true), .engineNotReady)
        XCTAssertEqual(PreSendRefusal.kind(cause: "Claude Code is too old.", claudeUpdate: true), .engineNotReady)
        XCTAssertEqual(PreSendRefusal.kind(cause: "Codex rejected its configuration as invalid."), .engineNotReady)
        XCTAssertEqual(PreSendRefusal.kind(cause: "Codex could not confirm the selected MCP catalog. No prompt was sent."), .engineNotReady)
        XCTAssertEqual(PreSendRefusal.kind(cause: "The engine stopped. No prompt was sent."), .engineNotReady)
    }

    func testFailuresAfterTheModelStartedStayRows() {
        XCTAssertNil(PreSendRefusal.kind(cause: ""))
        XCTAssertNil(PreSendRefusal.kind(cause: "   "))
        XCTAssertNil(PreSendRefusal.kind(cause: "The model stopped answering mid-turn."))
        // a 401 alone is a sign-in only on a setup error
        XCTAssertNil(PreSendRefusal.kind(cause: "Request failed: 401 unauthorized"))
        // a rate limit is not the account's usage limit
        XCTAssertNil(PreSendRefusal.kind(cause: "You hit your rate limit, slow down."))
    }

    func testStoredRow() {
        var row = Message(id: "e1", role: .bot, kind: .activity, at: 0)
        row.tool = ToolActivity(name: "error: Codex has an MCP server outside the selected configuration.", ok: false)
        XCTAssertEqual(PreSendRefusal.kind(of: row), .configConflict)
        // a row with a place stays as it is
        row.tool?.hasPlace = true
        XCTAssertNil(PreSendRefusal.kind(of: row))
        // not a failed turn
        var chip = Message(id: "c1", role: .bot, kind: .activity, at: 0)
        chip.tool = ToolActivity(name: "Read a file", ok: true)
        XCTAssertNil(PreSendRefusal.kind(of: chip))
    }

    func testWireFieldsDecodeAndRoundTrip() throws {
        let json = #"{"name":"error: The engine stopped.","ok":false,"limitResetsAt":1800000000000,"place":{"kind":"computer","id":"x"}}"#
        let tool = try JSONDecoder().decode(ToolActivity.self, from: Data(json.utf8))
        XCTAssertEqual(tool.limitResetsAt, 1_800_000_000_000)
        XCTAssertTrue(tool.hasPlace)
        let again = try JSONDecoder().decode(ToolActivity.self, from: JSONEncoder().encode(tool))
        XCTAssertTrue(again.hasPlace)
        XCTAssertEqual(again.limitResetsAt, 1_800_000_000_000)
        let plain = try JSONDecoder().decode(ToolActivity.self, from: Data(#"{"name":"x","place":null}"#.utf8))
        XCTAssertFalse(plain.hasPlace)
    }

    /// A 1:1 chat leaves the row out; a room keeps it (drawn as a quiet line).
    func testTranscriptHidesThemInABotChatOnly() {
        var user = Message(id: "u1", role: .user, kind: .text, at: 0)
        user.text = "hello"
        var refused = Message(id: "e1", role: .bot, kind: .activity, at: 1)
        refused.tool = ToolActivity(name: "error: Codex rejected its configuration as invalid.", ok: false)
        var other = Message(id: "e2", role: .bot, kind: .activity, at: 2)
        other.tool = ToolActivity(name: "error: The model stopped answering mid-turn.", ok: false)
        let ids: ([TranscriptRow]) -> [String] = { $0.map(\.head.id) }
        XCTAssertEqual(ids(transcriptRows([user, refused, other], detail: .full, hidesPreSendRefusals: true)), ["u1", "e2"])
        XCTAssertEqual(ids(transcriptRows([user, refused, other], detail: .full)), ["u1", "e1", "e2"])
    }
}
