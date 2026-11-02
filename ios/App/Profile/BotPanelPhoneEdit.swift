// Edit bot identity fields and Voice calls (lots 2 and 3, 2026-11-01):
// the avatar with a pencil badge, then the Name, Role and Description
// fields in `PhoneBotIdentityFields`, and the Voice calls card (Voice,
// Speed, Language as menus) in `PhoneBotCallVoiceCard`. On the phone root
// these sit on one page; drafts of the text fields save on Done.
//
// Voice, Speed and Language are the call's own settings
// (`VoiceModeSettings`, key `omb.voiceMode.v1`), the same values the call's
// gear card changes. Voice labels show with a capital first letter.
import CompanionCore
import SwiftUI

struct PhoneBotIdentityFields: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let bot: Bot
    /// Opens the avatar editor (the badge and the Avatar row).
    let onAvatar: () -> Void
    /// When false (Edit root, lot 2), fields stay as drafts until Done.
    var autosave: Bool = true
    var isDirty: Binding<Bool> = .constant(false)
    var registerCommit: ((@escaping () -> Void) -> Void)? = nil

    private enum Field: Hashable { case name, title, description }

    @State private var name = ""
    @State private var title = ""
    @State private var blurb = ""
    @FocusState private var focus: Field?

    private var current: Bot { session.state.bot(bot.id) ?? bot }

    var body: some View {
        VStack(spacing: 0) {
            avatar
            fieldLabel("Name")
            field(text: $name, prompt: nil, field: .name, id: "panel-edit-name")
            fieldLabel("Role")
            field(text: $title, prompt: "Add a role", field: .title, id: "panel-edit-title")
            fieldLabel("Description")
            descriptionField
        }
        .onAppear {
            loadFromBot()
            registerCommit? { commitAll() }
        }
        .onValueChange(of: bot.id) { _ in loadFromBot() }
        .onDisappear {
            if autosave { commitAll() }
        }
        .onValueChange(of: focus) { now in
            guard autosave else { return }
            if now != .name { commitName() }
            if now != .title { commitTitle() }
            if now != .description { commitBlurb() }
        }
        .onValueChange(of: name) { _ in refreshDirty() }
        .onValueChange(of: title) { _ in refreshDirty() }
        .onValueChange(of: blurb) { _ in refreshDirty() }
    }

    // MARK: Avatar

    private var avatar: some View {
        Button {
            Haptics.selection()
            onAvatar()
        } label: {
            BotMascotView(bot: current, size: 112, state: .idle, animated: true)
                .overlay(alignment: .bottomTrailing) {
                    Image(systemName: "pencil")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                        .frame(width: 36, height: 36)
                        .background(Theme.cardRaised, in: Circle())
                        .overlay(Circle().strokeBorder(Theme.bg, lineWidth: 2))
                        .offset(x: 6, y: 4)
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.bottom, 20)
        .accessibilityLabel(Text("Edit avatar"))
        .accessibilityIdentifier("panel-edit-avatar")
    }

    // MARK: Fields

    private func fieldLabel(_ text: LocalizedStringKey) -> some View {
        ProfileSectionLabel(text: text, margin: SettingsMetrics.cardMargin)
            .padding(.top, Theme.Profile.cardGap)
    }

    private func field(text: Binding<String>, prompt: LocalizedStringKey?, field: Field, id: String) -> some View {
        TextField("", text: text, prompt: prompt.map { Text($0) })
            .font(Theme.Font.body)
            .foregroundStyle(Theme.textPrimary)
            .focused($focus, equals: field)
            .submitLabel(.done)
            .onSubmit { focus = nil }
            .padding(.horizontal, Theme.Profile.textInset)
            .frame(height: Theme.Profile.toggleRow)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
            .padding(.horizontal, SettingsMetrics.cardMargin)
            .accessibilityLabel(Text(field == .name ? LocalizedStringKey("Name") : LocalizedStringKey("Role")))
            .accessibilityIdentifier(id)
    }

    /// The short blurb: several lines, the server's own limit, saved on leaving.
    private var descriptionField: some View {
        TextField("", text: $blurb, prompt: Text("One line on what this bot is for"), axis: .vertical)
            .font(Theme.Font.body)
            .foregroundStyle(Theme.textPrimary)
            .lineLimit(3...8)
            .focused($focus, equals: .description)
            .padding(.horizontal, Theme.Profile.textInset)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, minHeight: Theme.Profile.toggleRow * 2, alignment: .topLeading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
            .padding(.horizontal, SettingsMetrics.cardMargin)
            .onValueChange(of: blurb) { now in
                if now.count > NewBotRules.descriptionLimit { blurb = String(now.prefix(NewBotRules.descriptionLimit)) }
            }
            .accessibilityLabel(Text("Description"))
            .accessibilityIdentifier("panel-edit-description")
    }

    private func loadFromBot() {
        name = current.name
        title = current.title
        blurb = current.description
        refreshDirty()
    }

    private func refreshDirty() {
        let dirty = name != current.name || title != current.title || blurb != current.description
        if isDirty.wrappedValue != dirty { isDirty.wrappedValue = dirty }
    }

    private func commitAll() {
        focus = nil
        commitName()
        commitTitle()
        commitBlurb()
        refreshDirty()
    }

    private func commitBlurb() {
        guard let next = DesktopInlineEdit.commit(draft: blurb, current: current.description, required: false) else { return }
        var patch = BotProfilePatch()
        patch.description = next
        save(patch)
    }

    private func commitName() {
        let draft = String(name.prefix(100))
        guard let next = DesktopInlineEdit.commit(draft: draft, current: current.name, required: true) else {
            if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { name = current.name }
            return
        }
        var patch = BotProfilePatch()
        patch.name = next
        save(patch)
    }

    private func commitTitle() {
        let draft = String(title.prefix(200))
        guard let next = DesktopInlineEdit.commit(draft: draft, current: current.title, required: false) else { return }
        var patch = BotProfilePatch()
        patch.title = next
        save(patch)
    }

    private func save(_ patch: BotProfilePatch) {
        let target = current
        Task { _ = await session.updateProfile(patch, for: target) }
    }
}

