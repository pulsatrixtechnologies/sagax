import Foundation

/// The connection notice at the top of the chat (#2013; desktop
/// src/lib/connection-notice.ts): the server is updating, the server cannot
/// be reached, the organization's Perspicax connector cannot be reached, and
/// "Reconnected" once a notice that showed clears. A pure state machine:
/// the app feeds it what it hears (the live stream, the health probe, the
/// connector status, the device's network, the setting, an X) with the
/// time, and asks `evaluate(now:)` what to show.
///
/// Rules:
/// - a server disconnect shorter than `blipMs` shows nothing;
/// - "updating" when a restart was announced within `announceWindowMs`
///   of the disconnect, or the health probe says the server drains or is in
///   maintenance; after `updatingMaxMs` of updating with no return, it is
///   "unreachable";
/// - the device offline adds nothing (the app has its own offline line);
/// - when a shown notice clears, "Reconnected" for `reconnectedMs`; a blip
///   that showed nothing clears silently;
/// - an X dismisses that occurrence (kind + since); a new one shows again.
public struct ConnectionNoticeMachine: Equatable, Sendable {
    public enum Kind: String, Equatable, Sendable {
        case updating
        case serverUnreachable
        case perspicaxUnreachable
        case reconnected
    }

    public struct Notice: Equatable, Sendable {
        public var kind: Kind
        /// What one occurrence is: its kind and when it started. An X
        /// dismisses this exact occurrence.
        public var occurrence: String

        public init(kind: Kind, occurrence: String) {
            self.kind = kind
            self.occurrence = occurrence
        }
    }

    /// What the health probe said while the stream was down.
    public enum Probe: Equatable, Sendable {
        /// 2xx: the server answers; the stream comes back on its own.
        case ok
        /// 503 with `shuttingDown`, or `x-sagax-maintenance`: a planned restart.
        case draining
        /// Anything else: no answer, a proxy's 502/503/504, another error.
        case failed
    }

    public static let blipMs: Double = 2_500
    public static let announceWindowMs: Double = 10 * 60_000
    public static let updatingMaxMs: Double = 5 * 60_000
    public static let reconnectedMs: Double = 3_000
    /// How often the app asks the health route while the stream is down.
    public static let probeEverySeconds: Double = 5

    public private(set) var enabled: Bool
    public private(set) var networkOffline = false
    /// When the live stream went down (ms), nil while it is up.
    public private(set) var disconnectedAt: Double?
    public private(set) var restartAnnouncedAt: Double?
    public private(set) var probe: Probe?
    /// When the probe first said the server drains, this outage.
    private var drainingSince: Double?
    /// Perspicax unreachable since (ms), nil while it is reachable or unknown.
    public private(set) var perspicaxDownSince: Double?
    private var dismissed: Set<String> = []
    /// A server or Perspicax notice is on screen (shown and not dismissed).
    private var onScreen = false
    private var reconnectedUntil: Double?

    public init(enabled: Bool = true) {
        self.enabled = enabled
    }

    // MARK: Inputs

    /// The stream is live again (its hello arrived).
    public mutating func streamConnected(at now: Double) {
        if disconnectedAt != nil {
            // the announced restart is over
            restartAnnouncedAt = nil
        }
        disconnectedAt = nil
        probe = nil
        drainingSince = nil
    }

    /// The stream ended or failed. The first failure of an outage counts;
    /// the reconnect attempts that follow keep its start.
    public mutating func streamDisconnected(at now: Double) {
        if disconnectedAt == nil { disconnectedAt = now }
    }

    /// `server.restarting`: the server is about to close the stream on purpose.
    public mutating func restartAnnounced(at now: Double) {
        restartAnnouncedAt = now
    }

    /// The health route's answer while the stream is down.
    public mutating func probed(_ result: Probe, at now: Double) {
        guard disconnectedAt != nil else { return }
        probe = result
        if result == .draining, drainingSince == nil { drainingSince = now }
    }

    /// `connector.status` (or GET /api/connector-status): nil is no
    /// Perspicax connector here.
    public mutating func perspicax(unreachable: Bool?, since: Double?, at now: Double) {
        if unreachable == true {
            perspicaxDownSince = since ?? perspicaxDownSince ?? now
        } else {
            perspicaxDownSince = nil
        }
    }

    public mutating func network(offline: Bool) {
        networkOffline = offline
    }

    /// Settings > Notifications > Connection notices.
    public mutating func setEnabled(_ value: Bool) {
        enabled = value
        if !value {
            onScreen = false
            reconnectedUntil = nil
        }
    }

    /// The X: this occurrence stays dismissed.
    public mutating func dismiss(_ notice: Notice) {
        dismissed.insert(notice.occurrence)
        if notice.kind == .reconnected {
            reconnectedUntil = nil
        } else {
            onScreen = false
        }
    }

    // MARK: Output

