// iPad I-sync: More > Model's "Backup models for this bot"
// (`bot-settings/ModelSection.tsx` FallbackChain): the explanation, a note
// while Automatic recovery is off, the ordered list (number, engine, model,
// remove) and the Add an engine menu (up to five, one per engine). An admin
// session's field only (`SurfaceFeature.botFallback`).
import SwiftUI
import CompanionCore

struct BotPanelFallback: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot
    let instances: [Instance]

    @State private var recoveryOn: Bool?
    @State private var saving = false

    private var chain: [ModelSelection] { bot.fallback ?? [] }
    private var candidates: [Instance] { BotFallbackRules.candidates(instances, bot: bot) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Backup models for this bot").font(theme.font(15, .medium)).foregroundStyle(theme.ink)
            Text("When Automatic recovery is enabled in App Settings, try these models in order only if the provider proves the request never started. Work that may have run is not replayed. Only that thread switches; bot defaults and other threads stay unchanged. Backup provider charges may apply.")
                .panelText(13, 19.5)
                .foregroundStyle(theme.inkSecondary)
                .padding(.top, 2)
            if recoveryOn == false {
                Text("Automatic recovery is off. This list stays inactive until you enable it in App Settings.")
                    .panelText(12, 18)
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.top, 8)
            }
            if !chain.isEmpty {
                VStack(spacing: 4) {
                    ForEach(Array(chain.enumerated()), id: \.element.instanceId) { index, entry in
                        AnyView(row(index, entry))
                    }
                }
                .padding(.top, 12)
            }
            if chain.count < BotFallbackRules.limit {
                AnyView(addMenu).padding(.top, chain.isEmpty ? 12 : 8)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .task(id: session.connection?.id) {
            recoveryOn = (try? await session.settingsClient?.desktopSettingsConfig())?.automaticRecovery?.enabled == true
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-panel-fallback")
    }

    private func name(_ instanceId: String) -> String {
        instances.first { $0.instanceId == instanceId }?.displayName ?? instanceId
    }

    private func row(_ index: Int, _ entry: ModelSelection) -> some View {
        HStack(spacing: 8) {
            Text(verbatim: "\(index + 1).").font(theme.font(13)).monospacedDigit().foregroundStyle(theme.inkSecondary).frame(width: 16, alignment: .leading)
            Text(verbatim: name(entry.instanceId)).font(theme.font(13)).foregroundStyle(theme.ink).lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(verbatim: entry.model).font(theme.font(11.5)).foregroundStyle(theme.inkSecondary).lineLimit(1)
            Button {
                save(chain.filter { $0.instanceId != entry.instanceId })
            } label: {
                Image(systemName: "xmark").font(.system(size: 11, weight: .medium)).foregroundStyle(theme.inkSecondary)
                    .frame(width: 20, height: 20).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(saving)
            .accessibilityLabel(Text("Remove \(name(entry.instanceId)) from the fallback list"))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var addMenu: some View {
        Menu {
            ForEach(candidates, id: \.instanceId) { instance in
                Button(HumanID.readable(instance.displayName, instance.instanceId, or: String(localized: "Removed engine"))) { save(BotFallbackRules.adding(instance, to: chain)) }
            }
        } label: {
            HStack(spacing: 6) {
                Text(candidates.isEmpty ? "No other engine is available" : "Add an engine…")
                    .font(theme.font(13))
                    .foregroundStyle(theme.ink)
                Image(systemName: "chevron.down").font(.system(size: 9.5, weight: .semibold)).foregroundStyle(theme.inkSecondary)
            }
            .padding(.horizontal, 8)
            .frame(height: 28)
            .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
        }
        .disabled(candidates.isEmpty || saving)
        .opacity(candidates.isEmpty ? 0.5 : 1)
        .accessibilityLabel(Text("Add a fallback engine"))
    }

    private func save(_ next: [ModelSelection]) {
        Task {
            saving = true
            _ = await session.updateFallback(next, for: bot)
            saving = false
        }
    }
}

/// More > Permissions' "Sending on your behalf" (`PermissionsSection.tsx`
/// OutboundControl): Ask every time, or Allow a daily amount (1 to 1000)
/// with today's count. Separate from the approval level: Full access does
/// not bypass it. An admin session's field only (`SurfaceFeature.botOutbound`).
struct BotPanelOutbound: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot

    @State private var capDraft = ""
    @State private var today: Int?
    @State private var saving = false
    @FocusState private var editingCap: Bool

    private var policy: OutboundPolicy { bot.outbound ?? .default }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Sending on your behalf").font(theme.font(15, .medium)).foregroundStyle(theme.ink)
            Text("Emails, messages, posts, invites, and payments through connected apps. Reading and drafting never count. This applies at every approval level, including Full access.")
                .panelText(13, 19.5)
                .foregroundStyle(theme.inkSecondary)
                .padding(.top, 2)
            HStack(spacing: 4) {
                choice("ask", title: "Ask every time")
                choice("allow", title: "Allow a daily amount")
            }
            .padding(2)
            .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .padding(.top, 12)
            if policy.policy == "allow" {
                HStack(spacing: 12) {
                    HStack(spacing: 8) {
                        Text("Up to")
                        TextField("", text: $capDraft)
                            .keyboardType(.numberPad)
                            .focused($editingCap)
                            .monospacedDigit()
                            .foregroundStyle(theme.ink)
                            .padding(.horizontal, 8)
                            .frame(width: 80, height: 28)
                            .background(theme.inset, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                            .onSubmit(commitCap)
                            .accessibilityLabel(Text("Daily outbound limit"))
                        Text("a day")
                    }
                    if let today {
                        Text("\(today) of \(policy.dailyCap) used today").monospacedDigit()
                    }
                }
                .font(theme.font(13))
                .foregroundStyle(theme.inkSecondary)
                .padding(.top, 12)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .onAppear { capDraft = String(policy.dailyCap) }
        .onValueChange(of: policy.dailyCap) { capDraft = String($0) }
        .onValueChange(of: editingCap) { if !$0 { commitCap() } }
        .task(id: "\(bot.id)-\(policy.policy)-\(policy.dailyCap)") {
            today = try? await session.settingsClient?.botOutboundToday(botId: bot.id)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-panel-outbound")
    }

    private func choice(_ value: String, title: LocalizedStringKey) -> some View {
        let on = policy.policy == value
        return Button {
            guard !on else { return }
            save(OutboundPolicy(policy: value, dailyCap: policy.dailyCap))
        } label: {
            Text(title)
                .font(theme.font(13, .medium))
                .foregroundStyle(on ? theme.ink : theme.inkSecondary)
                .frame(maxWidth: .infinity)
                .frame(height: 31)
                .background(on ? theme.raised : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(saving)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func commitCap() {
        guard let cap = OutboundPolicy.cap(capDraft) else { capDraft = String(policy.dailyCap); return }
        if cap != policy.dailyCap { save(OutboundPolicy(policy: policy.policy, dailyCap: cap)) }
    }

    private func save(_ next: OutboundPolicy) {
        Task {
            saving = true
            _ = await session.updateOutbound(next, for: bot)
            saving = false
        }
    }
}

/// More > Permissions' Primary Bot (`PermissionsSection.tsx`): the orange
/// star, "Primary Bot" and "One per person", the switch, and the line under
/// it. Turning it on hands the role over (POST /api/bots/:id/primary) where
/// the pairing allows it, else sets the bot's own flag; off clears it.
struct BotPanelPrimaryCard: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot
    let canEdit: Bool
    let sectionName: String

    @State private var working = false

    private var currentPrimary: Bot? {
        session.state.bots.first { $0.id != bot.id && $0.chiefOfStaff == true && $0.hidden != true }
    }

    var body: some View {
        PanelCard {
            HStack(spacing: 12) {
                Image(systemName: "star")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color(red: 0.98, green: 0.45, blue: 0.09))
                    .frame(width: 32, height: 32)
                    .background(theme.control, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                VStack(alignment: .leading, spacing: 0) {
                    Text("Primary Bot").panelText(13, 19.5, .medium).foregroundStyle(theme.ink)
                    Text("One per person").panelText(11.5, 17.25).foregroundStyle(theme.inkSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                PanelSwitch(label: "Primary Bot", isOn: bot.chiefOfStaff == true, disabled: !canEdit || working) { on in
                    Task { await toggle(on) }
                }
            }
            Text(detail)
                .panelText(13, 21.125)
                .foregroundStyle(theme.inkSecondary)
                .padding(.top, 12)
        }
    }

    private var detail: String {
        if bot.chiefOfStaff == true {
            return String(localized: "This is your primary bot, your main contact. It coordinates your other bots and specialists (home team: \(sectionName)), then combines their work into one answer.")
        }
        if let currentPrimary {
            return String(localized: "Make this bot your primary bot and hand the role over from \(currentPrimary.name).")
        }
        return String(localized: "Make this bot your primary bot, your main contact who coordinates your other bots.")
    }

    private func toggle(_ on: Bool) async {
        working = true
        defer { working = false }
        guard on, session.surfaceGate.allows(.primaryBot), let client = session.profileClient else {
            _ = await sendPanelPatch(BotPanelPatch(chiefOfStaff: on), bot: bot, session: session)
            return
        }
        do {
            let primary = try await client.makePrimaryBot(botId: bot.id)
            for changed in PrimaryBotRules.withPrimary(session.state.bots, primary: primary) where changed != session.state.bot(changed.id) {
                session.applyProfileBot(changed)
            }
        } catch {
            session.actionError = error.localizedDescription
        }
    }
}
