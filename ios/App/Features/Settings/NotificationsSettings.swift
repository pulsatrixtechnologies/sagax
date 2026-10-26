// Settings > Notifications (#222; matrix DC16 to DC18): what a new message
// or a nudge does on this phone. The desktop's rows, in its order:
// notification sounds, keep notifications on screen, unread count on the
// app icon, nudge sound, and the nudge's shake, which on a phone is a
// haptic. All on by default, kept on this device. A received nudge plays
// the wizz, buzzes and, unless its conversation is open in front, posts a
// local notification that opens it.
import AVFoundation
import CompanionCore
import SwiftUI
import UIKit
import UserNotifications

enum AttentionPrefs {
    static let badgeKey = "companion.prefs.appBadge"
    static let nudgeSoundKey = "companion.prefs.nudgeSound"
    static let nudgeHapticKey = "companion.prefs.nudgeHaptic"
    static let approvalChimeKey = "companion.prefs.approvalChime"

    static var settings: AttentionSettings {
        let defaults = UserDefaults.standard
        return AttentionSettings(
            sound: NotificationSounds.isEnabled,
            badge: defaults.object(forKey: badgeKey) as? Bool ?? true,
            nudgeSound: defaults.object(forKey: nudgeSoundKey) as? Bool ?? true,
            nudgeHaptic: defaults.object(forKey: nudgeHapticKey) as? Bool ?? true,
            approvalChime: defaults.object(forKey: approvalChimeKey) as? Bool ?? true
        )
    }
}

/// The approval banner's own sound. On unless this phone turned it off.
enum ApprovalChime {
    static var isEnabled: Bool {
        UserDefaults.standard.object(forKey: AttentionPrefs.approvalChimeKey) as? Bool ?? true
    }
}

/// Which conversation is on screen, for the nudge's "already looking".
@MainActor
final class AttentionCenter {
    static let shared = AttentionCenter()
    var viewingThreadId: String?
    private var player: AVAudioPlayer?
    /// Nudges already played, from the stream or a push (NudgeFrame.dedupKey).
    private var playedNudges: [String] = []

    /// Returns false when this nudge already rang.
    private func firstTime(_ key: String?) -> Bool {
        guard let key else { return true }
        if playedNudges.contains(key) { return false }
        playedNudges.append(key)
        if playedNudges.count > 32 { playedNudges.removeFirst() }
        return true
    }

    /// An APNs push that arrived while the app is in front.
    func presentation(for push: PushPayload, appActive: Bool) -> UNNotificationPresentationOptions {
        let sound: UNNotificationPresentationOptions = NotificationSounds.isEnabled ? [.sound] : []
        switch push.kind {
        case .nudge:
            // the stream already shook and rang for it: nothing more
            guard firstTime(push.nudgeKey) else { return [] }
            let settings = AttentionPrefs.settings
            var rang = false
            if settings.nudgeSound { rang = playWizz() }
            if settings.nudgeHaptic { buzz() }
            if !ForegroundNotification.showsSystemBanner(appActive: appActive, viewingThreadId: viewingThreadId, threadId: push.threadId) {
                return []
            }
            let shown: UNNotificationPresentationOptions = [.banner, .list]
            return rang ? shown : shown.union(sound)
        default:
            if !ForegroundNotification.showsSystemBanner(appActive: appActive, viewingThreadId: viewingThreadId, threadId: push.threadId) {
                return []
            }
            let shown: UNNotificationPresentationOptions = [.banner, .list, .badge]
            return shown.union(sound)
        }
    }

    /// A `nudge` frame addressed to this person.
    func receive(_ nudge: NudgeFrame) {
        guard firstTime(nudge.dedupKey) else { return }
        let decision = NudgeAttention.decide(
            nudge, now: Date().timeIntervalSince1970 * 1000,
            appActive: UIApplication.shared.applicationState == .active,
            viewingThreadId: viewingThreadId, settings: AttentionPrefs.settings
        )
        guard decision.fresh else { return }
        var rang = false
        if decision.sound { rang = playWizz() }
        if decision.haptic { buzz() }
        if decision.notify { NotificationCoordinator.shared.deliverNudge(nudge, ring: !rang && AttentionPrefs.settings.nudgeSound) }
    }

    /// The bundled wizz (`public/nudge.mp3`), mixed with other audio.
    @discardableResult
    func playWizz() -> Bool {
        guard let url = Bundle.main.url(forResource: "nudge", withExtension: "mp3") else { return false }
        do {
            try AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
            let player = try AVAudioPlayer(contentsOf: url)
            player.volume = 0.6
            self.player = player
            return player.play()
        } catch {
            return false
        }
    }

