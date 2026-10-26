// iPad I4b: the bot panel's Details tab as the current desktop draws it
// (`BotSettingsDialog.tsx` "details"): the ongoing activities first, at the
// top and only while something runs (#483: they replaced the rail beside
// the chat), then Coding, the bot's live work
// (`bot-settings/ActivitySection.tsx`, `ActivityCard.tsx`), All history
// when neither shows, then its
// Routines in one grouped card (`RoutinesSection` with `grouped`), and the
// name, label and description fields edited in place at the panel's top
// (`InlineEditableText.tsx`).
//
// Sizes from desktop-1366x1024-33-panel-details.json: the body 16 pt in,
// 8 pt from the tabs, sections 24 apart. A section header is a 22 pt button
// (16 pt glyph, 8 gap, title 13/18 secondary; its chevron shows on hover)
// over the list 8 below; "Nothing running." 12.5/18.75 tertiary when idle.
// A card: rounded-xl, hairline-weak ring, `card` fill, px 12 py 10, the
// 16 pt status icon, title 13/18 and status line 12/17. Routines: the 28 pt
// header (glyph, title, New and Run logs) 12 above one rounded card whose
// rows (px 12, py 10, 57 tall with the hairline) hold name and state 13/18
// and the 44x20 switch.
//
// The history and an entry's detail open the phone's own views
// (BotActivitySheet) as a sheet, so there is one implementation of each.
import SwiftUI
import UIKit
import CompanionCore

// MARK: - Inline text

/// Text that reads as plain text and becomes a field on a tap
/// (`InlineEditableText`): Return or leaving the field saves
/// (`DesktopInlineEdit.commit`), Escape restores. Its button is px 6 py 2
/// around the text and an 11 pt pencil that shows on hover.
struct PanelInlineText: View {
    @Environment(\.desktopTheme) private var theme
    let value: String
    let placeholder: LocalizedStringKey?
    let label: LocalizedStringKey
    let size: CGFloat
    let lineHeight: CGFloat
    var weight: Font.Weight = .regular
    var muted = false
    var limit = 200
    var required = false
    @Binding var isEditing: Bool
    let onSave: (String) -> Void

    @State private var draft = ""
    @State private var hovering = false
    @FocusState private var focused: Bool

    private var shown: String { value.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        if isEditing {
            AnyView(field)
        } else {
            AnyView(text)
        }
    }

    private var text: some View {
        Button {
            draft = value
            isEditing = true
        } label: {
            HStack(spacing: 4) {
                Group {
                    if shown.isEmpty, let placeholder {
                        Text(placeholder)
                    } else {
                        Text(verbatim: shown)
                    }
                }
                .font(theme.font(size, weight))
                .foregroundStyle(shown.isEmpty || muted ? theme.inkSecondary : theme.ink)
                .lineLimit(1)
                .truncationMode(.tail)
                Image(systemName: "pencil")
                    .font(.system(size: 9.5, weight: .medium))
                    .foregroundStyle(theme.inkSecondary)
                    .frame(width: 11, height: 11)
                    .opacity(hovering ? 1 : 0)
            }
            .frame(height: lineHeight)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(hovering ? theme.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(verbatim: shown))
    }

    private var field: some View {
        TextField("", text: $draft, prompt: placeholder.map { Text($0).foregroundColor(theme.inkSecondary) })
            .font(theme.font(size, weight))
            .foregroundStyle(theme.ink)
            .multilineTextAlignment(.center)
            .tint(theme.focus)
            .focused($focused)
            .submitLabel(.done)
            .onSubmit { focused = false }
            .onChange(of: draft) { next in
                if next.count > limit { draft = String(next.prefix(limit)) }
            }
            .frame(height: lineHeight)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(theme.inset, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(theme.hairline50, lineWidth: 1))
            .background {
                // Escape cancels the edit only; the panel stays open
                Button("") { cancel() }
                    .keyboardShortcut(.escape, modifiers: [])
                    .opacity(0)
                    .accessibilityHidden(true)
            }
            .onAppear { focused = true }
            .onValueChange(of: focused) { now in if !now { commit() } }
            .accessibilityLabel(Text(label))
    }

    private func commit() {
        guard isEditing else { return }
        let next = DesktopInlineEdit.commit(draft: draft, current: value, required: required)
        isEditing = false
        if let next { onSave(next) }
    }

    private func cancel() {
        draft = value
        isEditing = false
    }
}

// MARK: - Details

struct BotPanelDetails: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot

