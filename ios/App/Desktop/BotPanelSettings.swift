// iPad I4: the More sections made of switches and choices (Access,
// Model, Permissions, Voice & alerts, Usage), as the references draw them
// (desktop-*-4[3-7]-panel-more-*): bordered cards (`rounded-xl border
// border-hairline/40 p-4`), 13 medium titles over 13 secondary copy, the
// 44x20 switch. The writes are the routes the phone already has (profile,
// access, model, voice engine) plus `BotPanelPatch` (PATCH /api/bots/:id)
// for Permissions and Works on, sent only when `SurfaceGate.botAccessEdit`
// allows it (an admin session); every other pairing reads them.
import SwiftUI
import UIKit
import CompanionCore

/// A card title and its 13 pt explanation, with an optional trailing
/// control (`flex items-center justify-between gap-4`).
struct PanelSettingRow<Trailing: View>: View {
    @Environment(\.desktopTheme) private var theme
    let title: LocalizedStringKey
    let detail: Text?
    var detailSize: CGFloat = 13
    var detailLine: CGFloat = 19.5
    @ViewBuilder let trailing: Trailing

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).panelText(13, 19.5, .medium).foregroundStyle(theme.ink)
                if let detail {
                    detail.panelText(detailSize, detailLine).foregroundStyle(theme.inkSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing
        }
    }
}

/// The admin-only writes of these sections.
@MainActor
func sendPanelPatch(_ patch: BotPanelPatch, bot: Bot, session: Session) async -> Bool {
    guard let client = session.profileClient else { return false }
    do {
        session.applyProfileBot(try await client.patchBotSettings(botId: bot.id, patch: patch))
        return true
    } catch {
        session.actionError = error.localizedDescription
        return false
    }
}

/// More > Computer on an organization server (`WorksOnSetting`): where the
/// bot works, the same card Access holds elsewhere.
struct BotPanelWorksOn: View {
    let bot: Bot

    var body: some View {
        BotPanelAccess(bot: bot, showsWorksOn: true, worksOnOnly: true)
    }
}

// MARK: - Model

