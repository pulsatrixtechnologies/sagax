// The person's own connections on the phone (#218; matrix DC39, P2-4), on an
// organization server. Since 2026-10-27 each has one place, as on the
// desktop (`MyConnectionsSettings.tsx`): `part: .github` in Connect apps >
// Sources, `part: .servers` in Providers. The person's own GitHub account
// and their own MCP servers, read
// from `GET /api/me/connections` (the server never sends a token back):
// GitHub connected as @login with Disconnect, a code to type at GitHub while
// it waits, Connect GitHub when the server offers the device flow; each
// server with its address and state, a switch to use it, Sign in or Sign out
// for OAuth, Remove. An administrator's management makes the section read
// only. A waiting code or sign-in is asked again every two seconds.
//
// Adding a server or pasting a GitHub token needs a keyboard and a secret:
// that stays on the computer (and the large layout's Settings), as Add
// manually and Paste config do in Manage.
import CompanionCore
import SwiftUI
import UIKit

struct YourConnectionsSection: View {
    enum Part { case github, servers }

    /// which half this section draws
    var part: Part
    @Environment(\.themePalette) var themePalette
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var session: Session
    @StateObject private var model = MyConnectionsModel()
    @State private var removing: String?
    @State private var disconnectingGithub = false

    var body: some View {
        Section {
            content
        } header: {
            Text(part == .github ? "GitHub" : String(localized: "My MCP servers"))
        } footer: {
            if part == .servers {
                Text(String(localized: "Your own accounts and MCP servers. Only your conversations and your routines use them; nobody else's turn ever gets them."))
            }
        }
        .task(id: session.connection?.id) {
            model.client = session.profileClient
            await model.refresh()
            // a GitHub code or a sign-in waits: ask again every two seconds
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                if model.data?.waiting == true, model.busy == nil { await model.refresh() }
            }
        }
        .confirmationDialog(
            String(localized: "Remove \(removing ?? "")?"),
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            titleVisibility: .visible
        ) {
            Button(String(localized: "Remove"), role: .destructive) {
                if let name = removing { Task { await model.run("rm:\(name)") { try await $0.removePersonalServer(name: name) } } }
            }
        } message: {
            Text(String(localized: "Your bots stop using it in your conversations and routines."))
        }
        .confirmationDialog(
            String(localized: "Disconnect GitHub?"),
            isPresented: $disconnectingGithub,
            titleVisibility: .visible
        ) {
            Button(String(localized: "Disconnect"), role: .destructive) {
                Task { await model.run("gh-off") { try await $0.disconnectGithub() } }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if let data = model.data {
            if part == .github {
                github(data)
            } else {
                if data.servers.isEmpty {
                    Text(String(localized: "No MCP server of your own yet."))
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("your-connections-none")
                }
                ForEach(data.servers) { server in
                    row(server)
                }
            }
            if let error = model.error {
                Text(verbatim: error)
                    .font(.footnote)
                    .foregroundStyle(Theme.destructive)
            }
        } else if let error = model.error {
            Text(verbatim: error).font(.footnote).foregroundStyle(Theme.destructive)
        } else {
            Text(String(localized: "Loading your connections…"))
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
        }
    }

    // MARK: GitHub

    @ViewBuilder
    private func github(_ data: MyConnections) -> some View {
        let github = data.github
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: "GitHub").foregroundStyle(Theme.textPrimary)
                    Group {
                        switch github.state {
                        case "connected": Text(String(localized: "Connected as @\(github.login ?? "")"))
                        case "pending": Text(String(localized: "Type this code at GitHub to connect your account:"))
                        default: Text(String(localized: "GitHub is not connected."))
                        }
                    }
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 8)
                if github.state == "connected" {
                    Button(String(localized: "Disconnect"), role: .destructive) { disconnectingGithub = true }
                        .buttonStyle(.borderless)
                        .disabled(model.busy != nil)
                        .accessibilityIdentifier("your-connections-github-disconnect")
                } else if github.state != "pending" {
                    // Link plus code on every server (#2801): Sagax has a built-in OAuth App.
                    Button(github.state == "error" ? String(localized: "Try again") : String(localized: "Connect GitHub")) {
                        Task { await model.run("gh-device") { try await $0.startGithubDevice() } }
                    }
                    .buttonStyle(.borderless)
                    .disabled(model.busy != nil)
                    .accessibilityIdentifier("your-connections-github-connect")
                }
            }
            if github.state == "pending" {
                HStack(spacing: 12) {
                    Text(verbatim: github.userCode ?? "")
                        .font(Theme.mono(18))
                        .tracking(3)
                        .textSelection(.enabled)
                        .foregroundStyle(Theme.textPrimary)
                    Spacer(minLength: 8)
                    Button(String(localized: "Copy code")) { UIPasteboard.general.string = github.userCode }
                        .buttonStyle(.borderless)
                    if let uri = github.verificationUri, let url = URL(string: uri), url.scheme == "https" {
                        Button(String(localized: "Open GitHub")) { openURL(url) }
                            .buttonStyle(.borderless)
                    }
                }
            }
            if github.state == "error", let error = github.error {
                Text(verbatim: error).font(.footnote).foregroundStyle(Theme.destructive)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("your-connections-github")
    }

    // MARK: Servers

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
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: server.name)
                        .font(.system(.body, design: .monospaced))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    Text(verbatim: "\(place) · \(stateLabel(server))")
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(2)
                    if let error = server.authError {
                        Text(verbatim: error).font(.footnote).foregroundStyle(Theme.destructive)
                    }
                }
                Spacer(minLength: 8)
                Toggle(isOn: Binding(get: { server.enabled }, set: { on in
                    Task { await model.run("toggle:\(server.name)") { try await $0.setPersonalServerEnabled(name: server.name, enabled: on) } }
                })) {
                    Text(String(localized: "Use \(server.name)"))
                }
                .labelsHidden()
                .disabled(busy)
                .accessibilityIdentifier("your-connections-toggle.\(server.name)")
            }
            HStack(spacing: 16) {
                if server.offersSignIn {
                    Button(String(localized: "Sign in")) {
                        Task {
                            var url: URL?
                            await model.run("signin:\(server.name)") { url = try await $0.startPersonalServerSignIn(name: server.name) }
                            if let url { openURL(url) }
                        }
                    }
                    .disabled(busy)
                    .accessibilityIdentifier("your-connections-sign-in.\(server.name)")
                }
                if server.offersSignOut {
                    Button(String(localized: "Sign out")) {
                        Task { await model.run("out:\(server.name)") { try await $0.disconnectPersonalServer(name: server.name) } }
                    }
                    .disabled(busy)
                    .accessibilityIdentifier("your-connections-sign-out.\(server.name)")
                }
                Button(String(localized: "Remove"), role: .destructive) { removing = server.name }
                    .disabled(busy)
                    .accessibilityIdentifier("your-connections-remove.\(server.name)")
            }
            .buttonStyle(.borderless)
            .font(.footnote)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("your-connections-server.\(server.name)")
    }
}