    /// The shake's phone equivalent: three heavy taps.
    func buzz() {
        let generator = UIImpactFeedbackGenerator(style: .heavy)
        generator.prepare()
        for step in 0..<3 {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(step) * 0.12) { generator.impactOccurred() }
        }
    }
}

extension NotificationCoordinator {
    /// A nudge's notification: opens the conversation its line went to.
    func deliverNudge(_ nudge: NudgeFrame, ring: Bool) {
        let content = UNMutableNotificationContent()
        let name = nudge.fromName.trimmingCharacters(in: .whitespacesAndNewlines)
        let display = name.isEmpty ? String(localized: "Someone") : name
        content.title = display
        content.body = String(localized: "Open the conversation to answer.")
        content.sound = ring ? .default : nil
        content.interruptionLevel = .timeSensitive
        if let open = nudge.open {
            content.threadIdentifier = open.threadId
            content.userInfo = ["threadId": open.threadId, "botId": open.groupId, "kind": "nudge"]
        }
        let sender = PushSenderIdentity(
            id: nudge.fromId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? display : nudge.fromId,
            displayName: display,
            conversationId: nudge.open?.threadId ?? nudge.fromId,
            avatarUrl: nil
        )
        let posted = CommunicationNotification.applyingIntent(content, sender: sender, imageData: nil)
        // the APNs push for the same nudge (apns-collapse-id) replaces it
        let identifier = PushCollapse.identifier(threadId: nudge.open?.threadId, kind: "nudge")
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: identifier, content: posted, trigger: nil))
    }
}

struct NotificationsSettingsView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @AppStorage(NotificationSounds.key) private var sounds = true
    @AppStorage(AttentionPrefs.badgeKey) private var badge = true
    @AppStorage(AttentionPrefs.nudgeSoundKey) private var nudgeSound = true
    @AppStorage(AttentionPrefs.nudgeHapticKey) private var nudgeHaptic = true
    @AppStorage(AttentionPrefs.approvalChimeKey) private var approvalChime = true

    var body: some View {
        SettingsPage(title: "Notifications") {
            // the system's permission first (the root's row says On or Off)
            SettingsCard { SystemNotificationsRow() }
            SettingsSpacer(SettingsMetrics.cardGap)
            SettingsCard {
                SettingsRow(
                    title: "Notification sounds",
                    subtitle: "Play a sound when an agent finishes or needs you.",
                    accessory: .toggle(Binding(get: { sounds }, set: { value in
                        sounds = value
                        Task {
                            await NotificationSounds.set(value, session: session)
                            // the server applies this phone's switches to its pushes
                            await PushRegistrar.shared.sync()
                        }
                    })),
                    identifier: "settings-notification-sounds"
                )
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(
                    title: "Approval chime",
                    subtitle: "A distinct sound when an approval is waiting.",
                    accessory: .toggle(Binding(get: { approvalChime }, set: { value in
                        approvalChime = value
                        Task { await PushRegistrar.shared.sync() }
                    })),
                    identifier: "settings-approval-chime"
                )
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(
                    title: "Unread count on the app icon",
                    accessory: .toggle(Binding(get: { badge }, set: { value in
                        badge = value
                        NotificationCoordinator.shared.setBadge(session.state.unreadCount)
                        Task { await PushRegistrar.shared.sync() }
                    })),
                    identifier: "settings-notification-badge"
                )
            }
            SettingsFooter(text: "To keep notifications on screen until you close them, choose the Persistent banner style for Sagax in the iOS Settings app.")
            SettingsCard {
                SettingsRow(
                    title: "Nudge sound",
                    subtitle: "Play the nudge sound when someone nudges you.",
                    accessory: .toggle(Binding(get: { nudgeSound }, set: { value in
                        nudgeSound = value
                        Task { await PushRegistrar.shared.sync() }
                    })),
                    identifier: "settings-nudge-sound"
                )
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(
                    title: "Buzz on nudge",
                    subtitle: "The phone buzzes, as the desktop window shakes.",
                    accessory: .toggle($nudgeHaptic),
                    identifier: "settings-nudge-haptic"
                )
            }
            .task { await NotificationSounds.pull(session) }
            // Privacy (#518): a card of this page on an organization server
            if NavigationMenus.showsPrivacy(gate: session.surfaceGate, connected: session.connection != nil) {
                SettingsSectionLabel(text: "Privacy")
                PrivacyPresenceCard()
            }
        }
    }
}
