// Rooms (WP11): the desktop group panel's rules (src/lib/group-owner.ts,
// ChannelMembers channelRosterActions, DefaultResponderSelect,
// room-members.ts, GroupPeoplePicker, the memory gauge) and the requests the
// store sends for them, one test each.
import Foundation
import XCTest
@testable import CompanionCore

private final class RoomRequestStub: URLProtocol {
    static var responseBody = Data("{}".utf8)
    static var statusCode = 200
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
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.statusCode, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.responseBody)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class RoomInfoTests: XCTestCase {
    private var client: CompanionClient!

    override func setUp() {
        super.setUp()
        RoomRequestStub.captured = nil
        RoomRequestStub.capturedBody = nil
        RoomRequestStub.statusCode = 200
        RoomRequestStub.responseBody = Data("{}".utf8)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RoomRequestStub.self]
        client = CompanionClient(
            connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810),
            token: "t", session: URLSession(configuration: config)
        )
    }

    private func room(
        ownerId: String? = nil, humanIds: [String]? = nil, memberIds: [String] = ["a", "b"],
        responder: GroupResponder = GroupResponder(kind: "member", botId: "a"), dm: Bool? = nil, peopleDm: Bool? = nil
    ) -> Room {
        var room = Room(
            id: "g-1", threadId: "g-t", name: "Team", memberIds: memberIds,
            defaultResponder: responder, bulletin: "Ship it", unread: false, createdAt: 1
        )
        room.ownerId = ownerId
        room.humanIds = humanIds
        room.dm = dm
        room.peopleDm = peopleDm
        return room
    }

    private func bot(_ id: String, owner: String? = nil) -> Bot {
        var bot = Bot(id: id, threadId: "t-\(id)", name: id.uppercased(), title: "", description: "",
                      notifications: true, color: "green", unread: false,
                      modelSelection: ModelSelection(instanceId: "engine", model: "default"), createdAt: 1)
        bot.ownerUserId = owner
        return bot
    }

    private func body() throws -> [String: Any] {
        let data = try XCTUnwrap(RoomRequestStub.capturedBody)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    // MARK: Ownership (group-owner.ts)

    func testSoloServerOwnsEveryRoomAndOrganizationFollowsTheOwner() {
        let me = RoomViewer(principalId: "P-Me", email: "Me@Example.test", role: "member")
        XCTAssertTrue(RoomOwnership.owns(room(), viewer: me, organization: false))
        // organization: nobody owns it, its admins do
        XCTAssertFalse(RoomOwnership.owns(room(), viewer: me, organization: true))
        XCTAssertTrue(RoomOwnership.owns(room(), viewer: RoomViewer(principalId: "x", role: "admin"), organization: true))
        // by principal or by email, case-insensitive
        XCTAssertTrue(RoomOwnership.owns(room(ownerId: "p-me"), viewer: me, organization: true))
        XCTAssertTrue(RoomOwnership.owns(room(ownerId: " me@example.test "), viewer: me, organization: true))
        XCTAssertFalse(RoomOwnership.owns(room(ownerId: "someone"), viewer: me, organization: true))
        // an admin deletes any organization room, owns none of them
        let admin = RoomViewer(principalId: "adm", role: "admin")
        XCTAssertFalse(RoomOwnership.owns(room(ownerId: "someone"), viewer: admin, organization: true))
        XCTAssertTrue(RoomOwnership.mayDelete(room(ownerId: "someone"), viewer: admin, organization: true))
        XCTAssertFalse(RoomOwnership.mayDelete(room(ownerId: "someone"), viewer: me, organization: true))
        XCTAssertEqual(RoomViewer(account: nil).actorId, "local-owner")
    }

    func testLeaveAndPeopleEditsKeepEveryoneElse() {
        let me = RoomViewer(principalId: "p-me", email: "me@example.test")
        let listed = room(ownerId: "boss", humanIds: ["boss", "ME@example.test", "user:p-other"])
        XCTAssertTrue(RoomOwnership.isListed(listed, viewer: me))
        XCTAssertEqual(RoomOwnership.humanIdsLeaving(listed, viewer: me), ["boss", "user:p-other"])
        XCTAssertEqual(RoomOwnership.humanIdsAdding(" New@Example.test ", to: listed),
                       ["boss", "me@example.test", "user:p-other", "new@example.test"])
        XCTAssertEqual(RoomOwnership.humanIdsAdding("boss", to: listed).count, 3)
        XCTAssertEqual(RoomOwnership.humanIdsRemoving("USER:P-OTHER", from: listed), ["boss", "ME@example.test"])
    }

    func testNextMemberIdsKeepsTheLeadFirst() {
        XCTAssertEqual(RoomOwnership.nextMemberIds(current: ["b", "a"], picked: ["a", "b", "c"], order: ["a", "b", "c"]), ["b", "a", "c"])
        XCTAssertEqual(RoomOwnership.nextMemberIds(current: ["b", "a"], picked: ["a"], order: ["a", "b"]), ["a"])
    }

    // MARK: What the sheet offers

    func testSidecarPairingReadsTheRoomOnly() {
        let access = RoomInfoAccess(room: room(), gate: SurfaceGate(scope: .sidecar), viewer: RoomViewer(), bots: [])
        XCTAssertFalse(access.manages)
        XCTAssertFalse(access.editable)
        XCTAssertFalse(access.readOnlyNote)
        XCTAssertFalse(access.canDelete)
        XCTAssertFalse(access.canLeave)
        XCTAssertTrue(access.removableBotIds.isEmpty)
        XCTAssertTrue(access.memory, "D3: the sidecar serves the room memory")
        XCTAssertFalse(RoomInfoAccess(room: room(), gate: SurfaceGate(scope: .sidecar, sidecarRoutes: []),
                                      viewer: RoomViewer(), bots: []).memory)
    }

    func testServerAdminOwnsASoloRoom() {
        let access = RoomInfoAccess(room: room(), gate: SurfaceGate(scope: .serverAdmin), viewer: RoomViewer(), bots: [])
        XCTAssertTrue(access.editable)
        XCTAssertTrue(access.canDelete)
        XCTAssertTrue(access.canMoveSection)
        XCTAssertTrue(access.canAddHuman)
        XCTAssertFalse(access.canLeave)
        XCTAssertEqual(access.removableBotIds, ["a", "b"])
        // a client session on a solo server: hidden, the server refuses
        let client = RoomInfoAccess(room: room(), gate: SurfaceGate(scope: .serverClient), viewer: RoomViewer(), bots: [])
        XCTAssertFalse(client.manages)
        XCTAssertFalse(client.canDelete)
        // a bot-to-bot room has no panel items
        let dm = RoomInfoAccess(room: room(dm: true), gate: SurfaceGate(scope: .serverAdmin), viewer: RoomViewer(), bots: [])
        XCTAssertFalse(dm.manages)
        XCTAssertFalse(dm.memory)
    }

    func testOrganizationMemberLeavesAndBringsOwnBots() {
        let gate = SurfaceGate(scope: .serverClient, organization: true)
        let me = RoomViewer(principalId: "p-me", role: "member")
        let bots = [bot("a"), bot("b"), bot("mine", owner: "P-ME"), bot("mine2", owner: "p-me")]
        var theirs = room(ownerId: "boss", humanIds: ["boss", "p-me"], memberIds: ["a", "mine"])
        var access = RoomInfoAccess(room: theirs, gate: gate, viewer: me, bots: bots)
        XCTAssertFalse(access.editable)
        XCTAssertTrue(access.readOnlyNote)
        XCTAssertTrue(access.canLeave)
        XCTAssertFalse(access.canDelete)
        XCTAssertFalse(access.canAddHuman)
        XCTAssertFalse(access.canMoveSection, "organization sections are personal (SB2)")
        XCTAssertTrue(access.canAddOwnBot)
        XCTAssertEqual(access.removableBotIds, ["mine"])
        XCTAssertEqual(RoomOwnership.ownBotToAdd(theirs, bots: bots, viewer: me)?.id, "mine2")
        theirs.humanIds = ["boss"]
        access = RoomInfoAccess(room: theirs, gate: gate, viewer: me, bots: bots)
        XCTAssertFalse(access.canLeave)
        // the owner who is a plain member adds people too, as on the desktop
        // (channelRosterActions, #1061): the server limits them to the
        // people the organization directory shows them
        let mine = RoomInfoAccess(room: room(ownerId: "p-me"), gate: gate, viewer: me, bots: bots)
        XCTAssertTrue(mine.editable)
        XCTAssertTrue(mine.canDelete)
        XCTAssertTrue(mine.canAddHuman)
        XCTAssertTrue(mine.canManageRoster)
        let admin = RoomViewer(principalId: "p-me", role: "admin")
        XCTAssertTrue(RoomInfoAccess(room: room(ownerId: "p-me"), gate: gate, viewer: admin, bots: bots).canAddHuman)
        // an unknown role (no organization session yet) adds no one, as the desktop's null role
        let unknown = RoomViewer(principalId: "p-me", role: nil)
        XCTAssertFalse(RoomInfoAccess(room: room(ownerId: "p-me"), gate: gate, viewer: unknown, bots: bots).canAddHuman)
    }

    func testTheOwnerLeavesTooAndTheConfirmationSaysWhatHappens() {
        // #1480: listed in their own name, owner included, organization only
        let gate = SurfaceGate(scope: .serverClient, organization: true)
        let me = RoomViewer(principalId: "p-me", role: "member")
        let mine = room(ownerId: "p-me", humanIds: ["p-me", "p-bob"])
        XCTAssertTrue(RoomInfoAccess(room: mine, gate: gate, viewer: me, bots: []).canLeave)
        XCTAssertEqual(RoomOwnership.leaveOutcome(mine, viewer: me), .owner)
        // the recorded owner who is not in humanIds still leaves when others remain
        XCTAssertTrue(RoomOwnership.mayLeave(room(ownerId: "p-me", humanIds: ["p-bob"]), viewer: me))
        XCTAssertEqual(RoomOwnership.leaveOutcome(room(ownerId: "p-me", humanIds: ["p-me", "team:ops"]), viewer: me), .last)
        // #2119: sole remaining person cannot leave (bots and teams do not count)
        XCTAssertFalse(RoomOwnership.mayLeave(room(ownerId: "p-me", humanIds: ["p-me", "team:ops"]), viewer: me))
        XCTAssertFalse(RoomInfoAccess(room: room(ownerId: "p-me", humanIds: ["p-me"]), gate: gate, viewer: me, bots: []).canLeave)
        XCTAssertEqual(RoomOwnership.leaveOutcome(room(ownerId: "boss", humanIds: ["boss", "p-me"]), viewer: me), .member)
        // a solo server has nobody to hand the group to
        XCTAssertFalse(RoomInfoAccess(room: mine, gate: SurfaceGate(scope: .serverAdmin), viewer: me, bots: []).canLeave)
        // listed through a team only: nothing of their own to leave
        XCTAssertFalse(RoomInfoAccess(room: room(ownerId: "boss", humanIds: ["boss", "team:ops"]), gate: gate, viewer: me, bots: []).canLeave)
    }

    func testRosterOpensOnAPickerAndOffersOnlyWhatTheViewerMayTick() {
        let gate = SurfaceGate(scope: .serverClient, organization: true)
        let me = RoomViewer(principalId: "p-me", role: "member")
        var archived = bot("old", owner: "p-me")
        archived.hidden = true
        let bots = [bot("a"), bot("mine", owner: "p-me"), bot("mine2", owner: "p-me"), archived]
        // someone else's room: only the viewer's own bots, never theirs (#1240)
        let theirs = room(ownerId: "boss", humanIds: ["boss", "p-me"], memberIds: ["a", "mine"])
        XCTAssertEqual(RoomOwnership.rosterBotChoices(theirs, bots: bots, viewer: me, owns: false).map(\.id), ["mine", "mine2"])
        let access = RoomInfoAccess(room: theirs, gate: gate, viewer: me, bots: bots)
        XCTAssertTrue(access.canAddBot)
        XCTAssertTrue(access.canManageRoster, "a member with bots manages their own in the roster (#1260)")
        // the owner picks among every bot; an archived one only while a member
        let mine = room(ownerId: "p-me", memberIds: ["a", "old"])
        XCTAssertEqual(RoomOwnership.rosterBotChoices(mine, bots: bots, viewer: me, owns: true).map(\.id), ["a", "mine", "mine2", "old"])
        // everything already in: no "+ Add", the roster still opens
        let full = room(ownerId: "boss", memberIds: ["a", "mine", "mine2"])
        let fullAccess = RoomInfoAccess(room: full, gate: gate, viewer: me, bots: bots)
        XCTAssertFalse(fullAccess.canAddBot)
        XCTAssertTrue(fullAccess.canManageRoster)
        // no bot of one's own in someone else's room: nothing to manage
        let stranger = RoomViewer(principalId: "p-x", role: "member")
        XCTAssertFalse(RoomInfoAccess(room: theirs, gate: gate, viewer: stranger, bots: bots).canManageRoster)
    }

    func testNextHumanIdsKeepsPlacesAndAppendsAdditions() {
        XCTAssertEqual(RoomOwnership.nextHumanIds(current: ["p-a", "B@x.test"], picked: ["p-a", "b@x.test", "p-c"], added: ["p-c"]), ["p-a", "b@x.test", "p-c"])
        XCTAssertEqual(RoomOwnership.nextHumanIds(current: ["p-a", "p-b"], picked: ["p-b", "p-c"], added: ["P-C", "p-c"]), ["p-b", "p-c"])
    }

    // MARK: Who answers

    func testDefaultResponderFallsBackAndAutoKeepsTheLead() {
        XCTAssertEqual(RoomResponder.choice(room()), .lead(botId: "a"))
        // a lead that left: the first member
        XCTAssertEqual(RoomResponder.effective(room(responder: GroupResponder(kind: "member", botId: "gone"))),
                       GroupResponder(kind: "member", botId: "a"))
        // no members: mentions
        XCTAssertEqual(RoomResponder.effective(room(memberIds: [], responder: GroupResponder(kind: "everyone2"))),
                       GroupResponder(kind: "mentions"))
        // Auto keeps the lead as its fallback
        XCTAssertEqual(RoomResponder.value(for: .auto, in: room(responder: GroupResponder(kind: "member", botId: "b"))),
                       GroupResponder(kind: "auto", fallbackBotId: "b"))
        let auto = room(responder: GroupResponder(kind: "auto", fallbackBotId: "b"))
        XCTAssertEqual(RoomResponder.answeringBotId(auto), "b")
        XCTAssertEqual(RoomResponder.answeringBotId(room(responder: GroupResponder(kind: "auto", fallbackBotId: "gone"))), "a")
        XCTAssertNil(RoomResponder.answeringBotId(room(responder: GroupResponder(kind: "everyone"))))
        XCTAssertEqual(RoomResponder.value(for: .lead(botId: "b"), in: auto), GroupResponder(kind: "member", botId: "b"))
    }

    // MARK: Memory

    func testMemoryCapacityLevelsAndBytes() {
        let ok = MemoryCapacity(lines: 10, bytes: 900, maxLines: 200, maxBytes: 25_000, loadedLines: 10, loadedBytes: 900, truncated: false)
        XCTAssertEqual(ok.level, .ok)
        XCTAssertEqual(MemoryCapacity.formatBytes(900), "900 B")
        XCTAssertEqual(MemoryCapacity.formatBytes(25_000), "24.4 KB")
        XCTAssertEqual(MemoryCapacity.formatBytes(2048), "2 KB")
        var near = ok
        near.lines = 170
        XCTAssertEqual(near.level, .near)
        var over = ok
        over.truncated = true
        over.lines = 230
        over.loadedLines = 200
        XCTAssertEqual(over.level, .over)
        XCTAssertEqual(over.missingLines, 30)
    }

    func testMemoryReadSaveAndConflict() async throws {
        let view = #"{"enabled":true,"canEdit":true,"text":"- fact","hash":"\#(String(repeating: "a", count: 64))","capacity":{"lines":1,"bytes":6,"maxLines":200,"maxBytes":25000,"loadedLines":1,"loadedBytes":6,"truncated":false,"hash":"x"}}"#
        RoomRequestStub.responseBody = Data(view.utf8)
        let read = try await client.groupMemory(groupId: "g-1")
        XCTAssertEqual(RoomRequestStub.captured?.httpMethod, "GET")
        XCTAssertEqual(RoomRequestStub.captured?.url?.path, "/api/groups/g-1/memory")
        XCTAssertEqual(read.text, "- fact")
        XCTAssertTrue(read.canEdit)

        _ = try await client.saveGroupMemory(groupId: "g-1", text: "- two", expectedHash: read.hash)
        XCTAssertEqual(RoomRequestStub.captured?.httpMethod, "PUT")
        XCTAssertEqual(try body() as NSDictionary, ["text": "- two", "expectedHash": read.hash] as NSDictionary)

        _ = try await client.saveGroupMemory(groupId: "g-1", enabled: false)
        XCTAssertEqual(try body() as NSDictionary, ["enabled": false] as NSDictionary)

        RoomRequestStub.statusCode = 409
        RoomRequestStub.responseBody = Data(#"{"error":"changed","code":"conflict"}"#.utf8)
        do {
            _ = try await client.saveGroupMemory(groupId: "g-1", text: "x", expectedHash: read.hash)
            XCTFail("a 409 is a conflict")
        } catch is GroupMemoryConflict {}
    }

    // MARK: Patch, delete, directory

    func testPatchSendsOnlyTheFieldsSet() async throws {
        let roomJSON = #"{"group":{"id":"g-1","threadId":"g-t","name":"Renamed","memberIds":["a"],"defaultResponder":{"kind":"auto","fallbackBotId":"a"},"bulletin":"","unread":false,"createdAt":1}}"#
        RoomRequestStub.responseBody = Data(roomJSON.utf8)
        let updated = try await client.patchRoom(groupId: "g-1", patch: RoomPatch(name: "Renamed"))
        XCTAssertEqual(RoomRequestStub.captured?.httpMethod, "PATCH")
        XCTAssertEqual(RoomRequestStub.captured?.url?.path, "/api/groups/g-1")
        XCTAssertEqual(try body() as NSDictionary, ["name": "Renamed"] as NSDictionary)
        XCTAssertEqual(updated.defaultResponder.fallbackBotId, "a")

        _ = try await client.patchRoom(groupId: "g-1", patch: RoomPatch(defaultResponder: GroupResponder(kind: "auto", fallbackBotId: "a")))
        XCTAssertEqual(try body() as NSDictionary, ["defaultResponder": ["kind": "auto", "fallbackBotId": "a"]] as NSDictionary)

        _ = try await client.patchRoom(groupId: "g-1", patch: RoomPatch(section: "", humanIds: []))
        XCTAssertEqual(try body() as NSDictionary, ["section": "", "humanIds": [String]()] as NSDictionary)

        XCTAssertEqual(RoomPatch.rename("Team", to: "  Team "), nil)
        XCTAssertEqual(RoomPatch.rename("Team", to: "   "), nil)
        XCTAssertEqual(RoomPatch.rename("Team", to: " Crew "), "Crew")
        XCTAssertEqual(RoomPatch.rename("Team", to: String(repeating: "x", count: 120))?.count, 100)
        XCTAssertThrowsError(try client.patchRoomRequest(groupId: "../x", patch: RoomPatch(name: "n")))
    }

    func testDeleteAndDirectory() async throws {
        try await client.deleteRoom(groupId: "g-1")
        XCTAssertEqual(RoomRequestStub.captured?.httpMethod, "DELETE")
        XCTAssertEqual(RoomRequestStub.captured?.url?.path, "/api/groups/g-1")

        RoomRequestStub.responseBody = Data(#"{"people":[{"principalId":"P-1","name":"Zoé","login":"zoe","email":"zoe@x.test"},{"principalId":"p-2","name":"","login":"max","disabled":true},{"principalId":"p-3","login":"sam"},{"bad":1}],"teams":[]}"#.utf8)
        let directory = try await client.orgDirectory()
        XCTAssertEqual(RoomRequestStub.captured?.url?.path, "/api/org/directory")
        XCTAssertEqual(directory.people.map(\.principalId), ["P-1", "p-2", "p-3"])
        XCTAssertEqual(directory.candidates(taken: [], query: "").map(\.principalId), ["P-1", "p-3"])
        XCTAssertEqual(directory.candidates(taken: ["user:p-1"], query: "").map(\.principalId), ["p-3"])
        XCTAssertEqual(directory.candidates(taken: [], query: "ZOE@").map(\.principalId), ["P-1"])
        XCTAssertEqual(directory.label(for: "user:p-1"), "Zoé")
        XCTAssertEqual(directory.label(for: "p-3"), "sam")
        XCTAssertEqual(directory.label(for: "team:t"), "team:t")
    }

    func testSectionsAndJevFlag() throws {
        var state = CompanionState()
        var a = bot("a")
        a.section = "Work"
        var hidden = bot("h")
        hidden.section = "Old"
        hidden.hidden = true
        var r = room()
        r.section = " Ops "
        state.bots = [a, hidden]
        state.rooms = [r]
        XCTAssertEqual(RoomSections.names(state), ["Work", "Ops"])
        XCTAssertNil(RoomSections.valid("  "))
        XCTAssertNil(RoomSections.valid(String(repeating: "x", count: 61)))
        XCTAssertEqual(RoomSections.valid(" New "), "New")

        let on = try JSONDecoder().decode(ConfigStatus.self, from: Data(#"{"decider":{"enabled":true,"jobs":{"roomRouting":true}}}"#.utf8))
        XCTAssertTrue(on.jevRoomRoutingOn)
        let off = try JSONDecoder().decode(ConfigStatus.self, from: Data(#"{"decider":{"enabled":true,"jobs":{"roomRouting":false}}}"#.utf8))
        XCTAssertFalse(off.jevRoomRoutingOn)
        XCTAssertFalse(try JSONDecoder().decode(ConfigStatus.self, from: Data("{}".utf8)).jevRoomRoutingOn)
    }

    func testRoomCallWaitsForSpeechAndEveryVoice() {
        XCTAssertTrue(RoomCallReadiness.ready(speechConfigured: true, memberVoices: ["ara", "helios"]))
        XCTAssertFalse(RoomCallReadiness.ready(speechConfigured: false, memberVoices: ["ara", "helios"]))
        XCTAssertFalse(RoomCallReadiness.ready(speechConfigured: true, memberVoices: ["ara", nil]))
        XCTAssertFalse(RoomCallReadiness.ready(speechConfigured: true, memberVoices: ["ara", ""]))
        XCTAssertFalse(RoomCallReadiness.ready(speechConfigured: true, memberVoices: []))
    }
}
