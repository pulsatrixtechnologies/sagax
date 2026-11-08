// Create New Bot (reference 20 / lot 7, 2026-11-01): a floating card over
// the dimmed home with a live preview of the character, "Name your Bot",
// the Character editor, and a Create capsule that stays grey until there
// is a name. The "+" menu opens this first (three gestures to a named
// bot). Guided / Manual / templates / imports / drafts sit under
// "Other ways to start". Geometry from measure-home.md §5, relative to
// the card (x 8-394, y 123.7-865.7).
//
// More options (WP13, matrix rows NB2-NB4): below the fold of the
// character editor, so the card the reference shows is unchanged, a row
// opens the desktop New bot dialog's Identity fields: the starting role
// (the organization's and imported presets, then the built-in roles), the
// team, the title, the description and the standing instructions. A person
// who may only use shared bots gets the desktop's notice instead (NB6).
import SwiftUI
import UIKit
import CompanionCore

struct CreateBotSheet: View {
    @Environment(\.themePalette) var themePalette
    /// The team a "New bot here" on a team's header starts in (NB3).
    var section: String?
    let close: () -> Void
    let created: (Bot) -> Void
    /// Off when the wizard itself opened this form (its former
    /// "Start from a template"); hides Other ways that loop back.
    var showsWizard = true

    init(section: String? = nil, close: @escaping () -> Void, showsWizard: Bool = true, created: @escaping (Bot) -> Void) {
        self.section = section
        self.close = close
        self.showsWizard = showsWizard
        self.created = created
        _options = State(initialValue: NewBotFormOptions(section: section))
    }

    @EnvironmentObject private var session: Session
    @State private var options: NewBotFormOptions
    @State private var showingOptions = false
    /// "Import from zip" (#271).
    @State private var importingZip = false
    /// "Import from x.ai bot" (desktop AgentImport.tsx).
    @State private var importingAgent = false
    /// Browse templates sheet (when the gate allows).
    @State private var browsingTemplates = false
    @State private var presets: [BotPreset] = []
    /// Open wizard drafts the person can resume (lot 7).
    @State private var drafts: [WizardDraft] = []
    @State private var otherWaysExpanded = false
    /// The administrator lets this person use shared bots only (NB6).
    @State private var readOnly = false
    @State private var name = ""
    @State private var draft = CharacterDraft()
    @State private var unlocks: MascotUnlocks = .lockedUntilLoaded
    @State private var creating = false
    @FocusState private var nameFocused: Bool
    /// How far the keyboard reaches up from the bottom of the screen, 0 when down.
    @State private var keyboardHeight: CGFloat = 0

    /// Card top on the 874 pt screen; the card ends 8 pt above the bottom.
    static let cardTop: CGFloat = 123.67
    private static let cardRadius: CGFloat = Theme.continuous(36)

