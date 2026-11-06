// WP15: the Team map (src/lib/team-map.ts, src/lib/team-canvas.ts) and the
// people of an organization server (room-authors.ts, people-dm.ts,
// person-panel.ts, ComposeToPicker composePeople), one rule per test.
import Foundation
import XCTest
@testable import CompanionCore

private final class PeopleRequestStub: URLProtocol {
    static var responseBody = Data("{}".utf8)
    static var captured: URLRequest?
    static var capturedBody: Data?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.captured = request
        if let body = request.httpBody {
            Self.capturedBody = body
        } else if let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 1_024)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
            stream.close()
            Self.capturedBody = data
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.responseBody)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class TeamMapPeopleTests: XCTestCase {
    private func bot(
        _ id: String, section: String? = nil, chief: Bool = false, hidden: Bool = false,
        busy: Bool = false, activity: String? = nil, owner: String? = nil
    ) throws -> Bot {
        var json: [String: Any] = [
            "id": id, "threadId": "t-\(id)", "name": id.capitalized, "title": "", "description": "", "notifications": true,
            "color": "green", "unread": false, "modelSelection": ["instanceId": "claude", "model": "m"], "createdAt": 1,
            "chiefOfStaff": chief, "hidden": hidden, "busy": busy,
        ]
        if let section { json["section"] = section }
        if let activity { json["activity"] = activity }
        if let owner { json["ownerUserId"] = owner }
        return try JSONDecoder().decode(Bot.self, from: JSONSerialization.data(withJSONObject: json))
    }

    private func room(_ id: String, humans: [String]? = nil, peopleDm: Bool? = nil, dm: Bool? = nil, section: String? = nil, name: String = "Room") -> Room {
        var room = Room(
            id: id, threadId: "t-\(id)", name: name, memberIds: [], defaultResponder: GroupResponder(kind: "mentions"),
            bulletin: "", unread: false, createdAt: 1
        )
        room.humanIds = humans
        room.peopleDm = peopleDm
        room.dm = dm
        room.section = section
        return room
    }

    private func message(role: String, sender: [String: Any]? = nil, from: String? = nil, at: Double = 1_000) throws -> Message {
        var json: [String: Any] = ["id": UUID().uuidString, "role": role, "kind": "text", "text": "hi", "at": at]
        if let sender { json["sender"] = sender }
        if let from { json["from"] = ["botId": from, "name": from, "color": "green"] }
        return try JSONDecoder().decode(Message.self, from: JSONSerialization.data(withJSONObject: json))
    }

    private var directory: OrgDirectory {
        OrgDirectory(people: [
            OrgDirectoryPerson(principalId: "pr_me", name: "Alex Martin", login: "alex.martin", email: "alex@x.test", role: "admin"),
            OrgDirectoryPerson(principalId: "pr_sam", name: "Sam Rivera", login: "sam.rivera", email: "sam@x.test", role: "member",
                               manageUrl: "https://console.test/people/sam", teams: [.init(id: "t2", manager: false), .init(id: "t1", manager: true)]),
            OrgDirectoryPerson(principalId: "pr_off", name: "Casey", login: "casey", disabled: true),
            OrgDirectoryPerson(principalId: "pr_svc", name: "Robot", login: "robot", service: true),
        ], teams: [OrgDirectoryTeam(id: "t1", name: "Service Desk"), OrgDirectoryTeam(id: "t2", name: "Projects")])
    }

    // MARK: Team map

    func testTeamsFollowTheBotsThenTheServerOrderWithGeneralFirst() throws {
        var state = CompanionState()
        state.bots = [
            try bot("ara", section: "Ops"), try bot("ben"), try bot("cy", section: "Dev", chief: true),
            try bot("dee", section: "Dev"), try bot("gone", section: "Ops", hidden: true),
        ]
        state.sectionOrder = ["Dev", "Ops", "Empty"]
        state.rooms = [room("r1", section: "Lab")]
        let sections = TeamMap.pageSections(state: state)
        XCTAssertEqual(sections.map(\.key), ["", "Dev", "Ops", "Empty", "Lab"])
        XCTAssertEqual(sections[0].name, "Unassigned")
        XCTAssertEqual(sections[1].chiefs.map(\.id), ["cy"])
        XCTAssertEqual(sections[1].members.map(\.id), ["dee"])
        XCTAssertEqual(sections[2].members.map(\.id), ["ara"], "a hidden bot is not on the map")
        XCTAssertEqual(sections[3].count, 0)
    }

    func testEdgesKeepOnePerPairRunningFirst() throws {
        let bots = [try bot("a"), try bot("b"), try bot("c"), try bot("h", hidden: true)]
        let snapshot = try JSONDecoder().decode(TeamMapSnapshot.self, from: Data("""
        {"collaborations":[{"groupId":"g1","botIds":["a","b"],"lastAt":5},{"groupId":"g2","botIds":["b","c"],"lastAt":9},
          {"groupId":"g3","botIds":["a","h"],"lastAt":10}],
         "queued":[{"sourceBotId":"c","targetBotId":"a","reason":"review"}],
         "running":[{"sourceBotId":"b","targetBotId":"a","threadId":"t","groupId":"g9"}]}
        """.utf8))
        let edges = TeamMap.edges(bots: bots, snapshot: snapshot)
        XCTAssertEqual(edges.map(\.state), [.running, .queued, .connected])
        XCTAssertEqual(edges[0].sourceBotId, "b")
        XCTAssertEqual(edges[0].groupId, "g9")
        XCTAssertEqual(edges[1].reason, "review")
        XCTAssertEqual(edges[2].groupId, "g2")
    }

    func testStatusLabels() throws {
        XCTAssertEqual(TeamMap.status(try bot("a", activity: "waiting-on-you")).label, "Waiting for you")
        XCTAssertEqual(TeamMap.status(try bot("a", activity: "no-signal")).tone, .danger)
        XCTAssertEqual(TeamMap.status(try bot("a", busy: true)).label, "Working")
        XCTAssertEqual(TeamMap.status(try bot("a")).tone, .idle)
    }

    func testArrangingStaysInTheLaneAndKeepsTheOtherLane() throws {
        let chief = try bot("boss", section: "Dev", chief: true)
        let a = try bot("a", section: "Dev"), b = try bot("b", section: "Dev"), c = try bot("c", section: "Dev")
        let sections = TeamMap.sections(bots: [chief, a, b, c])
        XCTAssertEqual(TeamMap.arrange(c, by: -1, in: sections, orders: [:]), ["a", "c", "b", "boss"])
        XCTAssertNil(TeamMap.arrange(a, by: -1, in: sections, orders: [:]), "already first")
        XCTAssertNil(TeamMap.arrange(chief, by: 1, in: sections, orders: [:]), "alone in its lane")
        let saved = ["Dev": ["c", "a", "b"]]
        XCTAssertEqual(TeamMap.ordered(sections[0].members, order: saved["Dev"]!).map(\.id), ["c", "a", "b"])
        XCTAssertEqual(TeamMap.arrange(a, by: 1, in: sections, orders: saved), ["c", "b", "a", "boss"])
    }

    func testOrdersRoundTripAndIgnoreDamage() {
        XCTAssertEqual(TeamMap.parseOrders(#"{"Dev":["a","a","",3,"b"],"x":"nope"}"#), ["Dev": ["a", "b"]])
        XCTAssertEqual(TeamMap.parseOrders("not json"), [:])
        XCTAssertEqual(TeamMap.parseOrders(TeamMap.encodeOrders(["": ["z"], "Dev": ["a"]])), ["": ["z"], "Dev": ["a"]])
        XCTAssertEqual(TeamMap.ordersKey(workspace: "env1"), "omb-team-canvas:env1:bot-order")
    }

    func testTheGateShowsTheMapEverywhereAndTheMoveToAnAdmin() {
        for scope in [PairingScope.sidecar, .serverClient, .serverAdmin] {
            XCTAssertTrue(SurfaceGate(scope: scope).allows(.teamMap))
            XCTAssertEqual(SurfaceGate(scope: scope).allows(.teamMapMove), scope == .serverAdmin)
            XCTAssertFalse(SurfaceGate(scope: scope).allows(.people))
        }
        XCTAssertTrue(SurfaceGate(scope: .serverClient, organization: true).allows(.people))
    }

    // MARK: People

    func testARoomLineReadsAsItsPerson() throws {
        let viewer = RoomViewer(principalId: "pr_me", email: "alex@x.test")
        XCTAssertEqual(RoomAuthor.of(try message(role: "user"), viewer: viewer, directory: directory), .me)
        XCTAssertEqual(RoomAuthor.of(try message(role: "user", sender: ["name": "Alex", "id": "PR_ME"]), viewer: viewer, directory: directory), .me)
        let sam = RoomAuthor.of(try message(role: "user", sender: ["name": "sam@x.test", "id": "pr_sam"]), viewer: viewer, directory: directory)
        XCTAssertEqual(sam, .person(key: "person:pr_sam", name: "Sam Rivera", initials: "SR", personId: "pr_sam"))
        let stranger = RoomAuthor.of(try message(role: "user", sender: ["name": "lee@y.test", "id": "pr_x"]), viewer: viewer, directory: directory)
        XCTAssertEqual(stranger, .person(key: "person:pr_x", name: "lee", initials: "L", personId: nil))
        XCTAssertEqual(RoomAuthor.of(try message(role: "assistant", from: "ara"), viewer: viewer, directory: nil), .bot(id: "ara"))
    }

    func testRunsBreakOnAuthorOrFiveMinutes() {
        let sam = RoomAuthor.person(key: "person:pr_sam", name: "Sam", initials: "S", personId: "pr_sam")
        let now = Date().timeIntervalSince1970 * 1000
        XCTAssertTrue(RoomAuthor.continuesRun(previous: (now, sam), next: (now + 60_000, sam)))
        XCTAssertFalse(RoomAuthor.continuesRun(previous: (now, sam), next: (now + 6 * 60_000, sam)))
        XCTAssertFalse(RoomAuthor.continuesRun(previous: (now, .me), next: (now + 1, sam)))
        XCTAssertFalse(RoomAuthor.continuesRun(previous: nil, next: (now, sam)))
    }

    func testAPeopleConversationReadsAsTheOtherPerson() {
        let dm = room("d1", humans: ["pr_me", "PR_SAM"], peopleDm: true, name: "Alex Martin, Sam Rivera")
        XCTAssertEqual(dm.peopleDMPeer(viewerId: "pr_me", directory: directory), PeopleDMPeer(id: "PR_SAM", name: "Sam Rivera", initials: "SR"))
        XCTAssertEqual(dm.peopleDMPeer(viewerId: "pr_me", directory: nil)?.name, "Alex Martin, Sam Rivera")
        XCTAssertNil(room("r", humans: ["pr_me", "pr_sam"]).peopleDMPeer(viewerId: "pr_me", directory: directory))
    }

    func testComposeOffersActivePeopleButNeverOneselfOrAServiceAccount() {
        XCTAssertEqual(directory.messageable(viewer: "PR_ME").map(\.principalId), ["pr_sam"])
        XCTAssertEqual(directory.messageable(viewer: "pr_me", query: "rivera").map(\.principalId), ["pr_sam"])
        XCTAssertEqual(directory.messageable(viewer: "pr_me", query: "nobody"), [])
    }

    func testThePersonSheetShowsTheDirectoryAndWhatIsShared() throws {
        var state = CompanionState()
        state.rooms = [
            room("dm", humans: ["pr_me", "pr_sam"], peopleDm: true), room("team", humans: ["pr_me", "pr_sam"]),
            room("other", humans: ["pr_me"]), room("bots", humans: ["pr_sam"], dm: true),
        ]
        state.bots = [try bot("hers", owner: "PR_SAM"), try bot("mine", owner: "pr_me"), try bot("gone", hidden: true, owner: "pr_sam")]
        let sheet = PersonSheetModel(personId: "pr_sam", directory: directory, state: state, viewerId: "pr_me", viewerIsAdmin: true)
        XCTAssertEqual(sheet.name, "Sam Rivera")
        XCTAssertEqual(sheet.teams.map(\.name), ["Projects", "Service Desk"])
        XCTAssertEqual(sheet.teams.map(\.manager), [false, true])
        XCTAssertEqual(sheet.sharedRooms.map(\.id), ["team"])
        XCTAssertEqual(sheet.sharedBots.map(\.id), ["hers"])
        XCTAssertEqual(sheet.directRoom?.id, "dm")
        XCTAssertTrue(sheet.canMessage)
        XCTAssertTrue(sheet.hasInCommon)
        // #2117: no Manage in Perspicax / console link on the person panel.
        XCTAssertFalse(PersonSheetModel(personId: "pr_off", directory: directory, state: state, viewerId: "pr_me", viewerIsAdmin: false).canMessage)
        XCTAssertFalse(PersonSheetModel(personId: "pr_me", directory: directory, state: state, viewerId: "pr_me", viewerIsAdmin: false).canMessage)
        let unknown = PersonSheetModel(personId: "pr_x", directory: directory, state: state, viewerId: "pr_me", viewerIsAdmin: true)
        XCTAssertNil(unknown.person)
        XCTAssertEqual(unknown.name, "pr_x")
        XCTAssertFalse(unknown.canMessage)
    }

    func testThePersonSheetHidesInCommonWhenThereIsNothingToShare() throws {
        var state = CompanionState()
        state.rooms = [room("dm", humans: ["pr_me", "pr_sam"], peopleDm: true)]
        state.bots = [try bot("mine", owner: "pr_me")]
        let sheet = PersonSheetModel(personId: "pr_sam", directory: directory, state: state, viewerId: "pr_me")
        XCTAssertTrue(sheet.sharedRooms.isEmpty)
        XCTAssertTrue(sheet.sharedBots.isEmpty)
        XCTAssertFalse(sheet.hasInCommon)
    }

    func testThePersonSheetOffersNoMessageInsideTheirConversation() {
        var state = CompanionState()
        state.rooms = [room("dm", humans: ["pr_me", "pr_sam"], peopleDm: true), room("team", humans: ["pr_me", "pr_sam"])]
        func sheet(from roomId: String?) -> PersonSheetModel {
            PersonSheetModel(personId: "pr_sam", directory: directory, state: state, viewerId: "pr_me", viewerIsAdmin: false, openedFromRoomId: roomId)
        }
        XCTAssertFalse(sheet(from: "dm").canMessage)
        XCTAssertTrue(sheet(from: "team").canMessage)
        XCTAssertTrue(sheet(from: nil).canMessage)
    }

    func testTheDirectoryDecodesTeamsAndTheNewFields() throws {
        let decoded = try JSONDecoder().decode(OrgDirectory.self, from: Data("""
        {"people":[{"principalId":"p1","name":"A","login":"a","role":"admin","disabled":false,"service":true,
          "avatarUrl":"/api/people/p1/avatar","manageUrl":"https://c/p1","teams":[{"id":"t","manager":true},{"bad":1}]}],
         "teams":[{"id":"t","name":"Team","managers":[],"members":[]}]}
        """.utf8))
        XCTAssertEqual(decoded.people.first?.role, "admin")
        XCTAssertEqual(decoded.people.first?.service, true)
        XCTAssertEqual(decoded.people.first?.teams, [.init(id: "t", manager: true)])
        XCTAssertEqual(decoded.teams, [OrgDirectoryTeam(id: "t", name: "Team", members: [], managers: [])])
    }

    // MARK: Requests

    func testRequestsAreTheDesktopsOwn() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [PeopleRequestStub.self]
        let client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t",
                                     session: URLSession(configuration: config))
        PeopleRequestStub.responseBody = Data(#"{"collaborations":[],"queued":[],"running":[]}"#.utf8)
        _ = try await client.teamMap()
        XCTAssertEqual(PeopleRequestStub.captured?.httpMethod, "GET")
        XCTAssertEqual(PeopleRequestStub.captured?.url?.path, "/api/team-map")

        PeopleRequestStub.responseBody = Data("""
        {"group":{"id":"g","threadId":"gt","name":"A, B","memberIds":[],"defaultResponder":{"kind":"mentions"},"bulletin":"",
          "unread":false,"createdAt":1,"peopleDm":true,"humanIds":["pr_me","pr_sam"]},"created":true}
        """.utf8)
        let created = try await client.openPeopleDM(principalId: "pr_sam")
        XCTAssertEqual(created.peopleDm, true)
        XCTAssertEqual(PeopleRequestStub.captured?.httpMethod, "POST")
        XCTAssertEqual(PeopleRequestStub.captured?.url?.path, "/api/people-dms")
        let body = try JSONSerialization.jsonObject(with: XCTUnwrap(PeopleRequestStub.capturedBody)) as? [String: String]
        XCTAssertEqual(body, ["principalId": "pr_sam"])
    }
}
