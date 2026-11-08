// The compact home list: one line per bot and per group.
//
// The phone's version of the desktop sidebar's compact density: name, role
// and status on one line, an orange star after the Primary Bot's name, and a
// thread list only under a bot that has more than one thread — opened from
// its "› N" control and lined up with the bot's name. What each row shows
// is decided in CompanionCore's `CompactBotRow`; this file is layout.
import SwiftUI
import CompanionCore

/// Rhythm shared by bot rows, group rows and the thread lines beneath a
/// bot, so a thread starts exactly where its bot's name does.
enum CompactRosterMetrics {
    /// Before the unread-dot gutter: with the gutter, faces start on the
    /// section titles' 20pt edge.
    static let leading: CGFloat = 4
    static let dotGutter: CGFloat = 16
    static let faceSpacing: CGFloat = 10
    static let trailing: CGFloat = 16
    /// The face, before Dynamic Type scales it.
    static let face: CGFloat = 26
    /// Scaled faces stop growing here, so the largest text sizes spend
    /// their width on names rather than on pictures.
    static let maxFace: CGFloat = 40
    /// Above and below a row's content on one line; see `RowPadding`.
    static let rowPadding: CGFloat = 4
    /// What sits beneath a name at the accessibility sizes: a bot's time
    /// and role, a group's time. Well below the name's body and the
    /// one-line row's subheadline, so the name reads first.
    static let stackedDetail: Font = .footnote

    static func nameInset(face: CGFloat) -> CGFloat {
        leading + dotGutter + face + faceSpacing
    }
}

