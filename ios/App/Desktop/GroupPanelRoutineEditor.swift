// iPad: a team goal written inside the group panel, as the desktop
// GroupDetailsTab's inline routine editor (2026-11-06): New team goal, Add
// to meeting and Duplicate open it over the panel instead of a sheet.
import SwiftUI
import CompanionCore

/// What the inline editor starts from: nothing (a new team goal of the
/// group) or a routine to copy.
struct GroupPanelGoalDraft: Identifiable {
    let id = UUID()
    let copyOf: Routine?
}

extension Notification.Name {
    /// A routine of the group panel was added, changed or removed: Upcoming reads again.
    static let groupPanelRoutinesChanged = Notification.Name("sagax.groupPanelRoutinesChanged")
}

struct GroupPanelRoutineEditor: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let room: Room
    let draft: GroupPanelGoalDraft
    let close: () -> Void

    @State private var name: String
    @State private var prompt: String
    @State private var botId: String
    @State private var form: RoutineScheduleForm
    @State private var saving = false

    init(room: Room, draft: GroupPanelGoalDraft, bots: [Bot], close: @escaping () -> Void) {
        self.room = room
        self.draft = draft
        self.close = close
        let source = draft.copyOf
        _name = State(initialValue: source.map { String(localized: "\($0.name) (copy)") } ?? "")
        _prompt = State(initialValue: source?.prompt ?? "")
        let lead = source?.botId
            ?? RoutineTeamGoal.preferredLead(of: room, bots: bots, preferredId: nil)?.id
            ?? ""
        _botId = State(initialValue: lead)
        let seedAt = source?.nextRunAt.map { Date(timeIntervalSince1970: $0 / 1_000) } ?? RoutineScheduleForm.nextHour()
        _form = State(initialValue: RoutineScheduleForm(schedule: source?.schedule, seedAt: seedAt))
    }

    /// A copy of a routine that is not a team goal stays what it was; the
    /// rest is a team goal of this group.
    private var isTeamGoal: Bool {
        guard let source = draft.copyOf else { return true }
        return source.target == "room-goal" || source.groupId != nil
    }

    /// Who can lead: the group's bots, plus the copied routine's own bot.
    private var leads: [Bot] {
        var out = RoutineTeamGoal.members(of: room, bots: session.state.bots)
        if !isTeamGoal, let id = draft.copyOf?.botId, !out.contains(where: { $0.id == id }), let bot = session.state.bot(id) {
            out.insert(bot, at: 0)
        }
        return out
    }

    private var valid: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && leads.contains { $0.id == botId }
            && form.isValid
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Form {
                Section {
                    TextField(String(localized: "Name"), text: $name)
                        .accessibilityIdentifier("group-panel.routine-editor-name")
                    TextField(String(localized: "What should the team do?"), text: $prompt, axis: .vertical)
                        .lineLimit(4...12)
                        .accessibilityIdentifier("group-panel.routine-editor-prompt")
                }
                Section {
                    Picker(String(localized: "Lead"), selection: $botId) {
                        ForEach(leads) { bot in
                            Text(verbatim: bot.name).tag(bot.id)
                        }
                    }
                    .accessibilityIdentifier("group-panel.routine-editor-lead")
                }
                Section {
                    Picker(String(localized: "Repeats"), selection: Binding(get: { form.recurrence }, set: { form.select($0) })) {
                        ForEach(RoutineEditorRules.repeatChoices(current: form.recurrence, teamGoal: isTeamGoal), id: \.self) { choice in
                            Text(verbatim: RoutineEditorView.repeatLabel(choice)).tag(choice)
                        }
                    }
                    .accessibilityIdentifier("group-panel.routine-editor-repeat")
                    RoutineScheduleFields(form: $form)
                    if form.recurrence.repeatsOnClock { RoutineTimingFields(form: $form) }
                } footer: {
                    if let problem = form.problem {
                        Text(verbatim: RoutineEditorWording.problem(problem))
                            .foregroundStyle(theme.danger)
                    }
                }
                Section {
                    Button {
                        Task { await save() }
                    } label: {
                        HStack {
                            Spacer(minLength: 0)
                            if saving { ProgressView().controlSize(.small) }
                            Text(isTeamGoal ? "Schedule team goal" : "Schedule routine")
                                .font(theme.font(14, .semibold))
                            Spacer(minLength: 0)
                        }
                    }
                    .disabled(!valid || saving)
                    .accessibilityIdentifier("group-panel.routine-editor-save")
                }
            }
            .scrollContentBackground(.hidden)
            .scrollDismissesKeyboard(.interactively)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(theme.app)
        .onAppear {
            // a team goal starts on the clock, never from a webhook
            if isTeamGoal, form.recurrence.isTrigger { form.select(.none) }
            if !leads.contains(where: { $0.id == botId }) { botId = leads.first?.id ?? "" }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("group-panel.routine-editor")
    }

    private var header: some View {
        HStack(spacing: 8) {
            Button(action: close) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(theme.inkSecondary)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .accessibilityLabel(Text("Back"))
            .accessibilityIdentifier("group-panel.routine-editor-back")
            Text(draft.copyOf == nil ? "New team goal" : "Duplicate")
                .font(theme.font(15, .semibold))
                .foregroundStyle(theme.ink)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .frame(height: 52)
        .overlay(alignment: .bottom) { Rectangle().fill(theme.hairlineWeak).frame(height: 1) }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let schedule: RoutineSchedule
        do { schedule = try form.schedule(savedAt: Date()) }
        catch { session.actionError = error.localizedDescription; return }
        let source = draft.copyOf
        var input = RoutineInput(
            name: String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80)),
            prompt: String(prompt.trimmingCharacters(in: .whitespacesAndNewlines).prefix(20_000)),
            botId: botId,
            runOn: isTeamGoal ? "maus" : (source?.runOn ?? "maus"),
            enabled: true,
            schedule: schedule,
            durationMinutes: source?.durationMinutes ?? 30,
            timeoutMinutes: source?.timeoutMinutes,
            target: isTeamGoal ? "room-goal" : source?.target,
            groupId: isTeamGoal ? room.id : nil,
            overlap: source?.overlap,
            attachments: isTeamGoal ? [] : source?.attachments,
            completeSchedule: true
        )
        input.deleteWhenFinished = false
        if await session.saveRoutine(input, original: nil) != nil {
            Haptics.success()
            NotificationCenter.default.post(name: .groupPanelRoutinesChanged, object: room.id)
            close()
        }
    }
}