/// Model (`ModelSection.tsx`): Default model (the chip opens the model
/// picker) and Effort (Default, then the engine's levels).
struct BotPanelModel: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot

    @State private var instances: [Instance] = []
    @State private var saving = false

    private var selection: ModelSelection { bot.currentTaskModelSelection }
    private var instance: Instance? { instances.first { $0.instanceId == selection.instanceId } }
    private var label: String {
        let id = selection.model.isEmpty ? (instance?.models.default ?? "") : selection.model
        return instance?.models.options.first { $0.id == id }?.label ?? id
    }
    private var levels: [String] {
        guard instance?.capabilities?.modelVariants != true else { return [] }
        let option = instance?.models.options.first { $0.id == selection.model }
        return ModelEffort.pickerLevels(option, engine: instance?.capabilities?.effortLevels ?? [])
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PanelCard {
                HStack(alignment: .center, spacing: 16) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Default model").panelText(13, 19.5, .medium).foregroundStyle(theme.ink)
                    }
                    .frame(width: 118, alignment: .leading)
                    Spacer(minLength: 0)
                    Button { model.modelPickerOpen = true } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "asterisk")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(Color(red: 0.85, green: 0.47, blue: 0.34))
                            Text(verbatim: label.isEmpty ? String(localized: "Choose a model") : label)
                                .font(theme.font(13))
                                .foregroundStyle(theme.ink)
                                .lineLimit(1)
                                .frame(maxWidth: 160)
                            Image(systemName: "chevron.down")
                                .font(.system(size: 9.5, weight: .semibold))
                                .foregroundStyle(theme.inkSecondary)
                        }
                        .padding(.leading, 8)
                        .padding(.trailing, 10)
                        .frame(height: 29.5)
                        .background(theme.control.opacity(0.6), in: Capsule())
                        .overlay(Capsule().strokeBorder(theme.hairline40, lineWidth: 1))
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(bot.busy == true)
                    .accessibilityIdentifier("desktop-panel-model")
                }
            }
            if !levels.isEmpty {
                PanelCard {
                    Text("Effort").panelText(13, 19.5, .medium).foregroundStyle(theme.ink)
                    Text(selection.effort == nil
                         ? "How hard this bot thinks in groups and new threads (Default: no level is sent)"
                         : "How hard this bot thinks in groups and new threads")
                        .panelText(13, 19.5)
                        .foregroundStyle(theme.inkSecondary)
                        .padding(.top, 2)
                    PanelFlow(spacing: 4, lineSpacing: 4) {
                        effortChip(nil)
                        ForEach(levels, id: \.self) { effortChip($0) }
                    }
                    .padding(.top, 8)
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(Text("Reasoning effort"))
                }
            }
            // #1137: who pays for this bot's replies (organization server)
            if BotPayerModel(bot: bot, session: session).visible {
                PanelCard {
                    Text("Who pays for replies").panelText(13, 19.5, .medium).foregroundStyle(theme.ink)
                    BotPayerPicker(bot: bot).padding(.top, 4)
                }
            }
            // An organization member sets the backup models of a bot they
            // own (bots.behaviour, PATCH /api/bots/:id {fallback}).
            if session.surfaceGate.allows(.botFallback, bot: bot) {
                AnyView(BotPanelFallback(bot: bot, instances: instances))
            }
        }
        .task { instances = await DesktopModelCatalog.shared.instances(session) }
    }

    private func effortChip(_ level: String?) -> some View {
        let on = selection.effort == level
        let ultracode = level.map(UltracodeEffort.isUltracode) == true
        return Button {
            guard !on else { return }
            Task {
                saving = true
                var next = selection
                next.effort = level
                _ = await session.updateModel(next, for: bot)
                saving = false
            }
        } label: {
            Text(verbatim: level.map { UltracodeEffort.label($0) } ?? String(localized: "Default"))
                .font(theme.font(12))
                .foregroundStyle(on ? (ultracode ? Color(red: 0.49, green: 0.23, blue: 0.93) : theme.ink) : theme.inkSecondary)
                .padding(.horizontal, 11)
                .frame(height: 28)
                .background(on ? (ultracode ? Color(red: 0.49, green: 0.23, blue: 0.93).opacity(0.12) : theme.control) : .clear, in: Capsule())
                .overlay(Capsule().strokeBorder(on ? (ultracode ? Color(red: 0.49, green: 0.23, blue: 0.93).opacity(0.5) : theme.accent.opacity(0.5)) : theme.hairline40, lineWidth: 1))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(saving || bot.busy == true)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    static func effortLabel(_ effort: String) -> String {
        UltracodeEffort.label(effort)
    }
}

// MARK: - Permissions

/// Permissions (`PermissionsSection.tsx`): Chief of Staff, ask before
/// contacting other bots, the approval level, the command allowlist.
struct BotPanelPermissions: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot

    @State private var levelOpen = false
    @State private var confirmingFull = false
    @State private var allowlist = false
    @State private var grants = false

    /// An admin session, or the bot's owner on an organization server
    /// (2026-10-26); each switch asks for its own field.
    private var canEdit: Bool { session.surfaceGate.allows(.botAccessEdit, bot: bot) }
    private func edits(_ field: String) -> Bool { canEdit && session.canEditBotField(bot, field) }
    private var level: ApprovalLevel { ApprovalLevel.of(approvalMode: bot.approvalSettingMode, autoApprove: bot.autoApprove) }
    private var proactive: ProactiveMode { ProactiveMode.of(bot.proactiveMode) }
    private var sectionName: String {
        let name = bot.section?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? String(localized: "Unassigned") : name
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // I-sync: the current renderer's Primary Bot (one per person,
            // PermissionsSection.tsx), in place of the per-team Chief of Staff.
            AnyView(BotPanelPrimaryCard(bot: bot, canEdit: edits("chiefOfStaff"), sectionName: sectionName))
            PanelCard {
                PanelSettingRow(title: "Ask me before contacting other bots",
                                detail: Text(bot.approvePeerComms == true
                                             ? "This bot will stop and ask before it reaches out to another bot."
                                             : "Let this bot talk to teammates on its own, without a confirmation step.")) {
                    PanelSwitch(label: "Ask me before contacting other bots", isOn: bot.approvePeerComms == true, disabled: !edits("approvePeerComms")) { on in
                        Task { _ = await sendPanelPatch(BotPanelPatch(approvePeerComms: on), bot: bot, session: session) }
                    }
                }
            }
            PanelCard {
                Text("Approval level").panelText(13, 19.5, .medium).foregroundStyle(theme.ink)
                Text("Applies to every thread of this bot at once: routines, delegated work and work another bot or an AI client sends here. A thread keeps its own level only when you chose one in it.")
                    .panelText(13, 19.5)
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.top, 2)
                Menu {
                    ForEach([ApprovalLevel.ask, .edits, .auto, .full], id: \.self) { option in
                        Button {
                            pick(option)
                        } label: {
                            Label {
                                Text(DesktopApprovalButton.label(option))
                            } icon: {
                                Image(systemName: option == level ? "checkmark" : DesktopApprovalButton.icon(option))
                            }
                        }
                    }
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: DesktopApprovalButton.icon(level))
                            .font(.system(size: 13))
                            .foregroundStyle(theme.ink)
                            .frame(width: 16)
                        Text(DesktopApprovalButton.label(level))
                            .font(theme.font(13))
                            .foregroundStyle(theme.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(theme.inkSecondary)
                    }
                    .padding(.horizontal, 14)
                    .frame(height: 40)
                    .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
                    .contentShape(Rectangle())
                }
                .disabled(!edits("approvalMode") || bot.busy == true)
                .padding(.top, 12)
                .accessibilityLabel(Text("Approval level"))
                Text(DesktopApprovalButton.detail(level))
                    .panelText(13, 19.5)
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.top, 6)
                    .accessibilityIdentifier("desktop-panel-approval-detail")
                AppliedLevelNote(bot: bot)
                    .foregroundStyle(theme.ink)
                    .padding(.top, 6)
                if session.surfaceGate.allows(.commandAllowlist) {
                    Button { allowlist = true } label: {
                        Text("Manage command allowlist").panelText(13, 19.5).foregroundStyle(theme.inkSecondary)
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 12)
                    .accessibilityIdentifier("desktop-panel-allowlist")
                }
                Button { grants = true } label: {
                    Text("Approval rules").panelText(13, 19.5).foregroundStyle(theme.inkSecondary)
                }
                .buttonStyle(.plain)
                .padding(.top, 12)
                .accessibilityIdentifier("desktop-panel-approval-grants")
            }
            // 2026-10-30: Proactive, as on the desktop (PermissionsSection.tsx)
            PanelCard {
                Text("Proactive").panelText(13, 19.5, .medium).foregroundStyle(theme.ink)
                Text("How this bot acts on its own on an email, a calendar entry, a failed run, another bot's post or a webhook.")
                    .panelText(13, 19.5)
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.top, 2)
                Menu {
                    ForEach(ProactiveMode.allCases, id: \.self) { mode in
                        Button {
                            guard mode != proactive else { return }
                            Task { _ = await sendPanelPatch(BotPanelPatch(proactiveMode: mode.rawValue), bot: bot, session: session) }
                        } label: {
                            if mode == proactive { Label(mode.label, systemImage: "checkmark") } else { Text(mode.label) }
                        }
                    }
                } label: {
                    HStack(spacing: 10) {
                        Text(proactive.label)
                            .font(theme.font(13))
                            .foregroundStyle(theme.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(theme.inkSecondary)
                    }
                    .padding(.horizontal, 14)
                    .frame(height: 40)
                    .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
                    .contentShape(Rectangle())
                }
                .disabled(!edits("proactiveMode"))
                .padding(.top, 12)
                .accessibilityLabel(Text("Proactive"))
                .accessibilityIdentifier("desktop-panel-proactive")
                Text(proactive.hint)
                    .panelText(13, 19.5)
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.top, 6)
            }
            // #2048: remembered publish target (page / artifact surface).
            if edits("pageTargetDefault") {
                PanelCard {
                    Text("Publish target").panelText(13, 19.5, .medium).foregroundStyle(theme.ink)
                    Text(PageTargetDefaultChoice.summary(for: bot.pageTargetDefault))
                        .panelText(13, 19.5)
                        .foregroundStyle(theme.inkSecondary)
                        .padding(.top, 2)
                    Menu {
                        ForEach(PageTargetDefaultChoice.all, id: \.id) { choice in
                            Button {
                                let current = bot.pageTargetDefault ?? ""
                                guard choice.id != current else { return }
                                Task {
                                    _ = await sendPanelPatch(
                                        BotPanelPatch(pageTargetDefault: choice.id.isEmpty ? "" : choice.id),
                                        bot: bot, session: session
                                    )
                                }
                            } label: {
                                if (bot.pageTargetDefault ?? "") == choice.id {
                                    Label(choice.label, systemImage: "checkmark")
                                } else {
                                    Text(choice.label)
                                }
                            }
                        }
                    } label: {
                        HStack(spacing: 10) {
                            Text(PageTargetDefaultChoice.label(for: bot.pageTargetDefault ?? ""))
                                .font(theme.font(13))
                                .foregroundStyle(theme.ink)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Image(systemName: "chevron.down")
                                .font(.system(size: 9, weight: .semibold))
                                .foregroundStyle(theme.inkSecondary)
                        }
                        .padding(.horizontal, 14)
                        .frame(height: 40)
                        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
                        .contentShape(Rectangle())
                    }
                    .disabled(bot.busy == true)
                    .padding(.top, 12)
                    .accessibilityLabel(Text("Publish target"))
                    .accessibilityIdentifier("desktop-panel-page-target")
                }
            }
            if session.surfaceGate.allows(.botOutbound, bot: bot) {
                AnyView(BotPanelOutbound(bot: bot))
            }
        }
        .alert("Give this bot Full access?", isPresented: $confirmingFull) {
            Button("Cancel", role: .cancel) {}
            Button("Full access", role: .destructive) {
                Task { _ = await sendPanelPatch(.approval(.full), bot: bot, session: session) }
            }
        } message: {
            Text("It runs commands and edits files without asking, in every thread. Use only with bots you trust.")
        }
        .sheet(isPresented: $allowlist) {
            NavigationStack { CommandAllowlistPage(bot: bot) }
                .environmentObject(session)
        }
        .sheet(isPresented: $grants) {
            NavigationStack { ApprovalGrantsPage(botId: bot.id, showsDone: true) }
                .environmentObject(session)
        }
    }

    private func pick(_ option: ApprovalLevel) {
        guard option != level, bot.busy != true else { return }
        if option == .full { confirmingFull = true; return }
        Task { _ = await sendPanelPatch(.approval(option), bot: bot, session: session) }
    }
}

