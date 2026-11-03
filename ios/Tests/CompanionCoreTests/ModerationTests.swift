import Foundation
import XCTest
@testable import CompanionCore

/// App Store guideline 1.2 between people: who can be reported and blocked,
/// what a block folds away, the routes, and the demo that answers them.
final class ModerationTests: XCTestCase {
    private let clock = Date(timeIntervalSince1970: 1_790_000_000)
    private let viewer = RoomViewer(principalId: "pr_alex", email: "alex@example.test", role: "member")
    private let bots: Set<String> = ["demo-pixel"]
    private var isBot: (String) -> Bool { { [bots] in bots.contains($0) } }

    private func message(_ json: String) throws -> Message {
        try JSONDecoder().decode(Message.self, from: Data(json.utf8))
    }

    func testAPersonsLineIsReportableAndYoursAndABotsAreNot() throws {
        let sam = try message(#"{"id":"a","role":"user","kind":"text","at":1,"text":"hi","sender":{"name":"Sam","id":"PR_SAM"}}"#)
        XCTAssertEqual(Moderation.personAuthor(of: sam, viewer: viewer, inRoom: true, isBot: isBot), .init(id: "pr_sam", name: "Sam"))
        let mine = try message(#"{"id":"b","role":"user","kind":"text","at":1,"text":"hi","sender":{"name":"Alex","id":"pr_alex"}}"#)
        XCTAssertNil(Moderation.personAuthor(of: mine, viewer: viewer, inRoom: true, isBot: isBot), "your own line")
        let unnamed = try message(#"{"id":"c","role":"user","kind":"text","at":1,"text":"hi"}"#)
        XCTAssertNil(Moderation.personAuthor(of: unnamed, viewer: viewer, inRoom: true, isBot: isBot), "a line with no sender is yours")
        let bot = try message(#"{"id":"d","role":"bot","kind":"text","at":1,"text":"hi","from":{"botId":"demo-pixel","name":"Pixel","color":"purple"}}"#)
        XCTAssertNil(Moderation.personAuthor(of: bot, viewer: viewer, inRoom: true, isBot: isBot), "a bot keeps its own Report")
        XCTAssertTrue(MessageReport.canReport(bot, isBot: isBot), "the bot path is unchanged")
        let person = try message(#"{"id":"e","role":"bot","kind":"text","at":1,"text":"hi","from":{"botId":"person-sam","name":"Sam Rivera","color":"teal"}}"#)
        XCTAssertEqual(Moderation.personAuthor(of: person, viewer: viewer, inRoom: true, isBot: isBot), .init(id: "person-sam", name: "Sam Rivera"))
        XCTAssertNil(Moderation.personAuthor(of: person, viewer: viewer, inRoom: false, isBot: isBot), "only in a room")
        XCTAssertFalse(MessageReport.canReport(person, isBot: isBot), "never both Reports on one line")
    }

    func testABlockFoldsThatPersonsLinesForTheViewerOnly() throws {
        let sam = try message(#"{"id":"a","role":"user","kind":"text","at":1,"text":"hi","sender":{"name":"Sam","id":"pr_sam"}}"#)
        let cara = try message(#"{"id":"b","role":"user","kind":"text","at":1,"text":"hi","sender":{"name":"Cara","id":"pr_cara"}}"#)
        let blocked = Moderation.ids([.init(id: "PR_SAM", name: "Sam", at: 1)])
        XCTAssertTrue(Moderation.isBlocked(sam, viewer: viewer, inRoom: true, isBot: isBot, blocked: blocked))
        XCTAssertFalse(Moderation.isBlocked(cara, viewer: viewer, inRoom: true, isBot: isBot, blocked: blocked))
        XCTAssertFalse(Moderation.isBlocked(sam, viewer: viewer, inRoom: true, isBot: isBot, blocked: []))

        var dm = try XCTUnwrap(DemoServer(now: clock, chunkDelay: 0).fleet.groups.first)
        dm.peopleDm = true
        dm.humanIds = ["pr_alex", "PR_SAM"]
        XCTAssertTrue(Moderation.isBlockedDM(dm, viewerId: "pr_alex", blocked: blocked))
        XCTAssertFalse(Moderation.isBlockedDM(dm, viewerId: "pr_alex", blocked: ["pr_cara"]))
    }

    func testTheRequestsNameTheMessageAndNeverTheAuthor() throws {
        let client = CompanionClient(connection: Connection(id: "c", name: "c", host: "example.test", port: 443), token: "t")
        let report = try client.reportMessageRequest(threadId: "t-room", messageId: "m-1", reason: .harassment, note: "  again  ")
        XCTAssertEqual(report.httpMethod, "POST")
        XCTAssertEqual(report.url?.path, "/api/threads/t-room/messages/m-1/report")
        let body = try XCTUnwrap(report.httpBody.flatMap { try JSONSerialization.jsonObject(with: $0) as? [String: Any] })
        XCTAssertEqual(body["reason"] as? String, "harassment")
        XCTAssertEqual(body["note"] as? String, "again")
        XCTAssertEqual(Set(body.keys), ["reason", "note"])
        XCTAssertEqual(try client.unblockRequest(id: "pr_sam").url?.path, "/api/me/blocks/pr_sam")
        XCTAssertEqual(try client.unblockRequest(id: "pr_sam").httpMethod, "DELETE")
        XCTAssertEqual(try client.acceptTermsRequest(version: Moderation.termsVersion).url?.path, "/api/me/terms")
    }

    func testTheDemoAnswersReportBlockAndTheTermsWithoutANetwork() async throws {
        let server = DemoServer(now: clock, chunkDelay: 0)
        defer { server.stop() }
        let client = server.makeClient()

        // the demo's person in the launch room can be reported and blocked
        let room = try XCTUnwrap(server.fleet.groups.first)
        let line = try XCTUnwrap(room.messages?.first { $0.from?.name == "Sam Rivera" })
        let author = try XCTUnwrap(Moderation.personAuthor(of: line, viewer: RoomViewer(), inRoom: true, isBot: { id in server.fleet.bots.contains { $0.id == id } }))
        let receipt = try await client.reportMessage(threadId: room.threadId, messageId: line.id, reason: .spam, note: "")
        XCTAssertTrue(receipt.id.hasPrefix("demo-report"))
        XCTAssertEqual(server.reportCount, 1)
        do {
            _ = try await client.reportMessage(threadId: room.threadId, messageId: "nope", reason: .spam, note: "")
            XCTFail("an unknown message is refused")
        } catch {}

        let afterBlock = try await client.block(author)
        XCTAssertEqual(afterBlock.map(\.id), [author.id])
        let listed = try await client.blockedPeople()
        XCTAssertEqual(listed.map(\.name), ["Sam Rivera"])
        let afterUnblock = try await client.unblock(id: author.id)
        XCTAssertEqual(afterUnblock, [])

        // asked once per demo, then remembered with its date
        let before = try await client.terms()
        XCTAssertFalse(before.accepted)
        let accepted = try await client.acceptTerms()
        XCTAssertTrue(accepted.accepted)
        XCTAssertNotNil(accepted.acceptedAt)
        let again = try await client.terms()
        XCTAssertTrue(again.accepted)
        XCTAssertEqual(again.acceptedAt, accepted.acceptedAt)
    }

    func testReportsListTheOpenOnesThenTheLastTwentyHandled() throws {
        let client = CompanionClient(connection: Connection(id: "c", name: "c", host: "example.test", port: 443), token: "t")
        let list = try client.moderationReportsRequest()
        XCTAssertEqual(list.httpMethod, "GET")
        XCTAssertEqual(list.url?.path, "/api/moderation/reports")
        let resolve = try client.resolveReportRequest(id: "r1")
        XCTAssertEqual(resolve.httpMethod, "POST")
        XCTAssertEqual(resolve.url?.path, "/api/moderation/reports/r1/resolve")

        let handled = (0..<25).map { Moderation.Report(id: "h\($0)", at: Double($0), reason: "spam", status: "resolved") }
        let open = Moderation.Report(id: "o", at: 99, reason: "hate", status: "open")
        let listed = Moderation.listed(handled + [open])
        XCTAssertEqual(listed.first?.id, "o")
        XCTAssertEqual(listed.count, 21)
    }
}
