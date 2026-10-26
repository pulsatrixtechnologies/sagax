// Settings > Organization on an organization server (matrix ST8, AU19), in
// the desktop's order (PerspicaxOrgSettings.tsx): the organization card
// (link to Perspicax, role, who pays for a turn), Routines in my name,
// then for an admin Allow full access and the commands waiting for an
// admin. Sharing in the organization (every bot of the organization with
// its owner) is hidden since 2026-10-15, as on the desktop: the app shows
// the person signed in; views of everyone belong to Sagax Business and the
// Perspicax console. Its view code and the server routes stay. The
// desktop-only cards (Where bots work, This computer for your bots) and the
// interim people of a server that just moved to Perspicax stay on the
// desktop.
import CompanionCore
import SwiftUI

@MainActor
final class OrganizationSettingsModel: ObservableObject {
    @Published var org: OrgInfo?
    @Published var loadFailed = false
    @Published var delegation: RoutineDelegationStatus?
    @Published var bots: [OrgBot]?
    @Published var approvals: [OrgApproval]?
    @Published var notice: String?
    @Published var busy = false

    func load(_ client: CompanionClient?) async {
        guard let client else { return }
        do {
            org = try await client.organization()
            loadFailed = false
        } catch {
            loadFailed = org == nil
        }
        // Sharing in the organization is hidden (2026-10-15): its bot list is
        // no longer fetched.
        self.delegation = (try? await client.routineDelegation()) ?? RoutineDelegationStatus(state: "none")
        if org?.isAdmin == true {
            approvals = (try? await client.organizationApprovals()) ?? []
        }
    }

    func setFullAccess(_ on: Bool, client: CompanionClient?) async {
        guard let client else { return }
        do {
            _ = try await client.setOrganizationFullAccess(on)
            org = try? await client.organization()
        } catch {
            notice = String(localized: "The setting could not be saved: \(error.localizedDescription)")
        }
    }

    func forceStop(_ bot: OrgBot, client: CompanionClient?) async {
        guard let client else { return }
        do {
            try await client.forceStopOrganizationBot(id: bot.id)
            if let index = bots?.firstIndex(where: { $0.id == bot.id }) { bots?[index].running = false }
            notice = String(localized: "\(bot.name) stopped. Its owner was told.")
        } catch {
            notice = (error as? LocalizedError)?.errorDescription ?? String(localized: "The action did not complete.")
        }
    }

    func forceDelete(_ bot: OrgBot, client: CompanionClient?) async {
        guard let client else { return }
        do {
            try await client.forceDeleteOrganizationBot(id: bot.id, name: bot.name)
            bots?.removeAll { $0.id == bot.id }
            notice = String(localized: "\(bot.name) deleted. Its owner was told.")
        } catch {
            notice = (error as? LocalizedError)?.errorDescription ?? String(localized: "The action did not complete.")
        }
    }

    func answer(_ approval: OrgApproval, allow: Bool, client: CompanionClient?) async {
        guard let client else { return }
        busy = true
        defer { busy = false }
        do {
            try await client.respond(threadId: approval.threadId, requestId: approval.requestId, behavior: allow ? "allow" : "deny",
                                     message: allow ? nil : "Denied by an admin.")
        } catch {
            notice = error.localizedDescription
        }
        approvals = (try? await client.organizationApprovals()) ?? approvals
    }
}

