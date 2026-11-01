// Settings (iOS parity 12 and 14): the card sheet the account menu opens.
//
// The Grok Bot layout (2026-10-26): one short list of grouped cards drawn
// from SettingsTree: the profile with Usage, then Bots, Connect apps and
// Published pages, this phone's Notifications, Appearance, Language and
// Haptics, Privacy and security, Help, About and Sign Out. The detail sits
// one level in. The search at the top finds any page and opens it through
// its parents.
// Geometry: measure-settings.md §1 to §4.
import CompanionCore
import SwiftUI
import UIKit
import MessageUI

/// The sheet's pages.
enum SettingsRoute: String, Hashable {
    case account, usage, plugins, rules, approvalGrants, actionJournal, timeZone, botComputer, pages, appearance, language, haptics, general, experimental, notifications, privacy, vault, securityKeys
    // The Grok Bot layout's pages (SettingsTree)
    case bots, privacySecurity, about
    // Settings > Bots > Reach me (#1187)
    case reachMe
    // Settings > Bots > My engines (#1098)
    case myEngines
}

struct SettingsView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @StateObject private var model = SettingsModel()
    @StateObject private var navigator = SettingsNavigator()
    private let onConnect: (() -> Void)?
    private let close: (() -> Void)?

    /// `close` set: the card sheet, with an X. Otherwise pushed inside the
    /// caller's navigation (onboarding), with a back circle.
    ///
    /// The sheet's pages slide in from its own small stack rather than a
    /// NavigationStack: the card sheet sits over the home, whose stack would
    /// take the pushes and draw them full screen.
    init(onConnect: (() -> Void)? = nil, close: (() -> Void)? = nil) {
        self.onConnect = onConnect
        self.close = close
    }

    var body: some View {
        ZStack {
            SettingsRootPage(close: close, onConnect: onConnect)
            ForEach(Array(navigator.routes.enumerated()), id: \.offset) { index, route in
                SettingsRouteView(route: route, onConnect: onConnect, closeSheet: close)
                    .environment(\.settingsPop, { navigator.pop() })
                    .transition(.move(edge: .trailing))
                    .zIndex(Double(index + 1))
                    .gesture(
                        DragGesture(minimumDistance: 20)
                            .onEnded { value in
                                if value.startLocation.x < 30, value.translation.width > 80 { navigator.pop() }
                            }
                    )
            }
        }
        .animation(.spring(response: 0.34, dampingFraction: 0.92), value: navigator.routes)
        // The references were taken with the home indicator auto-hidden.
        .persistentSystemOverlays(ParityMode.isActive ? .hidden : .automatic)
        .environmentObject(model)
        .environmentObject(navigator)
        .sheet(item: $navigator.sheet) { page in
            SettingsSheetPageView(page: page)
                .environmentObject(session)
                .environmentObject(model)
        }
        .task {
            model.attach(session)
            if !Self.initialRoutes.isEmpty, navigator.routes.isEmpty {
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) { navigator.routes = Self.initialRoutes }
            }
            await model.load()
        }
    }

    /// The parity harness opens 15, 16 and 21 one level in; a capture of
    /// any level passes `-paritySettingsRoute bots/rules` (route names,
    /// outermost first) with 12-settings-top.
    private static var initialRoutes: [SettingsRoute] {
#if DEBUG
        if ParityLaunch.current != nil, let path = UserDefaults.standard.string(forKey: "paritySettingsRoute") {
            return path.split(separator: "/").compactMap { SettingsRoute(rawValue: String($0)) }
        }
        switch ParityLaunch.current?.screen {
        case .plugins?: return [.plugins]
        case .account?: return [.account]
        case .botComputer?: return [.botComputer]
        case .appearance?: return [.appearance]
        default: return []
        }
#else
        return []
#endif
    }
}

/// The sheet's page stack, and the pages drawn as lists of their own.
@MainActor
final class SettingsNavigator: ObservableObject {
    @Published var routes: [SettingsRoute] = []
    @Published var sheet: SettingsSheetPage?

    func push(_ route: SettingsRoute) { routes.append(route) }
    func pop() { if !routes.isEmpty { routes.removeLast() } }
}

private struct SettingsPopKey: EnvironmentKey {
    static let defaultValue: (() -> Void)? = nil
}

