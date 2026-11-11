@testable import CompanionCore
import XCTest

/// The bot profile on the phone and the tablet follows the desktop's cards
/// (#3403): the Bot accounts card lists what the bot has, "+ Add" offers
/// described choices, Knowledge decides a learning in place, and Analytics
/// reads the reference block.
final class BotProfileCardsTests: XCTestCase {
    private func capabilities(_ items: String) throws -> BotCapabilityList {
        let json = #"{"botId":"bot_1","engine":{"kind":"claudeAgent","label":"Claude Code"},"items":["# + items + #"]}"#
        return try JSONDecoder().decode(BotCapabilityList.self, from: Data(json.utf8))
    }

    func testTheAccountsCardLeavesOutWhatIsStillToConnect() throws {
        let list = try capabilities(#"""
        {"key":"connector:me:mail","form":"connector","name":"Mail","scope":"me","state":"to_connect","enabled":false,"canToggle":false},
        {"key":"mcp:installation:docs","form":"mcp","name":"Docs","scope":"installation","state":"on","enabled":true,"canToggle":true},
        {"key":"connector:organization:crm","form":"connector","name":"Crm","scope":"organization","state":"imposed","enabled":true,"canToggle":false},
        {"key":"mcp:installation:off-one","form":"mcp","name":"Off one","scope":"installation","state":"off","enabled":false,"canToggle":true},
        {"key":"skill:bot:notes","form":"skill","name":"Notes","scope":"bot","state":"on","enabled":true,"canToggle":true}
        """#)
        let rows = BotAccountsCard.rows(list.items)
        XCTAssertEqual(rows.map(\.name), ["Crm", "Docs", "Off one"])
        XCTAssertFalse(rows.contains { $0.state == .toConnect }, "an app still to connect stays in the apps page")
    }

    func testAddOffersAppsThenServersThenTheVaultWhereEachWorks() {
        XCTAssertEqual(BotAccountsCard.choices(mcpServers: true, vault: true), [.apps, .mcp, .vault])
        XCTAssertEqual(BotAccountsCard.choices(mcpServers: false, vault: false), [.apps])
        XCTAssertEqual(BotAccountsCard.choices(mcpServers: true, vault: false), [.apps, .mcp])
    }

    func testAStagedLearningCarriesTheCardItIsDecidedOn() throws {
        let json = #"""
        {"skills":[],"staged":[
          {"id":"s1","name":"weekly-report","gist":"Writes the weekly report","action":"update","sha256":"abc",
           "card":{"threadId":"t1","requestId":"r1","messageId":"m1"}},
          {"id":"s2","name":"no-card","gist":"Waits"}
        ]}
        """#
        let skills = try JSONDecoder().decode(BotSkills.self, from: Data(json.utf8))
        XCTAssertEqual(skills.staged.count, 2)
        let first = try XCTUnwrap(skills.staged.first)
        XCTAssertEqual(first.card, StagedSkillCard(threadId: "t1", requestId: "r1", messageId: "m1"))
        XCTAssertEqual(first.action, "update")
        XCTAssertTrue(first.decidable)
        XCTAssertFalse(skills.staged[1].decidable, "with no card, the learning is decided in the chat")
    }

    func testAnalyticsDecodesTheReferenceBlock() throws {
        let json = #"""
        {"from":"2026-11-04","to":"2026-11-10","days":7,
         "series":[{"day":"2026-11-09","messages":3,"turns":2,"tokens":40,"costUsd":0.5,"conversations":1,"routinesRun":0,"routinesFailed":0,"hoursSaved":0.4}],
         "totals":{"messages":3,"turns":2,"tokens":40,"costUsd":0.5,"conversations":1,"routinesRun":0,"routinesFailed":0,"hoursSaved":0.4},
         "topUsers":[{"principalId":"p1","name":"Alex","messages":2,"hoursSaved":0.1},{"principalId":"p2","name":"0f8fad5b-d9cb-469f-a165-70867728950e","messages":1,"hoursSaved":null}],
         "hoursSavedBasis":"turnDuration","currency":"USD"}
        """#
        let data = try JSONDecoder().decode(BotAnalytics.self, from: Data(json.utf8))
        XCTAssertEqual(data.totals.messages, 3)
        XCTAssertEqual(data.series.first?.hoursSaved, 0.4)
        XCTAssertTrue(data.hoursEstimated)
        XCTAssertEqual(data.topUsers.map(\.shownName), ["Alex", nil], "an opaque id is never shown as a name")
        XCTAssertEqual(BotAnalyticsUser.initials("alex.martin@example.com"), "AM")
    }

    func testTopUsersSortByTheChosenFigure() {
        let users = [
            BotAnalyticsUser(principalId: "a", name: "Ana", messages: 5, hoursSaved: 0.2),
            BotAnalyticsUser(principalId: "b", name: "Ben", messages: 2, hoursSaved: 3),
            BotAnalyticsUser(principalId: "c", name: "Cy", messages: 9, hoursSaved: nil),
        ]
        XCTAssertEqual(BotAnalytics.sorted(users, by: .messages).map(\.name), ["Cy", "Ana", "Ben"])
        XCTAssertEqual(BotAnalytics.sorted(users, by: .hoursSaved).map(\.name), ["Ben", "Ana", "Cy"])
    }

    func testAVaultLoginSplitsItsSitesLikeTheDesktop() {
        XCTAssertEqual(CompanionClient.vaultDomains("example.com, shop.example.com  other.org"), ["example.com", "shop.example.com", "other.org"])
    }
}
