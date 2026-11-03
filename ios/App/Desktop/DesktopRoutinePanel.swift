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
                    instruction
                    if routine.schedule.type == .webhook {
                        section(Text("Webhook")) {
                            RoutineWebhookPanel(routine: routine, bot: bot)
                        }
                    }
                    if editing { advanced }
                    runsList
                }
                .padding(16)
            }
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
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
        .confirmationDialog(String(localized: "Clear run logs?"), isPresented: $confirmingClear, titleVisibility: .visible) {
            Button(String(localized: "Clear logs"), role: .destructive) {
                Task {
                    if let client = session.settingsClient { _ = try? await client.clearRoutineRuns(routineId: routine.id) }
                    await changed()
                }
            }
        } message: {
            Text("This permanently deletes all the saved runs you can see. Runs in progress are kept.")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-routine-panel")
    }

    private func seed() {
        name = routine.name
        prompt = routine.prompt
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 8) {
            Button(action: close) {
                Image(systemName: "chevron.left").font(.system(size: 14, weight: .medium)).frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.textSecondary)
            .accessibilityLabel(Text("Back"))
            if editing {
                TextField(String(localized: "Name"), text: $name)
                    .font(Theme.font(16, .semibold))
                    .accessibilityIdentifier("desktop-routine-panel.name")
            } else {
                Text(verbatim: routine.name).font(Theme.font(16, .semibold)).foregroundStyle(Theme.textPrimary).lineLimit(1)
            }
            Spacer(minLength: 0)
            Button(action: close) {
                Image(systemName: "sidebar.right").font(.system(size: 14)).frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.textSecondary)
            .accessibilityLabel(Text("Hide the panel"))
        }
        .padding(.horizontal, 10)
        .frame(minHeight: 52)
    }

    // MARK: Rows

    private var rows: some View {
        VStack(spacing: 0) {
            Button { openEditor(routine) } label: {
                row(Text("Trigger")) {
                    HStack(spacing: 6) {
                        Text(verbatim: RoutineWording.desktop(routine.schedule)).lineLimit(1)
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
                    }
                    .foregroundStyle(Theme.textPrimary)
                }
            }
            .buttonStyle(.plain)
            .disabled(!routine.mayEdit)
            .accessibilityIdentifier("desktop-routine-panel.trigger")
            if !editing {
                divider
                row(Text("Runs as")) {
                    HStack(spacing: 6) {
                        if let bot { BotMascotView(bot: bot, size: 20).frame(width: 20, height: 20) }
                        Text(verbatim: bot?.name ?? String(localized: "Deleted agent")).foregroundStyle(Theme.textPrimary)
                    }
                }
                divider
                row(Text("Active")) {
                    Toggle("", isOn: Binding(get: { routine.enabled }, set: { _ in Task { await toggle() } }))
                        .labelsHidden()
                        .tint(Theme.accent)
                        .disabled(!(routine.mayEdit && routine.canToggle()))
                        .accessibilityIdentifier("desktop-routine-panel.active")
                }
            }
            divider
            row(Text("Next run")) {
                Text(verbatim: nextRun).foregroundStyle(Theme.textSecondary)
            }
            divider
            row(Text("This week")) {
                Text(verbatim: thisWeek).foregroundStyle(Theme.textSecondary)
            }
        }
        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.card))
    }

    private var divider: some View { Rectangle().fill(Theme.hairline.opacity(0.6)).frame(height: 0.5).padding(.leading, 12) }

    private func row<Trailing: View>(_ label: Text, @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(spacing: 12) {
            label.font(Theme.font(13)).foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 8)
            trailing().font(Theme.font(13))
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
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
                    ComposerPrefill.shared.set(String(localized: "Reformat the instruction of the routine \"\(routine.name)\" so it reads clearly, keeping what it asks. Here it is:\n\n\(routine.prompt)"), threadId: bot.threadId)
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

    private var runsList: some View {
        section(Text("Runs (\(String(mine.count)))"), trailing: {
            Button { confirmingClear = true } label: {
                Image(systemName: "trash").font(.system(size: 12)).foregroundStyle(Theme.textSecondary).frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .disabled(mine.isEmpty)
            .hoverEffect(.highlight)
            .accessibilityLabel(Text("Clear logs"))
            .accessibilityIdentifier("desktop-routine-panel.clear-runs")
        }) {
            VStack(spacing: 0) {
                if mine.isEmpty {
                    Text("No runs yet.").font(Theme.font(13)).foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity, minHeight: 60)
                }
                ForEach(mine.prefix(20)) { run in
                    Button { openRun(run) } label: {
                        HStack(spacing: 8) {
                            Circle().fill(statusColor(run)).frame(width: 7, height: 7)
                            Text(verbatim: Date(timeIntervalSince1970: run.scheduledFor / 1000).formatted(date: .abbreviated, time: .shortened))
                                .font(Theme.font(12.5)).foregroundStyle(Theme.textPrimary)
                            Spacer(minLength: 0)
                            Text(verbatim: run.status.capitalized).font(Theme.font(12)).foregroundStyle(Theme.textSecondary)
                        }
                        .padding(.horizontal, 12)
                        .frame(minHeight: 40)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .background(RoundedRectangle(cornerRadius: 12).fill(Theme.card))
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

    private var bottomBar: some View {
        HStack(spacing: 8) {
            if editing {
                Button("Cancel") { editing = false; seed() }
                    .buttonStyle(.bordered)
                Button("Save") { Task { await save() } }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                    .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityIdentifier("desktop-routine-panel.save")
            } else {
                Button { Task { _ = await session.runRoutine(routine); await changed() } } label: {
                    Label("Run now", systemImage: "play.fill")
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .disabled(!routine.mayRun)
                .accessibilityIdentifier("desktop-routine-panel.run")
                Button { editing = true } label: { Label("Edit", systemImage: "pencil") }
                    .buttonStyle(.bordered)
                    .disabled(!routine.mayEdit)
                    .accessibilityIdentifier("desktop-routine-panel.edit")
                Button(routine.enabled ? String(localized: "Disable") : String(localized: "Enable")) { Task { await toggle() } }
                    .buttonStyle(.bordered)
                    .disabled(!(routine.mayEdit && routine.canToggle()))
            }
            Spacer(minLength: 0)
            Button(role: .destructive) { confirmingDelete = true } label: {
                Image(systemName: "trash").frame(width: 32, height: 32)
            }
            .buttonStyle(.bordered)
            .disabled(!routine.mayEdit)
            .accessibilityLabel(Text("Delete"))
            .accessibilityIdentifier("desktop-routine-panel.delete")
        }
        .controlSize(.small)
        .font(Theme.font(12.5, .medium))
        .padding(12)
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
