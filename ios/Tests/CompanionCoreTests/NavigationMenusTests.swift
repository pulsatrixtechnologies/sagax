// The home's menus, places and Settings list in the desktop's order, per
// pairing (NavigationMenus.swift).
import Foundation
import XCTest
@testable import CompanionCore

final class NavigationMenusTests: XCTestCase {
    private let sidecar = SurfaceGate(scope: .sidecar)
    private let client = SurfaceGate(scope: .serverClient)
    private let member = SurfaceGate(scope: .serverClient, organization: true)
    private let admin = SurfaceGate(scope: .serverAdmin)

    private func bot(_ id: String, owner: String? = nil, primary: Bool = false, pinned: Bool = false, hidden: Bool = false) throws -> Bot {
        var json: [String: Any] = [
            "id": id, "threadId": "t-\(id)", "name": id.capitalized, "title": "", "description": "", "notifications": true,
            "color": "green", "unread": false, "modelSelection": ["instanceId": "claude", "model": "m"], "createdAt": 1,
            "chiefOfStaff": primary, "hidden": hidden, "pinned": pinned,
        ]
        if let owner { json["ownerUserId"] = owner }
        return try JSONDecoder().decode(Bot.self, from: JSONSerialization.data(withJSONObject: json))
    }

    private func room(_ id: String, dm: Bool = false, peopleDm: Bool = false, pinned: Bool = false) throws -> Room {
        var json: [String: Any] = [
            "id": id, "threadId": "t-\(id)", "name": id.capitalized, "memberIds": ["a"],
            "defaultResponder": ["kind": "auto"], "bulletin": "", "unread": false, "createdAt": 1, "pinned": pinned,
        ]
        if dm { json["dm"] = true }
        if peopleDm { json["peopleDm"] = true }
        return try JSONDecoder().decode(Room.self, from: JSONSerialization.data(withJSONObject: json))
    }

    private func context(_ gate: SurfaceGate, threads: Bool = true, move: Bool = true, viewer: String? = "local-owner", active: Int = 3) -> BotMenuContext {
        BotMenuContext(gate: gate, showThreads: threads, canMoveToSection: move, viewerId: viewer, activeBotCount: active)
    }

    // MARK: Bot row

    func testAnAdminSeesTheDesktopBotMenuInOrder() throws {
        let plan = NavigationMenus.bot(try bot("ara"), context(admin))
        XCTAssertEqual(plan.groups, [
            [.pin, .moveTo, .markUnread],
            [.rename, .copyConversationId],
            [.hide, .archive, .delete],
            [.makePrimary],
        ])
        XCTAssertNil(plan.archiveBlock)
        XCTAssertFalse(plan.items.contains(.unpin))
    }

    func testABotRowNeverOffersNewThreadOrNewFolderAndAPinnedBotOffersUnpin() throws {
        // #182: they live in the thread list, threads on or off
        for threads in [true, false] {
            let plan = NavigationMenus.bot(try bot("ara", pinned: true), context(admin, threads: threads))
            XCTAssertEqual(plan.items.first, .unpin)
            XCTAssertFalse(plan.items.contains(.newThread))
            XCTAssertFalse(plan.items.contains(.newFolder))
        }
    }

    func testTheSidecarHasNoArchiveAndAClientSessionNoFolderDeleteOrRename() throws {
        let sidecarPlan = NavigationMenus.bot(try bot("ara"), context(sidecar))
        XCTAssertEqual(sidecarPlan.items, [.pin, .moveTo, .markUnread, .rename, .copyConversationId, .hide, .delete, .makePrimary])

        let clientPlan = NavigationMenus.bot(try bot("ara", owner: "pr_other"), context(client, move: false, viewer: "pr_me"))
        XCTAssertEqual(clientPlan.items, [.pin, .markUnread, .copyConversationId, .hide])
    }

    func testAnOrganizationMemberRenamesOnlyTheirOwnBot() throws {
        let mine = NavigationMenus.bot(try bot("mine", owner: "pr_me"), context(member, viewer: "pr_me"))
        XCTAssertTrue(mine.items.contains(.rename))
        let theirs = NavigationMenus.bot(try bot("theirs", owner: "pr_other"), context(member, viewer: "pr_me"))
        XCTAssertFalse(theirs.items.contains(.rename))
        XCTAssertFalse(theirs.items.contains(.makePrimary))
    }

    func testThePrimaryBotCanBePinnedAndCannotBeArchived() throws {
        let plan = NavigationMenus.bot(try bot("star", primary: true), context(admin))
        XCTAssertEqual(plan.items.first, .pin)
        XCTAssertEqual(plan.groups.last, [.replacePrimary])
        XCTAssertEqual(plan.archiveBlock, .primary)
        XCTAssertFalse(plan.enables(.archive))
        XCTAssertTrue(plan.enables(.delete))

        let pinned = NavigationMenus.bot(try bot("star", primary: true, pinned: true), context(admin))
        XCTAssertEqual(pinned.items.first, .unpin)

        let last = NavigationMenus.bot(try bot("only"), context(admin, active: 1))
        XCTAssertEqual(last.archiveBlock, .lastActive)
    }

