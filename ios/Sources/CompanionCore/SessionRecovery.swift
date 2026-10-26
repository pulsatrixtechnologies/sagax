import Foundation

// Staying signed in (JC, 2026-10-20): a person leaves Sagax only when the
// server says the session is over (revoked, expired, Pulsatrix sign-in ended,
// account disabled) or after 30 days of real inactivity, which the server
// enforces. Never because of a deploy or restart, an app update, a transient
// error or a sensitive action.
//
// Before this file, any single 401 on any request put the app on the
// "This device was unpaired" screen, without looking at what the server
// said and without reading the Keychain again; its only button forgot the
// connection (DELETE /api/push/devices with the refused bearer, then the
// local token erased). Everything below is pure and testable: Session feeds
// it the Keychain and the network as closures.

// MARK: - What the server said

/// The 401 `code` values that mean the session is definitively over. Any
/// other 401 (no code, a plain message, `unauthorized`) is retried first:
/// during a server restart or with a stale copy of the token it is not final.
public enum SessionEndCodes {
    public static let definitive: Set<String> = [
        "session_revoked",
        "session_expired",
        "idp_session_ended",
        "principal_disabled",
    ]

    public static func isDefinitive(_ code: String?) -> Bool {
        guard let code else { return false }
        return definitive.contains(code)
    }
}

/// Why the app shows sign-in again, beyond the server's own codes.
public enum SessionEndReason {
    /// The address now answers as another server (its data was recreated).
    public static let serverChanged = "server_changed"
}

/// One look at whether a bearer still opens a session.
public enum AuthProbeResult: Equatable, Sendable {
    /// The bearer opens a session.
    case valid
    /// 401, with the server's `code` when it sent one.
    case unauthorized(code: String?)
    /// The server is there but busy: 503 `idp_recheck_pending` after a
    /// restart, a gateway error while it deploys, 429. Never a sign-out.
    case retryLater(seconds: Double?)
    /// No answer at all (offline, restarting), or one that is not the
    /// session's (a captive portal page, a 400). Never a sign-out.
    case unreachable
    /// The bearer reached the server but the route was refused (403): not a
    /// sign-out for the token in use, never enough to adopt another token.
    case refused
}

extension CompanionClient {
    /// `GET /api/auth/session` with this client's bearer, falling back to the
    /// sidecar's `GET /api/companion/endpoints` where the first does not
    /// exist (a desktop computer's companion). Reads the body's `code`, which
    /// `APIError` does not keep.
    public func probeAuthorization() async -> AuthProbeResult {
        var sawUnsupported = false
        for path in ["/api/auth/session", "/api/companion/endpoints"] {
            guard let request = try? makeRequest("GET", path) else { return .unreachable }
            let data: Data
            let response: URLResponse
            do {
                (data, response) = try await perform(request)
            } catch {
                return .unreachable
            }
            guard let http = response as? HTTPURLResponse else { return .unreachable }
            switch http.statusCode {
            case 200...299:
                // Only the session's own answer counts: a portal or proxy
                // page that answers 200 must not make a dead token "work".
                let decoder = JSONDecoder()
                let isSession = path == "/api/auth/session"
                    ? (try? decoder.decode(AuthSession.self, from: data)) != nil
                    : (try? decoder.decode(CompanionAnswer.self, from: data)) != nil
                return isSession ? .valid : .unreachable
            case 401:
                return .unauthorized(code: Self.refusalCode(in: data))
            case 404, 405:
                sawUnsupported = true
                continue
            case 429, 500...599:
                let retry = http.value(forHTTPHeaderField: "Retry-After").flatMap(Double.init)
                return .retryLater(seconds: retry)
            case 403:
                return .refused
            default:
                return .unreachable
            }
        }
        // Neither route exists here: the 401 that brought us here stands,
        // without a definitive code.
        return sawUnsupported ? .unauthorized(code: nil) : .unreachable
    }

    /// The companion's endpoints answer, as far as telling it from a page.
    private struct CompanionAnswer: Decodable { let serverName: String }

    /// The `code` of a JSON error body, if any.
    public static func refusalCode(in data: Data) -> String? {
        struct Body: Decodable { let code: String? }
        guard let code = try? JSONDecoder().decode(Body.self, from: data).code,
              !code.isEmpty else { return nil }
        return code
    }
}

// MARK: - Where the token lives

/// The two Keychain places a pairing token can be in: the shared group that
/// the app and its extensions read (the single source of truth), and the
/// app-private group older builds wrote before the extensions existed.
public enum CredentialSlot: Sendable, CaseIterable {
    case shared
    case legacy
}

/// The Keychain, seen through what the recovery needs. `read` returns nil
/// only when there is no item; a locked or misconfigured Keychain throws.
public protocol CredentialSlots {
    func read(_ slot: CredentialSlot, id: String) throws -> String?
    /// Add or update in place (never delete-then-add).
    func write(_ token: String, to slot: CredentialSlot, id: String) throws
    func delete(_ slot: CredentialSlot, id: String)
}

public enum CompanionCredentials {
    /// The token for `id`: the shared item, else a legacy item from an older
    /// build, moved into the shared group (the legacy copy is deleted only
    /// after the shared one is written). An app update never loses it.
    public static func current(id: String, in slots: CredentialSlots) throws -> String? {
        if let shared = try slots.read(.shared, id: id) { return shared }
        guard let legacy = try slots.read(.legacy, id: id) else { return nil }
        try slots.write(legacy, to: .shared, id: id)
        slots.delete(.legacy, id: id)
        return legacy
    }

