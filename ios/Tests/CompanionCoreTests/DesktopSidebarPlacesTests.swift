import XCTest
@testable import CompanionCore

/// iPad I2b: the sidebar's foot as the desktop draws it now (Sidebar.tsx
/// `places`, Gamertag.tsx) and its edge (`sidebarDragTarget`).
final class DesktopSidebarPlacesTests: XCTestCase {
    func testTemplatesWaitsForExperimental() {
        let admin = SurfaceGate(scope: .serverAdmin)
        XCTAssertEqual(DesktopSidebarPlaces.visible(connected: true, gate: admin, features: nil), [])
        XCTAssertEqual(DesktopSidebarPlaces.visible(connected: true, gate: admin, features: ServerFeatures()), [])
        XCTAssertEqual(
            DesktopSidebarPlaces.visible(connected: true, gate: admin, features: ServerFeatures(templates: true)),
            [.templates]
        )
        XCTAssertFalse(DesktopSidebarPlaces.visible(connected: true, gate: admin, features: nil).contains(.teamMap))
        XCTAssertFalse(DesktopSidebarPlaces.visible(connected: true, gate: admin, features: nil).contains(.automations))
    }

    func testExperimentalPlacesStillNeedThePairingsGate() {
        let features = ServerFeatures(templates: true)
        let client = SurfaceGate(scope: .serverClient)
        // Browse Bots (the place that replaced Templates) is a member's too.
        XCTAssertEqual(DesktopSidebarPlaces.visible(connected: true, gate: client, features: features), [.templates])
        let sidecar = DesktopSidebarPlaces.visible(connected: true, gate: SurfaceGate(scope: .sidecar), features: features)
        XCTAssertFalse(sidecar.contains(.templates), "the remote client hides Browse Bots")
        XCTAssertEqual(DesktopSidebarPlaces.visible(connected: false, gate: SurfaceGate(scope: .serverAdmin), features: features), [])
    }

    func testGamertagShowsGroupedPointsOnlyWhenReadyAndShown() {
        let snapshot = AchievementSnapshot(points: 1240)
        XCTAssertEqual(DesktopSidebarPlaces.gamertag(ready: true, snapshot: snapshot, locale: Locale(identifier: "en_US")), "1,240")
        XCTAssertNil(DesktopSidebarPlaces.gamertag(ready: false, snapshot: snapshot))
        XCTAssertNil(DesktopSidebarPlaces.gamertag(ready: true, snapshot: nil))
        let hidden = AchievementSnapshot(points: 40, settings: AchievementSettings(showPoints: false))
        XCTAssertNil(DesktopSidebarPlaces.gamertag(ready: true, snapshot: hidden))
        XCTAssertEqual(DesktopSidebarPlaces.gamertag(ready: true, snapshot: AchievementSnapshot(points: 40)), "40")
    }

    func testEdgeSnapsToTheRailAndHoldsTheWidth() {
        XCTAssertEqual(DesktopSidebarEdge.target(raw: 120), .collapsed)
        XCTAssertEqual(DesktopSidebarEdge.target(raw: 179.9), .collapsed)
        XCTAssertEqual(DesktopSidebarEdge.target(raw: 180), .expanded(width: 240))
        XCTAssertEqual(DesktopSidebarEdge.target(raw: 330.4), .expanded(width: 330))
        XCTAssertEqual(DesktopSidebarEdge.target(raw: 900), .expanded(width: 400))
        XCTAssertEqual(DesktopSidebarEdge.target(raw: .nan), .collapsed)
        XCTAssertEqual(DesktopSidebarEdge.clamped(nil), 280)
        XCTAssertEqual(DesktopSidebarEdge.clamped(100), 240)
        XCTAssertEqual(DesktopSidebarEdge.clamped(320), 320)
    }

    private func bot(_ id: String, chief: Bool = false, hidden: Bool = false) -> Bot {
        var bot = Bot(id: id, threadId: "t-\(id)", name: id, title: "", description: "", notifications: true, color: "blue",
                      unread: false, modelSelection: ModelSelection(instanceId: "i", model: "m"), createdAt: 0)
        bot.chiefOfStaff = chief
        bot.hidden = hidden
        return bot
    }

