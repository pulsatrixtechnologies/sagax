// Connect apps on the phone (#203, #206, #218): the same rows, categories,
// sections and counts as the desktop's src/lib/plugins-model.ts (the cases of
// plugins-model.test.ts, ported).
import Foundation
import XCTest
@testable import CompanionCore

final class ConnectAppsTests: XCTestCase {
    private var sources: ConnectAppSources {
        ConnectAppSources(
            servers: [ConnectAppServer(name: "docs", url: "https://mcp.example.com/mcp", auth: "required"),
                      ConnectAppServer(name: "notes", enabled: false, command: "npx")],
            featured: [ConnectAppFeatured(id: "linear", name: "Linear", url: "https://mcp.linear.app/mcp", domain: "mcp.linear.app", auth: "oauth", site: "linear.app", category: "code"),
                       ConnectAppFeatured(id: "same", name: "Docs", url: "https://mcp.example.com/mcp", domain: "example.com")],
            skills: [LibrarySkill(name: "release-notes", description: "Writes notes", source: "local-import", enabled: true)]
        )
    }

    private func byKey(_ items: [ConnectAppItem]) -> [String: ConnectAppItem] {
        Dictionary(uniqueKeysWithValues: items.map { ($0.key, $0) })
    }

    func testEverySourceBecomesARowWithTheRightButtonAndStatus() throws {
        let items = byKey(ConnectApps.items(sources))
        XCTAssertEqual(items["mcp:docs"]?.status, .needsAuth)
        XCTAssertEqual(items["mcp:docs"]?.source, "manual")
        XCTAssertEqual(items["mcp:notes"]?.status, .off)
        XCTAssertEqual(items["featured:linear"]?.action, .connect)
        XCTAssertEqual(items["featured:linear"]?.domain, "linear.app")
        XCTAssertEqual(items["featured:linear"]?.category, .code)
        XCTAssertNil(items["featured:same"], "a catalog plugin that is the same as a server shows once, as its server")
        XCTAssertEqual(items["skill:release-notes"]?.source, "local")
    }

    func testCategoriesComeFromTagsNeverFromTheName() {
        XCTAssertEqual(ConnectAppCategory.fromTags(["password managers"]), .passwords)
        XCTAssertEqual(ConnectAppCategory.fromTags(["design & creative tools"]), .design)
        XCTAssertEqual(ConnectAppCategory.fromTags(["developer tools"]), .code)
        XCTAssertEqual(ConnectAppCategory.fromTags(["document & file management"]), .productivity)
        XCTAssertEqual(ConnectAppCategory.fromTags(["crm"]), .sales)
        XCTAssertEqual(ConnectAppCategory.fromTags(["accounting"]), .finance)
        XCTAssertEqual(ConnectAppCategory.fromTags(["analytics"]), .data)
        XCTAssertEqual(ConnectAppCategory.fromTags(["customer support"]), .support)
        XCTAssertEqual(ConnectAppCategory.fromTags(["ai", "email marketing"]), .marketing)
        XCTAssertEqual(ConnectAppCategory.fromTags(["ai"]), .other)
        XCTAssertEqual(ConnectAppCategory.fromTags(nil), .other)
    }

    func testSectionsPerCategoryAndOneListForASearch() throws {
        let items = ConnectApps.items(sources)
        XCTAssertEqual(ConnectApps.sections(items, query: "").map(\.id), [
            .recommended, .category(.code), .mcp, .skills,
        ])
        let search = ConnectApps.sections(items, query: "notes")
        XCTAssertEqual(search.count, 1)
        XCTAssertEqual(search[0].items.map(\.key).sorted(), ["mcp:notes", "skill:release-notes"])
        XCTAssertEqual(ConnectApps.sections(items, query: "", type: .mcp).count, 1)
        XCTAssertFalse(items.filter { ConnectApps.matches($0, filter: .category(.other)) }.contains { $0.kind == .skill })
    }

