// iPad I5: Plugins as the desktop's modal (src/components/PluginsPanel.tsx):
// `min(800, 100vw-40)` by `min(700, 100dvh-96)` on the elevated fill, the
// title, the MCP servers page, and the person's own claude.ai connectors.
// The data and actions are the phone's (McpServersModel,
// HarnessConnectorsModel, WP9); what a pairing may do follows SurfaceGate:
// signing in to MCP servers for a sidecar or an admin, the Claude Code switch
// and an MCP server's test, on/off and removal for an admin. Adding or editing
// an MCP server stays on the computer (it runs a command there).
import SwiftUI
import UIKit
import CompanionCore

struct DesktopPluginsModal: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var shell: DesktopShellModel
    @StateObject private var mcp = McpServersModel()
    @StateObject private var harness = HarnessConnectorsModel()
    @StateObject private var settings = DesktopSettingsModel()
    let close: () -> Void

    private var tabs: [DesktopPluginsTab] { DesktopPluginsTab.available(for: session.surfaceGate) }

    var body: some View {
        DesktopModalFrame(width: 800, background: \.elevated, close: close) {
            VStack(alignment: .leading, spacing: 0) {
                header
                if tabs.isEmpty {
                    DesktopText("MCP servers are managed by an admin of this server.", color: \.inkSecondary)
                        .padding(.horizontal, 32)
                        .padding(.top, 20)
                    Spacer(minLength: 0)
                } else {
                    ScrollView {
                        DesktopMcpServersPage()
                            .padding(.horizontal, 32)
                            .padding(.top, 20)
                            .padding(.bottom, 24)
                    }
                    .scrollIndicators(.hidden)
                }
            }
        }
        .environmentObject(mcp)
        .environmentObject(harness)
        .environmentObject(settings)
        .task {
            settings.attach(session)
            async let config: Void = settings.load()
            async let servers: Void = mcp.load(session.settingsClient)
            async let connectors: Void = loadHarness()
            _ = await (config, servers, connectors)
        }
        .onDisappear {
            mcp.stopAll()
        }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .accessibilityIdentifier("desktop-plugins")
    }

    private func loadHarness() async {
        guard session.surfaceGate.allows(.harnessConnectors) else { return }
        await harness.load(session.settingsClient)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 4) {
            VStack(alignment: .leading, spacing: 4) {
                DesktopText("Plugins", size: 17, weight: .semibold, line: 24, tracking: -0.136)
                    .accessibilityAddTraits(.isHeader)
                DesktopText("Your own MCP tools and claude.ai connectors.", line: 19.5, color: \.inkSecondary)
            }
            Spacer(minLength: 0)
            DesktopCloseButton(label: "Close plugins", identifier: "desktop-plugins.close", action: close)
        }
        .padding(.leading, 32)
        .padding(.trailing, 32)
        .padding(.top, 24)
    }
}

