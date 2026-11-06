// Coding chat window: a coding task opened like a chat (`CodingChat.tsx`,
// #2149). Header with X back to the bot's chat, transcript (bubbles /
// terminal / diffs), Changes band, and the composer always there. No
// Continue, no Close Chat, no Open thread.
import CompanionCore
import SwiftUI

struct CodingChatView: View {
    @Environment(\.themePalette) var themePalette
    let target: CodingChatTarget
    let parent: BotActivityModel
    var onClose: (() -> Void)?

    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss

    @State private var item: BotActivityItem
    @State private var detail: BotActivityDetail?
    @State private var messages: [CodingMessage] = []
    @State private var failed = false
    @State private var loadingOlder = false
    @State private var hasOlder = false
    @State private var oldestId: String?
    @State private var composing = false
    @State private var draft = ""
    @State private var sending = false
    @State private var sendFailed = false
    @State private var stopping = false
    @State private var followUntil: Date?
    @State private var now = Date()
    @State private var revealRowId: String?
    @State private var changesOpen = false
    /// The thread's raw messages: their digests carry the tokens.
    @State private var rawMessages: [Message] = []
    /// The side panel (desktop: the bot panel's Coding tab): a column when
    /// the window is wide, a sheet otherwise.
    @State private var panelOpen = true
    @State private var panelSheet = false
    @State private var width: CGFloat = 0

    init(target: CodingChatTarget, parent: BotActivityModel, onClose: (() -> Void)? = nil) {
        self.target = target
        self.parent = parent
        self.onClose = onClose
        _item = State(initialValue: target.seed ?? BotActivityItem(
            id: target.itemId,
            botId: target.botId,
            title: "",
            status: .running,
            startedAt: Date().timeIntervalSince1970 * 1000,
            threadId: target.threadId,
            coding: true
        ))
    }

    private var bot: Bot? { session.state.bots.first { $0.id == target.botId } }
    private var botName: String { bot?.name ?? item.botName ?? CodingChatRules.botFallback }
    private var threadId: String? { detail?.item.threadId ?? item.threadId ?? target.threadId }
    private var snapshot: CodingChatSnapshot {
        CodingChatModel.snapshot(messages: messages, item: item, detail: detail)
    }

    /// Wide enough for the transcript and the session column side by side.
    private var wide: Bool { width >= 720 }

    private var panelInput: CodingPanelInput {
        CodingPanelInput(item: detail?.item ?? item, detail: detail, bot: bot, threadId: threadId,
                         messages: rawMessages, repo: snapshot.place.repo, now: now)
    }

    /// Scroll the transcript to a message's row ("Show in conversation").
    private func reveal(_ messageId: String) {
        let rows = snapshot.rows
        guard let row = rows.first(where: { $0.id == messageId }) ?? rows.first(where: { $0.id.hasPrefix(messageId) }) else { return }
        panelSheet = false
        revealRowId = row.id
    }

    private func togglePanel() {
        if wide {
            withAnimation(.easeOut(duration: 0.2)) { panelOpen.toggle() }
        } else {
            panelSheet = true
        }
    }

