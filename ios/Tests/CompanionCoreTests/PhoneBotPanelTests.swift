// The iPhone's bot panel: the same tabs and persona sections as the iPad and
// the desktop for each pairing, the doors into it, its top bar actions and
// the Library's chips.
import XCTest
@testable import CompanionCore

final class PhoneBotPanelTests: XCTestCase {
    private func bot(_ id: String, owner: String? = nil, primary: Bool = false, hidden: Bool = false) throws -> Bot {
        var json: [String: Any] = [
            "id": id, "threadId": "t-\(id)", "name": id.capitalized, "title": "", "description": "", "notifications": true,
            "color": "green", "unread": false, "modelSelection": ["instanceId": "claude", "model": "m"], "createdAt": 1,
            "chiefOfStaff": primary, "hidden": hidden,
        ]
        if let owner { json["ownerUserId"] = owner }
        return try JSONDecoder().decode(Bot.self, from: JSONSerialization.data(withJSONObject: json))
    }

    // MARK: Tabs and sections per pairing

    func testEveryPairingGetsTheDesktopTabsInOrder() {
        for gate in [SurfaceGate(scope: .serverAdmin), SurfaceGate(scope: .serverClient), SurfaceGate(scope: .sidecar),
                     SurfaceGate(scope: .sidecar, sidecarRoutes: []), SurfaceGate(scope: .serverAdmin, organization: true)] {
            XCTAssertEqual(DesktopPanelTab.visible(gate: gate), [.activity, .library], "\(gate)")
            XCTAssertTrue(DesktopPersonaEditor.offered(gate: gate), "\(gate)")
        }
    }

    func testOwnerSidecarGetsTheAdvancedSectionsAsTheDesktopOrdersThem() {
        // D1: the owner's sidecar opens the advanced sections
        XCTAssertEqual(
            DesktopPanelSection.visible(gate: SurfaceGate(scope: .sidecar)),
            [.overview, .soul, .skills, .memory, .access, .model, .permissions, .voice, .history, .usage]
        )
        // an older sidecar without the route keeps what it can answer
        XCTAssertEqual(DesktopPanelSection.visible(gate: SurfaceGate(scope: .sidecar, sidecarRoutes: [])), [.overview, .voice, .usage])
    }

    func testClientSessionKeepsVoiceAndUsageAndItsSlackLink() {
        XCTAssertEqual(DesktopPanelSection.visible(gate: SurfaceGate(scope: .serverClient)), [.voice, .usage])
        // the server answers a Slack link to a client session too
        XCTAssertEqual(DesktopPanelSection.visible(gate: SurfaceGate(scope: .serverClient), slack: true), [.slack, .voice, .usage])
    }

    func testOrganizationAdminListsSharingWithoutProfileConfiguration() {
        let sections = DesktopPanelSection.visible(gate: SurfaceGate(scope: .serverAdmin, organization: true), slack: true)
        XCTAssertEqual(sections.first, .overview)
        XCTAssertEqual(Array(sections.prefix(2)), [.overview, .slack])
        XCTAssertTrue(sections.contains(.sharing))
        XCTAssertFalse(sections.contains { $0.rawValue == "perspicax" })
        XCTAssertTrue(sections.contains(.worksOn))
        XCTAssertFalse(sections.contains(.visibility))
    }

    // MARK: Doors

    func testDoorsOpenTheirTab() {
        XCTAssertEqual(BotPanelDoor.nameCapsule.tab, .activity)
        XCTAssertEqual(BotPanelDoor.plusSettings.tab, .activity)
        // Computer doors open Activity: the Computer card lives there (#2127).
        XCTAssertEqual(BotPanelDoor.computerButton.tab, .activity)
        XCTAssertEqual(BotPanelDoor.plusComputer.tab, .activity)
        XCTAssertEqual(DesktopPanelTab.parse("details"), .activity)
        XCTAssertEqual(DesktopPanelTab.parse("computer"), .activity)
        XCTAssertEqual(DesktopPanelTab.resolve(.computer), .activity)
    }

    // MARK: Actions

    func testAdminSeesEveryActionOnce() throws {
        let mine = try bot("mine", owner: "pr_me")
        let actions = BotPanelAction.available(gate: SurfaceGate(scope: .serverAdmin), bot: mine, viewerId: "pr_me")
        XCTAssertEqual(actions, [.shareTemplate, .copyId, .duplicate, .makePrimary, .delete])
        XCTAssertEqual(Set(actions).count, actions.count)
    }