    /// Every distinct token this phone holds for these connection ids (the
    /// active one first, then other records of the same server), in both
    /// slots, except `excluding`. A slot that cannot be read is skipped:
    /// candidates are a second chance, never a reason to fail.
    public static func candidates(
        ids: [String],
        excluding current: String?,
        in slots: CredentialSlots
    ) -> [CredentialCandidate] {
        var seen = Set<String>()
        if let current { seen.insert(current) }
        var found: [CredentialCandidate] = []
        for id in ids {
            for slot in CredentialSlot.allCases {
                guard let token = (try? slots.read(slot, id: id)) ?? nil,
                      !token.isEmpty,
                      seen.insert(token).inserted
                else { continue }
                found.append(CredentialCandidate(token: token, connectionID: id, slot: slot))
            }
        }
        return found
    }

    /// Make `token` the one copy for `id`: written to the shared group (add
    /// or update in place, so a failure leaves the previous item), then the
    /// legacy copy and every duplicate record's copies removed. Throws only
    /// when the shared write fails, in which case nothing is deleted.
    public static func commit(
        _ token: String,
        for id: String,
        removingDuplicates duplicates: [String] = [],
        in slots: CredentialSlots
    ) throws {
        try slots.write(token, to: .shared, id: id)
        slots.delete(.legacy, id: id)
        for duplicate in duplicates where duplicate != id {
            slots.delete(.shared, id: duplicate)
            slots.delete(.legacy, id: duplicate)
        }
    }
}

public struct CredentialCandidate: Equatable, Sendable {
    public let token: String
    public let connectionID: String
    public let slot: CredentialSlot

    public init(token: String, connectionID: String, slot: CredentialSlot) {
        self.token = token
        self.connectionID = connectionID
        self.slot = slot
    }
}

extension CompanionConnectionRegistry {
    /// Records whose token may be tried for `connection` after a 401: the
    /// same server for certain (a shared route and the same, known, server
    /// environment id). A desktop computer's records are never mixed: two
    /// computers can have used the same LAN address. One server record per
    /// server is the rule (re-pairing replaces it), so these are leftovers
    /// of the same account, never another person's.
    public func credentialSiblings(of connection: Connection) -> [Connection] {
        guard let environment = connection.serverEnvironmentId else { return [] }
        return duplicates(of: connection).filter { $0.serverEnvironmentId == environment }
    }

    /// Other saved records for the same server as `connection`: they share
    /// a route (the exact origin a bearer is sent to), and their server
    /// environment ids, when both are known, agree. The environment id alone
    /// is never enough: it is public, so another host could claim it, and a
    /// token must only ever travel to an origin it was issued for.
    public func duplicates(of connection: Connection) -> [Connection] {
        let routes = Set(connection.orderedEndpoints.map(\.url))
        guard !routes.isEmpty else { return [] }
        return connections.filter { saved in
            guard saved.id != connection.id,
                  !routes.isDisjoint(with: saved.orderedEndpoints.map(\.url))
            else { return false }
            if let environment = connection.serverEnvironmentId,
               let other = saved.serverEnvironmentId {
                return environment == other
            }
            return true
        }
    }
}

// MARK: - What to do after a 401

public enum UnauthorizedRecovery {
    public enum Outcome: Equatable, Sendable {
        /// The session works: with the current token again (nil), or with a
        /// fresher copy found in the Keychain.
        case recovered(CredentialCandidate?)
        /// The server said the session is over (its `code`), or kept refusing
        /// every token this phone holds (nil code).
        case signedOut(code: String?)
        /// No decision: the server is restarting or unreachable. Stay signed
        /// in and keep retrying the usual way.
        case undecided
    }

    public struct Policy: Equatable, Sendable {
        /// Pause before each round after the first. The total (~45 s) covers
        /// a server restart, during which a 401 is not trusted.
        public var delays: [Double]
        /// Rounds in which the current token is refused (no definitive code,
        /// no fresher token working) before the app shows sign-in.
        public var refusalsBeforeSignOut: Int

        public init(delays: [Double] = [2, 4, 8, 15, 15], refusalsBeforeSignOut: Int = 5) {
            self.delays = delays
            self.refusalsBeforeSignOut = max(1, refusalsBeforeSignOut)
        }
    }

    /// Decide what a 401 means: never a sign-out on a 401 alone.
    ///
    /// Each round: probe the current token. A definitive `code` signs out at
    /// once. A bearer the server does not know: try every other copy this
    /// phone holds for the same server; one that works wins. Transient
    /// answers (503, gateway, offline, 403) never count.
    public static func run(
        current: String,
        candidates: @escaping () -> [CredentialCandidate],
        probe: @escaping (String) async -> AuthProbeResult,
        sleep: @escaping (Double) async throws -> Void,
        policy: Policy = Policy()
    ) async -> Outcome {
        var refusals = 0
        let rounds = policy.delays.count + 1
        for round in 0..<rounds {
            if round > 0 {
                do { try await sleep(policy.delays[round - 1]) } catch { return .undecided }
            }
            if Task.isCancelled { return .undecided }

            let answer = await probe(current)
            switch answer {
            case .valid:
                return .recovered(nil)
            case let .unauthorized(code) where SessionEndCodes.isDefinitive(code):
                // The server ended this session: that is final. No other
                // copy may bring it back (an older token of a session the
                // person or an administrator ended elsewhere included).
                return .signedOut(code: code)
            case .unauthorized:
                // Unknown bearer: maybe a stale copy. Try the others.
                for candidate in candidates() where candidate.token != current {
                    if Task.isCancelled { return .undecided }
                    if await probe(candidate.token) == .valid { return .recovered(candidate) }
                }
                refusals += 1
                if refusals >= policy.refusalsBeforeSignOut { return .signedOut(code: nil) }
            case .retryLater, .unreachable, .refused:
                continue
            }
        }
        return .undecided
    }
}
