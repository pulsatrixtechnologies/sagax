import Foundation
import XCTest
@testable import CompanionCore

// JC, 2026-10-20: a person is signed out only when the session is revoked,
// the account disabled, or after 30 days without use. Never because of a
// deploy, an app update, a transient error, a stale copy of the token or a
// sensitive action. Prod, 2026-10-20 11:41 UTC: one burst of 401s put the
// iPhone on "This device was unpaired", and its only button forgot the
// connection (DELETE /api/push/devices) while a live token was on the phone.

/// The two Keychain groups, in memory.
private final class MemorySlots: CredentialSlots {
    var items: [CredentialSlot: [String: String]] = [.shared: [:], .legacy: [:]]
    var failSharedWrites = false
    var lockedReads = false

    func read(_ slot: CredentialSlot, id: String) throws -> String? {
        if lockedReads { throw NSError(domain: "locked", code: -25308) }
        return items[slot]?[id]
    }

    func write(_ token: String, to slot: CredentialSlot, id: String) throws {
        if slot == .shared, failSharedWrites { throw NSError(domain: "denied", code: -34018) }
        items[slot, default: [:]][id] = token
    }

    func delete(_ slot: CredentialSlot, id: String) {
        items[slot]?[id] = nil
    }
}

/// A server whose answers are scripted per bearer and per call.
private final class ProbeScript: @unchecked Sendable {
    private let lock = NSLock()
    private var answers: [String: [AuthProbeResult]]
    private(set) var probed: [String] = []
    private(set) var slept: [Double] = []

    init(_ answers: [String: [AuthProbeResult]]) { self.answers = answers }

    func probe(_ token: String) -> AuthProbeResult {
        lock.lock(); defer { lock.unlock() }
        probed.append(token)
        guard var queue = answers[token], !queue.isEmpty else { return .unauthorized(code: nil) }
        let next = queue.count > 1 ? queue.removeFirst() : queue[0]
        answers[token] = queue
        return next
    }

    func sleep(_ seconds: Double) {
        lock.lock(); defer { lock.unlock() }
        slept.append(seconds)
    }
}

private func recover(
    current: String,
    candidates: [CredentialCandidate] = [],
    script: ProbeScript
) async -> UnauthorizedRecovery.Outcome {
    await UnauthorizedRecovery.run(
        current: current,
        candidates: { candidates },
        probe: { script.probe($0) },
        sleep: { script.sleep($0) }
    )
}

private final class AuthStub: URLProtocol {
    static let lock = NSLock()
    static var handler: (URLRequest) -> (Int, [String: String], Data) = { _ in (500, [:], Data()) }
    static var seen: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock()
        Self.seen.append(request)
        let (status, headers, body) = Self.handler(request)
        Self.lock.unlock()
        var fields = headers
        fields["Content-Type"] = "application/json"
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: fields)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}

    static func reset(_ handler: @escaping (URLRequest) -> (Int, [String: String], Data)) {
        lock.lock(); seen = []; self.handler = handler; lock.unlock()
    }

    static var requests: [URLRequest] { lock.lock(); defer { lock.unlock() }; return seen }
}

final class StayingSignedInTests: XCTestCase {
    private let server = Connection(
        id: "org",
        name: "GOX",
        host: "bot.example.org",
        port: 443,
        activeEndpoint: CompanionEndpoint(url: "https://bot.example.org", kind: .hosted, priority: 0)!,
        endpoints: [CompanionEndpoint(url: "https://bot.example.org", kind: .hosted, priority: 0)!],
        serverEnvironmentId: "env-1",
        serverScopes: ["client"]
    )

