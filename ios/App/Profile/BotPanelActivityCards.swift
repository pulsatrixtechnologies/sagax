// Activity tab cards for the bot panel (Grok Bot parity, #2127):
// Upcoming (routines with toggle, Show more after 5), Computer
// ("Bot's computer · Awake" with vignette), Voice chat (Voice, Speed, Language).
import CompanionCore
import SwiftUI
import UIKit

// MARK: - Upcoming

/// Upcoming: routines of this bot with an Active toggle; five rows then Show more.
struct BotPanelUpcomingCard: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    let routines: [Routine]
    let loaded: Bool
    var onOpen: (Routine) -> Void
    var onToggle: (Routine, Bool) -> Void
    var onAdd: () -> Void

    @State private var expanded = false

    private var mine: [Routine] { DesktopRoutineList.of(botId: bot.id, in: routines) }
    private var shown: [Routine] {
        if expanded || mine.count <= PanelRoutinePreview.limit { return mine }
        return Array(mine.prefix(PanelRoutinePreview.limit))
    }
    private var needsMore: Bool { !expanded && mine.count > PanelRoutinePreview.limit }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Upcoming")
                .font(Theme.Font.label)
                .foregroundStyle(Theme.textTertiary)
                .padding(.horizontal, 4)
            ProfileCard {
                if !loaded {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Loading routines…")
                            .font(Theme.Profile.labelFont)
                            .foregroundStyle(Theme.textSecondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: Theme.Profile.row)
                    .padding(.horizontal, Theme.Profile.textInset)
                } else if mine.isEmpty {
                    Button(action: onAdd) {
                        ProfileRow(
                            icon: ProfileRowIcon(systemImage: "plus", size: 16, color: Theme.blue),
                            title: Text("Add a routine"),
                            titleColor: Theme.accentText,
                            height: Theme.Profile.row
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("panel-upcoming-add")
                } else {
                    ForEach(Array(shown.enumerated()), id: \.element.id) { index, routine in
                        if index > 0 { ProfileDivider(leading: Theme.Profile.iconColumn) }
                        upcomingRow(routine)
                    }
                }
            }
            if needsMore {
                ShowMoreButton(loading: false) {
                    Haptics.selection()
                    expanded = true
                }
                .accessibilityIdentifier("panel-upcoming-show-more")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("panel-upcoming")
    }

    private func upcomingRow(_ routine: Routine) -> some View {
        let canToggle = routine.mayEdit && routine.canToggle()
        return HStack(spacing: 0) {
            Button {
                Haptics.selection()
                onOpen(routine)
            } label: {
                ProfileRow(
                    icon: ProfileRowIcon(
                        systemImage: "clock",
                        size: 17,
                        color: routine.enabled ? Theme.routineActive : Theme.routinePaused
                    ),
                    title: Text(verbatim: routine.name),
                    subtitle: Text(verbatim: routine.enabled
                        ? RoutineWording.subtitle(routine)
                        : String(localized: "Paused")),
                    height: Theme.Profile.routineRow
                ) { EmptyView() }
            }
            .buttonStyle(.plain)
            Toggle("", isOn: Binding(
                get: { routine.enabled },
                set: { value in
                    Haptics.selection()
                    onToggle(routine, value)
                }
            ))
            .labelsHidden()
            .toggleStyle(ParityToggleStyle(width: Theme.Profile.toggle.width, height: Theme.Profile.toggle.height))
            .padding(.trailing, Theme.Profile.textInset)
            .disabled(!canToggle)
            .accessibilityLabel(Text("Active: \(routine.name)"))
            .accessibilityIdentifier("panel-upcoming-active.\(routine.name)")
        }
        .accessibilityIdentifier("panel-upcoming.\(routine.name)")
    }
}

// MARK: - Computer card

/// Compact "Bot's computer · Awake" card with a screen vignette; tap opens Computer.
struct BotPanelComputerCard: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let bot: Bot
    let open: () -> Void

    @State private var wakeRequestedAt: Date?

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var phase: BotComputerPhase {
        BotComputerPhase.of(
            computer: current.computer,
            busy: current.busy == true,
            wakeRequestedAt: wakeRequestedAt,
            now: Date()
        )
    }
    private var frame: ScreenFrame? { session.state.screens[bot.id] }

    private var statusLine: String {
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
            if let data = frame?.data, let image = UIImage(data: data) {
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
            Text("Voice chat")
                .font(Theme.Font.label)
                .foregroundStyle(Theme.textTertiary)
                .padding(.horizontal, 4)
            ProfileCard {
                menuRow("Voice", value: voiceName, id: "panel-voice-chat.voice") {
                    Picker(selection: voiceBinding) {
                        Text("Not set").tag("")
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
        guard !botVoice.isEmpty else { return String(localized: "Not set") }
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
