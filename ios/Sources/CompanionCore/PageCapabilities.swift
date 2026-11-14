// A page's capabilities on the phone (#3413 lot 8, shared/page-capabilities.ts
// and the desktop's broker src/page-reader/capabilities.ts). The page's
// script runs in a sandboxed frame (no network, no cookie, opaque origin)
// and posts `sagax-cap` calls to its wrapper. On the desktop the app's
// preview wrapper relays them to the app; on the phone the wrapper is the
// web view's own page, so a script in an isolated world (PageWebView) hands
// the frame's messages to this broker and posts its answers back to that
// frame. The broker calls the server with this phone's own session; the page
// never gets a token, an address or the network, only the answers.
//
// The rules are the desktop's, each pinned by PageCapabilityBrokerTests:
//  - the server's declaration decides: a name it did not grant is refused
//    here without a request (the server refuses it again anyway);
//  - a call this app does not know is answered `unavailable`, never dropped;
//  - an organization's Ask first (409 ask_first) shows its card outside the
//    page; the reader's answer goes to the server, then the data is read
//    again (no flag in a request is ever trusted);
//  - once the frame received personal data, a link opens without a question
//    only when its address appeared as is in a data answer; any other shows
//    its card and waits for the reader;
//  - `open` takes only a reference a data answer held;
//  - a download starts from the reader's click, with an allowed type, a clean
//    name and at most PageCapLimits.fileBytes;
//  - no timer: coming back to the app makes the page read again.
import Combine
import Foundation

// MARK: - Contract

public enum PageCapMessage {
    public static let call = "sagax-cap"
    public static let result = "sagax-cap-result"
    public static let event = "sagax-cap-event"
    public static let hello = "sagax-cap-hello"
    public static let ready = "sagax-cap-ready"
    public static let taken = "sagax-cap-taken"
    /// The page's own open-link bridge (shared/published-pages.ts PAGE_OPEN_MESSAGE).
    public static let open = "sagax-page-open"
}

/// The calls a page may make (PAGE_CAP_CALLS).
public enum PageCapCall: String, CaseIterable, Sendable {
    case dataRead = "data.read"
    case viewerGet = "viewer.get"
    case open
    case filesDownload = "files.download"
}

public enum PageCapLimits {
    public static let fileBytes = 25 * 1024 * 1024
    public static let dataParamsMax = 8
    public static let dataParamChars = 200
    /// A card ignores the taps that follow its appearance by this long: the
    /// page chooses when a card appears and could put a decoy under a finger.
    public static let cardGuard: TimeInterval = 0.6
    /// An address longer than this shows its middle cut.
    public static let linkShownChars = 120
}

/// What files.download accepts (PAGE_CAP_FILE_MIMES).
public let pageCapFileMimes: Set<String> = [
    "text/plain", "text/csv", "text/markdown", "application/json", "application/pdf",
    "image/png", "image/jpeg", "image/gif", "image/webp",
]

/// What a version declares, as the server read it.
public struct PageCapabilities: Equatable, Sendable {
    public var data: [String]
    public var viewer: Bool
    public var open: Bool
    public var files: [String]

    public init(data: [String] = [], viewer: Bool = false, open: Bool = false, files: [String] = []) {
        self.data = data
        self.viewer = viewer
        self.open = open
        self.files = files
    }

    static let sources: Set<String> = ["team-board"]

    /// The declaration as the server sent it: known names only, exact.
    public static func parse(_ value: Any?) -> PageCapabilities? {
        guard let record = value as? [String: Any] else { return nil }
        func names(_ key: String, _ known: Set<String>) -> [String] {
            var seen: [String] = []
            for case let name as String in (record[key] as? [Any]) ?? [] where known.contains(name) && !seen.contains(name) {
                seen.append(name)
            }
            return seen
        }
        return PageCapabilities(
            data: names("data", sources),
            viewer: PageCapRules.isTrue(record["viewer"]),
            open: PageCapRules.isTrue(record["open"]),
            files: names("files", ["download"])
        )
    }

    /// Whether it grants anything at all.
    public var any: Bool { !data.isEmpty || viewer || open || !files.isEmpty }

