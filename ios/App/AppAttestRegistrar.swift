// App Attest on this phone (CompanionCore/AppAttest.swift): attests a key
// with the server the phone is signed in to, then proves it on each sign-in
// and recovered token, and again after a few hours of a long session. Log
// only: on a simulator, an old device or a server without the routes, the app
// works as before.
import CompanionCore
import DeviceCheck
import Foundation
import os
import UIKit

struct DeviceCheckAttestProvider: AppAttestProvider {
    var isSupported: Bool { DCAppAttestService.shared.isSupported }
    func generateKey() async throws -> String { try await DCAppAttestService.shared.generateKey() }
    func attestKey(_ keyId: String, clientDataHash: Data) async throws -> Data {
        try await DCAppAttestService.shared.attestKey(keyId, clientDataHash: clientDataHash)
    }
    func generateAssertion(_ keyId: String, clientDataHash: Data) async throws -> Data {
        try await DCAppAttestService.shared.generateAssertion(keyId, clientDataHash: clientDataHash)
    }
}

@MainActor
final class AppAttestRegistrar {
    static let shared = AppAttestRegistrar()
    private let log = Logger(subsystem: "ca.pulsatrix.sagax", category: "attest")
    private let keys = UserDefaultsAppAttestKeyStore()
    /// When each connection last proved itself; a sign-in or a recovered
    /// token clears it (`forget`).
    private var lastRun: [String: Date] = [:]
    private var running: Set<String> = []
    /// A long session proves itself again after this long.
    private static let refreshAfter: TimeInterval = 6 * 60 * 60

    /// Runs the check for the active server when it is due.
    func sync() async {
        guard let active = PushRegistrar.shared.activeClient?() else { return }
        let id = active.connectionID
        if let last = lastRun[id], Date().timeIntervalSince(last) < Self.refreshAfter { return }
        guard running.insert(id).inserted else { return }
        defer { running.remove(id) }
        let flow = AppAttestFlow(
            provider: DeviceCheckAttestProvider(), server: active.client,
            appVersion: PushRegistrar.appVersion, deviceName: UIDevice.current.name
        )
        let outcome = await flow.run(connectionID: id, keys: keys)
        switch outcome {
        case .attested, .asserted:
            lastRun[id] = Date()
            log.info("app attest: \(String(describing: outcome), privacy: .public)")
        case .unsupported, .notConfigured:
            // nothing to prove here; do not ask again this launch
            lastRun[id] = Date()
            log.info("app attest: \(String(describing: outcome), privacy: .public)")
        case .failed(let reason):
            log.notice("app attest: failed (\(reason, privacy: .public)); the app keeps working")
        }
    }

    /// The session behind this connection changed (a new sign-in, a
    /// recovered token): prove again on the next sync.
    func forget(connectionID: String) {
        lastRun[connectionID] = nil
    }
}
