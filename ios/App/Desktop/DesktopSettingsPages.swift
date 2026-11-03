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

/// "Defaults for new bots" (BotDefaultsCard): what a new bot starts with;
/// here its effort, the setting General held before 2026-10-28.
struct DesktopNewBotDefaults: View {
    @EnvironmentObject private var model: DesktopSettingsModel

    var body: some View {
        let config = model.config
        DesktopSettingsHeading(Text("Defaults for new bots"))
        DesktopSettingsGroup {
            DesktopSettingRow(
                title: Text("Effort for new bots"),
                subtitle: Text("How hard new bots think from their first message."),
                help: Text("How hard every new bot thinks from its first message. A bot can change its own level; model providers without this level keep their default.")
            ) {
                DesktopSelect(
                    options: [("", AppStrings.localized("Provider default"))] + DesktopEffort.levels.map { ($0, DesktopGeneralSettings.effortLabel($0)) },
                    selection: config?.newBots?.effort ?? "",
                    label: Text("Effort for new bots"),
                    identifier: "desktop-settings.effort",
                    disabled: !model.saving.isEmpty || config == nil
                ) { value in
                    setEffort(value)
                }
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

/// `BotModelsTable`: "Bot models", the column heads, then each team with
/// its bots. Rows are 32 tall on the desktop; 44 here for a finger.
struct DesktopBotModelsTable: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    @State private var instances: [Instance] = []
    @State private var editing: Bot?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            DesktopSettingsHeading(Text("Bot models"))
            VStack(alignment: .leading, spacing: 0) {
                header
                ForEach(groups, id: \.name) { group in
                    Rectangle().fill(theme.hairlineWeak).frame(height: 0.5)
                    DesktopText(Text(verbatim: "\(group.name) (\(group.bots.count))"), size: 12.5, line: 18, color: \.inkSecondary)
                        .padding(.horizontal, 14)
                        .frame(height: 32, alignment: .leading)
                    ForEach(group.bots) { bot in row(bot) }
                }
            }
            .padding(1)
            .frame(maxWidth: .infinity, alignment: .leading)
            .desktopHairlineBox()
        }
        .task { instances = await DesktopModelCatalog.shared.instances(session) }
        .popover(item: $editing) { bot in
            ModelMenuSheet(bot: bot, close: { editing = nil })
                .environmentObject(session)
                .frame(minWidth: 340, idealWidth: 360, minHeight: 480, idealHeight: 560)
        }
        .accessibilityIdentifier("desktop-settings.bot-models")
    }

    private var header: some View {
        HStack(spacing: 12) {
            column(Text("Bot")).frame(width: 170, alignment: .leading)
            column(Text("Model")).frame(maxWidth: .infinity, alignment: .leading)
            column(Text("Effort")).frame(width: 96, alignment: .leading)
        }
        .padding(.horizontal, 14)
        .frame(height: 32)
    }

    private func column(_ title: Text) -> some View {
        DesktopText(title, size: 12, weight: .medium, line: 16, color: \.inkSecondary)
    }

    private func row(_ bot: Bot) -> some View {
        Button { editing = bot } label: {
            HStack(spacing: 12) {
                HStack(spacing: 8) {
                    ChatAvatarView(chat: .bot(bot), size: 20, state: MausState.forChat(.bot(bot), in: session.state), background: theme.panel)
                        .frame(width: 20, height: 20)
                    DesktopText(Text(verbatim: bot.name), size: 13, weight: .medium, line: 18)
                        .lineLimit(1)
                }
                .frame(width: 170, alignment: .leading)
                HStack(spacing: 4) {
                    DesktopText(Text(verbatim: modelLabel(bot)), size: 13, line: 18)
                        .lineLimit(1)
                    DesktopSettingsIconView(icon: .chevronDown, size: 12, strokeWidth: 2.5)
                        .foregroundStyle(theme.inkSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                DesktopText(Text(effortLabel(bot)), size: 13, line: 18, color: \.inkSecondary)
                    .frame(width: 96, alignment: .leading)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(DesktopHoverFill(radius: 0))
        .accessibilityLabel(Text("\(bot.name), \(modelLabel(bot))"))
        .accessibilityIdentifier("desktop-settings.bot-model.\(bot.id)")
    }

    /// The bots by team, in the sidebar's order (hidden bots left out).
    private var groups: [(name: String, bots: [Bot])] {
        let bots = session.state.bots.filter { $0.hidden != true }
        var order: [String] = []
        var byTeam: [String: [Bot]] = [:]
        for bot in bots {
            let team = bot.section?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let name = team.isEmpty ? String(localized: "Unassigned") : team
            if byTeam[name] == nil { order.append(name) }
            byTeam[name, default: []].append(bot)
        }
        // the sidebar's order: Unassigned first, then the teams as listed
        let unassigned = String(localized: "Unassigned")
        let listed = [unassigned] + prefs.layout(session).sectionNames
        let ranked = order.sorted { (listed.firstIndex(of: $0) ?? Int.max) < (listed.firstIndex(of: $1) ?? Int.max) }
        return ranked.map { ($0, byTeam[$0] ?? []) }
    }

    private func modelLabel(_ bot: Bot) -> String {
        let selection = bot.modelSelection
        if selection.auto == true { return String(localized: "Auto") }
        let instance = instances.first { $0.instanceId == selection.instanceId }
        let id = selection.model.isEmpty ? (instance?.models.default ?? "") : selection.model
        let label = instance?.models.options.first { $0.id == id }?.label ?? id
        return label.isEmpty ? String(localized: "Default") : label
    }

    private func effortLabel(_ bot: Bot) -> LocalizedStringKey {
        guard let effort = bot.modelSelection.effort, !effort.isEmpty else { return "Default" }
        return LocalizedStringKey(effort.prefix(1).uppercased() + effort.dropFirst())
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
    @State private var voices: [VoiceModeVoice]?
    @State private var serverURL = ""
    @State private var serverModel = ""
    @State private var serverError: String?

    private var settings: VoiceModeSettings { VoiceModeSettings.decode(voiceRaw.isEmpty ? nil : voiceRaw) }
    private var person: VoiceModeSettings { settings.forBot(nil) }

    private var noDashes: Bool {
        if dashesRaw == "on" { return true }
        if dashesRaw == "off" { return false }
        return Locale.current.language.languageCode?.identifier == "fr"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            DesktopSettingsHeading(Text("Who speaks and who listens"))
            DesktopSettingsGroup {
                DesktopSettingRow(title: Text("Bot's voice")) {
                    DesktopSelect(options: [("", String(localized: "Auto")), ("xai", "xAI"), ("openai", "OpenAI"), ("elevenlabs", "ElevenLabs")],
                                  selection: settings.ttsChoice(botId: nil) ?? "", label: Text("Bot's voice"),
                                  identifier: "desktop-settings.voice.tts") { value in
                        voiceRaw = settings.withTts(value.isEmpty ? nil : value).encoded
                        voices = nil
                        Task { await loadVoices() }
                    }
                }
                DesktopSettingRow(title: Text("Voice")) {
                    DesktopSelect(options: [("", String(localized: "Not set"))] + (voices ?? []).map { ($0.id, PhoneBotCallVoiceCard.capitalizedLabel($0.label)) },
                                  selection: person.voice,
                                  shown: voices == nil ? String(localized: "Loading voices…") : nil,
                                  label: Text("Voice"), identifier: "desktop-settings.voice.voice") { value in
                        voiceRaw = settings.withPersonVoice(value).encoded
                    }
                }
                DesktopSettingRow(title: Text("Speed")) {
                    DesktopSelect(options: VoiceModeSettings.speeds.map { ($0, VoiceModeSettings.speedLabel($0)) },
                                  selection: settings.speed, label: Text("Speed"), identifier: "desktop-settings.voice.speed") { value in
                        var next = settings
                        next.speed = value
                        voiceRaw = next.encoded
                    }
                }
                DesktopSettingRow(title: Text("Speech to text")) {
                    DesktopSelect(options: VoiceModeSettings.languages.map { ($0.code, $0.code == "auto" ? String(localized: "Auto") : $0.label) },
                                  selection: settings.language, label: Text("Speech to text"), identifier: "desktop-settings.voice.language") { value in
                        var next = settings
                        next.language = value
                        voiceRaw = next.encoded
                    }
                }
            }
            DesktopSettingsHeading(Text("Advanced"))
                .padding(.top, 8)
            DesktopSettingsGroup {
                DesktopSettingRow(title: Text("Fish Audio model"),
                                  help: Text("Pick the model your Fish Audio plan covers. It applies to every agent on this installation.")) {
                    DesktopSelect(options: [("s2.1-pro", String(localized: "s2.1-pro (default)")), ("s2.1-pro-free", String(localized: "s2.1-pro-free (free for developers)"))],
                                  selection: model.config?.tts?.fishModel ?? "s2.1-pro", label: Text("Fish Audio model"),
                                  identifier: "desktop-settings.voice.fish", disabled: model.config == nil) { value in
                        Task { _ = await model.apply(.fishModel(value), key: "fishModel") }
                    }
                }
                VStack(alignment: .leading, spacing: 8) {
                    DesktopText(Text("Chatterbox server"))
                    HStack(spacing: 6) {
                        Circle().fill(model.config?.tts?.baseUrl?.isEmpty == false ? theme.accent : theme.raisedHover).frame(width: 6, height: 6)
                        DesktopText(model.config?.tts?.baseUrl?.isEmpty == false ? Text("Saved") : Text("Any OpenAI-compatible server running Chatterbox works. No key is needed."),
                                    size: 12.5, line: 17, color: \.inkSecondary)
                        Link(destination: URL(string: "https://github.com/resemble-ai/chatterbox")!) {
                            DesktopText(Text("How to run one locally"), size: 12.5, weight: .medium, line: 17, color: \.accentText)
                        }
                    }
                    HStack(spacing: 8) {
                        TextField("http://127.0.0.1:4123", text: $serverURL)
                            .font(theme.font(13))
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .padding(.horizontal, 12).frame(minHeight: 36)
                            .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .accessibilityIdentifier("desktop-settings.voice.chatterbox-url")
                        Button("Save") { Task { await saveServer() } }
                            .buttonStyle(DesktopButtonStyle(kind: .ghost, size: 12.5, weight: .medium, height: 36, horizontal: 12))
                            .disabled(serverURL.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    TextField(String(localized: "Model id, default chatterbox-turbo"), text: $serverModel)
                        .font(theme.font(13))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(.horizontal, 12).frame(minHeight: 36)
                        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    if let serverError { DesktopText(Text(verbatim: serverError), size: 12, line: 16, color: \.danger) }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                DesktopSettingRow(title: Text("No em or en dashes in replies"),
                                  subtitle: Text("Replaces them in the final text of bot replies: a range word between times and numbers, a colon after a list label, a comma elsewhere. On by default in French.")) {
                    DesktopSwitch(isOn: noDashes, label: Text("No em or en dashes in replies"), identifier: "desktop-settings.voice.no-dashes") {
                        dashesRaw = noDashes ? "off" : "on"
                    }
                }
            }
            DesktopSettingsHeading(Text("Audio"))
                .padding(.top, 8)
            DesktopSettingsGroup {
                DesktopSettingRow(title: Text("Microphone"), subtitle: Text("Used for dictation, voice notes and calls on this iPad.")) {
                    DesktopText(Text("System default"), color: \.inkSecondary)
                }
            }
        }
        .task {
            serverURL = model.config?.tts?.baseUrl ?? ""
            serverModel = model.config?.tts?.model ?? ""
            await loadVoices()
        }
    }

    private func loadVoices() async {
        guard let client = session.callClient, let bot = session.state.bots.first(where: { $0.hidden != true }) else {
            voices = []
            return
        }
        voices = (try? await client.voiceModeVoices(botId: bot.id, provider: settings.ttsChoice(botId: nil))) ?? []
    }

    private func saveServer() async {
        let url = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard url.lowercased().hasPrefix("http://") || url.lowercased().hasPrefix("https://") else {
            serverError = String(localized: "The server address must start with http:// or https://")
            return
        }
        serverError = await model.apply(.ttsServer(baseUrl: url, model: serverModel), key: "ttsServer")
    }
}

// MARK: - Updates

/// Settings > Updates: the version of this app. The desktop's updater and
/// its pre-release channel are the Mac app's; the iPad updates through the
/// App Store (TestFlight for internal builds).
struct DesktopUpdatesSettings: View {
    var body: some View {
        DesktopSettingsGroup {
            DesktopSettingRow(title: Text("Version"), subtitle: Text("This iPad updates through the App Store, or TestFlight for test builds.")) {
                DesktopText(Text(verbatim: "\(AboutPage.version) (\(AboutPage.build))"), color: \.inkSecondary)
                    .accessibilityIdentifier("desktop-settings.updates.version")
            }
        }
    }
}
