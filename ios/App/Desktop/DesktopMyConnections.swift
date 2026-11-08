// iPad I-sync: the person's own connections (`settings/MyConnectionsSettings.tsx`),
// organization servers only. Since 2026-10-27 they live in Connect apps,
// one place each: `part: .github` in Sources, `part: .servers` in My
// accounts (the large layout keeps these cards there, with the token field
// and Add an MCP server). Settings > My connections only links there
// (`DesktopMyConnectionsLinks`). What they hold: the person's own GitHub account (a code to
// type at GitHub, a token only under Advanced) and their own MCP servers (an address with no
// sign-in, a token, OAuth, or their GitHub account; or a command that runs
// in their server environment). When an admin manages them, the section is
// read-only under a short notice. A pending GitHub code or sign-in is asked
// again every two seconds. The routes are the server's
// (`/api/me/connections`, `/api/me/github*`, `/api/me/mcp/servers*`); the
// companion sidecar does not list them (`SurfaceFeature.myConnections`).
import SwiftUI
import UIKit
import CompanionCore

@MainActor
final class MyConnectionsModel: ObservableObject {
    @Published var data: MyConnections?
    @Published var error: String?
    @Published var busy: String?
    var client: CompanionClient?

    func refresh() async {
        guard let client else { return }
        do {
            data = try await client.myConnections()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Runs one change, then reads the section again. False when it failed.
    @discardableResult
    func run(_ key: String, _ work: @escaping (CompanionClient) async throws -> Void) async -> Bool {
        guard let client, busy == nil else { return false }
        busy = key
        error = nil
        defer { busy = nil }
        do {
            try await work(client)
            await refresh()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }
}

struct DesktopMyConnectionsSettings: View {
    enum Part { case github, servers }

    /// which card this draws (Connect apps > Sources, or > Providers)
    var part: Part
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @StateObject private var model = MyConnectionsModel()

    var body: some View {
        AnyView(content)
            .task(id: session.connection?.id) {
                model.client = session.profileClient
                await model.refresh()
                // a GitHub code or a sign-in waits: ask again every two seconds
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(2))
                    if model.data?.waiting == true, model.busy == nil { await model.refresh() }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("desktop-settings-my-connections")
    }

    @ViewBuilder
    private var content: some View {
        if let data = model.data {
            VStack(alignment: .leading, spacing: 16) {
                if part == .servers {
                    DesktopText(Text("Your own accounts and MCP servers. Only your conversations and your routines use them; nobody else's turn ever gets them."),
                                line: 21, color: \.inkSecondary)
                }
                if part == .github {
                    AnyView(MyConnectionsGitHubCard(data: data, model: model))
                } else {
                    AnyView(MyConnectionsServersCard(data: data, model: model))
                }
            }
        } else if let error = model.error {
            DesktopText(verbatim: error, size: 12.5, line: 18, color: \.danger)
        } else {
            DesktopText(Text("Loading your connections…"), size: 12.5, line: 18, color: \.inkSecondary)
        }
    }
}

/// Settings > My connections (2026-10-27): one place per option, so this
/// page only says where each one is and opens Connect apps on that tab.
struct DesktopMyConnectionsLinks: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @State private var opening: ConnectAppsTab?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            DesktopText(Text("Your own accounts and MCP servers. Only your conversations and your routines use them; nobody else's turn ever gets them."),
                        line: 21, color: \.inkSecondary)
            link(Text("GitHub"), Text("Connect GitHub with a link and a code: Plugins > Sources."), tab: .sources, identifier: "desktop-my-connections.github")
            link(Text("My MCP servers"), Text("Add, sign in, turn on or off: Plugins > Providers."), tab: .installed, identifier: "desktop-my-connections.servers")
        }
        .sheet(item: $opening) { tab in
            ConnectAppsPage(initialTab: tab)
                .environmentObject(session)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-settings-my-connections")
    }

    private func link(_ title: Text, _ detail: Text, tab: ConnectAppsTab, identifier: String) -> some View {
        DesktopSettingsCard(title, subtitle: detail, identifier: identifier) {
            Button { opening = tab } label: {
                Text(String(localized: "Open in Plugins"))
            }
            .buttonStyle(DesktopButtonStyle(kind: .control))
            .accessibilityIdentifier("\(identifier).open")
        }
    }
}

// MARK: - GitHub

private struct MyConnectionsGitHubCard: View {
    @Environment(\.desktopTheme) private var theme
    @Environment(\.openURL) private var openURL
    let data: MyConnections
    @ObservedObject var model: MyConnectionsModel
    @State private var tokenOpen = false
    @State private var token = ""

