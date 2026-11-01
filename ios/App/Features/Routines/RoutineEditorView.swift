// "Edit routine" (matrix AU11-AU14), simplified 2026-10-29 as the desktop's
// EventEditor (src/components/RoutineCalendarPage.tsx): the name with a
// summary line under it (schedule, where results go, whom it runs as), then
// When (the schedule in words, or "When a webhook arrives" with the
// routine's own webhook), What (the instructions, simple, with Full screen,
// and attachments), Where results go (compact rows, help behind "?") and
// More options, folded, with its summary beside it. Nothing of before is
// lost: every setting is still here. Save and Cancel stay in the bar,
// "Not saved" shows a waiting change and closing over one asks first.
// The rules are RoutineScheduleForm, RoutineEditorRules and RoutinePatch
// (CompanionCore): an edit sends only what changed, so a field set
// elsewhere is never lost (S3).
import CompanionCore
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// What a new routine starts with when it comes from a calendar slot.
struct RoutineEditorSeed: Hashable {
    var at: Date
    var name = ""
    var prompt = ""
    var botId: String?
}

struct RoutineEditorView: View {
    @Environment(\.themePalette) var themePalette
    let routine: Routine?
    let onSaved: () async -> Void

    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var threadPrefs = SidebarPrefsModel.shared
    @State private var name: String
    @State private var prompt: String
    @State private var botId: String
    @State private var target: String
    @State private var groupId: String
    @State private var runOn: RoutineRunLocation
    @State private var runAvailability: RoutineRunAvailability?
    @State private var availabilityLoaded = false
    @State private var form: RoutineScheduleForm
    @State private var duration: Int
    @State private var timeoutMinutes: Int?
    @State private var intervalTimeoutDefaultApplied: Bool
    @State private var overlap: String
    @State private var results: RoutineResultsDestination
    @State private var attachments: [RoutineAttachment]
    @State private var attaching = 0
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var choosingFile = false
    @State private var moreExpanded: Bool
    @State private var saving = false
    /// Organization server: whom the routine may run as (RunAsField), and
    /// the person chosen here (nil: the routine's current person).
    @State private var runAsOptions: RoutineRunAsOptions?
    @State private var runAs: String?
    @State private var onlyWhenPresent: Bool
    @State private var postResults: Bool
    /// #1648: delete once a finite schedule ends.
    @State private var deleteWhenFinished: Bool
    /// 2026-10-26: failed runs in a row that pause it (0 never).
    @State private var autoPauseAfter: Int
    /// "Remember the last run" and the mail tag (desktop's More options).
    @State private var continuity: Bool
    @State private var mailAlias: String
    /// #1202 "Only when something changes": the draft, and the one it opened
    /// with (an untouched watch is never sent).
    @State private var watchDraft: RoutineWatchDraft
    private let initialWatch: RoutineWatchDraft
    /// What the editor opened with: "Not saved" while the fields differ.
    @State private var opened: RoutineEditorSnapshot?
    @State private var confirmingClose = false
    @State private var instructionsFullScreen = false
    /// The "?" of "Where results go": its help, one tap away.
    @State private var whereHelp = false
    /// The routine after "Create its webhook" (the page reloads on save).
    @State private var savedRoutine: Routine?

    /// `presetBotId`: a new routine made from a bot's profile starts on that bot.
    /// `seed`: a new routine from the Automations calendar ("More options"
    /// of a slot) starts at that slot with what was typed there.
    /// `copyOf` (Duplicate, 2026-10-29): a new routine with every setting of
    /// that one, named "<name> (copy)"; saving creates it.
    init(routine: Routine?, presetBotId: String? = nil, seed: RoutineEditorSeed? = nil, copyOf: Routine? = nil, onSaved: @escaping () async -> Void) {
        self.routine = routine
        self.onSaved = onSaved
        let source = routine ?? copyOf
        _name = State(initialValue: routine?.name ?? copyOf.map { String(localized: "\($0.name) (copy)") } ?? seed?.name ?? "")
        _prompt = State(initialValue: source?.prompt ?? seed?.prompt ?? "")
        _botId = State(initialValue: source?.botId ?? seed?.botId ?? presetBotId ?? "")
        _target = State(initialValue: source?.target ?? "bot")
        _groupId = State(initialValue: source?.groupId ?? "")
        _runOn = State(initialValue: source?.runLocation ?? .maus)
        let seedAt = source?.nextRunAt.map { Date(timeIntervalSince1970: $0 / 1_000) } ?? seed?.at ?? RoutineScheduleForm.nextHour()
        _form = State(initialValue: RoutineScheduleForm(schedule: source?.schedule, seedAt: seedAt))
        _duration = State(initialValue: source?.durationMinutes ?? 30)
        _timeoutMinutes = State(initialValue: source?.timeoutMinutes)
        _intervalTimeoutDefaultApplied = State(initialValue: source != nil)
        _overlap = State(initialValue: source?.overlap ?? "skip")
        _results = State(initialValue: routine == nil ? .newThread : .keep)
        _attachments = State(initialValue: source?.target == "room-goal" ? [] : source?.attachments ?? [])
        // read only, everything shows at once
        _moreExpanded = State(initialValue: Self.debugFlag("parityRoutineMoreOpen") || RoutineEditorRules.readOnly(routine) || Self.debugFlag("parityRoutineReadOnly"))
        _onlyWhenPresent = State(initialValue: source?.onlyWhenPresent == true)
        // Default silent for a new routine; an existing one keeps its choice.
        _postResults = State(initialValue: source?.postResults == true)
        _deleteWhenFinished = State(initialValue: source?.deleteWhenFinished == true)
        _autoPauseAfter = State(initialValue: source.map(RoutineAutoPause.after) ?? RoutineAutoPause.defaultAfter)
        _continuity = State(initialValue: source?.continuity == true)
        _mailAlias = State(initialValue: source?.mailAlias ?? "")
        let watch = RoutineWatchDraft(precheck: source?.precheck)
        initialWatch = watch
        _watchDraft = State(initialValue: watch)
    }