/// "Provided by Claude (your account)" (`HarnessConnectorsSection.tsx`).
struct DesktopHarnessConnectorsBox: View {
    @Environment(\.desktopTheme) private var theme
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var harness: HarnessConnectorsModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    DesktopText("Provided by Claude (your account)", weight: .semibold, line: 19.5)
                    DesktopText("The connectors of your own claude.ai account reach your Claude bots when they run on your Claude subscription. They act as you, with your access.",
                                size: 12, line: 19.5, color: \.inkSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Button { Task { await harness.load(session.settingsClient, refresh: true) } } label: {
                    DesktopSettingsIconView(icon: .refreshCw, size: 15)
                        .foregroundStyle(theme.inkSecondary)
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(DesktopHoverFill(radius: 8))
                .disabled(harness.loading)
                .opacity(harness.loading ? 0.5 : 1)
                .accessibilityLabel(Text("Check again"))
                .padding(.trailing, -8)
                Button {
                    if let url = URL(string: harness.answer?.manageUrl ?? "https://claude.ai/settings/connectors") { openURL(url) }
                } label: {
                    HStack(spacing: 6) {
                        DesktopSettingsIconView(icon: .externalLink, size: 12)
                        Text("Manage on claude.ai").font(theme.font(11.5, .medium))
                    }
                    .foregroundStyle(theme.ink)
                    .padding(.horizontal, 10)
                    .frame(height: 25.2)
                    .background(theme.control, in: Capsule())
                }
                .buttonStyle(.plain)
                .padding(.top, 1.4)
            }
            content
                .padding(.top, 8)
            if let answer = harness.answer, answer.canManage, session.surfaceGate.allows(.harnessConnectorsSetting) {
                HStack {
                    DesktopText("Allow Claude connectors on this server", size: 12.5)
                    Spacer(minLength: 0)
                    DesktopSwitch(isOn: answer.enabled, label: Text("Allow Claude connectors on this server"),
                                  identifier: "desktop-plugins.harness-enabled", disabled: harness.saving) {
                        Task { await harness.setEnabled(!answer.enabled, client: session.settingsClient) }
                    }
                }
                .padding(.top, 10)
            }
            if let error = harness.error {
                DesktopText(verbatim: error, size: 12, color: \.danger).padding(.top, 6)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(1)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
        .accessibilityIdentifier("desktop-plugins.harness")
    }

    @ViewBuilder
    private var content: some View {
        if harness.loading && harness.answer == nil {
            HStack(spacing: 8) {
                DesktopSettingsIconView(icon: .loaderCircle, size: 13)
                    .foregroundStyle(theme.inkSecondary)
                DesktopText("Checking your Claude account...", size: 12, color: \.inkSecondary)
            }
        } else if let claude = harness.answer?.claude, !claude.available {
            DesktopText(Self.unavailable(claude.reason), size: 12, color: \.inkSecondary)
        } else if let claude = harness.answer?.claude, claude.connectors.isEmpty {
            DesktopText("No connector on your claude.ai account yet.", size: 12, color: \.inkSecondary)
        } else if let claude = harness.answer?.claude {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(claude.connectors) { connector in
                    HStack(spacing: 8) {
                        DesktopSettingsIconView(icon: .plug, size: 13).foregroundStyle(theme.inkTertiary)
                        DesktopText(verbatim: connector.name, size: 12.5)
                        Spacer(minLength: 0)
                        DesktopBadge(text: Self.status(connector.status),
                                     color: connector.status == "connected" ? \.success : (connector.status == "needs_auth" ? \.warning : \.inkSecondary))
                    }
                }
            }
        }
    }

    static func status(_ value: String) -> Text {
        switch value {
        case "connected": Text("Connected")
        case "needs_auth": Text("Sign-in required")
        case "failed": Text("Unavailable")
        default: Text("Unknown")
        }
    }

    static func unavailable(_ reason: String?) -> Text {
        switch reason {
        case "disabled": Text("An administrator turned off Claude connectors on this server.")
        case "managed_policy": Text("Your organization restricts MCP servers on this computer.")
        case "no_engine": Text("No Claude engine on this server.")
        case "not_signed_in": Text("Connect your Claude subscription to use your connectors.")
        case "not_operator": Text("On this server, Claude connectors belong to its owner's Claude account.")
        case "key": Text("Connect your Claude subscription to use your connectors. An API key brings none.")
        default: Text("Claude Code did not answer. Check that it is installed and signed in.")
        }
    }
}

// MARK: - MCP servers

