// Allow or Deny from a notification. The decision of what is allowed lives
// in CompanionCore (NotificationApproval.swift). This file only sends it.
//
// Allow once. Never "Always allow". A security key is not skipped: if the
// server asks for one and the app is in front, the existing ceremony runs.
// If the app is not in front, nothing is approved and a banner asks the
// person to open Sagax.
import CompanionCore
import Foundation
import UIKit

enum NotificationApprovalRunner {
    enum Outcome: Equatable {
        case answered
        case needsForeground
        case failed
    }

    private static let pendingKey = "companion.notificationApproval.pending"
    private static let pendingTTL: TimeInterval = 10 * 60
    private static let lock = NSLock()
    private static var inflight: Set<String> = []

    struct Pending: Codable, Equatable {
        var threadId: String
        var requestId: String
        var at: TimeInterval
    }

    static func remember(threadId: String, requestId: String) {
        let pending = Pending(threadId: threadId, requestId: requestId, at: Date().timeIntervalSince1970)
        if let data = try? JSONEncoder().encode(pending) {
            UserDefaults.standard.set(data, forKey: pendingKey)
        }
    }

    static func takePending() -> Pending? {
        guard let data = UserDefaults.standard.data(forKey: pendingKey) else { return nil }
        UserDefaults.standard.removeObject(forKey: pendingKey)
        guard let pending = try? JSONDecoder().decode(Pending.self, from: data) else { return nil }
        guard Date().timeIntervalSince1970 - pending.at < pendingTTL else { return nil }
        return pending
    }

    static func run(_ decision: NotificationApproval.Decision) async -> Outcome {
        switch decision {
        case .open:
            return .failed
        case let .allow(threadId, requestId, _):
            return await send(threadId: threadId, requestId: requestId, behavior: "allow", message: nil)
        case let .deny(threadId, requestId):
            return await send(threadId: threadId, requestId: requestId, behavior: "deny", message: "Denied from the notification.")
        case let .confirmKey(threadId, requestId):
            _ = takePending()
            return await send(threadId: threadId, requestId: requestId, behavior: "allow", message: nil, forceCeremony: true)
        }
    }

    private static func send(
        threadId: String, requestId: String, behavior: String, message: String?, forceCeremony: Bool = false
    ) async -> Outcome {
        let key = "\(threadId)\u{0}\(requestId)\u{0}\(behavior)"
        lock.lock()
        if inflight.contains(key) {
            lock.unlock()
            return .answered
        }
        inflight.insert(key)
        lock.unlock()
        defer {
            lock.lock()
            inflight.remove(key)
            lock.unlock()
        }

        guard let connection = SagaxSharedConnectionStore.loadActiveConnection() else { return .failed }
        let token: String
        do {
            guard let stored = try SagaxSharedKeychain.token(for: connection.id), !stored.isEmpty else { return .failed }
            token = stored
        } catch {
            return .failed
        }

        let decision = ApprovalDecision(
            requestId: requestId, behavior: behavior, message: message, reviewedSha256: nil,
            always: false, rememberCommand: false, alwaysAllowKey: nil
        )
        do {
            try await WidgetRouteRequest.perform(connection: connection, token: token, replay: .onlyWhenUndelivered) { client in
                _ = try await client.respond(threadId: threadId, decision: decision)
            }
            return .answered
        } catch let refusal as StepUpRequired {
            // Deny never widens anything. A key refusal on it is not an Allow.
            guard behavior == "allow" else { return .failed }
            let active = await MainActor.run { UIApplication.shared.applicationState == .active }
            switch NotificationApproval.afterRefusal(appActive: forceCeremony || active) {
            case .deferToApp:
                return .needsForeground
            case .ceremony:
                return await ceremony(refusal, connection: connection, token: token, threadId: threadId, decision: decision)
            }
        } catch {
            return .failed
        }
    }

    private static func ceremony(
        _ refusal: StepUpRequired, connection: Connection, token: String, threadId: String, decision: ApprovalDecision
    ) async -> Outcome {
        await waitForWindow()
        guard let endpoint = connection.automaticEndpoints.first else { return .failed }
        let client = CompanionClient(connection: connection.dialing(endpoint), token: token, requestTimeout: 20)
        let ceremonyId: String
        do {
            ceremonyId = try await SecurityKeyStepUp.shared.confirm(refusal, with: client)
        } catch {
            return .failed
        }
        var again = decision
        again.stepUp = ceremonyId
        do {
            try await WidgetRouteRequest.perform(connection: connection, token: token, replay: .onlyWhenUndelivered) { client in
                _ = try await client.respond(threadId: threadId, decision: again)
            }
            return .answered
        } catch {
            return .failed
        }
    }

    @MainActor
    private static func waitForWindow() async {
        for _ in 0..<10 {
            let ready = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .contains { scene in
                    scene.activationState == .foregroundActive && scene.windows.contains { !$0.isHidden }
                }
            if ready { return }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
    }
}
