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
    @Environment(\.openWindow) private var openWindow
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var shell: DesktopShellModel
    let bot: Bot

    @StateObject private var activity: BotActivityModel
    @StateObject private var remoteSessions: BotRemoteSessionsModel
    @State private var route: BotActivityRoute?
    /// `useShowAllHistory` (lib/panel-visibility.ts, `sagax.showAllHistory.v1`):
    /// the "All history" row is off unless the person turns it on; the
    /// history stays behind the Coding title and the palette.
    @AppStorage("sagax.showAllHistory.v1") private var showAllHistory = false
    /// The overview's setup checklist for the Suggestions card.
    @State private var suggestionsSetup: [BotSetupStep]?

    init(bot: Bot) {
        self.bot = bot
        _activity = StateObject(wrappedValue: BotActivityModel(botId: bot.id))
        _remoteSessions = StateObject(wrappedValue: BotRemoteSessionsModel(botId: bot.id))
    }

    private var showsActivity: Bool { session.surfaceGate.allows(.botActivity) }

    var body: some View {
        // `flex-col gap-6`: a section that draws nothing (the task list
        // while the bot keeps none) takes no gap, as a flex gap skips an
        // empty child's box only when it is not rendered at all
        PanelSectionStack(spacing: 24) {
            // Activity: Upcoming, Suggested, Computer card, Voice chat (#2127).
            AnyView(BotPanelRoutines(bot: bot))
            DesktopBotSuggestionsCard(bot: bot, setup: suggestionsSetup) { action in
                switch action {
                case let .openThread(threadId): session.openChat(threadId: threadId)
                case .openSection("routines"): break
                case let .openSection(name): shell.showPersona(DesktopPanelSection(rawValue: name))
                }
            }
            BotPanelComputerCard(bot: bot) {
                DesktopComputerWindow.open(botId: bot.id, openWindow: openWindow, model: shell)
            }
            BotPanelVoiceChatCard(bot: bot)
            // Progressive disclosure: tasks, coding, remote sessions stay.
            BotTaskListCard(bot: bot) { threadId in session.openChat(threadId: threadId) }
            if showsActivity {
                if activity.showsCodingSection {
                    AnyView(codingSection)
                }
                if showAllHistory, activity.list != nil, !activity.showsCodingSection {
                    AnyView(allHistoryRow)
                }
            }
            BotPanelRemoteSessions(model: remoteSessions)
        }
        .padding(.top, 8)
        // the panel's 1 pt leading border sits inside the desktop's px-4
        .padding(.leading, 17)
        .padding(.trailing, 16)
        .padding(.bottom, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
        // SuggestionsSection re-reads the overview when the name, title,
        // instructions or routines change
        .task(id: "\(bot.id)|\(session.connection?.id ?? "")|\(bot.name)|\(bot.title)") {
            suggestionsSetup = (try? await session.settingsClient?.overview(botId: bot.id))?.setup
        }
        .task(id: session.connection?.id) {
            if showsActivity { activity.start(client: session.profileClient) }
            remoteSessions.start(client: session.profileClient ?? session.settingsClient)
        }
        .onValueChange(of: BotActivityRules.signature(bot.tasks)) { _ in Task { await activity.refresh() } }
        .onDisappear {
            activity.stop()
            remoteSessions.stop()
        }
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
                        Text(verbatim: BotActivityWording.title(item))
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
            .accessibilityLabel(Text("Open \(BotActivityWording.title(item))"))
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
                .accessibilityLabel(Text("Stop \(BotActivityWording.title(item))"))
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
    @State private var expanded = false

    private var mine: [Routine] { DesktopRoutineList.of(botId: bot.id, in: routines) }
    private var shown: [Routine] {
        if expanded || mine.count <= PanelRoutinePreview.limit { return mine }
        return Array(mine.prefix(PanelRoutinePreview.limit))
    }
    private var needsMore: Bool { !expanded && mine.count > PanelRoutinePreview.limit }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if loaded && mine.isEmpty {
                // No routine: no section, one quiet line (RoutinesSection.tsx).
                AnyView(emptyHint)
            } else {
            HStack(spacing: 8) {
                DesktopIconView(icon: .calendarClock, size: 16)
                    .foregroundStyle(theme.inkSecondary)
                Text("Upcoming")
                    .font(theme.font(13))
                    .foregroundStyle(theme.inkSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                // RoutinesSection.tsx: the ⋯ (Run logs, Automations) and the +
                Menu {
                    Button(String(localized: "Run logs"), systemImage: "list.bullet.rectangle") { model.show(.automations) }
                    Button(String(localized: "Automations"), systemImage: "calendar") { model.show(.automations) }
                } label: {
                    DesktopIconView(icon: .ellipsis, size: 15)
                        .foregroundStyle(theme.inkSecondary)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel(Text("More options"))
                iconButton(.plus, size: 15, label: "Create schedule") { adding = true }
                    .accessibilityIdentifier("desktop-panel-routine-new")
            }
            .frame(height: 28)
            AnyView(list)
            }
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

    /// A bot without routines: one centered, quiet line. "Ask it in chat" opens
    /// the bot's conversation; "New routine" opens the same editor as the +.
    private var emptyHint: some View {
        let ask = String(localized: "Ask it in chat")
        let full = String(format: String(localized: "Routines are recurring tasks this Bot runs on a schedule. %@ to set one up."), ask)
        var text = AttributedString(full)
        if let range = text.range(of: ask) {
            text[range].link = URL(string: "sagax-ask://chat")
            text[range].underlineStyle = .single
        }
        return VStack(spacing: 4) {
            Text(text)
                .font(theme.font(12))
                .foregroundStyle(theme.inkTertiary)
                .multilineTextAlignment(.center)
                .tint(theme.inkSecondary)
                .environment(\.openURL, OpenURLAction { _ in
                    session.openChat(threadId: bot.threadId)
                    return .handled
                })
                .accessibilityIdentifier("desktop-panel-routines-hint")
            Button { adding = true } label: {
                Text("New routine")
                    .font(theme.font(12))
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 4)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("desktop-panel-routine-new")
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 8)
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
            VStack(spacing: 8) {
                VStack(spacing: 0) {
                    ForEach(Array(shown.enumerated()), id: \.element.id) { index, routine in
                        row(routine)
                        if index < shown.count - 1 {
                            Rectangle().fill(theme.hairlineWeak).frame(height: 1)
                        }
                    }
                }
                .padding(1)
                .background(theme.card, in: RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous))
                .clipShape(RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
                if needsMore {
                    Button {
                        expanded = true
                    } label: {
                        Text("Show more")
                            .font(theme.font(13, .medium))
                            .foregroundStyle(theme.inkSecondary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("desktop-panel-upcoming-show-more")
                }
            }
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
                    // the desktop's row: the schedule, its zone, the next run; Paused under it
                    Text(verbatim: Self.scheduleLine(routine))
                        .font(theme.font(12))
                        .foregroundStyle(theme.inkSecondary)
                        .lineLimit(1)
                        .frame(height: 17)
                    if !routine.enabled {
                        Text(stateLabel(routine))
                            .font(theme.font(12))
                            .foregroundStyle(theme.inkSecondary)
                            .frame(height: 17)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("desktop-panel-routine.\(routine.name)")
            // RoutineSwitch: the track wears the bot's colour, as the desktop's does
            PanelSwitch(label: routine.enabled ? "Pause" : "Resume", isOn: routine.enabled,
                        disabled: toggling.contains(routine.id) || routine.schedule.type == .unknown,
                        onColor: BubbleColors.user(botColor: bot.color)?.fill.color) { on in
                Task { await toggle(routine, on: on) }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .hoverEffect(.highlight)
    }

    static func scheduleLine(_ routine: Routine) -> String {
        var parts = [RoutineWording.desktop(routine.schedule)]
        if let zone = routine.schedule.timeZone, !zone.isEmpty { parts.append(zone) }
        if routine.enabled, let next = routine.nextRunAt {
            let date = Date(timeIntervalSince1970: next / 1000)
            let time = date.formatted(date: .omitted, time: .shortened)
            let when = Calendar.current.isDateInToday(date) ? String(localized: "Today at \(time)")
                : Calendar.current.isDateInTomorrow(date) ? String(localized: "Tomorrow at \(time)")
                : "\(date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())), \(time)"
            parts.append(String(localized: "Next: \(when)"))
        }
        return parts.joined(separator: " · ")
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


// MARK: - Details > Suggestions

/// Details > Suggestions as the desktop draws it (`SuggestionsSection.tsx`):
/// the 12/17 tertiary title and Hide (12.5 secondary) over one grouped card
/// (rounded-xl, hairline-weak ring, `card` fill; rows px 12 py 10 split by
/// hairlines) of a 15 pt sparkles glyph, the title 13/20 semibold and the
/// subtitle 12/16 secondary. No chevron: the whole row is the button.
struct DesktopBotSuggestionsCard: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    let bot: Bot
    /// The overview's setup checklist, loaded by the Details tab: a Group
    /// with nothing in it hands its `.task` to no child, so the card could
    /// never ask for it itself (the card never showed).
    let setup: [BotSetupStep]?
    let run: (BotSuggestion.Action) -> Void

    private var items: [BotSuggestion] {
        BotSuggestions.suggestions(setup: setup, tasks: bot.tasks, waiting: bot.waitingApprovals)
    }

    var body: some View {
        Group {
            if prefs.showSuggestions, !items.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Suggestions")
                            .font(theme.font(12))
                            .foregroundStyle(theme.inkTertiary)
                        Spacer(minLength: 0)
                        Button {
                            prefs.setShowSuggestions(session, false)
                        } label: {
                            Text("Hide").font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("panel-suggestions-hide")
                    }
                    .padding(.horizontal, 2)
                    VStack(spacing: 0) {
                        ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                            Button { run(item.action) } label: {
                                HStack(alignment: .top, spacing: 10) {
                                    DesktopIconView(icon: .sparkles, size: 15)
                                        .foregroundStyle(theme.inkSecondary)
                                        .padding(.top, 2)
                                    VStack(alignment: .leading, spacing: 0) {
                                        Text(LocalizedStringKey(item.title))
                                            .font(theme.font(13, .semibold))
                                            .foregroundStyle(theme.ink)
                                            .lineLimit(1)
                                            .frame(height: 20, alignment: .leading)
                                        Text(subtitle(item))
                                            .font(theme.font(12))
                                            .foregroundStyle(theme.inkSecondary)
                                            .lineLimit(2)
                                            .fixedSize(horizontal: false, vertical: true)
                                    }
                                    Spacer(minLength: 0)
                                }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 10)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("panel-suggestion.\(item.id)")
                            if index < items.count - 1 {
                                Rectangle().fill(theme.hairlineWeak).frame(height: 1)
                            }
                        }
                    }
                    .background(theme.card, in: RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous))
                    .clipShape(RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
                }
            }
        }
    }

    private func subtitle(_ item: BotSuggestion) -> String {
        let format = String(localized: String.LocalizationValue(item.subtitle))
        guard let argument = item.argument else { return format }
        return String(format: format, argument)
    }
}

/// A vertical stack that puts `spacing` only between children that have a
/// height, so a section that hides itself (an empty VStack that still owns
/// its `.task`) leaves no gap.
struct PanelSectionStack: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width
        var height: CGFloat = 0
        var maxWidth: CGFloat = 0
        var placed = 0
        for subview in subviews {
            let size = subview.sizeThatFits(ProposedViewSize(width: width, height: nil))
            guard size.height > 0.5 else { continue }
            height += (placed > 0 ? spacing : 0) + size.height
            maxWidth = max(maxWidth, size.width)
            placed += 1
        }
        return CGSize(width: width ?? maxWidth, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        var placed = 0
        for subview in subviews {
            let size = subview.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
            if size.height <= 0.5 {
                subview.place(at: CGPoint(x: bounds.minX, y: y), proposal: ProposedViewSize(width: bounds.width, height: 0))
                continue
            }
            if placed > 0 { y += spacing }
            subview.place(at: CGPoint(x: bounds.minX, y: y), proposal: ProposedViewSize(width: bounds.width, height: size.height))
            y += size.height
            placed += 1
        }
    }
}
