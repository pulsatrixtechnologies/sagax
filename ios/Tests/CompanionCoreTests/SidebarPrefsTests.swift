// The synced sidebar preferences (matrix package WP6): the same parsing,
// edits and layout as the desktop's modules (src/lib/personal-sections.ts,
// sidebar-hidden.ts, sidebar-layout.ts), and the server record round trip.
import Foundation
import XCTest
@testable import CompanionCore

private final class PrefsStub: URLProtocol {
    static var routes: [String: (Int, String)] = [:]
    static var requests: [(method: String, path: String, query: String?, body: Data?)] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var body = request.httpBody
        if body == nil, let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 1_024)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
            stream.close()
            body = data
        }
        let method = request.httpMethod ?? "GET"
        Self.requests.append((method, request.url!.path, request.url!.query, body))
        let (status, text) = Self.routes["\(method) \(request.url!.path)"] ?? (404, #"{"error":"not found"}"#)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(text.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class SidebarPrefsTests: XCTestCase {
    private func ok(_ result: Result<PersonalSections, PersonalSectionError>, file: StaticString = #filePath, line: UInt = #line) -> PersonalSections {
        switch result {
        case let .success(value): return value
        case let .failure(error):
            XCTFail("refused: \(error)", file: file, line: line)
            return .empty
        }
    }

    private func refused(_ result: Result<PersonalSections, PersonalSectionError>) -> PersonalSectionError? {
        if case let .failure(error) = result { return error }
        return nil
    }

    // MARK: Personal sections

    func testCreatesRenamesAndRefusesGeneralDuplicatesAndBadNames() {
        var prefs = ok(PersonalSections.empty.creating(" Ventes "))
        prefs = ok(prefs.creating("TEST"))
        XCTAssertEqual(prefs.names, ["Ventes", "TEST"])
        XCTAssertEqual(refused(prefs.creating("Ventes")), .exists)
        for reserved in ["General", "général", "Sans section", "Unassigned", "Non assigné", "Não atribuído"] {
            XCTAssertEqual(refused(prefs.creating(reserved)), .reserved)
        }
        XCTAssertEqual(refused(prefs.creating("")), .badName)
        XCTAssertEqual(refused(prefs.creating(String(repeating: "x", count: 61))), .badName)
        prefs = ok(prefs.assigning("bot:b1", to: "Ventes"))
        prefs = ok(prefs.renaming("Ventes", to: "Ventes QC"))
        XCTAssertEqual(prefs.section(of: "bot:b1"), "Ventes QC")
        XCTAssertEqual(refused(prefs.renaming("Ventes QC", to: "TEST")), .exists)
        XCTAssertEqual(refused(prefs.renaming("Nope", to: "Other")), .missing)
    }

    func testFilesAnItemInOneSectionAtATime() {
        var prefs = ok(PersonalSections.empty.assigning("bot:b1", to: "Ops"))
        prefs = ok(prefs.assigning("group:g1", to: "Ops"))
        prefs = ok(prefs.assigning("bot:b1", to: "Ventes"))
        XCTAssertEqual(prefs.sections, [PersonalSection(name: "Ops", items: ["group:g1"]), PersonalSection(name: "Ventes", items: ["bot:b1"])])
        prefs = ok(prefs.assigning("bot:b1", to: ""))
        XCTAssertNil(prefs.section(of: "bot:b1"))
        XCTAssertEqual(prefs.names, ["Ops", "Ventes"], "only Delete removes a section")
        XCTAssertEqual(prefs.deleting("Ops").names, ["Ventes"])
    }

    func testParsesLikeTheDesktopAndKeepsUnknownFields() {
        let prefs = ok(PersonalSections.empty.assigning("bot:b1", to: "Ops"))
        XCTAssertEqual(PersonalSections.parse(prefs.serialized()), prefs)
        XCTAssertNil(PersonalSections.parse(nil))
        XCTAssertNil(PersonalSections.parse("{nope"))
        let messy = #"{"sections":[{"name":"General","items":["bot:a"]},{"name":"Ops","items":["bot:a","weird"]},{"name":"Ops","items":["bot:b"]},{"name":"Ventes","items":["bot:a","group:g"]}],"later":{"x":1}}"#
        let parsed = PersonalSections.parse(messy)
        XCTAssertEqual(parsed?.sections, [PersonalSection(name: "Ops", items: ["bot:a"]), PersonalSection(name: "Ventes", items: ["group:g"])])
        // a field a newer desktop adds survives the phone's save
        let saved = parsed!.deleting("Ops").serialized(over: messy)
        let object = try? JSONSerialization.jsonObject(with: Data(saved.utf8)) as? [String: Any]
        XCTAssertEqual((object?["later"] as? [String: Any])?["x"] as? Int, 1)
        XCTAssertEqual(PersonalSections.parse(saved)?.names, ["Ventes"])
    }

    func testRefusesAValueTooBigToSync() {
        var prefs = PersonalSections.empty
        for index in 0..<40 {
            prefs.sections.append(PersonalSection(name: "S\(index)", items: (0..<10).map { "bot:\(index)-\($0)-" + String(repeating: "x", count: 10) }))
        }
        XCTAssertFalse(prefs.fits)
        XCTAssertEqual(refused(prefs.creating("Another")), .full)
    }

    // MARK: Hidden

    func testHidesAndShowsBackByKindAndIdPeopleLowercased() {
        XCTAssertEqual(SidebarHidden.parse(nil), .default)
        XCTAssertTrue(SidebarHidden.default.unhidePeople)
        XCTAssertFalse(SidebarHidden.default.unhideBots)
        var hidden = SidebarHidden.default.hiding(.bot, "b1", at: 10).hiding(.person, " Bob@Example.test ", at: 11)
        XCTAssertEqual(hidden.keys, ["bot:b1", "person:bob@example.test"])
        hidden = hidden.hiding(.bot, "b1", at: 20)
        XCTAssertEqual(hidden.items.count, 2)
        XCTAssertEqual(hidden.items.last?.at, 20)
        let round = SidebarHidden.parse(hidden.serialized())
        XCTAssertEqual(round, hidden)
        XCTAssertEqual(round.showing(["bot:b1"]).keys, ["person:bob@example.test"])
        // one bad entry drops the list, as the desktop's schema does
        XCTAssertTrue(SidebarHidden.parse(#"{"items":[{"kind":"bot","id":"a","at":1},{"kind":"robot","id":"b","at":1}]}"#).items.isEmpty)
        XCTAssertEqual(SidebarHidden.parse(#"{"items":[],"unhideOnMessage":{"people":false,"bots":true}}"#).unhideBots, true)
    }

    func testANewUnreadMessageBringsPeopleBackAndBotsOnlyWhenAsked() throws {
        var state = CompanionState()
        state.hydrate(try fleet())
        var bot = try XCTUnwrap(state.bots.first)
        bot.unread = true
        state.bots = [bot]
        var room = try XCTUnwrap(state.rooms.first)
        room.unread = true
        state.rooms = [room]
        let latest = max(state.messages[bot.threadId]?.last?.at ?? 0, (bot.tasks ?? []).compactMap(\.updatedAt).max() ?? 0)
        state.messages[room.threadId] = [message("m", at: 5_000)]
        let hidden = SidebarHidden.default.hiding(.bot, bot.id, at: latest - 1).hiding(.group, room.id, at: 1)
        XCTAssertEqual(hidden.entriesToUnhide(state: state, viewerId: "me"), ["group:\(room.id)"])
        var bots = hidden
        bots.unhideBots = true
        XCTAssertEqual(Set(bots.entriesToUnhide(state: state, viewerId: "me")), ["group:\(room.id)", "bot:\(bot.id)"])
        // hidden after the last message: stays hidden
        XCTAssertTrue(SidebarHidden.default.hiding(.group, room.id, at: 9_000).entriesToUnhide(state: state, viewerId: "me").isEmpty)
    }

    func testAClosedPeopleConversationComesBackOnAMessageAndWhenSelectedAndIsNeverListed() throws {
        // #219: a DM with a person closes; a new message always reopens it,
        // whatever the people switch says, and it is never under Hidden
        var state = try layoutState()
        var dm = try XCTUnwrap(state.rooms.first)
        dm.id = "dm"; dm.threadId = "t-dm"; dm.peopleDm = true; dm.humanIds = ["me", "pr_bob"]; dm.unread = true
        state.rooms.append(dm)
        state.messages[dm.threadId] = [message("m", at: 5_000)]
        var hidden = SidebarHidden.default.hiding(.person, "PR_BOB", at: 1)
        hidden.unhidePeople = false
        XCTAssertEqual(hidden.entriesToUnhide(state: state, viewerId: "me"), ["person:pr_bob"])

        var prefs = SidebarPrefs()
        prefs.setHidden(hidden)
        let layout = state.sidebarLayout(prefs: prefs, personal: nil, viewerId: "me")
        XCTAssertFalse(layout.unsectionedChannels.contains { $0.id == "dm" }, "closed: off the home")
        XCTAssertTrue(state.sidebarHiddenRows(hidden).isEmpty, "never listed under Hidden")

        XCTAssertEqual(hidden.reopening(dm, viewerId: "me")?.items, [])
        XCTAssertNil(SidebarHidden.default.reopening(dm, viewerId: "me"), "not closed: nothing to reopen")
        var group = dm
        group.peopleDm = nil
        XCTAssertNil(hidden.reopening(group, viewerId: "me"), "a group is hidden, not closed")
    }

    // MARK: Order and folding

    func testOrderMoveAndMergeAsTheDesktop() {
        let work = SidebarSectionID.user("Work")
        let natural = [SidebarSectionID.general, SidebarSectionID.botChats, work]
        XCTAssertEqual(SidebarSectionID.ordered(natural, saved: []), natural)
        let saved = [work, SidebarSectionID.general]
        // a newly visible bucket goes before its natural successor (sidebar-layout.ts)
        XCTAssertEqual(SidebarSectionID.ordered(natural, saved: saved), [SidebarSectionID.botChats, work, SidebarSectionID.general])
        XCTAssertEqual(SidebarSectionID.ordered([SidebarSectionID.general, work, SidebarSectionID.botChats], saved: saved), [work, SidebarSectionID.botChats, SidebarSectionID.general])
        XCTAssertEqual(SidebarSectionID.move(natural, SidebarSectionID.general, by: -1), natural)
        XCTAssertEqual(SidebarSectionID.move(natural, work, by: -1), [SidebarSectionID.general, work, SidebarSectionID.botChats])
        let personal = SidebarSectionID.user("Personal")
        XCTAssertEqual(SidebarSectionID.merge(saved: [work, personal, SidebarSectionID.general], visible: [SidebarSectionID.general]), [work, personal, SidebarSectionID.general])
        XCTAssertEqual(SidebarSectionID.merge(saved: [work, SidebarSectionID.general, SidebarSectionID.botChats], visible: [SidebarSectionID.botChats, SidebarSectionID.general]), [SidebarSectionID.botChats, work, SidebarSectionID.general])
        XCTAssertEqual(SidebarSectionID.parseList(#"["a","a","",3]"#), [])
        XCTAssertEqual(SidebarSectionID.parseList(#"["a","a","b"]"#), ["a", "b"])
        XCTAssertEqual(SidebarSectionID.serializeList(["section:a/b", "x"]), #"["section:a/b","x"]"#)
        XCTAssertEqual(SidebarSectionID.toggle(["a"], "a"), [])
    }

    func testPrefsKeepOnlyTheirKeysAndCarryARename() {
        var prefs = SidebarPrefs(values: ["omb-skin": "dusk", SidebarPrefKey.showThreads: "0"])
        XCTAssertEqual(prefs.values.keys.sorted(), [SidebarPrefKey.showThreads])
        XCTAssertEqual(prefs.showThreads, false)
        XCTAssertNil(SidebarPrefs().showThreads)
        prefs.setCollapsed([SidebarSectionID.user("Ops"), SidebarSectionID.general])
        prefs.setSectionOrder([SidebarSectionID.user("Ops")])
        prefs.renameSectionID(from: "Ops", to: "Ops QC")
        XCTAssertEqual(prefs.collapsed, [SidebarSectionID.user("Ops QC"), SidebarSectionID.general])
        XCTAssertEqual(prefs.sectionOrder, [SidebarSectionID.user("Ops QC")])
        XCTAssertEqual(prefs.changedKeys(from: SidebarPrefs()), [SidebarPrefKey.showThreads, SidebarPrefKey.collapsedSections, SidebarPrefKey.sectionOrder])
    }

    // MARK: Layout

    private func fleet() throws -> Fleet {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: "bots-paged", withExtension: "json", subdirectory: "Fixtures")
                ?? Bundle.module.url(forResource: "bots-paged", withExtension: "json")
        )
        return try JSONDecoder().decode(Fleet.self, from: try Data(contentsOf: url))
    }

    private func message(_ id: String, at: Double) -> Message {
        Message(id: id, role: .bot, kind: .text, at: at)
    }

    private func layoutState() throws -> CompanionState {
        let source = try fleet()
        var a = try XCTUnwrap(source.bots.first)
        a.id = "a"; a.section = "Research"; a.pinned = nil; a.chiefOfStaff = nil; a.hidden = nil
        var b = a
        b.id = "b"; b.section = "Personal"
        var c = a
        c.id = "c"; c.section = nil
        var room = try XCTUnwrap(source.groups.first)
        room.id = "r"; room.section = nil; room.dm = nil; room.peopleDm = nil
        var state = CompanionState()
        state.bots = [a, b, c]
        state.rooms = [room]
        state.sectionOrder = ["Research", "Personal", "Empty"]
        return state
    }

    func testAPinnedPrimaryBotJoinsThePinnedSection() throws {
        var state = try layoutState()
        state.bots[2].chiefOfStaff = true
        state.bots[2].pinned = true
        let prefs = SidebarPrefs()
        var layout = state.sidebarLayout(prefs: prefs, personal: nil, viewerId: "me")
        XCTAssertEqual(layout.pinnedBots.map(\.id), ["c"])
        XCTAssertNil(layout.unsectionedChief)

        state.bots[2].pinned = false
        layout = state.sidebarLayout(prefs: prefs, personal: nil, viewerId: "me")
        XCTAssertEqual(layout.unsectionedChief?.id, "c")
        XCTAssertTrue(layout.pinnedBots.isEmpty)
    }

    func testLayoutAppliesOrderHiddenAndKeepsEmptySections() throws {
        let state = try layoutState()
        var prefs = SidebarPrefs()
        var layout = state.sidebarLayout(prefs: prefs, personal: nil, viewerId: "me")
        XCTAssertEqual(layout.sectionNames, ["Research", "Personal", "Empty"])
        XCTAssertEqual(layout.sectionIds.first, SidebarSectionID.general)
        XCTAssertEqual(layout.unsectionedBots.map(\.id), ["c"])

        let moved = try XCTUnwrap(layout.order(moving: "Personal", by: -1, saved: prefs.sectionOrder))
        prefs.setSectionOrder(moved)
        layout = state.sidebarLayout(prefs: prefs, personal: nil, viewerId: "me")
        XCTAssertEqual(layout.sectionNames, ["Personal", "Research", "Empty"])
        XCTAssertFalse(layout.canMove("Personal", by: -1))
        XCTAssertTrue(layout.canMove("Personal", by: 1))

        prefs.setHidden(SidebarHidden.default.hiding(.bot, "a", at: 1).hiding(.group, "r", at: 1))
        layout = state.sidebarLayout(prefs: prefs, personal: nil, viewerId: "me")
        XCTAssertTrue(layout.sections.first { $0.name == "Research" }?.bots.isEmpty == true)
        XCTAssertTrue(layout.unsectionedChannels.isEmpty)
        XCTAssertEqual(state.sidebarHiddenRows(prefs.hidden).map(\.key).sorted(), ["bot:a", "group:r"])
    }

    func testAHiddenEntryIsGoneFromTheSidebarAndComesBackFromSettings() throws {
        // #3576: hidden means gone from the sidebar and the home list
        // completely, no "Hidden (N)" row; Settings > Appearance > Hidden
        // from the sidebar is the one place that lists it, with Show
        let state = try layoutState()
        var prefs = SidebarPrefs()
        prefs.setHidden(SidebarHidden.default.hiding(.bot, "a", at: 1).hiding(.group, "r", at: 1))
        let layout = state.sidebarLayout(prefs: prefs, personal: nil, viewerId: "me")
        let drawnBots = (layout.pinnedBots + layout.unsectionedBots + [layout.unsectionedChief].compactMap { $0 }
            + layout.sections.flatMap { $0.bots + $0.chiefs }).map(\.id)
        let drawnRooms = (layout.unsectionedChannels + layout.botChats + layout.sections.flatMap(\.channels)).map(\.id)
        XCTAssertFalse(drawnBots.contains("a"), "a hidden bot is drawn nowhere in the sidebar")
        XCTAssertFalse(drawnRooms.contains("r"), "a hidden group is drawn nowhere in the sidebar")
        let labels = Mirror(reflecting: layout).children.compactMap(\.label)
        XCTAssertFalse(labels.contains { $0.lowercased().contains("hidden") }, "the layout the sidebar draws carries no hidden list: \(labels)")

        let rows = state.sidebarHiddenRows(prefs.hidden)
        XCTAssertEqual(Set(rows.map(\.key)), ["bot:a", "group:r"])
        XCTAssertEqual(Set(rows.map(\.kind)), [.bot, .group])
        XCTAssertTrue(rows.allSatisfy { !$0.name.isEmpty }, "each listed by its name")

        // Show (Settings) brings the entry back to the sidebar
        let bot = try XCTUnwrap(rows.first { $0.key == "bot:a" })
        prefs.setHidden(prefs.hidden.showing([bot.key]))
        let back = state.sidebarLayout(prefs: prefs, personal: nil, viewerId: "me")
        let backBots = (back.pinnedBots + back.unsectionedBots + [back.unsectionedChief].compactMap { $0 }
            + back.sections.flatMap { $0.bots + $0.chiefs }).map(\.id)
        XCTAssertTrue(backBots.contains("a"), "Show puts the bot back in the sidebar")
        XCTAssertEqual(state.sidebarHiddenRows(prefs.hidden).map(\.key), ["group:r"])
    }

    func testPersonalSectionsReplaceTheServersAndPutGeneralOnTop() throws {
        let state = try layoutState()
        var personal = ok(PersonalSections.empty.assigning("bot:c", to: "Mine"))
        personal = ok(personal.assigning("group:r", to: "Mine"))
        personal = ok(personal.creating("Empty one"))
        var prefs = SidebarPrefs()
        prefs.setSectionOrder([SidebarSectionID.user("Mine"), SidebarSectionID.general])
        let layout = state.sidebarLayout(prefs: prefs, personal: personal, viewerId: "me")
        XCTAssertTrue(layout.personal)
        XCTAssertEqual(layout.sectionNames, ["Mine", "Empty one"])
        XCTAssertEqual(layout.sectionIds.first, SidebarSectionID.general, "Unassigned stays on top on an organization server")
        XCTAssertEqual(layout.sections.first?.bots.map(\.id), ["c"])
        XCTAssertEqual(layout.sections.first?.channels.map(\.id), ["r"])
        XCTAssertEqual(layout.unsectionedBots.map(\.id), ["a", "b"], "the server's sections do not apply")
    }

    func testSeedKeepsOwnBotsSectionsAndLeavesSharedOnesInGeneral() throws {
        var state = try layoutState()
        state.bots[1].ownerUserId = "someone-else"
        let seeded = PersonalSections.seed(bots: state.bots, rooms: state.rooms, sections: state.sectionOrder, viewerId: "ME")
        XCTAssertEqual(seeded.sections, [PersonalSection(name: "Research", items: ["bot:a"])])
    }

    // MARK: Server record

    private func stubClient() -> CompanionClient {
        PrefsStub.routes = [:]
        PrefsStub.requests = []
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PrefsStub.self]
        return CompanionClient(
            connection: Connection(name: "Test", host: "127.0.0.1", port: 8811),
            token: "paired-token",
            session: URLSession(configuration: configuration)
        )
    }

    func testAPersonalComputerKeepsThemOnTheDevice() async throws {
        let client = stubClient()
        let record = try await client.sidebarPreferenceRecord()
        XCTAssertNil(record)
    }

    func testSavingChangesOnlyTheSidebarKeysAndKeepsTheRest() async throws {
        let client = stubClient()
        PrefsStub.routes["GET /api/me/preferences"] = (200, #"{"stored":true,"preferences":{"omb-skin":"dusk","omb-show-threads":"1","sagax.busySend.v1":"steer"},"updatedAt":1}"#)
        PrefsStub.routes["PUT /api/me/preferences"] = (200, #"{"stored":true,"preferences":{},"updatedAt":2}"#)
        let record = try await client.sidebarPreferenceRecord()
        XCTAssertEqual(record?.preferences["omb-show-threads"], "1")
        try await client.saveSidebarPreferences([SidebarPrefKey.showThreads: "0", SidebarPrefKey.sectionOrder: nil])
        let put = try XCTUnwrap(PrefsStub.requests.last { $0.method == "PUT" })
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(put.body)) as? [String: Any])
        XCTAssertEqual(body["preferences"] as? [String: String], ["omb-skin": "dusk", "omb-show-threads": "0", "sagax.busySend.v1": "steer"])
    }

    /// A save sends only the keys it changed, so a key another device just
    /// saved (a section deleted on the desktop) is never written back.
    func testSavingPatchesOnlyTheChangedKeys() async throws {
        let client = stubClient()
        PrefsStub.requests = []
        PrefsStub.routes["PATCH /api/me/preferences"] = (200, #"{"stored":true,"preferences":{"omb-show-threads":"0"},"updatedAt":3}"#)
        let record = try await client.saveSidebarPreferences([SidebarPrefKey.showThreads: "0", SidebarPrefKey.sectionOrder: nil])
        XCTAssertEqual(record.preferences, ["omb-show-threads": "0"])
        XCTAssertEqual(PrefsStub.requests.map(\.method), ["PATCH"], "no read-modify-write")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(PrefsStub.requests[0].body)) as? [String: Any])
        XCTAssertEqual(body["set"] as? [String: String], ["omb-show-threads": "0"])
        XCTAssertEqual(body["remove"] as? [String], [SidebarPrefKey.sectionOrder])
    }

    func testAnOlderServerWithoutPatchGetsTheRecordPutBack() async throws {
        let client = stubClient()
        PrefsStub.requests = []
        PrefsStub.routes["PATCH /api/me/preferences"] = (405, #"{"error":"GET or PUT"}"#)
        PrefsStub.routes["GET /api/me/preferences"] = (200, #"{"stored":true,"preferences":{"omb-skin":"dusk"},"updatedAt":1}"#)
        PrefsStub.routes["PUT /api/me/preferences"] = (200, #"{"stored":true,"preferences":{},"updatedAt":2}"#)
        try await client.saveSidebarPreferences([SidebarPrefKey.showThreads: "1"])
        XCTAssertEqual(PrefsStub.requests.map(\.method), ["PATCH", "GET", "PUT"])
        let put = try XCTUnwrap(PrefsStub.requests.last?.body)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: put) as? [String: Any])
        XCTAssertEqual(body["preferences"] as? [String: String], ["omb-skin": "dusk", "omb-show-threads": "1"])
    }

    /// The store side of the live sync: the server's record wins, a key it
    /// no longer holds goes back to the default, and only what this phone
    /// changed and has not saved yet keeps its value.
    func testReceivingTheServersRecordWinsExceptForUnsavedKeys() throws {
        var phone = SidebarPrefs()
        phone.setPersonalSections(ok(PersonalSections.empty.creating("Ops").flatMap { $0.creating("Clients") }))
        phone.setCollapsed(["user:Ops"])
        phone.setSectionOrder(["user:Clients", "user:Ops"])
        phone.setTeamBotOrders(["Ops": ["b2", "b1"]])

        // the desktop deleted "Clients", unfolded Ops and saved its own order
        var desktop = SidebarPrefs()
        desktop.setPersonalSections(ok(PersonalSections.empty.creating("Ops")))
        desktop.setSectionOrder(["user:Ops"])
        desktop.setTeamBotOrders(["Ops": ["b1", "b2"]])
        var remote = desktop.values
        remote["omb-skin"] = "dusk" // not a sidebar key: never held here

        let received = phone.receiving(remote, pending: [])
        XCTAssertEqual(received.personalSections?.names, ["Ops"], "the deletion reaches the phone")
        XCTAssertEqual(received.collapsed, [], "a key the server no longer holds is the default again")
        XCTAssertEqual(received.sectionOrder, ["user:Ops"])
        XCTAssertEqual(received.teamBotOrders, ["Ops": ["b1", "b2"]])
        XCTAssertNil(received.values["omb-skin"])

        // a fold made here and not saved yet survives the frame
        let unsaved = phone.receiving(remote, pending: [SidebarPrefKey.collapsedSections])
        XCTAssertEqual(unsaved.collapsed, ["user:Ops"])
        XCTAssertEqual(unsaved.personalSections?.names, ["Ops"])
    }

    func testThePreferencesFrameCarriesTheWholeRecord() throws {
        let json = #"{"kind":"preferences","seq":9,"audience":"pr_1","preferences":{"sagax.sidebarSections.v1":"{\"sections\":[]}","omb-skin":"dusk"},"updatedAt":12}"#
        let frame = try JSONDecoder().decode(Frame.self, from: Data(json.utf8))
        guard case let .preferences(record) = frame else { return XCTFail("\(frame)") }
        XCTAssertTrue(record.stored)
        XCTAssertEqual(record.updatedAt, 12)
        XCTAssertEqual(record.preferences["omb-skin"], "dusk")
        XCTAssertEqual(SidebarPrefs(values: record.preferences).personalSections, .empty)
        let broken = try JSONDecoder().decode(Frame.self, from: Data(#"{"kind":"preferences","preferences":7}"#.utf8))
        guard case .unknown = broken else { return XCTFail("\(broken)") }
    }

    func testServerSectionRoutes() async throws {
        let client = stubClient()
        PrefsStub.routes["PATCH /api/sidebar-sections"] = (200, #"{"sections":["Ops QC"]}"#)
        PrefsStub.routes["PUT /api/sidebar-sections"] = (200, #"{"sections":["Ops"],"bots":[]}"#)
        PrefsStub.routes["DELETE /api/sidebar-sections"] = (200, #"{"sections":[]}"#)
        try await client.renameSidebarSection("Ops & Co", to: "Ops QC")
        try await client.setSidebarSectionBots("Ops", add: ["b1"], remove: ["b2"])
        try await client.deleteSidebarSection("Ops")
        XCTAssertEqual(PrefsStub.requests.map(\.method), ["PATCH", "PUT", "DELETE"])
        XCTAssertEqual(PrefsStub.requests[0].query, "section=Ops%20%26%20Co")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(PrefsStub.requests[1].body)) as? [String: [String]])
        XCTAssertEqual(body, ["addBotIds": ["b1"], "removeBotIds": ["b2"]])
    }

    func testSectionManagementIsAServerAdminsOnly() {
        XCTAssertTrue(SurfaceGate(scope: .serverAdmin).allows(.sectionManagement))
        XCTAssertFalse(SurfaceGate(scope: .serverClient, organization: true).allows(.sectionManagement))
        XCTAssertFalse(SurfaceGate(scope: .sidecar).allows(.sectionManagement))
    }

    /// The iPad sidebar's section drag (DD1): before or after the target,
    /// as `placeSection` in Sidebar.tsx.
    func testPlacesADraggedSectionBeforeOrAfterItsTarget() {
        let ids = ["builtin:general", "section:A", "section:B", "section:C"]
        XCTAssertEqual(SidebarSectionID.place(ids, "section:C", at: "section:A", after: false),
                       ["builtin:general", "section:C", "section:A", "section:B"])
        XCTAssertEqual(SidebarSectionID.place(ids, "section:A", at: "section:C", after: true),
                       ["builtin:general", "section:B", "section:C", "section:A"])
        XCTAssertEqual(SidebarSectionID.place(ids, "section:A", at: "section:B", after: false), ids)
        XCTAssertEqual(SidebarSectionID.place(ids, "section:A", at: "section:A", after: true), ids)
        XCTAssertEqual(SidebarSectionID.place(ids, "section:Z", at: "section:A", after: true), ids)
    }
}
