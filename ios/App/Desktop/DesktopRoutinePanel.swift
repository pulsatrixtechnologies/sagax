// iPad lot 5 (2026-11-03): the routine side panel of the desktop's
// Automations page, drawn to the new Grok Bot design (feat/routine-panel-grok,
// the coordinator's brief):
// - header "‹ <name>" and the panel toggle;
// - Trigger (a row that opens the schedule editor), Runs as (the bot),
//   Active (a switch), Next run and This week (read-only);
// - Instruction as flowing text with Show more, and "Format with AI",
//   which puts a reformat request in the bot's composer without sending it;
// - a webhook routine's Webhook section (POST to, key, header);
// - Runs (N), then the runs;
// - the bottom bar: Run now, Edit, Disable or Enable, Delete (confirmed).
// Edit mode keeps the layout, the name and the instruction editable in
// place, Cancel, Save and the trash, then Advanced as rows (Trigger and
// Duplicate); Runs as and Active are not repeated there.
import SwiftUI
import UIKit
import CompanionCore

struct DesktopRoutinePanel: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var shell: DesktopShellModel
    let routine: Routine
    let runs: [RoutineRun]
    let close: () -> Void
    let changed: () async -> Void
    let openRun: (RoutineRun) -> Void
    let openEditor: (Routine) -> Void
    let duplicate: (Routine) -> Void

    @State private var editing = false
    @State private var name = ""
    @State private var prompt = ""
    @State private var expanded = false
    @State private var confirmingDelete = false
    @State private var confirmingClear = false
    @State private var busy = false

    private var bot: Bot? { session.state.bot(routine.botId) }
    private var mine: [RoutineRun] { runs.filter { $0.routineId == routine.id }.sorted { $0.scheduledFor > $1.scheduledFor } }

    var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    rows
                    if editing { instruction }
                    if routine.schedule.type == .webhook {
                        section(Text("Webhook")) {
                            RoutineWebhookPanel(routine: routine, bot: bot)
                        }
                    }
                    if editing { advanced }
                    runsList
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
            }
            Rectangle().fill(Theme.hairline.opacity(0.4)).frame(height: 0.5)
            bottomBar
        }
        .background(Theme.bg)
        .onAppear(perform: seed)
        .onValueChange(of: routine.id) { _ in editing = false; seed() }
        .confirmationDialog(String(localized: "Delete \(routine.name)?"), isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete routine", role: .destructive) {
                Task {
                    if await session.deleteRoutine(routine) { close(); await changed() }
                }
            }
        } message: {
            Text("Past run receipts remain available.")
        }
        // RoutineLogs.tsx: Clear logs, confirmed, for this routine only
        .confirmationDialog(String(localized: "Clear the run logs of “\(routine.name)”?"), isPresented: $confirmingClear, titleVisibility: .visible) {
            Button(String(localized: "Clear run logs"), role: .destructive) {
                Task {
                    if let client = session.settingsClient { _ = try? await client.clearRoutineRuns(routineId: routine.id) }
                    await changed()
                }
            }
        } message: {
            Text("Your saved runs of this routine are deleted for good. Runs in progress are kept.")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-routine-panel")
    }

    private func seed() {
        name = routine.name
        prompt = routine.prompt
    }

    // MARK: Header

    /// RoutineCalendarPage's panel header: the bot's colour square, the
    /// name 14 medium (a field while editing), the round × that closes.
    private var header: some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(MausPalette.color(bot?.color ?? ""))
                .frame(width: 10, height: 10)
            if editing {
                TextField(String(localized: "Name"), text: $name)
                    .font(Theme.font(14, .medium))
                    .accessibilityIdentifier("desktop-routine-panel.name")
            } else {
                Text(verbatim: routine.name).font(Theme.font(14, .medium)).foregroundStyle(Theme.textPrimary).lineLimit(1)
            }
            Spacer(minLength: 0)
            Button(action: close) {
                Image(systemName: "xmark").font(.system(size: 12, weight: .medium)).frame(width: 30, height: 30)
                    .overlay(Circle().strokeBorder(Theme.hairline.opacity(0.6), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.textSecondary)
            .hoverEffect(.highlight)
            .accessibilityLabel(Text("Close"))
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 52)
    }

    // MARK: Rows

    /// PanelRows: label 13 secondary at the left, the value 13 at the
    /// right, one hairline between rows, no card.
    private var rows: some View {
        VStack(spacing: 0) {
            Button { openEditor(routine) } label: {
                row(Text("Trigger")) {
                    HStack(spacing: 4) {
                        Text(verbatim: triggerText).lineLimit(1)
                        Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.textTertiary)
                    }
                    .foregroundStyle(Theme.textPrimary)
                }
            }
            .buttonStyle(.plain)
            .disabled(!routine.mayEdit)
            .accessibilityIdentifier("desktop-routine-panel.trigger")
            if !editing {
                if let runAs = routine.runAs {
                    divider
                    row(Text("Runs as")) { Text(verbatim: runAs.name).foregroundStyle(Theme.textPrimary) }
                }
                divider
                row(Text("Active")) {
                    PanelSwitch(label: "Active", isOn: routine.enabled, disabled: !(routine.mayEdit && routine.canToggle()),
                                onColor: BubbleColors.user(botColor: bot?.color)?.fill.color) { _ in
                        Task { await toggle() }
                    }
                    .accessibilityIdentifier("desktop-routine-panel.active")
                }
            }
            divider
            row(Text("Next run")) {
                Text(verbatim: nextRun).foregroundStyle(Theme.textPrimary)
            }
            if let week = routine.weekRuns {
                divider
                row(Text("This week")) {
                    Text(week.total == 1 ? String(localized: "\(String(week.ok)) of 1 run OK this week") : String(localized: "\(String(week.ok)) of \(String(week.total)) runs OK this week"))
                        .foregroundStyle(Theme.textPrimary)
                }
            }
        }
    }

    private var divider: some View { Rectangle().fill(Theme.hairline.opacity(0.3)).frame(height: 0.5) }

    private func row<Trailing: View>(_ label: Text, @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(spacing: 12) {
            label.font(Theme.font(13)).foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 8)
            trailing().font(Theme.font(13))
        }
        .frame(minHeight: 48)
        .contentShape(Rectangle())
    }

    /// `scheduleLabel` and its zone, as the list row says it.
    private var triggerText: String {
        var parts = [RoutineWording.desktop(routine.schedule)]
        if let zone = routine.schedule.timeZone, !zone.isEmpty { parts.append(zone) }
        return parts.joined(separator: " · ")
    }

    private var nextRun: String {
        guard routine.enabled, let next = routine.nextRunAt else { return String(localized: "None") }
        let date = Date(timeIntervalSince1970: next / 1000)
        let time = date.formatted(date: .omitted, time: .shortened)
        if Calendar.current.isDateInToday(date) { return String(localized: "Today at \(time)") }
        if Calendar.current.isDateInTomorrow(date) { return String(localized: "Tomorrow at \(time)") }
        return "\(date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())), \(time)"
    }

    private var thisWeek: String {
        let start = AutomationsWeekView.weekStart(Date())
        let count = (0..<7).reduce(0) { total, offset in
            total + RoutineCalendar.day(RoutineCalendar.addDays(start, offset), routines: [routine], runs: [], botId: nil).count
        }
        return count == 1 ? String(localized: "1 run") : String(localized: "\(count) runs")
    }

    // MARK: Instruction

    private var instruction: some View {
        section(Text("Instruction"), trailing: {
            if !editing, let bot {
                Button {
                    ComposerPrefill.shared.set(String(localized: "Please reformat the instruction of my routine “\(routine.name)” (id \(routine.id)) so it is better structured and easier to read: headings, numbered steps, short sentences. Keep every rule, fact, date and decision exactly as it is and change no meaning. Then update routine “\(routine.name)” (id \(routine.id)) with the result through your routine edit tool (propose_routine_action, action update, changes.instructions), and show me the before and after."), threadId: bot.threadId)
                    shell.open(.bot(bot))
                } label: {
                    Label("Format with AI", systemImage: "sparkles").font(Theme.font(12))
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.textSecondary)
                .accessibilityIdentifier("desktop-routine-panel.format")
            }
        }) {
            if editing {
                TextEditor(text: $prompt)
                    .font(Theme.font(13))
                    .frame(minHeight: 160)
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Theme.card))
                    .accessibilityIdentifier("desktop-routine-panel.prompt")
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text(verbatim: routine.prompt)
                        .font(Theme.font(13))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(expanded ? nil : 6)
                        .textSelection(.enabled)
                    if routine.prompt.count > 320 || routine.prompt.split(separator: "\n").count > 6 {
                        Button(expanded ? String(localized: "Show less") : String(localized: "Show more")) { expanded.toggle() }
                            .font(Theme.font(12, .medium))
                            .foregroundStyle(Theme.accent)
                    }
                }
            }
        }
    }

    // MARK: Advanced (edit mode)

    private var advanced: some View {
        section(Text("Advanced")) {
            VStack(spacing: 0) {
                Button { openEditor(routine) } label: {
                    row(Text("Schedule, duration and results")) {
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textSecondary)
                    }
                }
                .buttonStyle(.plain)
                divider
                Button { duplicate(routine) } label: {
                    row(Text("Duplicate")) {
                        Image(systemName: "plus.square.on.square").font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("desktop-routine-panel.duplicate")
            }
            .background(RoundedRectangle(cornerRadius: 12).fill(Theme.card))
        }
    }

    // MARK: Runs

    /// "Runs" 12 medium secondary with its count in a pill, the eraser
    /// (Clear run logs) at the right; no runs: the dashed box.
    private var runsList: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text("Runs").font(Theme.font(12, .medium)).foregroundStyle(Theme.textSecondary)
                if !mine.isEmpty {
                    Text(verbatim: "\(mine.count)").font(Theme.font(10.5)).foregroundStyle(Theme.textSecondary)
                        .padding(.horizontal, 6).background(Capsule().fill(Theme.card))
                }
                Spacer(minLength: 0)
                if !mine.isEmpty {
                    Button { confirmingClear = true } label: {
                        Image(systemName: "eraser").font(.system(size: 13)).foregroundStyle(Theme.textTertiary).frame(width: 28, height: 28)
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.highlight)
                    .accessibilityLabel(Text("Clear run logs"))
                    .accessibilityIdentifier("desktop-routine-panel.clear-runs")
                }
            }
            if mine.isEmpty {
                Text("No runs yet.").font(Theme.font(12.5)).foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, minHeight: 60)
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hairline.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            }
            VStack(spacing: 2) {
                ForEach(mine.prefix(20)) { run in
                    Button { openRun(run) } label: {
                        HStack(spacing: 8) {
                            Circle().fill(statusColor(run)).frame(width: 7, height: 7)
                            Text(verbatim: Date(timeIntervalSince1970: run.scheduledFor / 1000).formatted(date: .abbreviated, time: .shortened))
                                .font(Theme.font(12.5)).foregroundStyle(Theme.textPrimary)
                            Spacer(minLength: 0)
                            Text(verbatim: run.status.capitalized).font(Theme.font(12)).foregroundStyle(Theme.textSecondary)
                        }
                        .padding(.horizontal, 8)
                        .frame(minHeight: 36)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.highlight)
                }
            }
        }
    }

    private func statusColor(_ run: RoutineRun) -> Color {
        switch run.status {
        case "completed", "succeeded", "done": Theme.success
        case "failed", "error": Theme.danger
        case "running", "queued", "waiting": Theme.accent
        default: Theme.textTertiary
        }
    }

    // MARK: Bottom bar

    /// The action row: Run now (the primary pill), Edit, Disable or
    /// Enable, and the round trash at the far right; editing: Cancel, Save.
    private var bottomBar: some View {
        HStack(spacing: 8) {
            if editing {
                pill(Text("Cancel"), icon: nil) { editing = false; seed() }
                pill(Text("Save"), icon: nil, primary: true) { Task { await save() } }
                    .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityIdentifier("desktop-routine-panel.save")
            } else {
                if routine.mayRun {
                    pill(Text("Run now"), icon: "play.fill", primary: true) { Task { _ = await session.runRoutine(routine); await changed() } }
                        .accessibilityIdentifier("desktop-routine-panel.run")
                }
                if routine.mayEdit {
                    pill(Text("Edit"), icon: "pencil") { editing = true }
                        .accessibilityIdentifier("desktop-routine-panel.edit")
                    pill(routine.enabled ? Text("Disable") : Text("Enable"), icon: routine.enabled ? "pause" : "play.circle") { Task { await toggle() } }
                        .disabled(!routine.canToggle())
                }
            }
            Spacer(minLength: 0)
            if routine.mayEdit {
                Button { confirmingDelete = true } label: {
                    Image(systemName: "trash").font(.system(size: 14)).foregroundStyle(Theme.textSecondary).frame(width: 36, height: 36)
                        .overlay(Circle().strokeBorder(Theme.hairline.opacity(0.5), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityLabel(Text("Delete"))
                .accessibilityIdentifier("desktop-routine-panel.delete")
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
    }

    /// `PILL` / `PRIMARY_PILL` (ui-button): 13 medium, 32 tall; the
    /// primary one is the ink fill with the panel's colour for its text.
    private func pill(_ label: Text, icon: String?, primary: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon { Image(systemName: icon).font(.system(size: 11, weight: .semibold)) }
                label.font(Theme.font(13, .medium))
            }
            .foregroundStyle(primary ? Theme.bg : Theme.textPrimary)
            .padding(.horizontal, 12).frame(height: 32)
            .background(Capsule().fill(primary ? Theme.textPrimary : Theme.card))
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
    }

    // MARK: Pieces

    private func section<Trailing: View, Content: View>(
        _ title: Text, @ViewBuilder trailing: () -> Trailing = { EmptyView() }, @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                title.font(Theme.font(13, .semibold)).foregroundStyle(Theme.textPrimary)
                Spacer(minLength: 0)
                trailing()
            }
            content()
        }
    }

    private func toggle() async {
        guard routine.mayEdit, routine.canToggle() else { return }
        _ = await session.setRoutineEnabled(routine, enabled: !routine.enabled)
        await changed()
    }

    private func save() async {
        busy = true
        defer { busy = false }
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let input = RoutineInput(
            name: String(trimmedName.prefix(80)),
            prompt: String(prompt.trimmingCharacters(in: .whitespacesAndNewlines).prefix(20_000)),
            botId: routine.botId, runOn: routine.runOn, schedule: routine.schedule,
            durationMinutes: routine.durationMinutes, timeoutMinutes: routine.timeoutMinutes
        )
        if await session.saveRoutine(input, original: routine) != nil {
            editing = false
            await changed()
        }
    }
}
