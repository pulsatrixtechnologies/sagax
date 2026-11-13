// Notification sounds (matrix ST3), the desktop's NotificationSoundsRow:
// one switch, on unless turned off. Off keeps the banners and loses the
// sound (src/lib/notify.ts `silent`), for the bots' notifications and the
// achievement banners alike. On an organization server it follows the
// person between devices as the desktop's `omb-notification-sounds`
// (shared/user-preferences.ts, GET/PUT /api/me/preferences).
import AVFoundation
import CompanionCore
import SwiftUI
import UserNotifications

enum NotificationSounds {
    /// Per device, as `omb-notification-sounds` is in a desktop's storage.
    static let key = "companion.prefs.notificationSounds"
    /// The synced preference's name on an organization server.
    static let syncedKey = "omb-notification-sounds"

    /// Read by NotificationCoordinator, which has no SwiftUI environment.
    static var isEnabled: Bool {
        UserDefaults.standard.object(forKey: key) as? Bool ?? true
    }

    /// Which sound a notification plays (`sagax.notificationSound.v1`, the
    /// person's record through SidebarPrefsModel), kept here for the
    /// coordinator.
    static let choiceKey = "companion.prefs.notificationSoundChoice"

    static var choice: NotificationSoundChoice {
        NotificationSoundChoice.parse(UserDefaults.standard.string(forKey: choiceKey))
    }

    static func applyChoice(_ choice: NotificationSoundChoice) {
        UserDefaults.standard.set(choice.rawValue, forKey: choiceKey)
    }

    /// The chosen tone as a notification's sound: a bundled file, or the system's.
    static var platformSound: UNNotificationSound {
        choice.fileName.map { UNNotificationSound(named: UNNotificationSoundName($0)) } ?? .default
    }

    /// Plays the chosen tone once (the picker's preview).
    @MainActor static func preview(_ choice: NotificationSoundChoice) {
        guard let file = choice.fileName, let url = Bundle.main.url(forResource: file, withExtension: nil) else { return }
        previewPlayer = try? AVAudioPlayer(contentsOf: url)
        previewPlayer?.play()
    }

    @MainActor private static var previewPlayer: AVAudioPlayer?

    /// The person's synced value, when the server keeps one.
    @MainActor static func pull(_ session: Session) async {
        guard session.surfaceGate.organization, let client = session.settingsClient,
              let record = try? await client.preferences(), let value = record.preferences[syncedKey] else { return }
        UserDefaults.standard.set(value != "0", forKey: key)
    }

    /// Saves on this device, then in the person's record (merged: PUT
    /// replaces the whole record).
    @MainActor static func set(_ on: Bool, session: Session) async {
        UserDefaults.standard.set(on, forKey: key)
        guard session.surfaceGate.organization, let client = session.settingsClient,
              let record = try? await client.preferences() else { return }
        var values = record.preferences
        values[syncedKey] = on ? "1" : "0"
        _ = try? await client.putPreferences(values)
    }
}

/// The Haptics page's second card: Notification sounds.
struct NotificationSoundsCard: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @AppStorage(NotificationSounds.key) private var on = true

    var body: some View {
        SettingsCard {
            SettingsRow(
                title: "Notification sounds",
                subtitle: "Play a sound when an agent finishes or needs you.",
                accessory: .toggle(Binding(get: { on }, set: { value in
                    on = value
                    Task { await NotificationSounds.set(value, session: session) }
                })),
                identifier: "settings-notification-sounds"
            )
        }
        SettingsFooter(text: "Turn it off to keep the banners but lose the chime, handy on a call where the agent is already talking to you.")
            .task { await NotificationSounds.pull(session) }
        NotificationSoundChoiceCard()
    }
}

/// Settings > Notifications > Notification sound (parity 2E): the system's
/// sound or one of the desktop's five tones, for the person on every device.
struct NotificationSoundChoiceCard: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    @AppStorage(NotificationSounds.key) private var on = true

    var body: some View {
        SettingsCard {
            Menu {
                Picker(selection: Binding(get: { prefs.notificationSound }, set: { choice in
                    prefs.setNotificationSound(session, choice)
                    NotificationSounds.preview(choice)
                })) {
                    ForEach(NotificationSoundChoice.allCases, id: \.self) { choice in
                        Text(LocalizedStringKey(choice.label)).tag(choice)
                    }
                } label: { EmptyView() }
            } label: {
                SettingsRow(
                    title: "Notification sound",
                    accessory: .valueChevron(String(localized: String.LocalizationValue(prefs.notificationSound.label))))
            }
            .disabled(!on)
            .accessibilityIdentifier("settings-notification-sound")
        }
    }
}