    var body: some View {
        HStack(spacing: 0) {
            main
            if wide && panelOpen {
                Rectangle()
                    .fill(Theme.hairline)
                    .frame(width: 1)
                    .ignoresSafeArea(edges: .bottom)
                CodingChatPanel(input: panelInput, showMessage: reveal)
                    .frame(width: 300)
                    .transition(.move(edge: .trailing))
            }
        }
        .background(
            GeometryReader { proxy in
                Color.clear
                    .onAppear { width = proxy.size.width }
                    .onChange(of: proxy.size.width) { width = $0 }
            }
        )
        .background(Theme.bg.ignoresSafeArea())
        .sheet(isPresented: $panelSheet) {
            NavigationStack {
                CodingChatPanel(input: panelInput, showMessage: reveal)
                    .navigationTitle(Text(verbatim: CodingPanelStrings.title))
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button(String(localized: "Done")) { panelSheet = false }
                                .accessibilityIdentifier("coding.panel.done")
                        }
                    }
            }
            .presentationDetents([.medium, .large])
            .environmentObject(session)
        }
        .navigationTitle(Text(verbatim: BotActivityWording.title(item)))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button {
                    close()
                } label: {
                    Image(systemName: "xmark")
                }
                .accessibilityLabel(Text(verbatim: CodingChatRules.closeLabel))
                .accessibilityIdentifier("coding-chat-close-nav")
            }
        }
        .task(id: target.itemId) {
            await follow()
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: CodingChatRules.aria(title: BotActivityWording.title(item))))
        .accessibilityIdentifier("coding-chat")
    }

    private var main: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Theme.hairline)
            transcript
            if CodingChatRules.showChangesBand(files: snapshot.files, tests: snapshot.tests, place: snapshot.place) {
                changesBand
                Divider().overlay(Theme.hairline)
            }
            footer
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: Header

    /// The folder · the branch (desktop `codingWhere` order).
    private var metaLine: String? {
        let parts = [CodingChatRules.folderLine(snapshot.place), snapshot.place.branch].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// 2026-11-06 (desktop 1522091154, #2285): the session header is the
    /// chat header's pill (BotHeaderPill); the meta line keeps the folder
    /// and the branch only. The session's status and duration sit quietly
    /// in the "This session" card of the side panel, which the button at the
    /// right opens (a column on a wide window, a sheet otherwise).
    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if let bot {
                    ChatNameCapsule(chat: .bot(bot), state: snapshot.live ? .working : .idle) { close() }
                        .frame(maxWidth: 230, alignment: .leading)
                        .accessibilityIdentifier("coding-chat-pill")
                } else {
                    Text(verbatim: botName)
                        .font(Theme.Font.labelMedium)
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 4)
                Button {
                    togglePanel()
                } label: {
                    Image(systemName: "sidebar.right")
                        .font(.system(size: 15, weight: .regular))
                        .foregroundStyle(wide && panelOpen ? Theme.textPrimary : Theme.textSecondary)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: CodingPanelStrings.toggle))
                .accessibilityValue(Text(verbatim: "\(CodingChatRules.statusLabel(detail?.item.status ?? item.status)) · \(CodingChatRules.elapsedLabel(item: item, detail: detail, nowMs: now.timeIntervalSince1970 * 1000))"))
                .accessibilityAddTraits(wide && panelOpen ? .isSelected : [])
                .accessibilityIdentifier("coding.panel-toggle")
            }
            Text(verbatim: BotActivityWording.title(item))
                .font(Theme.font(17, .semibold))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(2)
            if let meta = metaLine {
                Text(verbatim: meta)
                    .font(Theme.Profile.labelFont)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                    .accessibilityIdentifier("coding-chat-meta")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .accessibilityIdentifier("coding-chat-header")
    }

    // MARK: Transcript

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if hasOlder {
                        Button {
                            Task { await loadOlder() }
                        } label: {
                            Text(verbatim: loadingOlder ? CodingChatRules.loadingOlder : CodingChatRules.loadOlder)
                                .font(Theme.Font.label)
                                .foregroundStyle(Theme.textSecondary)
                                .frame(maxWidth: .infinity)
                        }
                        .disabled(loadingOlder)
                        .accessibilityIdentifier("coding-chat-load-older")
                    }
                    if failed, messages.isEmpty {
                        VStack(spacing: 8) {
                            Text(verbatim: CodingChatRules.loadError)
                                .font(Theme.Font.body)
                                .foregroundStyle(Theme.textSecondary)
                            Button(CodingChatRules.retry) { Task { await reload() } }
                                .buttonStyle(.bordered)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, 40)
                    } else if messages.isEmpty {
                        Text(verbatim: snapshot.live ? CodingChatRules.starting : CodingChatRules.empty)
                            .font(Theme.Font.body)
                            .foregroundStyle(Theme.textTertiary)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 40)
                    }
                    ForEach(snapshot.rows) { row in
                        CodingChatRowView(row: row, botName: botName)
                            .id(row.id)
                    }
                    if snapshot.live {
                        Text(verbatim: CodingChatRules.working)
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.textTertiary)
                            .id("coding-working")
                    }
                }
                .padding(16)
            }
            .onChange(of: snapshot.rows.count) { _ in
                if let last = snapshot.rows.last?.id {
                    withAnimation { proxy.scrollTo(last, anchor: .bottom) }
                }
            }
            .onChange(of: revealRowId) { id in
                guard let id else { return }
                withAnimation { proxy.scrollTo(id, anchor: .center) }
                revealRowId = nil
            }
        }
    }

    // MARK: Changes

    private var changesBand: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                changesOpen.toggle()
            } label: {
                HStack(spacing: 8) {
                    Text(verbatim: snapshot.files.isEmpty ? CodingChatRules.changesNone : CodingChatRules.changesFilesLabel(snapshot.files.count))
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textPrimary)
                    if !snapshot.files.isEmpty {
                        let added = snapshot.files.reduce(0) { $0 + $1.added }
                        let removed = snapshot.files.reduce(0) { $0 + $1.removed }
                        if added > 0 {
                            Text(verbatim: "+\(added)").font(Theme.Font.label).foregroundStyle(Theme.success).monospacedDigit()
                        }
                        if removed > 0 {
                            Text(verbatim: "-\(removed)").font(Theme.Font.label).foregroundStyle(Theme.danger).monospacedDigit()
                        }
                    }
                    if let tests = snapshot.tests {
                        let passed = CodingChatRules.testsPassedLabel(tests.passed)
                        let failed = tests.failed > 0 ? ", \(CodingChatRules.testsFailedLabel(tests.failed))" : ""
                        Text(verbatim: "· \(passed)\(failed)")
                            .font(Theme.Font.label)
                            .foregroundStyle(tests.failed > 0 ? Theme.danger : Theme.textSecondary)
                    }
                    Spacer(minLength: 4)
                    if let branch = snapshot.place.branch {
                        Text(verbatim: branch)
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.textTertiary)
                            .lineLimit(1)
                    }
                    if let sha = snapshot.place.commit?.sha {
                        Text(verbatim: CodingChatRules.shortSha(sha))
                            .font(Theme.Font.code)
                            .foregroundStyle(Theme.textTertiary)
                    }
                    if let pull = snapshot.place.pull {
                        if let url = pull.url.flatMap(URL.init(string:)) {
                            Link(CodingChatRules.pullLabel(number: pull.number), destination: url)
                                .font(Theme.Font.label)
                        } else {
                            Text(verbatim: CodingChatRules.pullLabel(number: pull.number))
                                .font(Theme.Font.label)
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                    if !snapshot.files.isEmpty {
                        Image(systemName: changesOpen ? "chevron.down" : "chevron.right")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Theme.textTertiary)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("coding-chat-changes")

            if changesOpen {
                ForEach(snapshot.files) { file in
                    Button {
                        revealRowId = file.rowId
                    } label: {
                        HStack {
                            Text(verbatim: file.path)
                                .font(Theme.Font.code)
                                .foregroundStyle(Theme.textPrimary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Spacer()
                            if file.added > 0 {
                                Text(verbatim: "+\(file.added)").font(Theme.Font.label).foregroundStyle(Theme.success)
                            }
                            if file.removed > 0 {
                                Text(verbatim: "-\(file.removed)").font(Theme.Font.label).foregroundStyle(Theme.danger)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 6)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.bottom, 8)
            }
        }
        .background(Theme.card)
    }

    // MARK: Footer

    /// Always-on composer (#2149): a message goes to the task's thread. Stop
    /// stays beside it while the job runs. No Continue / Close Chat.
    private var footer: some View {
        VStack(spacing: 8) {
            HStack(alignment: .bottom, spacing: 8) {
                TextField(CodingChatRules.followUpPlaceholder(botName: botName), text: $draft, axis: .vertical)
                    .lineLimit(1...4)
                    .textFieldStyle(.plain)
                    .padding(10)
                    .background(Theme.inset, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .accessibilityIdentifier("coding-chat-compose")
                if snapshot.canStop {
                    Button(role: .destructive) {
                        stop()
                    } label: {
                        if stopping { ProgressView().controlSize(.small) }
                        else { Text(verbatim: CodingChatRules.stopLabel) }
                    }
                    .buttonStyle(.bordered)
                    .disabled(stopping)
                    .accessibilityIdentifier("coding-chat-stop")
                }
                Button {
                    Task { await sendFollowUp() }
                } label: {
                    if sending { ProgressView().controlSize(.small) }
                    else { Text(verbatim: CodingChatRules.sendLabel) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
                .accessibilityIdentifier("coding-chat-send")
            }
            if sendFailed {
                Text(verbatim: CodingChatRules.followUpError)
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Theme.card)
        .onAppear { composing = true }
    }

    // MARK: Actions

    private func close() {
        if let onClose { onClose() }
        else { dismiss() }
    }

    private func stop() {
        let targetItem = detail?.item ?? item
        stopping = true
        parent.stopItem(targetItem, fromDetail: true) { message in
            session.actionError = message
        }
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            stopping = false
            await reload()
        }
    }

    private func sendFollowUp() async {
        let words = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let client = session.profileClient, let threadId, !words.isEmpty else { return }
        sending = true
        sendFailed = false
        defer { sending = false }
        do {
            if snapshot.live {
                try await client.steerActivity(botId: target.botId, threadId: threadId, text: words)
            } else {
                _ = try await client.send(text: words, toBot: target.botId, threadId: threadId)
            }
            draft = ""
            composing = false
            followUntil = Date().addingTimeInterval(CodingChatRules.followSeconds)
            await reload()
        } catch {
            sendFailed = true
        }
    }

    private func follow() async {
        await reload()
        while !Task.isCancelled {
            let live = snapshot.live || (followUntil.map { Date() < $0 } ?? false)
            guard live else { return }
            try? await Task.sleep(nanoseconds: UInt64(CodingChatRules.pollSeconds * 1_000_000_000))
            now = Date()
            await reload()
        }
    }

    private func reload() async {
        guard let client = session.profileClient else { return }
        do {
            let loaded = try await client.botActivityDetail(botId: target.botId, itemId: target.itemId)
            detail = loaded
            item = loaded.item
            failed = false
            if let threadId = loaded.item.threadId ?? target.threadId {
                let page = try await client.messages(threadId: threadId, limit: 80)
                messages = page.messages.map { $0.toCodingMessage() }
                rawMessages = page.messages
                oldestId = page.messages.first?.id
                hasOlder = page.messages.count >= 80
            } else if !loaded.steps.isEmpty {
                messages = stepMessages(loaded.steps, botId: target.botId, botName: botName)
                hasOlder = false
            }
        } catch {
            if messages.isEmpty { failed = true }
        }
    }

    private func loadOlder() async {
        guard let client = session.profileClient, let threadId, let oldestId, !loadingOlder else { return }
        loadingOlder = true
        defer { loadingOlder = false }
        do {
            let page = try await client.messages(threadId: threadId, before: oldestId, limit: 80)
            let older = page.messages.map { $0.toCodingMessage() }
            messages = older + messages
            rawMessages = page.messages + rawMessages
            self.oldestId = page.messages.first?.id ?? oldestId
            hasOlder = page.messages.count >= 80
        } catch {
            // Keep what we have.
        }
    }
}

// MARK: - Row

private struct CodingChatRowView: View {
    @Environment(\.themePalette) var themePalette
    let row: CodingRow
    let botName: String

    var body: some View {
        switch row {
        case let .line(_, message):
            bubble(message)
        case let .reads(_, _, paths, running):
            HStack(spacing: 6) {
                Text(verbatim: CodingChatRules.read)
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textTertiary)
                ForEach(paths, id: \.self) { path in
                    Text(verbatim: path)
                        .font(Theme.Font.code)
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Theme.inset, in: Capsule())
                }
                if running { ProgressView().controlSize(.mini) }
            }
        case let .step(_, _, step):
            stepView(step)
        }
    }

    @ViewBuilder
    private func bubble(_ message: CodingMessage) -> some View {
        let mine = message.role == "user"
        HStack {
            if mine { Spacer(minLength: 40) }
            Text(verbatim: message.text ?? "")
                .font(Theme.Font.body)
                .foregroundStyle(mine ? Theme.textPrimary : Theme.textPrimary)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(mine ? Theme.accent.opacity(0.18) : Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Theme.hairline, lineWidth: 1)
                )
            if !mine { Spacer(minLength: 40) }
        }
    }

    @ViewBuilder
    private func stepView(_ step: CodingStep) -> some View {
        switch step {
        case let .command(_, command, output, exitCode, ok, durationMs, tests, diff):
            VStack(alignment: .leading, spacing: 8) {
                CodingTerminalView(
                    command: command,
                    output: output,
                    exitCode: exitCode,
                    ok: ok,
                    durationMs: durationMs,
                    tests: tests,
                    initiallyExpanded: ok == nil || ok == false
                )
                if let diff {
                    ForEach(Array(diff.enumerated()), id: \.offset) { _, file in
                        CodingDiffView(file: file)
                    }
                }
            }
        case let .edit(_, files, ok, error):
            VStack(alignment: .leading, spacing: 8) {
                if ok == false {
                    Text(verbatim: error.map(CodingChatRules.editFailedWhy) ?? CodingChatRules.editFailed)
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.danger)
                }
                ForEach(Array(files.enumerated()), id: \.offset) { _, file in
                    CodingDiffView(file: file)
                }
            }
        case let .read(_, paths):
            HStack(spacing: 6) {
                Text(verbatim: CodingChatRules.read).font(Theme.Font.label).foregroundStyle(Theme.textTertiary)
                ForEach(paths, id: \.self) { path in
                    Text(verbatim: path)
                        .font(Theme.Font.code)
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Theme.inset, in: Capsule())
                }
            }
        case let .tool(_, tool):
            HStack(spacing: 8) {
                Image(systemName: "wrench.and.screwdriver")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textTertiary)
                Text(verbatim: tool.summary ?? tool.name)
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(2)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.inset, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }
}
