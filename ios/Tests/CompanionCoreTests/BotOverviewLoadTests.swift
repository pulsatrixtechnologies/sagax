import Foundation
import XCTest
@testable import CompanionCore

/// iPad Personality page and the Overview read "Couldn't load the overview."
/// (and the iPhone "What it does" summary spun forever) whenever the
/// computer had no overview to give: the demo never served the route, the
/// store preview has no computer at all, and a pairing the computer refuses
/// (403 owner only, 404 older computer) was shown as an error.
final class BotOverviewLoadTests: XCTestCase {
    private let clock = Date(timeIntervalSince1970: 1_790_000_000)

    func testDemoServesAtlasOverview() throws {
        let server = DemoServer(now: clock, chunkDelay: 0)
        let response = server.respond(method: "GET", path: "/api/bots/demo-atlas/overview", body: nil)
        XCTAssertEqual(response.status, 200)
        let overview = try JSONDecoder().decode(BotOverview.self, from: response.body)
        XCTAssertEqual(overview.who.name, "Atlas")
        XCTAssertFalse(overview.who.blurb.isEmpty)
        XCTAssertTrue(overview.does.contains { $0.contains("Morning digest") }, "\(overview.does)")
        XCTAssertFalse(overview.reaches.isEmpty)
    }

    func testDemoOverviewSpeaksFrench() throws {
        let server = DemoServer(now: clock, language: .french, chunkDelay: 0)
        let response = server.respond(method: "GET", path: "/api/bots/demo-atlas/overview", body: nil)
        let overview = try JSONDecoder().decode(BotOverview.self, from: response.body)
        XCTAssertTrue(overview.does.contains { $0.contains("Résumé du matin") }, "\(overview.does)")
    }

    func testDemoOverviewOfUnknownBotIsNotFound() {
        let server = DemoServer(now: clock, chunkDelay: 0)
        XCTAssertEqual(server.respond(method: "GET", path: "/api/bots/nobody/overview", body: nil).status, 404)
    }

    func testRefusedOverviewHidesTheSection() {
        XCTAssertEqual(BotOverviewLoad(error: APIError.status(code: 403, message: "bot_activity_owner_only")), .hidden)
        XCTAssertEqual(BotOverviewLoad(error: APIError.status(code: 404, message: nil)), .hidden)
        XCTAssertEqual(BotOverviewLoad(error: APIError.status(code: 500, message: nil)), .failed)
        XCTAssertEqual(BotOverviewLoad(error: URLError(.timedOut)), .failed)
    }

    func testLocalOverviewForComputerlessPreview() {
        let fixture = DemoFixture(now: clock)
        let atlas = fixture.bots.first { $0.id == "demo-atlas" }!
        let overview = BotOverview.local(bot: atlas, routines: fixture.routines, language: .english)
        XCTAssertEqual(overview.who.name, atlas.name)
        XCTAssertEqual(overview.who.title, atlas.title)
        XCTAssertEqual(overview.who.blurb, atlas.description)
        XCTAssertEqual(overview.does.count, fixture.routines.filter { $0.botId == atlas.id }.count)
        XCTAssertFalse(overview.does.isEmpty)
        XCTAssertTrue(overview.recent.isEmpty)
    }
}
