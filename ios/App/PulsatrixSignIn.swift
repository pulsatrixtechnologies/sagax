// "Sign in with Pulsatrix" on an organization server: the server's own
// sign-in runs in the system authentication sheet, sharing Safari's cookies
// and passkeys, so a person already signed in to Perspicax is not asked
// again. The server ends it on `sagax://pair?address=...&token=...`, the
// same invite a pairing QR code carries, and the app redeems it through the
// existing pairing path (`POST /api/pair`). A refusal ends on
// `sagax://pair?error=<code>`. No Perspicax token reaches the phone: the
// server is the OpenID Connect client (CompanionCore/OrgSignIn.swift).
import AuthenticationServices
import CompanionCore
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

@MainActor
final class PulsatrixWebSignIn: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    @Published private(set) var running = false
    private var session: ASWebAuthenticationSession?

    /// Open the sign-in on `origin`, asking for `scheme` (`sagax`).
    /// `completion` always runs, with what the sheet
    /// ended on: an invite, a refusal, a cancel or something unexpected.
    func start(origin: URL, scheme: String, fresh: Bool = false, completion: @escaping (PulsatrixSignInOutcome) -> Void) {
        guard !running, let url = PulsatrixSignIn.startURL(base: origin, returnScheme: scheme, fresh: fresh) else {
            completion(.unexpected)
            return
        }
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callback, error in
            Task { @MainActor in
                self?.running = false
                self?.session = nil
                if callback == nil, let error, (error as? ASWebAuthenticationSessionError)?.code != .canceledLogin {
                    completion(.unexpected)
                    return
                }
                completion(PulsatrixSignIn.outcome(from: callback, expectedOrigin: origin))
            }
        }
        session.prefersEphemeralWebBrowserSession = false
        session.presentationContextProvider = self
        self.session = session
        running = session.start()
        if !running {
            self.session = nil
            completion(.unexpected)
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
