import CompanionCore
import Foundation
import WatchConnectivity

@MainActor
final class WatchPairingPublisher: NSObject, WCSessionDelegate {
    private var source: (() -> WatchPairingReply?)?
    private var generation: WatchSessionGeneration?
    private var updateScheduled = false
    private var session: WCSession? { WCSession.isSupported() ? .default : nil }

    func start(source: @escaping () -> WatchPairingReply?) {
        guard let session else { return }
        self.source = source
        session.delegate = self
        session.activate()
    }

    /// Session changes its route, credential and status together. Sample
    /// them after the synchronous transition has finished.
    func scheduleUpdate() {
        guard source != nil, !updateScheduled else { return }
        updateScheduled = true
        Task { @MainActor in
            updateScheduled = false
            publish()
        }
    }

    @discardableResult
    private func publish() -> WatchPairingReply? {
        guard var snapshot = source?() else { return nil }
        let key = "watch.pairingGeneration"
        do {
            if generation == nil, let encoded = try SagaxSharedKeychain.token(for: key) {
                generation = try JSONDecoder().decode(WatchSessionGeneration.self, from: Data(encoded.utf8))
            }
            let next = WatchSessionGeneration.resolve(previous: generation,
                accountID: snapshot.pairing?.connection.id, token: snapshot.pairing?.token)
            if next != generation {
                let data = try JSONEncoder().encode(next)
                try SagaxSharedKeychain.save(String(decoding: data, as: UTF8.self), for: key)
                generation = next
            }
            snapshot.revision = next.revision
        } catch {
            return nil
        }
        if let session, session.activationState == .activated, session.isPaired, session.isWatchAppInstalled {
            let existing = session.applicationContext
            let connection = snapshot.pairing?.connection
            let advertised = (existing[WatchPairing.connectionKey] as? Data).flatMap {
                try? JSONDecoder().decode(Connection.self, from: $0)
            }
            if (existing[WatchPairing.revisionKey] as? NSNumber)?.int64Value != snapshot.revision || connection != advertised {
                var context: [String: Any] = [WatchPairing.revisionKey: snapshot.revision]
                if let connection { context[WatchPairing.connectionKey] = try? JSONEncoder().encode(connection) }
                try? session.updateApplicationContext(context)
            }
        }
        return snapshot
    }

    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in publish() }
    }

    nonisolated func sessionWatchStateDidChange(_ session: WCSession) {
        Task { @MainActor in publish() }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any],
                             replyHandler: @escaping ([String: Any]) -> Void) {
        guard message[WatchPairing.requestKey] as? Bool == true else { replyHandler([:]); return }
        Task { @MainActor in
            guard let reply = publish(), let data = try? JSONEncoder().encode(reply) else {
                replyHandler([:])
                return
            }
            replyHandler([WatchPairing.requestKey: data])
        }
    }
}
