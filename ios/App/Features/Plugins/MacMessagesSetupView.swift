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

    var body: some View {
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