    func testTheSidecarBotMenuStillOffersPin() throws {
        let plan = NavigationMenus.bot(try bot("ara"), context(sidecar))
        XCTAssertEqual(plan.items.first, .pin)
        let primary = NavigationMenus.bot(try bot("star", primary: true), context(sidecar))
        XCTAssertEqual(primary.items.first, .pin)
    }

    func testAnUnknownViewerKeepsThePrimaryEntriesOut() throws {
        let plan = NavigationMenus.bot(try bot("ara"), context(admin, viewer: nil))
        XCTAssertFalse(plan.items.contains(.makePrimary))
        XCTAssertFalse(plan.items.contains(.replacePrimary))
    }

    // MARK: Room row

    private func roomContext(_ gate: SurfaceGate, room: Room, owner: Bool = true, personal: Bool = false, peer: Bool = false) -> RoomMenuContext {
        let viewer = RoomViewer(principalId: owner ? nil : "pr_x", role: owner ? "owner" : "member")
        let access = RoomInfoAccess(room: room, gate: gate, viewer: viewer, bots: [])
        return RoomMenuContext(gate: gate, access: access, personalSections: personal, knowsPeer: peer, groupPinsSupported: true)
    }

    func testAnAdminSeesTheDesktopRoomMenuThenThePinBeforeDelete() throws {
        let group = try room("ops")
        XCTAssertEqual(NavigationMenus.room(group, roomContext(admin, room: group)), [
            [.rename, .moveTo, .copyConversationId, .hide],
            [.pin],
            [.delete],
        ])
    }

    func testTheSidecarRoomMenuHasNoOwnerEntriesAndNoPin() throws {
        let group = try room("ops", pinned: true)
        XCTAssertEqual(NavigationMenus.room(group, roomContext(sidecar, room: group)), [[.copyConversationId, .hide]])
    }

    func testAPeopleConversationOpensTheProfileFirst() throws {
        let dm = try room("dm", peopleDm: true)
        let groups = NavigationMenus.room(dm, roomContext(member, room: dm, personal: true, peer: true))
        XCTAssertEqual(groups.first?.first, .viewProfile)
        // #219: a conversation with a person closes, it is never hidden
        XCTAssertTrue(groups.flatMap { $0 }.contains(.close))
        XCTAssertFalse(groups.flatMap { $0 }.contains(.hide))
        XCTAssertFalse(groups.flatMap { $0 }.contains(.rename))
        XCTAssertFalse(groups.flatMap { $0 }.contains(.moveTo))
    }

    // MARK: Section header

    func testThePersonsOwnSectionFollowsOrgSectionMenu() {
        let named = SectionMenuContext(gate: member, personalSections: true, name: "Ops", canMoveUp: true, canMoveDown: false, anyExpanded: true)
        XCTAssertEqual(NavigationMenus.section(named, canCreateBotHere: true), [[.newSection, .rename, .moveUp, .collapseAll, .delete]])
        let general = SectionMenuContext(gate: member, personalSections: true, name: nil, canMoveUp: false, canMoveDown: false, anyExpanded: false)
        XCTAssertEqual(NavigationMenus.section(general, canCreateBotHere: true), [[.newSection, .expandAll]])
    }

    func testAServerTeamListsTheTeamMenuForAnAdminOnly() {
        let adminTeam = SectionMenuContext(gate: admin, personalSections: false, name: "Ops", canMoveUp: false, canMoveDown: true, anyExpanded: true)
        XCTAssertEqual(NavigationMenus.section(adminTeam, canCreateBotHere: true), [
            [.addBots, .renameTeam, .deleteTeam],
            [.moveDown, .collapseAll, .newBotHere],
        ])
        let clientTeam = SectionMenuContext(gate: client, personalSections: false, name: "Ops", canMoveUp: true, canMoveDown: false, anyExpanded: false)
        XCTAssertEqual(NavigationMenus.section(clientTeam, canCreateBotHere: true), [[.moveUp, .expandAll]])
    }

    // MARK: Account, New, places

    func testTheAccountMenu() {
        XCTAssertEqual(NavigationMenus.account(gate: admin, hasArchivedBots: true, achievementsReady: true, connected: true),
                       [[.archivedBots], [.settings, .teamMap, .automations, .achievements], [.releaseNotes, .about, .help]])
        XCTAssertEqual(NavigationMenus.account(gate: admin, hasArchivedBots: false, achievementsReady: false, connected: true),
                       [[.settings, .teamMap, .automations], [.releaseNotes, .about, .help]])
        // offline: Team map and Automations stay out of the popup
        XCTAssertEqual(NavigationMenus.account(gate: admin, hasArchivedBots: false, achievementsReady: false, connected: false),
                       [[.settings], [.releaseNotes, .about, .help]])
        // archived bots are an admin's housekeeping: the remote client hides them
        XCTAssertEqual(NavigationMenus.account(gate: sidecar, hasArchivedBots: true, achievementsReady: true, connected: true),
                       [[.settings, .teamMap, .automations, .achievements], [.releaseNotes, .about, .help]])
    }