    /// Whether a call is granted (`data.read` also needs its source named).
    public func grants(_ call: PageCapCall, source: String? = nil) -> Bool {
        switch call {
        case .dataRead: return source.map { data.contains($0) } ?? false
        case .viewerGet: return viewer
        case .filesDownload: return files.contains("download")
        case .open: return open
        }
    }
}

/// One call the frame posted, checked.
public struct PageCapRequest: Equatable {
    public var id: Int
    public var cap: PageCapCall
    public var args: [String: Any]

    public static func == (lhs: PageCapRequest, rhs: PageCapRequest) -> Bool {
        lhs.id == rhs.id && lhs.cap == rhs.cap && NSDictionary(dictionary: lhs.args).isEqual(to: rhs.args)
    }
}

public enum PageCapRules {
    /// The id of a `sagax-cap` message, or nil when it is not one.
    public static func callId(_ data: Any?) -> Int? {
        guard let record = data as? [String: Any], record["type"] as? String == PageCapMessage.call,
              wholeNumber(record["v"]) == 1, let id = wholeNumber(record["id"]), id >= 0 else { return nil }
        return id
    }

    /// A call the wrapper trusts, or nil (parsePageCapRequest).
    public static func request(_ data: Any?) -> PageCapRequest? {
        guard let id = callId(data), let record = data as? [String: Any],
              let name = record["cap"] as? String, let cap = PageCapCall(rawValue: name) else { return nil }
        if let gesture = record["gesture"], !(gesture is Bool) || isNumber(gesture) { return nil }
        let args = record["args"]
        if args != nil, !(args is [String: Any]) { return nil }
        return PageCapRequest(id: id, cap: cap, args: (args as? [String: Any]) ?? [:])
    }

    /// A `sagax-cap-hello` from the frame's bridge.
    public static func isHello(_ data: Any?) -> Bool {
        guard let record = data as? [String: Any] else { return false }
        return record["type"] as? String == PageCapMessage.hello && wholeNumber(record["v"]) == 1
    }

