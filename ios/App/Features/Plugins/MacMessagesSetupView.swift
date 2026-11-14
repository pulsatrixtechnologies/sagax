// Connect apps > Mac > Messages on iPhone/iPad.
// Same steps as the desktop MessagesSetupView. Permissions open on the Mac
// host when /api/messages answers; otherwise the person is sent to the Mac app.
import SwiftUI
import CompanionCore

struct MacAppsPage: View {
    let push: (ConnectAppsRoute) -> Void
    @State private var status: MessagesSetupStatus?

    var body: some View {
        List {
            Section {
                Text(String(localized: "Apps that use this Mac directly. They stay on your computer and never run on a shared or cloud machine."))
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                    .listRowBackground(Color.clear)
            }
            Section {
                Button { push(.macMessages) } label: {
                    HStack(spacing: 12) {
                        PluginsGlyphTile(systemImage: "message.fill", size: 34)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(String(localized: "Messages"))
                                .foregroundStyle(Theme.textPrimary)
                            Text(verbatim: MacMessagesCopy.rowSubtitle(status))
                                .font(.footnote)
                                .foregroundStyle(Theme.textSecondary)
                                .lineLimit(2)
                        }
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("connect-apps-mac-messages")
            } header: {
                Text(String(localized: "This Mac"))
            }
        }
        .navigationTitle(String(localized: "Mac"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await refresh() }
    }

    @EnvironmentObject private var session: Session

    private func refresh() async {
        guard let client = session.settingsClient else { return }
        status = try? await client.messagesSetup()
    }
}

struct MacMessagesSetupView: View {
    @EnvironmentObject private var session: Session
    @State private var status: MessagesSetupStatus?
    @State private var error: String?
    @State private var busy = false
    @State private var test: MessagesSetupTestResult?
    @State private var tested = false
    @State private var testOk = false

    var body: some View {
        List {
            if let error {
                Section {
                    Text(verbatim: error).font(.footnote).foregroundStyle(Theme.danger)
                }
            }
            if busy && status == nil {
                Section {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text(String(localized: "Loading Messages setup…"))
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            if let status, !status.available {
                unavailable(status)
            }
            if let status, status.available {
                intro
                steps(status)
            }
        }
        .navigationTitle(String(localized: "Set up Messages on your Mac"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await refresh() }
        .refreshable { await refresh() }
        .accessibilityIdentifier("mac-messages-setup")
    }

    @ViewBuilder
    private func unavailable(_ status: MessagesSetupStatus) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Text(String(localized: "Messages is not available here"))
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Theme.textPrimary)
                Text(verbatim: MacMessagesCopy.unavailableBody(status.reason))
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                Text(String(localized: "Open Sagax on your Mac, then go to Connect apps, Mac, Messages."))
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
            }
            .padding(.vertical, 4)
        }
    }

    private var intro: some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 12) {
                    PluginsGlyphTile(systemImage: "message.fill", size: 40)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(String(localized: "Messages on this Mac"))
                            .font(.body.weight(.semibold))
                        Text(String(localized: "Choose what Sagax can do with Messages on this Mac. macOS asks you to confirm each permission, and you can change this anytime."))
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                capabilityCard(
                    title: String(localized: "Read texts"),
                    body: String(localized: "Lets your bots catch up on conversations, find an older message, or look at a photo someone sent. Needs Full Disk Access so Sagax can read chat.db on this Mac.")
                )
                capabilityCard(
                    title: String(localized: "Send texts"),
                    body: String(localized: "Lets your bots reply or text someone when asked. Each send follows your approval level and the bot's allowed recipients. Needs Automation for Messages.")
                )
            }
            .padding(.vertical, 4)
        }
    }

    @ViewBuilder
    private func steps(_ status: MessagesSetupStatus) -> some View {
        let permissions = status.permissions
        let useMessages = status.useMessages
        Section {
            Text(String(localized: "Your Mac asks you to confirm each permission. Open System Settings, grant access to Sagax, then return here."))
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
            permissionRow(
                title: String(localized: "Full Disk Access"),
                body: String(localized: "macOS keeps texts in a protected folder that only Full Disk Access can open. Sagax uses it only to read Messages on this Mac."),
                state: permissions.fullDiskAccess,
                step: messagesStepState(step: .fullDiskAccess, permissions: permissions, useMessages: useMessages, tested: tested, testOk: testOk),
                pane: .fullDiskAccess
            )
            permissionRow(
                title: String(localized: "Automation for Messages"),
                body: String(localized: "Sending goes through the Messages app on this Mac. Turn on Messages under Sagax in Privacy and Security, Automation."),
                state: permissions.automation,
                step: messagesStepState(step: .automation, permissions: permissions, useMessages: useMessages, tested: tested, testOk: testOk),
                pane: .automation
            )
            testRow(permissions: permissions)
            enableRow(status)
        } header: {
            Text(String(localized: "Permissions and checks"))
        }
    }

    private func capabilityCard(title: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: title).font(.subheadline.weight(.medium))
            Text(verbatim: body).font(.footnote).foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Theme.inset, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    @ViewBuilder
    private func permissionRow(
        title: String,
        body: String,
        state: MessagesPermissionState,
        step: MessagesSetupStepState,
        pane: MessagesPrivacyPane
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                stepMark(step)
                Text(verbatim: title).font(.subheadline.weight(.medium))
                Spacer()
                Text(verbatim: MacMessagesCopy.permissionLabel(state))
                    .font(.caption)
                    .foregroundStyle(state == .granted ? Theme.success : state == .denied ? Theme.danger : Theme.textSecondary)
            }
            Text(verbatim: body).font(.footnote).foregroundStyle(Theme.textSecondary)
            if state != .granted {
                Button {
                    Task { await openPane(pane) }
                } label: {
                    Text(String(localized: "Open System Settings"))
                }
                .disabled(busy)
                .accessibilityIdentifier("mac-messages-open-\(pane.rawValue)")
            }
        }
        .padding(.vertical, 4)
        .accessibilityIdentifier("mac-messages-step-\(pane.rawValue)")
    }

    @ViewBuilder
    private func testRow(permissions: MessagesSetupPermissions) -> some View {
        let step = messagesStepState(
            step: .test,
            permissions: permissions,
            useMessages: status?.useMessages == true,
            tested: tested,
            testOk: testOk
        )
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                stepMark(step)
                Text(String(localized: "Test a read")).font(.subheadline.weight(.medium))
            }
            Text(String(localized: "Reads how many recent conversation names Sagax can see. It never logs message content."))
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
            Button {
                Task { await runTest() }
            } label: {
                if busy { ProgressView() }
                Text(String(localized: "Run test"))
            }
            .disabled(busy || permissions.fullDiskAccess != .granted)
            .accessibilityIdentifier("mac-messages-test")
            if let test {
                Text(verbatim: MacMessagesCopy.testResult(test.conversationCount))
                    .font(.footnote)
                    .accessibilityIdentifier("mac-messages-test-result")
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func enableRow(_ status: MessagesSetupStatus) -> some View {
        let step = messagesStepState(
            step: .enable,
            permissions: status.permissions,
            useMessages: status.useMessages,
            tested: tested,
            testOk: testOk
        )
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                stepMark(step)
                Toggle(isOn: Binding(
                    get: { status.useMessages },
                    set: { next in Task { await toggle(next) } }
                )) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(String(localized: "Allow Sagax to use Messages"))
                        Text(String(localized: "Off until you turn it on. Your bots get read_messages and send_message only on this Mac after that."))
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                .disabled(busy)
                .accessibilityIdentifier("mac-messages-enable")
            }
            Text(String(localized: "Sends still follow your approval rules and each bot's allowed recipients. Turn this off anytime."))
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
        }
        .padding(.vertical, 4)
    }

    private func stepMark(_ state: MessagesSetupStepState) -> some View {
        Image(systemName: state == .done ? "checkmark.circle.fill" : state == .blocked ? "xmark.circle.fill" : "circle")
            .foregroundStyle(state == .done ? Theme.success : state == .blocked ? Theme.danger : Theme.textSecondary)
            .accessibilityHidden(true)
    }

    private func refresh() async {
        error = nil
        busy = status == nil
        defer { busy = false }
        guard let client = session.settingsClient else {
            status = MessagesSetupStatus(
                available: false,
                onThisMac: false,
                reason: .webOrRemote,
                permissions: MessagesSetupPermissions(fullDiskAccess: .unsupported, automation: .unsupported)
            )
            return
        }
        do {
            status = try await client.messagesSetup()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func openPane(_ pane: MessagesPrivacyPane) async {
        busy = true
        error = nil
        defer { busy = false }
        guard let client = session.settingsClient else { return }
        do {
            _ = try await client.openMessagesPermissionPane(pane)
            status = try await client.messagesSetup()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func runTest() async {
        busy = true
        error = nil
        defer { busy = false }
        guard let client = session.settingsClient else { return }
        do {
            let result = try await client.testMessagesSetup()
            test = result
            tested = true
            testOk = true
            status = try await client.messagesSetup()
        } catch {
            tested = true
            testOk = false
            self.error = error.localizedDescription
        }
    }

    private func toggle(_ next: Bool) async {
        guard var current = status else { return }
        let previous = current.useMessages
        current.useMessages = next
        status = current
        busy = true
        error = nil
        defer { busy = false }
        guard let client = session.settingsClient else { return }
        do {
            status = try await client.setMessagesEnabled(next)
        } catch {
            current.useMessages = previous
            status = current
            self.error = error.localizedDescription
        }
    }
}

/// Compact Mac section for Connect apps > Installed.
struct MacAppsInstalledSection: View {
    let push: (ConnectAppsRoute) -> Void
    @State private var status: MessagesSetupStatus?
    @EnvironmentObject private var session: Session
    @Environment(\.capabilitiesDesktop) private var desktop
    @Environment(\.desktopTheme) private var theme

    var body: some View {
        if desktop { desktopBody } else { phoneBody }
    }

    /// MacAppsView.tsx `MacAppsInstalledSection`: "This Mac" 13 semibold,
    /// See all in the accent's text colour, Messages in a rounded-2xl card
    /// (a border, the card's fill), its 32 pt accent tile.
    private var desktopBody: some View {
        VStack(alignment: .leading, spacing: 8) {
            AnyView(desktopHeading)
            AnyView(desktopMessagesRow)
        }
        .padding(.top, 16)
        .padding(.bottom, 8)
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .task { await refresh() }
    }

    private var desktopHeading: some View {
        let ink: Color = theme.ink
        let link: Color = theme.accentText
        return HStack {
            Text("This Mac").font(theme.font(13, .semibold)).foregroundStyle(ink)
            Spacer()
            Button { push(.mac) } label: {
                Text("See all").font(theme.font(12, .medium)).foregroundStyle(link)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("connect-apps-mac-see-all")
        }
    }

    private var desktopMessagesRow: some View {
        let accent: Color = theme.accent
        let ink: Color = theme.ink
        let secondary: Color = theme.inkSecondary
        let card: Color = theme.card
        let border: Color = theme.border
        let subtitle: String = MacMessagesCopy.rowSubtitle(status)
        let tile = DesktopIconView(icon: .messageSquare, size: 16)
            .foregroundStyle(accent)
            .frame(width: 32, height: 32)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(accent.opacity(0.15)))
        let texts = VStack(alignment: .leading, spacing: 1) {
            Text("Messages").font(theme.font(13, .medium)).foregroundStyle(ink).lineLimit(1)
            Text(verbatim: subtitle).font(theme.font(11.5)).foregroundStyle(secondary).lineLimit(1)
        }
        return Button { push(.macMessages) } label: {
            HStack(spacing: 12) {
                tile
                texts
                Spacer(minLength: 8)
                DesktopIconView(icon: .chevronRight, size: 15).foregroundStyle(secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(card))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(border, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("connect-apps-installed-mac-messages")
    }

    private var phoneBody: some View {
        Section {
            Button { push(.macMessages) } label: {
                HStack(spacing: 12) {
                    PluginsGlyphTile(systemImage: "message.fill", size: 34)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(String(localized: "Messages"))
                            .foregroundStyle(Theme.textPrimary)
                        Text(verbatim: MacMessagesCopy.rowSubtitle(status))
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(2)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Theme.textSecondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("connect-apps-installed-mac-messages")
        } header: {
            HStack {
                Text(String(localized: "This Mac"))
                Spacer()
                Button(String(localized: "See all")) { push(.mac) }
                    .font(.footnote)
                    .foregroundStyle(Theme.accent)
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("connect-apps-mac-see-all")
            }
        }
        .task { await refresh() }
    }

    private func refresh() async {
        guard let client = session.settingsClient else { return }
        status = try? await client.messagesSetup()
    }
}

enum MacMessagesCopy {
    static func rowSubtitle(_ status: MessagesSetupStatus?) -> String {
        switch messagesMacRowState(status) {
        case .on: String(localized: "On for your bots on this Mac")
        case .unavailable: String(localized: "Set up in the Sagax app on your Mac")
        case .off, .unknown: String(localized: "Off until you turn it on")
        }
    }

    static func permissionLabel(_ state: MessagesPermissionState) -> String {
        switch state {
        case .granted: String(localized: "Granted")
        case .denied: String(localized: "Turned off in System Settings")
        case .notAsked: String(localized: "Not asked yet")
        case .unsupported: String(localized: "Not on this computer")
        case .unknown: String(localized: "Checking…")
        }
    }

    static func unavailableBody(_ reason: MessagesSetupUnavailableReason?) -> String {
        switch reason {
        case .organizationServer:
            String(localized: "Messages stays on your own Mac app. An organization server never opens your chat.db.")
        case .notDarwin:
            String(localized: "Messages setup needs the Sagax Mac app.")
        default:
            String(localized: "Messages setup is only on the Mac where Sagax runs for you.")
        }
    }

    static func testResult(_ count: Int) -> String {
        if count == 1 {
            return String(localized: "Found 1 recent conversation name.")
        }
        return String(localized: "Found \(count) recent conversation names.")
    }
}


/// Connect apps > Installed, on the phone: the Apple apps this iPhone can
/// offer a bot. "This Mac" stays in the Mac app. iOS does not let an app
/// read or send iMessage, so Messages is explained and not a switch.
struct PhoneIntegrationsSection: View {
    /// In the iPad desktop window (a plain stack, no list rows) the tools are
    /// the window's settings rows: a list Toggle there has no row to sit in
    /// and the switches pile up (#4213).
    @Environment(\.capabilitiesDesktop) private var desktop
    @Environment(\.desktopTheme) private var theme
    @State private var disabled = PhoneToolCenter.disabled

    private var tools: [PhoneTool] {
        let preferred: [PhoneTool] = [.calendar, .reminders, .contacts, .photos, .shortcut, .alarms, .home, .location, .clipboard, .status]
        let have = Set(preferred.map(\.rawValue))
        let rest = PhoneTool.allCases.filter { !$0.fromComputer && !have.contains($0.rawValue) }
        return preferred + rest
    }

    var body: some View {
        if desktop { desktopBody } else { phoneBody }
    }

    /// The window's settings group (`SettingsGroup`): the Messages line, then
    /// one compact row per tool, its glyph and name at the left and the
    /// window's switch at the right, the note under the card.
    private var desktopBody: some View {
        VStack(alignment: .leading, spacing: 8) {
            DesktopSettingsGroup(Text("This iPhone"), identifier: "connect-apps-phone") {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "message.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(theme.inkSecondary)
                        .frame(width: 18, height: 18)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        DesktopText(Text("Messages"))
                        DesktopText(Text("iOS does not let an app read or send iMessage. That connection stays in the Sagax app on your Mac."),
                                    size: 12, line: 16, color: \.inkSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("connect-apps-phone-messages")
                ForEach(tools) { tool in
                    let on = !disabled.contains(tool.rawValue)
                    HStack(spacing: 20) {
                        HStack(spacing: 10) {
                            Image(systemName: PhoneToolWords.symbol(tool))
                                .font(.system(size: 13))
                                .foregroundStyle(theme.inkSecondary)
                                .frame(width: 18, height: 18)
                                .accessibilityHidden(true)
                            DesktopText(verbatim: PhoneToolWords.name(tool))
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        DesktopSwitch(isOn: on, label: Text(verbatim: PhoneToolWords.name(tool)),
                                      identifier: "connect-apps-phone-\(tool.rawValue)") {
                            binding(tool).wrappedValue = !on
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .frame(minHeight: 44)
                }
            }
            DesktopText(Text("Turn on what your bots may ask this iPhone for. You still approve each request in the app."),
                        size: 12, line: 16, color: \.inkSecondary)
                .padding(.horizontal, 4)
        }
        .padding(.top, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var phoneBody: some View {
        Section {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "message.fill")
                    .frame(width: 28)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(String(localized: "Messages"))
                        .foregroundStyle(Theme.textPrimary)
                    Text(String(localized: "iOS does not let an app read or send iMessage. That connection stays in the Sagax app on your Mac."))
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("connect-apps-phone-messages")
            ForEach(tools) { tool in
                Toggle(isOn: binding(tool)) {
                    Label(PhoneToolWords.name(tool), systemImage: PhoneToolWords.symbol(tool))
                }
                .accessibilityIdentifier("connect-apps-phone-\(tool.rawValue)")
            }
        } header: {
            Text(String(localized: "This iPhone"))
        } footer: {
            Text(String(localized: "Turn on what your bots may ask this iPhone for. You still approve each request in the app."))
        }
    }

    private func binding(_ tool: PhoneTool) -> Binding<Bool> {
        Binding(
            get: { !disabled.contains(tool.rawValue) },
            set: { on in
                PhoneToolCenter.setEnabled(tool, on)
                disabled = PhoneToolCenter.disabled
                Task { await PhoneToolCenter.shared.register() }
            }
        )
    }
}
