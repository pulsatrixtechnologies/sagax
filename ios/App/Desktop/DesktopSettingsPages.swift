// iPad lot 2 (2026-11-03 audit): the desktop Settings pages the iPad did
// not have, laid out as SettingsModal.tsx draws them.
//
// - Models (`engines`): the "Bot models" table, a section per team with
//   its count, one row per bot (Bot, Model, Effort); the model opens the
//   same model menu as the composer's Model row. The Decision model card
//   follows, as on the desktop.
// - Voice: "Who speaks and who listens" (Voice, Speed, Speech to text), the
//   same preference the desktop keeps (`omb.voiceMode.v1`), then Audio.
// - Updates: this app's version; the iPad updates through the App Store or
//   TestFlight, not through the desktop's updater.
import SwiftUI
import AVFoundation
import UIKit
import CompanionCore

// MARK: - Models

struct DesktopBotModelsPage: View {
    @Environment(\.desktopSettingsQuery) private var query

    var body: some View {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let decision = q.count >= 3 && DesktopSettingsSection.decisionModel.matches(q, label: "")
        DesktopNewBotDefaults()
        DesktopBotModelsTable()
            .padding(.top, 12)
        DesktopSettingsCard(Text("Decision model"), summary: Text(verbatim: "Jev"), open: decision, identifier: "engines.decisionModel") {
            VStack(alignment: .leading, spacing: 12) {
                AnyView(DesktopDecisionModelSettings())
            }
        }
        .id("decision-\(decision)")
        .padding(.top, 12)
    }
}

/// "Defaults for new bots" (DefaultBotSettings, NewBotDialog.tsx): the
/// row with its summary, "Share as preset…" and "Edit", which opens the
/// New Bot editor in its defaults mode on the desktop; here Edit holds what
/// the iPad can set for new bots, their effort.
struct DesktopNewBotDefaults: View {
    @EnvironmentObject private var model: DesktopSettingsModel
    @EnvironmentObject private var session: Session
    @State private var editing = false
    @State private var sharing = false

    var body: some View {
        let config = model.config
        if session.surfaceGate.viewer?.isOperator != false {
            DesktopSettingsGroup(Text("Defaults for new bots"),
                                 accessory: AnyView(DesktopHelpTip(help: Text("The model, effort and other starting choices every new bot of yours begins with."))),
                                 identifier: "bot-models-defaults") {
                HStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 0) {
                        DesktopText(Text("Defaults for new bots"))
                        if let effort = config?.newBots?.effort, !effort.isEmpty {
                            DesktopText(verbatim: DesktopGeneralSettings.effortLabel(effort), size: 12, line: 16, color: \.inkSecondary).lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Button("Share as preset…") { sharing = true }
                        .buttonStyle(DesktopButtonStyle(kind: .ghost))
                        .popover(isPresented: $sharing) {
                            DesktopText("Presets are shared from Sagax on your computer.", size: 12, line: 17, color: \.inkSecondary)
                                .frame(width: 232, alignment: .leading)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(12)
                                .desktopPopoverOnCompact()
                        }
                        .accessibilityIdentifier("desktop-settings.share-preset")
                    Button("Edit") { editing = true }
                        .buttonStyle(DesktopPillButtonStyle())
                        .accessibilityIdentifier("desktop-settings.defaults-edit")
                        .popover(isPresented: $editing) {
                            VStack(alignment: .leading, spacing: 8) {
                                DesktopText(Text("Effort for new bots"), weight: .medium)
                                DesktopText(Text("How hard new bots think from their first message."), size: 12, line: 16, color: \.inkSecondary)
                                DesktopPillSelect(
                                    options: [("", AppStrings.localized("Provider default"))] + DesktopEffort.levels.map { ($0, DesktopGeneralSettings.effortLabel($0)) },
                                    selection: config?.newBots?.effort ?? "",
                                    label: Text("Effort for new bots"),
                                    identifier: "desktop-settings.effort",
                                    disabled: !model.saving.isEmpty || config == nil
                                ) { value in setEffort(value) }
                            }
                            .padding(14)
                            .frame(width: 280, alignment: .leading)
                            .desktopPopoverOnCompact()
                        }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
            }
        }
    }
}

extension DesktopNewBotDefaults {
    func setEffort(_ value: String) {
        let change = DesktopConfigChange.newBotEffort(value.isEmpty ? nil : value)
        Task { @MainActor in _ = await model.apply(change, key: "effort") }
    }
}

/// `BotModelsSettings`: "Bot models" and its help, the column heads
/// (Bot, Model, Effort, Account, Backup), then each section with its own
/// checkbox and its bots: their checkbox, avatar, model menu (the provider's
/// mark), effort menu, who pays and backup. The person's own bots only,
/// Unassigned first, then the sections in the bots' order.
struct DesktopBotModelsTable: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @State private var instances: [Instance] = []
    @State private var editing: Bot?
    @State private var selected: Set<String> = []