/// Edit bot > Voice calls: the call's voice, speed and language.
struct PhoneBotCallVoiceCard: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let bot: Bot

    @State private var voices: [VoiceModeVoice]?
    @AppStorage(VoiceModeSettings.storageKey) private var voiceRaw = ""

    private var settings: VoiceModeSettings { VoiceModeSettings.decode(voiceRaw.isEmpty ? nil : voiceRaw) }

    var body: some View {
        ProfileCard(margin: SettingsMetrics.cardMargin) {
            menuRow("Voice", value: voiceName, id: "panel-edit-voice") {
                Picker(selection: voiceBinding) {
                    Text("Not set").tag("")
                    ForEach(voices ?? []) { voice in Text(verbatim: Self.capitalizedLabel(voice.label)).tag(voice.id) }
                    if !botVoice.isEmpty, !(voices ?? []).contains(where: { $0.id == botVoice }) {
                        Text(verbatim: Self.capitalizedLabel(botVoice)).tag(botVoice)
                    }
                } label: { Text("Voice") }
            }
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            menuRow("Speed", value: VoiceModeSettings.speedLabel(settings.speed), id: "panel-edit-speed") {
                Picker(selection: binding(\.speed)) {
                    ForEach(VoiceModeSettings.speeds, id: \.self) { speed in
                        Text(verbatim: VoiceModeSettings.speedLabel(speed)).tag(speed)
                    }
                } label: { Text("Speed") }
            }
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            menuRow("Language", value: languageName, id: "panel-edit-language") {
                Picker(selection: binding(\.language)) {
                    ForEach(VoiceModeSettings.languages, id: \.code) { language in
                        Text(verbatim: language.code == "auto" ? String(localized: "Auto") : language.label).tag(language.code)
                    }
                } label: { Text("Language") }
            }
        }
        .task {
            guard voices == nil, let client = session.callClient else { return }
            voices = (try? await client.voiceModeVoices(botId: bot.id, provider: settings.ttsChoice(botId: bot.id))) ?? []
        }
    }

    /// The voice of this bot's provider (2026-10-29: xAI, OpenAI or
    /// ElevenLabs, as picked in Settings > Voice or Edit bot > Voice).
    private var botVoice: String { settings.forBot(bot.id).voice }

    private var voiceBinding: Binding<String> {
        Binding(
            get: { botVoice },
            set: { value in
                voiceRaw = settings.withVoice(value, forBot: bot.id).encoded
                Haptics.selection()
            }
        )
    }

    private var voiceName: String {
        guard !botVoice.isEmpty else { return String(localized: "Not set") }
        if let label = voices?.first(where: { $0.id == botVoice })?.label {
            return Self.capitalizedLabel(label)
        }
        return Self.capitalizedLabel(botVoice)
    }

    private var languageName: String {
        settings.language == "auto" ? String(localized: "Auto") : VoiceModeSettings.languageLabel(settings.language)
    }

    /// First letter capital (`ara` -> `Ara`), as Grok Bot shows voice names.
    static func capitalizedLabel(_ raw: String) -> String {
        guard let first = raw.first else { return raw }
        return String(first).uppercased() + raw.dropFirst()
    }

    private func binding<Value>(_ key: WritableKeyPath<VoiceModeSettings, Value>) -> Binding<Value> {
        Binding(
            get: { settings[keyPath: key] },
            set: { value in
                var next = settings
                next[keyPath: key] = value
                voiceRaw = next.encoded
                Haptics.selection()
            }
        )
    }

    /// A row: the label, then the value and the up-down mark of a menu.
    private func menuRow<Choices: View>(_ label: LocalizedStringKey, value: String, id: String, @ViewBuilder choices: () -> Choices) -> some View {
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
            .padding(.leading, SettingsMetrics.rowInset)
            .padding(.trailing, SettingsMetrics.trailingInset)
            .frame(height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(verbatim: value))
        .accessibilityIdentifier(id)
    }
}
