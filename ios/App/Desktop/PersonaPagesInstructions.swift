// Edit bot > Personality, Skills (iPad, round 4 of the parity sweep): the
// desktop's bot-settings/SoulSection.tsx (SoulField.tsx, FinishUntilSettings.tsx)
// and bot-settings/SkillsSection.tsx (SkillUpload.tsx, WriteCommandCard.tsx,
// OrgSkillsCard.tsx), at their metrics: PaneSection's grey heading over a
// `rounded-xl border-[0.5px] bg-elevated px-3.5 py-3` card, SettingsGroup
// for "Do not finish until". Every control saves through the routes the
// desktop calls (Client+InstructionsPages.swift, Client+BotAdvanced.swift).
import CompanionCore
import SwiftUI
import UIKit
import UniformTypeIdentifiers

// MARK: - Shared pieces

/// `PaneSection`: the grey heading (13/18, `min-h-6 px-1 gap-1.5`), its
/// info button, then the card (or the plain body).
private struct InstructionsPane<Content: View>: View {
    @Environment(\.desktopTheme) private var theme
    var icon: InstructionsIcon? = nil
    let title: String
    var help: Text? = nil
    var plain = false
    var identifier: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                if let icon {
                    InstructionsIconView(icon: icon, size: 14).foregroundStyle(theme.inkSecondary)
                }
                DesktopText(verbatim: title, size: 13, line: 18, color: \.inkSecondary)
                    .accessibilityAddTraits(.isHeader)
                if let help { DesktopHelpTip(help: help) }
            }
            .frame(minHeight: 24)
            .padding(.horizontal, 4)
            if plain {
                VStack(alignment: .leading, spacing: 8, content: content)
            } else {
                VStack(alignment: .leading, spacing: 0, content: content)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .desktopHairlineBox(radius: 12)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier)
    }
}

/// `inputCls`: the inset field, 13 pt, `px-2.5 py-1.5`.
///
/// UIKit-backed so a field under the SOUL `UITextView` (Do not finish until)
/// can take first responder after that editor was focused (#1939). SwiftUI
/// `TextField` in the same window often never receives keyboard focus once
/// the representable UITextView has been first responder.
private struct InstructionsField: View {
    @Environment(\.desktopTheme) private var theme
    let placeholder: String
    @Binding var text: String
    var mono = false
    var leading: CGFloat = 10
    var identifier: String
    var onSubmit: () -> Void = {}

    var body: some View {
        InstructionsUIKitField(
            text: $text, placeholder: placeholder, mono: mono, leading: leading,
            identifier: identifier, theme: theme, onSubmit: onSubmit
        )
        .frame(height: 33)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
        .accessibilityLabel(Text(verbatim: placeholder))
    }
}

private struct InstructionsUIKitField: UIViewRepresentable {
    @Binding var text: String
    var placeholder: String
    var mono: Bool
    var leading: CGFloat
    var identifier: String
    var theme: DesktopTheme
    var onSubmit: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextField {
        let field = UITextField()
        field.delegate = context.coordinator
        field.borderStyle = .none
        field.backgroundColor = .clear
        field.adjustsFontForContentSizeCategory = false
        field.autocorrectionType = .no
        field.autocapitalizationType = .none
        field.spellCheckingType = .no
        field.returnKeyType = .done
        field.accessibilityIdentifier = identifier
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        field.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .editingChanged)
        apply(field)
        return field
    }

    func updateUIView(_ field: UITextField, context: Context) {
        context.coordinator.parent = self
        apply(field)
        if field.text != text { field.text = text }
    }

    private func apply(_ field: UITextField) {
        let font = mono
            ? UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)
            : theme.uiFont(13)
        field.font = font
        field.textColor = UIColor(theme.ink)
        field.tintColor = UIColor(theme.focus)
        field.attributedPlaceholder = NSAttributedString(
            string: placeholder,
            attributes: [.foregroundColor: UIColor(theme.inkSecondary), .font: font]
        )
        field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: leading, height: 1))
        field.leftViewMode = .always
        field.rightView = UIView(frame: CGRect(x: 0, y: 0, width: 10, height: 1))
        field.rightViewMode = .always
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var parent: InstructionsUIKitField
        init(_ parent: InstructionsUIKitField) { self.parent = parent }

        func textFieldShouldBeginEditing(_ textField: UITextField) -> Bool {
            // Clear a stuck SOUL UITextView responder before this field focuses.
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            return true
        }

        @objc func changed(_ field: UITextField) {
            let value = field.text ?? ""
            if parent.text != value { parent.text = value }
        }

        func textFieldShouldReturn(_ textField: UITextField) -> Bool {
            parent.onSubmit()
            textField.resignFirstResponder()
            return true
        }
    }
}

/// `ui-button` / `ui-button-primary` (PILL, PRIMARY_PILL): a disabled pill
/// is the grey control at half opacity (`disabled:opacity-50`).
private struct InstructionsPill: ButtonStyle {
    @Environment(\.desktopTheme) private var theme
    @Environment(\.isEnabled) private var enabled
    var primary: Bool

    func makeBody(configuration: Configuration) -> some View {
        let accent = primary && enabled
        configuration.label
            .font(theme.font(13))
            .foregroundStyle(accent ? theme.accentInk : enabled ? theme.ink : theme.inkSecondary)
            .padding(.horizontal, 12)
            .frame(height: 31.5)
            .background(accent ? theme.accent.opacity(configuration.isPressed ? 0.85 : 1) : (configuration.isPressed ? theme.raised : theme.control),
                        in: Capsule())
            .contentShape(Capsule())
    }
}

private func pillStyle(primary: Bool) -> InstructionsPill { InstructionsPill(primary: primary) }

/// FinishUntilSettings' buttons: `rounded-lg px-3 py-1.5 text-[12px] font-medium`,
/// Save on the accent, both at 40 % when disabled.
private struct FinishUntilButton: ButtonStyle {
    @Environment(\.desktopTheme) private var theme
    @Environment(\.isEnabled) private var enabled
    var primary: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(theme.font(12, .medium))
            .foregroundStyle(primary && enabled ? theme.accentInk : enabled ? theme.ink : theme.inkSecondary)
            .padding(.horizontal, 12)
            .frame(height: 30)
            // a disabled Save reads as the grey control, as the desktop draws it
            .background(primary ? (enabled ? theme.accent : theme.control) : (configuration.isPressed ? theme.raised : .clear),
                        in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(primary ? .clear : theme.hairline50, lineWidth: 1)
            }
            .opacity(enabled || primary ? 1 : 0.4)
            .contentShape(Rectangle())
    }
}