extension EnvironmentValues {
    /// Back, for a page shown by the sheet's own stack.
    var settingsPop: (() -> Void)? {
        get { self[SettingsPopKey.self] }
        set { self[SettingsPopKey.self] = newValue }
    }
}

// MARK: - Root

private struct SettingsRootPage: View {
    @Environment(\.themePalette) var themePalette
    let close: (() -> Void)?
    let onConnect: (() -> Void)?

    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: SettingsModel
    @EnvironmentObject private var navigator: SettingsNavigator
    @State private var query = ""
    @State private var searching = false

    var body: some View {
        // The search shares the header row with the X: same height (the
        // button's 42), centred on one line.
        SettingsPage(
            leading: close.map { .close($0) } ?? .back,
            contentTop: SettingsMetrics.headerInset + GlassCircleButton.Size.sheet.rawValue + 37,
            trailingFills: searching,
            trailing: {
                // Grok Bot's sheet has the X alone (2026-11-01): search waits
                // behind a round button at the other corner, then takes the row.
                if searching {
                    SettingsSearchField(prompt: "Search", text: $query, identifier: "settings-search",
                                        rowHeight: GlassCircleButton.Size.sheet.rawValue, autoFocus: true) {
                        withAnimation(.snappy(duration: 0.2)) { searching = false }
                    }
                } else {
                    GlassCircleButton(systemImage: "magnifyingglass", size: .sheet, accessibilityLabel: "Search") {
                        withAnimation(.snappy(duration: 0.2)) { searching = true }
                    }
                    .accessibilityIdentifier("settings-search-open")
                }
            }
        ) {
            if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                groupedRoot
                footer
            } else {
                SettingsSearchResults(query: query, open: open)
            }
#if DEBUG
            if ParityLaunch.current?.screen == .settingsBottom {
                ScrollOffsetSetter(offset: 100_000)  // clamped to the end.frame(width: 0, height: 0)
            }
#endif
        }
        .alert("Settings", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(verbatim: model.error ?? "")
        }
        .onReceive(NotificationCenter.default.publisher(for: .NSSystemTimeZoneDidChange)) { _ in
            Task { await model.syncTimeZoneIfAutomatic() }
        }
        .task { await session.refreshNotificationAuthorization() }
    }

    // MARK: Cards

    /// The root's cards (SettingsTree.root); the rows decide which show.
    private var groupedRoot: some View {
        SettingsTreeCards(page: .root, closeSheet: close)
    }

    /// The Pulsatrix logo over "Sagax", then the app version and the
    /// copyright (no server address or server version: Owner, 2026-10-15).
    private var footer: some View {
        VStack(spacing: 0) {
            PulsatrixLogoMark(size: 52)
                .accessibilityIdentifier("settings-brand-logo")
            Text(verbatim: "Sagax")
                .font(Theme.Font.appName)
                .foregroundStyle(Theme.textPrimary)
                .padding(.top, 15.3)
            footerMetadata
                .padding(.top, 14)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60.67)
        .padding(.bottom, 40)
    }

    private var footerMetadata: some View {
        VStack(spacing: 4) {
            Text("Version \(AboutPage.version) (\(AboutPage.build))")
                .accessibilityIdentifier("settings-footer-app-version")
            Text("settings.brandFooter.copyright")
                .accessibilityIdentifier("settings-footer-copyright")
        }
        .font(Theme.Font.label)
        .foregroundStyle(Theme.textSecondary)
        .multilineTextAlignment(.center)
        .padding(.horizontal, SettingsMetrics.cardMargin)
    }

    // MARK: Search

    /// Opens a result through the pages that lead to it, so Back walks
    /// up the tree.
    private func open(_ destination: SettingsDestination) {
        let bots: [SettingsRoute] = [.bots]
        let privacy: [SettingsRoute] = [.privacySecurity]
        switch destination {
        case .general: navigator.routes = [.general]
        case .organization: navigator.sheet = .organization
        case .appearance: navigator.routes = [.appearance]
        case .achievements: navigator.sheet = .achievements
        case .notifications: navigator.routes = [.notifications]
        case .privacy, .privacySecurity: navigator.routes = privacy
        case .experimental: navigator.routes = bots + [.experimental]
        case .plugins: navigator.routes = [.plugins]
        case .account: navigator.routes = [.account]
        case .botComputer: navigator.routes = bots + [.botComputer]
        case .pages: navigator.routes = [.pages]
        case .usage: navigator.routes = [.usage]
        case .rules: navigator.routes = bots + [.rules]
        case .approvalGrants: navigator.routes = bots + [.approvalGrants]
        case .timeZone: navigator.routes = bots + [.timeZone]
        case .language: navigator.routes = [.language]
        case .haptics: navigator.routes = [.haptics]
        case .quickReplies: navigator.routes = bots; navigator.sheet = .quickReplies
        case .walkieVoice: navigator.routes = bots; navigator.sheet = .walkieVoice
        case .about: navigator.routes = [.about]
        case .credentials: navigator.routes = [.vault]
        case .securityKeys: navigator.routes = privacy + [.securityKeys]
        case .bots: navigator.routes = bots
        case .myEngines: navigator.routes = bots + [.myEngines]
        }
    }
}

