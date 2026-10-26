// APNs on this phone (docs/ios-push.md). iOS hands the app a device token
// after `registerForRemoteNotifications()`; the app gives it to the server
// it is signed in to (`POST /api/push/devices`) on every launch, when the
// token changes, when another server becomes the active one and when
// Settings > Notifications changes, and takes it back on sign-out. The
// server then pushes what the closed app would have missed: a message, a
// nudge, an approval, an achievement, a routine that failed.
import CompanionCore
import Foundation
import os
import UIKit

@MainActor
final class PushRegistrar {
    static let shared = PushRegistrar()
    private let log = Logger(subsystem: "ca.pulsatrix.sagax", category: "push")

    /// The token iOS gave this launch (hex); nil until then.
    private(set) var deviceToken: String?
    /// What was last registered, per connection: a launch registers once,
    /// then again only when something in it changed.
    private var registered: [String: PushRegistration] = [:]
    /// Set by Session: the active client, to register the token as soon as
    /// it arrives.
    var activeClient: (() -> (client: CompanionClient, connectionID: String)?)?
    /// Set by Session: refresh the unread count after a push woke the app.
    var backgroundRefresh: (() async -> Bool)?
    /// Set by Session: reopen the live stream so it names this token and
    /// the server can skip APNs to this phone while the app is in front.
    var onDeviceToken: (() -> Void)?

    /// Ask iOS for a token. Cheap and safe to repeat; the alert permission is
    /// asked separately (notification onboarding, Settings).
    func start() {
        UIApplication.shared.registerForRemoteNotifications()
    }

    func didRegister(tokenData: Data) {
        let token = PushToken.hex(tokenData)
        let changed = token != deviceToken
        if changed { registered.removeAll() }
        deviceToken = token
        log.info("APNs token received")
        Task { await sync() }
        if changed { onDeviceToken?() }
    }

    func didFail(_ error: Error) {
        log.error("APNs registration failed: \(error.localizedDescription, privacy: .public)")
    }

    /// Registers this phone with the active server when it is not yet
    /// registered there with the same token and settings.
    func sync() async {
        guard let token = deviceToken, let active = activeClient?() else { return }
        let registration = PushRegistration(
            token: token,
            environment: Self.environment,
            appVersion: Self.appVersion,
            deviceName: UIDevice.current.name,
            settings: PushDeviceSettings(AttentionPrefs.settings)
        )
        if registered[active.connectionID] == registration { return }
        do {
            try await active.client.registerPushDevice(registration)
            registered[active.connectionID] = registration
            log.info("registered for pushes (\(Self.environment.rawValue, privacy: .public))")
        } catch {
            // an older server (404) or a pairing that is not a person: no pushes there
            log.notice("push registration refused: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// The session behind this connection changed (a new sign-in, a
    /// recovered token): register again on the next sync.
    func forgetRegistration(connectionID: String) {
        registered[connectionID] = nil
    }

    /// Sign-out of that server: it stops pushing to this phone. Only on an
    /// explicit sign-out or removal, never because a request was refused.
    func unregister(client: CompanionClient, connectionID: String) async {
        registered[connectionID] = nil
        guard let token = deviceToken else { return }
        try? await client.unregisterPushDevice(token: token)
    }

    static var environment: APNsEnvironment {
        #if targetEnvironment(simulator)
        let simulator = true
        #else
        let simulator = false
        #endif
        let profile = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision").flatMap { try? Data(contentsOf: $0) }
        return APNsEnvironment.detect(provisioningProfile: profile, isSimulator: simulator)
    }

    static var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }
}