    /// A data source name the route takes.
    public static func validSource(_ name: Any?) -> String? {
        guard let name = name as? String, name.range(of: #"^[\w-]{1,80}$"#, options: .regularExpression) != nil else { return nil }
        return name
    }

    /// The page's filter (pageDataParams): string values only, the route's
    /// own keys left out; nil when its shape is not one a source accepts.
    public static func dataParams(_ value: Any?) -> (fresh: Bool, params: [String: String])? {
        guard let record = value as? [String: Any] else { return (false, [:]) }
        let fresh = isTrue(record["fresh"])
        var out: [String: String] = [:]
        for key in record.keys.sorted() {
            guard let text = record[key] as? String else { continue }
            if ["fresh", "version", "lang"].contains(key) { continue }
            guard key.range(of: #"^[a-z][A-Za-z0-9]{0,30}$"#, options: .regularExpression) != nil,
                  text.count <= PageCapLimits.dataParamChars else { return nil }
            out[key] = text
            if out.count > PageCapLimits.dataParamsMax { return nil }
        }
        return (fresh, out)
    }

    /// An opaque app reference (`bot:<id>` or `thread:<bot>:<thread>`).
    public static func openRef(_ value: String) -> (botId: String, threadId: String?)? {
        let id = #"[A-Za-z0-9_-]{1,80}"#
        if value.range(of: "^thread:\(id):\(id)$", options: .regularExpression) != nil {
            let parts = value.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
            return (parts[1], parts[2])
        }
        if value.range(of: "^bot:\(id)$", options: .regularExpression) != nil {
            return (String(value.dropFirst(4)), nil)
        }
        return nil
    }

    /// An absolute http(s) or mailto address a page may ask to open
    /// (parsePageOpenUrl), as the browser writes it; nil otherwise.
    public static func openURL(_ value: Any?) -> URL? {
        guard let text = value as? String, let url = URL(string: text), let scheme = url.scheme?.lowercased() else { return nil }
        if url.user != nil || url.password != nil { return nil }
        if scheme == "https" || scheme == "http" { return (url.host ?? "").isEmpty ? nil : url }
        return scheme == "mailto" ? url : nil
    }

    /// The address of a `sagax-page-open` message, checked.
    public static func openMessage(_ data: Any?) -> URL? {
        guard let record = data as? [String: Any], record["type"] as? String == PageCapMessage.open else { return nil }
        return openURL(record["url"])
    }

    /// An http(s) address's origin as a link approval keeps it: scheme, lower
    /// case host, port only when it is not the default.
    public static func origin(_ url: URL) -> String? {
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = url.host?.lowercased(), !host.isEmpty else { return nil }
        let fallback = scheme == "https" ? 443 : 80
        let port = url.port.flatMap { $0 == fallback ? nil : $0 }
        return "\(scheme)://\(host.contains(":") ? "[\(host)]" : host)\(port.map { ":\($0)" } ?? "")"
    }

    /// The address in two parts for the card: the host, then the rest as
    /// written, cut in the middle when longer than `max` (splitAddress).
    public static func splitAddress(_ url: URL, max: Int = PageCapLimits.linkShownChars) -> (host: String, rest: String, short: String, cut: Bool) {
        let text = url.absoluteString
        var host = ""
        var rest = ""
        if url.scheme?.lowercased() == "mailto" {
            let body = String(text.dropFirst("mailto:".count))
            let split = body.firstIndex(where: { $0 == "?" || $0 == "#" }) ?? body.endIndex
            host = String(body[..<split])
            rest = String(body[split...])
        } else if let components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            host = (components.percentEncodedHost ?? "") + (components.port.map { ":\($0)" } ?? "")
            let path = components.percentEncodedPath
            let query = components.percentEncodedQuery.map { "?\($0)" } ?? ""
            let fragment = components.percentEncodedFragment.map { "#\($0)" } ?? ""
            rest = (path == "/" && query.isEmpty && fragment.isEmpty ? "" : path) + query + fragment
        }
        guard rest.count > max else { return (host, rest, rest, false) }
        let keep = Swift.max(2, max - 1)
        let head = Int((Double(keep) * 0.6).rounded(.up))
        return (host, rest, "\(rest.prefix(head))…\(rest.suffix(keep - head))", true)
    }

    /// The download name: the last segment after a slash or a backslash;
    /// nil when it is empty, a dot, two dots, or holds a control character.
    public static func fileName(_ value: Any?) -> String? {
        guard let text = value as? String else { return nil }
        let segment = text.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? ""
        guard !segment.isEmpty, segment != ".", segment != ".." else { return nil }
        for unit in segment.utf16 where unit <= 0x1F || (0x7F...0x9F).contains(unit) { return nil }
        return segment
    }

    public enum FileDataFailure: String, Error { case badRequest = "bad_request", tooLarge = "too_large" }

    /// The bytes of a files.download payload: one standard base64 string, no
    /// data-URL prefix, no whitespace, at most PageCapLimits.fileBytes.
    public static func fileData(_ value: Any?, limit: Int = PageCapLimits.fileBytes) -> Result<Data, FileDataFailure> {
        guard let text = value as? String else { return .failure(.badRequest) }
        let units = Array(text.utf8)
        if (units.count / 4) * 3 - 2 > limit { return .failure(.tooLarge) }
        guard units.count % 4 == 0 else { return .failure(.badRequest) }
        let padding = units.reversed().prefix(while: { $0 == UInt8(ascii: "=") }).count
        guard padding <= 2 else { return .failure(.badRequest) }
        for unit in units.dropLast(padding) where !isBase64(unit) { return .failure(.badRequest) }
        let decoded = units.count / 4 * 3 - padding
        if decoded > limit { return .failure(.tooLarge) }
        guard let data = Data(base64Encoded: text), data.count == decoded else { return .failure(.badRequest) }
        return .success(data)
    }

    /// What a failed call tells the page: the server's own code when the
    /// contract knows it, else the one its status means (capFailure).
    public static func failure(status: Int, body: Any?) -> PageCapOutcome {
        let record = body as? [String: Any]
        let code = record?["code"] as? String ?? ""
        let error: String
        if knownErrors.contains(code) {
            error = code
        } else {
            switch status {
            case 401: error = "sign_in"
            case 403: error = "not_declared"
            case 404: error = "not_found"
            case 409: error = "ask_first"
            case 413: error = "too_large"
            case 429: error = "rate_limited"
            case 400: error = "bad_request"
            default: error = "unavailable"
            }
        }
        let message = status > 0 ? (record?["error"] as? String).flatMap { $0.isEmpty ? nil : String($0.prefix(200)) } : nil
        let said = record?["reason"] as? String
        let reason = error == "denied" && ["org_rule", "declined"].contains(said ?? "") ? said : nil
        return .failed(error, message: message, reason: reason)
    }

    static let knownErrors: Set<String> = ["sign_in", "not_declared", "denied", "ask_first", "rate_limited", "too_large", "unavailable", "not_found", "bad_request", "shared_write_after_data"]

    private static func isBase64(_ unit: UInt8) -> Bool {
        (65...90).contains(unit) || (97...122).contains(unit) || (48...57).contains(unit) || unit == 43 || unit == 47
    }

    /// A JSON number that is a whole number (JSONSerialization and WebKit
    /// both hand numbers over as NSNumber; a Bool is not one).
    static func wholeNumber(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, !isBool(number) else { return nil }
        let double = number.doubleValue
        guard double.rounded() == double, abs(double) <= 9_007_199_254_740_991 else { return nil }
        return number.intValue
    }

    /// A JSON `true`, never the number 1.
    static func isTrue(_ value: Any?) -> Bool {
        guard let number = value as? NSNumber, isBool(number) else { return false }
        return number.boolValue
    }

    private static func isNumber(_ value: Any?) -> Bool {
        guard let number = value as? NSNumber else { return false }
        return !isBool(number)
    }

    private static func isBool(_ number: NSNumber) -> Bool {
        CFGetTypeID(number) == CFBooleanGetTypeID()
    }
}

/// One answer to the page.
public enum PageCapOutcome: Equatable {
    case value(PageCapJSON)
    case failed(String, message: String?, reason: String?)

