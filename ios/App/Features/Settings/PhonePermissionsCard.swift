import AVFoundation
import CompanionCore
import Contacts
import CoreLocation
import EventKit
import Speech
import SwiftUI
import UIKit
import UserNotifications

/// Settings > Privacy and security > Phone permissions (#2614): every
/// permission Sagax uses on this phone, one row each, with the one action that
/// grants it. Not asked yet: the system prompt, in place. Refused: the app's
/// page in the Settings app (the notification page for notifications), the
/// only place iOS lets the person turn it back on. Read again when the person
/// comes back, so a switch turned on shows at once. The mapping is
/// `PhonePermissions` (CompanionCore), checked against the desktop's vectors.
struct PhonePermissionsCard: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var session: Session
    @State private var statuses: [PhonePermission: PhonePermissionStatus] = [:]
    @State private var locationAsker = LocationAsker()

    var body: some View {
        SettingsSectionLabel(text: "Phone permissions")
        SettingsCard {
            ForEach(Array(PhonePermission.allCases.enumerated()), id: \.element) { index, permission in
                if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                row(permission)
            }
        }
        SettingsFooter(text: "Tap a permission to allow it. Once refused, iOS only lets you turn it back on in the Settings app: the button opens Sagax's page there.")
            .task { await refresh() }
            .onValueChange(of: scenePhase) { phase in
                if phase == .active { Task { await refresh() } }
            }
    }

    @ViewBuilder private func row(_ permission: PhonePermission) -> some View {
        let status = statuses[permission] ?? .unknown
        let action = PhonePermissions.action(for: permission, status: status)
        switch action {
        case .none:
            SettingsRow(title: Self.label(permission), subtitle: Self.statusText(status), systemImage: Self.icon(permission), accessory: .check, identifier: "phone-permission-\(permission.rawValue)")
        case .prompt:
            SettingsRow(title: Self.label(permission), subtitle: Self.statusText(status), systemImage: Self.icon(permission), accessory: .value(String(localized: "Allow")), style: .action, identifier: "phone-permission-\(permission.rawValue)") {
                Task { await prompt(permission); await refresh() }
            }
        case .settings, .notificationSettings:
            SettingsRow(title: Self.label(permission), subtitle: Self.statusText(status), systemImage: Self.icon(permission), accessory: .external, style: .action, identifier: "phone-permission-\(permission.rawValue)") {
                Self.openSettings(action)
            }
        }
    }

    // MARK: - Words and icons

    static func label(_ permission: PhonePermission) -> LocalizedStringKey {
        switch permission {
        case .notifications: "Notifications"
        case .microphone: "Microphone"
        case .speech: "Speech recognition"
        case .camera: "Camera"
        case .contacts: "Contacts"
        case .calendars: "Calendars"
        case .reminders: "Reminders"
        case .location: "Location"
        }
    }

    static func statusText(_ status: PhonePermissionStatus) -> String {
        switch status {
        case .granted, .limited: "Allowed"
        case .notDetermined: "Not asked yet"
        case .denied: "Not allowed: open Settings to allow"
        case .restricted: "Restricted on this phone: open Settings"
        case .unknown: "Open Settings to check"
        }
    }

    static func icon(_ permission: PhonePermission) -> String {
        switch permission {
        case .notifications: "bell"
        case .microphone: "mic"
        case .speech: "waveform"
        case .camera: "camera"
        case .contacts: "person.crop.circle"
        case .calendars: "calendar"
        case .reminders: "checklist"
        case .location: "location"
        }
    }

    // MARK: - Actions

    static func openSettings(_ action: PhonePermissionAction) {
        var link = UIApplication.openSettingsURLString
        if action == .notificationSettings, #available(iOS 16.0, *) {
            link = UIApplication.openNotificationSettingsURLString
        }
        if let url = URL(string: link) { UIApplication.shared.open(url) }
    }

    private func prompt(_ permission: PhonePermission) async {
        switch permission {
        case .notifications: await session.enableNotifications()
        case .microphone: _ = await MicrophonePermission.request()
        case .speech:
            await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                SFSpeechRecognizer.requestAuthorization { _ in done.resume() }
            }
        case .camera: _ = await AVCaptureDevice.requestAccess(for: .video)
        case .contacts: _ = try? await CNContactStore().requestAccess(for: .contacts)
        case .calendars:
            let store = EKEventStore()
            if #available(iOS 17.0, *) { _ = try? await store.requestFullAccessToEvents() } else { _ = try? await store.requestAccess(to: .event) }
        case .reminders:
            let store = EKEventStore()
            if #available(iOS 17.0, *) { _ = try? await store.requestFullAccessToReminders() } else { _ = try? await store.requestAccess(to: .reminder) }
        case .location: await locationAsker.ask()
        }
    }

    // MARK: - Statuses

    private func refresh() async {
        var next: [PhonePermission: PhonePermissionStatus] = [:]
        await session.refreshNotificationAuthorization()
        switch session.notificationAuthorization {
        case .authorized, .provisional, .ephemeral: next[.notifications] = .granted
        case .notDetermined: next[.notifications] = .notDetermined
        case .denied: next[.notifications] = .denied
        @unknown default: next[.notifications] = .unknown
        }
        next[.microphone] = Self.microphoneStatus()
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: next[.speech] = .granted
        case .notDetermined: next[.speech] = .notDetermined
        case .denied: next[.speech] = .denied
        case .restricted: next[.speech] = .restricted
        @unknown default: next[.speech] = .unknown
        }
        next[.camera] = Self.avStatus(AVCaptureDevice.authorizationStatus(for: .video))
        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .authorized: next[.contacts] = .granted
        case .notDetermined: next[.contacts] = .notDetermined
        case .denied: next[.contacts] = .denied
        case .restricted: next[.contacts] = .restricted
        default: next[.contacts] = .limited // iOS 18 limited access
        }
        next[.calendars] = Self.eventKitStatus(EKEventStore.authorizationStatus(for: .event))
        next[.reminders] = Self.eventKitStatus(EKEventStore.authorizationStatus(for: .reminder))
        switch CLLocationManager().authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: next[.location] = .granted
        case .notDetermined: next[.location] = .notDetermined
        case .denied: next[.location] = .denied
        case .restricted: next[.location] = .restricted
        @unknown default: next[.location] = .unknown
        }
        statuses = next
    }

    private static func microphoneStatus() -> PhonePermissionStatus {
        if #available(iOS 17.0, *) {
            switch AVAudioApplication.shared.recordPermission {
            case .granted: return .granted
            case .denied: return .denied
            case .undetermined: return .notDetermined
            @unknown default: return .unknown
            }
        }
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted: return .granted
        case .denied: return .denied
        case .undetermined: return .notDetermined
        @unknown default: return .unknown
        }
    }

    private static func avStatus(_ status: AVAuthorizationStatus) -> PhonePermissionStatus {
        switch status {
        case .authorized: .granted
        case .notDetermined: .notDetermined
        case .denied: .denied
        case .restricted: .restricted
        @unknown default: .unknown
        }
    }

    private static func eventKitStatus(_ status: EKAuthorizationStatus) -> PhonePermissionStatus {
        switch status {
        case .notDetermined: return .notDetermined
        case .denied: return .denied
        case .restricted: return .restricted
        default:
            if #available(iOS 17.0, *), status == .writeOnly { return .limited }
            return .granted // .authorized, .fullAccess
        }
    }
}

/// Location asks through a delegate: wait for the answer, then read again.
@MainActor
final class LocationAsker: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var waiting: CheckedContinuation<Void, Never>?

    override init() {
        super.init()
        manager.delegate = self
    }

    func ask() async {
        guard manager.authorizationStatus == .notDetermined else { return }
        await withCheckedContinuation { continuation in
            waiting = continuation
            manager.requestWhenInUseAuthorization()
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            guard manager.authorizationStatus != .notDetermined else { return }
            waiting?.resume()
            waiting = nil
        }
    }
}