    private var advanced: Bool { session.surfaceGate.allows(.routineAdvancedEditor) }
    /// Someone else's routine (canEdit false or redacted): seen, not changed.
    /// DEBUG captures: `-parityRoutineReadOnly YES`.
    private var readOnly: Bool { RoutineEditorRules.readOnly(routine) || Self.debugFlag("parityRoutineReadOnly") }
    private var isTeamGoal: Bool { target == "room-goal" }
    /// As on the desktop: a bot routine that repeats on the clock.
    private var watchAllowed: Bool { RoutineWatchRules.allowed(target: target, repeats: form.recurrence.repeatsOnClock) }
    private var watchSection: some View {
        RoutineWatchSection(draft: $watchDraft, botId: botId, routineId: routine?.id,
                            runOn: isTeamGoal ? RoutineRunLocation.maus.rawValue : runOn.rawValue)
    }
    /// DEBUG captures only: `-parityRoutineWatchFirst YES` puts the watch on
    /// top, `-parityRoutineMoreOpen YES` opens More options,
    /// `-parityRoutineEditorScroll when|what|where|more` scrolls there.
    private static func debugFlag(_ key: String) -> Bool {
#if DEBUG
        UserDefaults.standard.bool(forKey: key)
#else
        false
#endif
    }
    private var watchFirst: Bool { Self.debugFlag("parityRoutineWatchFirst") }
    private var debugScroll: String? {
#if DEBUG
        UserDefaults.standard.string(forKey: "parityRoutineEditorScroll")
#else
        nil
#endif
    }
    private var watchEdit: Result<RoutineWatchEdit, RoutineWatchProblem> {
        RoutineWatchRules.edit(original: routine?.precheck, initial: initialWatch, draft: watchDraft, allowed: watchAllowed)
    }
    private var bots: [Bot] { session.state.bots.filter { $0.hidden != true } }
    private var rooms: [Room] { RoutineTeamGoal.rooms(session.state.rooms) }
    private var room: Room? { rooms.first { $0.id == groupId } }
    private var roomMembers: [Bot] { RoutineTeamGoal.members(of: room, bots: session.state.bots) }

    // MARK: Not saved

    private var snapshot: RoutineEditorSnapshot {
        RoutineEditorSnapshot(
            name: name, prompt: prompt, botId: botId, target: target, groupId: groupId, runOn: runOn.rawValue,
            form: form, durationMinutes: duration, timeoutMinutes: timeoutMinutes, overlap: overlap,
            results: results, attachmentIds: attachments.map(\.id), runAs: runAs, onlyWhenPresent: onlyWhenPresent,
            postResults: postResults, deleteWhenFinished: deleteWhenFinished, autoPauseAfter: autoPauseAfter, continuity: continuity, mailAlias: mailAlias,
            watch: watchDraft
        )
    }

    private var dirty: Bool { opened.map { snapshot.differs(from: $0) } ?? false }