    private var github: MyConnections.GitHub { data.github }
    var body: some View {
        DesktopSettingsCard(
            Text("GitHub"),
            subtitle: Text("Clone private repositories, use gh, the GitHub MCP server and private plugin marketplaces as yourself."),
            identifier: "myConnections.github"
        ) {
            VStack(alignment: .leading, spacing: 10) {
                AnyView(state)
                DesktopText(data.sandbox ? Text("Your bots' gh and git use it in your server environment.")
                                         : Text("Your bots use it for the GitHub MCP server and private repositories."),
                            size: 12, line: 19.5, color: \.inkSecondary)
                if let error = model.error {
                    DesktopText(verbatim: error, size: 12, line: 17, color: \.danger)
                }
            }
        }
    }

    @ViewBuilder
    private var state: some View {
        switch github.state {
        case "connected":
            HStack(spacing: 12) {
                DesktopText(Text("Connected as @\(github.login ?? "")"))
                Spacer(minLength: 0)
                pill("Disconnect") { Task { await model.run("gh-off") { try await $0.disconnectGithub() } } }
            }
        case "pending":
            VStack(alignment: .leading, spacing: 8) {
                DesktopText(Text("Type this code at GitHub to connect your account:"), color: \.inkSecondary)
                HStack(spacing: 12) {
                    Text(verbatim: github.userCode ?? "")
                        .font(Theme.mono(18))
                        .tracking(3)
                        .foregroundStyle(theme.ink)
                        .textSelection(.enabled)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    pill("Copy code") { UIPasteboard.general.string = github.userCode }
                    if let uri = github.verificationUri, let url = URL(string: uri), url.scheme == "https" {
                        pill("Open GitHub") { openURL(url) }
                    }
                }
                DesktopText(Text("Waiting for GitHub…"), size: 12, line: 17, color: \.inkSecondary)
            }
        default:
            // owner 2026-11-08 (#2801, as the web #2800): every GitHub
            // connection is GitHub's link plus a code, whatever the server
            // has (its built-in OAuth App); a token is never first, only
            // under a folded "Advanced".
            VStack(alignment: .leading, spacing: 10) {
                if github.state == "error", let error = github.error {
                    DesktopText(verbatim: error, size: 12, line: 17, color: \.danger)
                    DesktopText(Text("Still not working? Advanced, below, lets you paste a GitHub token instead."),
                                size: 12, line: 19.5, color: \.inkSecondary)
                }
                pill(github.state == "error" ? "Try again" : "Connect GitHub", primary: true) {
                    Task { await model.run("gh-device") { try await $0.startGithubDevice() } }
                }
                .accessibilityIdentifier("myConnections.github.connect")
                advanced
            }
        }
    }

    /// Web `data-github-advanced`: a quiet 12 pt toggle, folded by default.
    private var advanced: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { tokenOpen.toggle() } label: {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .rotationEffect(.degrees(tokenOpen ? 90 : 0))
                    Text("Advanced")
                }
                .font(theme.font(12))
                .foregroundStyle(theme.inkSecondary)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(tokenOpen ? [.isSelected, .isButton] : .isButton)
            .accessibilityIdentifier("myConnections.github.advanced")
            if tokenOpen { AnyView(tokenForm) }
        }
    }

    private var tokenForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            SecureField(text: $token, prompt: Text(verbatim: "github_pat_...").foregroundColor(theme.inkSecondary)) {
                Text("GitHub token")
            }
            .font(theme.font(13))
            .foregroundStyle(theme.ink)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .padding(.horizontal, 10)
            .frame(height: 33)
            .background(theme.ink.opacity(0.03), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
            DesktopText(Text("A fine-grained or classic personal access token from github.com/settings/tokens. It is kept encrypted for you only."),
                        size: 12, line: 19.5, color: \.inkSecondary)
            pill("Connect", primary: true, disabled: token.trimmingCharacters(in: .whitespaces).isEmpty) {
                let value = token
                Task {
                    if await model.run("gh-token", { try await $0.connectGithubToken(value) }) {
                        token = ""
                        tokenOpen = false
                    }
                }
            }
        }
    }

    private func pill(_ title: LocalizedStringKey, primary: Bool = false, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        MyConnectionsPill(title: title, primary: primary, disabled: disabled || model.busy != nil, action: action)
    }
}