// MARK: - Personality

/// Personality (bot-settings/SoulSection.tsx): the SOUL.md editor
/// (SoulField.tsx: label and help, the drift banner, the markdown editor
/// with the byte counter) and, under it, "Do not finish until".
struct PersonaPersonalityPage: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot
    let slackURL: URL?

    @State private var soul: BotSoul?
    @State private var fileState: SoulFileState?
    @State private var draft = ""
    @State private var saved = ""
    @State private var problem: String?
    @State private var resolving = false
    @State private var saveTask: Task<Void, Never>?

    private var bytes: Int { draft.utf8.count }
    private var limit: Int { soul?.limit ?? 24_000 }
    private var over: Bool { bytes > limit }
    private var canEdit: Bool { session.surfaceGate.allows(.advancedBotPanel, bot: bot) }
    private var canMigrate: Bool { bot.description.count > 400 && saved.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 12) {
                    DesktopText("Standing instructions (SOUL.md)", size: 13, line: 19.5, color: \.inkSecondary)
                    DesktopHelpTip(help: help)
                    Spacer(minLength: 0)
                    if canMigrate && canEdit {
                        Button { Task { await migrate() } } label: {
                            DesktopText("Move instructions into SOUL.md", size: 11.5, weight: .medium, line: 16, color: \.accentText)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 4)
                        }
                        .buttonStyle(DesktopHoverFill(radius: 6))
                        .disabled(resolving)
                    }
                }
                .padding(.top, 1)
                .padding(.bottom, 8)
                if let state = fileState, state.drift {
                    drift(state)
                }
                if soul != nil {
                    DesktopMarkdownField(
                        text: Binding(get: { draft }, set: { change($0) }),
                        placeholder: AppStrings.localized("Who this bot is and the rules it never breaks. Keep it short; put step-by-step procedure into a skill."),
                        minHeight: 220, invalid: over, disabled: resolving || !canEdit,
                        accessibilityLabel: AppStrings.localized("Standing instructions (SOUL.md)"), identifier: "desktop-panel-soul"
                    ) {
                        DesktopText(verbatim: instructionsText("%@ bytes", "\(bytes.formatted()) / \(limit.formatted())")
                                    + (over ? AppStrings.localized(" (not saved)") : ""),
                                    size: 11, weight: over ? .medium : .regular, line: 16.5, color: over ? \DesktopTheme.danger : \DesktopTheme.inkTertiary)
                            .monospacedDigit()
                            .accessibilityIdentifier("desktop-panel-soul.bytes")
                    }
                } else if let problem {
                    DesktopSettingsNotice(Text(verbatim: problem), color: \.danger)
                } else {
                    ProgressView().controlSize(.small).frame(maxWidth: .infinity, minHeight: 220)
                }
            }
            if canEdit {
                PersonaFinishUntilGroup(bot: bot)
            }
        }
        .task(id: bot.id) { await load() }
        .onDisappear { flush() }
    }

    /// The info button: what SOUL.md is, and where it is mirrored.
    private var help: Text {
        var text = Text(verbatim: "\(AppStrings.localized("Who this bot is and the rules it never breaks.")) \(AppStrings.localized("Read by the bot on every turn."))")
        if let file = soul?.file, !file.isEmpty {
            text = text + Text(verbatim: " \(AppStrings.localized("Mirrored to")) ") + Text(verbatim: file).font(Theme.mono(12)) + Text(verbatim: ".")
        }
        return text
    }

    private func drift(_ state: SoulFileState) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            DesktopText("SOUL.md on disk was edited outside the app.", size: 12, weight: .medium, line: 16)
            DesktopText(verbatim: "\(AppStrings.localized("The bot keeps using the saved version until you choose. File:")) \(state.file ?? "")",
                        size: 12, line: 16, color: \.inkSecondary)
                .padding(.top, 4)
            if let fileText = state.fileText {
                ScrollView {
                    Text(verbatim: fileText)
                        .font(theme.font(11.5))
                        .foregroundStyle(theme.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
                .frame(maxHeight: 160)
                .padding(8)
                .background(theme.control, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                .padding(.top, 8)
            }
            HStack(spacing: 8) {
                Button(AppStrings.localized("Use the file")) { Task { await resolve(.applyFile) } }
                    .buttonStyle(DesktopButtonStyle(kind: .accent, size: 12, weight: .medium, height: 28))
                    .accessibilityIdentifier("desktop-panel-soul.use-file")
                Button(AppStrings.localized("Keep the saved version")) { Task { await resolve(.discardFile) } }
                    .buttonStyle(DesktopButtonStyle(kind: .control, size: 12, height: 28))
                    .accessibilityIdentifier("desktop-panel-soul.keep-saved")
            }
            .disabled(resolving)
            .padding(.top, 8)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.warning.opacity(0.1), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.warning.opacity(0.4), lineWidth: 1))
        .padding(.bottom, 8)
        .accessibilityIdentifier("desktop-panel-soul.drift")
    }

    /// The desktop patches the bot as the person types (`soulPatchFor`): a
    /// draft over the cap stays local.
    private func change(_ value: String) {
        draft = value
        saveTask?.cancel()
        guard value.utf8.count <= limit, value != saved else { return }
        saveTask = Task {
            try? await Task.sleep(nanoseconds: 600_000_000)
            guard !Task.isCancelled else { return }
            await save(value)
        }
    }

    private func flush() {
        saveTask?.cancel()
        let value = draft
        guard soul != nil, value != saved, value.utf8.count <= limit else { return }
        Task { await save(value) }
    }

    private func load() async {
        guard let client = session.profileClient else { return }
        do {
            let loaded = try await client.soul(botId: bot.id)
            soul = loaded
            draft = loaded.soul
            saved = loaded.soul
            problem = nil
            fileState = loaded.drift == true ? try? await client.soulFileState(botId: bot.id) : nil
        } catch {
            problem = error.localizedDescription
        }
    }

    private func save(_ value: String) async {
        guard let client = session.profileClient else { return }
        do {
            session.applyProfileBot(try await client.saveSoul(botId: bot.id, soul: value))
            saved = value
        } catch {
            session.actionError = error.localizedDescription
        }
    }

    private func migrate() async {
        let text = bot.description
        draft = text
        await save(text)
        _ = await session.updateProfile(BotProfilePatch(description: Self.firstSentence(text)), for: bot)
    }

    private func resolve(_ choice: SoulDriftChoice) async {
        guard let client = session.profileClient, let state = fileState, let revision = state.revision, let fileText = state.fileText,
              !resolving else { return }
        resolving = true
        defer { resolving = false }
        do {
            try await client.resolveSoulDrift(botId: bot.id, choice: choice, fileText: fileText, expectedRevision: revision)
        } catch {
            session.actionError = error.localizedDescription
        }
        await load()
    }

    /// src/lib/soul.ts `firstSentence`.
    static func firstSentence(_ text: String, max: Int = 200) -> String {
        let line = text.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: "\n").first ?? ""
        var sentence = line
        if let match = line.range(of: #"^.*?[.!?](?=\s|$)"#, options: .regularExpression) {
            sentence = String(line[match])
        }
        return String(sentence.trimmingCharacters(in: .whitespaces).prefix(max))
    }
}