    /// The parity harness's pasted reply (DEBUG `-parityScreen create-bot-import`).
    private static var parityReply: String {
        #if DEBUG
        if ParityLaunch.current?.screen == .createBotImport {
            return #"{"format":"openmaus.grok/1","name":"Scout","description":"Finds leads.","instructions":"Find five new leads every weekday.","skills":[{"name":"lead-research","description":"Research a company","body":"Read the site."}],"routines":[{"name":"Morning leads","schedule":"Weekdays at 9am","cron":"0 9 * * 1-5","timeZone":"America/Toronto","prompt":"Find five leads."},{"name":"On reply","schedule":"When a lead replies by email","cron":"","timeZone":"","prompt":"Summarise the reply."}],"plugins":["Gmail"],"memories":[]}"#
        }
        #endif
        return ""
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canCreate: Bool { !trimmedName.isEmpty && !creating }

    var body: some View {
        ZStack(alignment: .top) {
            Theme.dim
                .ignoresSafeArea()
                .onTapGesture { if !creating { close() } }
            Group {
                if readOnly { readOnlyCard } else { card }
            }
                .padding(.horizontal, Theme.Metric.sheetInset)
                .padding(.top, Self.cardTop)
                .padding(.bottom, Theme.Metric.sheetInset)
                .ignoresSafeArea(edges: [.top, .bottom])
            keyboardCreate
        }
        // The card never moves for the keyboard (reference 20 is the card
        // with the keyboard down); while it is up, `keyboardCreate` rides on it.
        .ignoresSafeArea(.keyboard)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { note in
            guard let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
            let screen = (UIApplication.shared.connectedScenes.first as? UIWindowScene)?.screen.bounds.height ?? frame.maxY
            keyboardHeight = max(0, screen - frame.minY)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            keyboardHeight = 0
        }
        .task {
            #if DEBUG
            if ParityLaunch.current?.screen == .createBotImport { importingAgent = true }
            #endif
            if session.isDemo { unlocks = .demo }
            readOnly = NewBotRules.readOnly(await session.configStatus())
            presets = await session.botPresets()
            if showsWizard, let client = session.profileClient {
                drafts = (try? await client.wizardDrafts()) ?? []
            }
            if !session.isDemo, session.surfaceGate.allows(.characterExtras), session.surfaceGate.allows(.achievements),
               let client = session.profileClient, let earned = try? await client.mascotUnlocks() {
                unlocks = earned
            }
        }
        .sheet(isPresented: $importingZip) {
            BotZipImportSheet(close: { importingZip = false }) { bot in
                importingZip = false
                if let bot { created(bot) } else { close() }
            }
        }
        .sheet(isPresented: $importingAgent) {
            AgentImportSheet(close: { importingAgent = false }, imported: { bot in
                importingAgent = false
                if let bot { created(bot) } else { close() }
            }, initialReply: Self.parityReply)
        }
        .sheet(isPresented: $browsingTemplates) {
            BrowseBotsSheet { browsingTemplates = false }
                .environmentObject(session)
        }
        .sheet(isPresented: $showingOptions) {
            NewBotOptionsForm(
                options: $options, name: $name, draft: $draft, presets: presets,
                showsTeam: session.surfaceGate.allows(.createBotTeam),
                teams: NewBotRules.teams(sections: session.state.sectionOrder, bots: session.state.bots)
            )
        }
    }

    /// The desktop's BotsReadOnlyDialog: why, and Close, never the form.
    private var readOnlyCard: some View {
        VStack(spacing: 0) {
            header
            Spacer()
            Text("Your administrator lets you use shared bots only.")
                .font(Theme.Font.body)
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .accessibilityIdentifier("create-bot-read-only")
            Spacer()
            Button(action: close) {
                Text("Close")
                    .font(.system(size: 13.5, weight: .semibold))
                    .foregroundStyle(Theme.primaryInk)
                    .frame(maxWidth: .infinity)
                    .frame(height: 42.67)
                    .background(Theme.primaryFill, in: Capsule())
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 28.67)
            .padding(.bottom, 28.33)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Theme.bg, in: RoundedRectangle(cornerRadius: Self.cardRadius, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: Self.cardRadius, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("create-bot-sheet")
    }

    /// Lot 7: Guided, Manual, templates, imports and drafts under one
    /// disclosure so the first screen stays the quick create.
    private var otherWaysSection: some View {
        DisclosureGroup(isExpanded: $otherWaysExpanded) {
            VStack(spacing: 0) {
                otherWayRow(
                    title: String(localized: "Guided with my bot"),
                    hint: String(localized: "Your bot asks the questions and fills each step live."),
                    icon: "bubble.left.and.bubble.right",
                    id: "guided"
                ) {
                    close()
                    BotWizardPresenter.shared.open(startMode: .guided)
                }
                Divider().padding(.leading, 46)
                otherWayRow(
                    title: String(localized: "I'll fill it in myself"),
                    hint: String(localized: "The same steps as a form, page by page."),
                    icon: "list.bullet.clipboard",
                    id: "manual"
                ) {
                    close()
                    BotWizardPresenter.shared.open(startMode: .manual)
                }
                if BotTemplatesEntry.destination(gate: session.surfaceGate) != nil {
                    Divider().padding(.leading, 46)
                    otherWayRow(
                        title: String(localized: "Browse templates"),
                        hint: nil,
                        icon: "books.vertical",
                        id: "browse"
                    ) {
                        nameFocused = false
                        browsingTemplates = true
                    }
                }
                Divider().padding(.leading, 46)
                otherWayRow(
                    title: String(localized: "Import from Grok Bot or Claude Code"),
                    hint: nil,
                    icon: "square.and.arrow.down",
                    id: "import-agent"
                ) {
                    nameFocused = false
                    importingAgent = true
                }
                Divider().padding(.leading, 46)
                otherWayRow(
                    title: String(localized: "Import a zip file"),
                    hint: nil,
                    icon: "doc.zipper",
                    id: "import-zip"
                ) {
                    nameFocused = false
                    importingZip = true
                }
                if !drafts.isEmpty {
                    Divider().padding(.leading, 46)
                    ForEach(drafts, id: \.botId) { entry in
                        otherWayRow(
                            title: entry.botName?.isEmpty == false ? entry.botName! : String(localized: "New bot"),
                            hint: String(localized: "Draft to finish"),
                            icon: "doc.badge.clock",
                            id: "draft-\(entry.botId)"
                        ) {
                            close()
                            BotWizardPresenter.shared.open(botId: entry.botId)
                        }
                    }
                }
            }
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.continuous(15.5), style: .continuous))
            .padding(.top, 8)
        } label: {
            Text("Other ways to start")
                .font(Theme.Font.bodyMedium)
                .foregroundStyle(Theme.textPrimary)
        }
        .padding(.horizontal, 15.33)
        .padding(.bottom, 16)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("create-bot-other-ways")
    }

    private func otherWayRow(title: String, hint: String?, icon: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .foregroundStyle(Theme.textSecondary)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.textPrimary)
                    if let hint {
                        Text(hint)
                            .font(Theme.Font.preview)
                            .foregroundStyle(Theme.textSecondary)
                            .multilineTextAlignment(.leading)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textTertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("create-bot-other-\(id)")
    }

    /// Below the editor's first screen: the reference's card never shows it;
    /// the scroll indicator flashes once so the person knows there is more.
    private var moreOptionsRow: some View {
        Button {
            nameFocused = false
            showingOptions = true
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "slider.horizontal.3")
                    .foregroundStyle(Theme.textSecondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text("More options")
                        .font(Theme.Font.bodyMedium)
                        .foregroundStyle(Theme.textPrimary)
                    Text(options.summary)
                        .font(Theme.Font.preview)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textTertiary)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 52)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.continuous(15.5), style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 15.33)
        .padding(.bottom, 16)
        .accessibilityIdentifier("create-bot-more-options")
    }

    /// The keyboard covers the card's Create capsule: while it is up, the same
    /// capsule sits just above it, so a name can be confirmed without first
    /// dismissing the keyboard (the return key creates too).
    @ViewBuilder
    private var keyboardCreate: some View {
        if keyboardHeight > 0 && nameFocused {
            VStack {
                Spacer(minLength: 0)
                capsule(identifier: "create-bot-submit-keyboard")
                    .padding(.horizontal, Theme.Metric.sheetInset + 28.67)
                    .padding(.bottom, keyboardHeight + 10)
            }
            .ignoresSafeArea()
            .transition(.opacity)
        }
    }

    private var card: some View {
        VStack(spacing: 0) {
            header
            MascotCharacterView(look: draft.complete, color: draft.color, skin: draft.skin, size: 142, animated: true)
                .frame(width: 142, height: 142)
                .padding(.top, 120.1 - 59.6)
                .accessibilityHidden(true)
            nameField
                .padding(.top, 321.6 - 262.1)
            GeometryReader { box in
                ScrollView {
                    VStack(spacing: 0) {
                        CharacterEditor(draft: $draft, metrics: .createSheet, unlocks: session.isDemo ? .demo : unlocks)
                            .padding(.bottom, 12)
                            .frame(minHeight: box.size.height, alignment: .top)
                        moreOptionsRow
                        if showsWizard, !readOnly {
                            otherWaysSection
                        }
                    }
                }
                .modifier(FlashScrollIndicators())
            }
            .frame(maxHeight: .infinity)
            createButton
                .padding(.horizontal, 28.67)
                .padding(.bottom, 28.33)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Theme.bg, in: RoundedRectangle(cornerRadius: Self.cardRadius, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: Self.cardRadius, style: .continuous))
        .onTapGesture { nameFocused = false }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("create-bot-sheet")
    }

    private var header: some View {
        HStack(spacing: 14.7) {
            GlassCircleButton(systemImage: "xmark", size: .sheet, accessibilityLabel: "Close") { close() }
            Text("Create New Bot")
                .font(HomeMetrics.name)
                .foregroundStyle(Theme.textPrimary)
            Spacer()
        }
        .padding(.leading, 17.33)
        .padding(.trailing, 17.33)
        .padding(.top, 17.33)
        .frame(height: 59.6, alignment: .top)
    }

    private var nameField: some View {
        ZStack {
            if name.isEmpty {
                Text("Name your Bot")
                    .font(.system(size: 17.5, weight: .medium))
                    .foregroundStyle(Theme.parity(Color(hex: 0x5E5E60), Theme.placeholder))
                    .allowsHitTesting(false)
            }
            TextField("", text: $name)
                .font(.system(size: 17.5, weight: .medium))
                .foregroundStyle(Theme.textPrimary)
                .multilineTextAlignment(.center)
                .tint(Theme.caret)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .focused($nameFocused)
                // The return key creates. On iOS 27 a create run inside the
                // submit callback itself does nothing (the keyboard is still
                // handling its key); one main-actor turn later it creates.
                .onSubmit { Task { @MainActor in await Task.yield(); create() } }
                .accessibilityLabel(Text("Name your Bot"))
                .accessibilityIdentifier("create-bot-name")
        }
        .padding(.horizontal, 16)
        .frame(height: 47.33)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.continuous(15.5), style: .continuous))
        .padding(.horizontal, 15.33)
    }

    private var createButton: some View { capsule(identifier: "create-bot-submit") }

    private func capsule(identifier: String) -> some View {
        Button(action: create) {
            ZStack {
                if creating {
                    ProgressView().tint(Theme.disabledCapsuleText)
                } else {
                    Text("Create")
                        .font(.system(size: 13.5, weight: .semibold))
                        .foregroundStyle(canCreate ? Theme.primaryInk : Theme.disabledCapsuleText)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 42.67)
            .background(canCreate ? Theme.primaryFill : Theme.parity(Color(hex: 0x9A9A9A), Theme.disabledCapsule), in: Capsule())
            .overlay(
                Capsule().strokeBorder(
                    LinearGradient(colors: [Theme.parity(Color(hex: 0xD7D7D7), Theme.hairline), Theme.parity(Color(hex: 0x9A9A9A), Theme.disabledCapsule), Theme.parity(Color(hex: 0xCECECE), Theme.hairline)], startPoint: .top, endPoint: .bottom),
                    lineWidth: 1
                )
            )
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        // not `.disabled`: that dims the grey capsule below the reference's
        .allowsHitTesting(canCreate)
        .accessibilityIdentifier(identifier)
    }

    private func create() {
        guard canCreate else { return }
        creating = true
        nameFocused = false
        let request = options.draft(name: trimmedName, look: draft)
        Task {
            let bot = await session.createBot(request)
            creating = false
            if let bot {
                Haptics.success()
                created(bot)
            }
        }
    }
}

// MARK: - More options (WP13)

/// What More options holds until Create. A starting role marks its fields
/// as chosen, so they are sent even when it leaves one empty (as the
/// desktop's draft does); otherwise only what the person typed is sent and
/// the server's New bot defaults fill the rest.
struct NewBotFormOptions: Equatable {
    var title = ""
    var description = ""
    var soul = ""
    /// nil: untouched; "" is General.
    var section: String?
    var preset: BotPreset?
    var roleChosen = false
    var mascotBody: String?
    var mascotExpression: String?

    init(section: String? = nil) { self.section = section }

    /// The row's second line: the chosen preset, else the team.
    var summary: String {
        var parts: [String] = []
        if let preset { parts.append(preset.name) }
        if let section, !section.isEmpty { parts.append(section) }
        if !title.isEmpty { parts.append(title) }
        return parts.isEmpty ? String(localized: "Starting role, team, title, instructions") : parts.joined(separator: " · ")
    }

    func draft(name: String, look: CharacterDraft) -> NewBotDraft {
        func value(_ text: String, trim: Bool) -> String? {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { return roleChosen ? "" : nil }
            return trim ? trimmed : text
        }
        return NewBotDraft(
            name: name, color: look.color, look: look.look, skin: look.skin,
            title: value(title, trim: true), description: value(description, trim: false),
            soul: value(soul, trim: false), section: section, preset: preset?.id,
            mascotBody: mascotBody, mascotExpression: mascotExpression
        )
    }

    /// `StartingRole.choose`: a preset or a built-in role fills the form;
    /// "Custom settings" forgets the preset and keeps what is there.
    mutating func choose(preset: BotPreset, name: inout String, look: inout CharacterDraft) {
        apply(NewBotRules.fill(preset), name: &name, look: &look)
        self.preset = preset
        if preset.bot.appearance != nil {
            mascotExpression = preset.bot.appearance?.mascotExpression
            if let body = preset.bot.appearance?.mascotBody { mascotBody = body }
        }
    }

    mutating func choose(role: BotRole, name: inout String, look: inout CharacterDraft) {
        preset = nil
        apply(NewBotRules.fill(role), name: &name, look: &look)
    }

    mutating func chooseCustom() { preset = nil }

    private mutating func apply(_ fill: NewBotRoleFill, name: inout String, look: inout CharacterDraft) {
        name = fill.name
        title = fill.title
        description = fill.description
        soul = fill.soul
        roleChosen = true
        if let color = fill.color, MausColors.hex[color] != nil { look.color = color }
    }
}

/// The desktop New bot dialog's Identity section for one new bot: starting
/// role (and what the preset adds), team, title, description, and the
/// standing instructions from its Soul section. Theme tokens throughout,
/// a plain Form so any width (iPhone sheet, iPad shells) lays it out.
struct NewBotOptionsForm: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.dismiss) private var dismiss
    @Binding var options: NewBotFormOptions
    @Binding var name: String
    @Binding var draft: CharacterDraft
    let presets: [BotPreset]
    let showsTeam: Bool
    let teams: [String]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    roleMenu
                    if let preset = options.preset {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(Array(NewBotRules.summary(preset).enumerated()), id: \.offset) { _, line in
                                Text(Self.text(line))
                                    .font(Theme.Font.preview)
                                    .foregroundStyle(Theme.textSecondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("create-bot-preset-summary")
                    }
                }
                .listRowBackground(Theme.card)

                Section {
                    if showsTeam { teamMenu }
                    TextField("Title", text: limited(\.title, NewBotRules.titleLimit), prompt: Text("Describe what your agent does"))
                        .accessibilityIdentifier("create-bot-title")
                    TextField("What this agent does", text: limited(\.description, NewBotRules.descriptionLimit), prompt: Text("One line on what this bot is for"), axis: .vertical)
                        .lineLimit(2...6)
                        .accessibilityIdentifier("create-bot-description")
                } footer: {
                    Text("Shown in rosters, on the phone, and to other bots. Standing instructions belong in Instructions, which has room for a full document.")
                }
                .listRowBackground(Theme.card)

                Section("Instructions") {
                    // the markdown editor (desktop SoulField in New bot, #258)
                    MarkdownEditor(
                        text: limited(\.soul, NewBotRules.soulLimit), placeholder: String(localized: "How this bot should work"),
                        minHeight: 160, maxLength: NewBotRules.soulLimit,
                        accessibilityLabel: String(localized: "Instructions"), identifier: "create-bot-instructions"
                    )
                }
                .listRowBackground(Theme.card)
            }
            .font(Theme.Font.body)
            .foregroundStyle(Theme.textPrimary)
            .tint(Theme.accent)
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle(String(localized: "More options"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .accessibilityIdentifier("create-bot-options-done")
                }
            }
        }
        .accessibilityIdentifier("create-bot-options")
    }

    private func limited(_ key: WritableKeyPath<NewBotFormOptions, String>, _ limit: Int) -> Binding<String> {
        Binding(
            get: { options[keyPath: key] },
            set: { options[keyPath: key] = String($0.prefix(limit)) }
        )
    }

    /// `<select>`: "Custom settings", each preset group, then the built-in
    /// roles (under their own heading only when there are presets). Like the
    /// desktop's, it reads "Custom settings" unless a preset is chosen.
    private var roleMenu: some View {
        Menu {
            Button(String(localized: "Custom settings")) { options.chooseCustom() }
            ForEach(NewBotRules.presetGroups(presets), id: \.label) { group in
                Section(Self.text(group.label)) {
                    ForEach(group.presets) { preset in
                        Button(preset.name) { options.choose(preset: preset, name: &name, look: &draft) }
                    }
                }
            }
            if presets.isEmpty {
                roleButtons
            } else {
                Section(String(localized: "Built-in roles")) { roleButtons }
            }
        } label: {
            LabeledContent(String(localized: "Starting role")) {
                Text(options.preset?.name ?? String(localized: "Custom settings"))
                    .foregroundStyle(Theme.textSecondary)
            }
            .contentShape(Rectangle())
        }
        .accessibilityIdentifier("create-bot-starting-role")
    }

    private var roleButtons: some View {
        ForEach(NewBotRules.builtInRoles) { role in
            Button(role.title) { options.choose(role: role, name: &name, look: &draft) }
        }
    }

    private var teamMenu: some View {
        Menu {
            Button(String(localized: "Unassigned")) { options.section = "" }
            ForEach(teams, id: \.self) { team in
                Button(team) { options.section = team }
            }
        } label: {
            LabeledContent(String(localized: "Team")) {
                Text(options.section.flatMap { $0.isEmpty ? nil : $0 } ?? String(localized: "Unassigned"))
                    .foregroundStyle(Theme.textSecondary)
            }
            .contentShape(Rectangle())
        }
        .accessibilityIdentifier("create-bot-team")
    }

    static func text(_ label: PresetGroupLabel) -> String {
        switch label {
        case let .organization(name): String(localized: "From \(name)")
        case .imported: String(localized: "Imported presets")
        }
    }

    static func text(_ line: PresetSummaryLine) -> String {
        switch line {
        case let .from(package, release): String(localized: "From \(package) \(release)")
        case let .fromOrganization(package, release, publisher): String(localized: "From \(package) \(release) · \(publisher)")
        case let .text(text): text
        case let .skills(names, on): on ? String(localized: "Skills, added switched on: \(names)") : String(localized: "Skills, added switched off: \(names)")
        case let .notes(names): String(localized: "Starter notes: \(names)")
        case let .playbooks(names): String(localized: "Playbooks: \(names)")
        case .keeps: String(localized: "The model, computer, approval level and connected apps stay as set here.")
        }
    }
}

/// The scroll indicator flashes once on appear where the system can (iOS 17).
private struct FlashScrollIndicators: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 17.0, *) {
            content.scrollIndicatorsFlash(onAppear: true)
        } else {
            content
        }
    }
}