    var message: [String: Any] {
        switch self {
        case let .value(json): return ["ok": true, "value": json.raw]
        case let .failed(error, message, reason):
            var out: [String: Any] = ["ok": false, "error": error]
            if let message { out["message"] = message }
            if let reason { out["reason"] = reason }
            return out
        }
    }
}

/// A JSON value as the server sent it, passed to the page as is.
public struct PageCapJSON: Equatable {
    public let raw: Any
    public init(_ raw: Any?) { self.raw = raw ?? NSNull() }
    public static func == (lhs: PageCapJSON, rhs: PageCapJSON) -> Bool {
        NSArray(object: lhs.raw).isEqual(NSArray(object: rhs.raw))
    }
}

// MARK: - Broker

public extension CompanionClient {
    /// One call of a page's broker with this phone's session: the status and
    /// the JSON body, whatever the status (the broker reads the server's own
    /// code and message). Throws only when the server could not be reached.
    func pageCapabilityCall(_ method: String, _ path: String, query: [URLQueryItem], body: [String: Any]?) async throws -> PageCapHTTPAnswer {
        let request = try makeRequest(method, path, query: query, body: body)
        let (data, response) = try await perform(request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        return PageCapHTTPAnswer(status: status, body: data.isEmpty ? nil : try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]))
    }
}

/// The server's answer to one call: its status and its JSON body.
public struct PageCapHTTPAnswer {
    public var status: Int
    public var body: Any?
    public init(status: Int, body: Any?) {
        self.status = status
        self.body = body
    }
}

public struct PageCapRead: Equatable, Sendable {
    public var name: String
    public var label: String
}

public struct PageCapApproval: Equatable, Identifiable, Sendable {
    public var id: Int
    public var name: String
    public var label: String
    public var at: Date
}

public struct PageCapLink: Equatable, Identifiable {
    public var id: Int
    public var url: URL
    public var host: String
    public var rest: String
    public var short: String
    public var cut: Bool
    /// "Always allow this site" can be offered: the server answered the question.
    public var always: Bool
    public var origin: String?
    public var at: Date
}

public struct PageCapState: Equatable {
    public var loaded = false
    public var caps: PageCapabilities?
    public var reads: [PageCapRead] = []
    public var approvals: [PageCapApproval] = []
    public var links: [PageCapLink] = []
    public init() {}
}

public enum PageCapApprovalChoice: String, Sendable { case once, always, decline }
public enum PageCapLinkChoice: Sendable { case open, always, cancel }

