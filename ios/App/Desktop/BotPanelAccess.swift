// iPad I4/I4b: More > Access as the current desktop draws it
// (`bot-settings/AccessSection.tsx`), every card inline: Works on (Auto or
// Off: the bot picks the place per task, JC 2026-10-18; the Off note; the Auto note and the cloud backend while a cloud computer is
// offered), the working folder, Connected apps and the built-in browser
// while Experimental features has them on, MCP servers (one switch each),
// Webhooks and Always allowed. On an organization server Works on is its
// own More item (`BotPanelWorksOn`), and Access leaves it out.
//
// Sizes from desktop-1366x1024-43-panel-more-access.json: cards
// `rounded-xl border-hairline/40 p-4` 16 apart, titles 13/19.5 medium,
// explanations 13/19.5 secondary, the 3-column grid 32 tall, 6 apart, 12
// below; the notes 11.5/18.69; the MCP list `rounded-lg` rows px 12 py 8
// (37 with the hairline), names mono 12.5/18.75, the 44x20 switch.
import SwiftUI
import UIKit
import CompanionCore

struct BotPanelAccess: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot
    /// On an organization server Works on is its own More item
    /// (`WorksOnSetting`), and Access leaves it out.
    var showsWorksOn = true
    /// The More > Computer item: Works on alone.
    var worksOnOnly = false

    @State private var folder = ""
    @State private var config: ConfigStatus?
    @State private var instances: [Instance] = []
    @State private var servers: [MCPServerListing]?
    @State private var serversFailed = false
    @State private var webhooks: [WebhookListing]?
    @State private var saving = false

    private var canEdit: Bool { session.surfaceGate.allows(.botAccessEdit) }
    private var organization: Bool { session.surfaceGate.organization }
    private var worksOn: DesktopWorksOn { DesktopWorksOn.of(bot) }
    private var engine: Instance? { instances.first { $0.instanceId == bot.modelSelection.instanceId } }
    private var modelCanBrowse: Bool { engine?.capabilities?.browserMcp == true && engine?.driverKind != "boxAgent" }
    private var browserSelectable: Bool { DesktopWorksOnRules.browserSelectable(config: config, modelCanBrowse: modelCanBrowse) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if showsWorksOn { AnyView(worksOnCard) }
            if !worksOnOnly { AnyView(rest) }
        }
        .onAppear { folder = bot.cwd ?? "" }
        .task {
            config = await session.configStatus()
            instances = await DesktopModelCatalog.shared.instances(session)
        }
        .task(id: bot.id) {
            guard !worksOnOnly else { return }
            await loadServers()
            if let client = session.profileClient {
                webhooks = (try? await client.webhooks())?.of(botId: bot.id) ?? []
            }
        }
    }

    // MARK: Works on

    private var worksOnCard: some View {
        PanelCard {
            Text("Works on").panelText(13, 19.5, .medium).foregroundStyle(theme.ink)
            Text("The bot picks where each task runs: the cloud, a Local VM, this computer or the browser, among the places available to it and allowed. Off gives it no computer and no browser.")
                .panelText(13, 19.5)
                .foregroundStyle(theme.inkSecondary)
                .padding(.top, 2)
            worksOnGrid.padding(.top, 12)
            if worksOn == .off {
                note(bold: "Off means no screen.", "This bot gets no computer and no built-in browser, so it cannot open a web page, click, or type anywhere. Its connected apps, MCP servers, files and chat all still work.")
                    .padding(.top, 12)
            }
            if DesktopWorksOnRules.showsCloudBackend(worksOn: worksOn, config: config, organization: organization) {
                if worksOn == .auto {
                    note(bold: "Auto and cloud computers.", "Auto may reuse the cloud computer below when it is already running. Opening these settings never creates or wakes one.")
                        .padding(.top, 12)
                }
                cloudBackend.padding(.top, 12)
            }
        }
    }

    private var browserReason: String {
        switch DesktopWorksOnRules.browserBlock(config: config) {
        case .notInstalled:
            String(localized: "The browser engine is not installed on this server yet. Enable the browser switches in App Settings → Experimental and the bot's Access settings, then open Bot's computer → Browser to install it. Or run `openmausbot browser install` on the server.")
        case let .server(reason): reason
        case .noEngine: String(localized: "This server has no browser engine.")
        case .featureOff: String(localized: "The built-in browser is switched off under App Settings → Experimental")
        case .model: String(localized: "This model cannot use the built-in browser")
        }
    }

    private func label(_ place: DesktopWorksOn) -> String {
        switch place {
        case .auto: String(localized: "Auto")
        case .cloud: String(localized: "Cloud computer")
        case .vm: String(localized: "Local VM")
        case .local: String(localized: "This computer")
        case .browser: String(localized: "Browser")
        case .off: String(localized: "Off")
        }
    }

    private var worksOnGrid: some View {
        let options = DesktopWorksOnRules.choices(config: config, organization: organization).map { place in
            (place, label(place), canEdit)
        }
        // A place an older build saved reads as Auto here (the server moves
        // it back to Auto at start).
        let selected: DesktopWorksOn = worksOn == .off ? .off : .auto
        return PanelSegmentGrid(options: options, selected: selected, columns: 2) { choice in
            guard choice != selected else { return }
            Task { _ = await sendPanelPatch(BotPanelPatch(computer: choice.stored), bot: bot, session: session) }
        }
    }

    private func note(bold: LocalizedStringKey, _ rest: LocalizedStringKey) -> some View {
        (Text(bold).font(theme.font(11.5, .medium)).foregroundColor(theme.ink) + Text(verbatim: " ") + Text(rest))
            .panelText(11.5, 18.69)
            .foregroundStyle(theme.inkSecondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var cloudBackend: some View {
        let backend = bot.cloudBackend ?? "box"
        return VStack(alignment: .leading, spacing: 0) {
            Text("Cloud backend").panelText(12, 18, .medium).foregroundStyle(theme.ink)
            Text("Boat is the default hosted computer. Choose Self-hosted VPS to use your SSH-configured Linux Docker host.")
                .panelText(11.5, 17.25)
                .foregroundStyle(theme.inkSecondary)
                .padding(.top, 2)
            HStack(spacing: 0) {
                backendButton("Boat", value: "box", on: backend == "box")
                Rectangle().fill(theme.hairline40).frame(width: 1)
                backendButton("Self-hosted VPS", value: "vps", on: backend == "vps")
            }
            .frame(height: 30)
            .padding(1)
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .padding(.top, 8)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func backendButton(_ title: LocalizedStringKey, value: String, on: Bool) -> some View {
        Button {
            guard !on else { return }
            Task { _ = await sendPanelPatch(BotPanelPatch(cloudBackend: value), bot: bot, session: session) }
        } label: {
            Text(title)
                .font(theme.font(12))
                .foregroundStyle(on ? theme.ink : theme.inkSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(on ? theme.raised : .clear)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!canEdit)
    }

    // MARK: The other cards

    private var rest: some View {
        VStack(alignment: .leading, spacing: 16) {
            AnyView(folderCard)
            AnyView(mcpCard)
            if DesktopWorksOnRules.browserFeature(config) { AnyView(browserCard) }
            AnyView(webhooksCard)
            AnyView(alwaysAllowedCard)
        }
    }

    private var folderCard: some View {
        PanelCard {
            Text("Working folder").panelText(13, 19.5, .medium).foregroundStyle(theme.ink)
            Text("Where this bot runs its shell and file tools.").panelText(13, 19.5).foregroundStyle(theme.inkSecondary).padding(.top, 2)
            HStack(spacing: 8) {
                PanelTextField(placeholder: "Private bot folder — or an absolute path", text: $folder, mono: true)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .disabled(!canEdit)
                Button {
                    Task {
                        saving = true
                        _ = await sendPanelPatch(BotPanelPatch(cwd: folder.trimmingCharacters(in: .whitespacesAndNewlines)), bot: bot, session: session)
                        saving = false
                    }
                } label: {
                    Text("Save").font(theme.font(13)).foregroundStyle(theme.ink)
                        .padding(.horizontal, 12).frame(height: 35.5)
                        .background(theme.control, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(!canEdit || saving || folder == (bot.cwd ?? ""))
                .opacity(!canEdit || saving || folder == (bot.cwd ?? "") ? 0.5 : 1)
            }
            .padding(.top, 12)
        }
    }

    private var mcpCard: some View {
        PanelCard {
            Text("MCP servers").panelText(13, 19.5, .medium).foregroundStyle(theme.ink)
            Text("Controls which servers are offered to this bot. Individual tool approvals depend on the model provider and approval mode.")
                .panelText(13, 19.5)
                .foregroundStyle(theme.inkSecondary)
                .padding(.top, 2)
            if let servers {
                if servers.isEmpty {
                    quietLine("No MCP servers added yet.").padding(.top, 12)
                } else {
                    let mounted = Set(AccessRules.mounted(servers, own: bot.mcpServers).map(\.name))
                    VStack(spacing: 0) {
                        ForEach(Array(servers.enumerated()), id: \.element.id) { index, server in
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 0) {
                                    Text(verbatim: server.name)
                                        .font(.system(size: 12.5, design: .monospaced))
                                        .foregroundStyle(theme.ink)
                                        .lineLimit(1)
                                        .frame(height: 18.75)
                                    if server.enabled == false {
                                        Text("Switched off under Plugins. Test it and turn it on there first.")
                                            .panelText(11.5, 17.25)
                                            .foregroundStyle(theme.inkSecondary)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                PanelSwitch(label: "Let this bot use \(server.name)", isOn: mounted.contains(server.name),
                                            disabled: !canEdit || server.enabled == false || bot.busy == true || saving) { _ in
                                    access(BotAccessPatch(mcpServers: AccessRules.toggledMcp(servers, own: bot.mcpServers, name: server.name)))
                                }
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .accessibilityIdentifier("desktop-access-mcp.\(server.name)")
                            if index < servers.count - 1 {
                                Rectangle().fill(theme.hairline40).frame(height: 1)
                            }
                        }
                    }
                    .padding(1)
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
                    .padding(.top, 12)
                }
            } else if serversFailed {
                Text("Could not refresh MCP servers.").font(theme.font(12)).foregroundStyle(theme.danger).padding(.top, 12)
            } else {
                Text("Loading MCP servers…").font(theme.font(12)).foregroundStyle(theme.inkSecondary).padding(.top, 12)
            }
            HStack(spacing: 8) {
                Button { model.modal = .plugins } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "plus").font(.system(size: 12))
                        Text("Add an MCP server…").font(theme.font(13))
                    }
                    .foregroundStyle(theme.ink)
                    .padding(.horizontal, 12)
                    .frame(height: 35.5)
                    .background(theme.control, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                if canEdit, bot.mcpServers != nil, let servers, !servers.isEmpty {
                    Button { clearMcp() } label: {
                        Text("Use every enabled server").font(theme.font(13)).foregroundStyle(theme.inkSecondary)
                            .padding(.horizontal, 8).frame(height: 35.5)
                    }
                    .buttonStyle(.plain)
                    .disabled(bot.busy == true || saving)
                }
            }
            .padding(.top, 12)
            if bot.busy == true {
                Text("Wait until this bot finishes all active tasks before changing its MCP servers.")
                    .panelText(12, 18)
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.top, 8)
            }
        }
    }

    private var browserCard: some View {
        let on = bot.browser != false && worksOn != .off
        return PanelCard {
            PanelSettingRow(title: "Browser", detail: Text(browserDetail)) {
                PanelSwitch(label: "Give this bot a built-in browser", isOn: on,
                            disabled: !canEdit || worksOn == .off || (!on && !browserSelectable)) { value in
                    access(BotAccessPatch(browser: value))
                }
            }
        }
    }

    private var browserDetail: String {
        if !DesktopWorksOnRules.browserAvailable(config) { return browserReason }
        if !modelCanBrowse { return String(localized: "This bot's current model cannot use the built-in browser.") }
        if worksOn == .off { return String(localized: "Works on is set to Off, so this bot has no browser. Pick another destination above to give it one.") }
        return bot.browser != false
            ? String(localized: "This bot has its own browser with its own logins.")
            : String(localized: "Keep the built-in browser unavailable to this bot.")
    }

    private var webhooksCard: some View {
        PanelCard {
            Text("Webhooks").panelText(13, 19.5, .medium).foregroundStyle(theme.ink)
            Text("Inbound triggers wired to this bot.").panelText(13, 19.5).foregroundStyle(theme.inkSecondary).padding(.top, 2)
            if let webhooks, !webhooks.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(webhooks.enumerated()), id: \.element.id) { index, webhook in
                        HStack(spacing: 12) {
                            Text(verbatim: webhook.name).font(theme.font(13)).foregroundStyle(theme.ink).lineLimit(1)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Text(webhook.enabled ? "Active" : "Paused")
                                .font(theme.font(11, .medium))
                                .foregroundStyle(webhook.enabled ? theme.accentText : theme.inkSecondary)
                                .padding(.horizontal, 8)
                                .frame(height: 20)
                                .background(webhook.enabled ? theme.accent.opacity(0.15) : theme.control, in: Capsule())
                            Text("\(webhook.deliveryCount) deliveries").font(theme.font(11.5)).foregroundStyle(theme.inkSecondary)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        if index < webhooks.count - 1 { Rectangle().fill(theme.hairline40).frame(height: 1) }
                    }
                }
                .padding(1)
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
                .padding(.top, 12)
            } else {
                quietLine("No webhooks for this bot.").padding(.top, 12)
            }
        }
    }

    private var alwaysAllowedCard: some View {
        let always = bot.alwaysAllow ?? []
        return PanelCard {
            Text("Always allowed").panelText(13, 19.5, .medium).foregroundStyle(theme.ink)
            Text("Tools this bot no longer asks about.").panelText(13, 19.5).foregroundStyle(theme.inkSecondary).padding(.top, 2)
            if always.isEmpty {
                quietLine("Nothing standing yet.").padding(.top, 12)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(always.enumerated()), id: \.element) { index, entry in
                        HStack(spacing: 12) {
                            Text(verbatim: entry).font(.system(size: 12.5, design: .monospaced)).foregroundStyle(theme.ink).lineLimit(1)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            if canEdit {
                                Button { access(BotAccessPatch(alwaysAllow: always.filter { $0 != entry })) } label: {
                                    Text("Remove").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                                        .padding(.horizontal, 8).frame(height: 26)
                                }
                                .buttonStyle(.plain)
                                .disabled(saving)
                                .accessibilityLabel(Text("Remove \(entry) from always allowed"))
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        if index < always.count - 1 { Rectangle().fill(theme.hairline40).frame(height: 1) }
                    }
                }
                .padding(1)
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
                .padding(.top, 12)
            }
        }
    }

    private func quietLine(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(theme.font(12))
            .foregroundStyle(theme.inkSecondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    // MARK: Writes

    private func loadServers() async {
        guard let client = session.profileClient else { return }
        do {
            servers = try await client.mcpServers().servers
            serversFailed = false
        } catch {
            serversFailed = true
        }
    }

    private func access(_ patch: BotAccessPatch) {
        guard canEdit, let client = session.profileClient else { return }
        saving = true
        Task {
            defer { saving = false }
            do { session.applyProfileBot(try await client.patchBotAccess(botId: bot.id, patch: patch)) }
            catch { session.actionError = error.localizedDescription }
        }
    }

    /// `mcpServers: null`: back to every enabled server.
    private func clearMcp() {
        guard let client = session.profileClient else { return }
        saving = true
        Task {
            defer { saving = false }
            do { session.applyProfileBot(try await client.clearBotMcpServers(botId: bot.id)) }
            catch { session.actionError = error.localizedDescription }
        }
    }
}
