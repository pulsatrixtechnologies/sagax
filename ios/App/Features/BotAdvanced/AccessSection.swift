// Access (BA6, bot-settings/AccessSection.tsx): the working folder,
// MCP servers, the built-in browser and the always-allowed tools. The sidecar
// and a client session refuse every one of these fields (where the bot runs
// and what it may reach stay on the computer), so the phone reads them; an
// admin session also gets the desktop's switches. Webhooks and where the bot
// works are set up on the computer.
import CompanionCore
import SwiftUI

struct BotAccessSection: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @EnvironmentObject private var session: Session
    @State private var servers: [MCPServerListing]?
    @State private var serversFailed = false
    @State private var saving = false

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var editable: Bool { session.surfaceGate.allows(.botAccessEdit) }

    var body: some View {
        Section {
            Text(verbatim: current.cwd?.isEmpty == false ? current.cwd! : String(localized: "Private bot folder"))
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(current.cwd?.isEmpty == false ? Theme.textPrimary : Theme.textSecondary)
                .lineLimit(2)
                .truncationMode(.middle)
                .accessibilityIdentifier("access-folder")
        } header: {
            Text(String(localized: "Working folder"))
        } footer: {
            Text(String(localized: "Where this bot runs its shell and file tools."))
        }
        .task(id: bot.id) { await loadServers() }

        Section {
            if let servers {
                if servers.isEmpty {
                    Text(String(localized: "No MCP servers added yet.")).foregroundStyle(Theme.textSecondary)
                }
                let mounted = Set(AccessRules.mounted(servers, own: current.mcpServers).map(\.name))
                ForEach(servers) { server in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: server.name).font(.system(size: 13, design: .monospaced)).foregroundStyle(Theme.textPrimary)
                            if server.enabled == false {
                                Text(String(localized: "Switched off under Plugins. Test it and turn it on there first."))
                                    .font(.system(size: 11.5)).foregroundStyle(Theme.textSecondary)
                            }
                        }
                        Spacer(minLength: 8)
                        if editable {
                            Toggle(isOn: Binding(get: { mounted.contains(server.name) }, set: { _ in
                                save(BotAccessPatch(mcpServers: AccessRules.toggledMcp(servers, own: current.mcpServers, name: server.name)))
                            })) { EmptyView() }
                                .labelsHidden()
                                .tint(Theme.toggleOn)
                                .disabled(server.enabled == false || current.busy == true || saving)
                        } else {
                            Text(mounted.contains(server.name) ? String(localized: "On") : String(localized: "Off"))
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("access-mcp.\(server.name)")
                }
                if editable, current.mcpServers != nil, !servers.isEmpty {
                    Button(String(localized: "Use every enabled server")) { save(BotAccessPatch(mcpServers: nil), clearMcp: true) }
                        .disabled(current.busy == true || saving)
                }
                if editable, current.busy == true {
                    Text(String(localized: "Wait until this bot finishes all active tasks before changing its MCP servers."))
                        .font(.footnote).foregroundStyle(Theme.textSecondary)
                }
            } else if serversFailed {
                Text(String(localized: "Couldn't load")).foregroundStyle(Theme.textSecondary)
            } else {
                Text(String(localized: "Loading…")).foregroundStyle(Theme.textSecondary)
            }
        } header: {
            Text(String(localized: "MCP servers"))
        } footer: {
            Text(String(localized: "Controls which servers are offered to this bot. Individual tool approvals depend on the model provider and approval mode."))
        }

        Section {
            switchRow(String(localized: "Browser"), on: current.browser != false && current.computer != "off", id: "access-browser") { value in
                BotAccessPatch(browser: value)
            }
            .disabled(current.computer == "off")
        } footer: {
            Text(current.computer == "off"
                 ? String(localized: "Works on is set to Off, so this bot has no browser.")
                 : current.browser != false
                    ? String(localized: "This bot has its own browser with its own logins.")
                    : String(localized: "Keep the built-in browser unavailable to this bot."))
        }

        Section {
            let always = current.alwaysAllow ?? []
            if always.isEmpty {
                Text(String(localized: "Nothing standing yet.")).foregroundStyle(Theme.textSecondary)
            }
            ForEach(always, id: \.self) { entry in
                HStack {
                    Text(verbatim: entry).font(.system(size: 13, design: .monospaced)).foregroundStyle(Theme.textPrimary).lineLimit(1)
                    Spacer(minLength: 8)
                    if editable {
                        Button(String(localized: "Remove")) { save(BotAccessPatch(alwaysAllow: always.filter { $0 != entry })) }
                            .buttonStyle(.borderless)
                            .disabled(saving)
                            .accessibilityLabel(Text(String(localized: "Remove \(entry) from always allowed")))
                    }
                }
            }
        } header: {
            Text(String(localized: "Always allowed"))
        } footer: {
            Text(String(localized: "Tools this bot no longer asks about."))
        }

        if !editable {
            Section {
                Text(String(localized: "Where this bot works, its folder and what it may reach are changed in Sagax on your computer."))
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("access-read-only")
            }
        }
    }

    @ViewBuilder
    private func switchRow(_ title: String, on: Bool, id: String, patch: @escaping (Bool) -> BotAccessPatch) -> some View {
        if editable {
            Toggle(isOn: Binding(get: { on }, set: { save(patch($0)) })) {
                Text(verbatim: title).foregroundStyle(Theme.textPrimary)
            }
            .tint(Theme.toggleOn)
            .disabled(saving)
            .accessibilityIdentifier(id)
        } else {
            HStack {
                Text(verbatim: title).foregroundStyle(Theme.textPrimary)
                Spacer()
                Text(on ? String(localized: "On") : String(localized: "Off")).foregroundStyle(Theme.textSecondary)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(id)
        }
    }

    private func loadServers() async {
        guard let client = session.profileClient else { return }
        do {
            servers = try await client.mcpServers().servers
            serversFailed = false
        } catch {
            serversFailed = true
        }
    }

    /// `clearMcp` sends `mcpServers: null` (back to every enabled server).
    private func save(_ patch: BotAccessPatch, clearMcp: Bool = false) {
        guard let client = session.profileClient else { return }
        saving = true
        Task {
            defer { saving = false }
            do {
                let updated: Bot
                if clearMcp {
                    updated = try await client.clearBotMcpServers(botId: bot.id)
                } else {
                    updated = try await client.patchBotAccess(botId: bot.id, patch: patch)
                }
                session.applyProfileBot(updated)
            } catch {
                session.actionError = error.localizedDescription
            }
        }
    }
}

struct BotAccessPage: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot

    var body: some View {
        ThemedForm { BotAccessSection(bot: bot) }
            .navigationTitle(String(localized: "Access"))
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier("access-page")
    }
}