@MainActor
public final class PageCapabilityBroker: ObservableObject {
    public struct Deps {
        /// The server with this phone's session: method, path, query, JSON
        /// body. Throws only when the server could not be reached.
        public var api: (String, String, [URLQueryItem], [String: Any]?) async throws -> PageCapHTTPAnswer
        /// A message to the page's frame.
        public var post: ([String: Any]) -> Void
        public var openURL: (URL) -> Void
        /// Open a bot's chat or one of its conversations; false: not here.
        public var openRef: (String, String?) -> Bool
        /// Hand a file to the reader.
        public var saveFile: (String, String, Data) -> Void
        public var now: () -> Date

        public init(
            api: @escaping (String, String, [URLQueryItem], [String: Any]?) async throws -> PageCapHTTPAnswer,
            post: @escaping ([String: Any]) -> Void,
            openURL: @escaping (URL) -> Void,
            openRef: @escaping (String, String?) -> Bool,
            saveFile: @escaping (String, String, Data) -> Void,
            now: @escaping () -> Date = Date.init
        ) {
            self.api = api
            self.post = post
            self.openURL = openURL
            self.openRef = openRef
            self.saveFile = saveFile
            self.now = now
        }
    }

    @Published public private(set) var state = PageCapState()

    private let pageId: String
    private let version: Int?
    private let lang: String
    private let deps: Deps
    private var started: Task<Void, Never>?
    private var receivedData = false
    private var links = Set<String>()
    private var refs = Set<String>()
    private var readNames: [String] = []
    private var lastEvent: [String: Date] = [:]
    private var lastOpen: (url: URL, at: Date)?
    private var seq = 0
    private var waiting: [Int: CheckedContinuation<PageCapApprovalChoice, Never>] = [:]
    private var early: [Int: PageCapApprovalChoice] = [:]
    private var asking: [String: Task<PageCapApprovalChoice, Never>] = [:]
    private static let setMax = 2_000

    public init(pageId: String, version: Int?, lang: String, deps: Deps) {
        self.pageId = pageId
        self.version = version
        self.lang = lang == "fr" ? "fr" : "en"
        self.deps = deps
    }

    private var french: Bool { lang == "fr" }

    // MARK: Messages

    /// The broker listens: it says so (and that it says taken for each
    /// call it knows), then asks what this version declares.
    public func start() {
        post(["type": PageCapMessage.ready, "taken": true])
        if started == nil { started = Task { await load() } }
    }

    /// A message the page's frame posted (the isolated script checked it came
    /// from that frame). `fromClick`: the reader's tap was live when it came.
    @discardableResult
    public func receive(_ data: Any?, fromClick: Bool) async -> Bool {
        if PageCapRules.isHello(data) {
            post(["type": PageCapMessage.ready, "taken": true])
            return true
        }
        guard let request = PageCapRules.request(data) else {
            // a call this app does not know (a later capability) is
            // answered, never dropped, so the page does not wait in silence
            guard let unknown = PageCapRules.callId(data) else { return false }
            answer(unknown, .failed("unavailable", message: french ? "Cette app ne peut pas encore faire ça. Mets l'app à jour pour t'en servir." : "This app cannot do this yet. Update the app to use it.", reason: nil))
            return true
        }
        let id = request.id
        // known: the page's bounded wait stops; the answer may wait on the reader
        post(["type": PageCapMessage.taken, "id": id])
        if started == nil { start() }
        await started?.value
        let source = request.cap == .dataRead ? request.args["name"] : nil
        var sourceName: String?
        if request.cap == .dataRead {
            guard let name = PageCapRules.validSource(source) else {
                answer(id, .failed("bad_request", message: "A data source name is needed.", reason: nil))
                return true
            }
            sourceName = name
        }
        if let caps = state.caps, !caps.grants(request.cap, source: sourceName) {
            let what = sourceName.map { "the data source \($0)" } ?? request.cap.rawValue
            answer(id, .failed("not_declared", message: "This page does not declare \(what).", reason: nil))
            return true
        }
        switch request.cap {
        case .dataRead:
            guard let filter = PageCapRules.dataParams(request.args["params"]) else {
                answer(id, .failed("bad_request", message: "These data parameters are not valid.", reason: nil))
                return true
            }
            answer(id, await readData(sourceName!, fresh: filter.fresh, params: filter.params))
        case .viewerGet:
            answer(id, await viewer())
        case .filesDownload where state.caps != nil:
            answer(id, download(request, fromClick: fromClick))
        case .open where state.caps != nil:
            answer(id, await open(request.args["ref"]))
        default:
            answer(id, .failed("unavailable", message: "This page's capabilities could not be read.", reason: nil))
        }
        return true
    }

