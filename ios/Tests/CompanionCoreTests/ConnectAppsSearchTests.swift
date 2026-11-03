// Connect apps' one search: every kind found from one field, grouped in
// order, each hit pointing where it opens; the tab in front narrows its own
// groups only.
import Foundation
import XCTest
@testable import CompanionCore

final class ConnectAppsSearchTests: XCTestCase {
    private func bot(_ id: String, _ name: String, title: String = "", source: BotCatalogSource = .mine, archived: Bool = false, category: String? = nil) -> BotCatalogEntry {
        BotCatalogEntry(id: id, name: name, title: title, owner: .init(principalId: "p_me", name: "Sam"), source: source, archived: archived,
                        catalog: category.map { .init(published: true, category: $0) })
    }

    private var sources: ConnectAppsSearchSources {
        let apps = ConnectApps.items(ConnectAppSources(
            servers: [ConnectAppServer(name: "research-docs", url: "https://mcp.example.com/mcp")],
            featured: [ConnectAppFeatured(id: "planboard", name: "Planboard", description: "Research boards", url: "https://mcp.planboard.example/mcp", domain: "planboard.example", auth: "oauth")],
            skills: [LibrarySkill(name: "research-notes", description: "Writes notes", source: "local-import", enabled: true)],
            marketplaces: [Marketplace(name: "research-market", source: "owner/research", plugins: [
                Marketplace.Plugin(name: "research-kit", description: "Tools", installed: true),
                Marketplace.Plugin(name: "other-kit", description: "Research helpers"),
            ])]
        ))
        return ConnectAppsSearchSources(
            apps: apps,
            bots: [
                bot("b1", "Research Assistant", source: .mine),
                bot("b2", "Planner", title: "Research lead", source: .shared, category: "product"),
                bot("b3", "Old Researcher", archived: true),
                bot("b4", "Writer", source: .organization),
            ],
            templates: [
                BotCatalogTemplate(id: "role:researcher", source: .role, name: "Researcher", title: "Research", description: "", color: "blue", creator: "Sagax", category: "product"),
                BotCatalogTemplate(id: "xai:scout", source: .xai, name: "Scout", title: "", description: "Deep research", color: "teal", creator: "xAI", category: nil, xaiSlug: "scout"),
            ],
            marketplaces: [Marketplace(name: "research-market", source: "owner/research")]
        )
    }

    func testOneQueryFindsEveryKindGroupedInOrder() {
        let sections = ConnectAppsSearch.sections(query: "research", sources: sources)
        XCTAssertEqual(sections.map(\.group), [.plugins, .skills, .servers, .bots, .templates, .xai, .marketplaces])
        let hits = Dictionary(uniqueKeysWithValues: sections.map { ($0.group, $0.hits.map(\.title)) })
        XCTAssertEqual(hits[.plugins], ["research-kit", "other-kit"], "installed first, then a plugin not installed found by its description")
        XCTAssertEqual(hits[.skills], ["research-notes"])
        XCTAssertEqual(hits[.servers], ["research-docs", "Planboard"], "a server the person added and a catalog app not installed")
        XCTAssertEqual(hits[.bots], ["Planner", "Research Assistant"], "mine and shared, found by name or role; archived hidden")
        XCTAssertEqual(hits[.templates], ["Researcher"])
        XCTAssertEqual(hits[.xai], ["Scout"])
        XCTAssertEqual(hits[.marketplaces], ["research-market"])
    }

    func testEachHitSaysWhereItOpens() throws {
        let sections = ConnectAppsSearch.sections(query: "research", sources: sources)
        let all = sections.flatMap(\.hits)
        func target(_ title: String) -> ConnectAppsSearchTarget? { all.first { $0.title == title }?.target }
        XCTAssertEqual(target("research-kit"), .app("plugin:research-kit@research-market"))
        XCTAssertEqual(target("research-docs"), .app("mcp:research-docs"))
        XCTAssertEqual(target("research-notes"), .skill("research-notes"))
        XCTAssertEqual(target("research-market"), .marketplace("research-market"))
        guard case let .catalog(item)? = target("Research Assistant") else { return XCTFail("a bot opens its card") }
        XCTAssertEqual(item.id, "bot:b1")
        guard case let .catalog(template)? = target("Scout") else { return XCTFail("a template opens its card") }
        XCTAssertEqual(template.id, "xai:scout")
    }

    func testAnEmptyQueryFindsNothingAndCaseAndAccentsAreIgnored() {
        XCTAssertTrue(ConnectAppsSearch.sections(query: "  ", sources: sources).isEmpty)
        let accented = ConnectAppsSearch.sections(query: "PLÀNNER", sources: sources)
        XCTAssertEqual(accented.map(\.group), [.bots])
        XCTAssertEqual(ConnectAppsSearch.sections(query: "no such thing", sources: sources), [])
    }

    func testTheTabInFrontNarrowsItsOwnGroupsOnly() {
        // Bots' category: only the bots and templates of that category
        let product = ConnectAppsSearch.sections(query: "research", sources: sources, filters: .init(botCategory: "product"))
        let byGroup = Dictionary(uniqueKeysWithValues: product.map { ($0.group, $0.hits.map(\.title)) })
        XCTAssertEqual(byGroup[.bots], ["Planner"])
        XCTAssertEqual(byGroup[.templates], ["Researcher"])
        XCTAssertNil(byGroup[.xai])
        XCTAssertEqual(byGroup[.skills], ["research-notes"], "the apps are not narrowed by a bot category")
        // archived bots show with Bots' switch
        let archived = ConnectAppsSearch.sections(query: "old", sources: sources, filters: .init(showArchived: true))
        XCTAssertEqual(archived.first?.hits.map(\.title), ["Old Researcher"])
        // Discover's type: only skills among the apps; bots untouched
        let skills = ConnectAppsSearch.sections(query: "research", sources: sources, filters: .init(appType: .skills))
        XCTAssertEqual(skills.map(\.group), [.skills, .bots, .templates, .xai, .marketplaces])
    }

    func testABotListedTwiceShowsOnce() {
        var twice = sources
        twice.bots.append(twice.bots[0])
        let bots = ConnectAppsSearch.sections(query: "assistant", sources: twice).first { $0.group == .bots }
        XCTAssertEqual(bots?.hits.count, 1)
    }

    func testNewSkillNameRuleAndSkillMarkdownAsTheDesktop() {
        XCTAssertTrue(CompanionClient.isSkillName("weekly-report"))
        XCTAssertTrue(CompanionClient.isSkillName("a1"))
        XCTAssertFalse(CompanionClient.isSkillName("Weekly"))
        XCTAssertFalse(CompanionClient.isSkillName("double--hyphen"))
        XCTAssertFalse(CompanionClient.isSkillName("-lead"))
        XCTAssertFalse(CompanionClient.isSkillName(""))
        XCTAssertFalse(CompanionClient.isSkillName(String(repeating: "a", count: 65)))
        XCTAssertEqual(CompanionClient.skillMarkdown(name: " notes ", description: "Takes\n notes  well", instructions: "Step one\r\nStep two\n\n"),
                       "---\nname: notes\ndescription: Takes notes well\n---\n\nStep one\nStep two\n")
    }
}