/// One bot on one line, with its threads beneath it when opened.
struct CompactBotEntry: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    /// When the bot's current thread last moved, from the roster summary.
    let lastActivity: Double
    /// An unanswered approval or question sits in one of its threads.
    let hasPendingCard: Bool
    @Binding var query: String
    @Binding var expanded: Bool
    @Binding var collapsedFolders: Set<String>
    @Binding var creating: Bool
    /// The row itself: the bot's last-opened thread, as before.
    let openRow: () -> Void
    /// An exact thread, or one just created.
    let open: (Chat) -> Void
    let manage: (Chat) -> Void

    @EnvironmentObject private var session: Session
    /// The shared thread and folder menus, mounted by the roster.
    @EnvironmentObject private var threadActions: ThreadActions
    /// Settings > Appearance > Threads (WP6): off, no "› N" and no list.
    @Environment(\.sidebarShowsThreads) private var showsThreads
    /// The sidebar preferences and the section prompts (WP6).
    @ObservedObject private var sidebarPrefs = SidebarPrefsModel.shared
    @EnvironmentObject private var sectionActions: SidebarSectionActions
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .body) private var scaledFace = CompactRosterMetrics.face
    /// Wakes the list when a timed snooze ends, so the count and the list
    /// fold that thread back in without waiting for a snapshot.
    @State private var snoozeTick = 0

    private var face: CGFloat { min(scaledFace, CompactRosterMetrics.maxFace) }

    private var searching: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        let _ = snoozeTick
        let live = session.state.bot(bot.id) ?? bot
        let queued = session.state.queuedThreadIds
        let row = CompactBotRow(
            bot: live, hasPendingCard: hasPendingCard, queuedThreadIds: queued, creatingThread: creating
        )
        VStack(alignment: .leading, spacing: 0) {
            rowLine(live, row)
            if showsThreads && row.listsThreads(expanded: expanded, searching: searching) {
                threadList(live, row: row, queued: queued)
            }
        }
        .snoozeExpiryTick(live.visibleTasks.nextSnoozeExpiry(), tick: $snoozeTick)
        // A list opened with "› N" closes when the control goes away (the
        // bot is down to one thread), so it cannot reopen by itself when the
        // bot gains a thread again. Also clears a stale open state carried
        // over from comfortable, where every bot has a Threads row.
        .onValueChange(of: row.showsThreadControl, initial: true) { shows in
            if !shows && expanded { expanded = false }
        }
    }

    // MARK: - The bot's line

    private func rowLine(_ bot: Bot, _ row: CompactBotRow) -> some View {
        HStack(spacing: 0) {
            Button(action: openRow) {
                HStack(spacing: 0) {
                    UnreadDot(visible: row.showsUnreadDot, color: bot.color)
                    BotMascotView(
                        bot: bot, size: face,
                        state: MausState.forChat(.bot(bot), in: session.state),
                        animated: false,
                        sidebarTapReact: true
                    )
                    .accessibilityHidden(true)
                    .padding(.trailing, CompactRosterMetrics.faceSpacing)

                    // the spinner also stands for a thread being made
                    let spinnerLabel: LocalizedStringKey = row.status == .working ? "Working" : "Creating…"
                    if typeSize.isAccessibilitySize {
                        // One line cannot hold a name and a time at these
                        // sizes: the name gets the whole width, whole words
                        // intact, and the time and role move beneath it,
                        // a size smaller so the name reads first.
                        VStack(alignment: .leading, spacing: 2) {
                            name(bot, row)
                            let line = row.secondLine(stamp: RelativeStamp.list(lastActivity), role: bot.displayRole)
                            if !line.isEmpty {
                                SecondLine(line: line, color: bot.color, spinnerLabel: spinnerLabel)
                            }
                        }
                        Spacer(minLength: 0)
                    } else {
                        nameAndRole(bot, row)
                        Spacer(minLength: 8)
                        RowStatus(
                            waiting: row.showsWaiting, working: row.showsSpinner,
                            stamp: row.showsTime ? RelativeStamp.list(lastActivity) : "",
                            color: bot.color, spinnerLabel: spinnerLabel
                        )
                    }
                }
                .padding(.leading, CompactRosterMetrics.leading)
                .padding(.trailing, showsThreads && row.showsThreadControl ? 0 : CompactRosterMetrics.trailing)
                .modifier(RowPadding())
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            // the desktop's bot menu, the same in every density
            .contextMenu { BotRowMenu(bot: bot) }
            .sidebarBotPinSwipe(bot, session: session)
            .accessibilityIdentifier("chat-row.\(bot.id)")

            if showsThreads && row.showsThreadControl {
                threadControl(bot, count: row.threadCount)
                    // the control's own padding lands its glyph on the
                    // 16pt edge that times in other rows end on
                    .padding(.trailing, CompactRosterMetrics.trailing - 10)
            }
        }
    }

    /// The name, then the role on its own line BELOW it, smaller and grey
    /// (the owner 2026-11-06: never the name and the title side by side).
    private func nameAndRole(_ bot: Bot, _ row: CompactBotRow) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            name(bot, row)
            if !bot.displayRole.isEmpty {
                Text(verbatim: bot.displayRole)
                    .font(.subheadline)
                    .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                    .lineLimit(1)
            }
        }
    }

    private func name(_ bot: Bot, _ row: CompactBotRow) -> some View {
        HStack(spacing: 6) {
            Text(verbatim: bot.name)
                .font(.body.weight(.semibold))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
                .fixedSize(horizontal: false, vertical: true)
            if row.showsChiefBadge {
                PrimaryBotBadge()
            }
        }
    }

    /// "› N": the bot's threads, opened in place.
    private func threadControl(_ bot: Bot, count: Int) -> some View {
        let listed = searching || expanded
        return Button {
            Haptics.selection()
            withAnimation(.snappy(duration: 0.2)) { expanded.toggle() }
        } label: {
            HStack(spacing: 3) {
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .rotationEffect(.degrees(listed ? 90 : 0))
                Text("\(count)")
                    .font(.subheadline.weight(.medium))
                    .monospacedDigit()
            }
            .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
            .padding(.horizontal, 10)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(searching)
        .accessibilityLabel("\(bot.name)'s threads")
        .accessibilityValue(listed ? "Expanded, \(count) threads" : "Collapsed, \(count) threads")
        .accessibilityIdentifier("threads-toggle.\(bot.id)")
    }

    // MARK: - The threads beneath it

    private func threadList(_ bot: Bot, row: CompactBotRow, queued: Set<String>) -> some View {
        // A name match lists everything; otherwise only what matched.
        let groups = bot.threadGroups(
            matching: bot.name.localizedCaseInsensitiveContains(query) ? "" : query,
            queuedThreadIds: queued,
            includingEmptyFolders: true
        )
        let labelsUnfiled = groups.labelsUnfiledThreads
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(groups) { group in
                if let folder = group.project {
                    folderHeader(folder)
                    if searching || !collapsedFolders.contains(folderKey(folder)) {
                        threadLines(group.tasks, bot: bot)
                        if bot.folderThreads(folder.id).isEmpty {
                            Text("No threads yet")
                                .font(.footnote)
                                .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                                .frame(minHeight: 32)
                        }
                    }
                } else {
                    if labelsUnfiled {
                        unfiledLabel(bot)
                    }
                    threadLines(group.tasks, bot: bot)
                }
            }
            if row.endsWithNewThread(expanded: expanded, searching: searching) {
                newThreadLine(bot)
            }
        }
        .padding(.leading, CompactRosterMetrics.nameInset(face: face))
        .padding(.trailing, CompactRosterMetrics.trailing)
        .padding(.bottom, 4)
    }

    private func folderKey(_ folder: BotProject) -> String { "\(bot.id):\(folder.id)" }

    private func folderHeader(_ folder: BotProject) -> some View {
        let open = searching || !collapsedFolders.contains(folderKey(folder))
        let live = session.state.bot(bot.id) ?? bot
        return Button {
            let key = folderKey(folder)
            if collapsedFolders.contains(key) { collapsedFolders.remove(key) } else { collapsedFolders.insert(key) }
        } label: {
            HStack(spacing: 6) {
                if let emoji = folder.emoji, !emoji.isEmpty {
                    Text(verbatim: emoji)
                } else {
                    Image(systemName: "folder")
                }
                Text(verbatim: folder.name)
                    .lineLimit(1)
                Text("\(live.folderThreads(folder.id).count)")
                    .monospacedDigit()
                    .opacity(0.6)
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .rotationEffect(.degrees(open ? 90 : 0))
                if !open { FolderStatusMark(status: FolderStatus(live.folderThreads(folder.id))) }
                Spacer(minLength: 0)
            }
            .font(.footnote.weight(.medium))
            .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .folderMenu(folder, of: live, actions: threadActions, session: session)
        .disabled(searching)
        .accessibilityLabel(Text(verbatim: folder.name))
        .accessibilityValue(open ? "Expanded" : "Collapsed")
        .accessibilityIdentifier("folder.\(bot.id).\(folder.id)")
    }

    /// Unfiled threads start on the same edge as a folder's, so after a
    /// folder they need a label of their own — the desktop's "Threads".
    private func unfiledLabel(_ bot: Bot) -> some View {
        Text("Threads")
            .font(.footnote.weight(.medium))
            .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
            .padding(.top, 10)
            .padding(.bottom, 2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("unfiled-threads.\(bot.id)")
    }

    private func threadLines(_ tasks: [BotTask], bot: Bot) -> some View {
        ForEach(tasks, id: \.threadId) { task in
            if let projected = bot.projected(forThread: task.threadId) {
                NavigationLink(value: Chat.bot(projected)) {
                    CompactThreadLine(
                        task: task,
                        queued: session.state.pendingQueued[task.threadId]?.isEmpty == false
                    )
                }
                .buttonStyle(.plain)
                .threadMenu(task, owner: .bot(bot), actions: threadActions, session: session)
                .accessibilityIdentifier("thread.\(task.threadId)")
            }
        }
    }

    private func newThreadLine(_ bot: Bot) -> some View {
        Button { createThread(for: bot) } label: {
            HStack(spacing: 6) {
                Image(systemName: "plus")
                    .font(.footnote.weight(.semibold))
                Text("New thread")
                if creating {
                    ProgressView().controlSize(.small)
                }
                Spacer(minLength: 0)
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(Theme.parity(Color.accentColor, Theme.accentText))
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(creating)
        .accessibilityLabel("New thread with \(bot.name)")
        .accessibilityIdentifier("new-thread.\(bot.id)")
    }

    private func createThread(for bot: Bot) {
        guard !creating else { return }
        creating = true
        Task {
            defer { creating = false }
            if let created = await session.createRosterThread(for: bot) {
                open(.bot(created))
            }
        }
    }
}

/// One thread under its bot: title, then its status and when it last moved.
struct CompactThreadLine: View {
    @Environment(\.themePalette) var themePalette
    let task: BotTask
    /// A held send, from the client's queue state (never in `activity`).
    var queued = false

    @Environment(\.dynamicTypeSize) private var typeSize

    private enum Mark {
        case waitingOnYou, waitingOnTeammate, working, queued

        var words: LocalizedStringKey {
            switch self {
            case .waitingOnYou: "Waiting on you"
            case .waitingOnTeammate: "Waiting on teammate"
            case .working: "Working"
            case .queued: "Queued"
            }
        }
    }

    /// Ordered as `BotThreadRow` orders it: the person, a teammate wait
    /// (a quiet clock, never a spinner), work, then a held send.
    private var mark: Mark? {
        if task.activity == "waiting-on-you" { return .waitingOnYou }
        if task.isWaitingOnTeammate { return .waitingOnTeammate }
        if task.isWorking { return .working }
        if task.activity == "queued" || queued { return .queued }
        return nil
    }

    private var dimmed: Bool {
        (task.isClosed || task.isArchived) && mark == nil && task.unread != true
    }

    private var stamp: String { RelativeStamp.list(task.listStamp) }

    var body: some View {
        Group {
            if typeSize.isAccessibilitySize {
                // the title gets the whole width; its marks and time follow
                VStack(alignment: .leading, spacing: 2) {
                    title.lineLimit(3).fixedSize(horizontal: false, vertical: true)
                    marks
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                HStack(spacing: 6) {
                    title.lineLimit(1).layoutPriority(1)
                    Spacer(minLength: 8)
                    marks
                }
            }
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySummary)
        .accessibilityValue(task.isArchived ? "Archived" : dimmed ? "Closed" : "")
    }

    private var title: some View {
        HStack(spacing: 6) {
            Text(verbatim: task.displayTitle)
                .font(.subheadline.weight(task.unread == true ? .semibold : .regular))
                .foregroundStyle(dimmed ? Theme.parity(Color.secondary, Theme.textSecondary) : Theme.textPrimary)
            if task.pinned == true {
                Image(systemName: "pin.fill")
                    .font(.caption2)
                    .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
            }
        }
    }

    /// Unread, then the live mark, then the time — or the spinner in its place.
    private var marks: some View {
        HStack(spacing: 6) {
            if task.unread == true {
                Circle()
                    .fill(Theme.parity(Color.accentColor, Theme.accent))
                    .frame(width: 7, height: 7)
            }
            switch mark {
            case .waitingOnYou:
                Image(systemName: "hand.raised.fill")
                    .font(.caption)
                    .foregroundStyle(Theme.parity(Color.orange, Theme.warning))
            case .waitingOnTeammate, .queued:
                Image(systemName: "clock")
                    .font(.caption)
                    .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
            case .working, nil:
                EmptyView()
            }
            if mark == .working {
                // the spinner stands where the time was, as on the bot's line
                ProgressView().controlSize(.small)
            } else if !stamp.isEmpty {
                Text(verbatim: stamp)
                    .font(.footnote)
                    .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
            }
        }
        .fixedSize()
    }

    private var accessibilitySummary: Text {
        var parts = [Text(verbatim: task.displayTitle)]
        if let mark { parts.append(Text(mark.words)) }
        if task.unread == true { parts.append(Text("Unread")) }
        if task.pinned == true { parts.append(Text("Pinned")) }
        if !stamp.isEmpty { parts.append(Text(verbatim: stamp)) }
        return parts.dropFirst().reduce(parts[0]) { $0 + Text(verbatim: ", ") + $1 }
    }
}

/// A group on one line: two of its members' faces, overlapping, then its name.
struct CompactRoomRow: View {
    @Environment(\.themePalette) var themePalette
    let room: Room
    let lastActivity: Double
    /// An unanswered approval or question sits in the group's thread.
    var waiting = false

    @EnvironmentObject private var session: Session
    @ScaledMetric(relativeTo: .body) private var scaledFace = CompactRosterMetrics.face
    @Environment(\.dynamicTypeSize) private var typeSize

    private var face: CGFloat { min(scaledFace, CompactRosterMetrics.maxFace) }
    private var busy: Bool { room.busyBotId != nil }

    var body: some View {
        HStack(spacing: 0) {
            UnreadDot(visible: room.unread && !busy, color: "blue")
            Group {
                if let peer = PeopleDirectory.shared.peer(room, session: session) {
                    PersonAvatar(initials: peer.initials, size: face, presenceId: peer.id)
                } else {
                    RoomFaces(members: room.memberIds.compactMap { session.state.bot($0) }, size: face)
                }
            }
                .accessibilityHidden(true)
                .padding(.trailing, CompactRosterMetrics.faceSpacing)
            let name = Text(verbatim: PeopleDirectory.shared.peer(room, session: session)?.name ?? room.name)
                .font(.body.weight(.semibold))
                .foregroundStyle(Theme.textPrimary)
            let status = RowStatus(
                waiting: waiting, working: busy,
                stamp: busy ? "" : RelativeStamp.list(lastActivity),
                color: "blue",
                stampFont: typeSize.isAccessibilitySize ? CompactRosterMetrics.stackedDetail : .subheadline
            )
            let personId = PeopleDirectory.shared.peer(room, session: session)?.id
            if typeSize.isAccessibilitySize {
                // as on a bot's row: the whole width for the name, and the
                // time a size smaller beneath it
                VStack(alignment: .leading, spacing: 2) {
                    name
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                    PersonLabelTag(personId: personId)
                    status
                }
                Spacer(minLength: 0)
            } else {
                name.lineLimit(1)
                // #172: a person's label, drawn as a bot's label tag
                PersonLabelTag(personId: personId)
                    .padding(.leading, 6)
                Spacer(minLength: 8)
                status
            }
        }
        .padding(.leading, CompactRosterMetrics.leading)
        .padding(.trailing, CompactRosterMetrics.trailing)
        .modifier(RowPadding())
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }
}

/// A row's air above and below. On one line it is 4pt, and the 44pt row
/// height does the rest; once a row stacks its name over its time, at the
/// accessibility sizes, it grows with the text, so one row's time does not
/// run into the next row's name.
private struct RowPadding: ViewModifier {
    @Environment(\.themePalette) var themePalette
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .body) private var stacked = CompactRosterMetrics.rowPadding

    func body(content: Content) -> some View {
        content.padding(.vertical, typeSize.isAccessibilitySize ? stacked : CompactRosterMetrics.rowPadding)
    }
}

/// Beneath a bot's name at the accessibility sizes: the hand or the spinner,
/// then the time and the role as one quiet line that gives way at its end.
private struct SecondLine: View {
    @Environment(\.themePalette) var themePalette
    let line: CompactSecondLine
    let color: String
    let spinnerLabel: LocalizedStringKey

    var body: some View {
        HStack(spacing: 6) {
            if line.showsWaiting || line.showsSpinner {
                RowStatus(
                    waiting: line.showsWaiting, working: line.showsSpinner, stamp: "",
                    color: color, spinnerLabel: spinnerLabel
                )
            }
            if !line.words.isEmpty {
                Text(verbatim: line.text)
                    .font(CompactRosterMetrics.stackedDetail)
                    .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                    .lineLimit(1)
                    .accessibilityLabel(Text(verbatim: line.spokenText))
            }
        }
    }
}

/// Two members' faces in one face's square: the first up and left, the
/// second down and right on a ring of the list's background.
private struct RoomFaces: View {
    @Environment(\.themePalette) var themePalette
    let members: [Bot]
    let size: CGFloat

    var body: some View {
        GroupMascotView(members: members, size: size)
    }
}

/// The unread dot, in its own gutter at the row's leading edge, as on the
/// comfortable rows.
private struct UnreadDot: View {
    @Environment(\.themePalette) var themePalette
    let visible: Bool
    let color: String

    var body: some View {
        ZStack {
            if visible {
                Circle()
                    .fill(MausPalette.color(color))
                    .frame(width: 8, height: 8)
                    .accessibilityLabel("Unread")
            }
        }
        .frame(width: CompactRosterMetrics.dotGutter)
    }
}

/// The trailing marks: a hand in the chat's colour while it waits on the
/// person, and a spinner in place of the time while it works.
private struct RowStatus: View {
    @Environment(\.themePalette) var themePalette
    let waiting: Bool
    let working: Bool
    let stamp: String
    let color: String
    /// What VoiceOver calls the spinner.
    var spinnerLabel: LocalizedStringKey = "Working"
    /// The time's size: subheadline beside the name on one line, smaller
    /// beneath it.
    var stampFont: Font = .subheadline

    var body: some View {
        HStack(spacing: 6) {
            if waiting {
                Image(systemName: "hand.raised.fill")
                    .font(.footnote)
                    .foregroundStyle(MausPalette.color(color))
                    .accessibilityLabel("Waiting on you")
            }
            if working {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityLabel(spinnerLabel)
            } else if !stamp.isEmpty {
                Text(verbatim: stamp)
                    .font(stampFont)
                    .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
            }
        }
        .fixedSize()
    }
}

/// The Primary Bot mark after a bot's name: the desktop's orange star badge
/// (`PrimaryBotBadge` in src/components/Avatar.tsx). It scales with the
/// name, so it keeps its default proportion to it at every text size instead
/// of outgrowing it at the largest ones.
extension Bot {
    /// The role a row shows: the bot's own title, else "Primary Bot" for the
    /// Primary Bot (in the person's language), else nothing.
    var displayRole: String {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !title.isEmpty { return title }
        return chiefOfStaff == true ? String(localized: "Primary Bot") : ""
    }
}

struct PrimaryBotBadge: View {
    /// Caption's size at the default text size, scaled as the name's body is.
    @ScaledMetric(relativeTo: .body) private var size: CGFloat = 13

    init(size: CGFloat = 13) {
        _size = ScaledMetric(wrappedValue: size, relativeTo: .body)
    }

    var body: some View {
        ZStack {
            Circle().fill(Color.orange)
            Image(systemName: "star.fill")
                .font(.system(size: size * 0.62, weight: .bold))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Primary Bot"))
        .accessibilityIdentifier("primary-bot-badge")
    }
}
