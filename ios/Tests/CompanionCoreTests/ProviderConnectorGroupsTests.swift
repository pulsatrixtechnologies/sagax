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

    func testPillsNeedTwoServices() {
        let groups = ProviderConnectorGroups.groups(claude: nil, claudeLoading: true, grokConfigured: true)
        XCTAssertEqual(ProviderConnectorGroups.services(groups, servers: false), ["all", "claude", "grok"])
        XCTAssertEqual(ProviderConnectorGroups.services(Array(groups.prefix(1)), servers: false), [])
        XCTAssertEqual(ProviderConnectorGroups.services(Array(groups.prefix(1)), servers: true), ["all", "claude", "servers"])
    }
}