    /// A link the page asked to open through the wrapper's own bridge: true
    /// when this took it. A frame that received data asks the reader first
    /// for an address no data answer named; any other opens at once.
    @discardableResult
    public func receiveOpen(_ data: Any?) async -> Bool {
        guard let url = PageCapRules.openMessage(data) else { return false }
        // the frame posts each link to its parent and to the top window,
        // which are the same wrapper here: the copy that follows is the same tap
        let at = deps.now()
        if let last = lastOpen, last.url == url, at.timeIntervalSince(last.at) < 1 { return true }
        lastOpen = (url, at)
        if opensDirectly(url) {
            deps.openURL(url)
        } else {
            _ = await askLink(url)
        }
        return true
    }

    /// The app came back to the screen: the page reads again what it read.
    public func refocused() {
        let at = deps.now()
        for name in readNames {
            if let last = lastEvent[name], at.timeIntervalSince(last) < 1 { continue }
            lastEvent[name] = at
            post(["type": PageCapMessage.event, "cap": "data", "name": name])
        }
    }

    /// The reader's answer to an Ask first card. Allow and Always allow are
    /// ignored for PageCapLimits.cardGuard after it appeared (false).
    @discardableResult
    public func resolveApproval(_ id: Int, _ choice: PageCapApprovalChoice) -> Bool {
        guard let entry = state.approvals.first(where: { $0.id == id }) else { return false }
        if choice != .decline, deps.now().timeIntervalSince(entry.at) < PageCapLimits.cardGuard { return false }
        state.approvals.removeAll { $0.id == id }
        asking[entry.name] = nil
        if let waiter = waiting.removeValue(forKey: id) {
            waiter.resume(returning: choice)
        } else {
            early[id] = choice
        }
        return true
    }

    /// The same for a link card: Open and Always allow this site wait, Cancel never does.
    @discardableResult
    public func resolveLink(_ id: Int, _ choice: PageCapLinkChoice) -> Bool {
        guard let entry = state.links.first(where: { $0.id == id }) else { return false }
        if choice != .cancel, deps.now().timeIntervalSince(entry.at) < PageCapLimits.cardGuard { return false }
        state.links.removeAll { $0.id == id }
        if choice == .cancel { return true }
        if choice == .always, entry.always, let origin = entry.origin {
            // kept on the server for this reader, page and origin; this link opens either way
            let api = deps.api
            let path = linkPath
            Task { _ = try? await api("POST", path, [], ["origin": origin, "answer": "always"]) }
        }
        deps.openURL(entry.url)
        return true
    }

    // MARK: Calls

    private func post(_ message: [String: Any]) {
        var out = message
        out["v"] = 1
        deps.post(out)
    }

    private func answer(_ id: Int, _ outcome: PageCapOutcome) {
        var out = outcome.message
        out["type"] = PageCapMessage.result
        out["id"] = id
        post(out)
    }

    private var base: String { "/api/pages/\(pageId)" }
    private var linkPath: String { "\(base)/link-approvals" }

    private func query(_ extra: [String: String] = [:]) -> [URLQueryItem] {
        var items = extra.keys.sorted().map { URLQueryItem(name: $0, value: extra[$0]) }
        if let version { items.append(URLQueryItem(name: "version", value: String(version))) }
        items.append(URLQueryItem(name: "lang", value: lang))
        return items
    }

    private func load() async {
        guard let answer = try? await deps.api("GET", "\(base)/capabilities", query(), nil), (200...299).contains(answer.status) else {
            state.loaded = true
            state.caps = nil
            return
        }
        let body = answer.body as? [String: Any]
        let reads = ((body?["reads"] as? [Any]) ?? []).compactMap { entry -> PageCapRead? in
            guard let record = entry as? [String: Any], let name = record["name"] as? String, let label = record["label"] as? String else { return nil }
            return PageCapRead(name: name, label: String(label.prefix(120)))
        }
        state.caps = PageCapabilities.parse(body?["capabilities"])
        state.reads = Array(reads.prefix(20))
        state.loaded = true
    }