/// `.ui-button` / `.ui-button-primary`: a 30 pt pill.
private struct MyConnectionsPill: View {
    @Environment(\.desktopTheme) private var theme
    let title: LocalizedStringKey
    var primary = false
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(theme.font(13))
                .foregroundStyle(primary ? theme.app : theme.ink)
                .lineLimit(1)
                .padding(.horizontal, 13)
                .frame(height: 30)
                .background(primary ? theme.ink : theme.hover, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
    }
}

// MARK: - Servers

private struct MyConnectionsServersCard: View {
    @Environment(\.desktopTheme) private var theme
    @Environment(\.openURL) private var openURL
    let data: MyConnections
    @ObservedObject var model: MyConnectionsModel
    @State private var adding = false

    var body: some View {
        DesktopSettingsCard(
            Text("My MCP servers"),
            subtitle: Text("A remote server (an https address) or a command that runs in your server environment, never on the Sagax server."),
            identifier: "myConnections.servers"
        ) {
            VStack(alignment: .leading, spacing: 12) {
                if data.servers.isEmpty {
                    DesktopText(Text("No MCP server of your own yet."), size: 12, line: 17, color: \.inkSecondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(data.servers.enumerated()), id: \.element.name) { index, server in
                            if index > 0 { Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1) }
                            AnyView(row(server))
                        }
                    }
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
                }
                if adding {
                    AnyView(MyConnectionsAddForm(data: data, model: model) { adding = false })
                } else {
                    MyConnectionsPill(title: "Add an MCP server", primary: true) { adding = true }
                }
            }
        }
    }

    private func stateLabel(_ server: MyConnections.Server) -> String {
        switch server.authState {
        case "connected": AppStrings.localized("connected")
        case "ready": AppStrings.localized("ready")
        case "needs_sign_in": AppStrings.localized("sign-in needed")
        case "needs_github": AppStrings.localized("connect GitHub first")
        case "needs_token": AppStrings.localized("token needed")
        case "expired": AppStrings.localized("sign-in expired")
        case "no_environment": AppStrings.localized("no server environment on this server")
        default: AppStrings.localized("error")
        }
    }

    private func row(_ server: MyConnections.Server) -> some View {
        let busy = model.busy != nil
        let place = server.isRemote ? (server.domain ?? "") : String(format: AppStrings.localized("%@ in your server environment"), server.command ?? "")
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: server.name).font(Theme.mono(12.5)).foregroundStyle(theme.ink).lineLimit(1)
                Text(verbatim: "\(place) · \(stateLabel(server))").font(theme.font(11.5)).foregroundStyle(theme.inkSecondary).lineLimit(1)
                if let error = server.authError {
                    Text(verbatim: error).font(theme.font(11.5)).foregroundStyle(theme.danger)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if server.offersSignIn {
                MyConnectionsPill(title: "Sign in", disabled: busy) {
                    Task {
                        var url: URL?
                        await model.run("signin:\(server.name)") { url = try await $0.startPersonalServerSignIn(name: server.name) }
                        if let url { openURL(url) }
                    }
                }
            }
            if server.offersSignOut {
                MyConnectionsPill(title: "Sign out", disabled: busy) {
                    Task { await model.run("out:\(server.name)") { try await $0.disconnectPersonalServer(name: server.name) } }
                }
            }
            DesktopSwitch(isOn: server.enabled, label: Text("Use \(server.name)"), disabled: busy) {
                Task { await model.run("toggle:\(server.name)") { try await $0.setPersonalServerEnabled(name: server.name, enabled: !server.enabled) } }
            }
            MyConnectionsPill(title: "Remove", disabled: busy) {
                Task { await model.run("rm:\(server.name)") { try await $0.removePersonalServer(name: server.name) } }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }
}

private struct MyConnectionsAddForm: View {
    @Environment(\.desktopTheme) private var theme
    let data: MyConnections
    @ObservedObject var model: MyConnectionsModel
    let close: () -> Void

