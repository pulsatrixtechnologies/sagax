// The top of the phone's Edit bot page (the reference design): the avatar
// with a pencil badge, the Name, Title and Description fields (Grok Bot's
// identity block: the short blurb rosters and other bots show), Appearance > Avatar, and
// the Voice calls group (Voice, Speed, Language as menus). The persona
// editor's groups follow it on the same page.
//
// Name, Title and Description save when the field is left or Return is pressed
// (`DesktopInlineEdit.commit`, as the panel's inline name does). Voice,
// Speed and Language are the call's own settings (`VoiceModeSettings`,
// key `omb.voiceMode.v1`), the same values the call's gear card changes.
import CompanionCore
import SwiftUI

struct PhoneBotEditHeader: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let bot: Bot
    /// Opens the avatar editor (the badge and the Avatar row).
    let onAvatar: () -> Void

    private enum Field: Hashable { case name, title, description }

    @State private var name = ""
    @State private var title = ""
    @State private var blurb = ""
    @State private var voices: [VoiceModeVoice]?
    @FocusState private var focus: Field?
    @AppStorage(VoiceModeSettings.storageKey) private var voiceRaw = ""

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var settings: VoiceModeSettings { VoiceModeSettings.decode(voiceRaw.isEmpty ? nil : voiceRaw) }

    var body: some View {
        VStack(spacing: 0) {
            avatar
            fieldLabel("Name")
            field(text: $name, prompt: nil, field: .name, id: "panel-edit-name")
            fieldLabel("Title")
            field(text: $title, prompt: "Add a label", field: .title, id: "panel-edit-title")
            fieldLabel("Description")
            descriptionField
            ProfileFooter(text: "Shown in rosters, on the phone and to other bots. Standing instructions go in Personality.")
            fieldLabel("Appearance")
            ProfileCard {
                Button {
                    Haptics.selection()
                    onAvatar()
                } label: {
                    ProfileRow(title: Text("Avatar"), height: Theme.Profile.singleRow) { ProfileChevronTrailing() }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("panel-edit-avatar-row")
            }
            fieldLabel("Voice calls")
            ProfileCard {
                menuRow("Voice", value: voiceName, id: "panel-edit-voice") {
                    Picker(selection: binding(\.voice)) {
                        Text("Not set").tag("")
                        ForEach(voices ?? []) { voice in Text(verbatim: voice.label).tag(voice.id) }
                        if !settings.voice.isEmpty, !(voices ?? []).contains(where: { $0.id == settings.voice }) {
                            Text(verbatim: settings.voice).tag(settings.voice)
                        }
                    } label: { Text("Voice") }
                }
                ProfileDivider(leading: Theme.Profile.textInset)
                menuRow("Speed", value: VoiceModeSettings.speedLabel(settings.speed), id: "panel-edit-speed") {
                    Picker(selection: binding(\.speed)) {
                        ForEach(VoiceModeSettings.speeds, id: \.self) { speed in
                            Text(verbatim: VoiceModeSettings.speedLabel(speed)).tag(speed)
                        }
                    } label: { Text("Speed") }
                }
                ProfileDivider(leading: Theme.Profile.textInset)
                menuRow("Language", value: languageName, id: "panel-edit-language") {
                    Picker(selection: binding(\.language)) {
                        ForEach(VoiceModeSettings.languages, id: \.code) { language in
                            Text(verbatim: language.code == "auto" ? String(localized: "Auto") : language.label).tag(language.code)
                        }
                    } label: { Text("Language") }
                }
            }
        }
        .onAppear {
            name = current.name
            title = current.title
            blurb = current.description
        }
        // leaving the page saves what is still in a field
        .onDisappear {
            commitName()
            commitTitle()
            commitBlurb()
        }
        .onValueChange(of: focus) { now in
            if now != .name { commitName() }
            if now != .title { commitTitle() }
            if now != .description { commitBlurb() }
        }
        .task {
            guard voices == nil, let client = session.callClient else { return }
            voices = (try? await client.voiceModeVoices(botId: bot.id)) ?? []
        }
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
        ProfileSectionLabel(text: text)
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
            .padding(.horizontal, Theme.Profile.cardMargin)
            .accessibilityLabel(Text(field == .name ? LocalizedStringKey("Name") : LocalizedStringKey("Title")))
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
            .padding(.horizontal, Theme.Profile.cardMargin)
            .onValueChange(of: blurb) { now in
                if now.count > NewBotRules.descriptionLimit { blurb = String(now.prefix(NewBotRules.descriptionLimit)) }
            }
            .accessibilityLabel(Text("Description"))
            .accessibilityIdentifier("panel-edit-description")
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
            // an empty name goes back to the bot's own
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

    // MARK: Voice calls

    private var voiceName: String {
        guard !settings.voice.isEmpty else { return String(localized: "Not set") }
        return voices?.first { $0.id == settings.voice }?.label ?? settings.voice
    }

    private var languageName: String {
        settings.language == "auto" ? String(localized: "Auto") : VoiceModeSettings.languageLabel(settings.language)
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
            .padding(.horizontal, Theme.Profile.textInset)
            .frame(height: Theme.Profile.singleRow)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(verbatim: value))
        .accessibilityIdentifier(id)
    }
}
