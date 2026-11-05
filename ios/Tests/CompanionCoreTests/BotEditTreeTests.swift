import XCTest
@testable import CompanionCore

/// Edit bot in the Grok-style single page (lots 2 and 3, 2026-11-01)
/// moves fields onto the root and keeps every former action reachable.
final class BotEditTreeTests: XCTestCase {
    /// Every field and action Edit bot had before this layout.
    private let before: [BotEditItem] = [
        .avatar, .name, .role, .botDescription,
        .callVoice, .callSpeed, .callLanguage,
        .soul, .skills, .memory,
        .model, .computer, .toolsApps, .slack, .voiceAlerts,
        .approvals, .whoCanSee, .sharedWith,
        .overview, .usage, .changes,
    ]

    /// Every editor section (`DesktopPanelSection`) the old lists showed.
    func testEverySectionStillHasARow() {
        let reachable = BotEditTree.reachable(.everything).map(\.item)
        for section in DesktopPanelSection.allCases {
            XCTAssertTrue(reachable.contains { $0.section == section }, "\(section) lost its row")
        }
    }

    func testEveryFieldAndActionFromBeforeStillHasAPlace() {
        let reachable = Set(BotEditTree.reachable(.everything).map(\.item))
        for item in before {
            XCTAssertTrue(reachable.contains(item), "\(item) lost its place")
        }
    }

    func testEveryDrawnRowIsReachableOnce() {
        let items = BotEditTree.reachable(.everything).map(\.item)
        XCTAssertEqual(items.count, Set(items).count, "a row shows in two places")
        // Retired from the walk: header, identity, personality, access leaf, delete.
        let retired: Set<BotEditItem> = [.header, .identity, .personality, .access, .delete]
        XCTAssertTrue(retired.isDisjoint(with: Set(items)))
        XCTAssertEqual(Set(items).union(retired), Set(BotEditItem.allCases))
    }

    /// Root: identity fields, appearance, voice calls, more voice options,
    /// then Sagax rows, Advanced, Archive. No Delete (profile menu).
    func testTheRootIsOneGrokStylePage() {
        let root = BotEditTree.cards(.root, .everything)
        XCTAssertEqual(root[0], [.name, .role, .botDescription])
        XCTAssertEqual(root[1], [.avatar])
        XCTAssertEqual(root[2], [.callVoice, .callSpeed, .callLanguage])
        XCTAssertEqual(root[3], [.voiceAlerts])
        XCTAssertEqual(
            root[4],
            [.soul, .skills, .memory, .model, .approvals, .toolsApps, .computer, .slack, .routines, .sharing]
        )
        XCTAssertEqual(root[5], [.advanced])
        XCTAssertEqual(root.last, [.archive])
        XCTAssertFalse(root.joined().contains(.delete))
        XCTAssertFalse(root.joined().contains(.header))
        XCTAssertFalse(root.joined().contains(.identity))
        XCTAssertFalse(root.joined().contains(.personality))
    }

    func testDetailDepthIsAtMostOnePage() {
        // Fields and voice sit on the root.
        XCTAssertEqual(BotEditTree.path(to: BotEditItem.name), [])
        XCTAssertEqual(BotEditTree.path(to: BotEditItem.callVoice), [])
        XCTAssertEqual(BotEditTree.path(to: BotEditItem.soul), [])
        XCTAssertEqual(BotEditTree.path(to: BotEditItem.voiceAlerts), [])
        XCTAssertEqual(BotEditTree.path(to: BotEditItem.model), [])
        XCTAssertEqual(BotEditTree.path(to: BotEditItem.approvals), [])
        XCTAssertEqual(BotEditTree.path(to: BotEditItem.toolsApps), [])
        XCTAssertEqual(BotEditTree.path(to: BotEditItem.archive), [])
        // One page in for Sharing and Advanced children.
        XCTAssertEqual(BotEditTree.path(to: BotEditItem.sharedWith), [.sharing])
        XCTAssertEqual(BotEditTree.path(to: BotEditItem.changes), [.advanced])
        // Deep links: Access is the Tools and apps row (no intermediate page).
        XCTAssertEqual(BotEditTree.path(to: DesktopPanelSection.access), [])
        XCTAssertEqual(BotEditTree.path(to: DesktopPanelSection.permissions), [])
        XCTAssertEqual(BotEditTree.path(to: DesktopPanelSection.history), [.advanced])
        XCTAssertEqual(BotEditTree.path(to: DesktopPanelSection.sharing), [.sharing])
        XCTAssertEqual(BotEditTree.item(for: .access), .toolsApps)
    }

