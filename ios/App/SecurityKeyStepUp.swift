// A security key step-up on the phone (wave 2, package E): the server's own
// ceremony page (server/routes/security-keys.ts) runs in the system
// authentication sheet, where a passkey answers with Face ID or Touch ID and
// a security key over NFC or USB, for the server's own address (its RP ID).
// The page ends on `sagax://security-key-done?status=ok&ceremony=<id>`.
// Nothing comes back but that outcome: the server verified the key, and the
// app sends the same answer again with the ceremony id.
import AuthenticationServices
import CompanionCore
import Foundation
#if canImport(UIKit)
import UIKit
#endif

@MainActor
final class SecurityKeyStepUp: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = SecurityKeyStepUp()
    private var session: ASWebAuthenticationSession?

    enum Failure: LocalizedError {
        case unavailable, cancelled, failed

        var errorDescription: String? {
            switch self {
            case .unavailable:
                String(localized: "This approval needs your security key, and this address cannot use one. Approve it from the desktop app or a browser on https.")
            case .cancelled:
                String(localized: "The security key request was cancelled. Nothing was approved.")
            case .failed:
                String(localized: "Your security key did not confirm this. Nothing was approved.")
            }
        }
    }

    /// The ceremony page itself (adding a key). Same sheet as a step-up.
    func open(page: URL, ceremonyId: String) async throws -> Bool {
        try await run(page, ceremonyId: ceremonyId)
    }

    /// Start a step-up for `refusal.target`, run its page, and return the
    /// ceremony id to send as `stepUp`.
    func confirm(_ refusal: StepUpRequired, with client: CompanionClient) async throws -> String {
        let start = try await client.beginStepUp(target: refusal.target)
        guard let url = client.stepUpPageURL(start) else { throw Failure.unavailable }
        guard try await run(url, ceremonyId: start.ceremonyId) else { throw Failure.failed }
        return start.ceremonyId
    }

    private func run(_ url: URL, ceremonyId: String) async throws -> Bool {
        try await withCheckedThrowingContinuation { continuation in
            let sheet = ASWebAuthenticationSession(url: url, callbackURLScheme: "sagax") { [weak self] callback, error in
                Task { @MainActor in
                    self?.session = nil
                    if callback == nil, (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                        continuation.resume(throwing: Failure.cancelled)
                        return
                    }
                    continuation.resume(returning: CompanionClient.stepUpSucceeded(callback, ceremonyId: ceremonyId))
                }
            }
            // Safari's own passkeys and keys: not an ephemeral session.
            sheet.prefersEphemeralWebBrowserSession = false
            sheet.presentationContextProvider = self
            session = sheet
            if !sheet.start() {
                session = nil
                continuation.resume(throwing: Failure.failed)
            }
        }
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        #if canImport(UIKit)
        return MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
        }
        #else
        return ASPresentationAnchor()
        #endif
    }
}