    private func readData(_ name: String, fresh: Bool, params: [String: String], asked: Bool = false) async -> PageCapOutcome {
        var extra = params
        if fresh { extra["fresh"] = "1" }
        let answer: PageCapHTTPAnswer
        do {
            answer = try await deps.api("GET", "\(base)/data/\(name)", query(extra), nil)
        } catch {
            return .failed("unavailable", message: nil, reason: nil)
        }
        let body = answer.body as? [String: Any]
        if (200...299).contains(answer.status) {
            receivedData = true
            if !readNames.contains(name) { readNames.append(name) }
            // the exits the source named, as the server sent them: nothing is computed here
            add(body?["links"], to: &links)
            add(body?["refs"], to: &refs)
            return .value(PageCapJSON(body?["value"]))
        }
        let failure = PageCapRules.failure(status: answer.status, body: body)
        guard case let .failed(error, _, _) = failure, error == "ask_first", !asked,
              let approvalId = body?["approvalId"] as? String,
              approvalId.range(of: #"^[\w-]{1,120}$"#, options: .regularExpression) != nil else { return failure }
        // the organization asks first: the card, outside the page; the
        // reader's own answer goes to the server, which records it, and only
        // then is the data read again
        let choice = await askFirst(name)
        do {
            let sent = try await deps.api("POST", "\(base)/data-approvals/\(approvalId)", [URLQueryItem(name: "lang", value: lang)], ["answer": choice == .decline ? "deny" : choice.rawValue])
            if !(200...299).contains(sent.status) { return PageCapRules.failure(status: sent.status, body: sent.body) }
        } catch {
            return .failed("unavailable", message: nil, reason: nil)
        }
        if choice == .decline {
            return .failed("denied", message: french ? "Tu as refusé cette lecture." : "You declined this read.", reason: "declined")
        }
        return await readData(name, fresh: fresh, params: params, asked: true)
    }

    private func askFirst(_ name: String) async -> PageCapApprovalChoice {
        if let open = asking[name] { return await open.value }
        seq += 1
        let id = seq
        let label = state.reads.first { $0.name == name }?.label ?? name
        state.approvals.append(PageCapApproval(id: id, name: name, label: label, at: deps.now()))
        let task = Task { @MainActor [weak self] () -> PageCapApprovalChoice in
            guard let self else { return .decline }
            if let choice = self.early.removeValue(forKey: id) { return choice }
            return await withCheckedContinuation { continuation in
                if let choice = self.early.removeValue(forKey: id) {
                    continuation.resume(returning: choice)
                } else {
                    self.waiting[id] = continuation
                }
            }
        }
        asking[name] = task
        return await task.value
    }

    private func viewer() async -> PageCapOutcome {
        do {
            let answer = try await deps.api("GET", "\(base)/viewer", query(), nil)
            guard (200...299).contains(answer.status) else { return PageCapRules.failure(status: answer.status, body: answer.body) }
            // the reader's name is personal data too: a link opens only with a question from now on
            receivedData = true
            return .value(PageCapJSON(answer.body))
        } catch {
            return .failed("unavailable", message: nil, reason: nil)
        }
    }

    private func open(_ value: Any?) async -> PageCapOutcome {
        let ref = value as? String ?? ""
        if let target = PageCapRules.openRef(ref) {
            // only a reference a data answer held, never one the page made up
            guard refs.contains(ref) else { return .failed("not_found", message: "Unknown reference.", reason: nil) }
            return deps.openRef(target.botId, target.threadId)
                ? .value(PageCapJSON(true))
                : .failed("unavailable", message: "This cannot be opened here.", reason: nil)
        }
        guard let url = PageCapRules.openURL(ref) else {
            return .failed("bad_request", message: "Not an address this page may open.", reason: nil)
        }
        if opensDirectly(url) {
            deps.openURL(url)
            return .value(PageCapJSON(true))
        }
        return .value(PageCapJSON(await askLink(url)))
    }

    private func opensDirectly(_ url: URL) -> Bool {
        !receivedData || links.contains(url.absoluteString)
    }

    /// A link no data answer named: opens at once when the reader allowed
    /// this site for this page, else shows its card. True when it opened.
    private func askLink(_ url: URL) async -> Bool {
        if state.links.contains(where: { $0.url == url }) { return false }
        let origin = PageCapRules.origin(url)
        var always = false
        if let origin {
            if let known = try? await deps.api("GET", linkPath, [URLQueryItem(name: "origin", value: origin)], nil),
               (200...299).contains(known.status), let allowed = (known.body as? [String: Any])?["allowed"] as? Bool {
                if allowed {
                    deps.openURL(url)
                    return true
                }
                always = true
            }
        }
        seq += 1
        let parts = PageCapRules.splitAddress(url)
        state.links.append(PageCapLink(id: seq, url: url, host: parts.host, rest: parts.rest, short: parts.short, cut: parts.cut, always: always, origin: origin, at: deps.now()))
        return false
    }

    private func download(_ request: PageCapRequest, fromClick: Bool) -> PageCapOutcome {
        guard fromClick else { return .failed("bad_request", message: "A download starts from a click.", reason: nil) }
        guard let mime = request.args["mime"] as? String, pageCapFileMimes.contains(mime) else {
            return .failed("bad_request", message: "This file type is not allowed.", reason: nil)
        }
        guard let name = PageCapRules.fileName(request.args["name"]) else {
            return .failed("bad_request", message: "This file name is not allowed.", reason: nil)
        }
        switch PageCapRules.fileData(request.args["data"]) {
        case let .failure(failure):
            return .failed(failure.rawValue, message: failure == .tooLarge ? "This file is too large." : "This file data is not valid.", reason: nil)
        case let .success(bytes):
            deps.saveFile(name, mime, bytes)
            return .value(PageCapJSON(true))
        }
    }

    private func add(_ values: Any?, to set: inout Set<String>) {
        for case let value as String in (values as? [Any]) ?? [] {
            if set.count >= Self.setMax { return }
            set.insert(value)
        }
    }
}

// MARK: - The wrapper's side in the web view

/// The script the page web view runs in an isolated world of its main frame
/// (the server's preview wrapper): the page's scripts never see it. It hands
/// the broker the capability calls, the hello and the open-link messages of
/// the wrapper's own page frame only (that very window, with the sandbox's
/// opaque origin), as JSON with whether the reader's tap was live; and it
/// posts the broker's answers to that frame (`__sagaxCapPost`).
public enum PageCapBridge {
    public static let world = "sagax-page-caps"
    public static let handler = "sagaxPageCaps"

