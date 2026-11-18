import Combine
import CompanionCore
import Foundation
import WatchConnectivity
import WidgetKit

@MainActor
final class WatchSession: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchSession()
    @Published private(set) var client: CompanionClient?
    @Published private(set) var identity = UUID()

    private var activation: Task<Void, Never>?
    private var revision: Int64 = 0
    private var rotation = CandidateRotation(endpoints: [])
    private var requesting = false
    private var recovering: Int64?
    private let connectivity: WCSession?

    override init() {
        connectivity = WCSession.isSupported() ? .default : nil
        super.init()
        restore()
        connectivity?.delegate = self
        connectivity?.activate()
    }

    #if DEBUG
    static func preview(client: CompanionClient) -> WatchSession { WatchSession(preview: client) }

    private init(preview: CompanionClient) {
        connectivity = nil
        super.init()
        client = preview
    }
    #endif

    private func restore() {
        guard let stored = WatchPairingStore.record, stored.revision >= revision else { return }
        revision = stored.revision
        guard let connection = stored.connection else { return }
        rotation = CandidateRotation(endpoints: connection.orderedEndpoints)
        activateClient()
    }

    private func activateClient() {
        let checked = revision
        let endpoint = rotation.currentEndpoint
        activation?.cancel()
        activation = Task {
            let saved = try? await WatchPairingStore.loadClient(endpoint: endpoint)
            guard !Task.isCancelled, checked == revision else { return }
            let hadClient = client != nil
            client = saved
            if (saved != nil) != hadClient { identity = UUID() }
        }
    }

    /// Foreground, delivery of the latest account selection, and returning
    /// phone connectivity all come through this same reconciliation.
    func refresh() {
        guard let connectivity else { return }
        guard connectivity.activationState == .activated else { return }
        let context = connectivity.receivedApplicationContext
        if let latest = (context[WatchPairing.revisionKey] as? NSNumber)?.int64Value,
           WatchSessionGeneration.accepts(latest, after: revision) {
            if latest > revision {
                clear(revision: latest)
            } else if let data = context[WatchPairing.connectionKey] as? Data,
                      let updated = try? JSONDecoder().decode(Connection.self, from: data),
                      let current = WatchPairingStore.record?.connection,
                      updated.id == current.id, updated != current,
                      let token = try? WatchPairingStore.token(for: revision) {
                try? WatchPairingStore.save(revision: revision, connection: updated, token: token)
                restore()
            }
        }
        if client == nil { restore() }
        guard connectivity.isReachable, !requesting else { return }
        requesting = true
        let requestedRevision = revision
        connectivity.sendMessage([WatchPairing.requestKey: true]) { [weak self] response in
            let data = response[WatchPairing.requestKey] as? Data
            Task { @MainActor in
                guard let self else { return }
                self.requesting = false
                if let data, let reply = try? JSONDecoder().decode(WatchPairingReply.self, from: data) {
                    if reply.revision < self.revision, requestedRevision < self.revision {
                        self.refresh()
                    } else {
                        self.accept(reply)
                    }
                }
            }
        } errorHandler: { [weak self] _ in
            Task { @MainActor in self?.requesting = false }
        }
    }

    private func accept(_ reply: WatchPairingReply) {
        guard WatchSessionGeneration.accepts(reply.revision, after: revision) else { return }
        guard let pairing = reply.pairing else {
            if revision != reply.revision || client != nil { clear(revision: reply.revision) }
            return
        }
        if reply.revision == revision, client != nil { return }
        let rejected = (UserDefaults.standard.object(forKey: "watch.refusedRevision") as? NSNumber)?.int64Value
        guard rejected != reply.revision else { return }
        if reply.revision > revision { clear(revision: reply.revision) }
        do {
            try WatchPairingStore.save(revision: reply.revision, connection: pairing.connection, token: pairing.token)
            restore()
            WidgetCenter.shared.reloadAllTimelines()
        } catch {
            // A locked Keychain can be retried when the watch next activates.
        }
    }

    private func clear(revision next: Int64) {
        activation?.cancel()
        revision = next
        client = nil
        identity = UUID()
        rotation = CandidateRotation(endpoints: [])
        try? WatchPairingStore.save(revision: next, connection: nil, token: nil)
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Use the phone's route rotation and server session policy. A failed
    /// write stays with its caller so it can never accidentally be sent twice.
    func recover(after error: Error, using failed: CompanionClient) async {
        guard connectivity != nil, let current = client, current.connection == failed.connection,
              let token = try? WatchPairingStore.token(for: revision), failed.sends(token: token) else { return }
        guard (error as? APIError)?.isUnauthorized == true else {
            if rotation.advanceEndpoint(after: error) != nil { activateClient() }
            return
        }
        let checked = revision
        guard recovering != checked else { return }
        recovering = checked
        defer { if recovering == checked { recovering = nil } }
        refresh()
        let outcome = await UnauthorizedRecovery.run(
            current: token,
            candidates: { [] },
            probe: { await failed.replacingToken($0).probeAuthorization() },
            sleep: { try await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) }
        )
        guard checked == revision, case .signedOut = outcome else { return }
        UserDefaults.standard.set(checked, forKey: "watch.refusedRevision")
        clear(revision: checked)
    }

    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in refresh() }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in refresh() }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in refresh() }
    }
}
