// A routine (reference 05), its instruction and the bot's instructions as a
// text card (06), and the picture framing sheet of the Character card.
//
// The routine screens use 16 pt side margins (measure-chat-profile.md §4).
import CompanionCore
import SwiftUI
import UIKit

// MARK: - Title bar

/// Back circle and an inline 14 pt medium title 16.7 pt after it.
struct RoutineTitleBar<Trailing: View>: View {
    @Environment(\.themePalette) var themePalette
    let title: String
    let back: () -> Void
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 0) {
            ProfileBackButton(action: back)
            Text(verbatim: title)
                .font(Theme.Font.bodyMedium)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .padding(.leading, 16.7)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("routine-title")
            Spacer(minLength: 8)
            trailing()
        }
        .padding(.horizontal, Theme.Metric.screenEdge)
        .padding(.top, 6)
    }
}

/// A pushed screen on the routine grid: the title bar over scrolling cards.
struct RoutineScreen<Content: View, Trailing: View>: View {
    @Environment(\.themePalette) var themePalette
    let title: String
    @ViewBuilder var trailing: () -> Trailing
    @ViewBuilder var content: () -> Content
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack(alignment: .top) {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 0, content: content)
                    .padding(.top, 128)
                    .padding(.bottom, 40)
            }
            .ignoresSafeArea()
            ProfileTopFade().ignoresSafeArea()
            RoutineTitleBar(title: title, back: { dismiss() }, trailing: trailing)
        }
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden(true)
        .background(SwipeBackBridge())
        .persistentSystemOverlays(.hidden)
    }
}

// MARK: - Routine detail (05)

struct RoutineDetailView: View {
    @Environment(\.themePalette) var themePalette
    @State var routine: Routine
    /// The parity harness opens the instruction straight away (06).
    var showsInstruction = false
    var onChange: () async -> Void = {}

    @EnvironmentObject private var session: Session
    @State private var runs: [RoutineRun] = []
    @State private var showingInstruction = false
    /// Lot 5: run history is its own page (reference app layout).
    @State private var showingHistory = false
    @State private var editing = false
    /// Duplicate (2026-10-29): the editor opens on a copy.
    @State private var duplicating = false
    @State private var starting = false
    @State private var saving = false
    @State private var confirmingDelete = false
    @Environment(\.dismiss) private var dismissScreen

    private let margin = Theme.Profile.routineMargin

    private var instructionText: String {
        RoutineDetailSections.instructionBody(routine.prompt)
            ?? String(localized: "No instructions yet.")
    }