    private func requestClose() {
        if dirty && !saving { confirmingClose = true } else { dismiss() }
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ThemedForm {
                    if watchFirst && watchAllowed { watchSection.disabled(readOnly) }
                    headerSection.disabled(readOnly)
                    whenSection.id("when")
                    if watchAllowed && !watchFirst { watchSection.disabled(readOnly) }
                    whatSection.disabled(readOnly).id("what")
                    whereSection.id("where")
                    moreSection.id("more")
                }
                .task {
                    guard let place = debugScroll else { return }
                    try? await Task.sleep(nanoseconds: 1_200_000_000)
                    proxy.scrollTo(place, anchor: .top)
                }
            }
            .navigationTitle(readOnly ? Text("Routine") : routine == nil ? Text("New routine") : Text("Edit routine"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) { titleView }
                if readOnly {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                            .accessibilityIdentifier("routine-editor-done")
                    }
                } else {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { requestClose() }
                            .accessibilityIdentifier("routine-editor-cancel")
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(saveLabel) { Task { await save() } }
                            .disabled(saving || attaching > 0 || !valid)
                            .accessibilityIdentifier("routine-editor-save")
                    }
                }
            }
            // a swipe down never loses a change: Cancel asks first
            .interactiveDismissDisabled(dirty)
            .confirmationDialog(String(localized: "Close without saving your changes?"), isPresented: $confirmingClose, titleVisibility: .visible) {
                Button(String(localized: "Close without saving"), role: .destructive) { dismiss() }
                    .accessibilityIdentifier("routine-editor-discard")
                Button(String(localized: "Keep editing"), role: .cancel) {}
            }
            .sheet(isPresented: $instructionsFullScreen) { instructionsSheet }
            .onAppear {
                if botId.isEmpty { botId = bots.first?.id ?? "" }
                if opened == nil { opened = snapshot }
            }
            .onValueChange(of: photoItems) { items in
                guard !items.isEmpty else { return }
                Task { await importPhotos(items) }
            }
            .fileImporter(isPresented: $choosingFile, allowedContentTypes: [.content], allowsMultipleSelection: true) { result in
                Task { await importFiles(result) }
            }
            .task {
                runAvailability = await session.loadRoutineRunAvailability()
                availabilityLoaded = true
            }
            // asked again when the bot, the routine type or the room changes
            .task(id: "\(botId)|\(target)|\(groupId)") { await loadRunAsOptions() }
        }
    }

    /// "Edit routine" and, while a change waits, "Not saved".
    private var titleView: some View {
        VStack(spacing: 1) {
            (readOnly ? Text("Routine") : routine == nil ? Text("New routine") : Text("Edit routine"))
                .font(.headline)
                .lineLimit(1)
            if dirty {
                HStack(spacing: 4) {
                    Circle().fill(Theme.accent).frame(width: 5, height: 5)
                    Text("Not saved")
                }
                .font(.caption2.weight(.medium))
                .foregroundStyle(Theme.accentText)
                .accessibilityElement(children: .combine)
                .accessibilityHint(Text("You have unsaved changes."))
                .accessibilityIdentifier("routine-editor-unsaved")
            }
        }
    }

    // MARK: Runs as (organization server)

    private func loadRunAsOptions() async {
        guard !botId.isEmpty, let client = session.callClient else { runAsOptions = nil; return }
        let options = try? await client.routineRunAsOptions(
            botId: botId,
            routineId: routine?.id,
            target: target,
            groupId: isTeamGoal && !groupId.isEmpty ? groupId : nil
        )
        guard !Task.isCancelled else { return }
        runAsOptions = options
        // a person who cannot run the newly chosen bot is no longer the choice
        runAs = RoutineRunAsField.keep(runAs, in: options)
        // the first answer is the state the editor opened with
        if let opened, opened.runAs == nil, !dirtyExcludingRunAs { self.opened?.runAs = runAs }
    }

    private var dirtyExcludingRunAs: Bool {
        guard var base = opened else { return false }
        base.runAs = runAs
        return snapshot.differs(from: base)
    }

    // MARK: Header: the name and the summary line

    private var headerSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                TextField("Routine name", text: $name)
                    .font(.title3.weight(.semibold))
                    .accessibilityIdentifier("routine-editor-name")
                let line = summaryLine
                if !line.isEmpty {
                    Text(verbatim: line)
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("routine-editor-headline")
                }
            }
            .padding(.vertical, 4)
        }
    }

    /// "Every weekday at 9:00 AM · Results in the conversation · As Alex".
    /// 2026-10-29: a bot routine reports into the bot's one conversation.
    private var summaryLine: String {
        let scheduleText = (try? form.schedule(savedAt: Date())).map(RoutineWording.compact)
        let place: String?
        if isTeamGoal {
            place = room?.name
        } else {
            place = postResults ? String(localized: "Results in the conversation") : nil
        }
        let person = runAsName.map { String(localized: "As \($0)") }
        return RoutineEditorRules.summary(schedule: scheduleText, results: place, runAs: person)
    }

    private var runAsName: String? {
        guard let options = runAsOptions, let chosen = RoutineRunAsField.chosen(options, selected: runAs) else { return nil }
        let name = RoutineRunAsField.name(chosen)
        return name.isEmpty ? nil : name
    }

    // MARK: When

    private var whenSection: some View {
        Section {
            Picker("Repeats", selection: Binding(get: { form.recurrence }, set: selectRecurrence)) {
                ForEach(RoutineEditorRules.repeatChoices(current: form.recurrence, teamGoal: isTeamGoal), id: \.self) { choice in
                    Text(verbatim: Self.repeatLabel(choice)).tag(choice)
                }
            }
            .accessibilityIdentifier("routine-editor-repeat")
            .disabled(readOnly)
            switch form.recurrence {
            case .webhook:
                RoutineWebhookPanel(
                    routine: (savedRoutine ?? routine).flatMap { $0.schedule.type == .webhook ? $0 : nil },
                    bot: session.state.bot(botId),
                    onRoutineChanged: { savedRoutine = $0 }
                )
            case .email:
                Text("Starts when an email arrives at the bot’s address.")
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
            default:
                Group {
                    RoutineScheduleFields(form: $form)
                    if form.recurrence.repeatsOnClock { RoutineTimingFields(form: $form) }
                }
                .disabled(readOnly)
            }
            if let problem = form.problem {
                Text(verbatim: RoutineEditorWording.problem(problem))
                    .font(.footnote)
                    .foregroundStyle(Theme.danger)
                    .accessibilityIdentifier("routine-editor-problem")
            }
        } header: {
            Label("When", systemImage: "clock")
        } footer: {
            if !form.recurrence.isTrigger {
                Text("Runs while Sagax is open on this computer: it cannot wake a sleeping Mac. A run missed by less than 12 hours still happens when the app is back; for 24/7, run Sagax on a VPS.")
            }
        }
    }

    static func repeatLabel(_ choice: RoutineRecurrence) -> String {
        switch choice {
        case .none: String(localized: "Does not repeat")
        case .hourly: String(localized: "Every hour")
        case .daily: String(localized: "Every day")
        case .weekdays: String(localized: "Weekdays")
        case .days: String(localized: "Certain days")
        case .monthly: String(localized: "Every month")
        case .yearly: String(localized: "Every year")
        case .interval: String(localized: "Every N minutes or hours")
        case .advanced: String(localized: "Advanced")
        case .webhook: String(localized: "When a webhook arrives")
        case .email: String(localized: "When email arrives")
        }
    }

    // MARK: What

    @ViewBuilder
    private var whatSection: some View {
        Section {
            if advanced {
                Picker(String(localized: "Routine type"), selection: Binding(get: { target }, set: selectTarget)) {
                    Text("Bot task").tag("bot")
                    Text("Team goal").tag("room-goal")
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("routine-editor-type")
            }
            if isTeamGoal {
                if rooms.isEmpty {
                    Text("Create a group from the sidebar first, then come back to schedule its goal.")
                        .font(.footnote).foregroundStyle(Theme.textSecondary)
                } else {
                    Picker(String(localized: "Choose a group"), selection: Binding(get: { groupId }, set: selectRoom)) {
                        Text("Select a group").tag("")
                        ForEach(rooms) { room in Text(verbatim: room.name).tag(room.id) }
                    }
                    .accessibilityIdentifier("routine-editor-group")
                }
                if room != nil {
                    if roomMembers.isEmpty {
                        Text("This group has no active members. Add or restore a bot before scheduling the goal.")
                            .font(.footnote).foregroundStyle(Theme.warning)
                    } else {
                        Picker(String(localized: "Choose the lead"), selection: $botId) {
                            ForEach(roomMembers) { bot in Text(verbatim: bot.name).tag(bot.id) }
                        }
                        .accessibilityIdentifier("routine-editor-lead")
                    }
                }
            } else {
                Picker("Agent", selection: Binding(get: { botId }, set: selectBot)) {
                    Text("Choose an agent").tag("")
                    ForEach(bots) { bot in Text(bot.name).tag(bot.id) }
                }
                .accessibilityIdentifier("routine-editor-agent")
            }
            // the markdown editor, simple: writing straight away, Preview one
            // tap away, Full screen for long instructions
            MarkdownEditor(
                text: $prompt,
                placeholder: instructionsPlaceholder,
                minHeight: 120, accessibilityLabel: String(localized: "Instructions"), identifier: "routine-editor-prompt",
                compact: true, onExpand: { instructionsFullScreen = true }
            )
            if advanced && session.surfaceGate.allows(.routineAttachments) { attachmentRows }
        } header: {
            Label("What", systemImage: "doc.text")
        } footer: {
            if advanced && session.surfaceGate.allows(.routineAttachments) {
                Text(isTeamGoal
                     ? "Team goals cannot carry routine attachments. Put shared context in the goal instructions or the group instructions."
                     : "Attachments are passed to each local routine run and excluded from shared team files.")
            } else if advanced {
                Text(isTeamGoal ? "A lead coordinates the group until the goal settles." : "One bot owns and completes each run.")
            }
        }
    }

    private var instructionsPlaceholder: String {
        isTeamGoal ? String(localized: "What should the team accomplish?") : String(localized: "What should the agent do?")
    }

    /// Long instructions get the whole screen, with every markdown tool.
    private var instructionsSheet: some View {
        NavigationStack {
            MarkdownEditor(
                text: $prompt,
                placeholder: instructionsPlaceholder,
                minHeight: 320, accessibilityLabel: String(localized: "Instructions"), identifier: "routine-editor-prompt-full"
            )
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .frame(maxHeight: .infinity, alignment: .top)
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(Text("Instructions"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { instructionsFullScreen = false }
                        .accessibilityIdentifier("routine-editor-prompt-done")
                }
            }
        }
    }

    @ViewBuilder
    private var attachmentRows: some View {
        if !isTeamGoal {
            ForEach(attachments, id: \.id) { attachment in
                Label(attachment.name, systemImage: attachment.kind == "image" ? "photo" : "doc.text")
                    .lineLimit(1)
                    .swipeActions {
                        Button(String(localized: "Remove"), role: .destructive) { remove(attachment) }
                    }
                    .contextMenu {
                        Button(String(localized: "Remove \(attachment.name)"), systemImage: "xmark", role: .destructive) { remove(attachment) }
                    }
                    .accessibilityIdentifier("routine-editor-attachment.\(attachment.name)")
            }
            if attaching > 0 {
                ProgressView(String(localized: "Attaching…"))
            }
            if attachments.count < 20 {
                Menu {
                    PhotosPicker(selection: $photoItems, maxSelectionCount: 20 - attachments.count, matching: .images) {
                        Label("Photo Library", systemImage: "photo.on.rectangle")
                    }
                    Button(String(localized: "Choose File"), systemImage: "doc") { choosingFile = true }
                } label: {
                    Label("Add attachment", systemImage: "paperclip")
                }
                .accessibilityIdentifier("routine-editor-add-attachment")
            }
        }
    }

    // MARK: Where results go

    private var whereSection: some View {
        Section {
            // someone else's routine says whose it is
            if let owner = routine?.foreignOwnerName {
                LabeledContent(String(localized: "Owner"), value: owner)
                    .accessibilityIdentifier("routine-editor-owner")
            }
            Group {
                if RoutineRunAsField.shown(runAsOptions) { runAsRows }
                runOnRows
            }
            .disabled(readOnly)
        } header: {
            HStack {
                Label("Where results go", systemImage: "paperplane")
                Spacer(minLength: 8)
                Button {
                    withAnimation { whereHelp.toggle() }
                } label: {
                    Image(systemName: whereHelp ? "questionmark.circle.fill" : "questionmark.circle")
                        .imageScale(.medium)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(Text(whereHelp ? "Hide help" : "Help"))
                .accessibilityIdentifier("routine-editor-where-help")
            }
        } footer: {
            if whereHelp { whereHelpText }
        }
    }

    @ViewBuilder
    private var whereHelpText: some View {
        VStack(alignment: .leading, spacing: 6) {
            if advanced && !isTeamGoal {
                Text("Each run starts with fresh context. Dated results collect in the bot's main thread; full execution details stay in Run logs.")
            }
            if runAsOptions?.canChoose == true {
                Text("The routine acts with this person's access and their rights on the bot. Every change is recorded in the admin activity log.")
            }
            if isTeamGoal {
                Text("Sagax keeps the group and its member hand-offs together for the full goal.")
            } else if runOn == .maus {
                Text("Uses this agent's selected model and computer setting on the paired computer.")
            } else if runAvailability?.cloudReady == true {
                Text("Runs the agent and its tools inside its Boat virtual machine. The VM wakes automatically for each run; keep Sagax running so its scheduler can launch the job.")
            } else {
                Text("This existing Cloud VM choice is preserved, but it cannot run until the paired computer has a configured Boat API key and an available Boat agent.")
            }
        }
        .accessibilityIdentifier("routine-editor-where-help-text")
    }

    @ViewBuilder
    private var runAsRows: some View {
        if let options = runAsOptions {
            let chosen = RoutineRunAsField.chosen(options, selected: runAs)
            let name = chosen.map(RoutineRunAsField.name) ?? ""
            if options.canChoose {
                NavigationLink {
                    RoutineRunAsPicker(options: options, selected: $runAs)
                } label: {
                    HStack(spacing: 10) {
                        Text("Runs as")
                        Spacer(minLength: 8)
                        PersonAvatar(initials: People.initials(name.isEmpty ? "?" : name), size: 22, avatarUrl: chosen?.avatarUrl)
                        Text(verbatim: name).foregroundStyle(Theme.textSecondary).lineLimit(1)
                    }
                }
                .accessibilityIdentifier("routine-editor-run-as")
            } else {
                HStack(spacing: 10) {
                    Text("Runs as")
                    Spacer(minLength: 8)
                    PersonAvatar(initials: People.initials(name.isEmpty ? "?" : name), size: 22, avatarUrl: chosen?.avatarUrl)
                    Text(verbatim: name).foregroundStyle(Theme.textSecondary).lineLimit(1)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("routine-editor-run-as-line")
            }
            if chosen?.pending == true {
                Text(String(localized: "Will run once \(name) signs in"))
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("routine-editor-run-as-pending")
            }
        }
    }

    @ViewBuilder
    private var runOnRows: some View {
        if isTeamGoal {
            LabeledContent(String(localized: "Runs on")) {
                Text("This computer")
            }
        } else {
            Picker("Runs on", selection: $runOn) {
                Label("This computer", systemImage: "laptopcomputer")
                    .tag(RoutineRunLocation.maus)
                Label("Cloud VM", systemImage: "cloud")
                    .tag(RoutineRunLocation.cloud)
                    .rowSelectionDisabled(!cloudSelectable)
            }
            .accessibilityIdentifier("routine-editor-run-on")
            if !availabilityLoaded {
                ProgressView("Checking Cloud VM availability…")
            } else if runAvailability == nil {
                Label("Cloud VM status is unavailable", systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
    }

    // MARK: More options

    private var moreSummary: String {
        RoutineEditorRules.moreSummary(timeoutMinutes: timeoutMinutes, overlap: overlap, recurrence: form.recurrence).map { part in
            switch part {
            case .noLimit: String(localized: "No time limit")
            case let .limit(minutes): String(localized: "Stops after \(RoutineDurations.label(minutes))")
            case .overlapSkip: String(localized: "Skip this occurrence")
            case .overlapQueue: String(localized: "Queue one run")
            }
        }.joined(separator: " · ")
    }

    private var moreSection: some View {
        Section {
            DisclosureGroup(isExpanded: $moreExpanded) {
                moreFields.disabled(readOnly)
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text("More options")
                    Text(verbatim: moreSummary)
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("routine-editor-more-summary")
                }
            }
            .accessibilityIdentifier("routine-editor-advanced")
        }
    }

    @ViewBuilder
    private var moreFields: some View {
                Picker("Stop if still running after", selection: $timeoutMinutes) {
                    Text("No limit").tag(nil as Int?)
                    ForEach(RoutineDurations.options, id: \.self) { minutes in
                        Text(RoutineDurations.label(minutes)).tag(Optional(minutes))
                    }
                }
                .accessibilityIdentifier("routine-editor-timeout")
                moreHelp("Optional. The clock starts when work actually begins and does not control how often the routine starts.")
                if advanced && form.recurrence.repeatsOnClock {
                    Picker(String(localized: "If the previous run is still working"), selection: $overlap) {
                        Text("Skip this occurrence").tag("skip")
                        Text("Queue one run").tag("queue")
                    }
                    .accessibilityIdentifier("routine-editor-overlap")
                    moreHelp(overlap == "queue" ? "Keep one scheduled run waiting until this routine finishes. Skip further occurrences until it starts. Manual runs are separate." : "Skip scheduled occurrences while this routine is working. Manual runs are separate.")
                }
                // the person's own choice for their routine, no admin
                if form.recurrence.repeatsOnClock {
                    Picker(String(localized: "Pause automatically"), selection: $autoPauseAfter) {
                        ForEach(RoutineAutoPause.choices(keeping: autoPauseAfter), id: \.self) { count in
                            Text(verbatim: RoutineWording.autoPauseOption(count)).tag(count)
                        }
                    }
                    .accessibilityIdentifier("routine-editor-auto-pause")
                    moreHelp("When this many runs fail in a row, the routine pauses itself and tells you. Resume turns it back on and starts the count again. Failed runs stay in the history.")
                }
                if advanced {
                    Picker(String(localized: "Duration"), selection: $duration) {
                        ForEach(Set(RoutineDurations.options + [duration]).sorted(), id: \.self) { minutes in
                            Text(RoutineDurations.label(minutes)).tag(minutes)
                        }
                    }
                    .accessibilityIdentifier("routine-editor-duration")
                    moreHelp("Duration is how long the routine fills on the calendar.")
                }
                if !isTeamGoal && form.recurrence.repeatsOnClock {
                    toggle($continuity, "Remember the last run",
                           "Each run starts with the previous run's report, so the bot knows what it found last time. Good for checks like QA or monitoring.",
                           id: "routine-editor-continuity")
                }
                if !isTeamGoal {
                    toggle($onlyWhenPresent, "Only when I'm here",
                           "While you are away (computer idle or locked), this routine skips its runs and tells you how many when you are back. A one-time routine waits for you.",
                           id: "routine-editor-only-when-present")
                    if form.recurrence == .none || (form.recurrence == .interval && form.endsOnDate) {
                        toggle($deleteWhenFinished, "Delete once finished",
                               "When this routine has a known end (one time, or until a date), remove it from Automations after its last run settles. Past runs stay in the calendar and the run log.",
                               id: "routine-editor-delete-when-finished")
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        LabeledContent("Mail tag") {
                            TextField(String(localized: "reports"), text: Binding(get: { mailAlias }, set: { mailAlias = RoutineMailTag.clean($0) }))
                                .multilineTextAlignment(.trailing)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .accessibilityIdentifier("routine-editor-mail-tag")
                        }
                        moreHelp("Added after + on this bot's mail address. Mail that arrives with this tag is marked for this routine. Sends still leave from the connector's address.")
                    }
                    toggle($postResults, "Post results in the conversation",
                           "When on, this routine posts its result as a message in the conversation. When off, it runs in the background and the result stays in Automations. Questions, approvals and errors always reach you, and the routine's instructions are never posted.",
                           id: "routine-editor-post-results")
                }
    }

    private func moreHelp(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(Theme.textSecondary)
    }

    private func toggle(_ value: Binding<Bool>, _ title: LocalizedStringKey, _ help: LocalizedStringKey, id: String) -> some View {
        Toggle(isOn: value) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                Text(help)
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .accessibilityIdentifier(id)
    }

    // MARK: Changes (the desktop's handlers)

    private func selectBot(_ id: String) {
        // Another bot has other threads: results go to a new one (`selectBots`).
        if id != botId { results = .newThread }
        botId = id
    }

    private func selectTarget(_ next: String) {
        target = next
        guard next == "room-goal" else {
            groupId = ""
            return
        }
        runOn = .maus
        attachments = []
        // a team goal starts on the clock, never from a webhook
        if form.recurrence.isTrigger { form.select(.none) }
        let chosen = room ?? rooms.first
        groupId = chosen?.id ?? ""
        selectBot(RoutineTeamGoal.preferredLead(of: chosen, bots: session.state.bots, preferredId: botId)?.id ?? "")
    }

    private func selectRoom(_ id: String) {
        groupId = id
        let chosen = rooms.first { $0.id == id }
        selectBot(RoutineTeamGoal.preferredLead(of: chosen, bots: session.state.bots, preferredId: botId)?.id ?? "")
    }

    private func selectRecurrence(_ choice: RoutineRecurrence) {
        if choice == .interval && !intervalTimeoutDefaultApplied {
            timeoutMinutes = timeoutMinutes ?? 30
            intervalTimeoutDefaultApplied = true
        }
        form.select(choice)
    }

    private func remove(_ attachment: RoutineAttachment) {
        attachments.removeAll { $0.id == attachment.id }
    }

    private func added(_ attachment: RoutineAttachment?) {
        guard let attachment else { return }
        attachments = Array((attachments + [attachment]).prefix(20))
        if runOn == .cloud { runOn = .maus }
    }

    private func importPhotos(_ items: [PhotosPickerItem]) async {
        attaching += 1
        defer { attaching -= 1; photoItems = [] }
        for (index, item) in items.enumerated() {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            let type = item.supportedContentTypes.first { $0.conforms(to: .image) }
            let mime = type?.preferredMIMEType ?? "image/jpeg"
            let ext = type?.preferredFilenameExtension ?? "jpg"
            let name = items.count == 1 ? "Photo.\(ext)" : "Photo \(index + 1).\(ext)"
            added(await session.uploadRoutineAttachment(data: data, name: name, mime: mime, image: AttachmentPolicy.imageMIMETypes.contains(mime)))
        }
    }

    private func importFiles(_ result: Result<[URL], Error>) async {
        guard case let .success(urls) = result else { return }
        attaching += 1
        defer { attaching -= 1 }
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            // read off the main thread: a large file from Files froze the editor
            guard let data = await Task.detached(priority: .userInitiated, operation: { try? Data(contentsOf: url) }).value else { continue }
            let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            added(await session.uploadRoutineAttachment(data: data, name: url.lastPathComponent, mime: mime, image: false))
        }
    }

    // MARK: Saving

    private var cloudSelectable: Bool {
        attachments.isEmpty && (runAvailability?.canSelect(.cloud, preserving: runOn) ?? (runOn == .cloud))
    }

    private var saveLabel: LocalizedStringKey {
        if routine != nil { return "Save" }
        return isTeamGoal ? "Schedule team goal" : "Schedule routine"
    }

    private var valid: Bool {
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !botId.isEmpty, form.isValid
        else { return false }
        if isTeamGoal { return !groupId.isEmpty && roomMembers.contains { $0.id == botId } }
        if case .failure = watchEdit { return false }
        return true
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let schedule: RoutineSchedule
        do { schedule = try form.schedule(savedAt: Date()) }
        catch { session.actionError = error.localizedDescription; return }
        var input = RoutineInput(
            name: String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80)),
            prompt: String(prompt.trimmingCharacters(in: .whitespacesAndNewlines).prefix(20_000)),
            botId: botId,
            runOn: isTeamGoal ? RoutineRunLocation.maus.rawValue : runOn.rawValue,
            enabled: routine == nil ? true : nil,
            schedule: schedule, durationMinutes: duration,
            timeoutMinutes: timeoutMinutes, clearTimeout: timeoutMinutes == nil,
            target: advanced ? target : nil,
            groupId: isTeamGoal ? groupId : nil,
            overlap: advanced ? overlap : nil,
            attachments: advanced ? (isTeamGoal ? [] : attachments) : nil,
            results: advanced && !isTeamGoal ? results : .keep,
            completeSchedule: true
        )
        input.runAs = RoutineRunAsField.toSend(runAs, options: runAsOptions)
        if !isTeamGoal {
            input.onlyWhenPresent = onlyWhenPresent
            input.postResults = postResults
        }
        let finite = form.recurrence == .none || (form.recurrence == .interval && form.endsOnDate)
        input.deleteWhenFinished = finite && deleteWhenFinished
        if form.recurrence.repeatsOnClock { input.autoPauseAfter = autoPauseAfter }
        if !isTeamGoal {
            input.continuity = form.recurrence.repeatsOnClock && continuity
            input.mailAlias = mailAlias
        }
        if case let .success(edit) = watchEdit { input.watch = edit }
        if await session.saveRoutine(input, original: savedRoutine ?? routine) != nil {
            await onSaved()
            dismiss()
        }
    }
}

// MARK: - Timing (RoutineTimingFields.tsx)

/// "Timing" under Repeat, for a repeating routine: Exact starts at the
/// scheduled time; Flexible starts somewhere between Early minutes before
/// and Late minutes after it.
struct RoutineTimingFields: View {
    @Environment(\.themePalette) var themePalette
    @Binding var form: RoutineScheduleForm

    var body: some View {
        Picker("Timing", selection: $form.timing) {
            Text("Exact").tag(RoutineTimingMode.exact)
            Text("Flexible").tag(RoutineTimingMode.flexible)
        }
        .accessibilityIdentifier("routine-editor-timing")
        if form.timing == .flexible {
            minutesField("Early", value: $form.earlyMinutes, label: "Early window minutes", id: "routine-editor-timing-early")
            minutesField("Late", value: $form.lateMinutes, label: "Late window minutes", id: "routine-editor-timing-late")
            Text("0 late means ready by the scheduled time.")
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
        }
    }

    private func minutesField(_ title: LocalizedStringKey, value: Binding<Int>, label: LocalizedStringKey, id: String) -> some View {
        HStack {
            Text(title)
            Spacer(minLength: 8)
            TextField("0", value: Binding(get: { value.wrappedValue }, set: { value.wrappedValue = max(0, $0) }), format: .number)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .frame(minWidth: 56)
                .accessibilityLabel(Text(label))
                .accessibilityIdentifier(id)
            Text("min").foregroundStyle(Theme.textSecondary)
        }
    }
}

// MARK: - Schedule fields

/// The fields under Repeat, for whichever choice is made. Binds to the form
/// so any host shows the same thing.
struct RoutineScheduleFields: View {
    @Environment(\.themePalette) var themePalette
    @Binding var form: RoutineScheduleForm

    var body: some View {
        switch form.recurrence {
        case .none:
            DatePicker("Starts", selection: $form.at, in: Date()...)
                .accessibilityIdentifier("routine-editor-starts")
        case .interval:
            intervalFields
            if form.preview != nil { previewRows }
        case .hourly:
            Picker("At minute", selection: model(\.minute)) {
                ForEach(0..<60, id: \.self) { minute in
                    Text(verbatim: String(format: ":%02d", minute)).tag(minute)
                }
            }
            .accessibilityIdentifier("routine-editor-minute")
            zoneAndPreview
        case .daily, .weekdays, .days, .monthly, .yearly:
            if form.recurrence == .days {
                RoutineDayChips(selected: form.model.weekdays, idPrefix: "routine-editor-day") { day in form.toggleModelWeekday(day) }
            }
            if form.recurrence == .yearly {
                Picker("Month", selection: model(\.month)) {
                    ForEach(1...12, id: \.self) { month in
                        Text(verbatim: Calendar.current.standaloneMonthSymbols[month - 1].capitalized).tag(month)
                    }
                }
                .accessibilityIdentifier("routine-editor-month")
            }
            if form.recurrence == .monthly || form.recurrence == .yearly {
                Picker("Day of month", selection: monthDay) {
                    ForEach(1...31, id: \.self) { day in Text(verbatim: String(day)).tag(RoutineMonthDay.day(day)) }
                    if form.recurrence == .monthly { Text("Last day").tag(RoutineMonthDay.last) }
                }
                .accessibilityIdentifier("routine-editor-day-of-month")
            }
            timeRows
            if form.recurrence == .monthly, case let .day(day) = form.model.monthDay, day > 28 {
                Text("Months without this date are skipped. Choose Last day to always use the end of the month.")
                    .font(.caption).foregroundStyle(Theme.textSecondary)
            }
            zoneAndPreview
        case .advanced:
            previewRows
            Button("Choose a simple schedule") { form.chooseSimpleSchedule() }
                .accessibilityIdentifier("routine-editor-simple-schedule")
        case .webhook, .email:
            // started by a trigger: the editor shows the webhook instead
            EmptyView()
        }
    }

    /// One row per time ("+ Add a time", a remove button past the first).
    @ViewBuilder
    private var timeRows: some View {
        ForEach(Array(form.model.times.enumerated()), id: \.offset) { index, _ in
            HStack {
                DatePicker(index == 0 ? "Time" : "And at", selection: time(index), displayedComponents: .hourAndMinute)
                    .accessibilityIdentifier("routine-editor-time.\(index)")
                if form.model.times.count > 1 {
                    Button(role: .destructive) { form.removeTime(at: index) } label: {
                        Image(systemName: "minus.circle.fill")
                    }
                    .buttonStyle(.borderless)
                    .foregroundStyle(Theme.danger)
                    .accessibilityLabel(Text("Remove this time"))
                    .accessibilityIdentifier("routine-editor-remove-time.\(index)")
                }
            }
        }
        Button { form.addTime() } label: {
            Label("Add a time", systemImage: "plus")
        }
        .accessibilityIdentifier("routine-editor-add-time")
    }

    @ViewBuilder
    private var zoneAndPreview: some View {
        NavigationLink {
            RoutineTimeZonePicker(selected: $form.timeZone)
        } label: {
            LabeledContent("Time zone") {
                Text(verbatim: RoutineScheduleModel.timeZoneCity(form.timeZone))
            }
        }
        .accessibilityIdentifier("routine-editor-time-zone")
        previewRows
    }

    /// The schedule in words with its zone, then its next three runs.
    @ViewBuilder
    private var previewRows: some View {
        if let value = form.preview, let expression = value.expression {
            VStack(alignment: .leading, spacing: 3) {
                Text(verbatim: RoutineWording.summary(.cron(expression: expression, timeZone: value.timeZone)))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.textPrimary)
                    .accessibilityIdentifier("routine-editor-summary")
                if !value.runs.isEmpty {
                    Text("Next runs").font(.caption.weight(.medium)).padding(.top, 4)
                    ForEach(value.runs, id: \.self) { at in
                        Text(verbatim: RoutineEditorWording.run(at, zone: value.timeZone)).font(.caption)
                    }
                    Text("Clock changes: skipped times shift forward; repeated times run once.").font(.caption2)
                }
            }
            .foregroundStyle(Theme.textSecondary)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("routine-editor-next-runs")
        }
    }

    @ViewBuilder
    private var intervalFields: some View {
        let presets = form.intervalUnit == .hours ? RoutineScheduleForm.intervalHourPresets : RoutineScheduleForm.intervalPresets
        Picker("Unit", selection: Binding(get: { form.intervalUnit }, set: { form.selectIntervalUnit($0) })) {
            Text("Minutes").tag(RoutineScheduleEveryUnit.minutes)
            Text("Hours").tag(RoutineScheduleEveryUnit.hours)
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("routine-editor-interval-unit")
        Picker("Runs every", selection: Binding(
            get: { presets.contains(form.intervalCount ?? -1) ? form.intervalCount ?? 0 : 0 },
            set: { form.setIntervalCount($0 == 0 ? nil : $0) }
        )) {
            ForEach(presets, id: \.self) { count in
                if form.intervalUnit == .hours && count == 1 {
                    Text("1 hour").tag(count)
                } else if form.intervalUnit == .hours {
                    Text("\(count) hours").tag(count)
                } else {
                    Text("\(count) minutes").tag(count)
                }
            }
            Text("Custom…").tag(0)
        }
        .accessibilityIdentifier("routine-editor-interval")
        if !presets.contains(form.intervalCount ?? -1) {
            HStack {
                Text("Set the interval to")
                TextField(form.intervalUnit == .hours ? "1-24" : "5-1,440", value: Binding(
                    get: { form.intervalCount }, set: { form.setIntervalCount($0) }
                ), format: .number)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .frame(minWidth: 72)
                    .accessibilityLabel(form.intervalUnit == .hours ? Text("Custom interval in hours") : Text("Custom interval in minutes"))
                    .accessibilityIdentifier("routine-editor-interval-custom")
                (form.intervalUnit == .hours ? Text("hours") : Text("minutes")).foregroundStyle(Theme.textSecondary)
            }
        }
        Picker("On", selection: Binding(get: { form.intervalDays }, set: { form.selectIntervalDays($0) })) {
            Text("Every day").tag(RoutineIntervalDays.everyDay)
            Text("Weekdays").tag(RoutineIntervalDays.weekdays)
            Text("Custom…").tag(RoutineIntervalDays.custom)
        }
        .accessibilityIdentifier("routine-editor-interval-days")
        if form.intervalDays == .custom {
            RoutineDayChips(selected: form.intervalWeekdays, idPrefix: "routine-editor-interval-day") { form.toggleIntervalWeekday($0) }
        }
        Picker("During", selection: $form.windowCustom) {
            Text("All day").tag(false)
            Text("Custom hours…").tag(true)
        }
        .accessibilityIdentifier("routine-editor-window")
        if form.windowCustom {
            DatePicker("Run between", selection: clock(\.windowStart), displayedComponents: .hourAndMinute)
                .accessibilityIdentifier("routine-editor-window-start")
            DatePicker("and", selection: clock(\.windowEnd), displayedComponents: .hourAndMinute)
                .accessibilityIdentifier("routine-editor-window-end")
        }
        Picker("Ends", selection: $form.endsOnDate) {
            Text("Never").tag(false)
            Text("On a date…").tag(true)
        }
        .accessibilityIdentifier("routine-editor-ends")
        if form.endsOnDate {
            DatePicker("Stop scheduling after", selection: $form.endDate, displayedComponents: .date)
                .accessibilityIdentifier("routine-editor-end-date")
        }
    }

    private func model<Value>(_ key: WritableKeyPath<RoutineScheduleModel, Value>) -> Binding<Value> {
        Binding(get: { form.model[keyPath: key] }, set: { form.model[keyPath: key] = $0 })
    }

    private var monthDay: Binding<RoutineMonthDay> {
        Binding(
            get: {
                if form.recurrence == .yearly, form.model.monthDay == .last { return .day(31) }
                return form.model.monthDay
            },
            set: { form.model.monthDay = $0 }
        )
    }

    /// A time row, read and written as "HH:MM" in the routine's zone (the
    /// picker shows the clock as is, in the phone's 12 or 24 hour format).
    private func time(_ index: Int) -> Binding<Date> {
        Binding(
            get: { Self.date(fromClock: form.model.times.indices.contains(index) ? form.model.times[index] : "09:00") },
            set: { value in
                guard form.model.times.indices.contains(index) else { return }
                form.model.times[index] = Self.clock(value)
            }
        )
    }

    private func clock(_ key: WritableKeyPath<RoutineScheduleForm, String>) -> Binding<Date> {
        Binding(
            get: { Self.date(fromClock: form[keyPath: key]) },
            set: { form[keyPath: key] = Self.clock($0) }
        )
    }

    static func date(fromClock text: String) -> Date {
        RoutineScheduleForm.atLocalTime(Date(), text, calendar: .current)
    }

    static func clock(_ date: Date) -> String {
        RoutineScheduleForm.clock(date, calendar: .current)
    }
}

/// Seven day toggles, Sunday first.
struct RoutineDayChips: View {
    @Environment(\.themePalette) var themePalette
    let selected: [Int]
    let idPrefix: String
    let toggle: (Int) -> Void

    var body: some View {
        HStack {
            ForEach(0..<7, id: \.self) { day in
                let on = selected.contains(day)
                Button(RoutineEditorWording.dayLetter(day)) { toggle(day) }
                    .buttonStyle(.bordered)
                    .tint(on ? Theme.accent : Theme.textSecondary)
                    .accessibilityLabel(RoutineEditorWording.dayName(day))
                    .accessibilityValue(Text(on ? "selected" : "not selected"))
                    .accessibilityIdentifier("\(idPrefix).\(day)")
            }
        }
    }
}

/// The zone a schedule's times are read in, as cities: the person's own
/// first, then every zone, searchable by city or by its name ("Eastern
/// Time"). The IANA identifier stays under the hood.
struct RoutineTimeZonePicker: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.dismiss) private var dismiss
    @Binding var selected: String
    @State private var query = ""

    private struct Zone: Identifiable {
        let id: String
        let city: String
        let name: String
    }

    private static let zones: [Zone] = {
        let identifiers = Set(TimeZone.knownTimeZoneIdentifiers + ["UTC"])
        return identifiers
            .filter { $0 == "UTC" || $0.contains("/") && !$0.hasPrefix("Etc/") }
            .map { Zone(id: $0, city: RoutineScheduleModel.timeZoneCity($0), name: zoneName($0)) }
            .sorted { ($0.city, $0.id) < ($1.city, $1.id) }
    }()

    private static func zoneName(_ identifier: String) -> String {
        TimeZone(identifier: identifier)?.localizedName(for: .generic, locale: .current) ?? ""
    }

    private var rows: [Zone] {
        let text = query.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return Self.zones }
        return Self.zones.filter { $0.city.localizedCaseInsensitiveContains(text) || $0.name.localizedCaseInsensitiveContains(text) }
    }

    var body: some View {
        let own = TimeZone.current.identifier
        ThemedForm {
            if query.isEmpty {
                Section("Your time zone") { row(Zone(id: own, city: RoutineScheduleModel.timeZoneCity(own), name: Self.zoneName(own))) }
            }
            Section {
                ForEach(rows) { row($0) }
            } header: {
                if query.isEmpty { Text("All time zones") } else { Text("Results") }
            }
        }
        .navigationTitle(Text("Time zone"))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: Text("Search a city"))
    }

    private func row(_ zone: Zone) -> some View {
        Button {
            selected = zone.id
            dismiss()
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: zone.city).foregroundStyle(Theme.textPrimary)
                    if !zone.name.isEmpty {
                        Text(verbatim: zone.name).font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                }
                Spacer(minLength: 8)
                if zone.id == selected {
                    Image(systemName: "checkmark").foregroundStyle(Theme.accentText)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(zone.id == selected ? .isSelected : [])
        .accessibilityIdentifier("routine-time-zone.\(zone.id)")
    }
}

