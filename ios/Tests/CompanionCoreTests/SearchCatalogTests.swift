// The search sheet's lists (SearchCatalog): grouped by type, pinned then
// recent, people on an organization server only, New chat limited to who
// one can write to, and the bold run of each result.
import XCTest
@testable import CompanionCore

final class SearchCatalogTests: XCTestCase {
    private func bot(_ id: String, name: String, pinned: Bool = false, hidden: Bool = false, tasks: [BotTask]? = nil, createdAt: Double = 1) -> Bot {
        var bot = Bot(
            id: id, threadId: "t-\(id)", name: name, title: "Helper",
            description: "", notifications: true, color: "green", unread: false,
            modelSelection: ModelSelection(instanceId: "engine", model: "default"), createdAt: createdAt,
            tasks: tasks
        )
        bot.pinned = pinned
        bot.hidden = hidden
        return bot
    }

    private func room(_ id: String, name: String, members: [String] = [], peopleDm: Bool? = nil, dm: Bool? = nil) -> Room {
        var room = Room(
            id: id, threadId: "t-\(id)", name: name, memberIds: members, defaultResponder: GroupResponder(kind: "mentions"),
            bulletin: "", unread: false, createdAt: 1
        )
        room.peopleDm = peopleDm
        room.dm = dm
        return room
    }

    private let people = [
        OrgDirectoryPerson(principalId: "pr_sam", name: "Sam Rivera", login: "sam.rivera", email: "sam@x.test", role: "member"),
        OrgDirectoryPerson(principalId: "pr_ali", name: "Alice Martin", login: "alice", email: "alice@x.test", role: "admin"),
    ]

    private func hit(_ snippet: String, start: Int, length: Int) -> SearchHit {
        SearchHit(threadId: "t-a", messageId: "m1", at: 5, role: .bot, kind: .text, snippet: snippet,
                  matchStart: start, matchLength: length, botId: "a", groupId: nil, name: "Aurora", task: nil, onActivePath: true)
    }

    private func ids(_ entries: [SearchEntry]) -> [String] { entries.map(\.id) }

    func testEmptySearchListsBotsThenGroupChatsThenPeoplePinnedFirstThenRecent() {
        let bots = [bot("a", name: "Aurora"), bot("h", name: "Helix", pinned: true), bot("x", name: "Hidden", hidden: true), bot("z", name: "Zed")]
        let rooms = [room("ops", name: "Ops"), room("dm", name: "Sam", peopleDm: true), room("b2b", name: "Pair", dm: true)]
        let recency: (String) -> Double? = { ["t-z": 50, "t-a": 10][$0] }
        let entries = SearchCatalog.entries(
            mode: .search, query: "", scopes: Set(SearchScope.allCases), bots: bots, rooms: rooms,
            people: people, hits: [], canCreateBots: true, recency: recency
        )
        XCTAssertEqual(ids(entries), ["bot.h", "bot.z", "bot.a", "room.ops", "person.pr_ali", "person.pr_sam"])
    }

    func testTypedSearchAddsThreadsAndMessagesAndRanksNameStartsFirst() {
        let tasks = [BotTask(threadId: "t1", title: "Quarterly report", createdAt: 3), BotTask(threadId: "t2", title: "Lunch", createdAt: 4)]
        let bots = [bot("a", name: "Reporter's aide", tasks: tasks), bot("r", name: "Report bot")]
        let entries = SearchCatalog.entries(
            mode: .search, query: " report ", scopes: Set(SearchScope.allCases), bots: bots, rooms: [],
            people: people, hits: [hit("the report is due", start: 4, length: 6)], canCreateBots: true, recency: { _ in nil }
        )
        XCTAssertEqual(ids(entries), ["bot.a", "bot.r", "thread.a.t1", "hit.t-a:m1"])
    }

    func testScopesNarrowTheList() {
        let entries = SearchCatalog.entries(
            mode: .search, query: "a", scopes: [.people], bots: [bot("a", name: "Aurora")], rooms: [room("r", name: "Alpha")],
            people: people, hits: [], canCreateBots: true, recency: { _ in nil }
        )
        XCTAssertEqual(ids(entries), ["person.pr_ali", "person.pr_sam"])
    }

    func testOneLetterNeverListsMessages() {
        let entries = SearchCatalog.entries(
            mode: .search, query: "r", scopes: [.messages], bots: [], rooms: [],
            people: [], hits: [hit("r", start: 0, length: 1)], canCreateBots: true, recency: { _ in nil }
        )
        XCTAssertTrue(entries.isEmpty)
    }

    func testNewChatLeadsWithTheCreateRowsThenBotsAndPeopleOnly() {
        let bots = [bot("a", name: "Aurora")]
        let rooms = [room("ops", name: "Ops")]
        let all = SearchCatalog.entries(
            mode: .newChat, query: "", scopes: [.bots, .people], bots: bots, rooms: rooms,
            people: people, hits: [], canCreateBots: true, recency: { _ in nil }
        )
        XCTAssertEqual(ids(all), ["create-bot", "create-group", "bot.a", "person.pr_ali", "person.pr_sam"])
        let member = SearchCatalog.entries(
            mode: .newChat, query: "sam", scopes: [.bots, .people], bots: bots, rooms: rooms,
            people: people, hits: [], canCreateBots: false, recency: { _ in nil }
        )
        XCTAssertEqual(ids(member), ["person.pr_sam"])
    }

    func testFilterMenuOffersMembersOnlyOnAnOrganizationServer() {
        XCTAssertEqual(SearchCatalog.scopes(mode: .search, organization: false), [.bots, .groups, .threads, .messages])
        XCTAssertEqual(SearchCatalog.scopes(mode: .search, organization: true), SearchScope.allCases)
        XCTAssertEqual(SearchCatalog.scopes(mode: .newChat, organization: false), [.bots])
        XCTAssertEqual(SearchCatalog.scopes(mode: .newChat, organization: true), [.bots, .people])
    }

    func testHighlightUsesTheServerMatchInUtf16Units() throws {
        let snippet = "café 😀 report"
        let start = ("café 😀 " as NSString).length
        let range = try XCTUnwrap(SearchCatalog.highlightRange(in: hit(snippet, start: start, length: 6), query: "zzz"))
        XCTAssertEqual(String(snippet[range]), "report")
    }

    func testHighlightFallsBackToTheQueryIgnoringCaseAndAccents() throws {
        let text = "Équipe Réseau"
        let range = try XCTUnwrap(SearchCatalog.highlightRange(in: text, query: "reseau"))
        XCTAssertEqual(String(text[range]), "Réseau")
        XCTAssertNil(SearchCatalog.highlightRange(in: text, query: "  "))
    }

    func testDesktopComposeListsPeopleAfterTheBotsInBrowseModeOnly() {
        let bots = [bot("a", name: "Aurora")]
        XCTAssertEqual(
            DesktopComposeTo.rows(mode: .browse, bots: bots, canCreateBots: true, people: people),
            [.createBot, .createBotWizard, .createGroup, .bot("a"), .person("pr_sam"), .person("pr_ali")]
        )
        XCTAssertEqual(DesktopComposeTo.rows(mode: .group, bots: bots, canCreateBots: true, people: people), [.createGroup, .bot("a")])
    }
}