    public static let script = """
    (function(){"use strict";
    var h=window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.\(handler);if(!h)return;
    var T={"\(PageCapMessage.call)":1,"\(PageCapMessage.hello)":1,"\(PageCapMessage.open)":1};
    function frame(){var f=document.querySelector("iframe");return f&&f.contentWindow||null}
    window.addEventListener("message",function(e){try{var f=frame();if(!f||e.source!==f||e.origin!=="null")return;var d=e.data;
    if(!d||typeof d!=="object"||T[d.type]!==1)return;var a=false;
    try{a=(e.userActivation&&e.userActivation.isActive===true)||(navigator.userActivation&&navigator.userActivation.isActive===true)}catch(x){}
    h.postMessage({m:JSON.stringify(d),a:a===true})}catch(x){}});
    window.__sagaxCapPost=function(m){var f=frame();if(f)try{f.postMessage(m,"*")}catch(x){}};
    })();
    """

    /// What the isolated script handed over: the frame's message and whether
    /// the reader's tap was live. Nil for any other shape.
    public static func parse(_ body: Any) -> (message: Any, fromClick: Bool)? {
        guard let record = body as? [String: Any], let text = record["m"] as? String, let data = text.data(using: .utf8),
              let message = try? JSONSerialization.jsonObject(with: data) else { return nil }
        return (message, PageCapRules.isTrue(record["a"]))
    }

    /// The JavaScript that posts one broker message to the page's frame.
    public static func postSource(_ message: [String: Any]) -> String? {
        guard JSONSerialization.isValidJSONObject(message),
              let data = try? JSONSerialization.data(withJSONObject: message),
              let json = String(data: data, encoding: .utf8) else { return nil }
        return "window.__sagaxCapPost(\(json));void 0"
    }
}