// MARK: - Voice & alerts

/// Voice & alerts (`VoiceSection.tsx` with `VoiceSettings`): the voice card
/// (engine, key status, read replies aloud, voice notes) and Notifications.
/// Provider keys stay on the computer: the iPad says where to add one.
struct BotPanelVoice: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot

    @State private var config: ConfigStatus?
    @State private var switching = false

    private var provider: VoiceProvider { config?.voiceProvider ?? .elevenlabs }
    private var providerName: String {
        switch provider {
        case .elevenlabs: "ElevenLabs"
        case .fish: "Fish Audio"
        case .system: String(localized: "Built-in Mac voices")
        case .chatterbox: "Chatterbox"
        case .xai: "xAI"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Voice").panelText(15, 22.5, .medium).foregroundStyle(theme.ink)
                Text(intro).panelText(13, 19.5).foregroundStyle(theme.inkSecondary).padding(.top, 2)
                if session.surfaceGate.allows(.voiceEngineSettings) {
                    Text("Voice engine").panelText(13, 19.5).foregroundStyle(theme.inkSecondary).padding(.top, 16)
                    engineGrid.padding(.top, 8)
                }
                keyStatus.padding(.top, 16)
                Rectangle().fill(theme.hairline40).frame(height: 1).padding(.top, 16)
                PanelSettingRow(title: "Read replies aloud",
                                detail: Text("Speak this agent's answers as they arrive, even from another chat."),
                                detailSize: 11.5, detailLine: 18.69) {
                    PanelSwitch(label: "Read this bot's replies aloud", isOn: bot.speakReplies == true) { on in
                        Task { _ = await session.updateProfile(BotProfilePatch(speakReplies: on), for: bot) }
                    }
                }
                .padding(.top, 16)
                if session.surfaceGate.allows(.voiceNotesSetting, bot: bot) {
                    PanelSettingRow(title: "Voice notes",
                                    detail: Text("Let this agent send spoken notes; on unless switched off here."),
                                    detailSize: 11.5, detailLine: 18.69) {
                        PanelSwitch(label: "Let this bot send voice notes", isOn: bot.voiceNotes != false) { on in
                            Task {
                                guard let client = session.profileClient else { return }
                                do { session.applyProfileBot(try await client.editBot(botId: bot.id, edit: BotProfileEdit(voiceNotes: on))) }
                                catch { session.actionError = error.localizedDescription }
                            }
                        }
                    }
                    .padding(.top, 16)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            PanelCard {
                PanelSettingRow(title: "Notifications", detail: Text("Get notified when this agent finishes or needs input")) {
                    PanelSwitch(label: "Agent notifications", isOn: bot.notifications) { on in
                        Task { _ = await session.updateProfile(BotProfilePatch(notifications: on), for: bot) }
                    }
                }
            }
        }
        .task { config = await session.configStatus() }
    }

    private var intro: LocalizedStringKey {
        switch provider {
        case .system: "Give this agent a voice for calls and spoken replies. The voice choice belongs to this agent; the voices are the ones already installed on this Mac."
        case .chatterbox: "Give this agent a voice for calls and spoken replies. The voice choice belongs to this agent; the Chatterbox server address is shared by this installation."
        case .xai: "Give this agent a voice for calls and spoken replies. The voice choice belongs to this agent; Grok uses this installation’s existing xAI key."
        case .fish: "Give this agent a voice for calls and spoken replies. The voice choice belongs to this agent; the Fish Audio key is shared by this installation."
        case .elevenlabs: "Give this agent a voice for calls and spoken replies. The voice choice belongs to this agent; the ElevenLabs key is shared by this installation."
        }
    }

    private var engineGrid: some View {
        let options: [(VoiceProvider, String)] = [
            (.elevenlabs, "ElevenLabs"), (.fish, "Fish Audio"),
            (.system, String(localized: "Built-in Mac voices")), (.chatterbox, String(localized: "Chatterbox (local)")),
            (.xai, String(localized: "Grok (xAI)")),
        ]
        return LazyVGrid(columns: [GridItem(.flexible(), spacing: 4), GridItem(.flexible(), spacing: 4)], spacing: 4) {
            ForEach(options, id: \.0) { option in
                let on = option.0 == provider
                Button {
                    guard !on, !switching else { return }
                    Task {
                        switching = true
                        if let updated = await session.setVoiceProvider(option.0) { config = updated }
                        switching = false
                    }
                } label: {
                    Text(verbatim: option.1)
                        .font(theme.font(12.5))
                        .foregroundStyle(on ? theme.ink : theme.inkSecondary)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity)
                        .frame(height: 30.8)
                        .background(on ? theme.raised : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .shadow(color: on ? .black.opacity(0.15) : .clear, radius: 1, y: 1)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(switching)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(4)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Voice engine"))
    }

    /// The provider's key: on the desktop a field to paste it; here where
    /// it is set, since keys never come to this device.
    private var keyStatus: some View {
        let configured = config?.isTTSConfigured == true
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Circle().fill(configured ? theme.success : theme.raisedHover).frame(width: 6, height: 6)
                Group {
                    if provider == .system || provider == .chatterbox {
                        Text(verbatim: providerName)
                    } else {
                        Text("\(providerName) key")
                    }
                }
                    .panelText(13, 19.5)
                    .foregroundStyle(theme.ink)
            }
            Text(configured
                 ? "Set on your computer. Keys never come to this device."
                 : "Add it in Sagax on your computer.")
                .font(theme.font(13))
                .foregroundStyle(theme.inkSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, minHeight: 37.5, alignment: .leading)
                .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
                .padding(.top, 6)
            if provider == .elevenlabs, let url = URL(string: "https://elevenlabs.io/app/settings/api-keys") {
                Link(destination: url) {
                    Text("Get a key from ElevenLabs").panelText(12, 18, .medium).foregroundStyle(theme.accent)
                }
                .padding(.top, 6)
            }
        }
    }
}

// MARK: - Usage

/// Usage (`UsageSection.tsx`): what the bot has spent across its threads.
struct BotPanelUsage: View {
    @Environment(\.desktopTheme) private var theme
    let bot: Bot

    var body: some View {
        let total = BotUsageTotal.of(bot)
        PanelCard {
            if total.turns == 0 {
                Text("No usage recorded yet.").panelText(13, 19.5).foregroundStyle(theme.inkSecondary)
            } else {
                HStack(alignment: .top, spacing: 24) {
                    figure("Tokens", BotUsageTotal.formatTokens(total.headlineTokens))
                    if total.hasCost, let cost = total.costUsd { figure("Cost", BotUsageTotal.formatUsd(cost)) }
                    figure("Turns", "\(total.turns)")
                }
                Text("Input \(BotUsageTotal.formatTokens(total.input)) · output \(BotUsageTotal.formatTokens(total.output))")
                    .panelText(12, 18)
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.top, 12)
            }
        }
    }

    private func figure(_ label: LocalizedStringKey, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(theme.font(11.5)).foregroundStyle(theme.inkSecondary)
            Text(verbatim: value).font(theme.font(17, .medium)).foregroundStyle(theme.ink).monospacedDigit()
        }
    }
}
