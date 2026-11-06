// Rows the Settings tree draws (feedback, links outside the app, the
// system notification switch), Settings > General (quick replies and the
// call voice, kept for old links) and
// Settings > Experimental (SettingsModal.tsx "experimental": the
// installation's early features, an admin pairing only), plus the picker
// rows Appearance gains (list density, activity, home chrome).
import CompanionCore
import MessageUI
import SwiftUI
import UIKit

/// Settings > General: what the root does not carry (#518 folded the
/// phone's settings here; the root now holds them again, the reference design iOS 1.14).
struct GeneralSettingsView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var navigator: SettingsNavigator

    var body: some View {
        SettingsPage(title: "General") {
            SettingsSectionLabel(text: "Chat")
            SettingsCard {
                SettingsRow(title: "Quick Replies", accessory: .chevron, height: 43.67, identifier: "settings-quick-replies") { navigator.sheet = .quickReplies }
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(title: "Call voice", accessory: .chevron, height: 43.67, identifier: "settings-walkie-voice") { navigator.sheet = .walkieVoice }
            }
            SettingsSpacer(40)
        }
    }
}

/// The Send Feedback row, in its card or in the Help card of the root.
struct SettingsFeedbackRow: View {
    @Environment(\.themePalette) var themePalette
    var height: CGFloat? = 44.67
    @State private var composingMail = false

    var body: some View {
        SettingsRow(title: "Send Feedback", accessory: .chevron, height: height, identifier: "settings-feedback") { sendFeedback() }
            .sheet(isPresented: $composingMail) {
                MailComposeSheet(recipient: SettingsLinks.supportEmail, subject: feedbackSubject, body: feedbackBody) {
                    composingMail = false
                }
                .ignoresSafeArea()
            }
    }

    private var feedbackSubject: String { String(localized: "Sagax feedback") }

    private var feedbackBody: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        return "\n\n—\nSagax iOS \(version) (\(build)), iOS \(UIDevice.current.systemVersion)"
    }

    private func sendFeedback() {
        if MFMailComposeViewController.canSendMail() {
            composingMail = true
            return
        }
        var components = URLComponents()
        components.scheme = "mailto"
        components.path = SettingsLinks.supportEmail
        components.queryItems = [URLQueryItem(name: "subject", value: feedbackSubject), URLQueryItem(name: "body", value: feedbackBody)]
        if let url = components.url { UIApplication.shared.open(url) }
    }
}

/// A page outside the app, opened in Safari over Settings.
struct SettingsLinkRow: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.locale) private var locale
    @AppStorage(PrefKey.language) private var language = AppLanguage.system.rawValue
    let title: LocalizedStringKey
    let identifier: String
    let url: (_ french: Bool) -> URL
    @State private var link: URL?

    private var french: Bool {
        (AppLanguage.resolved(language).locale ?? locale).language.languageCode?.identifier == "fr"
    }

    var body: some View {
        SettingsRow(title: title, accessory: .external, height: 44, identifier: identifier) { link = url(french) }
            .sheet(item: Binding(get: { link.map(IdentifiedURL.init) }, set: { link = $0?.url })) { item in
                SafariSheet(url: item.url).ignoresSafeArea()
            }
    }
}

/// The system's notification permission as a switch: on asks iOS, off
/// opens the iOS Settings app (only the person can turn it off).
struct SystemNotificationsRow: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @State private var enabling = false

    var body: some View {
        SettingsRow(
            title: "Allow notifications",
            accessory: .toggle(Binding(get: { Self.isOn(session) }, set: { setNotifications($0) })),
            height: 53.67,
            identifier: "settings-notifications-system"
        )
        .task { await session.refreshNotificationAuthorization() }
    }

    static func isOn(_ session: Session) -> Bool {
        switch session.notificationAuthorization {
        case .authorized, .provisional, .ephemeral: true
        default: false
        }
    }

    private func setNotifications(_ on: Bool) {
        if on {
            guard !enabling else { return }
            enabling = true
            Task {
                await session.enableNotifications()
                enabling = false
            }
        } else if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }
}

// MARK: - Experimental