    func testToolsAppsOpensAccessDirectly() {
        XCTAssertNil(BotEditItem.toolsApps.opens)
        XCTAssertEqual(BotEditItem.toolsApps.section, .access)
        XCTAssertTrue(BotEditTree.cards(.toolsApps, .everything).isEmpty)
    }

    /// An organization member editing their own bot: the gate gives them
    /// the owner's sections and their own Archive, no admin.
    func testAMemberEditsTheirOwnBot() {
        var bot = Bot.editFixture
        bot.ownerUserId = "member-1"
        let gate = SurfaceGate(
            scope: .serverClient, organization: true,
            viewer: ConfigViewer(principalId: "member-1", role: "member", permissions: ["bots.create", "bots.tools", "bots.approvalLevel", "bots.behaviour"])
        )
        let context = BotEditContext(gate: gate, bot: bot)
        let rows = Set(BotEditTree.reachable(context).map(\.item))
        for item: BotEditItem in [.soul, .model, .approvals, .toolsApps, .routines, .archive] {
            XCTAssertTrue(rows.contains(item), "a member cannot reach \(item) on their own bot")
        }
        XCTAssertTrue(rows.contains(.name))
        XCTAssertTrue(rows.contains(.callVoice))
    }

    /// A section the pairing cannot reach hides its row; a page with
    /// nothing left hides too.
    func testHiddenSectionsDropTheirRows() {
        let context = BotEditContext(sections: [.model, .voice], archive: false, delete: false)
        let root = Set(BotEditTree.cards(.root, context).joined())
        XCTAssertTrue(root.contains(.model))
        XCTAssertTrue(root.contains(.name), "identity fields always show")
        XCTAssertTrue(root.contains(.voiceAlerts))
        XCTAssertFalse(root.contains(.toolsApps))
        XCTAssertFalse(root.contains(.sharing))
        XCTAssertFalse(root.contains(.advanced))
        XCTAssertFalse(root.contains(.archive))
        XCTAssertFalse(root.contains(.delete))
    }

    func testTheSummariesReadTheBot() {
        var bot = Bot.editFixture
        bot.title = "  Researcher "
        bot.instructionsLead = nil
        bot.computer = "off"
        XCTAssertEqual(BotEditSummary.role(bot), "Researcher")
        XCTAssertFalse(BotEditSummary.soulWritten(bot))
        XCTAssertTrue(BotEditSummary.workspaceOff(bot))
        bot.instructionsLead = "You keep things short."
        XCTAssertTrue(BotEditSummary.soulWritten(bot))
        XCTAssertEqual(BotEditSummary.mcp(nil), .all)
        XCTAssertEqual(BotEditSummary.mcp([]), .none)
        XCTAssertEqual(BotEditSummary.mcp(["files"]), .some(["files"]))
        let rules = [
            CustomRuleRow(id: "a", botId: bot.id, when: "x", behavior: .ask),
            CustomRuleRow(id: "b", botId: bot.id, when: "y", behavior: .deny),
            CustomRuleRow(id: "c", botId: bot.id, when: "z", behavior: .deny),
            CustomRuleRow(id: "d", botId: nil, when: "every bot", behavior: .allow),
            CustomRuleRow(id: "e", botId: bot.id, when: "off", behavior: .allow, enabled: false),
        ]
        let counts = BotEditSummary.ruleCounts(rules, botId: bot.id)
        XCTAssertEqual(counts.ask, 1)
        XCTAssertEqual(counts.deny, 2)
        XCTAssertEqual(counts.allow, 0)
    }

    func testModelNameIsReadable() {
        let selection = ModelSelection(instanceId: "xai", model: "grok-4.5")
        XCTAssertEqual(BotEditSummary.modelName(selection), "Grok 4.5")
        XCTAssertEqual(BotEditSummary.modelName(selection, label: "Grok 4.5"), "Grok 4.5")
        XCTAssertEqual(BotEditSummary.friendlyModelId("claude-sonnet-4"), "Claude Sonnet 4")
        XCTAssertEqual(BotEditSummary.modelName(ModelSelection(instanceId: "x", model: "")), "Default")
    }
}

private extension Bot {
    static var editFixture: Bot {
        let json = #"{"id":"b1","threadId":"t1","name":"Scout","title":"","description":"","notifications":true,"color":"blue","unread":false,"modelSelection":{"instanceId":"claude","model":"default"},"createdAt":0}"#
        return try! JSONDecoder().decode(Bot.self, from: Data(json.utf8))
    }
}