    private static let columns: [CGFloat] = [0.9, 1.8, 0.8, 0.9, 0.8]
    /// `ROW_GRID`'s minimums: minmax(6rem, …), minmax(10rem, …), 6rem, 6.5rem, 5.5rem.
    private static let minimums: [CGFloat] = [96, 160, 96, 104, 88]

    /// CSS grid `minmax(min, fr)`: a column whose share is under its minimum
    /// keeps the minimum, the others share what is left by their weights.
    static func widths(_ total: CGFloat) -> [CGFloat] {
        var fixed = Set<Int>()
        while true {
            let free = total - fixed.reduce(0) { $0 + minimums[$1] }
            let weight = columns.indices.filter { !fixed.contains($0) }.reduce(0) { $0 + columns[$1] }
            let unit = weight > 0 ? free / weight : 0
            let under = columns.indices.filter { !fixed.contains($0) && columns[$0] * unit < minimums[$0] }
            if under.isEmpty {
                return columns.indices.map { fixed.contains($0) ? minimums[$0] : columns[$0] * unit }
            }
            fixed.formUnion(under)
        }
    }

    var body: some View {
        DesktopSettingsGroup(Text("Bot models"),
                             accessory: AnyView(DesktopHelpTip(help: Text("Your bots' engines and models in one place. Change them here without starting a turn, including when an engine is out of credit."))),
                             identifier: "bot-models-table") {
            if groups.isEmpty {
                DesktopSettingsTextRow(Text("You have no bots yet."))
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    grid([
                        AnyView(column(Text("Bot"))), AnyView(column(Text("Model")).padding(.leading, 8)),
                        AnyView(column(Text("Effort")).padding(.leading, 8)), AnyView(column(Text("Account")).padding(.leading, 8)),
                        AnyView(column(Text("Backup")).padding(.leading, 8)),
                    ]) {
                        Color.clear.frame(width: 20)
                    }
                    .padding(.top, 4).padding(.bottom, 8)
                    .overlay(alignment: .bottom) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1) }
                    ForEach(groups, id: \.name) { group in
                        let ids = group.bots.map(\.id)
                        let allOn = !ids.isEmpty && ids.allSatisfy(selected.contains)
                        HStack(spacing: 10) {
                            DesktopCheckbox(checked: allOn, label: Text(verbatim: String(format: AppStrings.localized("Select every bot in %@"), group.name)),
                                            identifier: "desktop-settings.bot-models.section-select") {
                                if allOn { selected.subtract(ids) } else { selected.formUnion(ids) }
                            }
                            DesktopText(verbatim: "\(group.name) (\(group.bots.count))", color: \.inkSecondary).lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 12)
                        .padding(.top, 14).padding(.bottom, 6)
                        ForEach(group.bots) { bot in row(bot) }
                    }
                }
            }
        }
        .task { instances = await DesktopModelCatalog.shared.instances(session) }
        .popover(item: $editing) { bot in
            ModelMenuSheet(bot: bot, close: { editing = nil })
                .environmentObject(session)
                .frame(minWidth: 340, idealWidth: 360, minHeight: 480, idealHeight: 560)
        }
        .accessibilityIdentifier("desktop-settings.bot-models")
    }

    /// `ROW_GRID`: the checkbox column, then the five columns by their weights.
    private func grid<Lead: View>(_ cells: [AnyView], @ViewBuilder lead: () -> Lead) -> some View {
        HStack(spacing: 10) {
            lead()
            GeometryReader { geometry in
                let widths = Self.widths(geometry.size.width - CGFloat(Self.columns.count - 1) * 10)
                HStack(spacing: 10) {
                    ForEach(cells.indices, id: \.self) { index in
                        cells[index].frame(width: widths[index], alignment: .leading)
                    }
                }
                .frame(maxHeight: .infinity)
            }
        }
        .frame(minHeight: 18)
        .padding(.horizontal, 12)
    }

    private func column(_ title: Text) -> some View {
        DesktopText(title, size: 12, line: 16, color: \.inkSecondary).lineLimit(1)
    }

    private func row(_ bot: Bot) -> some View {
        let mayEdit = session.surfaceGate.ownsBot(bot)
        let cells: [AnyView] = [
            AnyView(HStack(spacing: 8) {
                ChatAvatarView(chat: .bot(bot), size: 24, state: MausState.forChat(.bot(bot), in: session.state), background: theme.panel)
                    .frame(width: 24, height: 24)
                DesktopText(Text(verbatim: bot.name), weight: .semibold).lineLimit(1)
            }),
            AnyView(Button { editing = bot } label: {
                HStack(spacing: 6) {
                    if bot.modelSelection.auto != true {
                        ProviderMarkView(driverKind: instances.first { $0.instanceId == bot.modelSelection.instanceId }?.driverKind ?? "", size: 13)
                            .frame(width: 14, height: 14)
                    }
                    // ModelPicker listChip: the label, the chevron right after it
                    DesktopText(Text(verbatim: modelLabel(bot)), weight: .medium).lineLimit(1).fixedSize()
                    DesktopSettingsIconView(icon: .chevronDown, size: 13).foregroundStyle(theme.inkSecondary)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 4).frame(height: 32).contentShape(Rectangle())
            }
            .buttonStyle(DesktopHoverFill(radius: 8))
            .disabled(!mayEdit)
            .accessibilityLabel(Text(verbatim: "\(bot.name), \(modelLabel(bot))"))
            .accessibilityIdentifier("desktop-settings.bot-model.\(bot.id)")),
            AnyView(DesktopPillSelect(
                options: [("", AppStrings.localized("Default"))] + DesktopEffort.levels.map { ($0, DesktopGeneralSettings.effortLabel($0)) },
                selection: bot.modelSelection.effort ?? "",
                label: Text("Effort"), identifier: "desktop-settings.bot-effort.\(bot.id)",
                disabled: !mayEdit || bot.busy == true, fill: true
            ) { value in
                var next = bot.modelSelection
                next.effort = value.isEmpty ? nil : value
                Task { _ = await session.updateModel(next, for: bot, updateBotDefault: true) }
            }),
            AnyView(DesktopText(verbatim: "—").padding(.horizontal, 8)),
            AnyView(DesktopPillSelect(
                options: [("", AppStrings.localized("None"))] + instances.filter { $0.instanceId != bot.modelSelection.instanceId }.map { ($0.instanceId, $0.displayName ?? $0.instanceId) },
                selection: bot.fallback?.first?.instanceId ?? "",
                shown: backupLabel(bot),
                label: Text("Backup"), identifier: "desktop-settings.bot-backup.\(bot.id)",
                disabled: !mayEdit || bot.busy == true, fill: true
            ) { value in
                let next: [ModelSelection] = instances.first { $0.instanceId == value }.map { [ModelSelection(instanceId: $0.instanceId, model: $0.models.default)] } ?? []
                Task { _ = await session.updateFallback(next, for: bot) }
            }),
        ]
        return grid(cells) {
            DesktopCheckbox(checked: selected.contains(bot.id), label: Text(verbatim: String(format: AppStrings.localized("Select %@"), bot.name)),
                            identifier: "desktop-settings.bot-models.select.\(bot.id)") {
                if selected.contains(bot.id) { selected.remove(bot.id) } else { selected.insert(bot.id) }
            }
        }
        .frame(minHeight: 44)
        .padding(.vertical, 2)
        .overlay(alignment: .top) { Rectangle().fill(theme.hairline.opacity(0.3)).frame(height: 1) }
    }

    /// `ownBotsForModelsPage` and `groupBotsBySidebarSection`: the person's
    /// own visible bots, Unassigned first, then sections in first-seen order.
    private var groups: [(name: String, bots: [Bot])] {
        let bots = session.state.bots.filter { $0.hidden != true && session.surfaceGate.ownsBot($0) }
        var order: [String] = []
        var bySection: [String: [Bot]] = [:]
        for bot in bots {
            let section = bot.section?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if bySection[section] == nil { order.append(section) }
            bySection[section, default: []].append(bot)
        }
        let ranked = order.filter(\.isEmpty) + order.filter { !$0.isEmpty }
        return ranked.map { ($0.isEmpty ? AppStrings.localized("Unassigned") : $0, bySection[$0] ?? []) }
    }

    private func modelLabel(_ bot: Bot) -> String {
        let selection = bot.modelSelection
        if selection.auto == true { return String(localized: "Auto") }
        let instance = instances.first { $0.instanceId == selection.instanceId }
        let id = selection.model.isEmpty ? (instance?.models.default ?? "") : selection.model
        let label = instance?.models.options.first { $0.id == id }?.label ?? id
        return label.isEmpty ? String(localized: "Default") : label
    }

    private func backupLabel(_ bot: Bot) -> String {
        let names = (bot.fallback ?? []).compactMap { entry in instances.first { $0.instanceId == entry.instanceId }.map { $0.displayName ?? $0.instanceId } }
        return names.isEmpty ? AppStrings.localized("None") : names.joined(separator: ", ")
    }
}