    @State private var command = false
    @State private var name = ""
    @State private var named = false
    @State private var url = ""
    @State private var auth = "oauth"
    @State private var token = ""
    @State private var commandLine = ""
    @State private var args = ""
    @State private var env = ""
    @State private var formError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                MyConnectionsPill(title: "Remote (URL)", primary: !command) { command = false }
                MyConnectionsPill(title: "Command", primary: command, disabled: !data.sandbox) { command = true }
                MyConnectionsPill(title: "GitHub MCP server") {
                    command = false
                    url = MyConnectionsRules.githubMCPURL
                    auth = data.github.state == "connected" ? "github" : "token"
                    if !named { name = "github" }
                }
            }
            field("name (optional)", text: Binding(get: { name }, set: { name = $0; named = true }))
            if command {
                field("npx", text: $commandLine)
                field("-y @modelcontextprotocol/server-github", text: $args)
                field("GITHUB_PERSONAL_ACCESS_TOKEN=...", text: $env, axis: .vertical)
                DesktopText(Text("It runs in your own server environment when one of your turns uses it (npx, uvx and docker images must be available there)."),
                            size: 12, line: 19.5, color: \.inkSecondary)
            } else {
                field("https://example.com/mcp", text: $url)
                HStack(spacing: 8) {
                    DesktopText(Text("Sign-in"), size: 12.5, line: 18, color: \.inkSecondary)
                    DesktopSelect(
                        options: [("oauth", AppStrings.localized("OAuth (sign in)")), ("token", AppStrings.localized("Token")),
                                  ("github", AppStrings.localized("My GitHub account")), ("none", AppStrings.localized("None"))]
                            .filter { $0.0 != "github" || data.github.state == "connected" },
                        selection: auth,
                        label: Text("Sign-in")
                    ) { auth = $0 }
                }
                if auth == "token" {
                    SecureField(text: $token, prompt: Text("Token (sent as Bearer)").foregroundColor(theme.inkSecondary)) { Text("Token") }
                        .modifier(MyConnectionsFieldStyle())
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                if auth == "oauth" {
                    DesktopText(Text("After adding it, click Sign in: the provider's page opens and comes back to this server."),
                                size: 12, line: 19.5, color: \.inkSecondary)
                }
            }
            if let formError {
                DesktopText(verbatim: formError, size: 12, line: 17, color: \.danger)
            }
            HStack(spacing: 8) {
                MyConnectionsPill(title: "Add", primary: true,
                                  disabled: model.busy != nil || (command ? commandLine.trimmingCharacters(in: .whitespaces).isEmpty : url.trimmingCharacters(in: .whitespaces).isEmpty)) {
                    submit()
                }
                MyConnectionsPill(title: "Cancel", action: close)
            }
        }
        .padding(12)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func field(_ placeholder: String, text: Binding<String>, axis: Axis = .horizontal) -> some View {
        TextField("", text: text, prompt: Text(verbatim: placeholder).foregroundColor(theme.inkSecondary), axis: axis)
            .modifier(MyConnectionsFieldStyle())
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
    }

    private func submit() {
        formError = nil
        let finalName = name.trimmingCharacters(in: .whitespaces).isEmpty
            ? MyConnectionsRules.suggestName(command ? commandLine : url)
            : name.trimmingCharacters(in: .whitespaces)
        let server: NewPersonalServer
        if command {
            switch MyConnectionsRules.parseEnv(env) {
            case .failure(let bad):
                formError = String(format: AppStrings.localized("This line is not KEY=value: %@"), bad.line)
                return
            case .success(let parsed):
                server = .command(name: finalName, command: commandLine, args: MyConnectionsRules.parseArgs(args), env: parsed)
            }
        } else {
            server = .remote(name: finalName, url: url, auth: auth, token: auth == "token" ? token : nil)
        }
        Task {
            if await model.run("add", { try await $0.addPersonalServer(server) }) { close() }
        }
    }
}

private struct MyConnectionsFieldStyle: ViewModifier {
    @Environment(\.desktopTheme) private var theme

    func body(content: Content) -> some View {
        content
            .font(theme.font(13))
            .foregroundStyle(theme.ink)
            .tint(theme.focus)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .frame(minHeight: 33)
            .background(theme.ink.opacity(0.03), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
    }
}