enum RoutineEditorWording {
    static func dayName(_ day: Int) -> String {
        let symbols = Calendar.current.weekdaySymbols
        return (0..<symbols.count).contains(day) ? symbols[day] : ""
    }

    static func dayLetter(_ day: Int) -> String {
        let symbols = Calendar.current.veryShortStandaloneWeekdaySymbols
        return (0..<symbols.count).contains(day) ? symbols[day] : ""
    }

    static func run(_ date: Date, zone: String) -> String {
        var style = Date.FormatStyle.dateTime.weekday(.abbreviated).year().month(.abbreviated).day().hour().minute()
        if let timeZone = TimeZone(identifier: zone) { style.timeZone = timeZone }
        return date.formatted(style)
    }

    static func problem(_ problem: RoutineScheduleForm.Problem) -> String {
        switch problem {
        case .intervalRange: String(localized: "Choose a whole number from 5 to 1,440 minutes.")
        case .noDays, .schedule(.noDays): String(localized: "Choose at least one day.")
        case let .window(minutes): String(localized: "Choose a same-day window at least \(minutes) minutes long.")
        case .endDate: String(localized: "Choose an end date after the first run.")
        case .schedule(.noTime): String(localized: "Add at least one time.")
        case .schedule(.badTime): String(localized: "Choose a valid time.")
        case let .cron(message): cron(message)
        }
    }

