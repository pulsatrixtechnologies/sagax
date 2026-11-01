// Demo mode: the whole app on local, made-up data, with no computer, no
// server, no account and no network.
//
// `DemoServer` answers the same calls a server would (`CompanionClient`
// talks to it through `DemoURLProtocol`, the only protocol its URLSession
// has, so a request can never leave the phone), and plays the replies a
// server would stream as frames handed to `onFrame`. Everything it holds is
// in memory and dies with it: nothing is written to the Keychain, the saved
// connections, the widgets or the App Group.
//
// The data is generic (Atlas, Pixel, Scout, Forge, Sam Rivera), written in
// the interface's language (`DemoLanguage`), and every timestamp derives
// from the `now` it was made with, so a fixed clock gives the same screens
// every time (App Review, screenshots).
import Foundation

public final class DemoServer: @unchecked Sendable {
    /// Never resolvable (RFC 2606), and never dialled: the demo session's
    /// only protocol answers every request itself.
    public static let host = "demo.sagax.invalid"
    public static let connectionID = "sagax-demo"

    public let connection: Connection
    /// The language of the made-up data and the prepared replies.
    public let language: DemoLanguage
    /// Replies and card updates, in order. Called on an arbitrary queue.
    public var onFrame: (@Sendable (Frame) -> Void)?
    /// Delay between streamed chunks; tests use zero.
    public var chunkDelay: TimeInterval

    let lock = NSLock()
    private let now: Date
    var bots: [Bot]
    var rooms: [Room]
    private var routines: [Routine]
    private let sections: [String]
    private var runs: [RoutineRun]
    private var counter = 0
    private var stopped = false
    /// App Store 1.2 (Moderation.swift): the demo's own blocked list, its
    /// reports, and the terms, asked once per demo (so a reviewer sees them).
    private var blocked: [Moderation.BlockedPerson] = []
    private var reports: [String] = []
    private var termsAccepted: Double?
    /// `DELETE /api/me` with `{ confirm: true }` already dropped the made-up
    /// account. Nothing was stored; the phone then leaves the demo.
    private var accountDeleted = false
    /// Who Atlas is shared with, in memory only.
    private var shares: [[String: Any]] = [
        ["target": "user:demo-sam", "level": "use", "label": "Sam Rivera", "kind": "user"],
        ["target": "user:demo-jordan", "level": "run", "label": "Jordan Lee", "kind": "user"],
        ["target": "team:demo-product", "level": "run", "label": "Product", "kind": "team"],
    ]
    /// Every request the demo answered, for tests.
    private var handled: [String] = []
    /// Atlas's made-up page (DemoPages.swift), in memory only.
    var demoPage: DemoPage
    /// Synthetic Library files for demo threads (DemoFiles.swift).
    var threadFiles: [DemoThreadFile] = []
    /// In-memory resumable / one-shot upload sessions (DemoFiles.swift).
    var uploads: [String: DemoUploadSession] = [:]
    /// Loopback HTTP fixture (DemoListen.swift).
    var listener: Int32?
    var listenerURL: URL?
    var listenerQueue: DispatchQueue?

    public init(now: Date = Date(), language: DemoLanguage = .english, chunkDelay: TimeInterval = 0.06, calendar: Calendar = .current) {
        self.now = now
        self.language = language
        self.chunkDelay = chunkDelay
        let fixture = DemoFixture(now: now, language: language, calendar: calendar)
        sections = fixture.sections
        bots = fixture.bots
        rooms = fixture.rooms
        routines = fixture.routines
        runs = fixture.runs
        demoPage = DemoPage(language: language, at: (now.timeIntervalSince1970 * 1000).rounded() - 11 * 60_000)
        // A made-up organization (serverEnvironmentId marks a server pairing)
        // so Share is offered on the pinned bot, the same gate as a real one.
        connection = Connection(
            id: Self.connectionID, name: language.pick("Sagax demo", "Démo Sagax"), host: Self.host, port: 443,
            serverEnvironmentId: "demo", serverScopes: ["client"]
        )
        seedDemoFiles(language: language, now: now)
    }

    /// The fleet the app hydrates from on entering the demo.
    public var fleet: Fleet {
        lock.lock(); defer { lock.unlock() }
        return Fleet(bots: bots, groups: rooms, botQueuedMessages: [:], sections: sections)
    }