    func testArchiveKeepsThePrimaryBotAndTheLastActiveBot() {
        let chief = bot("chief", chief: true)
        let ana = bot("ana")
        let old = bot("old", hidden: true)
        XCTAssertEqual(DesktopBotArchive.block(chief, in: [chief, ana]), .primary)
        XCTAssertNil(DesktopBotArchive.block(ana, in: [chief, ana]))
        XCTAssertEqual(DesktopBotArchive.block(ana, in: [ana, old]), .last)
        XCTAssertEqual(DesktopBotArchive.archived([ana, old, chief]).map(\.id), ["old"])
    }

    func testArchivePatchCarriesOnlyHidden() throws {
        let client = CompanionClient(connection: Connection(name: "Test", host: "127.0.0.1", port: 8810), token: "t")
        let request = try client.patchBotRequest(botId: "b1", patch: BotPatch(hidden: true))
        XCTAssertEqual(request.httpMethod, "PATCH")
        let body = try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]
        XCTAssertEqual(body?.count, 1)
        XCTAssertEqual(body?["hidden"] as? Bool, true)
        XCTAssertFalse(BotPatch(hidden: false).isEmpty)
    }

    func testComposeToListsCreateRowsThenOwnActiveBotsMatchingTheQuery() {
        var mine = bot("orion"); mine.name = "Orion"; mine.title = "Analyst"
        var theirs = bot("x"); theirs.ownerUserId = "someone@else"
        let archived = bot("old", hidden: true)
        var lux = bot("lux"); lux.name = "Lux"
        let all = [mine, theirs, archived, lux]
        XCTAssertEqual(DesktopComposeTo.bots(all, viewerId: "local-owner", query: "").map(\.id), ["orion", "lux"])
        XCTAssertEqual(DesktopComposeTo.bots(all, viewerId: "local-owner", query: " analy ").map(\.id), ["orion"])
        let bots = DesktopComposeTo.bots(all, viewerId: "local-owner", query: "")
        XCTAssertEqual(DesktopComposeTo.rows(mode: .browse, bots: bots, canCreateBots: true), [.createBot, .createBotWizard, .createGroup, .bot("orion"), .bot("lux")])
        XCTAssertEqual(DesktopComposeTo.rows(mode: .browse, bots: bots, canCreateBots: false).first, .createGroup)
        XCTAssertEqual(DesktopComposeTo.rows(mode: .group, bots: bots, canCreateBots: true), [.createGroup, .bot("orion"), .bot("lux")])
        XCTAssertEqual(DesktopComposeTo.move(0, by: -1, count: 4), 3)
        XCTAssertEqual(DesktopComposeTo.move(3, by: 1, count: 4), 0)
        XCTAssertEqual(DesktopComposeTo.move(9, by: 1, count: 4), 0)
        XCTAssertEqual(DesktopComposeTo.move(0, by: 1, count: 0), 0)
    }

    func testShareTeamExportsTheWholeTeamAndReadsThePackage() throws {
        let client = CompanionClient(connection: Connection(name: "Test", host: "127.0.0.1", port: 8810), token: "t")
        let request = try client.exportTeamRequest(" Administration ")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/teams/export")
        let body = try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]
        XCTAssertEqual(body?["team"] as? String, "Administration")
        XCTAssertEqual(body?["skills"] as? String, "all")
        XCTAssertEqual(body?["includeMemory"] as? Bool, true)
        XCTAssertNil(body?["dryRun"])
        XCTAssertThrowsError(try client.exportTeamRequest("  "))

        let answer = Data(#"{"document":{"format":"package","agents":[]},"filename":"administration.json","redacted":[]}"#.utf8)
        let file = try CompanionClient.teamShareFile(from: answer, team: "Administration")
        XCTAssertEqual(file.filename, "administration.json")
        let document = try JSONSerialization.jsonObject(with: file.data) as? [String: Any]
        XCTAssertEqual(document?["format"] as? String, "package")
        XCTAssertThrowsError(try CompanionClient.teamShareFile(from: Data("{}".utf8), team: "x"))
    }
}