    /// The cron calculator's messages, in the person's words (the zone
    /// comes from a list and the expression from the fields, so only a date
    /// that never exists can still go wrong).
    static func cron(_ message: String) -> String {
        if message == CronExpression.Failure.noFutureRuns.errorDescription {
            return String(localized: "This schedule never runs: choose a date that exists.")
        }
        return String(localized: "Choose a valid schedule.")
    }
}

// MARK: - Runs as

/// The people a routine may run as (the desktop's RunAsField dropdown): a
/// search field past eight people, the people who cannot run this bot's
/// routines listed but not choosable, a check on the chosen one.
struct RoutineRunAsPicker: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.dismiss) private var dismiss
    let options: RoutineRunAsOptions
    @Binding var selected: String?
    @State private var query = ""

    private var current: String? { selected ?? options.current?.principalId }

    var body: some View {
        let rows = RoutineRunAsField.rows(options, selected: current, query: query)
        let list = ThemedForm {
            Section {
                if rows.isEmpty {
                    Text("No one matches").foregroundStyle(Theme.textSecondary)
                }
                ForEach(rows) { person in
                    Button {
                        selected = person.principalId
                        dismiss()
                    } label: {
                        HStack(spacing: 10) {
                            PersonAvatar(initials: People.initials(RoutineRunAsField.name(person)), size: 28, avatarUrl: person.avatarUrl)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verbatim: RoutineRunAsField.name(person))
                                    .foregroundStyle(person.selectable ? Theme.textPrimary : Theme.textTertiary)
                                if !person.selectable {
                                    Text("Cannot run this bot's routines").font(.footnote).foregroundStyle(Theme.textTertiary)
                                } else if person.pending == true {
                                    Text("Will run once \(RoutineRunAsField.name(person)) signs in").font(.footnote).foregroundStyle(Theme.textSecondary)
                                }
                            }
                            Spacer(minLength: 8)
                            if person.principalId == current {
                                Image(systemName: "checkmark").foregroundStyle(Theme.accentText)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!person.selectable)
                    .accessibilityAddTraits(person.principalId == current ? .isSelected : [])
                    .accessibilityIdentifier("routine-run-as.\(person.principalId)")
                }
            } footer: {
                Text("The routine acts with this person's access and their rights on the bot. Every change is recorded in the admin activity log.")
            }
        }
        .navigationTitle(Text("Runs as"))
        .navigationBarTitleDisplayMode(.inline)
        if options.people.count > RoutineRunAsField.searchAfter {
            list.searchable(text: $query, prompt: Text("Search people"))
        } else {
            list
        }
    }
}