    @StateObject private var activity: BotActivityModel
    @State private var route: BotActivityRoute?

    init(bot: Bot) {
        self.bot = bot
        _activity = StateObject(wrappedValue: BotActivityModel(botId: bot.id))
    }

    private var showsActivity: Bool { session.surfaceGate.allows(.botActivity) }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            if showsActivity {
                if activity.showsCodingSection {
                    AnyView(codingSection)
                }
                if activity.list != nil, !activity.showsCodingSection {
                    AnyView(allHistoryRow)
                }
            }
            AnyView(BotPanelRoutines(bot: bot))
        }
        .padding(.top, 8)
        // the panel's 1 pt leading border sits inside the desktop's px-4
        .padding(.leading, 17)
        .padding(.trailing, 16)
        .padding(.bottom, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: session.connection?.id) {
            if showsActivity { activity.start(client: session.profileClient) }
        }
        .onValueChange(of: BotActivityRules.signature(bot.tasks)) { _ in Task { await activity.refresh() } }
        .onDisappear { activity.stop() }
        .sheet(item: $route) { route in
            BotActivitySheet(botId: bot.id, route: route, model: activity) { _, threadId in
                self.route = nil
                Task {
                    // the sheet closes first: a change under a closing sheet is dropped
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    session.openChat(threadId: threadId)
                }
            }
            .environmentObject(session)
        }
    }

    // MARK: Ongoing activities, Coding

    /// "All history": the history, while no section above shows.
    private var allHistoryRow: some View {
        PanelSectionHeader(icon: .activity, title: "All history") { route = .history(.other) }
            .accessibilityIdentifier("desktop-panel-history.all")
    }

    private var codingSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            PanelSectionHeader(icon: .squareTerminal, title: "Coding") { route = .history(.coding) }
                .accessibilityIdentifier("desktop-panel-history.coding")
            if !activity.launchedAgents.isEmpty {
                LaunchedAgentsGroup(items: activity.launchedAgents) { item in
                    route = .detail(item.asActivityItem())
                }
            }
            liveSectionBody(.coding, items: activity.coding, showsError: true)
        }
    }

    private func liveSection(_ filter: BotActivityFilter, icon: DesktopIcon, title: LocalizedStringKey,
                             items: [BotActivityItem]?, showsError: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            PanelSectionHeader(icon: icon, title: title) { route = .history(filter) }
                .accessibilityIdentifier("desktop-panel-history.\(filter.rawValue)")
            liveSectionBody(filter, items: items, showsError: showsError)
        }
    }

    @ViewBuilder
    private func liveSectionBody(_ filter: BotActivityFilter, items: [BotActivityItem]?, showsError: Bool) -> some View {
        if items == nil, showsError, activity.failed {
            Text("Couldn't load this bot's activity.")
                .font(theme.font(12.5))
                .foregroundStyle(theme.inkSecondary)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.card, in: RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous))
        } else if let items {
            if items.isEmpty {
                Text("Nothing running.")
                    .font(theme.font(12.5))
                    .foregroundStyle(theme.inkTertiary)
                    .frame(height: 18.75)
                    .padding(.horizontal, 2)
                    .accessibilityIdentifier("desktop-panel-idle.\(filter.rawValue)")
            } else {
                VStack(spacing: 8) {
                    ForEach(items) { item in
                        PanelActivityCard(item: item, now: activity.now.timeIntervalSince1970 * 1000,
                                          stopping: activity.stopping.contains(item.id),
                                          onOpen: { route = .detail($0) },
                                          onStop: { stop($0) })
                            .opacity(activity.fading(item) ? 0 : 1)
                            .animation(.easeOut(duration: 0.6), value: activity.fading(item))
                    }
                }
            }
        } else if showsError {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Loading activity…")
                    .font(theme.font(12.5))
                    .foregroundStyle(theme.inkSecondary)
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 8)
        }
    }

    private func stop(_ item: BotActivityItem) {
        activity.stopItem(item) { message in session.actionError = message }
    }
}

