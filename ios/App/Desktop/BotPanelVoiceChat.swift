// Activity > Voice chat on the iPad bot panel, as the desktop draws it
// (`bot-settings/VoiceChatCard.tsx`, #2125): the PANEL_LABEL title over one
// PANEL_CARD (py 4) of three rows (px 12, py 6, the label 14/20 ink) with a
// bordered PillSelect at the right: h 24, px 8, a capsule ring
// (`--bot-panel-pill-border`: #3a3a3a dark, the hairline light), the value
// 13/18 and a 13 pt chevron down. Voice is the person's own pick for this
// bot; Speed and Language are the bot's fields (voiceSpeed, voiceLanguage),
// written through the profile patch. The phone keeps its own card
// (BotPanelVoiceChatCard).
import CompanionCore
import SwiftUI

struct BotPanelVoiceChat: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot

    @State private var voices: [VoiceModeVoice]?
    @AppStorage(VoiceModeSettings.storageKey) private var voiceRaw = ""

    private var settings: VoiceModeSettings {
        VoiceModeSettings.decode(voiceRaw.isEmpty ? nil : voiceRaw)
    }

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var botVoice: String { settings.forBot(bot.id).voice }
    private var speed: Double { BotVoicePrefs.speed(bot: current, fallback: settings.speed) }
    private var language: String { BotVoicePrefs.language(bot: current, fallback: settings.language) }

    /// `voiceSpeedOptions`: the known speeds, plus the current one if odd.
    private var speeds: [Double] {
        let known = VoiceModeSettings.speeds
        return known.contains(speed) ? known : (known + [speed]).sorted()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Voice chat")
                .font(theme.font(13))
                .foregroundStyle(theme.inkTertiary)
                .padding(.horizontal, 2)
                .accessibilityAddTraits(.isHeader)
            VStack(spacing: 0) {
                row("Voice", value: voiceName, id: "bot-panel.voice-chat.voice") {
                    Picker(selection: voiceBinding) {
                        Text("Provider's default voice").tag("")
                        ForEach(voices ?? []) { voice in
                            Text(verbatim: PhoneBotCallVoiceCard.capitalizedLabel(voice.label)).tag(voice.id)
                        }
                        if !botVoice.isEmpty, !(voices ?? []).contains(where: { $0.id == botVoice }) {
                            Text(verbatim: PhoneBotCallVoiceCard.capitalizedLabel(botVoice)).tag(botVoice)
                        }
                    } label: { Text("Voice") }
                }
                row("Speed", value: VoiceModeSettings.speedLabel(speed), id: "bot-panel.voice-chat.speed") {
                    Picker(selection: speedBinding) {
                        ForEach(speeds, id: \.self) { value in
                            Text(verbatim: VoiceModeSettings.speedLabel(value)).tag(value)
                        }
                    } label: { Text("Speed") }
                }
                row("Language", value: languageName, id: "bot-panel.voice-chat.language") {
                    Picker(selection: languageBinding) {
                        ForEach(VoiceModeSettings.languages, id: \.code) { entry in
                            Text(verbatim: entry.code == "auto" ? String(localized: "Auto-detect") : entry.label).tag(entry.code)
                        }
                    } label: { Text("Language") }
                }
            }
            .padding(.vertical, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.card, in: RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous))
        }
        .task {
            guard voices == nil, let client = session.callClient else { return }
            voices = (try? await client.voiceModeVoices(botId: bot.id, provider: settings.ttsChoice(botId: bot.id))) ?? []
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bot-panel.voice-chat")
    }

    private var voiceName: String {
        guard !botVoice.isEmpty else { return String(localized: "Provider's default voice") }
        if let label = voices?.first(where: { $0.id == botVoice })?.label {
            return PhoneBotCallVoiceCard.capitalizedLabel(label)
        }
        return PhoneBotCallVoiceCard.capitalizedLabel(botVoice)
    }

    private var languageName: String {
        language == "auto" ? String(localized: "Auto-detect") : VoiceModeSettings.languageLabel(language)
    }

    private var pillBorder: Color {
        theme.dark ? Color(.sRGB, red: 0x3a / 255, green: 0x3a / 255, blue: 0x3a / 255, opacity: 1) : theme.hairline
    }

    /// `Row` + a bordered `PillSelect`.
    private func row<Choices: View>(
        _ label: LocalizedStringKey,
        value: String,
        id: String,
        @ViewBuilder choices: () -> Choices
    ) -> some View {
        HStack(spacing: 12) {
            Text(label)
                .font(theme.font(14))
                .foregroundStyle(theme.ink)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Menu {
                choices()
            } label: {
                HStack(spacing: 4) {
                    Text(verbatim: value)
                        .font(theme.font(13))
                        .foregroundStyle(theme.ink)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(theme.inkSecondary)
                        .accessibilityHidden(true)
                }
                .padding(.horizontal, 8)
                .frame(height: 24)
                .frame(maxWidth: 240)
                .overlay(Capsule().strokeBorder(pillBorder, lineWidth: 1))
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .fixedSize()
            .accessibilityLabel(Text(label))
            .accessibilityValue(Text(verbatim: value))
            .accessibilityIdentifier(id)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .frame(minHeight: 32)
    }

    private var voiceBinding: Binding<String> {
        Binding(
            get: { botVoice },
            set: { value in
                voiceRaw = settings.withVoice(value, forBot: bot.id).encoded
                var patch = BotProfilePatch()
                patch.voice = value.isEmpty ? nil : value
                let target = current
                Task { _ = await session.updateProfile(patch, for: target) }
                Haptics.selection()
            }
        )
    }

    private var speedBinding: Binding<Double> {
        Binding(
            get: { speed },
            set: { value in
                var next = settings
                next.speed = value
                voiceRaw = next.encoded
                var patch = BotProfilePatch()
                patch.voiceSpeed = value
                let target = current
                Task { _ = await session.updateProfile(patch, for: target) }
                Haptics.selection()
            }
        )
    }

    private var languageBinding: Binding<String> {
        Binding(
            get: { language },
            set: { value in
                var next = settings
                next.language = value
                voiceRaw = next.encoded
                var patch = BotProfilePatch()
                patch.voiceLanguage = value
                let target = current
                Task { _ = await session.updateProfile(patch, for: target) }
                Haptics.selection()
            }
        )
    }
}