    func testThePrimaryBotOffersToHandTheRoleOver() throws {
        let star = try bot("star", owner: "pr_me", primary: true)
        let actions = BotPanelAction.available(gate: SurfaceGate(scope: .serverAdmin), bot: star, viewerId: "pr_me")
        XCTAssertTrue(actions.contains(.replacePrimary))
        XCTAssertFalse(actions.contains(.makePrimary))
    }

    func testClientSessionCannotDeleteOrDuplicate() throws {
        let theirs = try bot("theirs", owner: "pr_other")
        let actions = BotPanelAction.available(gate: SurfaceGate(scope: .serverClient), bot: theirs, viewerId: "pr_me")
        XCTAssertFalse(actions.contains(.delete))
        XCTAssertFalse(actions.contains(.duplicate))
        XCTAssertFalse(actions.contains(.makePrimary))
        XCTAssertEqual(actions.prefix(2), [.shareTemplate, .copyId])
    }

    // MARK: Library chips

    func testLibraryChipsFollowTheDesktopAndAddLinks() {
        let two: [ThreadFileFilter: Int] = [.all: 3, .image: 2, .document: 1]
        XCTAssertEqual(BotLibraryChip.visible(counts: two, selected: .files(.all), links: 0),
                       [.files(.all), .files(.image), .files(.document)])
        XCTAssertEqual(BotLibraryChip.visible(counts: two, selected: .files(.all), links: 4),
                       [.files(.all), .files(.image), .files(.document), .links])
        // one kind of file: no kind chips on the desktop; with links, All and Links
        let one: [ThreadFileFilter: Int] = [.all: 2, .image: 2]
        XCTAssertEqual(BotLibraryChip.visible(counts: one, selected: .files(.all), links: 0), [])
        XCTAssertEqual(BotLibraryChip.visible(counts: one, selected: .files(.all), links: 1), [.files(.all), .links])
        // the chosen Links chip stays while its list loads
        XCTAssertEqual(BotLibraryChip.visible(counts: [:], selected: .links, links: 0), [.files(.all), .links])
        XCTAssertNil(BotLibraryChip.links.fileFilter)
        XCTAssertEqual(BotLibraryChip.files(.video).fileFilter, .video)
    }
}

final class BotLibraryViewTests: XCTestCase {
    func testLibraryShowsFilesOnlySkillsLiveOnPersonas() {
        for gate in [SurfaceGate(scope: .serverAdmin), SurfaceGate(scope: .serverClient), SurfaceGate(scope: .sidecar), SurfaceGate(scope: .sidecar, sidecarRoutes: [])] {
            XCTAssertEqual(BotLibraryView.visible(gate: gate), [.files])
        }
        // plugins stay one link away where the route is forwarded
        XCTAssertTrue(BotLibraryView.pluginsLink(gate: SurfaceGate(scope: .serverAdmin)))
        XCTAssertTrue(BotLibraryView.pluginsLink(gate: SurfaceGate(scope: .serverClient)))
        XCTAssertFalse(BotLibraryView.pluginsLink(gate: SurfaceGate(scope: .sidecar)))
    }

    func testPluginsListingDecodesAndToleratesMissingFields() throws {
        let json = #"{"marketplaces":[{"name":"acme","source":"acme/tools","addedAt":1,"updatedAt":2,"plugins":[{"name":"lint","installed":true,"external":false},{"name":"fmt"}]}],"plugins":[{"key":"lint@acme","name":"lint","marketplace":"acme","enabled":true,"removed":[],"declaredMcpServers":[]}],"policy":{"mode":"any"},"engine":{"loadsPlugins":false},"canChange":true,"managedByAdmin":true}"#
        let listing = try JSONDecoder().decode(BotPluginsListing.self, from: Data(json.utf8))
        XCTAssertEqual(listing.marketplaces.first?.plugins.map(\.installed), [true, false])
        XCTAssertEqual(listing.plugins.first?.key, "lint@acme")
        XCTAssertTrue(listing.canChange)
        XCTAssertFalse(listing.loadsPlugins)
    }

    func testPluginRoutesEncodeTheKey() throws {
        let client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t")
        let toggle = try client.botPluginRequest(botId: "b1", key: "lint@acme", enabled: false)
        XCTAssertEqual(toggle.httpMethod, "PATCH")
        XCTAssertEqual(toggle.url?.absoluteString.hasSuffix("/api/bots/b1/plugins/lint@acme"), true)
        XCTAssertEqual(try client.botPluginRequest(botId: "b1", key: "lint@acme", enabled: nil).httpMethod, "DELETE")
        XCTAssertThrowsError(try client.botPluginRequest(botId: "../x", key: "k", enabled: true))
        XCTAssertThrowsError(try client.botPluginRequest(botId: "b1", key: "a/../b", enabled: true))
    }
}