/// A Details section's header (`SectionHeader`): its title opens the
/// section's history.
struct PanelSectionHeader: View {
    @Environment(\.desktopTheme) private var theme
    let icon: DesktopIcon
    let title: LocalizedStringKey
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                DesktopIconView(icon: icon, size: 16)
                    .foregroundStyle(theme.inkSecondary)
                Text(title)
                    .font(theme.font(13))
                    .foregroundStyle(hovering ? theme.ink : theme.inkSecondary)
                    .lineLimit(1)
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(theme.inkSecondary)
                    .opacity(hovering ? 1 : 0)
            }
            .frame(height: 18)
            .padding(.horizontal, 4)
            .padding(.vertical, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .padding(.horizontal, -4)
        .accessibilityHint(Text("Open history"))
    }
}

/// One Coding or Activity entry (`ActivityCard`): the status icon, title,
/// status line, and a chevron or Stop.
private struct PanelActivityCard: View {
    @Environment(\.desktopTheme) private var theme
    let item: BotActivityItem
    let now: Double
    let stopping: Bool
    let onOpen: (BotActivityItem) -> Void
    let onStop: (BotActivityItem) -> Void

    var body: some View {
        HStack(spacing: 4) {
            Button { onOpen(item) } label: {
                HStack(spacing: 12) {
                    icon.frame(width: 16, height: 16)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(verbatim: item.title)
                            .font(theme.font(13))
                            .foregroundStyle(theme.ink)
                            .lineLimit(1)
                            .frame(height: 18)
                        Text(verbatim: BotActivityWording.subtitle(item, now: now))
                            .font(theme.font(12))
                            .foregroundStyle(theme.inkSecondary)
                            .lineLimit(1)
                            .frame(height: 17)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if !item.stoppable {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(theme.inkSecondary)
                            .frame(width: 15, height: 15)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Open \(item.title)"))
            .accessibilityIdentifier("desktop-activity-card.\(item.id)")
            if item.stoppable {
                Button { onStop(item) } label: {
                    Group {
                        if stopping {
                            ProgressView().controlSize(.mini)
                        } else {
                            Image(systemName: "stop.fill").font(.system(size: 9))
                        }
                    }
                    .foregroundStyle(theme.danger)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(stopping)
                .hoverEffect(.highlight)
                .padding(.trailing, 8)
                .accessibilityLabel(Text("Stop \(item.title)"))
            }
        }
        .background(theme.card, in: RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
        .hoverEffect(.highlight)
    }

    @ViewBuilder
    private var icon: some View {
        if item.status == .running {
            ProgressView().controlSize(.small).tint(theme.accentText).scaleEffect(0.8)
        } else {
            Image(systemName: item.status.symbol)
                .font(.system(size: 14))
                .foregroundStyle(tint)
        }
    }

    private var tint: Color {
        switch item.status {
        case .running: theme.accentText
        case .waiting: theme.warning
        case .queued, .stopped: theme.inkSecondary
        case .failed: theme.danger
        case .finished: theme.success
        }
    }
}

// MARK: - Routines

/// Details > Routines (`RoutinesSection` + `RoutineList` grouped): the
/// header (calendar glyph, "Routines" 13 secondary, New and Run logs 28 pt
/// icon buttons), then one rounded card, a row per routine.
struct BotPanelRoutines: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot

    @State private var routines: [Routine] = []
    @State private var loaded = false
    @State private var openRoutine: Routine?
    @State private var adding = false
    @State private var toggling: Set<String> = []

    private var mine: [Routine] { DesktopRoutineList.of(botId: bot.id, in: routines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                DesktopIconView(icon: .calendarClock, size: 16)
                    .foregroundStyle(theme.inkSecondary)
                Text("Routines")
                    .font(theme.font(13))
                    .foregroundStyle(theme.inkSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                iconButton(.plus, size: 15, label: "Create schedule") { adding = true }
                    .accessibilityIdentifier("desktop-panel-routine-new")
                iconButton(.fileText, size: 14, label: "Run logs") { model.modal = .automations }
            }
            .frame(height: 28)
            AnyView(list)
        }
        .task { await load() }
        .sheet(item: $openRoutine) { routine in
            NavigationStack {
                RoutineDetailView(routine: routine) { await load() }
            }
            .environmentObject(session)
        }
        .sheet(isPresented: $adding) {
            RoutineEditorView(routine: nil, presetBotId: bot.id) { await load() }
                .environmentObject(session)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-panel-routines")
    }

    private func iconButton(_ icon: DesktopIcon, size: CGFloat, label: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            DesktopIconView(icon: icon, size: size)
                .foregroundStyle(theme.inkSecondary)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(Text(label))
    }

    @ViewBuilder
    private var list: some View {
        if !loaded {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Loading routines…").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
            }
            .padding(12)
        } else if mine.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "repeat")
                    .font(.system(size: 18))
                    .foregroundStyle(theme.inkSecondary.opacity(0.6))
                Text("No schedules yet.")
                    .font(theme.font(13))
                    .foregroundStyle(theme.inkSecondary)
            }
            .frame(maxWidth: .infinity)
            .padding(20)
            .overlay(RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous)
                .strokeBorder(theme.hairline50, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        } else {
            VStack(spacing: 0) {
                ForEach(Array(mine.enumerated()), id: \.element.id) { index, routine in
                    row(routine)
                    if index < mine.count - 1 {
                        Rectangle().fill(theme.hairlineWeak).frame(height: 1)
                    }
                }
            }
            .padding(1)
            .background(theme.card, in: RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
        }
    }

    private func row(_ routine: Routine) -> some View {
        HStack(spacing: 10) {
            Button { openRoutine = routine } label: {
                VStack(alignment: .leading, spacing: 0) {
                    Text(verbatim: routine.name)
                        .font(theme.font(13))
                        .foregroundStyle(theme.ink)
                        .lineLimit(1)
                        .frame(height: 18)
                    Text(stateLabel(routine))
                        .font(theme.font(13))
                        .foregroundStyle(theme.inkSecondary)
                        .lineLimit(1)
                        .frame(height: 18)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("desktop-panel-routine.\(routine.name)")
            PanelSwitch(label: routine.enabled ? "Pause" : "Resume", isOn: routine.enabled,
                        disabled: toggling.contains(routine.id) || routine.schedule.type == .unknown) { on in
                Task { await toggle(routine, on: on) }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .hoverEffect(.highlight)
    }

    private func stateLabel(_ routine: Routine) -> LocalizedStringKey {
        switch DesktopRoutineList.state(routine) {
        case .active: "Active"
        case .paused: "Paused"
        case .finished: "Finished"
        }
    }

    private func toggle(_ routine: Routine, on: Bool) async {
        toggling.insert(routine.id)
        defer { toggling.remove(routine.id) }
        if let saved = await session.setRoutineEnabled(routine, enabled: on),
           let index = routines.firstIndex(where: { $0.id == saved.id }) {
            routines[index] = saved
        }
    }

    private func load() async {
        let result = await session.loadRoutines()
        routines = result.routines
        loaded = true
    }
}