    func testTheHeaderCountsConnectedPluginsSkillsApart() {
        let items = ConnectApps.items(sources)
        XCTAssertEqual(ConnectApps.installed(items).map(\.key), ["mcp:docs", "mcp:notes"])
        let summary = ConnectApps.connected(items)
        XCTAssertEqual(summary.count, 0, "neither server is connected: one needs sign-in, one is off")
        XCTAssertEqual(ConnectApps.connected(items, extra: 3).count, 3, "Claude connectors count too")
        XCTAssertEqual(ConnectApps.privateSkills(items).map(\.key), ["skill:release-notes"])
    }

    func testMarketplacePluginsFoldWhatTheyBrought() {
        var withMarket = sources
        withMarket.servers.append(ConnectAppServer(name: "devjc-notes", url: "https://notes.example.com/mcp", source: "devjc"))
        withMarket.skills.append(LibrarySkill(name: "triage", source: "devjc", enabled: false))
        withMarket.marketplaces = [Marketplace(name: "devjc", plugins: [
            .init(name: "notes", description: "Notes for bots", version: "1.0.0", installed: true, servers: ["devjc-notes"], skills: ["triage"]),
            .init(name: "figma-kit", description: "Design helpers", category: "design"),
        ])]
        let items = ConnectApps.items(withMarket)
        let keyed = byKey(items)
        XCTAssertEqual(keyed["plugin:notes@devjc"]?.version, "1.0.0")
        XCTAssertEqual(keyed["plugin:figma-kit@devjc"]?.action, .add)
        XCTAssertEqual(keyed["plugin:figma-kit@devjc"]?.category, .design)
        XCTAssertEqual(keyed["mcp:devjc-notes"]?.parent, "plugin:notes@devjc")
        XCTAssertEqual(keyed["skill:triage"]?.parent, "plugin:notes@devjc")
        let section = ConnectApps.sections(items, query: "", extraSources: ["devjc"]).first { $0.id == .source("devjc") }
        XCTAssertEqual(section?.items.map(\.key), ["plugin:notes@devjc", "plugin:figma-kit@devjc"])
        XCTAssertTrue(ConnectApps.installed(items).map(\.key).contains("plugin:notes@devjc"))
        XCTAssertFalse(ConnectApps.installed(items).map(\.key).contains("mcp:devjc-notes"))
    }

    func testOneRowPerAppAcrossSources() {
        XCTAssertEqual(ConnectApps.appKey("Asana"), ConnectApps.appKey("asana"))
        XCTAssertEqual(ConnectApps.appKey("Notion MCP"), "notion")
        XCTAssertEqual(ConnectApps.appKey("Café (beta)"), "cafe")
        let items = ConnectApps.items(ConnectAppSources(
            servers: [ConnectAppServer(name: "Notion MCP", url: "https://mcp.notion.com/mcp", auth: "connected")],
            featured: [ConnectAppFeatured(id: "notion", name: "Notion", url: "https://mcp.notion.example/sse", domain: "mcp.notion.example", auth: "oauth", site: "notion.so", category: "productivity"),
                       ConnectAppFeatured(id: "asana", name: "Asana", url: "https://mcp.asana.com/sse", domain: "mcp.asana.com", auth: "oauth", site: "asana.com", category: "productivity")]
        ))
        let notion = items.filter { ConnectApps.appKey($0.name) == "notion" }
        XCTAssertEqual(notion.map(\.key), ["mcp:Notion MCP"], "what is installed shows")
        let asana = items.filter { ConnectApps.appKey($0.name) == "asana" }
        XCTAssertEqual(asana.map(\.key), ["featured:asana"], "the catalog entry is offered when nothing is installed")
        XCTAssertTrue(asana[0].recommended)
        XCTAssertEqual(asana[0].domain, "asana.com")
    }

    func testToolSwitchesFollowDisabledTools() throws {
        let probe = try JSONDecoder().decode(MCPProbe.self, from: Data(#"{"ok":true,"tools":[{"name":"read_note"},{"name":"delete_note","description":"Deletes"}]}"#.utf8))
        XCTAssertEqual(probe.switches(disabled: ["delete_note"]).map(\.enabled), [true, false])
        XCTAssertEqual(MCPToolSwitch.toggled(["b"], tool: "a", enabled: false), ["a", "b"])
        XCTAssertEqual(MCPToolSwitch.toggled(["a", "b"], tool: "a", enabled: true), ["b"])
    }
}
