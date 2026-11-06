// iPad: the group panel's Activity sections after Upcoming, as the desktop
// GroupDetailsTab (2026-11-06): Suggested (the group's next steps, then Add
// to Slack and Add to meeting) and Tasks (the ones the viewer's bots keep
// from the group's conversations). Same look as the bot panel's cards.
import SwiftUI
import CompanionCore

// MARK: - Suggested

/// `groupSuggestions` plus the bot panel's Slack and meeting rows. The
/// "Give the team a goal" step does what Add to meeting does: one row for it.
/// The instructions step waits for the Instructions tab (hidden for now).
struct GroupPanelSuggestions: View {
    @Environment(\.desktopTheme) private var theme
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    let room: Room
    let access: RoomInfoAccess
    /// The viewer's own bots in the group.
    let ownBots: [Bot]
    /// Members tab (Add a second bot).
    let openMembers: () -> Void
    /// A new team goal in this panel (Add to meeting).
    let newGoal: () -> Void

    @State private var slackURL: URL?

    struct Item: Identifiable {
        let id: String
        let title: String
        let subtitle: String?
        let icon: String?
        let run: () -> Void
    }

    /// Slack goes through a bot: the lead when it is the viewer's, else their first.
    private var ownLead: Bot? {
        ownBots.first { $0.id == room.defaultResponder.botId } ?? ownBots.first
    }

    private var canAddRoutine: Bool { !ownBots.isEmpty && room.dm != true }

    private var items: [Item] {
        var out: [Item] = []
        if access.canAddBot && room.memberIds.count < 2 {
            out.append(Item(id: "bots", title: String(localized: "Add a second bot"),
                            subtitle: String(localized: "A group works best with bots that split the work."),
                            icon: nil, run: openMembers))
        }
        if let lead = ownLead, session.surfaceGate.allows(.botSlack) {
            out.append(Item(id: "slack", title: String(localized: "Add to Slack"), subtitle: nil, icon: "number") {
                if let slackURL {
                    openURL(slackURL)
                } else {
                    model.open(.bot(lead))
                    model.showPersona(.slack)
                }
            })
        }
        if canAddRoutine {
            out.append(Item(id: "meeting", title: String(localized: "Add to meeting"), subtitle: nil, icon: "calendar.badge.plus", run: newGoal))
        }
        return out
    }