// MARK: - Voice

/// Settings > Voice (VoiceSettings.tsx): "Who speaks and who listens"
/// (the voice, its speed, the language heard), then Audio.
struct DesktopVoiceSettings: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopSettingsModel
    @AppStorage(VoiceModeSettings.storageKey) private var voiceRaw = ""
    /// `VOICE_DASHES_PREFERENCE` (shared/voice-dashes.ts): "on", "off", or
    /// absent (on in French, off otherwise).
    @AppStorage("sagax.voiceDashes.v1") private var dashesRaw = ""
    @State private var status: VoiceProvidersStatus?
    @State private var statusFailed: String?
    @State private var voices: [VoiceModeVoice]?
    @State private var testing = false
    @State private var note: String?
    @State private var player: AVAudioPlayer?
    @State private var serverURL = ""
    @State private var serverModel = ""
    @State private var serverError: String?
    @State private var savingServer = false

    private var settings: VoiceModeSettings { VoiceModeSettings.decode(voiceRaw.isEmpty ? nil : voiceRaw) }

    private var noDashes: Bool {
        if dashesRaw == "on" { return true }
        if dashesRaw == "off" { return false }
        return Locale.current.language.languageCode?.identifier == "fr"
    }

    private func label(_ provider: String) -> String {
        VoiceProviderChoice.label(provider, system: AppStrings.localized("Built-in Mac voices"), chatterbox: AppStrings.localized("Chatterbox (local)"))
    }

    private func noKey(_ name: String) -> String { String(format: AppStrings.localized("%@ (no key)"), name) }

    var body: some View {
        let tts = settings.personTts
        let stt = settings.personStt
        let speaking = VoiceProviderChoice.speaking(picked: tts, status: status)
        DesktopSettingsGroup(Text("Who speaks and who listens"), identifier: "voiceProviders") {
            if let statusFailed, status == nil {
                DesktopDescribedRow(Text("Bot's voice"), description: Text(verbatim: statusFailed)) { EmptyView() }
            } else if let status, status.offeredTts.isEmpty && status.offeredStt.isEmpty && tts == "auto" {
                DesktopDescribedRow(Text("Bot's voice"), description: Text("Add a key in Providers, or use an installed voice, to choose who speaks and who listens.")) { EmptyView() }
            } else {
                DesktopDescribedRow(Text("Bot's voice"), help: Text("Only the providers you have a key for are offered. If one fails or reaches its limit, another one you have takes over by itself, and the conversation's Events tab says so."), identifier: "voiceProviders.tts") {
                    DesktopPillSelect(
                        options: VoiceProviderChoice.options(offered: status?.offeredTts ?? [], all: VoiceModeSettings.ttsProviders, picked: tts,
                                                             auto: AppStrings.localized("Auto"), label: label, noKey: noKey),
                        selection: tts, label: Text("Bot's voice"), identifier: "desktop-settings.voice.tts"
                    ) { value in
                        note = nil
                        voiceRaw = settings.withTts(value == "auto" ? nil : value).encoded
                        Task { await loadStatus() }
                    }
                }
                DesktopCompactRow(Text("Voice"), identifier: "voiceProviders.voice") {
                    let selected = speaking.map { settings.personVoice(of: $0) } ?? ""
                    let base: [(String, String)] = [("", voices == nil && speaking != nil ? AppStrings.localized("Loading voices…") : AppStrings.localized("Provider's default voice"))]
                    let kept: [(String, String)] = !selected.isEmpty && !(voices ?? []).contains { $0.id == selected } ? [(selected, selected)] : []
                    DesktopPillSelect(
                        options: base + kept + (voices ?? []).map { ($0.id, PhoneBotCallVoiceCard.capitalizedLabel($0.label)) },
                        selection: selected,
                        label: Text(verbatim: String(format: AppStrings.localized("%@ voice"), speaking.map(label) ?? "")),
                        identifier: "desktop-settings.voice.voice", disabled: speaking == nil
                    ) { value in
                        note = nil
                        voiceRaw = settings.withPersonVoice(value).encoded
                    }
                    Button { Task { await test() } } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "speaker.wave.2").font(.system(size: 12))
                            Text("Test the voice")
                        }
                    }
                    .buttonStyle(DesktopPillButtonStyle())
                    .disabled(testing || speaking == nil || (status?.offeredTts.isEmpty ?? true))
                    .accessibilityIdentifier("desktop-settings.voice.test")
                }
                DesktopDescribedRow(Text("Speech to text"), help: Text("Who turns what you say into text on a call and in dictation."), identifier: "voiceProviders.stt") {
                    DesktopPillSelect(
                        options: VoiceProviderChoice.options(offered: status?.offeredStt ?? [], all: VoiceModeSettings.sttProviders, picked: stt,
                                                             auto: AppStrings.localized("Auto"), label: label, noKey: noKey),
                        selection: stt, label: Text("Speech to text"), identifier: "desktop-settings.voice.stt"
                    ) { value in
                        voiceRaw = settings.withStt(value == "auto" ? nil : value).encoded
                        Task { await loadStatus() }
                    }
                }
            }
            if let note {
                DesktopText(verbatim: note, size: 12, line: 16, color: \.danger)
                    .padding(.horizontal, 14).padding(.bottom, 8)
            }
        }
        // VoiceSettingsPage: `flex-col gap-6`
        if model.config?.tts != nil {
            AnyView(advanced).padding(.top, 12)
        }
        AnyView(audio).padding(.top, 12)
        Color.clear.frame(height: 0)
            .task(id: model.loaded) {
                serverURL = model.config?.tts?.baseUrl ?? ""
                serverModel = model.config?.tts?.model ?? ""
                seedInstalledVoice()
                await loadStatus()
            }
    }

    private var advanced: some View {
            DesktopSettingsGroup(Text("Advanced"), identifier: "voice-options") {
                DesktopDescribedRow(Text("Fish Audio model"),
                                    help: Text("Pick the model your Fish Audio plan covers. It applies to every agent on this installation."), identifier: "fishModel") {
                    DesktopPillSelect(options: [("s2.1-pro", AppStrings.localized("s2.1-pro (default)")), ("s2.1-pro-free", AppStrings.localized("s2.1-pro-free (free for developers)"))],
                                      selection: model.config?.tts?.fishModel ?? "s2.1-pro", label: Text("Fish Audio model"),
                                      identifier: "desktop-settings.voice.fish", disabled: model.config == nil) { value in
                        Task { _ = await model.apply(.fishModel(value), key: "fishModel") }
                    }
                }
                // DescribedRow with its grey line (`mt-0.5`) and the form below (`mt-2`)
                VStack(alignment: .leading, spacing: 0) {
                    DesktopText(Text("Chatterbox server"))
                    HStack(spacing: 6) {
                        Circle().fill(model.config?.tts?.baseUrl?.isEmpty == false ? theme.accent : theme.raisedHover).frame(width: 6, height: 6)
                        DesktopText(model.config?.tts?.baseUrl?.isEmpty == false ? Text("Saved") : Text("Any OpenAI-compatible server running Chatterbox works. No key is needed."),
                                    size: 12, line: 16, color: \.inkSecondary)
                        Link(destination: URL(string: "https://github.com/resemble-ai/chatterbox")!) {
                            DesktopText(Text("How to run one locally"), size: 12, weight: .medium, line: 16, color: \.accentText)
                        }
                    }
                    .padding(.top, 2)
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) {
                            field(Text(verbatim: "http://127.0.0.1:4123"), text: $serverURL, url: true)
                                .accessibilityIdentifier("desktop-settings.voice.chatterbox-url")
                            Button { Task { await saveServer() } } label: {
                                HStack(spacing: 4) {
                                    DesktopSettingsIconView(icon: .check, size: 13)
                                    Text("Save")
                                }
                            }
                            .buttonStyle(DesktopPillButtonStyle())
                            // `savingServer || !serverUrl.trim()`, as the desktop
                            .disabled(savingServer || serverURL.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                        field(Text("Model id, default chatterbox-turbo"), text: $serverModel, url: false)
                        if let serverError { DesktopText(Text(verbatim: serverError), size: 12, line: 16, color: \.danger) }
                    }
                    .padding(.top, 8)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                DesktopDescribedRow(Text("No em or en dashes in replies"),
                                    description: Text("Replaces them in the final text of bot replies: a range word between times and numbers, a colon after a list label, a comma elsewhere. On by default in French."),
                                    identifier: "voiceNoDashes") {
                    DesktopSwitch(isOn: noDashes, label: Text("No em or en dashes in replies"), identifier: "desktop-settings.voice.no-dashes") {
                        dashesRaw = noDashes ? "off" : "on"
                    }
                }
            }
    }

    private var audio: some View {
        DesktopSettingsGroup(Text("Audio"), identifier: "audio") {
            HStack(spacing: 20) {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "mic").font(.system(size: 12)).foregroundStyle(theme.inkSecondary).padding(.top, 2)
                    VStack(alignment: .leading, spacing: 2) {
                        DesktopText(Text("Microphone"))
                        DesktopText(Text("Used for dictation, voice notes and calls on this iPad."), size: 12, line: 16, color: \.inkSecondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                // iPadOS picks the input (the built-in microphone, a headset):
                // the desktop's device list is the system default here
                DesktopPillSelect(options: [("", AppStrings.localized("System default"))], selection: "",
                                  label: Text("Microphone"), identifier: "desktop-settings.voice.microphone") { _ in }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
        }
    }

    private func field(_ prompt: Text, text: Binding<String>, url: Bool) -> some View {
        TextField(text: text, prompt: prompt.foregroundColor(theme.inkSecondary)) { prompt }
            .font(theme.font(13))
            .foregroundStyle(theme.ink)
            .keyboardType(url ? .URL : .default)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.done)
            .onSubmit { Task { await saveServer() } }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
    }

    /// `migrateInstalledVoiceSettings`: on a solo installation, the first
    /// time nothing is stored, the installation's voice becomes the person's.
    private func seedInstalledVoice() {
        guard voiceRaw.isEmpty, let config = model.config, config.personalSettings != true, let tts = config.tts else { return }
        voiceRaw = VoiceModeSettings.installed(provider: tts.provider, voice: tts.voice).encoded
    }

    private func loadStatus() async {
        guard let client = session.settingsClient else { return }
        do {
            status = try await client.voiceProvidersStatus(tts: settings.personTts, stt: settings.personStt)
            statusFailed = nil
        } catch {
            statusFailed = error.localizedDescription
        }
        await loadVoices()
    }

    private func loadVoices() async {
        guard let client = session.settingsClient,
              let speaking = VoiceProviderChoice.speaking(picked: settings.personTts, status: status),
              status?.offeredTts.contains(speaking) == true else {
            voices = nil
            return
        }
        voices = nil
        voices = (try? await client.providerVoices(speaking)) ?? []
    }

    private func test() async {
        guard let client = session.settingsClient else { return }
        testing = true
        note = nil
        defer { testing = false }
        do {
            let clip = try await client.testVoice(text: AppStrings.localized("Hello, this is how I sound on a call."), settings: settings)
            try? AVAudioSession.sharedInstance().setCategory(.playback)
            player = try AVAudioPlayer(data: clip)
            player?.play()
        } catch {
            note = String(format: AppStrings.localized("The voice test did not play: %@"), error.localizedDescription)
        }
    }

    private func saveServer() async {
        let url = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !url.isEmpty else { return }
        guard url.lowercased().hasPrefix("http://") || url.lowercased().hasPrefix("https://") else {
            serverError = String(localized: "The server address must start with http:// or https://")
            return
        }
        savingServer = true
        defer { savingServer = false }
        serverError = await model.apply(.ttsServer(baseUrl: url, model: serverModel), key: "ttsServer")
    }
}

// MARK: - Updates

/// Settings > Updates: the version of this app. The desktop's updater and
/// its pre-release channel are the Mac app's; the iPad updates through the
/// App Store (TestFlight for internal builds).
struct DesktopUpdatesSettings: View {
    @Environment(\.openURL) private var openURL

    /// Settings > Updates (SettingsModal.tsx): "This app", Updates with
    /// Check for updates, Update channel and Update while I am away. On the
    /// iPad the App Store (or TestFlight) installs updates: Check opens the
    /// app's page there; the channel is the store build and away-install is
    /// iPadOS's own, as each row's help says.
    var body: some View {
        DesktopSettingsGroup(Text("This app"), identifier: "updates") {
            DesktopDescribedRow(Text("Updates"),
                                description: Text(verbatim: "\(AppStrings.localized("Version")) \(AboutPage.version) (\(AboutPage.build)). " + AppStrings.localized("This iPad updates through the App Store, or TestFlight for test builds.")),
                                identifier: "updates") {
                Button("Check for updates") {
                    if let url = URL(string: "itms-apps://apps.apple.com/app/id6818532985") { openURL(url) }
                }
                .buttonStyle(DesktopPillButtonStyle())
                .accessibilityIdentifier("desktop-settings.updates.check")
            }
            .accessibilityIdentifier("desktop-settings.updates.version")
            DesktopDescribedRow(Text("Update channel"), description: Text("Stable, or Nightly for versions still in testing."),
                                help: Text("On the iPad, the App Store build is the stable channel and TestFlight carries the versions still in testing."),
                                identifier: "updateChannel") {
                DesktopPillSelect(options: [("stable", AppStrings.localized("Stable"))], selection: "stable",
                                  label: Text("Update channel"), identifier: "desktop-settings.updates.channel", disabled: true) { _ in }
            }
            DesktopDescribedRow(Text("Update while I am away"), description: Text("Install a downloaded update when you are away and no bot is working."),
                                help: Text("On the iPad, automatic updates are set in Settings > App Store."),
                                identifier: "updatesAway") {
                DesktopSwitch(isOn: false, label: Text("Update while I am away"), identifier: "desktop-settings.updates.away", disabled: true) {}
            }
        }
    }
}