    private func client(token: String) -> CompanionClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AuthStub.self]
        return CompanionClient(connection: server, token: token, session: URLSession(configuration: configuration))
    }

    // MARK: Mise à jour de l'app

    func testAppUpdateKeepsTheTokenAndMovesItToTheSharedGroup() throws {
        // An older build wrote the token in the app's own group only.
        let slots = MemorySlots()
        slots.items[.legacy] = ["org": "sgx_sess_old_build"]
        XCTAssertEqual(try CompanionCredentials.current(id: "org", in: slots), "sgx_sess_old_build")
        XCTAssertEqual(slots.items[.shared]?["org"], "sgx_sess_old_build", "the extensions read the shared group")
        XCTAssertNil(slots.items[.legacy]?["org"], "one copy only")
        // The next launch of the new build reads the same token.
        XCTAssertEqual(try CompanionCredentials.current(id: "org", in: slots), "sgx_sess_old_build")
    }

    func testAppUpdateNeverLosesTheTokenWhenTheSharedWriteFails() {
        let slots = MemorySlots()
        slots.items[.legacy] = ["org": "sgx_sess_old_build"]
        slots.failSharedWrites = true
        XCTAssertThrowsError(try CompanionCredentials.current(id: "org", in: slots))
        XCTAssertEqual(slots.items[.legacy]?["org"], "sgx_sess_old_build", "kept for the next try")
    }

    func testAppUpdateKeepsTheSavedServerRecord() throws {
        // The single-computer record of an older build becomes the registry.
        let legacy = try JSONEncoder().encode(server)
        let restored = CompanionConnectionRegistryMigration.restore(registryData: nil, legacyConnectionData: legacy)
        XCTAssertTrue(restored.migratedLegacyConnection)
        XCTAssertEqual(restored.registry.activeConnection?.id, "org")
        XCTAssertEqual(restored.registry.activeConnection?.serverEnvironmentId, "env-1")
    }

    func testALockedKeychainIsNeverReadAsNoToken() {
        let slots = MemorySlots()
        slots.items[.shared] = ["org": "sgx_sess_live"]
        slots.lockedReads = true
        XCTAssertThrowsError(try CompanionCredentials.current(id: "org", in: slots))
        XCTAssertEqual(CompanionCredentials.candidates(ids: ["org"], excluding: nil, in: slots), [])
    }

    // MARK: Redéploiement Sagax

    func testRedeployBurstThenRecoveryNeverSignsOut() async {
        // Offline while the container restarts, 503 idp_recheck_pending while
        // it confirms the sign-in, one stray 401, then the session again.
        let script = ProbeScript(["live": [
            .unreachable,
            .retryLater(seconds: 5),
            .unauthorized(code: nil),
            .valid,
        ]])
        let outcome = await recover(current: "live", script: script)
        XCTAssertEqual(outcome, .recovered(nil))
        XCTAssertEqual(script.slept, [2, 4, 8], "silent retries with backoff")
    }

    func testAServerThatStaysDownLeavesThePersonSignedIn() async {
        let script = ProbeScript(["live": [.retryLater(seconds: 5)]])
        let outcome = await recover(current: "live", script: script)
        XCTAssertEqual(outcome, .undecided, "never a sign-out while the server cannot answer")
        XCTAssertEqual(script.slept, [2, 4, 8, 15, 15])
    }

    func testTheProbeReadsTheServersAnswers() async throws {
        AuthStub.reset { request in
            switch request.url?.path {
            case "/api/auth/session":
                return (503, ["Retry-After": "5"], Data(#"{"error":"Sagax restarted and is confirming your Pulsatrix sign-in. Try again in a moment.","code":"idp_recheck_pending"}"#.utf8))
            default:
                return (404, [:], Data())
            }
        }
        let busy = await client(token: "live").probeAuthorization()
        XCTAssertEqual(busy, .retryLater(seconds: 5))
        XCTAssertEqual(AuthStub.requests.first?.value(forHTTPHeaderField: "Authorization"), "Bearer live")

        AuthStub.reset { _ in (401, [:], Data(#"{"error":"Your Pulsatrix sign-in has ended. Sign in again.","code":"idp_session_ended"}"#.utf8)) }
        let ended = await client(token: "live").probeAuthorization()
        XCTAssertEqual(ended, .unauthorized(code: "idp_session_ended"))

        AuthStub.reset { _ in (401, [:], Data(#"{"error":"unauthorized"}"#.utf8)) }
        let plain = await client(token: "live").probeAuthorization()
        XCTAssertEqual(plain, .unauthorized(code: nil), "a plain message is not definitive")

        // A desktop companion has no /api/auth/session: its own route answers.
        AuthStub.reset { request in
            request.url?.path == "/api/companion/endpoints" ? (200, [:], Data(#"{"serverName":"Mac","endpoints":[]}"#.utf8)) : (404, [:], Data())
        }
        let companion = await client(token: "live").probeAuthorization()
        XCTAssertEqual(companion, .valid)

        // A captive portal or proxy page answering 200 is not the session.
        AuthStub.reset { _ in (200, [:], Data("<html>Wi-Fi login</html>".utf8)) }
        let portal = await client(token: "dead").probeAuthorization()
        XCTAssertEqual(portal, .unreachable)
    }

    // MARK: Jeton périmé dans un trousseau, frais dans l'autre

    func testStaleSharedFreshLegacyRecoversSilently() async throws {
        let slots = MemorySlots()
        slots.items[.shared] = ["org": "stale"]
        slots.items[.legacy] = ["org": "fresh"]
        let candidates = CompanionCredentials.candidates(ids: ["org"], excluding: "stale", in: slots)
        XCTAssertEqual(candidates, [CredentialCandidate(token: "fresh", connectionID: "org", slot: .legacy)])

        let script = ProbeScript(["stale": [.unauthorized(code: nil)], "fresh": [.valid]])
        let outcome = await recover(current: "stale", candidates: candidates, script: script)
        XCTAssertEqual(outcome, .recovered(candidates[0]))
        XCTAssertEqual(script.slept, [], "no wait, no sign-in screen")

        try CompanionCredentials.commit("fresh", for: "org", in: slots)
        XCTAssertEqual(slots.items[.shared]?["org"], "fresh")
        XCTAssertNil(slots.items[.legacy]?["org"], "the stale copy cannot come back")
    }

    func testFreshTokenUnderADuplicateRecordOfTheSameServerIsAdopted() async throws {
        // 2026-10-19: an older record of the same server kept the dead token
        // while the 17:54 sign-in lived under another record.
        var older = server
        older.id = "org-older"
        var other = server
        other.id = "mac"
        other.serverEnvironmentId = nil
        other.activeEndpoint = CompanionEndpoint(url: "http://192.168.1.20:8811", kind: .lan, priority: 0)
        other.endpoints = [other.activeEndpoint!]
        let registry = CompanionConnectionRegistry(connections: [older, server, other], activeConnectionID: "org-older")
        XCTAssertEqual(registry.duplicates(of: older).map(\.id), ["org"], "same server, not the Mac")

        // Another host claiming the same (public) environment id is never a
        // duplicate: its token would travel to an origin it was not issued for.
        var impostor = server
        impostor.id = "impostor"
        impostor.activeEndpoint = CompanionEndpoint(url: "https://evil.example", kind: .hosted, priority: 0)
        impostor.endpoints = [impostor.activeEndpoint!]
        let mixed = CompanionConnectionRegistry(connections: [server, impostor])
        XCTAssertEqual(mixed.duplicates(of: impostor), [])
        XCTAssertEqual(mixed.duplicates(of: server), [])
        // Same origin, but the server's data was recreated: not the same.
        var recreated = server
        recreated.id = "recreated"
        recreated.serverEnvironmentId = "env-2"
        XCTAssertEqual(CompanionConnectionRegistry(connections: [server, recreated]).duplicates(of: recreated), [])

        let slots = MemorySlots()
        slots.items[.shared] = ["org-older": "dead", "org": "live", "mac": "mac-token"]
        let ids = ["org-older"] + registry.credentialSiblings(of: older).map(\.id)
        let candidates = CompanionCredentials.candidates(ids: ids, excluding: "dead", in: slots)
        XCTAssertEqual(candidates.map(\.token), ["live"], "never another computer's token")

        let script = ProbeScript(["dead": [.unauthorized(code: nil)], "live": [.valid]])
        let outcome = await recover(current: "dead", candidates: candidates, script: script)
        guard case let .recovered(found?) = outcome else { return XCTFail("expected a silent recovery, got \(outcome)") }
        XCTAssertEqual(found.connectionID, "org")

        try CompanionCredentials.commit(found.token, for: "org-older", removingDuplicates: [found.connectionID], in: slots)
        XCTAssertEqual(slots.items[.shared]?["org-older"], "live")
        XCTAssertNil(slots.items[.shared]?["org"])
        XCTAssertEqual(slots.items[.shared]?["mac"], "mac-token")
    }

    func testASignInLeavesOneCopyOfTheToken() throws {
        let slots = MemorySlots()
        slots.items[.shared] = ["org": "old", "org-older": "older"]
        slots.items[.legacy] = ["org": "oldest"]
        try CompanionCredentials.commit("new", for: "org", removingDuplicates: ["org-older"], in: slots)
        XCTAssertEqual(slots.items[.shared], ["org": "new"])
        XCTAssertEqual(slots.items[.legacy], [:])
    }

    func testAFailedSaveKeepsTheWorkingToken() {
        let slots = MemorySlots()
        slots.items[.shared] = ["org": "working"]
        slots.items[.legacy] = ["org": "older"]
        slots.failSharedWrites = true
        XCTAssertThrowsError(try CompanionCredentials.commit("new", for: "org", in: slots))
        XCTAssertEqual(slots.items[.shared]?["org"], "working")
        XCTAssertEqual(slots.items[.legacy]?["org"], "older", "nothing deleted when the write fails")
    }

    // MARK: Révocation -> déconnexion

    func testRevocationSignsOut() async {
        for code in ["session_revoked", "session_expired", "idp_session_ended", "principal_disabled"] {
            let script = ProbeScript(["live": [.unauthorized(code: code)]])
            let outcome = await recover(current: "live", script: script)
            XCTAssertEqual(outcome, .signedOut(code: code), code)
            XCTAssertEqual(script.slept, [], "a definitive answer needs no wait")
        }
    }

    func testARevokedSessionIsNeverBroughtBackByAnOlderCopy() async {
        // An older token whose session was never revoked must not undo a
        // sign-out done from another device or by an administrator.
        let older = CredentialCandidate(token: "older", connectionID: "org", slot: .legacy)
        let script = ProbeScript(["revoked": [.unauthorized(code: "session_revoked")], "older": [.valid]])
        let outcome = await recover(current: "revoked", candidates: [older], script: script)
        XCTAssertEqual(outcome, .signedOut(code: "session_revoked"))
        XCTAssertEqual(script.probed, ["revoked"], "the older copy is not even tried")
    }

    func testRepeatedRefusalsWithNoFresherTokenSignOutAfterTheRestartWindow() async {
        let script = ProbeScript(["dead": [.unauthorized(code: nil)]])
        let outcome = await recover(current: "dead", script: script)
        XCTAssertEqual(outcome, .signedOut(code: nil))
        XCTAssertEqual(script.slept, [2, 4, 8, 15], "about half a minute of silent retries first")
        XCTAssertEqual(script.probed.count, 5)
    }

    // MARK: Action sensible -> confirmation sans déconnexion

    func testSensitiveActionAsksToConfirmWithoutEndingTheSession() async throws {
        AuthStub.reset { request in
            switch (request.httpMethod, request.url?.path) {
            case ("DELETE", "/api/me"):
                return (409, [:], Data(#"{"error":"Sign in again with Pulsatrix first.","code":"reauth_required"}"#.utf8))
            case ("GET", "/api/auth/session"):
                return (200, [:], Data(#"{"kind":"session","scopes":["client"]}"#.utf8))
            default:
                return (404, [:], Data())
            }
        }
        let live = client(token: "live")
        let outcome = try await live.deleteAccount()
        guard case .reauthRequired = outcome else { return XCTFail("expected the confirmation, got \(outcome)") }
        // The session itself is untouched: still valid, nothing to recover.
        let probe = await live.probeAuthorization()
        XCTAssertEqual(probe, .valid)
        XCTAssertFalse(AuthStub.requests.contains { $0.httpMethod == "DELETE" && $0.url?.path == "/api/push/devices" })
    }

    func testAStepUpRefusalIsNotASignOut() async {
        // 403 step_up_required: the bearer reached the server; not a sign-out.
        AuthStub.reset { _ in (403, [:], Data(#"{"error":"Confirm with your security key.","code":"step_up_required"}"#.utf8)) }
        let probe = await client(token: "live").probeAuthorization()
        XCTAssertEqual(probe, .refused)
        let script = ProbeScript(["live": [.refused]])
        let outcome = await recover(current: "live", script: script)
        XCTAssertEqual(outcome, .undecided, "stays signed in")
    }

    func testOnlyCertainSiblingsLendTheirToken() {
        var older = server
        older.id = "org-older"
        var unknownEnvironment = server
        unknownEnvironment.id = "org-unknown"
        unknownEnvironment.serverEnvironmentId = nil
        let registry = CompanionConnectionRegistry(connections: [server, older, unknownEnvironment])
        XCTAssertEqual(registry.credentialSiblings(of: server).map(\.id), ["org-older"])
        // A desktop computer's records never lend tokens to each other.
        var mac = server
        mac.serverEnvironmentId = nil
        XCTAssertEqual(registry.credentialSiblings(of: mac), [])
    }
}
