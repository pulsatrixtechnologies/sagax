// Plugins > Providers' sections and pills (desktop
// src/components/plugins/HarnessConnectorGroups.tsx, AccountsView.tsx).
import CompanionCore
import XCTest

final class ProviderConnectorGroupsTests: XCTestCase {
    private func answer(_ json: String) throws -> HarnessConnectorsAnswer {
        try JSONDecoder().decode(HarnessConnectorsAnswer.self, from: Data(json.utf8))
    }

    func testClaudeAndGrokAlwaysHaveTheirSection() throws {
        let loading = ProviderConnectorGroups.groups(claude: nil, claudeLoading: true, grokConfigured: false)
        XCTAssertEqual(loading.map(\.engine), [.claude, .grok])
        XCTAssertEqual(loading[0].notice, .loading)
        XCTAssertEqual(loading[1].notice, .noAccount)
        XCTAssertEqual(loading[1].notice?.action, .setup)
        XCTAssertEqual(ProviderConnectorGroups.groups(claude: nil, claudeLoading: false, grokConfigured: false)[0].notice, .unavailable("unknown"))

        let empty = try answer(#"{"manageUrl":"","canManage":true,"enabled":true,"claude":{"available":true,"connectors":[]},"codex":{"available":false}}"#)
        let groups = ProviderConnectorGroups.groups(claude: empty, claudeLoading: false, grokConfigured: true)
        XCTAssertEqual(groups[0].notice, .empty)
        XCTAssertEqual(groups[0].notice?.action, .manage)
        XCTAssertNil(groups[1].notice)
        XCTAssertEqual(groups[1].connectors.count, 8)
        XCTAssertEqual(groups[1].manageUrl, "https://grok.com/connectors")

        let key = try answer(#"{"manageUrl":"","canManage":true,"enabled":true,"claude":{"available":false,"reason":"key","connectors":[]},"codex":{"available":false}}"#)
        XCTAssertEqual(ProviderConnectorGroups.groups(claude: key, claudeLoading: false, grokConfigured: false)[0].notice?.action, .setup)
        XCTAssertNil(ProviderGroupNotice.unavailable("managed_policy").action)
    }

    /// #3358: the Grok section reads the person's own sign-ins from the registry.
    func testGrokRowsCarryTheirRealStateFromTheRegistry() throws {
        let both = try answer(#"""
        {"manageUrl":"","canManage":false,"enabled":true,"claude":{"available":true,"connectors":[]},"codex":{"available":false},
         "grok":{"accounts":[
           {"label":"Grok","slot":"primary","auth":"subscription","at":5,"connectors":[{"id":"outlook","name":"Outlook (Exchange)","status":"connected"},{"id":"microsoft-teams","name":"Microsoft Teams","status":"needs_auth"}]},
           {"label":"Grok (personal account)","slot":"second","kind":"personal","auth":"subscription","at":5,"connectors":[{"id":"microsoft-teams","name":"Microsoft Teams","status":"connected"},{"id":"gmail","name":"Gmail","status":"failed"}]}]}}
        """#)
        // the xAI catalog is not used, even with a Grok engine set up
        let grok = ProviderConnectorGroups.groups(claude: both, claudeLoading: false, grokConfigured: true)[1]
        XCTAssertNil(grok.notice)
        XCTAssertEqual(grok.connectors, [
            ProviderConnector(name: "Outlook (Exchange)", grokId: "outlook", status: "connected"),
            ProviderConnector(name: "Microsoft Teams", grokId: "microsoft-teams", status: "connected"),
            ProviderConnector(name: "Gmail", grokId: "gmail", status: "failed"),
        ])

        func notice(_ accounts: String) throws -> ProviderGroupNotice? {
            let json = #"{"manageUrl":"","canManage":false,"enabled":true,"claude":{"available":true,"connectors":[]},"codex":{"available":false},"grok":{"accounts":["# + accounts + "]}}"
            return ProviderConnectorGroups.groups(claude: try answer(json), claudeLoading: false, grokConfigured: true)[1].notice
        }
        XCTAssertEqual(try notice(""), .noAccount)
        XCTAssertEqual(try notice(#"{"label":"Grok","slot":"primary","auth":"subscription","at":5,"connectors":[]}"#), .empty)
        XCTAssertEqual(try notice(#"{"label":"Grok","slot":"primary","auth":"unknown","at":0,"connectors":[]}"#), .unavailable("unknown"))
        XCTAssertEqual(try notice(#"{"label":"Grok","slot":"primary","auth":"none","at":5,"connectors":[]}"#), .unavailable("not_signed_in"))
    }

    /// #3358: the ChatGPT group shows for a ChatGPT sign-in the registry lists.
    func testChatGPTGroupFromTheRegistry() throws {
        let listed = try answer(#"{"manageUrl":"","canManage":false,"enabled":true,"claude":{"available":true,"connectors":[]},"codex":{"available":true,"connectors":[{"name":"Notion","status":"connected"}]}}"#)
        let groups = ProviderConnectorGroups.groups(claude: listed, claudeLoading: false, grokConfigured: false)
        XCTAssertEqual(groups.map(\.engine), [.claude, .grok, .codex])
        XCTAssertEqual(groups[2].name, "ChatGPT")
        XCTAssertEqual(groups[2].connectors, [ProviderConnector(name: "Notion", status: "connected")])
        let none = try answer(#"{"manageUrl":"","canManage":false,"enabled":true,"claude":{"available":true,"connectors":[]},"codex":{"available":true,"connectors":[]}}"#)
        XCTAssertEqual(ProviderConnectorGroups.groups(claude: none, claudeLoading: false, grokConfigured: false)[2].notice, .empty)
    }

    func testPillsNeedTwoServices() {
        let groups = ProviderConnectorGroups.groups(claude: nil, claudeLoading: true, grokConfigured: true)
        XCTAssertEqual(ProviderConnectorGroups.services(groups, servers: false), ["all", "claude", "grok"])
        XCTAssertEqual(ProviderConnectorGroups.services(Array(groups.prefix(1)), servers: false), [])
        XCTAssertEqual(ProviderConnectorGroups.services(Array(groups.prefix(1)), servers: true), ["all", "claude", "servers"])
    }
}