/// "Do not finish until" (FinishUntilSettings.tsx): the condition, the
/// on/off line, Save (and Clear once set), then "Relaunches at most".
private struct PersonaFinishUntilGroup: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot

    @State private var draft = ""
    @State private var saving = false
    @State private var error = ""

    private static let choices = [1, 2, 3, 5, 8, 10, 15, 20, 30, FinishUntilLine.maxRounds]
    private var stored: String { bot.finishUntil ?? "" }
    private var rounds: Int { FinishUntilLine.rounds(bot.finishUntilMaxRounds) }
    private var oneLine: String { draft.replacingOccurrences(of: #"[\r\n]+"#, with: " ", options: .regularExpression) }
    private var changed: Bool { oneLine.trimmingCharacters(in: .whitespacesAndNewlines) != stored }

    var body: some View {
        DesktopSettingsGroup(
            Text("Do not finish until"),
            accessory: AnyView(DesktopHelpTip(help: Text("One sentence that must be true before this bot finishes, for example \"the tests pass\". After each reply in a conversation with this bot, Sagax checks it. While it is not true, Sagax relaunches the bot on its own in the same conversation, up to the number of relaunches below. Each relaunch is a normal turn and costs like one. Stop ends the relaunches."))),
            identifier: "botFinishUntil"
        ) {
            VStack(alignment: .leading, spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    DesktopText("Condition", size: 13, line: 18)
                    InstructionsField(
                        placeholder: AppStrings.localized("For example: the tests pass and the branch is pushed"),
                        text: Binding(get: { draft }, set: { draft = String($0.replacingOccurrences(of: #"[\r\n]+"#, with: " ", options: .regularExpression).prefix(400)) }),
                        identifier: "finish-until-condition"
                    ) {
                        if changed && !saving { Task { await save(BotProfilePatch(finishUntil: oneLine.trimmingCharacters(in: .whitespacesAndNewlines))) } }
                    }
                }
                DesktopText(verbatim: stored.isEmpty
                            ? AppStrings.localized("Off. The bot finishes when it decides it is done.")
                            : instructionsText("On. Sagax relaunches the bot up to %@ times while the condition is not met.", "\(rounds)"),
                            size: 12, line: 16, color: \.inkSecondary)
                if !error.isEmpty {
                    DesktopText(verbatim: error, size: 12, line: 16, color: \.danger)
                }
                HStack(spacing: 8) {
                    Button(AppStrings.localized("Save")) {
                        Task { await save(BotProfilePatch(finishUntil: oneLine.trimmingCharacters(in: .whitespacesAndNewlines))) }
                    }
                    .buttonStyle(FinishUntilButton(primary: true))
                    .disabled(!changed || saving)
                    .accessibilityIdentifier("finish-until-save")
                    if !stored.isEmpty {
                        Button(AppStrings.localized("Clear")) { Task { await save(BotProfilePatch(finishUntil: "")) } }
                            .buttonStyle(FinishUntilButton(primary: false))
                            .disabled(saving)
                            .accessibilityIdentifier("finish-until-clear")
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            DesktopDescribedRow(
                Text("Relaunches at most"),
                help: Text("How many turns Sagax starts on its own while the condition is not met, before it waits for you. A message from you starts the count over."),
                identifier: "botFinishUntilRounds"
            ) {
                let choices = Self.choices.contains(rounds) ? Self.choices : (Self.choices + [rounds]).sorted()
                DesktopPillSelect(
                    options: choices.map { ($0, "\($0)") }, selection: rounds,
                    label: Text("Relaunches at most"), identifier: "finish-until-rounds", disabled: saving
                ) { limit in
                    guard limit != rounds else { return }
                    Task { await save(BotProfilePatch(finishUntilMaxRounds: limit == FinishUntilLine.defaultRounds ? .clear : .set(limit))) }
                }
            }
        }
        .onValueChange(of: stored, initial: true) { value in draft = value }
    }

    private func save(_ patch: BotProfilePatch) async {
        saving = true
        error = ""
        defer { saving = false }
        if await session.updateProfile(patch, for: bot) == nil {
            error = session.actionError ?? AppStrings.localized("The condition could not be saved.")
        }
    }
}

// MARK: - Skills

/// What the Skills page adds to `BotSkillsModel`: the library, the upload,
/// the written command and the organization's offer.
@MainActor
final class PersonaSkillsExtras: ObservableObject {
    @Published var libraryOn = true
    @Published var listing = SkillsLibraryListing()
    @Published var addFromLibrary = ""
    @Published var working = ""
    @Published var error = ""
    @Published var review: (skill: ManagedSkill, text: String, origin: SkillOrigin?)?
    @Published var reading: (skill: ManagedSkill, text: String)?
    @Published var organization: String?
    @Published var offered: [OfferedOrgSkill] = []
    // Upload
    @Published var picked: [SkillUploadFile] = []
    @Published var items: [SkillUploadItem]?
    @Published var phase = ""
    @Published var uploadError = ""
    @Published var uploadMessage = ""

    let botId: String
    var client: CompanionClient?

    init(botId: String) { self.botId = botId }

    func load(first: Bool) async {
        guard let client else { return }
        if first, let flags = try? await client.skillsPageFlags() { libraryOn = flags.library }
        if let listing = try? await client.skillsLibraryListing(botId: botId) {
            self.listing = listing
            addFromLibrary = ""
        }
        if let offer = try? await client.orgOfferedSkills(botId: botId) {
            organization = offer.organization?.name
            offered = offer.skills
        } else {
            organization = nil
        }
    }

    func origin(_ skill: ManagedSkill) -> SkillOrigin? { listing.origin(of: skill.name)?.origin }

    func run(_ name: String, _ body: (CompanionClient) async throws -> Void) async -> Bool {
        guard let client else { return false }
        working = name
        error = ""
        defer { working = "" }
        do {
            try await body(client)
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func assignments(_ name: String, remove: Bool) async -> Bool {
        await run(name) { client in
            let current = try await client.skillsLibraryListing(botId: botId).assignedSkills
            let next = remove ? current.filter { $0 != name } : Array(Set(current + [name])).sorted()
            try await client.setBotLibrarySkills(botId: botId, skills: next)
        }
    }

    /// A switch: off writes at once (from where the skill lives); on shows
    /// the integrity-checked text first.
    func toggle(_ skill: ManagedSkill) async -> Bool {
        let origin = origin(skill)
        if skill.enabled {
            return await run(skill.name) { client in
                try await client.setSkillOriginEnabled(botId: botId, name: skill.name, origin: origin, enabled: false)
            }
        }
        var text: String?
        let ok = await run(skill.name) { client in text = try await client.skillOriginText(botId: botId, name: skill.name, origin: origin) }
        guard ok else { return false }
        guard let text, !text.isEmpty else {
            error = AppStrings.localized("The skill contents are unavailable; remove and import or learn it again.")
            return false
        }
        review = (skill, text, origin)
        return false
    }

    func enableReviewed() async -> Bool {
        guard let review else { return false }
        let ok = await run(review.skill.name) { client in
            try await client.setSkillOriginEnabled(botId: botId, name: review.skill.name, origin: review.origin, enabled: true)
        }
        if ok { self.review = nil }
        return ok
    }

    func read(_ skill: ManagedSkill) async {
        var text: String?
        _ = await run(skill.name) { client in text = try await client.skillOriginText(botId: botId, name: skill.name, origin: origin(skill)) }
        if let text { reading = (skill, text) }
    }

    // MARK: Upload

    func choose(_ urls: [URL]) async {
        uploadError = ""
        uploadMessage = ""
        guard !urls.isEmpty else { return }
        if urls.count > SkillUploadRules.maxFiles {
            uploadError = instructionsText("At most %@ files at once.", "\(SkillUploadRules.maxFiles)")
            return
        }
        phase = "reading"
        var files: [SkillUploadFile] = []
        var total = 0
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else {
                phase = ""
                uploadError = instructionsText("The upload failed: %@", url.lastPathComponent)
                return
            }
            if SkillUploadRules.tooLarge(name: url.lastPathComponent, bytes: data.count) {
                phase = ""
                uploadError = instructionsText("%@ is too large: a SKILL.md is at most 256 KB, a .zip at most 5 MB, and one upload at most 10 MB.", url.lastPathComponent)
                return
            }
            total += data.count
            files.append(SkillUploadFile(name: url.lastPathComponent, data: data.base64EncodedString()))
        }
        if total > SkillUploadRules.totalMaxBytes {
            phase = ""
            uploadError = instructionsText("%@ is too large: a SKILL.md is at most 256 KB, a .zip at most 5 MB, and one upload at most 10 MB.",
                                           files.map(\.name).joined(separator: ", "))
            return
        }
        await preview(files)
    }

    func preview(_ files: [SkillUploadFile]) async {
        picked = files
        guard !files.isEmpty, let client else {
            items = nil
            phase = ""
            return
        }
        phase = "reading"
        defer { phase = "" }
        do {
            items = try await client.previewSkillUpload(botId: botId, files: files)
        } catch {
            items = nil
            uploadError = instructionsText("The upload failed: %@", error.localizedDescription)
        }
    }

    func install() async -> Bool {
        guard let client else { return false }
        phase = "adding"
        uploadError = ""
        do {
            let installed = try await client.installSkillUpload(botId: botId, files: picked)
            phase = ""
            uploadMessage = instructionsText("%@ added, switched off. Read each one, then switch it on below.", "\(installed.count)")
            picked = []
            items = nil
            return true
        } catch {
            phase = ""
            // a refusal names its files: the preview shows each one's reason
            uploadError = instructionsText("The upload failed: %@", error.localizedDescription)
            await preview(picked)
            return false
        }
    }

    static func problemText(_ item: SkillUploadItem, _ problem: SkillUploadItem.Problem) -> String {
        let keys: [String: String] = [
            "type": "%@: not a SKILL.md file or a .zip.",
            "too-large": "%@: too large (a SKILL.md is at most 256 KB, a .zip at most 5 MB).",
            "zip": "%@: this zip cannot be read (%@).",
            "unsafe-path": "%@: a path leaves the skill folder, or is a link. Nothing was extracted.",
            "no-skill": "%@: no SKILL.md in this zip.",
            "nested": "%@: a skill inside another skill's folder.",
            "too-many": "%@: more than 30 skills in one zip.",
            "not-text": "%@: not UTF-8 text.",
            "frontmatter": "%@: the front matter needs a name (lowercase letters, digits and hyphens) and a description. %@",
            "exists": "%@: this bot already has a skill with this name. Remove it first, or rename the skill.",
            "duplicate": "%@: this name is in the upload twice.",
        ]
        let subject = problem.subject ?? item.file
        guard let key = keys[problem.code] else { return "\(subject): \(problem.detail)" }
        return instructionsText(key, subject, problem.detail)
    }
}

/// Skills (bot-settings/SkillsSection.tsx): "Learned skills" (the library
/// or the import field, Upload, the installed list), "Write a command",
/// and the organization's offered skills.
struct PersonaSkillsPage: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var shell: DesktopShellModel
    let bot: Bot
    let slackURL: URL?

    @StateObject private var model: BotSkillsModel
    @StateObject private var extras: PersonaSkillsExtras
    @State private var source = ""
    @State private var removing: ManagedSkill?
    @State private var unsharing: ManagedSkill?
    @State private var picking = false

    init(bot: Bot, slackURL: URL?) {
        self.bot = bot
        self.slackURL = slackURL
        _model = StateObject(wrappedValue: BotSkillsModel(botId: bot.id))
        _extras = StateObject(wrappedValue: PersonaSkillsExtras(botId: bot.id))
    }

    private var canWrite: Bool { session.surfaceGate.allows(.advancedBotPanel, bot: bot) }
    private var busy: Bool { !model.working.isEmpty || !extras.working.isEmpty }
    private var switchColor: Color? { BubbleColors.user(botColor: bot.color)?.fill.color }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            InstructionsPane(
                title: AppStrings.localized("Learned skills"),
                help: Text(verbatim: "\(AppStrings.localized(model.authoring ? "Save a bot's verification run as a skill from the Verify card, or import one here. Each new or changed skill shows in the chat with Undo." : "Skill authoring is off, but skills you already enabled stay under your control here.")) \(AppStrings.localized("Used when the bot decides it's relevant"))."),
                identifier: "desktop-skills.learned"
            ) {
                learned
            }
            if canWrite {
                PersonaWriteCommand(bot: bot, taken: model.skills.map(\.name)) { await refresh() }
            }
            if canWrite, let organization = extras.organization, !extras.offered.isEmpty {
                orgSkills(organization)
            }
        }
        .task(id: bot.id) {
            model.client = session.profileClient
            extras.client = session.profileClient
            async let skills: Void = model.refresh(first: true)
            async let more: Void = extras.load(first: true)
            _ = await (skills, more)
        }
        .fileImporter(isPresented: $picking, allowedContentTypes: Self.uploadTypes, allowsMultipleSelection: true) { result in
            if case let .success(urls) = result { Task { await extras.choose(urls) } }
        }
        .sheet(item: $model.reviewing) { sheet in SkillReviewSheet(sheet: sheet, model: model) }
        .sheet(item: $model.viewing) { sheet in SkillTextSheet(sheet: sheet, model: model) }
        .sheet(isPresented: Binding(get: { extras.review != nil }, set: { if !$0 { extras.review = nil } })) {
            if let review = extras.review { reviewSheet(review.skill, review.text, reviewing: true) }
        }
        .sheet(isPresented: Binding(get: { extras.reading != nil }, set: { if !$0 { extras.reading = nil } })) {
            if let reading = extras.reading { reviewSheet(reading.skill, reading.text, reviewing: false) }
        }
        .confirmationDialog(
            removing.map(removeTitle) ?? "",
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            titleVisibility: .visible,
            presenting: removing
        ) { skill in
            Button(extras.origin(skill) == .me ? AppStrings.localized("Stop sharing") : AppStrings.localized("Remove skill"), role: .destructive) {
                removing = nil
                Task { await remove(skill) }
            }
            .accessibilityIdentifier("desktop-skills.remove-confirm")
            Button(AppStrings.localized("Cancel"), role: .cancel) { removing = nil }
        }
        .confirmationDialog(
            unsharing.map { instructionsText("Stop sharing “%@” on this bot? This bot keeps its own copy; other bots keep the shared one.", $0.name) } ?? "",
            isPresented: Binding(get: { unsharing != nil }, set: { if !$0 { unsharing = nil } }),
            titleVisibility: .visible,
            presenting: unsharing
        ) { skill in
            Button(AppStrings.localized("Stop sharing"), role: .destructive) {
                unsharing = nil
                let scope = extras.origin(skill) == .me ? "me" : "organization"
                Task { if await extras.run(skill.name, { try await $0.shareSkill(botId: bot.id, name: skill.name, scope: scope, stop: true) }) { await refresh() } }
            }
            Button(AppStrings.localized("Cancel"), role: .cancel) { unsharing = nil }
        }
    }

    static let uploadTypes: [UTType] = [.zip, UTType(filenameExtension: "md") ?? .plainText, UTType(filenameExtension: "markdown") ?? .plainText, .plainText]

    // MARK: Learned skills

    @ViewBuilder
    private var learned: some View {
        if canWrite && extras.libraryOn {
            VStack(alignment: .leading, spacing: 6) {
                let pool = extras.listing.library
                if !pool.isEmpty {
                    HStack(spacing: 8) {
                        DesktopPillSelect(
                            options: [("", AppStrings.localized("Add a skill from the library…"))] + pool.map { ($0.name, $0.name) },
                            selection: extras.addFromLibrary, label: Text("Add a skill from the library"),
                            identifier: "desktop-skills.library-pick"
                        ) { extras.addFromLibrary = $0 }
                        Spacer(minLength: 0)
                        Button(AppStrings.localized("Add")) {
                            let name = extras.addFromLibrary
                            Task { if await extras.assignments(name, remove: false) { await refresh() } }
                        }
                        .buttonStyle(pillStyle(primary: true))
                        .disabled(extras.addFromLibrary.isEmpty || busy)
                        .accessibilityIdentifier("desktop-skills.library-add")
                    }
                } else {
                    DesktopText("Every skill in the library is already assigned to this bot.", size: 12, line: 16, color: \.inkSecondary)
                }
                Button {
                    shell.personaOpen = false
                    shell.modal = .plugins
                } label: {
                    HStack(spacing: 4) {
                        DesktopText("Manage in Capabilities", size: 12.5, weight: .medium, line: 18.75, color: \.accentText)
                        InstructionsIconView(icon: .arrowUpRight, size: 13).foregroundStyle(theme.accentText)
                    }
                    .padding(4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("desktop-skills.manage-in-capabilities")
            }
        } else if canWrite {
            HStack(spacing: 8) {
                InstructionsField(
                    placeholder: AppStrings.localized("owner/repo, https://github.com/…/SKILL.md, or https://skills.sh/…"),
                    text: $source, identifier: "desktop-skills.import-field"
                ) { importSkill() }
                Button(model.importing ? AppStrings.localized("Importing…") : AppStrings.localized("Import")) { importSkill() }
                    .buttonStyle(DesktopButtonStyle(kind: .control, size: 13, height: 33))
                    .disabled(model.importing || SkillRules.importSource(source) == nil)
                    .accessibilityIdentifier("desktop-skills.import")
            }
            if !model.importMessage.isEmpty {
                DesktopText(verbatim: model.importMessage, size: 12, line: 16, color: \.inkSecondary).padding(.top, 4)
            }
        }
        if canWrite {
            upload.padding(.top, 12)
        }
        if model.loading {
            DesktopText("Loading…", size: 12, line: 16, color: \.inkSecondary).padding(.top, 12)
        } else if model.skills.isEmpty {
            DesktopText("No installed skills yet.", size: 12.5, line: 18.75, color: \.inkSecondary)
                .padding(.top, 12)
                .accessibilityIdentifier("desktop-skills.empty")
        } else {
            VStack(spacing: 0) {
                ForEach(model.skills) { skill in
                    Rectangle().fill(theme.hairline40).frame(height: 1)
                    row(skill)
                }
            }
            .padding(.horizontal, -14)
            .padding(.top, 12)
        }
        if model.staged > 0 {
            DesktopText(verbatim: instructionsText(model.staged == 1 ? "%@ proposal is waiting for a decision in chat." : "%@ proposals are waiting for a decision in chat.", "\(model.staged)"),
                        size: 11.5, line: 16, color: \.warning)
                .padding(.top, 8)
        }
        ForEach([model.error, extras.error].filter { !$0.isEmpty }, id: \.self) { message in
            DesktopText(verbatim: message, size: 12, line: 16, color: \.danger).padding(.top, 8)
        }
    }

    private var upload: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Button { picking = true } label: {
                    HStack(spacing: 6) {
                        InstructionsIconView(icon: .upload, size: 14)
                        Text(verbatim: extras.phase == "reading" ? AppStrings.localized("Reading…") : AppStrings.localized("Upload"))
                    }
                }
                .buttonStyle(pillStyle(primary: false))
                .disabled(busy || !extras.phase.isEmpty)
                .accessibilityLabel(Text("Upload SKILL.md files or zipped skill folders"))
                .accessibilityIdentifier("desktop-skills.upload")
                DesktopText("Upload a SKILL.md file, or a .zip of a skill folder (SKILL.md and its files); several at once. Only SKILL.md is imported; the other files are listed. Skills arrive switched off: read each one, then switch it on.",
                            size: 11.5, line: 15.8, color: \.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let items = extras.items {
                uploadPreview(items)
            }
            if !extras.uploadMessage.isEmpty {
                DesktopText(verbatim: extras.uploadMessage, size: 12, line: 16, color: \.inkSecondary)
            }
            if !extras.uploadError.isEmpty {
                DesktopText(verbatim: extras.uploadError, size: 12, line: 16, color: \.danger)
            }
        }
    }

    private func uploadPreview(_ items: [SkillUploadItem]) -> some View {
        let count = items.reduce(0) { $0 + $1.skills.count }
        let refused = items.contains { !$0.errors.isEmpty }
        return VStack(alignment: .leading, spacing: 8) {
            DesktopText("Add these skills?", size: 13, weight: .medium, line: 18)
            DesktopText("Nothing is added until you confirm. Skills arrive switched off.", size: 11.5, line: 16, color: \.inkSecondary)
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 8) {
                        Text(verbatim: item.file).font(Theme.mono(12)).foregroundStyle(theme.inkSecondary).lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Button {
                            Task { await extras.preview(extras.picked.enumerated().filter { $0.offset != index }.map(\.element)) }
                        } label: {
                            InstructionsIconView(icon: .x, size: 13).foregroundStyle(theme.inkSecondary).frame(width: 24, height: 24)
                        }
                        .buttonStyle(DesktopHoverFill(radius: 6))
                        .disabled(!extras.phase.isEmpty)
                        .accessibilityLabel(Text(verbatim: instructionsText("Remove %@ from the upload", item.file)))
                    }
                    ForEach(item.skills, id: \.name) { skill in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: skill.name).font(Theme.mono(12.5)).foregroundStyle(theme.ink)
                            DesktopText(verbatim: skill.description, size: 11.5, line: 16, color: \.inkSecondary).lineLimit(2)
                            if !skill.warnings.isEmpty {
                                DesktopText(verbatim: skill.warnings.joined(separator: " · "), size: 10.5, line: 14, color: \.warning)
                            }
                            if skill.skippedCount > 0 {
                                DesktopText(verbatim: instructionsText("Not imported (only SKILL.md is): %@", skill.skippedFiles.joined(separator: ", ") + (skill.skippedCount > skill.skippedFiles.count ? ", …" : "")),
                                            size: 10.5, line: 14, color: \.inkSecondary)
                            }
                        }
                        .padding(.top, 6)
                    }
                    if item.ignoredCount > 0 {
                        DesktopText(verbatim: instructionsText("Outside any skill folder, not imported: %@", item.ignored.joined(separator: ", ") + (item.ignoredCount > item.ignored.count ? ", …" : "")),
                                    size: 10.5, line: 14, color: \.inkSecondary)
                            .padding(.top, 4)
                    }
                    ForEach(Array(item.errors.enumerated()), id: \.offset) { _, problem in
                        DesktopText(verbatim: PersonaSkillsExtras.problemText(item, problem), size: 11.5, line: 16, color: \.danger)
                            .padding(.top, 4)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
            }
            if refused {
                DesktopText("Nothing can be added until the files marked here are fixed or removed.", size: 11.5, line: 16, color: \.danger)
            }
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                Button(AppStrings.localized("Cancel")) {
                    extras.picked = []
                    extras.items = nil
                }
                .buttonStyle(DesktopButtonStyle(kind: .ghost, size: 13, height: 30))
                .disabled(!extras.phase.isEmpty)
                Button(extras.phase == "adding" ? AppStrings.localized("Adding…") : instructionsText("Add %@", "\(count)")) {
                    Task { if await extras.install() { await refresh() } }
                }
                .buttonStyle(pillStyle(primary: true))
                .disabled(!extras.phase.isEmpty || refused || count == 0)
                .accessibilityIdentifier("desktop-skills.upload-add")
            }
        }
        .padding(12)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityIdentifier("desktop-skills.upload-preview")
    }

    private func row(_ skill: ManagedSkill) -> some View {
        let info = extras.listing.origin(of: skill.name)
        let origin = info?.origin
        let blocked = skill.warnings.contains { $0.contains("changed after review") }
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Button { Task { await open(skill, editing: false) } } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(verbatim: skill.name).font(Theme.mono(12.5)).foregroundStyle(theme.ink).lineLimit(1)
                            if extras.libraryOn {
                                Text(verbatim: origin == .me || origin == .library ? AppStrings.localized("shared") : AppStrings.localized("private"))
                                    .font(Theme.mono(9.5))
                                    .textCase(.uppercase)
                                    .tracking(0.4)
                                    .foregroundStyle(theme.inkSecondary)
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 1)
                                    .background(theme.control, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                            }
                        }
                        if !skill.description.isEmpty {
                            DesktopText(verbatim: skill.description, size: 11.5, line: 16, color: \.inkSecondary).lineLimit(2)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("desktop-skills.open.\(skill.name)")
                if canWrite {
                    PanelSwitch(
                        label: LocalizedStringKey(instructionsText(skill.enabled ? "Disable %@" : "Enable %@", skill.name)),
                        isOn: skill.enabled, disabled: busy, onColor: switchColor
                    ) { _ in
                        Task { if await toggle(skill) { await refresh() } }
                    }
                    .accessibilityIdentifier("desktop-skills.toggle.\(skill.name)")
                    Menu {
                        Button(AppStrings.localized("Open"), systemImage: "eye") { Task { await open(skill, editing: false) } }
                        if origin == nil || origin == .private {
                            Button(AppStrings.localized("Edit"), systemImage: "pencil") { Task { await open(skill, editing: true) } }
                        }
                        if extras.libraryOn && origin == .private {
                            Button(AppStrings.localized("Share with my bots"), systemImage: "square.and.arrow.up") {
                                Task { if await extras.run(skill.name, { try await $0.shareSkill(botId: bot.id, name: skill.name, scope: "me", stop: false) }) { await refresh() } }
                            }
                            .disabled(busy)
                        }
                        if extras.libraryOn && (origin == .me || origin == .library) {
                            Button(AppStrings.localized("Stop sharing"), systemImage: "square.and.arrow.up.trianglebadge.exclamationmark") {
                                unsharing = skill
                            }
                            .disabled(busy)
                        }
                        Button(AppStrings.localized("Remove skill"), systemImage: "trash", role: .destructive) { removing = skill }
                            .disabled(busy)
                    } label: {
                        InstructionsIconView(icon: .ellipsis, size: 15)
                            .foregroundStyle(theme.inkSecondary)
                            .frame(width: 32, height: 32)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel(Text(verbatim: instructionsText("Actions for %@", skill.name)))
                    .accessibilityIdentifier("desktop-skills.menu.\(skill.name)")
                }
            }
            if !skill.source.isEmpty {
                DisclosureGroup {
                    Text(verbatim: skill.source).font(Theme.mono(10)).foregroundStyle(theme.inkSecondary).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } label: {
                    DesktopText(verbatim: SkillSourceLabel.of(skill.source), size: 10.5, line: 14, color: \.inkSecondary)
                }
                .tint(theme.inkSecondary)
                .padding(.top, 4)
                .accessibilityIdentifier("desktop-skill-source.\(skill.name)")
            }
            if extras.libraryOn, origin == .me || origin == .library, let bots = info?.assignedBots, !bots.isEmpty {
                DesktopText(verbatim: instructionsText("botPanel.skills.sharedWith", bots.map(\.name).joined(separator: ", ")), size: 10.5, line: 14, color: \.inkSecondary)
                    .padding(.top, 4)
            }
            if blocked {
                HStack(spacing: 0) {
                    DesktopText("stored SKILL.md changed after review - enablement is blocked", size: 10.5, line: 14, color: \.warning)
                    DesktopText(verbatim: " · ", size: 10.5, line: 14, color: \.warning)
                    Button { Task { await open(skill, editing: false) } } label: {
                        DesktopText("Review changes", size: 10.5, weight: .medium, line: 14, color: \.accentText)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.top, 4)
            } else if !skill.warnings.isEmpty {
                DesktopText(verbatim: skill.warnings.joined(separator: " · "), size: 10.5, line: 14, color: \.warning).padding(.top, 4)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-skills.row.\(skill.name)")
    }

    private func orgSkills(_ organization: String) -> some View {
        InstructionsPane(
            title: instructionsText("From %@", organization),
            help: Text("Skills your organization shares. Adding one puts it on this bot, switched on."),
            identifier: "desktop-skills.org"
        ) {
            VStack(spacing: 0) {
                ForEach(Array(extras.offered.enumerated()), id: \.element.id) { index, skill in
                    if index > 0 { Rectangle().fill(theme.hairline40).frame(height: 1) }
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: skill.name).font(Theme.mono(12.5)).foregroundStyle(theme.ink).lineLimit(1)
                            DesktopText(verbatim: skill.description, size: 11.5, line: 16, color: \.inkSecondary).lineLimit(2)
                            DesktopText(verbatim: instructionsText("%@ %@ · %@", skill.packageName, skill.release, skill.publisher), size: 10.5, line: 14, color: \.inkSecondary)
                                .lineLimit(1)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        if skill.added {
                            HStack(spacing: 4) {
                                InstructionsIconView(icon: .check, size: 13).foregroundStyle(theme.success)
                                DesktopText("Added", size: 12, line: 16, color: \.inkSecondary)
                            }
                        } else {
                            Button(extras.working == skill.id ? AppStrings.localized("Adding…") : AppStrings.localized("Add")) {
                                Task {
                                    if await extras.run(skill.id, { try await $0.addOrgSkill(botId: bot.id, skill: skill) }) { await refresh() }
                                }
                            }
                            .buttonStyle(DesktopButtonStyle(kind: .control, size: 12.5, height: 30))
                            .disabled(!extras.working.isEmpty)
                            .accessibilityLabel(Text(verbatim: instructionsText("Add %@ to this bot", skill.name)))
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                }
            }
            .padding(.horizontal, -14)
            .padding(.vertical, -4)
        }
    }

    private func reviewSheet(_ skill: ManagedSkill, _ text: String, reviewing: Bool) -> some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    DesktopText(verbatim: instructionsText("Source: %@", skill.source), size: 12, line: 16, color: \.inkSecondary)
                    if !skill.warnings.isEmpty {
                        DesktopText(verbatim: skill.warnings.joined(separator: " · "), size: 12, line: 16, color: \.warning)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(theme.warning.opacity(0.1), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    Text(verbatim: text)
                        .font(Theme.mono(12))
                        .foregroundStyle(theme.ink)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(theme.inset, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    if !extras.error.isEmpty {
                        DesktopText(verbatim: extras.error, size: 12, line: 16, color: \.danger)
                    }
                }
                .padding(16)
            }
            .background(theme.app)
            .navigationTitle(reviewing ? instructionsText("Review %@ before enabling", skill.name) : skill.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(AppStrings.localized(reviewing ? "Cancel" : "Close")) { extras.review = nil; extras.reading = nil }
                }
                if reviewing {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(AppStrings.localized("Enable reviewed skill")) { Task { if await extras.enableReviewed() { await refresh() } } }
                            .disabled(!extras.working.isEmpty)
                    }
                }
            }
        }
        .environment(\.desktopTheme, theme)
    }

    // MARK: Actions

    private func refresh() async {
        async let skills: Void = model.refresh()
        async let more: Void = extras.load(first: false)
        _ = await (skills, more)
    }

    private func importSkill() {
        let text = source
        Task { if await model.importSkill(text) { source = ""; await extras.load(first: false) } }
    }

    /// The switch; true when the list changed.
    private func toggle(_ skill: ManagedSkill) async -> Bool {
        await extras.toggle(skill)
    }

    private func open(_ skill: ManagedSkill, editing: Bool) async {
        if extras.origin(skill) == .library || extras.origin(skill) == .me {
            await extras.read(skill)
        } else {
            await model.view(skill, startEditing: editing)
        }
    }

    private func removeTitle(_ skill: ManagedSkill) -> String {
        switch extras.origin(skill) {
        case .library: instructionsText("Unassign “%@” from this bot? The skill stays in the library.", skill.name)
        case .me: instructionsText("Stop sharing “%@” on this bot? This bot keeps its own copy; other bots keep the shared one.", skill.name)
        default: instructionsText("Remove the learned skill “%@”?", skill.name)
        }
    }

    private func remove(_ skill: ManagedSkill) async {
        let origin = extras.origin(skill)
        switch origin {
        case .library:
            if await extras.assignments(skill.name, remove: true) { await refresh() }
        case .me:
            if await extras.run(skill.name, { try await $0.shareSkill(botId: bot.id, name: skill.name, scope: "me", stop: true) }) { await refresh() }
        default:
            await model.remove(skill)
            await extras.load(first: false)
        }
    }
}

// MARK: - Write a command

/// WriteCommandCard.tsx: `/name`, what it does, the body, Save command.
private struct PersonaWriteCommand: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot
    let taken: [String]
    let saved: () async -> Void

    @State private var name = ""
    @State private var description = ""
    @State private var instructions = ""
    @State private var saving = false
    @State private var message = ""
    @State private var error = ""
    /// Software keyboard height; when it covers the in-card Save, the same
    /// control rides above the keyboard (#1939).
    @State private var keyboardHeight: CGFloat = 0

    private var problem: WrittenSkill.Problem? {
        WrittenSkill.problem(name: name, description: description, instructions: instructions, taken: taken)
    }
    private var touched: Bool {
        [name, description, instructions].contains { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }
    private var keyboardUp: Bool { keyboardHeight > 40 }

    var body: some View {
        InstructionsPane(
            icon: .squareSlash,
            title: AppStrings.localized("Write a command"),
            help: Text(verbatim: instructionsText("Give the bot a short command for something you ask often. Type /name in a chat to run it. Anything after the name fills in %@.", "{input}")),
            identifier: "desktop-skills.write-command"
        ) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    ZStack(alignment: .leading) {
                        InstructionsField(
                            placeholder: AppStrings.localized("name"),
                            text: Binding(get: { name }, set: { name = String(WrittenSkill.typedName($0).prefix(WrittenSkill.nameMax)) }),
                            mono: true, leading: 24, identifier: "desktop-skills.command-name"
                        )
                        .accessibilityLabel(Text("Command name"))
                        Text(verbatim: "/").font(Theme.mono(15)).foregroundStyle(theme.inkSecondary)
                            .padding(.leading, 12)
                            .allowsHitTesting(false)
                    }
                    .frame(width: 176)
                    InstructionsField(
                        placeholder: AppStrings.localized("What it does, in one line"),
                        text: Binding(get: { description }, set: { description = String($0.prefix(WrittenSkill.descriptionMax)) }),
                        identifier: "desktop-skills.command-description"
                    )
                    .accessibilityLabel(Text("What it does"))
                }
                PanelTextArea(
                    placeholder: LocalizedStringKey(instructionsText("What the bot should do. Use %@ for the text typed after the command.", "{input}")),
                    text: $instructions, minHeight: 96
                )
                .accessibilityLabel(Text("Instructions"))
                .accessibilityIdentifier("desktop-skills.command-instructions")
                HStack(spacing: 12) {
                    DesktopText(verbatim: touched ? problem.map(Self.problemText) ?? message : message, size: 11.5, line: 16, color: \.inkSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityIdentifier("desktop-skills.command-message")
                    saveButton(identifier: keyboardUp ? "desktop-skills.command-save-inline" : "desktop-skills.command-save")
                }
                if !error.isEmpty {
                    DesktopText(verbatim: error, size: 12, line: 16, color: \.danger)
                }
            }
        }
        .toolbar {
            // Same control above the software keyboard so a tap never lands
            // on the keys that covered the in-card Save (#1939).
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                saveButton(identifier: keyboardUp ? "desktop-skills.command-save" : "desktop-skills.command-save-keyboard")
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { note in
            guard let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
            keyboardHeight = max(0, UIScreen.main.bounds.height - frame.minY)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            keyboardHeight = 0
        }
    }

    private func saveButton(identifier: String) -> some View {
        Button(saving ? AppStrings.localized("Saving…") : AppStrings.localized("Save command")) {
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            Task { await save() }
        }
        .buttonStyle(pillStyle(primary: true))
        .disabled(saving || problem != nil)
        .accessibilityIdentifier(identifier)
    }

    static func problemText(_ problem: WrittenSkill.Problem) -> String {
        switch problem {
        case .name: AppStrings.localized("Use lowercase letters, numbers, and single dashes for the name.")
        case .reserved: AppStrings.localized("That name is taken by a built-in command.")
        case .taken: AppStrings.localized("This bot already has a skill with that name.")
        case .description: AppStrings.localized("Add a one-line description.")
        case .instructions: AppStrings.localized("Add the instructions the bot should follow.")
        }
    }

    private func save() async {
        guard problem == nil, !saving, let client = session.profileClient else { return }
        saving = true
        error = ""
        message = ""
        defer { saving = false }
        let command = name.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try await client.saveWrittenCommand(botId: bot.id, name: command, description: description, instructions: instructions)
            message = instructionsText("Saved. Type /%@ in a chat with this bot to run it.", command)
            name = ""
            description = ""
            instructions = ""
            await saved()
        } catch {
            self.error = error.localizedDescription.isEmpty ? AppStrings.localized("Could not save that command.") : error.localizedDescription
        }
    }
}