/// A route's page.
struct SettingsRouteView: View {
    @Environment(\.themePalette) var themePalette
    let route: SettingsRoute
    let onConnect: (() -> Void)?
    let closeSheet: (() -> Void)?

    var body: some View {
        switch route {
        case .account: AccountSettingsView(closeSheet: closeSheet)
        case .usage: UsageSettingsView()
        // Connect apps (#203, #218): the desktop panel's three views
        case .plugins: ConnectAppsPage()
        case .rules: AutoReviewRulesView()
        case .approvalGrants: ApprovalGrantsPage()
        case .actionJournal: ActionJournalPage()
        case .timeZone: TimeZonePickerView()
        case .botComputer: BotComputerSettingsView()
        case .pages: PublishedPagesPage()
        case .appearance: AppearanceSettingsView()
        case .language: LanguageSettingsView()
        case .haptics: HapticsSettingsView()
        case .general: GeneralSettingsView()
        case .experimental: ExperimentalSettingsView()
        case .notifications: NotificationsSettingsView()
        case .privacy: PrivacySettingsView()
        case .vault: VaultSettingsView()
        case .securityKeys: SecurityKeysSettingsView()
        case .bots: BotsSettingsView()
        case .reachMe: ReachMeSettingsPage()
        case .myEngines: SettingsPage(title: "My engines") { MyEnginesSection(style: .phone) }
        case .privacySecurity: PrivacySecuritySettingsView()
        case .about: AboutSettingsView()
        }
    }
}

/// Vertical space between cards.
struct SettingsSpacer: View {
    @Environment(\.themePalette) var themePalette
    let height: CGFloat
    init(_ height: CGFloat) { self.height = height }
    var body: some View { Color.clear.frame(height: height) }
}

// MARK: - Usage

/// Usage (#518): the signed-in person's own cost, by bot and by model.
/// The installation's budget and other people's usage are managed in
/// Sagax Business.
struct UsageSettingsView: View {
    @Environment(\.themePalette) var themePalette

    var body: some View {
        SettingsPage(title: "Usage") {
            PersonalUsageSection()
        }
    }
}

// MARK: - Appearance, language, haptics

struct LanguageSettingsView: View {
    @Environment(\.themePalette) var themePalette
    @AppStorage(PrefKey.language) private var language = AppLanguage.system.rawValue

    var body: some View {
        SettingsPage(title: "Language") {
            SettingsCard {
                ForEach(Array(AppLanguage.allCases.enumerated()), id: \.element) { index, option in
                    if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                    SettingsRow(title: option.label, accessory: language == option.rawValue ? .check : .none, identifier: "language.\(option.rawValue)") {
                        language = option.rawValue
                    }
                }
            }
            SettingsFooter(text: "Changes the language inside Sagax. Buttons drawn by iOS itself follow the phone's language.")
        }
    }
}

struct HapticsSettingsView: View {
    @Environment(\.themePalette) var themePalette
    @AppStorage(PrefKey.haptics) private var haptics = true

    var body: some View {
        SettingsPage(title: "Haptics") {
            SettingsCard {
                SettingsRow(title: "On", accessory: haptics ? .check : .none, identifier: "haptics.on") { haptics = true }
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(title: "Off", accessory: haptics ? .none : .check, identifier: "haptics.off") { haptics = false }
            }
            SettingsFooter(text: "Small taps when you press buttons, switch options and send.")
            // Notification sounds moved to Settings > Notifications (#222)
        }
    }
}

