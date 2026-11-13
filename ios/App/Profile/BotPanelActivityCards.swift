// Bot panel cards (reference app parity, #2127): Computer ("Bot's computer
// · Awake" with vignette, the desktop and group panels) and Voice chat
// (Voice, Speed, Language; its own page on the phone, #4101). The phone's
// upcoming routines live on its Routines page.
import CompanionCore
import SwiftUI
import UIKit

// MARK: - Computer card

/// Compact "Bot's computer · Awake" card with a screen vignette; tap opens Computer.
struct BotPanelComputerCard: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let bot: Bot
    let open: () -> Void

    init(bot: Bot, open: @escaping () -> Void) {
        self.bot = bot
        self.open = open
        _screen = ObservedObject(wrappedValue: ScreenStore.shared.screen(bot.id))
    }

    @State private var wakeRequestedAt: Date?
    @State private var vignetteImage: UIImage?

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var phase: BotComputerPhase {
        BotComputerPhase.of(
            computer: current.computer,
            busy: current.busy == true,
            wakeRequestedAt: wakeRequestedAt,
            now: Date()
        )
    }
    /// The screen from its own store, so a frame redraws only the views
    /// that draw it (#3017, L01).
    @ObservedObject private var screen: BotScreen
    private var frame: ScreenFrame? { screen.frame ?? session.state.screens[bot.id] }

    private var statusLine: String { Self.statusLine(phase) }

    /// The computer's state in words (also the phone panel's Computer row).
    static func statusLine(_ phase: BotComputerPhase) -> String {
        switch phase {
        case .off: String(localized: "Off")
        case .asleep: String(localized: "Asleep")
        case .waking: String(localized: "Waking up…")
        case .running: String(localized: "Awake")
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Computer")
                .font(Theme.Font.label)
                .foregroundStyle(Theme.textTertiary)
                .padding(.horizontal, 4)
            Button(action: open) {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Bot's computer")
                            .font(Theme.Font.body)
                            .foregroundStyle(Theme.textPrimary)
                        Text(verbatim: statusLine)
                            .font(Theme.Profile.labelFont)
                            .foregroundStyle(Theme.textSecondary)
                    }
                    Spacer(minLength: 8)
                    vignette
                }
                .padding(.horizontal, Theme.Profile.textInset)
                .padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
            .accessibilityIdentifier("panel-computer-card")
            .accessibilityLabel(Text("Bot's computer, \(statusLine)"))
        }
    }

    @ViewBuilder
    private var vignette: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Theme.cardRaised)
                .frame(width: 72, height: 48)
            if frame?.data != nil, let image = vignetteImage {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 72, height: 48)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            } else {
                ComputerIdleBotGlyph(size: 28, waking: phase == .waking)
                    .opacity(0.7)
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Theme.hairline, lineWidth: 1)
        )
        // the frame is decoded off the main thread (#3017, L20)
        .task(id: frame?.data) {
            vignetteImage = if let data = frame?.data { await ImageDecoding.prepared(data) } else { nil }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Voice chat

/// Voice chat card: Voice, Speed, Language. Speed and Language prefer the
/// bot's fields when the server sends them; otherwise the local call setting.
struct BotPanelVoiceChatCard: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let bot: Bot
    /// The "Voice chat" title over the card; off on its own page, whose bar
    /// already says it.
    var titled = true

    @State private var voices: [VoiceModeVoice]?
    @AppStorage(VoiceModeSettings.storageKey) private var voiceRaw = ""

    private var settings: VoiceModeSettings {
        VoiceModeSettings.decode(voiceRaw.isEmpty ? nil : voiceRaw)
    }

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var botVoice: String { settings.forBot(bot.id).voice }
    private var speed: Double { BotVoicePrefs.speed(bot: current, fallback: settings.speed) }
    private var language: String { BotVoicePrefs.language(bot: current, fallback: settings.language) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if titled {
                Text("Voice chat")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textTertiary)
                    .padding(.horizontal, 4)
            }
            ProfileCard {
                menuRow("Voice", value: voiceName, id: "panel-voice-chat.voice") {
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
                ProfileDivider(leading: Theme.Profile.textInset)
                menuRow("Speed", value: VoiceModeSettings.speedLabel(speed), id: "panel-voice-chat.speed") {
                    Picker(selection: speedBinding) {
                        ForEach(VoiceModeSettings.speeds, id: \.self) { value in
                            Text(verbatim: VoiceModeSettings.speedLabel(value)).tag(value)
                        }
                    } label: { Text("Speed") }
                }
                ProfileDivider(leading: Theme.Profile.textInset)
                menuRow("Language", value: languageName, id: "panel-voice-chat.language") {
                    Picker(selection: languageBinding) {
                        ForEach(VoiceModeSettings.languages, id: \.code) { entry in
                            Text(verbatim: entry.code == "auto"
                                ? String(localized: "Auto-detect")
                                : entry.label).tag(entry.code)
                        }
                    } label: { Text("Language") }
                }
            }
        }
        .task {
            guard voices == nil, let client = session.callClient else { return }
            voices = (try? await client.voiceModeVoices(botId: bot.id, provider: settings.ttsChoice(botId: bot.id))) ?? []
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("panel-voice-chat")
    }

    private var voiceName: String {
        guard !botVoice.isEmpty else { return String(localized: "Provider's default voice") }
        if let label = voices?.first(where: { $0.id == botVoice })?.label {
            return PhoneBotCallVoiceCard.capitalizedLabel(label)
        }
        return PhoneBotCallVoiceCard.capitalizedLabel(botVoice)
    }

    private var languageName: String {
        language == "auto"
            ? String(localized: "Auto-detect")
            : VoiceModeSettings.languageLabel(language)
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

    private func menuRow<Choices: View>(
        _ label: LocalizedStringKey,
        value: String,
        id: String,
        @ViewBuilder choices: () -> Choices
    ) -> some View {
        Menu {
            choices()
        } label: {
            HStack(spacing: 8) {
                Text(label)
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.textPrimary)
                Spacer(minLength: 12)
                Text(verbatim: value)
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.textTertiary)
                    .accessibilityHidden(true)
            }
            .padding(.leading, Theme.Profile.textInset)
            .padding(.trailing, Theme.Profile.textInset)
            .frame(height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(verbatim: value))
        .accessibilityIdentifier(id)
    }
}