    func testNewListsCreateThenBotsThenPeople() throws {
        let bots = [try bot("ara"), try bot("gone", hidden: true), try bot("pip")]
        XCTAssertEqual(NavigationMenus.new(gate: admin, bots: bots, people: ["pr_sam"]),
                       [[.createBot, .createGroup], [.bot("ara"), .bot("pip")]])
        XCTAssertEqual(NavigationMenus.new(gate: member, bots: bots, people: ["pr_sam"]),
                       [[.createBot, .createGroup], [.bot("ara"), .bot("pip")], [.person("pr_sam")]])
        XCTAssertEqual(NavigationMenus.new(gate: admin, bots: [], people: []), [[.createBot, .createGroup]])
    }

    func testPlacesFollowTheExperimentalSwitches() {
        XCTAssertEqual(NavigationMenus.places(gate: admin, connected: true, features: nil), [])
        let on = ServerFeatures(templates: true)
        XCTAssertEqual(NavigationMenus.places(gate: admin, connected: true, features: on), [.templates])
        // the remote client never shows Browse Bots; a member browses the
        // catalogue (CLIENT_ALLOW)
        XCTAssertEqual(NavigationMenus.places(gate: sidecar, connected: true, features: on), [])
        XCTAssertEqual(NavigationMenus.places(gate: client, connected: true, features: on), [.templates])
        XCTAssertEqual(NavigationMenus.places(gate: admin, connected: false, features: on), [])
        XCTAssertEqual(NavigationMenus.accountShortcuts(gate: admin, connected: true), [.teamMap, .automations])
        XCTAssertEqual(NavigationMenus.accountShortcuts(gate: admin, connected: false), [])
    }

    // MARK: Settings

    func testSettingsFollowTheDesktopOrderPerPairing() {
        XCTAssertEqual(NavigationMenus.settings(gate: admin, connected: true, achievementsAvailable: true),
                       [.general, .appearance, .notifications, .experimental, .plugins, .pairDevices, .computer, .usage])
        XCTAssertEqual(NavigationMenus.settings(gate: member, connected: true, achievementsAvailable: true),
                       [.general, .organization, .appearance, .notifications, .plugins, .pairDevices, .computer, .usage])
        XCTAssertTrue(NavigationMenus.showsPrivacy(gate: member, connected: true), "Privacy is a card of Notifications")
        XCTAssertFalse(NavigationMenus.showsPrivacy(gate: admin, connected: true))
        XCTAssertEqual(NavigationMenus.settings(gate: SurfaceGate(scope: .sidecar, sidecarRoutes: []), connected: true, achievementsAvailable: true),
                       [.general, .appearance, .notifications, .plugins, .pairDevices, .computer, .usage])
        XCTAssertEqual(NavigationMenus.settings(gate: .unpaired, connected: false, achievementsAvailable: false),
                       [.general, .appearance, .notifications, .pairDevices])
    }

    func testTheNewGates() {
        XCTAssertTrue(sidecar.allows(.renameBot))
        XCTAssertFalse(client.allows(.renameBot))
        XCTAssertTrue(member.allows(.renameBot))
        XCTAssertTrue(admin.allows(.archiveBot))
        XCTAssertFalse(sidecar.allows(.archiveBot))
        XCTAssertFalse(member.allows(.experimentalSettings))
        XCTAssertTrue(admin.allows(.experimentalSettings))
    }

    // MARK: Requests

    func testArchiveAndTheRoomFolderSendTheDesktopBodies() throws {
        let api = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t")
        let archive = try api.patchBotRequest(botId: "ara", patch: BotPatch(hidden: true))
        XCTAssertEqual(archive.httpMethod, "PATCH")
        XCTAssertEqual(try JSONSerialization.jsonObject(with: archive.httpBody ?? Data()) as? [String: Bool], ["hidden": true])

        let clear = try api.setRoomFolderRequest(groupId: "g1", cwd: "  ")
        XCTAssertEqual(String(data: clear.httpBody ?? Data(), encoding: .utf8), #"{"cwd":null}"#)
        let set = try api.setRoomFolderRequest(groupId: "g1", cwd: "/work/ops")
        XCTAssertEqual(try JSONSerialization.jsonObject(with: set.httpBody ?? Data()) as? [String: String], ["cwd": "/work/ops"])
        XCTAssertTrue(set.url?.path.hasSuffix("/api/groups/g1") == true)
    }
}