struct DesktopMcpServersPage: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var mcp: McpServersModel
    @EnvironmentObject private var harness: HarnessConnectorsModel
    @EnvironmentObject private var settings: DesktopSettingsModel
    @State private var adminServers: [MCPServerListing]?
    @State private var busy: String?
    @State private var probes: [String: MCPProbeResult] = [:]
    @State private var removing: MCPServerListing?
    @State private var error: String?
    @State private var editing: DesktopMCPEditing?
    @State private var pasting = false

    private var admin: Bool { session.surfaceGate.scope == .serverAdmin }
    private var servers: [MCPServerListing]? { adminServers ?? mcp.servers }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if session.surfaceGate.allows(.harnessConnectors) {
                DesktopHarnessConnectorsBox()
                    .padding(.bottom, 20)
            }
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    DesktopText("Your MCP servers", size: 15, weight: .semibold, line: 22.5)
                    DesktopText(admin
                                ? Text("Add an MCP server once (a command that runs on this computer, or a server at a URL) and every compatible bot can use its tools. Tool calls still follow your normal approval settings.")
                                : Text("The MCP servers on the computer, for every compatible bot. Add or change them in Sagax on the computer."),
                                size: 12.5, line: 20.3, color: \.inkSecondary)
                        .frame(maxWidth: 610, alignment: .leading)
                }
                Spacer(minLength: 0)
                Button {
                    adminServers = nil
                    Task { await mcp.load(session.settingsClient, reprobe: true) }
                } label: {
                    DesktopSettingsIconView(icon: .refreshCw, size: 16)
                        .foregroundStyle(theme.inkSecondary)
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(DesktopHoverFill(radius: 8, fill: \.raised))
                .disabled(mcp.loading)
                .padding(.top, 1.4)
                .accessibilityLabel(Text("Refresh MCP servers"))
                .accessibilityIdentifier("desktop-plugins.mcp-refresh")
                if admin {
                    Button { pasting = true } label: {
                        HStack(spacing: 6) {
                            DesktopSettingsIconView(icon: .clipboardPaste, size: 14)
                            Text("Paste config")
                        }
                    }
                    .buttonStyle(DesktopButtonStyle(kind: .control, size: 12.5, weight: .medium, height: 34.8))
                    .accessibilityIdentifier("desktop-plugins.mcp-paste")
                    Button { editing = DesktopMCPEditing(server: nil) } label: {
                        HStack(spacing: 6) {
                            DesktopSettingsIconView(icon: .plus, size: 14)
                            Text("Add server")
                        }
                    }
                    .buttonStyle(DesktopButtonStyle(kind: .accent, size: 12.5, weight: .medium, height: 34.8))
                    .accessibilityIdentifier("desktop-plugins.mcp-add")
                }
            }
            if admin {
                claudeSwitch.padding(.top, 16)
                DesktopText("Commands run on this computer with the environment variables you provide; URL servers receive the headers you provide. Only add software and addresses you trust. New servers stay off until you enable them.",
                            size: 12, line: 19.5, color: \.inkSecondary)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(1)
                    .background(theme.raised.opacity(0.35), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
                    .padding(.top, 16)
            }
            if let notice = mcp.notice {
                DesktopText(verbatim: notice, size: 12.5, color: \.success).padding(.top, 12)
            }
            if let message = error ?? mcp.error {
                DesktopText(verbatim: message, size: 12.5, color: \.danger).padding(.top, 12)
            }
            VStack(spacing: 12) {
                if let servers {
                    if servers.isEmpty {
                        DesktopText("No MCP servers yet.", color: \.inkSecondary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 30)
                    }
                    ForEach(servers) { server in row(server) }
                } else {
                    ProgressView().controlSize(.small).padding(.vertical, 30)
                }
            }
            .padding(.top, 20)
        }
        .confirmationDialog(
            Text("Remove the “\(removing?.name ?? "")” MCP server?"),
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            titleVisibility: .visible
        ) {
            Button("Remove", role: .destructive) {
                if let server = removing { Task { await remove(server) } }
            }
            Button("Cancel", role: .cancel) {}
        }
        .sheet(item: $editing) { item in
            DesktopMCPServerEditor(existing: item.server) { servers in
                adminServers = servers
                editing = nil
            }
            .environmentObject(session)
        }
        .sheet(isPresented: $pasting) {
            DesktopMCPImport { servers in
                adminServers = servers
                pasting = false
            }
            .environmentObject(session)
        }
    }

    private var claudeSwitch: some View {
        let on = settings.config?.features?.claudeUserMcp == true
        return HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                DesktopText("Also use my Claude Code MCP servers", size: 14, weight: .medium, line: 21)
                    .frame(maxWidth: .infinity, alignment: .leading)
                DesktopText("Off: Claude bots only get the servers on this page, plus a bot project's own .mcp.json. On: they also get every MCP server and connector from your own Claude Code setup, on every message, the same way Codex bots already read your Codex config. More tools means more tokens per message, so keep this off unless you need them.",
                            size: 12, line: 19.5, color: \.inkSecondary)
            }
            DesktopSwitch(isOn: on, label: Text("Use my Claude Code MCP servers"), identifier: "desktop-plugins.claude-mcp",
                          disabled: settings.config == nil || !settings.saving.isEmpty) {
                Task { _ = await settings.apply(.feature("claudeUserMcp", !on), key: "claudeMcp") }
            }
            .padding(.top, 2)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .padding(1)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
    }

    private func row(_ server: MCPServerListing) -> some View {
        let enabled = server.enabled == true
        let signingIn = mcp.busy == "oauth:\(server.name)" || mcp.waiting.contains(server.name)
        return HStack(alignment: .center, spacing: 12) {
            DesktopSettingsIconView(icon: server.isRemote ? .globe : .terminal, size: 19)
                .foregroundStyle(enabled ? theme.success : theme.inkSecondary)
                .frame(width: 40, height: 40)
                .background((enabled ? theme.success.opacity(0.1) : theme.control), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    DesktopText(verbatim: server.name, size: 14, weight: .medium, line: 21).lineLimit(1)
                    Text(enabled ? "On" : "Off")
                        .font(theme.font(10.5))
                        .foregroundStyle(enabled ? theme.success : theme.inkSecondary)
                        .padding(.horizontal, 8)
                        .frame(height: 19.8)
                        .background(enabled ? theme.success.opacity(0.1) : theme.control, in: Capsule())
                }
                Text(verbatim: MCPServerRules.detailLine(server))
                    .font(.system(size: 11.5, design: .monospaced))
                    .foregroundStyle(theme.inkSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(height: 17.25)
                    .padding(.top, 4)
                authLine(server).padding(.top, 6)
                if let probe = probes[server.name] {
                    DesktopText(verbatim: probe.ok
                                ? pluginsFormat("Works: %@ tools.", "\(probe.tools?.count ?? 0)")
                                : (probe.error ?? AppStrings.localized("The test failed.")),
                                size: 11.5, line: 17.25, color: probe.ok ? \.success : \.danger)
                        .padding(.top, 4)
                }
                if mcp.waiting.contains(server.name) {
                    DesktopText("Finish the sign-in in your browser. This row updates when it is done.", size: 11.5, line: 17.25, color: \.inkSecondary)
                        .padding(.top, 4)
                }
                if let message = mcp.oauthErrors[server.name] {
                    DesktopText(verbatim: message, size: 11.5, line: 17.25, color: \.danger).padding(.top, 4)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if MCPServerRules.needsSignIn(server) {
                Button(server.auth == "expired" ? "Sign in again" : "Sign in") {
                    Task { await mcp.signIn(server, client: session.settingsClient) }
                }
                .buttonStyle(DesktopButtonStyle(kind: .accent, size: 12, weight: .medium, height: 30))
                .disabled(mcp.busy != nil || server.managedBy != nil || signingIn)
                .accessibilityIdentifier("desktop-plugins.mcp-sign-in.\(server.name)")
            }
            if admin {
                HStack(spacing: 4) {
                iconTextButton(.flaskConical, Text("Test"), id: "test", server) { await test(server) }
                iconTextButton(.circlePower, enabled ? Text("Turn off") : Text("Turn on"), id: "toggle", server) { await toggle(server) }
                Button { editing = DesktopMCPEditing(server: server) } label: {
                    DesktopSettingsIconView(icon: .pencil, size: 14)
                        .foregroundStyle(theme.inkSecondary)
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(DesktopHoverFill(radius: 8, fill: \.raised))
                .disabled(busy != nil || server.managedBy != nil)
                .accessibilityLabel(Text(verbatim: pluginsFormat("Edit %@", server.name)))
                .accessibilityIdentifier("desktop-plugins.mcp-edit.\(server.name)")
                Button { removing = server } label: {
                    DesktopSettingsIconView(icon: .trash2, size: 14)
                        .foregroundStyle(theme.inkSecondary)
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(DesktopHoverFill(radius: 8, fill: \.raised))
                .disabled(busy != nil)
                .accessibilityLabel(Text(verbatim: pluginsFormat("Remove %@", server.name)))
                .accessibilityIdentifier("desktop-plugins.mcp-remove.\(server.name)")
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(1)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-plugins.mcp-row.\(server.name)")
    }

    private func iconTextButton(_ icon: DesktopSettingsIcon, _ label: Text, id: String, _ server: MCPServerListing,
                                action: @escaping () async -> Void) -> some View {
        Button { Task { await action() } } label: {
            HStack(spacing: 6) {
                if busy == "\(id):\(server.name)" { ProgressView().controlSize(.mini) } else { DesktopSettingsIconView(icon: icon, size: 14) }
                label.font(theme.font(12))
            }
            .foregroundStyle(theme.inkSecondary)
            .padding(.horizontal, 10)
            .frame(height: 34)
        }
        .buttonStyle(DesktopHoverFill(radius: 8, fill: \.raised))
        .disabled(busy != nil)
        .accessibilityIdentifier("desktop-plugins.mcp-\(id).\(server.name)")
    }

    @ViewBuilder
    private func authLine(_ server: MCPServerListing) -> some View {
        switch MCPServerRules.authLine(server) {
        case let .connected(issuer):
            DesktopText(verbatim: pluginsFormat("Signed in with %@.", issuer), size: 11.5, line: 17.25, color: \.success)
        case let .error(detail):
            (Text("Sign-in unavailable").fontWeight(.medium) + Text(verbatim: detail.map { ". \($0)" } ?? ""))
                .font(theme.font(11.5))
                .foregroundStyle(theme.danger)
                .desktopLine(11.5, 17.25, theme)
        case let .required(issuer, _):
            DesktopText(verbatim: pluginsFormat("Sign in with %@ so bots can use this server.", issuer), size: 11.5, line: 17.25, color: \.warning)
        case .expired:
            DesktopText("Sign in again so bots can keep using this server.", size: 11.5, line: 17.25, color: \.warning)
        case nil:
            EmptyView()
        }
    }

    private func toggle(_ server: MCPServerListing) async {
        guard let client = session.settingsClient else { return }
        busy = "toggle:\(server.name)"
        error = nil
        defer { busy = nil }
        do { adminServers = try await client.setMCPServerEnabled(server.name, enabled: server.enabled != true) }
        catch { self.error = error.localizedDescription }
    }

    private func test(_ server: MCPServerListing) async {
        guard let client = session.settingsClient else { return }
        busy = "test:\(server.name)"
        probes[server.name] = nil
        defer { busy = nil }
        do { probes[server.name] = try await client.testMCPServer(server.name) }
        catch { probes[server.name] = MCPProbeResult(ok: false, tools: nil, error: error.localizedDescription) }
    }

    private func remove(_ server: MCPServerListing) async {
        guard let client = session.settingsClient else { return }
        busy = "delete:\(server.name)"
        error = nil
        defer { busy = nil }
        do { adminServers = try await client.deleteMCPServer(server.name) }
        catch { self.error = error.localizedDescription }
    }
}

struct DesktopMCPEditing: Identifiable {
    let server: MCPServerListing?
    var id: String { server?.name ?? "new" }
}

/// Add or edit an MCP server (the desktop's inline editor, as a sheet).
struct DesktopMCPServerEditor: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var session: Session
    let existing: MCPServerListing?
    let saved: ([MCPServerListing]) -> Void
    @State private var draft = MCPServerDraft()
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Server name", text: $draft.name)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .disabled(existing != nil)
                        .accessibilityIdentifier("desktop-mcp.name")
                    if existing == nil {
                        Picker("Connection", selection: $draft.transport) {
                            Text("Run a command").tag(MCPServerDraft.Transport.command)
                            Text("Connect to a URL").tag(MCPServerDraft.Transport.url)
                        }
                        .pickerStyle(.segmented)
                    }
                }
                if draft.transport == .url {
                    Section {
                        TextField("Server URL", text: $draft.url)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .accessibilityIdentifier("desktop-mcp.url")
                        Picker("Connection", selection: $draft.type) {
                            Text("Streamable HTTP (most servers)").tag("http")
                            Text("SSE (older servers)").tag("sse")
                        }
                    }
                    Section {
                        TextEditor(text: $draft.headers)
                            .font(.system(.footnote, design: .monospaced))
                            .frame(minHeight: 90)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    } header: {
                        Text("Headers · Name: value per line")
                    } footer: {
                        Text("Put tokens here, for example Authorization: Bearer …. Leave an existing value blank to keep it saved. Remove the line to delete it.")
                    }
                } else {
                    Section {
                        TextField("Executable command", text: $draft.command)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .accessibilityIdentifier("desktop-mcp.command")
                    }
                    Section("Arguments · one per line") {
                        TextEditor(text: $draft.args)
                            .font(.system(.footnote, design: .monospaced))
                            .frame(minHeight: 70)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                    Section {
                        TextEditor(text: $draft.env)
                            .font(.system(.footnote, design: .monospaced))
                            .frame(minHeight: 70)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    } header: {
                        Text("Environment · KEY=value per line")
                    } footer: {
                        Text("Leave an existing value blank to keep it saved. Remove the line to delete it.")
                    }
                }
                if let error {
                    Section { Text(verbatim: error).foregroundStyle(.red) }
                }
            }
            .navigationTitle(existing.map { Text(verbatim: pluginsFormat("Edit %@", $0.name)) } ?? Text("Add MCP server"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                        .disabled(saving)
                        .accessibilityIdentifier("desktop-mcp.save")
                }
            }
        }
        .onAppear { if let existing { draft = MCPServerDraft(editing: existing) } }
    }

    private func save() {
        if case let .failure(problem) = draft.body(existing: existing) {
            error = Self.message(problem)
            return
        }
        guard let client = session.settingsClient else { return }
        saving = true
        Task {
            defer { saving = false }
            do { saved(try await client.saveMCPServer(draft, existing: existing)) }
            catch { self.error = error.localizedDescription }
        }
    }

    static func message(_ problem: MCPServerDraft.Problem) -> String {
        switch problem {
        case .nameAndURL: AppStrings.localized("Add a server name and a full http:// or https:// address.")
        case .nameAndCommand: AppStrings.localized("Add a server name and executable command.")
        case let .line(line): pluginsFormat("Check “%@”: use KEY=value or Name: value.", line)
        case let .invalidName(key): pluginsFormat("“%@” is not a valid name.", key)
        case let .duplicate(key): pluginsFormat("“%@” is listed more than once.", key)
        }
    }
}

/// Paste config: the `{"mcpServers": {…}}` block other apps write.
struct DesktopMCPImport: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var session: Session
    let added: ([MCPServerListing]) -> Void
    @State private var text = ""
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextEditor(text: $text)
                        .font(.system(.footnote, design: .monospaced))
                        .frame(minHeight: 200)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("desktop-mcp.import-text")
                } footer: {
                    Text("Paste the {\"mcpServers\": {…}} block from Claude Code, Cursor, or Claude Desktop. Servers are added switched off; test each one, then turn it on.")
                }
                if let error {
                    Section { Text(verbatim: error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Paste config")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add servers") {
                        guard let client = session.settingsClient else { return }
                        saving = true
                        Task {
                            defer { saving = false }
                            do { added(try await client.importMCPServers(text)) }
                            catch { self.error = error.localizedDescription }
                        }
                    }
                    .disabled(saving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}