    var body: some View {
        let rows = items
        Group {
            if prefs.showSuggestions, !rows.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Suggested")
                            .font(theme.font(12))
                            .foregroundStyle(theme.inkTertiary)
                        Spacer(minLength: 0)
                        Button {
                            prefs.setShowSuggestions(session, false)
                        } label: {
                            Text("Hide").font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("group-panel.suggestions-hide")
                    }
                    .padding(.horizontal, 2)
                    VStack(spacing: 0) {
                        ForEach(Array(rows.enumerated()), id: \.element.id) { index, item in
                            row(item)
                            if index < rows.count - 1 {
                                Rectangle().fill(theme.hairlineWeak).frame(height: 1)
                            }
                        }
                    }
                    .background(theme.card, in: RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous))
                    .clipShape(RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("group-panel.suggestions")
            }
        }
        .task(id: ownLead?.id) {
            guard let lead = ownLead else { slackURL = nil; return }
            slackURL = await session.profileClient?.slackManagementURL(botId: lead.id)
        }
    }

    private func row(_ item: Item) -> some View {
        Button(action: item.run) {
            HStack(alignment: item.subtitle == nil ? .center : .top, spacing: 10) {
                Group {
                    if let icon = item.icon {
                        Image(systemName: icon).font(.system(size: 14))
                    } else {
                        DesktopIconView(icon: .sparkles, size: 15)
                    }
                }
                .foregroundStyle(theme.inkSecondary)
                .frame(width: 16)
                .padding(.top, item.subtitle == nil ? 0 : 2)
                VStack(alignment: .leading, spacing: 0) {
                    Text(verbatim: item.title)
                        .font(theme.font(13, .semibold))
                        .foregroundStyle(theme.ink)
                        .lineLimit(1)
                        .frame(height: 20, alignment: .leading)
                    if let subtitle = item.subtitle {
                        Text(verbatim: subtitle)
                            .font(theme.font(12))
                            .foregroundStyle(theme.inkSecondary)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityIdentifier("group-panel.suggestion.\(item.id)")
    }
}

// MARK: - Tasks

/// `BotTaskSection` with a group scope: every list of the viewer's bots in
/// the group, kept to the tasks of the group's conversations. Answer and
/// Open go back to the group conversation the task came from.
struct GroupPanelTasks: View {
    @Environment(\.desktopTheme) private var theme
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let room: Room
    let ownBots: [Bot]
    let docked: Bool

    private struct Opened: Identifiable { let id: String }

    @State private var tasks: [BotTodo]?
    @State private var needsUpdate = false
    @State private var finishing: Set<String> = []
    @State private var working: Set<String> = []
    @State private var opened: Opened?
    @State private var removing: BotTodo?

    private var threads: Set<String> { GroupPanelLibrary.threads(of: room) }
    private var listed: [BotTodo] { BotTodoList.listed(tasks ?? [], finishing: finishing) }
    private var scopeKey: String { ownBots.map(\.id).joined(separator: ",") + "|" + threads.sorted().joined(separator: ",") }

    var body: some View {
        Group {
            if needsUpdate {
                section {
                    Text("Available after the server update.")
                        .font(theme.font(12))
                        .foregroundStyle(theme.inkTertiary)
                        .accessibilityIdentifier("group-panel.tasks-needs-update")
                }
            } else if !listed.isEmpty {
                section { rows(listed) }
            } else {
                // nothing to show: no section, its loads kept
                Color.clear.frame(height: 0)
            }
        }
        .task(id: scopeKey) { await reload() }
        .onValueChange(of: scenePhase) { phase in
            if phase == .active { Task { await reload() } }
        }
        .onReceive(NotificationCenter.default.publisher(for: .sagaxBotTasksChanged)) { note in
            guard let id = note.object as? String, ownBots.contains(where: { $0.id == id }) else { return }
            Task { await reload() }
        }
        .sheet(item: $opened) { open in
            NavigationStack {
                if let task = tasks?.first(where: { $0.id == open.id }) {
                    BotTaskDetailView(
                        task: task,
                        working: working.contains(task.id),
                        answer: { fromDetail { answer(task) } },
                        openConversation: { fromDetail { openThread(thread(of: task)) } },
                        perform: { action in await perform(action, on: task) }
                    )
                } else {
                    Color.clear.onAppear { opened = nil }
                }
            }
            .environmentObject(session)
        }
        .confirmationDialog(Text("Remove this task?"), isPresented: Binding(
            get: { removing != nil }, set: { if !$0 { removing = nil } }
        ), titleVisibility: .visible, presenting: removing) { task in
            Button(String(localized: "Remove"), role: .destructive) {
                Task { await perform(.remove, on: task) }
            }
            .accessibilityIdentifier("group-panel.task-remove-confirm")
            Button(String(localized: "Cancel"), role: .cancel) {}
        } message: { task in
            Text(verbatim: task.title)
        }
    }

    private func section<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Tasks")
                .font(theme.font(13))
                .foregroundStyle(theme.inkSecondary)
                .padding(.horizontal, 2)
                .frame(height: 28, alignment: .leading)
            content()
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("group-panel.tasks")
    }

    private func rows(_ items: [BotTodo]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, task in
                row(task)
                if index < items.count - 1 {
                    Rectangle().fill(theme.hairlineWeak).frame(height: 1)
                }
            }
        }
        .padding(1)
        .background(theme.card, in: RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
    }

    private func row(_ task: BotTodo) -> some View {
        let busy = working.contains(task.id)
        let bot = session.state.bot(task.botId)
        return HStack(spacing: 10) {
            Button {
                Haptics.selection()
                opened = Opened(id: task.id)
            } label: {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: BotTodoWording.symbol(task.state))
                        .font(.system(size: 14))
                        .foregroundStyle(glyphColor(task.state))
                        .frame(width: 20, height: 20)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(verbatim: task.title)
                            .font(theme.font(13))
                            .foregroundStyle(task.state == .done ? theme.inkSecondary : theme.ink)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        Text(verbatim: line(task, bot: bot))
                            .font(theme.font(12))
                            .foregroundStyle(task.state == .waiting ? theme.accentText : theme.inkTertiary)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: "\(task.title), \(BotTodoWording.stateLabel(task.state))"))
            .accessibilityIdentifier("group-panel.task.\(task.id)")
            if busy {
                ProgressView().controlSize(.mini).frame(width: 28, height: 28)
            } else if task.state == .waiting {
                Button(String(localized: "Answer")) { answer(task) }
                    .font(theme.font(12, .medium))
                    .buttonStyle(.plain)
                    .foregroundStyle(theme.accentText)
                    .accessibilityIdentifier("group-panel.task-answer.\(task.id)")
            }
            Menu { menuItems(task) } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.inkTertiary)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("More actions for \(task.title)"))
            .accessibilityIdentifier("group-panel.task-menu.\(task.id)")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .hoverEffect(.highlight)
        .contextMenu { menuItems(task) }
    }

    /// Several of the viewer's bots: the line names whose task it is.
    private func line(_ task: BotTodo, bot: Bot?) -> String {
        let subtitle = BotTodoWording.subtitle(task)
        guard ownBots.count > 1, let bot else { return subtitle }
        return "\(bot.name) · \(subtitle)"
    }

    @ViewBuilder
    private func menuItems(_ task: BotTodo) -> some View {
        Button(String(localized: "Open"), systemImage: "doc.text") { opened = Opened(id: task.id) }
        if task.state == .waiting {
            Button(String(localized: "Answer"), systemImage: "arrowshape.turn.up.left") { answer(task) }
        }
        Button(String(localized: "Open the conversation"), systemImage: "bubble.left.and.bubble.right") { openThread(thread(of: task)) }
        ForEach(BotTodoList.moves(for: task.state), id: \.self) { action in
            Button(BotTodoWording.actionTitle(action), systemImage: BotTodoWording.actionSymbol(action)) {
                Task { await perform(action, on: task) }
            }
        }
        Divider()
        Button(String(localized: "Remove"), systemImage: "trash", role: .destructive) { removing = task }
    }

    private func glyphColor(_ state: BotTodoState) -> Color {
        switch state {
        case .waiting: theme.accent
        case .done: theme.success
        default: theme.inkSecondary
        }
    }

    /// The group conversation the task came from, else the group's own.
    private func thread(of task: BotTodo) -> String {
        if let id = task.threadId, threads.contains(id) { return id }
        return room.threadId
    }

    private func answer(_ task: BotTodo) {
        let id = thread(of: task)
        ComposerPrefill.shared.set(BotTodoWording.answerDraft(task), threadId: id)
        openThread(id)
    }

    private func openThread(_ id: String) {
        if !docked { model.togglePanel() }
        session.openChat(threadId: id)
    }

    /// A change under a closing sheet is dropped: close it first.
    private func fromDetail(_ run: @escaping () -> Void) {
        opened = nil
        Task {
            try? await Task.sleep(nanoseconds: 500_000_000)
            run()
        }
    }

    @discardableResult
    private func perform(_ action: BotTodoAction, on task: BotTodo) async -> Bool {
        guard let client = session.settingsClient, !working.contains(task.id) else { return false }
        working.insert(task.id)
        defer { working.remove(task.id) }
        do {
            try await client.act(action, onBotTodo: task.id, botId: task.botId)
            Haptics.success()
            if action == .remove, opened?.id == task.id { opened = nil }
            await reload()
            return true
        } catch {
            await reload()
            return false
        }
    }

    /// Every list of the viewer's bots in the group, merged; a list that
    /// fails is skipped while another answers (desktop `mergeTaskLists`).
    private func reload() async {
        guard let client = session.settingsClient, !ownBots.isEmpty else { tasks = []; return }
        let scope = threads
        var merged: [BotTodo] = []
        var answered = 0
        var lastError: Error?
        for bot in ownBots {
            do {
                let list = try await client.botTodos(botId: bot.id)
                answered += 1
                merged += list.filter { task in task.threadId.map { scope.contains($0) } ?? false }
            } catch is CancellationError {
                return
            } catch {
                lastError = error
            }
        }
        if answered == 0, let lastError {
            if case .needsUpdate = BotTodoList.outcome(of: lastError) { needsUpdate = true }
            return
        }
        needsUpdate = false
        let moved = BotTodoList.justFinished(from: tasks, to: merged)
        tasks = merged
        finishing = finishing.filter { id in merged.first { $0.id == id }?.state == .done }
        guard !moved.isEmpty else { return }
        finishing.formUnion(moved)
        Task {
            try? await Task.sleep(nanoseconds: UInt64(BotTodoList.doneLinger * 1_000_000_000))
            withAnimation(.easeOut(duration: 0.35)) { finishing.subtract(moved) }
        }
    }
}