    /// The condition as it stands, dismissed or not.
    func condition(now: Double) -> Notice? {
        if let down = disconnectedAt {
            guard now - down >= Self.blipMs else {
                // a blip: nothing yet, but a Perspicax notice already up stays
                return perspicaxNotice
            }
            let announced = restartAnnouncedAt.map { now - $0 <= Self.announceWindowMs } ?? false
            let draining = probe == .draining
            if announced || draining {
                let since = announced ? down : (drainingSince ?? down)
                if now - since < Self.updatingMaxMs {
                    return Notice(kind: .updating, occurrence: "updating:\(Int64(down))")
                }
            }
            return Notice(kind: .serverUnreachable, occurrence: "unreachable:\(Int64(down))")
        }
        return perspicaxNotice
    }

    private var perspicaxNotice: Notice? {
        perspicaxDownSince.map { Notice(kind: .perspicaxUnreachable, occurrence: "perspicax:\(Int64($0))") }
    }

    /// What to show now. Mutating: it remembers whether a notice was on
    /// screen, which is what turns its clearing into "Reconnected".
    public mutating func evaluate(now: Double) -> Notice? {
        guard enabled else { return nil }
        // the device's own offline line says it; nothing new here, and
        // nothing is cleared either
        if networkOffline { return nil }
        if let current = condition(now: now) {
            reconnectedUntil = nil
            if dismissed.contains(current.occurrence) {
                onScreen = false
                return nil
            }
            onScreen = true
            return current
        }
        if onScreen {
            onScreen = false
            reconnectedUntil = now + Self.reconnectedMs
        }
        if let until = reconnectedUntil {
            guard now < until else {
                reconnectedUntil = nil
                return nil
            }
            let notice = Notice(kind: .reconnected, occurrence: "reconnected:\(Int64(until))")
            if dismissed.contains(notice.occurrence) { return nil }
            return notice
        }
        return nil
    }

    /// Whether the app should keep re-evaluating on a timer (a blip that
    /// may grow into a notice, an updating that may turn unreachable, a
    /// Reconnected that ends).
    public var needsTicks: Bool {
        disconnectedAt != nil || reconnectedUntil != nil || onScreen
    }

    /// Whether the app should probe the health route now.
    public var probing: Bool { disconnectedAt != nil && !networkOffline }

    // MARK: Health answer

    /// Reads a health answer (GET /api/health or /healthz): 503 with
    /// `shuttingDown: true`, or the `x-sagax-maintenance` header on a 503,
    /// is a planned restart; 2xx is up; anything else failed.
    public static func classifyHealth(status: Int, maintenanceHeader: Bool, body: Data?) -> Probe {
        if (200..<300).contains(status) { return .ok }
        if status == 503 {
            if maintenanceHeader { return .draining }
            if let body, let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
               (object["shuttingDown"] as? Bool) == true {
                return .draining
            }
        }
        return .failed
    }
}

/// `GET /api/connector-status` and the `connector.status` frame's body.
public struct ConnectorStatus: Equatable, Sendable {
    /// nil: this server has no Perspicax connector.
    public var perspicaxUnreachable: Bool?
    /// Epoch ms the state began.
    public var since: Double?

    public init(perspicaxUnreachable: Bool?, since: Double?) {
        self.perspicaxUnreachable = perspicaxUnreachable
        self.since = since
    }

    /// `{ "perspicax": { "state": "ok"|"unreachable", "since": <ms> } | null }`.
    public static func parse(_ object: [String: Any]) -> ConnectorStatus {
        guard let perspicax = object["perspicax"] as? [String: Any], let state = perspicax["state"] as? String else {
            return ConnectorStatus(perspicaxUnreachable: nil, since: nil)
        }
        return ConnectorStatus(perspicaxUnreachable: state == "unreachable", since: (perspicax["since"] as? NSNumber)?.doubleValue)
    }

    public static func parse(_ data: Data) -> ConnectorStatus? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return parse(object)
    }
}

public extension CompanionClient {
    /// The health route, read for the connection notice: never throws.
    func connectionHealth() async -> ConnectionNoticeMachine.Probe {
        do {
            var request = try makeRequest("GET", "/api/health")
            request.timeoutInterval = 4
            let (data, response) = try await perform(request)
            guard let http = response as? HTTPURLResponse else { return .failed }
            return ConnectionNoticeMachine.classifyHealth(
                status: http.statusCode,
                maintenanceHeader: http.value(forHTTPHeaderField: "x-sagax-maintenance") != nil,
                body: data
            )
        } catch {
            return .failed
        }
    }

    /// `GET /api/connector-status` (organization servers); nil when the
    /// server does not have it.
    func connectorStatus() async -> ConnectorStatus? {
        do {
            let request = try makeRequest("GET", "/api/connector-status")
            let (data, response) = try await perform(request)
            try Self.check(response, data)
            return ConnectorStatus.parse(data)
        } catch {
            return nil
        }
    }
}