    /// A client whose every request is answered here.
    public func makeClient() -> CompanionClient {
        DemoURLProtocol.register(self)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DemoURLProtocol.self]
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        return CompanionClient(connection: connection, token: "demo", session: URLSession(configuration: configuration))
    }

    /// Stop playing replies (leaving the demo).
    public func stop() {
        lock.lock(); stopped = true; lock.unlock()
        stopListening()
        DemoURLProtocol.unregister(self)
    }

    public var handledRequests: [String] {
        lock.lock(); defer { lock.unlock() }
        return handled
    }

    // MARK: - Requests

    public struct Response: Sendable {
        public var status: Int
        public var body: Data
        public var contentType: String

        public init(status: Int, body: Data, contentType: String = "application/json") {
            self.status = status
            self.body = body
            self.contentType = contentType
        }
    }

    static let unavailable = "Not available in the demo. Connect a computer or sign in to an organization to use this."
    static let unavailableFrench = "Pas disponible dans la démo. Connecte un ordinateur ou connecte-toi à une organisation pour l'utiliser."

    /// Answer one request. Public for tests. Query and Content-Type matter for
    /// the resumable upload contract (`phase`, `uploadId`, `total`, `offset`).
    public func respond(method: String, path: String, body: Data?, query: [URLQueryItem] = [], contentType: String? = nil) -> Response {
        lock.lock()
        let queryMark = query.isEmpty ? "" : "?\(query.map { "\($0.name)=\($0.value ?? "")" }.joined(separator: "&"))"
        handled.append("\(method) \(path)\(queryMark)")
        lock.unlock()
        let parts = path.split(separator: "/").map(String.init)
        let json = (body.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
        switch (method, parts.count >= 2 ? Array(parts.prefix(2)) : parts) {
        case ("GET", ["api", "bots"]) where parts.count == 2:
            return encode(FleetBody(fleet: fleet))
        case ("GET", ["api", "health"]):
            // Encoded rather than spelled out, so no upstream name sits in the
            // binary as a JSON literal (scripts/check-ios-bundle-names.sh).
            return encode(CompanionClient.HealthIdentity(app: CompanionClient.HealthIdentity.expectedApp))
        case ("GET", ["api", "routines"]):
            lock.lock(); defer { lock.unlock() }
            return encode(RoutinesResponse(routines: routines, runs: runs))
        case ("GET", ["api", "threads"]) where parts.count == 4 && parts[3] == "messages":
            return encode(page(threadId: parts[2]))
        case ("POST", ["api", "bots"]) where parts.count == 4 && parts[3] == "messages":
            return send(text: json["text"] as? String ?? "", botId: parts[2], groupId: nil, threadId: json["threadId"] as? String, onCall: json["voiceCall"] != nil,
                        page: ((json["dataContext"] as? [String: Any])?["page"]).flatMap { try? JSONSerialization.data(withJSONObject: $0) }.flatMap { try? JSONDecoder().decode(PageContextRef.self, from: $0) })
        case ("POST", ["api", "groups"]) where parts.count == 4 && parts[3] == "messages":
            return send(text: json["text"] as? String ?? "", botId: nil, groupId: parts[2], threadId: json["threadId"] as? String, onCall: json["voiceCall"] != nil)
        case ("POST", ["api", "threads"]) where parts.count == 4 && parts[3] == "respond":
            return answer(threadId: parts[2], requestId: json["requestId"] as? String, behavior: json["behavior"] as? String ?? "deny", message: json["message"] as? String)
        case ("POST", ["api", "threads"]) where parts.count == 6 && parts[3] == "messages" && parts[5] == "report":
            return report(threadId: parts[2], messageId: parts[4])
        case (_, ["api", "me"]) where parts.count >= 3 && parts[2] == "blocks":
            return blocks(method: method, id: parts.count == 4 ? parts[3] : nil, json: json)
        case (_, ["api", "me"]) where parts.count == 3 && parts[2] == "terms":
            return terms(method: method)
        case ("DELETE", ["api", "me"]) where parts.count == 2:
            return deleteAccount(json)
        case ("GET", ["api", "auth"]) where parts.count == 3 && parts[2] == "session":
            return accountSession()
        case (_, ["api", "bots"]) where parts.count >= 4 && parts[3] == "grants":
            return shareGrants(method: method, botId: parts[2], target: parts.count > 4 ? parts[4] : nil, json: json)
        case (_, ["api", "pages"]):
            return pages(method: method, parts: parts, json: json)
        case ("GET", ["api", "org"]) where parts.count == 3 && parts[2] == "directory":
            return shareDirectory()
        case ("POST", ["api", "bots"]) where parts.count == 4 && (parts[3] == "read" || parts[3] == "always-allow"),
             ("POST", ["api", "groups"]) where parts.count == 4 && parts[3] == "read":
            return .init(status: 200, body: Data("{}".utf8))
        case (_, ["api", "threads"]) where parts.count >= 4 && parts[3] == "files",
             (_, ["api", "bots"]) where parts.count >= 4 && ["files", "artifacts", "links"].contains(parts[3]),
             ("POST", ["api", "files"]) where parts.count == 2,
             ("POST", ["api", "attachments"]) where parts.count == 2,
             ("GET", ["pages", "preview"]),
             ("GET", ["pages", "preview-frame"]):
            return libraryFiles(method: method, parts: parts, query: query, body: body, contentType: contentType)
        default:
            return refusal(status: method == "GET" ? 404 : 403)
        }
    }

    // MARK: - Report, Block, terms (App Store 1.2)

    private func report(threadId: String, messageId: String) -> Response {
        lock.lock()
        let known = (bots.first { $0.threadId == threadId }?.messages ?? rooms.first { $0.threadId == threadId }?.messages ?? [])
            .contains { $0.id == messageId }
        lock.unlock()
        guard known else { return refusal(status: 404) }
        let id = nextID("report")
        let at = stamp()
        lock.lock(); reports.append(id); lock.unlock()
        let body = (try? JSONSerialization.data(withJSONObject: ["report": ["id": id, "at": at, "status": "open"]])) ?? Data()
        return .init(status: 201, body: body)
    }

    private struct BlocksBody: Encodable { var people: [Moderation.BlockedPerson] }

    private func blocks(method: String, id: String?, json: [String: Any]) -> Response {
        switch (method, id) {
        case ("GET", nil):
            break
        case ("POST", nil):
            let target = Moderation.norm(json["id"] as? String)
            guard !target.isEmpty else { return refusal(status: 400) }
            let name = (json["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? target
            let at = stamp()
            lock.lock()
            if let index = blocked.firstIndex(where: { $0.id == target }) { blocked[index].name = name }
            else { blocked.append(.init(id: target, name: name, at: at)) }
            lock.unlock()
        case let ("DELETE", id?):
            let target = Moderation.norm(id.removingPercentEncoding ?? id)
            lock.lock(); blocked.removeAll { $0.id == target }; lock.unlock()
        default:
            return refusal(status: 405)
        }
        lock.lock(); defer { lock.unlock() }
        return encode(BlocksBody(people: blocked))
    }

    private func terms(method: String) -> Response {
        if method == "POST" {
            let at = stamp()
            lock.lock(); if termsAccepted == nil { termsAccepted = at }; lock.unlock()
        } else if method != "GET" {
            return refusal(status: 405)
        }
        lock.lock(); let accepted = termsAccepted; lock.unlock()
        return encode(Moderation.TermsStatus(
            accepted: accepted != nil, url: Moderation.termsURL.absoluteString,
            version: accepted == nil ? nil : Moderation.termsVersion, acceptedAt: accepted
        ))
    }

    /// Reports the demo took (tests).
    public var reportCount: Int {
        lock.lock(); defer { lock.unlock() }
        return reports.count
    }

    /// The made-up person the demo is signed in as. Share uses this principal.
    private func accountSession() -> Response {
        let body = (try? JSONSerialization.data(withJSONObject: [
            "kind": "session", "id": "demo-session", "scopes": ["client"],
            "name": "Alex Martin", "email": "alex.martin@example.test",
            "principalId": "demo-alex", "role": "member",
        ])) ?? Data()
        return .init(status: 200, body: body)
    }

    private func shareDirectory() -> Response {
        let body = (try? JSONSerialization.data(withJSONObject: [
            "people": [
                ["principalId": "demo-alex", "name": "Alex Martin", "login": "alex.martin"],
                ["principalId": "demo-sam", "name": "Sam Rivera", "login": "sam.rivera"],
                ["principalId": "demo-jordan", "name": "Jordan Lee", "login": "jordan.lee"],
            ],
            "teams": [
                ["id": "demo-product", "name": "Product", "managers": ["demo-alex"], "members": ["demo-sam", "demo-jordan"]],
            ],
        ])) ?? Data()
        return .init(status: 200, body: body)
    }

    /// Shared with, in memory. The page reads it after Share on a bot.
    private func shareGrants(method: String, botId: String, target: String?, json: [String: Any]) -> Response {
        lock.lock()
        let known = bots.contains { $0.id == botId }
        lock.unlock()
        guard known else { return refusal(status: 404) }
        switch method {
        case "GET":
            break
        case "PUT":
            let id = (json["target"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let level = (json["level"] as? String) ?? "use"
            guard !id.isEmpty, ["use", "run", "edit", "manage"].contains(level) else { return refusal(status: 400) }
            let label = id.hasPrefix("user:demo-sam") ? "Sam Rivera" : (id.hasPrefix("user:demo-jordan") ? "Jordan Lee" : (id.hasPrefix("team:") ? "Product" : id))
            let kind = id.hasPrefix("team:") ? "team" : "user"
            lock.lock()
            shares.removeAll { ($0["target"] as? String) == id }
            shares.append(["target": id, "level": level, "label": label, "kind": kind])
            lock.unlock()
        case "DELETE":
            let raw = target?.removingPercentEncoding ?? target ?? ""
            lock.lock()
            shares.removeAll { ($0["target"] as? String) == raw }
            lock.unlock()
        default:
            return refusal(status: 405)
        }
        lock.lock()
        let rows = shares
        lock.unlock()
        let body = (try? JSONSerialization.data(withJSONObject: [
            "grants": rows,
            "administer": ["any": true, "teamIds": ["demo-product"], "maxLevel": "manage"],
        ])) ?? Data()
        return .init(status: 200, body: body)
    }

    /// True after a confirmed `DELETE /api/me` (tests).
    public var didDeleteAccount: Bool {
        lock.lock(); defer { lock.unlock() }
        return accountDeleted
    }

    /// Account deletion, simulated (guideline 5.1.1(v)). The demo has no
    /// account system, so there is nothing to sign in to again and nothing
    /// to ask an administrator: a confirmed delete drops the made-up bots,
    /// rooms and routines in memory and answers `{ deleted: true }`. The
    /// phone then leaves the demo (`forgetConnection`). Without
    /// `{ confirm: true }` nothing is dropped.
    private func deleteAccount(_ json: [String: Any]) -> Response {
        guard json["confirm"] as? Bool == true else {
            let error = language.pick(
                "Confirm the deletion ({ confirm: true }): it cannot be undone.",
                "Confirme la suppression ({ confirm: true }) : c'est irréversible."
            )
            let body = (try? JSONSerialization.data(withJSONObject: ["error": error, "code": "confirm"])) ?? Data()
            return .init(status: 400, body: body)
        }
        lock.lock()
        let removedBots = bots.count
        let removedThreads = bots.count + rooms.count
        bots = []
        rooms = []
        routines = []
        runs = []
        threadFiles = []
        uploads = [:]
        accountDeleted = true
        lock.unlock()
        let body = (try? JSONSerialization.data(withJSONObject: [
            "deleted": true, "bots": removedBots, "threads": removedThreads,
        ])) ?? Data()
        return .init(status: 200, body: body)
    }

    func refusal(status: Int) -> Response {
        let body = (try? JSONSerialization.data(withJSONObject: ["error": language.pick(Self.unavailable, Self.unavailableFrench), "code": "demo"])) ?? Data()
        return .init(status: status, body: body)
    }

    private struct FleetBody: Encodable {
        var bots: [Bot]
        var groups: [Room]
        var botQueuedMessages: [String: [QueuedSend]]
        var sections: [String]
        init(fleet: Fleet) {
            bots = fleet.bots
            groups = fleet.groups
            botQueuedMessages = fleet.botQueuedMessages ?? [:]
            sections = fleet.sections ?? []
        }
    }

    private func encode<T: Encodable>(_ value: T) -> Response {
        guard let data = try? JSONEncoder().encode(value) else { return refusal(status: 500) }
        return .init(status: 200, body: data)
    }

    private func page(threadId: String) -> ThreadPage {
        lock.lock(); defer { lock.unlock() }
        if let bot = bots.first(where: { $0.threadId == threadId }) {
            return ThreadPage(messages: bot.messages ?? [], hasMore: false, activeLeafId: bot.activeLeafId)
        }
        if let room = rooms.first(where: { $0.threadId == threadId }) {
            return ThreadPage(messages: room.messages ?? [], hasMore: false, activeLeafId: room.messages?.last?.id)
        }
        return ThreadPage(messages: [], hasMore: false, activeLeafId: nil)
    }

    private func nextID(_ prefix: String) -> String {
        lock.lock(); defer { lock.unlock() }
        counter += 1
        return "demo-\(prefix)-\(counter)"
    }

    /// A moment after the newest message, so new lines sort last even with
    /// a fixed clock.
    private func stamp() -> Double {
        lock.lock(); defer { lock.unlock() }
        counter += 1
        return now.timeIntervalSince1970 * 1000 + Double(counter) * 1000
    }

    private func send(text: String, botId: String?, groupId: String?, threadId: String?, onCall: Bool, page: PageContextRef? = nil) -> Response {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return refusal(status: 400) }
        lock.lock()
        let bot = botId.flatMap { id in bots.first(where: { $0.id == id }) }
        let room = groupId.flatMap { id in rooms.first(where: { $0.id == id }) }
        lock.unlock()
        guard bot != nil || room != nil else { return refusal(status: 404) }
        let thread = bot?.threadId ?? room!.threadId
        let parent = lastMessageID(thread: thread)
        var user = Message(id: nextID("you"), role: .user, kind: .text, at: stamp(), text: trimmed, parentId: parent)
        // a message sent from the open page keeps it (its chip)
        if let page, page.isDrawable { user.dataContext = MessageDataContext(page: page) }
        record(user, thread: thread)
        emit(.message(threadId: thread, message: user))
        let speaker = bot ?? bots.first(where: { room!.memberIds.contains($0.id) })!
        let reply = DemoFixture.reply(to: trimmed, from: speaker.name, language: language, onCall: onCall)
        stream(reply, from: speaker, inRoom: room != nil, thread: thread, parent: user.id)
        return .init(status: 200, body: Data(#"{"threadId":"\#(thread)"}"#.utf8))
    }

    private func answer(threadId: String, requestId: String?, behavior: String, message: String?) -> Response {
        lock.lock()
        let found: (botIndex: Int, messageIndex: Int)? = bots.indices.lazy.compactMap { b -> (Int, Int)? in
            guard let m = self.bots[b].messages?.firstIndex(where: { $0.card?.requestId == requestId && $0.card?.isPending == true }) else { return nil }
            return (b, m)
        }.first
        guard let found else {
            lock.unlock()
            let error = language.pick("This request was already answered.", "Cette demande a déjà reçu une réponse.")
            let body = (try? JSONSerialization.data(withJSONObject: ["error": error])) ?? Data()
            return .init(status: 409, body: body)
        }
        var card = bots[found.botIndex].messages![found.messageIndex]
        card.card?.answered = behavior
        if let message { card.card?.answeredText = message }
        bots[found.botIndex].messages![found.messageIndex] = card
        bots[found.botIndex].activity = "working"
        let bot = bots[found.botIndex]
        lock.unlock()
        emit(.messagePatch(threadId: threadId, message: card))
        let text = behavior == "allow"
            ? language.pick(
                "Approved, thank you. Version 2.4 is published for the team. They can read it in a few minutes.",
                "Approuvé, merci. La version 2.4 est publiée pour l'équipe. Elle sera visible dans quelques minutes."
            )
            : language.pick(
                "Understood, I won't publish it. Version 2.4 stays on the computer until you say so.",
                "Compris, je ne la publie pas. La version 2.4 reste sur l'ordinateur jusqu'à nouvel ordre."
            )
        stream(text, from: bot, inRoom: false, thread: threadId, parent: card.id)
        return .init(status: 200, body: Data(#"{"outcome":"\#(behavior == "allow" ? "allowed" : "denied")"}"#.utf8))
    }

    private func lastMessageID(thread: String) -> String? {
        lock.lock(); defer { lock.unlock() }
        if let bot = bots.first(where: { $0.threadId == thread }) { return bot.messages?.last?.id }
        return rooms.first(where: { $0.threadId == thread })?.messages?.last?.id
    }

    private func record(_ message: Message, thread: String) {
        lock.lock(); defer { lock.unlock() }
        if let index = bots.firstIndex(where: { $0.threadId == thread }) {
            bots[index].messages = (bots[index].messages ?? []) + [message]
            bots[index].activeLeafId = message.id
        } else if let index = rooms.firstIndex(where: { $0.threadId == thread }) {
            rooms[index].messages = (rooms[index].messages ?? []) + [message]
        }
    }

    private func setBusy(_ bot: Bot, _ busy: Bool) {
        lock.lock()
        guard let index = bots.firstIndex(where: { $0.id == bot.id }) else { lock.unlock(); return }
        bots[index].busy = busy
        bots[index].activity = busy ? "working" : "idle"
        var frame = bots[index]
        frame.messages = nil
        lock.unlock()
        emit(.bot(frame))
    }

    /// The reply arrives the way a server streams one: deltas, then the
    /// settled message.
    private func stream(_ text: String, from bot: Bot, inRoom: Bool, thread: String, parent: String) {
        let id = nextID("reply")
        let delay = chunkDelay
        if !inRoom { setBusy(bot, true) }
        let words = text.split(separator: " ", omittingEmptySubsequences: false).map(String.init)
        let work = { [weak self] in
            guard let self else { return }
            var sent = ""
            for (index, word) in words.enumerated() {
                if self.isStopped { return }
                let chunk = index == 0 ? word : " " + word
                sent += chunk
                self.emit(.runtime(RuntimeEvent(type: "content.delta", threadId: thread, delta: chunk, streamKind: "assistant_text")))
                if delay > 0 { Thread.sleep(forTimeInterval: delay) }
            }
            var reply = Message(id: id, role: .bot, kind: .text, at: self.stamp(), text: sent, parentId: parent)
            if inRoom { reply.from = Sender(botId: bot.id, name: bot.name, color: bot.color) }
            self.record(reply, thread: thread)
            self.emit(.message(threadId: thread, message: reply))
            if !inRoom { self.setBusy(bot, false) }
        }
        if delay > 0 {
            DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 0.4, execute: work)
        } else {
            work()
        }
    }

    private var isStopped: Bool {
        lock.lock(); defer { lock.unlock() }
        return stopped
    }

    private func emit(_ frame: Frame) {
        guard !isStopped else { return }
        onFrame?(frame)
    }
}

// MARK: - The only protocol a demo session has

/// Answers every request of a demo session from the registered
/// `DemoServer`. It claims every request it is asked about, so a demo
/// session has no path to the network at all: a request for any other host
/// fails here with `notConnectedToInternet`.
public final class DemoURLProtocol: URLProtocol {
    nonisolated(unsafe) private static var server: DemoServer?
    private static let lock = NSLock()
    /// Requests refused because they named another host (tests).
    nonisolated(unsafe) public private(set) static var refusedHosts: [String] = []

    static func register(_ server: DemoServer) {
        lock.lock(); self.server = server; lock.unlock()
    }

    static func unregister(_ server: DemoServer) {
        lock.lock()
        if self.server === server { self.server = nil }
        lock.unlock()
    }

    override public class func canInit(with request: URLRequest) -> Bool { true }
    override public class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override public func startLoading() {
        Self.lock.lock()
        let server = Self.server
        Self.lock.unlock()
        guard let url = request.url, url.host == DemoServer.host, let server else {
            Self.lock.lock(); Self.refusedHosts.append(request.url?.host ?? "?"); Self.lock.unlock()
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let body = request.httpBody ?? request.httpBodyStream.map(Self.read)
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let contentType = request.value(forHTTPHeaderField: "Content-Type")
        let answer = server.respond(
            method: request.httpMethod ?? "GET", path: url.path, body: body,
            query: query, contentType: contentType
        )
        let response = HTTPURLResponse(
            url: url, statusCode: answer.status, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": answer.contentType]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: answer.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override public func stopLoading() {}

    private static func read(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}
