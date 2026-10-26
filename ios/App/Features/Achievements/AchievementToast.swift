// The unlock banner (AchievementToaster.tsx): a rarity badge with the icon,
// "Achievement unlocked" and the points, the name, the reward, and a close
// button. It sits in a window of its own above every sheet, so a banner is
// seen wherever the person is. While it shows, that window keeps every
// touch: the card and its button take their own, a touch anywhere else
// closes the banner, and nothing reaches the app under it (JC 2026-10-19:
// the close button and a touch on the card went through to what was
// behind). Once the banner is gone the window lets everything through.
//
// `achievementsHost()` on the app's root drives the store: the first read
// and `app.opened` for each pairing, a reload whenever the app comes back
// to the front.
import CompanionCore
import SwiftUI
import UIKit

extension View {
    /// The achievements of the paired person: reads, reports, banners.
    /// `session` is passed in: the root's environment object is set inside.
    func achievementsHost(_ session: Session) -> some View { modifier(AchievementsHost(session: session)) }
}

private struct AchievementsHost: ViewModifier {
    @ObservedObject var session: Session
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var store = AchievementStore.shared

    func body(content: Content) -> some View {
        content
            .task(id: session.connection?.id) { await start() }
            .onValueChange(of: scenePhase) { phase in
                if phase == .active, Self.live { Task { await store.reload() } }
            }
            .onValueChange(of: store.toast) { item in
                AchievementToastWindow.shared.show(item)
            }
            // A banner waits while the person types (TYPING_QUIET_MS).
            .onReceive(NotificationCenter.default.publisher(for: UITextView.textDidChangeNotification)) { _ in
                AchievementTyping.lastKeystroke = Date()
            }
            .onReceive(NotificationCenter.default.publisher(for: UITextField.textDidChangeNotification)) { _ in
                AchievementTyping.lastKeystroke = Date()
            }
    }

    /// The parity captures and the demo never report: a banner over a
    /// reference screen would break it. `-achievementsLive` turns it on for
    /// the UI tests.
    static var live: Bool {
        if ProcessInfo.processInfo.arguments.contains("-achievementsLive") { return true }
        return !ParityMode.isActive
    }

    private func start() async {
        let gate = session.surfaceGate
        guard let client = session.settingsClient, !session.isDemo, gate.allows(.achievements) else {
            store.attach(client: nil, connectionID: nil)
            return
        }
        store.attach(client: client, connectionID: session.connection?.id)
        if Self.live { await store.appOpened() }
    }
}

/// The window the banner is drawn in.
@MainActor
final class AchievementToastWindow {
    static let shared = AchievementToastWindow()
    private var window: PassthroughWindow?

    func show(_ item: AchievementToastItem?) {
        guard item != nil else {
            // Nothing stays above the app between banners: hide the window
            // once the banner's exit animation (0.3 s) has played.
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 400_000_000)
                if AchievementStore.shared.toast == nil { self?.window?.isHidden = true }
            }
            return
        }
        if window == nil, let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive }) ?? UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first {
            let window = PassthroughWindow(windowScene: scene)
            window.windowLevel = .alert + 1
            window.backgroundColor = .clear
            // The skin's tokens without `themeRoot()`: that one paints the
            // skin's desktop colour full screen (black on the Black skin),
            // which covered the whole app for good after the first unlock.
            let host = UIHostingController(rootView: AchievementToastLayer().themeOverlay())
            host.view.backgroundColor = .clear
            window.rootViewController = host
            self.window = window
        }
        window?.isHidden = false
    }
}

/// While a banner shows, every touch lands in this window (the banner's
/// backdrop and card); between banners, none does. A SwiftUI hosting view
/// answers `hitTest` with itself for its buttons too, so telling the card
/// from the empty area by the view that was hit let the close button's
/// touches through to the app. Always transparent: `ThemeUIKit.apply`
/// leaves it out of the windows it paints with the skin.
final class PassthroughWindow: UIWindow {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard AchievementStore.shared.toast != nil else { return nil }
        return super.hitTest(point, with: event)
    }
}

private struct AchievementToastLayer: View {
    @ObservedObject private var store = AchievementStore.shared

    var body: some View {
        ZStack(alignment: .top) {
            if store.toast != nil {
                // Outside the card: a touch closes the banner and goes no
                // further. Nearly clear, so the app still shows under it.
                Color.black.opacity(0.001)
                    .contentShape(Rectangle())
                    .ignoresSafeArea()
                    .onTapGesture { store.dismissToast() }
                    .accessibilityElement()
                    .accessibilityLabel(Text("Dismiss"))
                    .accessibilityAddTraits(.isButton)
                    .accessibilityIdentifier("achievement-toast-backdrop")
            }
            VStack {
                if let item = store.toast {
                    AchievementToastView(item: item, keys: Set(store.snapshot?.rewards ?? [])) { store.dismissToast() }
                        .padding(.horizontal, 12)
                        .padding(.top, 6)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
        .animation(.spring(response: 0.42, dampingFraction: 0.86), value: store.toast)
    }
}

struct AchievementToastView: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.locale) private var locale
    let item: AchievementToastItem
    let keys: Set<String>
    let dismiss: () -> Void

    private var language: String? { AchievementLanguage.current ?? locale.language.languageCode?.identifier }

    var body: some View {
        let tint = AchievementWording.color(item.definition.rarity)
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: AchievementWording.symbol(item.definition.icon))
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(tint, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Image(systemName: "trophy.fill").font(.system(size: 10, weight: .semibold))
                    Text("Achievement unlocked")
                    Text(verbatim: "+\(item.points)")
                }
                .font(Theme.Font.labelMedium)
                .foregroundStyle(tint)
                Text(verbatim: item.definition.name.resolved(language))
                    .font(Theme.Font.bodyMedium)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                if let reward = item.rewardLabel(language, keys: keys) {
                    Text(verbatim: reward)
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
            }
            if let art = item.definition.rewards.first?.revealingArt {
                MascotCharacterView(look: art.look, color: art.color, skin: art.owlSkin, size: 34, animated: false)
                    .accessibilityHidden(true)
                    .accessibilityIdentifier("achievement-toast-art")
            }
            Spacer(minLength: 0)
            Button(action: dismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(width: 30, height: 30)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Dismiss"))
            .accessibilityIdentifier("achievement-toast-dismiss")
        }
        .padding(12)
        .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: max(Theme.Metric.cardRadius, 4), style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: max(Theme.Metric.cardRadius, 4), style: .continuous).strokeBorder(tint.opacity(0.5), lineWidth: 1))
        .shadow(color: .black.opacity(0.25), radius: 12, y: 4)
        // the card's own touches stop here: never on to the backdrop or the app
        .contentShape(RoundedRectangle(cornerRadius: max(Theme.Metric.cardRadius, 4), style: .continuous))
        .onTapGesture {}
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("achievement-toast")
    }
}
