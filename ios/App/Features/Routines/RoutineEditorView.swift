// The routine editor (matrix AU11-AU14), with the desktop's fields:
// routine type (bot task or team goal), every Repeat choice (once, every X
// minutes with days, hours and an end date, daily, weekdays, weekly,
// selected weekdays, monthly, yearly, custom cron), the run limit, overlap,
// duration, the results thread and attachments. Desktop: EventEditor in
// src/components/RoutineCalendarPage.tsx, routines/CronScheduleFields.tsx,
// routines/ResultsDestination.tsx. The rules are RoutineScheduleForm and
// RoutinePatch (CompanionCore): an edit sends only what changed, so a field
// set elsewhere is never lost (S3).
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
    @State private var advancedExpanded: Bool
    @State private var saving = false
    /// Organization server: whom the routine may run as (RunAsField), and
    /// the person chosen here (nil: the routine's current person).
    @State private var runAsOptions: RoutineRunAsOptions?
    @State private var runAs: String?
    @State private var onlyWhenPresent: Bool
    @State private var postResults: Bool

    /// `presetBotId`: a new routine made from a bot's profile starts on that bot.
    /// `seed`: a new routine from the Automations calendar ("More options"
    /// of a slot) starts at that slot with what was typed there.
    init(routine: Routine?, presetBotId: String? = nil, seed: RoutineEditorSeed? = nil, onSaved: @escaping () async -> Void) {
        self.routine = routine
        self.onSaved = onSaved
        _name = State(initialValue: routine?.name ?? seed?.name ?? "")
        _prompt = State(initialValue: routine?.prompt ?? seed?.prompt ?? "")
        _botId = State(initialValue: routine?.botId ?? seed?.botId ?? presetBotId ?? "")
        _target = State(initialValue: routine?.target ?? "bot")
        _groupId = State(initialValue: routine?.groupId ?? "")
        _runOn = State(initialValue: routine?.runLocation ?? .maus)
        let seedAt = routine?.nextRunAt.map { Date(timeIntervalSince1970: $0 / 1_000) } ?? seed?.at ?? RoutineScheduleForm.nextHour()
        _form = State(initialValue: RoutineScheduleForm(schedule: routine?.schedule, seedAt: seedAt))
        _duration = State(initialValue: routine?.durationMinutes ?? 30)
        _timeoutMinutes = State(initialValue: routine?.timeoutMinutes)
        _intervalTimeoutDefaultApplied = State(initialValue: routine != nil)
        _overlap = State(initialValue: routine?.overlap ?? "skip")
        _results = State(initialValue: routine == nil ? .newThread : .keep)
        _attachments = State(initialValue: routine?.target == "room-goal" ? [] : routine?.attachments ?? [])
        _advancedExpanded = State(initialValue: false)
        _onlyWhenPresent = State(initialValue: routine?.onlyWhenPresent == true)
        // Default silent for a new routine; an existing one keeps its choice.
        _postResults = State(initialValue: routine?.postResults == true)
    }

    private var advanced: Bool { session.surfaceGate.allows(.routineAdvancedEditor) }
    private var isTeamGoal: Bool { target == "room-goal" }
    private var bots: [Bot] { session.state.bots.filter { $0.hidden != true } }
    private var rooms: [Room] { RoutineTeamGoal.rooms(session.state.rooms) }
    private var room: Room? { rooms.first { $0.id == groupId } }
    private var roomMembers: [Bot] { RoutineTeamGoal.members(of: room, bots: session.state.bots) }

    var body: some View {
        NavigationStack {
            ThemedForm {
                if advanced { typeSection }
                workSection
                if advanced && !isTeamGoal { resultsSection }
                if RoutineRunAsField.shown(runAsOptions) { runAsSection }
                runOnSection
                scheduleSection
                advancedSection
                if advanced && session.surfaceGate.allows(.routineAttachments) { attachmentsSection }
            }
            .navigationTitle(routine == nil ? "New routine" : "Edit routine")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saveLabel) { Task { await save() } }
                        .disabled(saving || attaching > 0 || !valid)
                        .accessibilityIdentifier("routine-editor-save")
                }
            }
            .onAppear { if botId.isEmpty { botId = bots.first?.id ?? "" } }
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
    }

    @ViewBuilder
    private var runAsSection: some View {
        if let options = runAsOptions {
            let chosen = RoutineRunAsField.chosen(options, selected: runAs)
            let name = chosen.map(RoutineRunAsField.name) ?? ""
            Section {
                if options.canChoose {
                    NavigationLink {
                        RoutineRunAsPicker(options: options, selected: $runAs)
                    } label: {
                        HStack(spacing: 10) {
                            PersonAvatar(initials: People.initials(name.isEmpty ? "?" : name), size: 24)
                            Text("Runs as")
                            Spacer(minLength: 8)
                            Text(verbatim: name).foregroundStyle(Theme.textSecondary).lineLimit(1)
                        }
                    }
                    .accessibilityIdentifier("routine-editor-run-as")
                } else {
                    HStack(spacing: 10) {
                        PersonAvatar(initials: People.initials(name.isEmpty ? "?" : name), size: 24)
                        Text(String(localized: "Runs as \(name)")).lineLimit(1)
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
            } footer: {
                if options.canChoose {
                    Text("The routine acts with this person's access and their rights on the bot. Every change is recorded in the admin activity log.")
                }
            }
        }
    }

    // MARK: Sections

    private var typeSection: some View {
        Section {
            Picker(String(localized: "Routine type"), selection: Binding(get: { target }, set: selectTarget)) {
                Text("Bot task").tag("bot")
                Text("Team goal").tag("room-goal")
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("routine-editor-type")
        } header: {
            Text("Routine type")
        } footer: {
            Text(isTeamGoal ? "A lead coordinates the group until the goal settles." : "One bot owns and completes each run.")
        }
    }

    @ViewBuilder
    private var workSection: some View {
        Section("Work") {
            TextField("Routine name", text: $name)
                .accessibilityIdentifier("routine-editor-name")
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
            }
            // the markdown editor (desktop RoutineCalendarPage EventEditor, #258)
            MarkdownEditor(
                text: $prompt,
                placeholder: isTeamGoal ? String(localized: "What should the team accomplish?") : String(localized: "What should the agent do?"),
                minHeight: 140, accessibilityLabel: String(localized: "Instructions"), identifier: "routine-editor-prompt"
            )
        }
    }

    private var resultsSection: some View {
        let bot = session.state.bot(botId)
        return Section {
            Picker(String(localized: "Post results to"), selection: $results) {
                if routine != nil { Text("Keep current destination").tag(RoutineResultsDestination.keep) }
                Text("Create a dedicated results thread").tag(RoutineResultsDestination.newThread)
                if RoutineResults.isMissing(results, bot: bot) {
                    Text("Thread unavailable. Choose another").tag(results).rowSelectionDisabled()
                }
                ForEach(RoutineResults.groups(for: bot), id: \.self) { group in
                    Section(group.folder ?? String(localized: "No folder")) {
                        ForEach(group.threads, id: \.threadId) { thread in
                            Text(verbatim: thread.title).tag(RoutineResultsDestination.thread(thread.threadId))
                        }
                    }
                }
            }
            .disabled(bot == nil)
            .accessibilityIdentifier("routine-editor-results")
        } footer: {
            Text("Each run starts with fresh context. Dated results collect here; full execution details stay in Run logs. A dedicated results thread is reused for every run and can be moved into a folder.")
        }
    }

    @ViewBuilder
    private var runOnSection: some View {
        if isTeamGoal {
            Section {
                Label("Runs on this computer", systemImage: "scope")
            } footer: {
                Text("Sagax keeps the group and its member hand-offs together for the full goal.")
            }
        } else {
            Section {
                Picker("Run location", selection: $runOn) {
                    Label("This computer", systemImage: "laptopcomputer")
                        .tag(RoutineRunLocation.maus)
                    Label("Cloud VM", systemImage: "cloud")
                        .tag(RoutineRunLocation.cloud)
                        .rowSelectionDisabled(!cloudSelectable)
                }
                .pickerStyle(.inline)

                if !availabilityLoaded {
                    ProgressView("Checking Cloud VM availability…")
                } else if runAvailability == nil {
                    Label("Cloud VM status is unavailable", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(Theme.textSecondary)
                }
            } header: {
                Text("Where does it run?")
            } footer: {
                if runOn == .maus {
                    Text("Uses this agent's selected model and computer setting on the paired computer.")
                } else if runAvailability?.cloudReady == true {
                    Text("Runs the agent and its tools inside its Boat virtual machine. The VM wakes automatically for each run; keep Sagax running so its scheduler can launch the job.")
                } else {
                    Text("This existing Cloud VM choice is preserved, but it cannot run until the paired computer has a configured Boat API key and an available Boat agent.")
                }
            }
        }
    }

    private var scheduleSection: some View {
        Section {
            Picker("Repeats", selection: Binding(get: { form.recurrence }, set: selectRecurrence)) {
                Text("Does not repeat").tag(RoutineRecurrence.none)
                Text("Every X minutes").tag(RoutineRecurrence.interval)
                Text("Daily").tag(RoutineRecurrence.daily)
                Text("Every weekday (Monday to Friday)").tag(RoutineRecurrence.weekdays)
                Text("Weekly on \(RoutineEditorWording.dayName(form.calendar.component(.weekday, from: form.at) - 1))").tag(RoutineRecurrence.weekly)
                Text("Selected weekdays").tag(RoutineRecurrence.custom)
                if advanced || form.recurrence.cronChoice != nil {
                    Text("Monthly").tag(RoutineRecurrence.monthly)
                    Text("Yearly").tag(RoutineRecurrence.yearly)
                    Text("Custom cron (advanced)").tag(RoutineRecurrence.cron)
                }
            }
            .accessibilityIdentifier("routine-editor-repeat")
            RoutineScheduleFields(form: $form)
            if !isTeamGoal {
                Toggle(isOn: $onlyWhenPresent) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Only when I'm here")
                        Text("While you are away (computer idle or locked), this routine skips its runs and tells you how many when you are back. A one-time routine waits for you.")
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                .accessibilityIdentifier("routine-editor-only-when-present")
                Toggle(isOn: $postResults) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Post results in the conversation")
                        Text("When on, this routine posts its result as a message in the conversation. When off, it runs in the background and the result stays in Automations. Questions, approvals and errors always reach you, and the routine's instructions are never posted.")
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                .accessibilityIdentifier("routine-editor-post-results")
            }
            if let problem = form.problem {
                Text(verbatim: RoutineEditorWording.problem(problem))
                    .font(.footnote)
                    .foregroundStyle(Theme.danger)
                    .accessibilityIdentifier("routine-editor-problem")
            }
        } header: {
            Text("Schedule")
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                if form.recurrence == .interval {
                    Text(overlap == "queue" ? "Keep one scheduled run waiting until this routine finishes. Skip further occurrences until it starts. Manual runs are separate." : "Skip scheduled occurrences while this routine is working. Manual runs are separate.")
                }
                Text("Runs while Sagax is open on this computer: it cannot wake a sleeping Mac. A run missed by less than 12 hours still happens when the app is back; for 24/7, run Sagax on a VPS.")
            }
        }
    }

    private var advancedSection: some View {
        Section {
            DisclosureGroup(isExpanded: $advancedExpanded) {
                Picker("Stop if still running after", selection: $timeoutMinutes) {
                    Text("No limit").tag(nil as Int?)
                    ForEach(RoutineDurations.options, id: \.self) { minutes in
                        Text(RoutineDurations.label(minutes)).tag(Optional(minutes))
                    }
                }
                .accessibilityIdentifier("routine-editor-timeout")
                if advanced && form.recurrence != .none {
                    Picker(String(localized: "If the previous run is still working"), selection: $overlap) {
                        Text("Skip this occurrence").tag("skip")
                        Text("Queue one run").tag("queue")
                    }
                    .accessibilityIdentifier("routine-editor-overlap")
                }
                if advanced {
                    Picker(String(localized: "Duration"), selection: $duration) {
                        ForEach(Set(RoutineDurations.options + [duration]).sorted(), id: \.self) { minutes in
                            Text(RoutineDurations.label(minutes)).tag(minutes)
                        }
                    }
                    .accessibilityIdentifier("routine-editor-duration")
                }
            } label: {
                timeoutMinutes.map { Text("Advanced · \(RoutineDurations.label($0)) run limit") } ?? Text("Advanced · no run limit")
            }
            .accessibilityIdentifier("routine-editor-advanced")
        } footer: {
            if advancedExpanded {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Optional. The clock starts when work actually begins and does not control how often the routine starts.")
                    if advanced && form.recurrence != .none {
                        Text(overlap == "queue" ? "Keep one scheduled run waiting until this routine finishes. Skip further occurrences until it starts. Manual runs are separate." : "Skip scheduled occurrences while this routine is working. Manual runs are separate.")
                    }
                    if advanced { Text("Duration is how long the routine fills on the calendar.") }
                }
            }
        }
    }

    @ViewBuilder
    private var attachmentsSection: some View {
        if isTeamGoal {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Use the group’s shared context").font(.subheadline.weight(.medium))
                    Text("Team goals cannot carry routine attachments. Put shared context in the goal instructions or the group instructions.")
                        .font(.footnote).foregroundStyle(Theme.textSecondary)
                }
            } header: {
                Text("Attachments")
            }
        } else {
            Section {
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
            } header: {
                Text("Attachments")
            } footer: {
                Text("Attachments are passed to each local routine run and excluded from shared team files.")
            }
        }
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
            guard let data = try? Data(contentsOf: url) else { continue }
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
        if await session.saveRoutine(input, original: routine) != nil {
            await onSaved()
            dismiss()
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
        case .weekly:
            DatePicker("On", selection: $form.at)
        case .daily, .weekdays:
            DatePicker("Time", selection: $form.at, displayedComponents: .hourAndMinute)
        case .custom:
            DatePicker("Time", selection: $form.at, displayedComponents: .hourAndMinute)
            RoutineDayChips(selected: form.weekdays, idPrefix: "routine-editor-day") { form.toggleWeekday($0) }
        case .interval:
            intervalFields
        case .monthly, .yearly, .cron:
            cronFields
        }
    }

    @ViewBuilder
    private var intervalFields: some View {
        Picker("Runs every", selection: Binding(
            get: { RoutineScheduleForm.intervalPresets.contains(form.intervalMinutes ?? -1) ? form.intervalMinutes ?? 0 : 0 },
            set: { form.intervalMinutes = $0 == 0 ? nil : $0 }
        )) {
            ForEach(RoutineScheduleForm.intervalPresets, id: \.self) { minutes in
                Text("\(minutes) minutes").tag(minutes)
            }
            Text("Custom…").tag(0)
        }
        .accessibilityIdentifier("routine-editor-interval")
        if !RoutineScheduleForm.intervalPresets.contains(form.intervalMinutes ?? -1) {
            HStack {
                Text("Set the interval to")
                TextField("5–1,440", value: $form.intervalMinutes, format: .number)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .frame(minWidth: 72)
                    .accessibilityLabel("Custom interval in minutes")
                    .accessibilityIdentifier("routine-editor-interval-custom")
                Text("minutes").foregroundStyle(Theme.textSecondary)
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

    @ViewBuilder
    private var cronFields: some View {
        if form.recurrence == .cron {
            VStack(alignment: .leading, spacing: 6) {
                Text("Cron expression").font(.footnote).foregroundStyle(Theme.textSecondary)
                TextField("0 9 1 * *", text: cron(\.expression))
                    .font(.system(.body, design: .monospaced))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("routine-editor-cron")
                Text("Minute · hour · day of month · month · day of week. For example, 0 9 1 * * runs at 9 am on the first of each month.")
                    .font(.caption).foregroundStyle(Theme.textSecondary)
            }
        } else {
            if form.recurrence == .yearly {
                Picker("Month", selection: cron(\.month)) {
                    ForEach(1...12, id: \.self) { month in
                        Text(verbatim: Calendar.current.standaloneMonthSymbols[month - 1].capitalized).tag(String(month))
                    }
                }
                .accessibilityIdentifier("routine-editor-month")
            }
            Picker("Day of month", selection: cron(\.day)) {
                ForEach(1...31, id: \.self) { day in Text(verbatim: String(day)).tag(String(day)) }
                Text("Last day").tag("L")
            }
            .accessibilityIdentifier("routine-editor-day-of-month")
            DatePicker("Time", selection: Binding(
                get: { Self.date(fromClock: form.cronDraft.time) },
                set: { value in form.updateCron { $0.time = Self.clock(value) } }
            ), displayedComponents: .hourAndMinute)
            if (Int(form.cronDraft.day) ?? 0) > 28 {
                Text("Months without this date are skipped. Choose Last day to always use the end of the month.")
                    .font(.caption).foregroundStyle(Theme.textSecondary)
            }
        }
        LabeledContent("Time zone") {
            TextField("America/New_York", text: cron(\.timeZone))
                .multilineTextAlignment(.trailing)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("routine-editor-time-zone")
        }
        if let value = form.cronValue, value.error.isEmpty, !value.runs.isEmpty {
            VStack(alignment: .leading, spacing: 3) {
                Text("Next runs · \(form.cronDraft.timeZone)").font(.caption.weight(.medium))
                ForEach(value.runs, id: \.self) { at in
                    Text(verbatim: RoutineEditorWording.cronRun(at, zone: form.cronDraft.timeZone)).font(.caption)
                }
                Text("Clock changes: skipped times shift forward; repeated times run once.").font(.caption2)
            }
            .foregroundStyle(Theme.textSecondary)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("routine-editor-next-runs")
        }
    }

    private func clock(_ key: WritableKeyPath<RoutineScheduleForm, String>) -> Binding<Date> {
        Binding(
            get: { Self.date(fromClock: form[keyPath: key]) },
            set: { form[keyPath: key] = Self.clock($0) }
        )
    }

    private func cron(_ key: WritableKeyPath<RoutineCronDraft, String>) -> Binding<String> {
        Binding(get: { form.cronDraft[keyPath: key] }, set: { value in form.updateCron { $0[keyPath: key] = value } })
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

enum RoutineEditorWording {
    static func dayName(_ day: Int) -> String {
        let symbols = Calendar.current.weekdaySymbols
        return (0..<symbols.count).contains(day) ? symbols[day] : ""
    }

    static func dayLetter(_ day: Int) -> String {
        let symbols = Calendar.current.veryShortStandaloneWeekdaySymbols
        return (0..<symbols.count).contains(day) ? symbols[day] : ""
    }

    static func cronRun(_ date: Date, zone: String) -> String {
        var style = Date.FormatStyle.dateTime.weekday(.abbreviated).year().month(.abbreviated).day().hour().minute()
        if let timeZone = TimeZone(identifier: zone) { style.timeZone = timeZone }
        return date.formatted(style)
    }

    static func problem(_ problem: RoutineScheduleForm.Problem) -> String {
        switch problem {
        case .intervalRange: String(localized: "Choose a whole number from 5 to 1,440 minutes.")
        case .noDays: String(localized: "Choose at least one day.")
        case let .window(minutes): String(localized: "Choose a same-day window at least \(minutes) minutes long.")
        case .endDate: String(localized: "Choose an end date after the first run.")
        case let .cron(message): cron(message)
        }
    }

    /// The cron calculator's messages, in the person's language.
    static func cron(_ message: String) -> String {
        let prefix = "Invalid cron expression: "
        if message.hasPrefix(prefix) {
            return String(localized: "Invalid cron expression: \(String(message.dropFirst(prefix.count)))")
        }
        switch message {
        case "Choose a time for this routine.": return String(localized: "Choose a time for this routine.")
        case CronExpression.Failure.fields.errorDescription: return String(localized: "Cron must have five fields: minute hour day-of-month month weekday (no seconds, year, or macros)")
        case CronExpression.Failure.zone.errorDescription: return String(localized: "Choose an IANA timezone such as America/New_York, Asia/Kolkata, or UTC")
        case CronExpression.Failure.invalidZone.errorDescription: return String(localized: "Choose a valid IANA timezone such as America/New_York, Asia/Kolkata, or UTC")
        case CronExpression.Failure.noFutureRuns.errorDescription: return String(localized: "This cron expression has no future runs. Choose dates that exist.")
        default: return message
        }
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
                            PersonAvatar(initials: People.initials(RoutineRunAsField.name(person)), size: 28)
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