    var body: some View {
        RoutineScreen(title: routine.name) {
            GlassCircleButton(systemImage: routine.mayEdit ? "pencil" : "eye", accessibilityLabel: routine.mayEdit ? LocalizedStringKey("Edit routine") : LocalizedStringKey("Routine"), glyphSize: 17) { editing = true }
                .chatGlassRim(Circle())
                // BP12: a long press offers Delete, as the desktop's routine
                // panel does beside Pause and Edit (RoutinesSection.tsx)
                .contextMenu {
                    Button(routine.mayEdit ? String(localized: "Edit routine") : String(localized: "Routine"), systemImage: routine.mayEdit ? "pencil" : "eye") { editing = true }
                    Button(String(localized: "Duplicate"), systemImage: "plus.square.on.square") { duplicating = true }
                        .accessibilityIdentifier("routine-duplicate")
                    if session.surfaceGate.allows(.routineDelete) {
                        Button(String(localized: "Delete routine"), systemImage: "trash", role: .destructive) { confirmingDelete = true }
                            .accessibilityIdentifier("routine-delete")
                    }
                }
                .accessibilityIdentifier("routine-edit")
        } content: {
            ProfileCard(margin: margin) {
                ProfileRow(title: Text("Active"), height: Theme.Profile.toggleRow) {
                    Toggle("", isOn: Binding(get: { routine.enabled }, set: { value in Task { await setEnabled(value) } }))
                        .labelsHidden()
                        .toggleStyle(ParityToggleStyle(width: Theme.Profile.toggle.width, height: Theme.Profile.toggle.height))
                        .padding(.trailing, Theme.Profile.textInset)
                        .disabled(saving || !routine.canToggle())
                        .accessibilityIdentifier("routine-active")
                }
                // 2026-10-29: Run now, within reach, as on the desktop's
                // routine page; the run opens at once.
                if routine.mayRun {
                    ProfileDivider(leading: Theme.Profile.textInset)
                    Button {
                        Haptics.selection()
                        Task { await runNow() }
                    } label: {
                        ProfileRow(title: Text("Run now"), titleColor: Theme.accent, height: Theme.Profile.singleRow) {
                            if starting { ProgressView().controlSize(.small).padding(.trailing, Theme.Profile.textInset) }
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(starting || runs.contains { $0.isActive })
                    .accessibilityIdentifier("routine-run-now")
                }
            }

            // Lot 5: Instruction text visible on the detail (reference app).
            ProfileSectionLabel(text: "Instruction", margin: margin)
                .padding(.top, Theme.Profile.cardGap)
            TextCardBody(text: instructionText)
                .accessibilityIdentifier("routine-instruction")

            ProfileSectionLabel(text: "Schedule", margin: margin)
                .padding(.top, Theme.Profile.cardGap)
            ProfileCard(margin: margin) {
                ProfileRow(
                    title: Text(verbatim: RoutineWording.compact(routine.schedule)),
                    height: Theme.Profile.singleRow
                ) { EmptyView() }
                .accessibilityIdentifier("routine-schedule")
            }

            if RoutineDetailSections.showsWebhook(routine.schedule) {
                ProfileSectionLabel(text: "Webhook", margin: margin)
                    .padding(.top, Theme.Profile.cardGap)
                ProfileCard(margin: margin) {
                    RoutineWebhookPanel(
                        routine: routine,
                        bot: session.state.bot(routine.botId),
                        onRoutineChanged: { routine = $0 }
                    )
                    .padding(.horizontal, Theme.Profile.textInset)
                    .padding(.vertical, 12)
                }
                .accessibilityIdentifier("routine-webhook-section")
            }

            // Lot 5: Run history is a page, not an inline list.
            ProfileCard(margin: margin) {
                Button {
                    Haptics.selection()
                    showingHistory = true
                } label: {
                    ProfileRow(title: Text("Run history"), height: Theme.Profile.singleRow) {
                        ProfileChevronTrailing()
                    }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("routine-run-history")
            }
            .padding(.top, Theme.Profile.cardGap)
        }
        .navigationDestination(isPresented: $showingInstruction) {
            TextCardView(title: String(localized: "Instruction"), text: routine.prompt)
        }
        .navigationDestination(isPresented: $showingHistory) {
            RoutineRunHistoryView(
                routine: routine,
                runs: $runs,
                onOpen: { run in Task { await session.openRoutineRunInChat(run) } },
                onCancel: { run in await cancel(run) }
            )
        }
#if DEBUG
        // captures only (`-parityOpenRoutineEditor YES`): the editor open
        .task { if UserDefaults.standard.bool(forKey: "parityOpenRoutineEditor") { try? await Task.sleep(nanoseconds: 1_500_000_000); editing = true } }
#endif
        .sheet(isPresented: $editing) {
            RoutineEditorView(routine: routine) { await reload() }
        }
        .sheet(isPresented: $duplicating) {
            RoutineEditorView(routine: nil, copyOf: routine) { await onChange() }
        }
        .confirmationDialog(
            String(localized: "Delete \(routine.name)?"),
            isPresented: $confirmingDelete,
            titleVisibility: .visible
        ) {
            Button(String(localized: "Delete routine"), role: .destructive) {
                Task {
                    guard await session.deleteRoutine(routine) else { return }
                    await onChange()
                    dismissScreen()
                }
            }
        } message: {
            Text("Past run receipts remain available.")
        }
        .task {
            await reload()
            if showsInstruction {
                // a push while this screen's own push still animates is dropped
                try? await Task.sleep(nanoseconds: 900_000_000)
                showingInstruction = true
            }
        }
    }

    private func setEnabled(_ enabled: Bool) async {
        saving = true
        defer { saving = false }
        if let updated = await session.setRoutineEnabled(routine, enabled: enabled) {
            routine = updated
            await onChange()
        }
    }

    private func runNow() async {
        starting = true
        defer { starting = false }
        guard let started = await session.runRoutine(routine) else { return }
        runs = [started] + runs.filter { $0.id != started.id }
        // #2098: the started run, in the bot's chat
        await session.openRoutineRunInChat(started)
    }

    private func cancel(_ run: RoutineRun) async {
        if let updated = await session.cancelRoutineRun(run) {
            runs = RoutineRunLog.replacing(runs, with: [updated])
        }
    }

    private func reload() async {
        let loaded = await session.loadRoutines()
        if let fresh = loaded.routines.first(where: { $0.id == routine.id }) { routine = fresh }
        runs = loaded.runs.forRoutine(routine.id)
        await onChange()
    }
}

/// Lot 5: the routine's run history as its own page. A run opens in the
/// bot's chat, at its message (#2098).
struct RoutineRunHistoryView: View {
    @Environment(\.themePalette) var themePalette
    let routine: Routine
    @Binding var runs: [RoutineRun]
    var onOpen: (RoutineRun) -> Void
    var onCancel: (RoutineRun) async -> Void

    @EnvironmentObject private var session: Session
    private let margin = Theme.Profile.routineMargin

    var body: some View {
        RoutineScreen(title: String(localized: "Run history")) { EmptyView() } content: {
            ProfileCard(margin: margin) {
                if runs.isEmpty {
                    ProfileRow(title: Text("No runs yet"), titleColor: Theme.textDisabled, height: Theme.Profile.singleRow)
                        .accessibilityIdentifier("routine-no-runs")
                } else {
                    ForEach(Array(runs.prefix(50).enumerated()), id: \.element.id) { index, run in
                        if index > 0 { ProfileDivider(leading: Theme.Profile.textInset) }
                        Button {
                            Haptics.selection()
                            onOpen(run)
                        } label: {
                            RunHistoryRow(
                                run: run,
                                unseen: session.surfaceGate.allows(.routineRunsSeen) && run.isUnseenProblem
                            )
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            if run.isActive && session.surfaceGate.allows(.routineRunCancel) {
                                Button(String(localized: "Cancel run"), systemImage: "xmark", role: .destructive) {
                                    Task { await onCancel(run) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// One past run: when it was due and how it went (relative date, status
/// colour, duration and cost on the subtitle).
struct RunHistoryRow: View {
    @Environment(\.themePalette) var themePalette
    let run: RoutineRun
    /// A failed or missed run nobody opened: the red dot (AU9).
    var unseen = false

    /// Lot 5: duration and cost on the sub-line (preview stays for density).
    private var subtitle: Text? {
        let parts = [RoutineRunWording.duration(run), RoutineRunWording.cost(run), run.quiet == true ? nil : run.previewLine].compactMap { $0 }
        return parts.isEmpty ? nil : Text(verbatim: parts.joined(separator: " · "))
    }

    var body: some View {
        ProfileRow(
            title: Text(verbatim: Self.when.string(from: Date(timeIntervalSince1970: (run.startedAt ?? run.scheduledFor) / 1_000))),
            subtitle: subtitle,
            height: subtitle == nil ? Theme.Profile.row : Theme.Profile.routineRow
        ) {
            HStack(spacing: 6) {
                if unseen {
                    Circle().fill(Theme.danger).frame(width: 6, height: 6)
                        .accessibilityLabel(Text("Unseen failure"))
                }
                BotActivityStatusIcon(status: run.activityStatus, size: 13)
                Text(verbatim: status)
                    .font(Theme.Font.body)
                    .foregroundStyle(statusColor)
            }
            .padding(.trailing, 18.7)
        }
        .contentShape(Rectangle())
        .accessibilityIdentifier("routine-run.\(run.id)")
    }

    /// "Today at 4:37 PM", "Yesterday at ...", then the date.
    private static let when: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        formatter.doesRelativeDateFormatting = true
        return formatter
    }()

    /// Green when it went through, red when it did not.
    private var statusColor: Color {
        switch run.status {
        case "completed": Theme.success
        case "failed", "missed": Theme.danger
        default: Theme.textSecondary
        }
    }

    private var status: String {
        switch run.status {
        case "completed": String(localized: "Completed")
        case "running": String(localized: "Running")
        case "waiting": String(localized: "Waiting")
        case "failed": String(localized: "Failed")
        case "missed": String(localized: "Missed")
        case "cancelled": String(localized: "Cancelled")
        case "queued": String(localized: "Queued")
        default: run.status.capitalized
        }
    }
}

// MARK: - Text card (06)

/// A long text in one card: 14 pt on the chat's 18.1 pt pitch, 18 pt in.
struct TextCardBody: View {
    @Environment(\.themePalette) var themePalette
    let text: String

    var body: some View {
        ProfileCard(margin: Theme.Profile.routineMargin) {
            Text(verbatim: text)
                .font(Theme.Font.body)
                .foregroundStyle(Theme.textPrimary)
                .lineSpacing(Theme.bodyLineSpacing)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 18.7)
                .padding(.top, 14.6)
                .padding(.bottom, 14.6)
                .accessibilityIdentifier("text-card-body")
        }
    }
}

struct TextCardView: View {
    @Environment(\.themePalette) var themePalette
    let title: String
    let text: String

    var body: some View {
        RoutineScreen(title: title) { EmptyView() } content: {
            TextCardBody(text: text)
        }
    }
}

// MARK: - The bot's instructions (03 > Instructions)

/// The soul, read from the server; the owner or an admin edits it in place.
struct InstructionView: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    /// The bot panel's Personality sub-page (#3030): titled "Personality",
    /// with "What it does" above the soul, as on the desktop.
    var personality = false
    @EnvironmentObject private var session: Session
    @State private var soul: String?
    @State private var problem: String?
    @State private var editing = false
    @State private var draft = ""
    @State private var saving = false
    @FocusState private var focused: Bool

    var body: some View {
        RoutineScreen(title: personality ? String(localized: "Personality") : String(localized: "Instructions")) {
            if editing {
                HStack(spacing: Theme.Metric.controlGap) {
                    GlassCircleButton(systemImage: "xmark", accessibilityLabel: "Cancel", glyphSize: 16) {
                        editing = false
                    }
                    .chatGlassRim(Circle())
                    .accessibilityIdentifier("instructions-cancel")
                    GlassCircleButton(systemImage: "checkmark", accessibilityLabel: "Save", glyphSize: 17) {
                        Task { await save() }
                    }
                    .chatGlassRim(Circle())
                    .disabled(saving)
                    .accessibilityIdentifier("instructions-save")
                }
            } else if soul != nil, lock == nil {
                GlassCircleButton(systemImage: "pencil", accessibilityLabel: "Edit", glyphSize: 17) {
                    draft = soul ?? ""
                    editing = true
                    focused = true
                }
                .chatGlassRim(Circle())
                .accessibilityIdentifier("instructions-edit")
            }
        } content: {
            if editing {
                ProfileCard(margin: Theme.Profile.routineMargin) {
                    // the markdown editor (desktop SoulField, #258)
                    MarkdownEditor(
                        text: $draft, minHeight: 320,
                        accessibilityLabel: String(localized: "Instructions"), identifier: "instructions-editor"
                    )
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                }
            } else {
                // "What it does" loads on its own, as the desktop overview:
                // a soul that is slow or refused never holds it back (#3061).
                if personality {
                    Text("Its standing instructions. Write as you would talk to it.")
                        .font(Theme.Profile.labelFont)
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, Theme.Profile.routineMargin + 4)
                        .padding(.bottom, 12)
                        .accessibilityIdentifier("panel-page.soul.intro")
                    BotPersonalitySummary(bot: bot).padding(.bottom, 12)
                    ProfileSectionLabel(text: "Personality", margin: Theme.Profile.routineMargin)
                }
                soulBody
            }
        }
        .task { await load() }
    }

    @ViewBuilder
    private var soulBody: some View {
        if let soul {
            if let lock {
                // desktop locked block: the note, then the soul read-only
                // (BotProfilePage `botSectionLock`)
                ProfileCard(margin: Theme.Profile.routineMargin) {
                    PanelLockNote(text: lock)
                        .padding(.horizontal, 16)
                        .accessibilityIdentifier("panel-page.soul.locked")
                    // desktop `data-persona-readonly`: the soul as it
                    // is, in an inset block, not editable
                    if !soul.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text(verbatim: soul)
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                            .lineSpacing(4)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(Theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .padding(.horizontal, 16)
                            .padding(.top, 4)
                            .padding(.bottom, 12)
                            .accessibilityIdentifier("panel-page.soul.readonly")
                    }
                }
            } else {
                soulCards(soul)
            }
        } else if let problem {
            TextCardBody(text: problem)
        } else {
            ProgressView().padding(.top, 40)
        }
    }

    /// Why this viewer may not change the soul (desktop `botSectionLock`).
    private var lock: LocalizedStringKey? {
        session.sectionLock(session.state.bot(bot.id) ?? bot, .soul)
    }

    @ViewBuilder
    private func soulCards(_ soul: String) -> some View {
        TextCardBody(text: soul.isEmpty ? String(localized: "No instructions yet.") : soul)
        // RULES.md and docs/ beside the soul (#269)
        BotWorkspaceShortcuts(bot: bot)
            .padding(.horizontal, Theme.Profile.routineMargin)
            .padding(.top, 12)
        // #1329: the bot's "do not finish until" condition
        ProfileCard(margin: Theme.Profile.routineMargin) {
            FinishUntilEditor(bot: session.state.bots.first { $0.id == bot.id } ?? bot)
                .padding(14)
        }
        .padding(.top, 12)
    }

    private func load() async {
        #if DEBUG
        // `-previewSoul <text>` (store preview captures): no server to ask
        if session.profileClient == nil, let preview = UserDefaults.standard.string(forKey: "previewSoul") {
            soul = preview
            return
        }
        #endif
        guard let client = session.profileClient else { return }
        do { soul = try await client.soul(botId: bot.id).soul } catch { problem = error.localizedDescription }
    }

    private func save() async {
        guard let client = session.profileClient else { return }
        saving = true
        defer { saving = false }
        do {
            let updated = try await client.saveSoul(botId: bot.id, soul: draft)
            session.applyProfileBot(updated)
            soul = draft
            editing = false
        } catch {
            session.actionError = error.localizedDescription
        }
    }
}

// MARK: - Picture framing

/// Pinch to zoom and drag to move the picture in its frame; saved as
/// `avatarZoom` and `avatarFocusX/Y`.
struct PictureFramingSheet: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    let save: (Double, Double, Double) -> Void

    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?
    @State private var zoom: Double
    @State private var focusX: Double
    @State private var focusY: Double
    @State private var startZoom: Double?
    @State private var startFocus: (Double, Double)?

    private let box: CGFloat = 240

    init(bot: Bot, save: @escaping (Double, Double, Double) -> Void) {
        self.bot = bot
        self.save = save
        let framing = bot.framing
        _zoom = State(initialValue: framing.zoom)
        _focusX = State(initialValue: framing.focusX)
        _focusY = State(initialValue: framing.focusY)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()
                ZStack {
                    if let image {
                        FramedPicture(
                            image: image, size: box,
                            crop: bot.avatarCrop.flatMap { $0 == .mascot ? nil : $0 } ?? .circle,
                            zoom: zoom, focusX: focusX, focusY: focusY
                        )
                    } else {
                        ProgressView()
                    }
                }
                .frame(width: box, height: box)
                .contentShape(Rectangle())
                .gesture(drag.simultaneously(with: pinch))
                .accessibilityIdentifier("framing-picture")
                Text("Pinch to zoom, drag to move.")
                    .font(Theme.Font.profileLabel)
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
            }
            .frame(maxWidth: .infinity)
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(Text("Frame picture"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(String(localized: "Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Save")) {
                        save(zoom, focusX, focusY)
                        dismiss()
                    }
                    .accessibilityIdentifier("framing-save")
                }
            }
        }
        .task {
            if let data = await session.avatarData(for: bot) { image = await ImageDecoding.prepared(data) }
        }
    }

    private var pinch: some Gesture {
        MagnificationGesture()
            .onChanged { value in
                let start = startZoom ?? zoom
                startZoom = start
                zoom = min(3, max(1, start * value))
            }
            .onEnded { _ in startZoom = nil }
    }

    private var drag: some Gesture {
        DragGesture()
            .onChanged { value in
                let start = startFocus ?? (focusX, focusY)
                startFocus = start
                // moving the picture right shows more of its left side
                let scale = Double(box) * zoom
                focusX = min(1, max(0, start.0 - value.translation.width / scale))
                focusY = min(1, max(0, start.1 - value.translation.height / scale))
            }
            .onEnded { _ in startFocus = nil }
    }
}
