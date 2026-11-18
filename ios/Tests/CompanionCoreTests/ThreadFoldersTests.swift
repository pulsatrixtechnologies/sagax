// Threads and folders (WP5): the desktop's thread and folder menus, its
// folder order and read helpers, the thread link, and the requests the
// store sends for them (src/state/store.tsx), one test each.
import Foundation
import XCTest
@testable import CompanionCore

private final class ThreadRequestStub: URLProtocol {
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

final class ThreadFoldersTests: XCTestCase {
    private var session: URLSession!
    private var client: CompanionClient!

    private static let botJSON = #"""
    {"id":"bot-1","threadId":"t-1","name":"Ara","title":"","description":"","notifications":true,
    "color":"purple","unread":false,"pinned":false,"modelSelection":{"instanceId":"claude","model":"default"},
    "createdAt":1,"projects":[{"id":"p-1","name":"Work","emoji":"💼"},{"id":"p-2","name":"Home"}],
    "tasks":[{"threadId":"t-1","title":"One","createdAt":1,"projectId":"p-1"},
             {"threadId":"t-2","title":"Two","createdAt":2,"projectId":"p-1","unread":true},
             {"threadId":"t-3","title":"Three","createdAt":3}]}
    """#

    override func setUp() {
        super.setUp()
        ThreadRequestStub.captured = nil
        ThreadRequestStub.capturedBody = nil
        ThreadRequestStub.statusCode = 200
        ThreadRequestStub.responseBody = Data("{}".utf8)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ThreadRequestStub.self]
        session = URLSession(configuration: configuration)
        client = CompanionClient(
            connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810),
            token: "paired-token", session: session
        )
    }

    override func tearDown() {
        session.invalidateAndCancel()
        super.tearDown()
    }

    private func bot() throws -> Bot {
        try JSONDecoder().decode(Bot.self, from: Data(Self.botJSON.utf8))
    }

    private func body(_ request: URLRequest) throws -> [String: Any] {
        let data = try XCTUnwrap(request.httpBody)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    // MARK: Link

    func testThreadLinkMatchesTheDesktopsThreadRefUrl() {
        XCTAssertEqual(ThreadLink.url(ownerId: "bot-1", threadId: "t_9"), "sagax://thread/t_9?bot=bot-1")
        // encodeURIComponent keeps !~*'() and escapes the rest
        XCTAssertEqual(ThreadLink.url(ownerId: "a b", threadId: "x/y?z"), "sagax://thread/x%2Fy%3Fz?bot=a%20b")
        XCTAssertEqual(ThreadLink.encodeURIComponent("it's(ok)!~*"), "it's(ok)!~*")
    }

    func testBotLinkMatchesTheDesktopsBotRefUrl() {
        XCTAssertEqual(ThreadLink.botUrl(botId: "bot-1"), "sagax://bot/bot-1")
        XCTAssertEqual(ThreadLink.botUrl(botId: "a b/c"), "sagax://bot/a%20b%2Fc")
    }

    // MARK: Order

    func testMoveFolderStepsThroughTheSavedOrder() {
        let ids = ["a", "b", "c"]
        XCTAssertEqual(FolderOrder.move(ids, id: "b", direction: -1), ["b", "a", "c"])
        XCTAssertEqual(FolderOrder.move(ids, id: "b", direction: 1), ["a", "c", "b"])
        XCTAssertEqual(FolderOrder.move(ids, id: "a", direction: -1), ids)
        XCTAssertEqual(FolderOrder.move(ids, id: "c", direction: 1), ids)
        XCTAssertEqual(FolderOrder.move(ids, id: "zz", direction: 1), ids)
    }

    func testPlaceFolderBeforeOrAfter() {
        let ids = ["a", "b", "c", "d"]
        XCTAssertEqual(FolderOrder.place(ids, moving: "d", to: "a", .before), ["d", "a", "b", "c"])
        XCTAssertEqual(FolderOrder.place(ids, moving: "a", to: "c", .after), ["b", "c", "a", "d"])
        XCTAssertEqual(FolderOrder.place(ids, moving: "a", to: "a", .after), ids)
    }

    func testOnMoveOffsetsMatchSwiftUI() {
        let ids = ["a", "b", "c", "d"]
        // drag "a" below "c": SwiftUI reports destination 3
        XCTAssertEqual(FolderOrder.move(ids, fromOffsets: IndexSet(integer: 0), toOffset: 3), ["b", "c", "a", "d"])
        // drag "d" to the top
        XCTAssertEqual(FolderOrder.move(ids, fromOffsets: IndexSet(integer: 3), toOffset: 0), ["d", "a", "b", "c"])
        XCTAssertEqual(FolderOrder.move(ids, fromOffsets: IndexSet(integer: 1), toOffset: 4), ["a", "c", "d", "b"])
    }

    // MARK: Fields

    func testFolderNameIsTrimmedAndBounded() {
        XCTAssertEqual(FolderFields.name("  Work  "), "Work")
        XCTAssertNil(FolderFields.name("   "))
        XCTAssertNil(FolderFields.name(String(repeating: "x", count: 81)))
        XCTAssertEqual(FolderFields.name(String(repeating: "x", count: 80))?.count, 80)
        XCTAssertNil(FolderFields.emoji("  "))
        XCTAssertEqual(FolderFields.emoji(" 🚀 "), "🚀")
        XCTAssertEqual(FolderFields.emojiPresets.count, 12)
    }

    // MARK: Read state

    func testFolderUnreadThreadsAndStatus() throws {
        var bot = try bot()
        XCTAssertEqual(bot.folderUnreadThreadIds("p-1"), ["t-2"])
        XCTAssertEqual(bot.folderUnreadThreadIds("p-2"), [])
        XCTAssertEqual(bot.folderThreads("p-1").map(\.threadId), ["t-1", "t-2"])
        XCTAssertEqual(FolderStatus(bot.folderThreads("p-1")), .unread)
        bot.tasks?[0].activity = "working"
        XCTAssertEqual(FolderStatus(bot.folderThreads("p-1")), .working)
        bot.tasks?[1].activity = "waiting-on-you"
        XCTAssertEqual(FolderStatus(bot.folderThreads("p-1")), .waiting)
        XCTAssertNil(FolderStatus(bot.folderThreads("p-2")))
    }

    func testCurrentThreadFallsBackToTheBotsUnreadFlag() throws {
        var bot = try bot()
        bot.unread = true
        XCTAssertEqual(bot.folderUnreadThreadIds("p-1"), ["t-1", "t-2"])
    }

    func testEmptyFoldersStayListedWhenAsked() throws {
        let bot = try bot()
        XCTAssertEqual(bot.threadGroups().compactMap(\.project?.id), ["p-1"])
        let all = bot.threadGroups(includingEmptyFolders: true)
        XCTAssertEqual(all.compactMap(\.project?.id), ["p-1", "p-2"])
        XCTAssertEqual(all.first { $0.project?.id == "p-2" }?.tasks, [])
        // a search drops an empty folder unless its name matches
        XCTAssertEqual(bot.threadGroups(matching: "Two", includingEmptyFolders: true).compactMap(\.project?.id), ["p-1"])
        XCTAssertEqual(bot.threadGroups(matching: "Home", includingEmptyFolders: true).compactMap(\.project?.id), ["p-2"])
    }

    // MARK: Menus

    func testBotThreadMenuFollowsTheDesktopOrder() throws {
        let task = try bot().tasks![0]
        let plan = ThreadMenuPlan(task: task, ownerIsBot: true, folders: try bot().folders, generatedTitles: true, canDelete: true)
        XCTAssertEqual(plan.items, [.rename, .pin, .archive, .snooze, .more])
        XCTAssertEqual(plan.more, [.moveToFolder, .copyLink, .regenerateTitle, .makeConfidential, .delete])
        XCTAssertFalse(plan.stopsSnoozing)
        XCTAssertTrue(plan.disabled.isEmpty)
    }

    func testThreadMenuDropsWhatTheDesktopHides() throws {
        var task = try bot().tasks![0]
        let noTitles = ThreadMenuPlan(task: task, ownerIsBot: true, folders: [], generatedTitles: false, canDelete: true)
        XCTAssertFalse(noTitles.shows(.regenerateTitle))
        XCTAssertFalse(noTitles.shows(.moveToFolder), "no folders, no picker")
        let room = ThreadMenuPlan(task: task, ownerIsBot: false, folders: try bot().folders, generatedTitles: true, canDelete: true)
        XCTAssertEqual(room.items, [.rename, .pin, .more])
        XCTAssertEqual(room.more, [.copyLink, .delete])
        task.snoozedUntil = 0
        let snoozed = ThreadMenuPlan(task: task, ownerIsBot: true, folders: [], generatedTitles: false, canDelete: true)
        XCTAssertTrue(snoozed.shows(.stopSnoozing))
        XCTAssertTrue(snoozed.stopsSnoozing, "Stop snoozing sits inside Snooze")
    }

    func testWorkingThreadDisablesArchiveSnoozeAndDelete() throws {
        var task = try bot().tasks![0]
        task.activity = "working"
        task.snoozedUntil = 0
        let plan = ThreadMenuPlan(task: task, ownerIsBot: true, folders: [], generatedTitles: true, canDelete: true)
        XCTAssertEqual(plan.disabled, [.archive, .snooze, .delete])
        XCTAssertTrue(plan.enables(.stopSnoozing))
        XCTAssertTrue(plan.enables(.rename))
        let last = ThreadMenuPlan(task: try bot().tasks![0], ownerIsBot: true, folders: [], generatedTitles: true, canDelete: false)
        XCTAssertEqual(last.disabled, [.delete])
    }

    func testFolderMenuFollowsTheGateAndPosition() throws {
        let bot = try bot()
        let first = FolderMenuPlan(bot: bot, folder: bot.folders[0], canManage: true)
        XCTAssertEqual(first.items, [.newThread, .settings, .markRead, .moveUp, .moveDown])
        XCTAssertEqual(first.disabled, [.moveUp])
        let last = FolderMenuPlan(bot: bot, folder: bot.folders[1], canManage: true)
        XCTAssertEqual(last.disabled, [.markRead, .moveDown])
        let client = FolderMenuPlan(bot: bot, folder: bot.folders[0], canManage: false)
        XCTAssertEqual(client.items, [.newThread, .markRead])
    }

    func testFolderGateFollowsThePairing() {
        XCTAssertTrue(SurfaceGate(scope: .sidecar).allows(.threadFolders))
        XCTAssertTrue(SurfaceGate(scope: .serverAdmin).allows(.threadFolders))
        XCTAssertFalse(SurfaceGate(scope: .serverClient).allows(.threadFolders))
        XCTAssertFalse(SurfaceGate(scope: .serverClient, organization: true).allows(.threadFolders))
    }

    // MARK: Requests

    func testCreateFolderSendsNameAndEmoji() throws {
        let request = try client.createFolderRequest(botId: "bot-1", name: " Work ", emoji: "💼")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/bots/bot-1/projects")
        let json = try body(request)
        XCTAssertEqual(json["name"] as? String, "Work")
        XCTAssertEqual(json["emoji"] as? String, "💼")
        let plain = try body(client.createFolderRequest(botId: "bot-1", name: "Home", emoji: nil))
        XCTAssertTrue(plain["emoji"] is NSNull, "the desktop sends null for the default icon")
        XCTAssertThrowsError(try client.createFolderRequest(botId: "bot-1", name: "  ", emoji: nil))
        XCTAssertThrowsError(try client.createFolderRequest(botId: "../x", name: "Home", emoji: nil))
    }

    func testUpdateFolderSendsOnlyWhatChanged() throws {
        let rename = try body(client.updateFolderRequest(botId: "bot-1", folderId: "p-1", name: "Office", emoji: nil))
        XCTAssertEqual(rename.keys.sorted(), ["name"])
        let reset = try body(client.updateFolderRequest(botId: "bot-1", folderId: "p-1", name: nil, emoji: .some(nil)))
        XCTAssertEqual(reset.keys.sorted(), ["emoji"])
        XCTAssertTrue(reset["emoji"] is NSNull)
        let request = try client.updateFolderRequest(botId: "bot-1", folderId: "p-1", name: "A", emoji: "⭐")
        XCTAssertEqual(request.httpMethod, "PATCH")
        XCTAssertEqual(request.url?.path, "/api/bots/bot-1/projects/p-1")
        XCTAssertThrowsError(try client.updateFolderRequest(botId: "bot-1", folderId: "p-1", name: nil, emoji: nil))
    }

    func testDeleteAndReorderFolders() throws {
        let delete = try client.deleteFolderRequest(botId: "bot-1", folderId: "p-1")
        XCTAssertEqual(delete.httpMethod, "DELETE")
        XCTAssertEqual(delete.url?.path, "/api/bots/bot-1/projects/p-1")
        XCTAssertThrowsError(try client.deleteFolderRequest(botId: "bot-1", folderId: "order"))
        let order = try client.reorderFoldersRequest(botId: "bot-1", folderIds: ["p-2", "p-1"])
        XCTAssertEqual(order.httpMethod, "PATCH")
        XCTAssertEqual(order.url?.path, "/api/bots/bot-1/projects/order")
        XCTAssertEqual(try body(order)["projectIds"] as? [String], ["p-2", "p-1"])
        XCTAssertThrowsError(try client.reorderFoldersRequest(botId: "bot-1", folderIds: ["p-1", "p-1"]))
    }

    func testMoveThreadSendsProjectIdOrNull() throws {
        let move = try client.moveTaskRequest(botId: "bot-1", threadId: "t-3", folderId: "p-2")
        XCTAssertEqual(move.httpMethod, "PATCH")
        XCTAssertEqual(move.url?.path, "/api/bots/bot-1/tasks/t-3")
        XCTAssertEqual(try body(move)["projectId"] as? String, "p-2")
        let out = try body(client.moveTaskRequest(botId: "bot-1", threadId: "t-3", folderId: nil))
        XCTAssertTrue(out["projectId"] is NSNull, "null takes it out of every folder")
    }

    func testRegenerateTitleMarkUnreadAndNewThreadInFolder() throws {
        let title = try client.regenerateTaskTitleRequest(botId: "bot-1", threadId: "t-1")
        XCTAssertEqual(title.httpMethod, "POST")
        XCTAssertEqual(title.url?.path, "/api/bots/bot-1/tasks/t-1/title")
        let unread = try client.markUnreadRequest(botId: "bot-1")
        XCTAssertEqual(unread.httpMethod, "PATCH")
        XCTAssertEqual(unread.url?.path, "/api/bots/bot-1")
        XCTAssertEqual(try body(unread) as NSDictionary, ["unread": true] as NSDictionary)
        let filed = try client.createTaskRequest(botId: "bot-1", folderId: "p-1")
        XCTAssertEqual(filed.url?.path, "/api/bots/bot-1/tasks")
        XCTAssertEqual(try body(filed)["projectId"] as? String, "p-1")
        XCTAssertEqual(try body(client.createTaskRequest(botId: "bot-1", folderId: nil)).count, 0)
    }

    func testCreateFolderDecodesTheFolderAndTheBot() async throws {
        ThreadRequestStub.statusCode = 201
        ThreadRequestStub.responseBody = Data(#"{"project":{"id":"p-9","name":"New"},"bot":\#(Self.botJSON)}"#.utf8)
        let created = try await client.createFolder(botId: "bot-1", name: "New", emoji: nil)
        XCTAssertEqual(created.project.id, "p-9")
        XCTAssertEqual(created.bot.folders.count, 2)
    }

    func testThreadTitleFeatureReadsTheConfigSwitch() async throws {
        ThreadRequestStub.responseBody = Data(#"{"features":{"llmThreadTitles":true},"tts":{"configured":false}}"#.utf8)
        let on = try await client.threadTitleFeature()
        XCTAssertTrue(on.enabled)
        XCTAssertEqual(ThreadRequestStub.captured?.url?.path, "/api/config")
        ThreadRequestStub.responseBody = Data(#"{"tts":{}}"#.utf8)
        let off = try await client.threadTitleFeature()
        XCTAssertFalse(off.enabled)
    }
}