struct ConnectionSecurityView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var confirmingSignOut = false
    @State private var editingAddress = false
    @State private var addressText = ""
    @State private var showingFullAddress = false
    @State private var copiedAddress = false
    @State private var refreshing = false

    var body: some View {
        ThemedForm {
            if let connection = session.connection {
                Section {
                    HStack(spacing: 14) {
                        ProfileAvatar(name: connection.name, size: 46)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(connection.name)
                                .font(.headline)
                            Label {
                                session.status.settingsText
                            } icon: {
                                Image(systemName: session.status == .live ? "checkmark.circle.fill" : "circle.dotted")
                            }
                                .font(.subheadline)
                                .foregroundStyle(session.status == .live ? Theme.success : Theme.textSecondary)
                        }
                    }
                    .padding(.vertical, 4)
                    .accessibilityElement(children: .combine)
                }

                Section {
                    DisclosureGroup("Connection details") {
                        VStack(alignment: .leading, spacing: 12) {
                            Group {
                                if showingFullAddress {
                                    Text(connection.displayAddress)
                                        .textSelection(.enabled)
                                } else {
                                    Text(shortened(connection.displayAddress))
                                        .lineLimit(1)
                                        .truncationMode(.middle)
                                }
                            }
                            .font(.footnote.monospaced())
                            .foregroundStyle(Theme.textSecondary)

                            HStack(spacing: 16) {
                                Button(showingFullAddress ? "Hide full address" : "Show full address") {
                                    showingFullAddress.toggle()
                                }
                                Button(copiedAddress ? "Copied" : "Copy") {
                                    UIPasteboard.general.string = connection.displayAddress
                                    copiedAddress = true
                                    Task {
                                        try? await Task.sleep(for: .seconds(2))
                                        copiedAddress = false
                                    }
                                }
                            }
                            .font(.subheadline.weight(.medium))
                        }
                        .padding(.top, 10)
                    }

                    Button("Edit address") {
                        addressText = connection.displayAddress
                        editingAddress = true
                    }
                }

                Section("Troubleshooting") {
                    troubleshootingText
                        .font(.subheadline)
                        .foregroundStyle(Theme.textSecondary)

                    Button {
                        refreshing = true
                        Task {
                            await session.refresh()
                            refreshing = false
                        }
                    } label: {
                        HStack {
                            Text("Try reconnecting")
                            if refreshing {
                                Spacer()
                                ProgressView().controlSize(.small)
                            }
                        }
                    }
                    .disabled(refreshing)
                }

                Section {
                    Button("Remove connection from this device", role: .destructive) {
                        confirmingSignOut = true
                    }
                }
            } else {
                EmptyStateView("No computer connected", systemImage: "laptopcomputer.slash")
            }
        }
        .navigationTitle("Connection & Security")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Edit address", isPresented: $editingAddress) {
            TextField("Computer address", text: $addressText)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("Save") {
                if !session.updateAddress(addressText) {
                    session.actionError = "That address doesn't look right. Copy it from Phone settings and try again."
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Use the address shown in Phone settings on your computer. Your pairing is kept.")
        }
        .confirmationDialog(
            "Remove this connection?",
            isPresented: $confirmingSignOut,
            titleVisibility: .visible
        ) {
            Button("Remove from this device", role: .destructive) {
                session.signOut()
                dismiss()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes the connection from this device only. It does not revoke this device on your Mac. To remove Mac-side access, open Sagax, then Settings, then Phone and remove it there.")
        }
    }

    /// Our copy, except for `.offline`, whose text the computer itself sent and
    /// which is shown exactly as it arrived.
    private var troubleshootingText: Text {
        switch session.status {
        case .live:
            return Text("This computer is connected and responding normally.")
        case .connecting:
            return Text("Sagax is trying the saved connection automatically.")
        case let .offline(reason):
            return Text(verbatim: reason)
        case .unauthorized:
            return Text("This device was removed from the computer. Pair it again to reconnect.")
        case .unpaired:
            return Text("This device is not paired with a computer.")
        }
    }

    private func shortened(_ address: String) -> String {
        guard address.count > 14 else { return address }
        let leadingCount = min(20, max(8, address.count - 8))
        return "\(address.prefix(leadingCount))…\(address.suffix(6))"
    }
}

private extension Session.Status {
    var settingsText: Text {
        switch self {
        case .live: return Text("Connected")
        case .connecting: return Text("Connecting…")
        case .unpaired: return Text("Not paired")
        case .unauthorized: return Text("Needs pairing")
        case .offline: return Text("Offline")
        }
    }
}