struct OrganizationSettingsPage: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @StateObject private var model = OrganizationSettingsModel()
    @ObservedObject private var approvals = OrgApprovalsCenter.shared
    @State private var link: URL?
    @State private var query = ""
    @State private var groupByOwner = false
    @State private var deleting: OrgBot?

    private var client: CompanionClient? { session.settingsClient }

    var body: some View {
        SettingsPage(title: "Organization") {
            if let org = model.org {
                orgCard(org)
                delegationCard
                if org.isAdmin {
                    fullAccessCard(org)
                    approvalsCard
                }
            } else if model.loadFailed {
                SettingsFooter(text: "Could not load the organization.")
            } else {
                ProgressView().tint(Theme.textSecondary).padding(.top, 30)
            }
        }
        // reloads live when an admin approval arrives or settles (#213)
        .task(id: approvals.generation) { await model.load(client) }
        .sheet(item: Binding(get: { link.map(IdentifiedURL.init) }, set: { link = $0?.url })) { item in
            SafariSheet(url: item.url).ignoresSafeArea()
        }
        .confirmationDialog(
            Text("Delete \(deleting?.name ?? "")?"),
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible
        ) {
            if let bot = deleting {
                Button("Force delete", role: .destructive) { Task { await model.forceDelete(bot, client: client) } }
                    .accessibilityIdentifier("org-force-delete-confirm")
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            if let bot = deleting {
                Text("\(bot.name) belongs to \(bot.owner). Its work stops, then the bot, its conversations and its routines are deleted. This is recorded in the activity log and \(bot.owner) is told. This cannot be undone.")
            }
        }
        .alert("Organization", isPresented: Binding(get: { model.notice != nil }, set: { if !$0 { model.notice = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(verbatim: model.notice ?? "")
        }
    }

    // MARK: Organization

    @ViewBuilder
    private func orgCard(_ org: OrgInfo) -> some View {
        SettingsCard {
            VStack(alignment: .leading, spacing: 6) {
                Text(verbatim: org.org.name)
                    .font(Theme.Font.bodyMedium)
                    .foregroundStyle(Theme.textPrimary)
                    .accessibilityIdentifier("org-name")
                Group {
                    switch org.link?.state {
                    case "ok"?: Text("Linked to Perspicax").foregroundStyle(Theme.textPrimary)
                    case "missing"?: Text("Not linked yet: the link file from Perspicax is missing.").foregroundStyle(Theme.warning)
                    default: Text("The link to Perspicax has a problem (\(org.link?.error ?? "error")).").foregroundStyle(Theme.warning)
                    }
                }
                .font(Theme.Font.label)
                if let synced = org.link?.syncedAt {
                    Text("Last sync: \(Date(timeIntervalSince1970: synced / 1000).formatted(date: .abbreviated, time: .shortened))")
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                }
                Text(org.isAdmin ? "You are an admin of this organization." : "You are a member of this organization.")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("org-role")
            }
            .padding(.horizontal, SettingsMetrics.rowInset)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            if let console = org.consoleURL {
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                SettingsRow(title: "Manage in Perspicax", systemImage: "arrow.up.right.square", accessory: .chevron, identifier: "org-manage") { link = console }
            }
        }
        if let configured = org.settings?.orgKeyConfigured {
            // Who pays for a turn (read-only).
            SettingsSectionLabel(text: "Who pays for a turn")
            SettingsCard {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Each turn runs on the subscription of the person who speaks first, then on their key in Perspicax, then on the organization's key if an admin set one. A bot's routines always use its owner's credentials.")
                        .foregroundStyle(Theme.textSecondary)
                    Text(configured ? "An organization key is set on this server (Settings > Connections)." : "No organization key is set on this server.")
                        .foregroundStyle(Theme.textPrimary)
                }
                .font(Theme.Font.label)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, SettingsMetrics.rowInset)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    // MARK: Routines in my name

    /// #149: routines always act in their owner's name; no consent, no
    /// switch, no reconnect. One read-only line, and the routines the server
    /// paused (a disabled account or a missing right).
    private var delegationCard: some View {
        Group {
            SettingsSectionLabel(text: "Routines in my name")
            SettingsCard {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Your routines always act in your name on this server, with your Perspicax tools and the bot owner's model access.")
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("org-delegation-state")
                    if let status = model.delegation, status.suspended > 0 {
                        Text("\(status.suspended) paused routine(s)")
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.accentText)
                    }
                }
                .padding(.horizontal, SettingsMetrics.rowInset)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var manageURL: URL? {
        if let text = model.delegation?.manageUrl, let url = URL(string: text) { return url }
        return model.org?.consoleURL
    }

    private static func format(_ ms: Double?) -> String {
        guard let ms else { return "" }
        return Date(timeIntervalSince1970: ms / 1000).formatted(date: .abbreviated, time: .shortened)
    }

    // MARK: Sharing

    @ViewBuilder
    private func sharingCard(admin: Bool) -> some View {
        if let bots = model.bots, !bots.isEmpty {
            SettingsSectionLabel(text: "Sharing in the organization")
            if bots.count > OrgSharing.searchThreshold {
                SettingsSearchField(prompt: "Search bots, owners or sections", text: $query, identifier: "org-sharing-search")
                    .padding(.horizontal, SettingsMetrics.cardMargin)
                    .padding(.bottom, 8)
                Toggle(isOn: $groupByOwner) { Text("Group by owner").font(Theme.Font.label).foregroundStyle(Theme.textSecondary) }
                    .tint(Theme.toggleOn)
                    .padding(.horizontal, SettingsMetrics.cardMargin + 4)
                    .padding(.bottom, 8)
            }
            let shown = OrgSharing.filter(bots, query: query)
            if shown.isEmpty {
                SettingsFooter(text: "No bot matches.")
            } else if groupByOwner {
                ForEach(OrgSharing.groupedByOwner(shown), id: \.owner) { group in
                    SettingsSectionLabel(text: LocalizedStringKey(stringLiteral: "\(group.owner) · \(group.bots.count)"))
                    botList(group.bots, admin: admin)
                }
            } else {
                botList(shown, admin: admin)
            }
        }
    }

    private func botList(_ bots: [OrgBot], admin: Bool) -> some View {
        SettingsCard {
            ForEach(Array(bots.enumerated()), id: \.element.id) { index, bot in
                if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                OrgBotRow(bot: bot, admin: admin, avatar: session.state.bots.first { $0.id == bot.id }) {
                    Task { await model.forceStop(bot, client: client) }
                } forceDelete: {
                    deleting = bot
                }
            }
        }
    }

    // MARK: Admin

    private func fullAccessCard(_ org: OrgInfo) -> some View {
        Group {
            SettingsSectionLabel(text: "Allow full access")
            SettingsCard {
                SettingsRow(
                    title: "Allow full access for the organization's bots",
                    accessory: .toggle(Binding(get: { model.org?.settings?.allowFullAccess != false }, set: { on in
                        Task { await model.setFullAccess(on, client: client) }
                    })),
                    identifier: "org-full-access"
                )
            }
            SettingsFooter(text: "Lets bot owners choose Full access: their bots run commands and edit files without asking. Nothing runs on the Sagax server itself. When off, Full access is unavailable and turns asking for it are refused.")
        }
    }

    private var approvalsCard: some View {
        Group {
            SettingsSectionLabel(text: "Commands waiting for an admin")
            SettingsCard {
                if let approvals = model.approvals, !approvals.isEmpty {
                    ForEach(Array(approvals.enumerated()), id: \.element.id) { index, approval in
                        if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                        VStack(alignment: .leading, spacing: 6) {
                            Text(verbatim: HumanID.readable(approval.botName, approval.botId, or: String(localized: "Deleted bot"))).font(Theme.Font.bodyMedium).foregroundStyle(Theme.textPrimary)
                            if let tool = approval.tool { Text(verbatim: tool).font(Theme.Font.code).foregroundStyle(Theme.textSecondary) }
                            if let summary = approval.summary {
                                Text(verbatim: summary).font(Theme.Font.code).foregroundStyle(Theme.textPrimary).lineLimit(6)
                            }
                            HStack {
                                Button(role: .destructive) { Task { await model.answer(approval, allow: false, client: client) } } label: { Text("Deny") }
                                Spacer()
                                Button { Task { await model.answer(approval, allow: true, client: client) } } label: { Text("Allow once") }
                            }
                            .font(Theme.Font.buttonLabel)
                            .disabled(model.busy)
                        }
                        .padding(.horizontal, SettingsMetrics.rowInset)
                        .padding(.vertical, 12)
                    }
                } else {
                    SettingsRow(title: "Nothing is waiting.", identifier: "org-approvals-empty")
                }
            }
        }
    }
}

/// One bot of Sharing in the organization: its owner, how widely it is
/// shared, its section, running or idle; for an admin, the force actions.
private struct OrgBotRow: View {
    @Environment(\.themePalette) var themePalette
    let bot: OrgBot
    let admin: Bool
    let avatar: Bot?
    let forceStop: () -> Void
    let forceDelete: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            if let avatar {
                BotMascotView(bot: avatar, size: 30, state: .idle, animated: false, comets: false)
            } else {
                ProfileAvatar(name: bot.name, size: 30)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: bot.name).font(Theme.Font.rowTitle).foregroundStyle(Theme.textPrimary).lineLimit(1)
                HStack(spacing: 4) {
                    Text("Owner: \(bot.owner)")
                    Text(verbatim: "·")
                    sharingText
                    if let section = bot.section, !section.isEmpty {
                        Text(verbatim: "· \(section)")
                    }
                }
                .font(Theme.Font.label)
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
            }
            Spacer(minLength: 4)
            if let running = bot.running {
                Circle().fill(running ? Theme.success : Theme.textTertiary).frame(width: 7, height: 7)
                    .accessibilityLabel(running ? Text("Running") : Text("Idle"))
            }
            if admin {
                Menu {
                    Button { forceStop() } label: { Label("Force stop", systemImage: "stop.circle") }
                        .disabled(bot.running == false)
                    Button(role: .destructive) { forceDelete() } label: { Label("Force delete", systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.textSecondary)
                        .frame(width: 32, height: 32).contentShape(Rectangle())
                }
                .accessibilityLabel(Text("Admin actions for \(bot.name)"))
                .accessibilityIdentifier("org-bot-actions.\(bot.id)")
            }
        }
        .padding(.leading, SettingsMetrics.rowInset)
        .padding(.trailing, 10)
        .padding(.vertical, 9)
        .accessibilityIdentifier("org-bot.\(bot.id)")
    }

    private var sharingText: Text {
        switch bot.grants.count {
        case 0: Text("Not shared")
        case 1: Text("Shared with 1 person or team")
        default: Text("Shared with \(bot.grants.count) people or teams")
        }
    }
}
