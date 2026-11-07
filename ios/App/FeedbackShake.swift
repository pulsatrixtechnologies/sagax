import SwiftUI
import UIKit
import CompanionCore

/// #2618: shaking the phone opens a report with the shared Feedback bot,
/// the same way the desktop's Help > Send feedback does. UIKit hands the
/// shake to the key window; it is passed on as a notification so SwiftUI can
/// answer it from the app's root.
extension Notification.Name {
    static let sagaxDeviceDidShake = Notification.Name("ca.pulsatrix.sagax.deviceDidShake")
}

extension UIWindow {
    override open func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        if motion == .motionShake {
            NotificationCenter.default.post(name: .sagaxDeviceDidShake, object: nil)
        }
        super.motionEnded(motion, with: event)
    }
}

private struct FeedbackShakeHost: ViewModifier {
    let session: Session
    /// The language the person picked (Settings > App), read here because
    /// this modifier sits outside the root's locale override.
    @AppStorage(PrefKey.language) private var language = AppLanguage.system.rawValue

    func body(content: Content) -> some View {
        content.onReceive(NotificationCenter.default.publisher(for: .sagaxDeviceDidShake)) { _ in
            let locale = AppLanguage.resolved(language).locale ?? .autoupdatingCurrent
            Task { await session.startFeedback(source: .shake, locale: locale) }
        }
    }
}

extension View {
    func feedbackShakeHost(_ session: Session) -> some View {
        modifier(FeedbackShakeHost(session: session))
    }
}