struct ExperimentalSettingsView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    /// Development context pods: this device only, off by default.
    @AppStorage(DevPodsPrefs.enabled) private var devPods = false
    @State private var config: DesktopSettingsConfig?
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        SettingsPage(title: "Experimental") {
            SettingsFooter(text: "Early features may change while we test them. Each one says whether it starts on or off.")
            SettingsCard {
                feature("skillAuthoring", title: "Bots may draft skills for your review",
                        detail: "On by default. Save a bot's verification run as a skill from the Verify card, or ask a supported bot to run /create-verification-skill. Every change waits for your review.",
                        on: config?.features?.skillAuthoring ?? true)
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                feature("browser", title: "Built-in browser",
                        detail: config?.features?.browser == true
                            ? "Enabled for this installation. Each bot also has its own browser switch."
                            : "Off by default. Enable it to let supported bots use a browser tab you can watch and take over.",
                        on: config?.features?.browser == true)
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                feature("templates", title: "Browse Bots",
                        detail: "Off by default. Shows Browse Bots in the sidebar menu, to find and add ready-made bots and teams.",
                        on: config?.features?.templates == true)
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(
                    title: LocalizedStringKey(DevPodsStrings.settingTitle),
                    subtitle: DevPodsStrings.settingDetail,
                    accessory: .toggle($devPods),
                    identifier: "settings-experimental.devPods"
                )
            }
            if let error {
                SettingsFooter(text: LocalizedStringKey(stringLiteral: error))
            }
            SettingsSpacer(40)
        }
        .task(id: session.connection?.id) {
            guard let client = session.settingsClient else { return }
            do { config = try await client.desktopSettingsConfig() } catch { self.error = error.localizedDescription }
        }
    }

    private func feature(_ key: String, title: LocalizedStringKey, detail: String, on: Bool) -> some View {
        SettingsRow(
            title: title,
            subtitle: detail,
            accessory: .toggle(Binding(get: { on }, set: { value in set(key, value) })),
            identifier: "settings-experimental.\(key)"
        )
        .disabled(saving || config == nil)
    }

    private func set(_ key: String, _ on: Bool) {
        guard let client = session.settingsClient else { return }
        saving = true
        Task {
            defer { saving = false }
            do {
                config = try await client.updateDesktopSettings(.feature(key, on))
                DesktopSidebarFlags.shared.apply(config)
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

// MARK: - Appearance's display pickers

/// List density, activity and home chrome, moved from the old Advanced page:
/// how the home and the chats show things on this phone.
struct DisplaySettingsCard: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    /// Tool calls ("Details"): the desktop's own switch, kept by the server.
    @ObservedObject private var toolCalls = ToolCallsSetting.shared
    @AppStorage(PrefKey.rosterDensity) private var rosterDensity = RosterDensity.default.rawValue
    @AppStorage(PrefKey.updatesButton) private var updatesButton = false
    @AppStorage(PrefKey.rosterChromeAtTop) private var rosterChromeAtTop = false

    var body: some View {
        SettingsSectionLabel(text: "Display")
        SettingsCard {
            Menu {
                Picker(selection: Binding(get: { RosterDensity.shown(stored: rosterDensity) }, set: { rosterDensity = $0.rawValue })) {
                    ForEach(RosterDensity.selectable, id: \.self) { density in
                        Text(LocalizedStringKey(density.label)).tag(density)
                    }
                } label: { EmptyView() }
            } label: {
                SettingsRow(title: "List density", accessory: .valueChevron(String(localized: String.LocalizationValue(RosterDensity.shown(stored: rosterDensity).label))), height: 43.67)
            }
            .accessibilityIdentifier("list-density")
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(
                title: "Updates button",
                subtitle: "A large Updates button at the bottom of the home, to see what the bots did at a glance.",
                accessory: .toggle($updatesButton),
                identifier: "settings.updatesButton"
            )
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(
                title: "Tool calls",
                subtitle: "Show tool calls in chat. Off: the chat shows the messages, a turn's steps fold away. The same switch as on your computer.",
                accessory: .toggle(Binding(get: { toolCalls.showToolCalls }, set: { on in
                    Task { await toolCalls.set(session, on) }
                })),
                identifier: "settings-activity"
            )
            .disabled(toolCalls.saving)
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(
                title: "Search and + at top",
                subtitle: "Place search and the new button at the top of the home instead of the bottom.",
                accessory: .toggle($rosterChromeAtTop),
                identifier: "settings.rosterChromeAtTop"
            )
        }
        if let error = toolCalls.error {
            SettingsFooter(text: LocalizedStringKey(error))
        }
        SettingsFooter(text: LocalizedStringKey(RosterDensity.shown(stored: rosterDensity).caption))
            .task(id: session.connection?.id) { await toolCalls.load(session) }
    }
}
