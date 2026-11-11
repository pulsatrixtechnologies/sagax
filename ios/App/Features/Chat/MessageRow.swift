// One transcript row: the message's content by kind, its reactions, the
// branch switcher, and the long-press menu (MessageMenu).
import SwiftUI
import CompanionCore
import UIKit

struct MessageRow: View {
    @Environment(\.themePalette) var themePalette
    let chat: Chat
    let message: Message
    /// Last bubble of a run from the same side: the one that gets the tail.
    var endsRun = true
    let openLink: (URL, Message) -> OpenURLAction.Result
    /// Where an "Opened thread" chip goes; nil leaves the chip a receipt.
    var openThread: ((ThreadRef) -> Void)? = nil
    /// After Resume on a routine that paused itself (the passing banner closes).
    var afterResume: (() -> Void)? = nil
    /// What the row reads from the session, passed in by the chat (#3017,
    /// L02). The row no longer observes the session: every frame used to
    /// re-run the body of every row on screen.
    var rowContext: RowContext = .none
    private var session: Session { SessionHub.session }
    @State private var editingText = ""
    @State private var showingEdit = false
    /// The text being selected, and the sheet's presentation in one value.
    @State private var selecting: SelectableText?
    /// "Add reaction" from the message menu (#270).
    @State private var addingReaction = false
    /// A digest chip's parts, and its sheet's presentation.
    @State private var digest: DigestSummary?
    /// View Source: this bot reply drawn as its markdown source.
    @State private var showingSource = false
    /// Report: the report sheet for this bot reply.
    @State private var reporting = false
    /// Report on another person's line (App Store 1.2): the server path.
    @State private var reportingPerson = false
    /// Block's confirmation, and a blocked line opened with Show.
    @State private var confirmingBlock = false
    @State private var revealedBlocked = false
    @Environment(\.messageActions) private var context
    /// Cite in the Select Text sheet (CO8); nil where nothing can be sent.
    @Environment(\.citeIntoComposer) private var citeIntoComposer
    @ObservedObject private var speaker = MessageSpeaker.shared
    @ObservedObject private var toolCalls = ToolCallsSetting.shared
    private var activityDetail: String { toolCalls.detail.rawValue }
    /// iPad desktop shell: the hover row beside the bubble (MessageActions.tsx).
    @Environment(\.desktopChatText) private var desktop

    private func askCw(_ action: CwActionBody) {
        Task { await session.requestCwAction(action, threadId: chat.threadId, botId: message.from?.botId) }
    }

    private var versions: [Message] {
        session.versions(of: message, inThread: chat.threadId)
    }

    /// The stand-in for an edit the computer has not answered yet. It has no
    /// server identity, so nothing may react to it or edit it again.
    private var isPendingEdit: Bool {
        session.state.pendingEdits[chat.threadId]?.placeholderId == message.id
    }

    /// Transport tags contain paths on the paired computer. They belong in
    /// attachment cards, never on the clipboard or in the text-selection UI.
    private var attachedContent: AttachedMessageContent {
        AttachedMessageContent.parse(message.text ?? "")
    }

    var body: some View {
        VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 6) {
            if !revealedBlocked, session.isBlockedLine(message, in: chat) {
                // someone this person blocked: folded, for them only
                BlockedLineRow { revealedBlocked = true }
            } else {
            content
                .environment(\.desktopMessageActions, desktop == nil || isPendingEdit ? nil : DesktopMessageActions(
                    copyText: message.webhookContent?.task ?? Citations.split(attachedContent.text).display,
                    actions: actionSet,
                    at: message.date,
                    react: { emoji in Task { await session.react(to: message, in: chat.threadId, emoji: emoji) } },
                    mine: Set(ReactionRules.chips(message.reactions ?? [], selfIds: ReactionChipsRow.selfIds(session, threadId: chat.threadId)).filter(\.mine).map(\.emoji)),
                    moreReactions: { addingReaction = true }
                ))
            }

            if let comm = message.comm {
                // the chip already says what happened ("Posted in Standup");
                // a linked chip is not always a message sent to someone
                Label(message.tool?.name ?? "Messaged \(comm.withName)", systemImage: "arrow.up.right.bubble")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
            }

            // #270: chips in landing order, who reacted on a long press
            ReactionChipsRow(message: message, chat: chat, rowContext: rowContext)
            // #270: Seen by (faces in a room, "Seen" with a bot)
            SeenByRow(message: message, chat: chat, rowContext: rowContext)

            if versions.count > 1, let index = versions.firstIndex(where: { $0.id == message.id }),
               case let .bot(bot) = chat {
                HStack(spacing: 8) {
                    Button {
                        Task { await session.switchVersion(to: versions[index - 1], for: bot) }
                    } label: { Image(systemName: "chevron.left") }
                    .disabled(index == 0 || bot.busy == true)
                    Text("\(index + 1) of \(versions.count)")
                    Button {
                        Task { await session.switchVersion(to: versions[index + 1], for: bot) }
                    } label: { Image(systemName: "chevron.right") }
                    .disabled(index + 1 >= versions.count || bot.busy == true)
                }
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
            }
        }
        .contextMenu {
            MessageMenu(
                message: message,
                chat: chat,
                visibleText: message.webhookContent?.task ?? Citations.split(attachedContent.text).display,
                canReact: !isPendingEdit,
                canEdit: message.role == .user
                    && message.kind == .text
                    && message.webhookContent == nil
                    && attachedContent.attachments.isEmpty
                    && !isPendingEdit,
                editDisabled: session.state.pendingEdits[chat.threadId] != nil,
                actions: actionSet,
                selectText: { selecting = SelectableText(text: $0) },
                addReaction: { addingReaction = true },
                edit: {
                    editingText = message.text ?? ""
                    showingEdit = true
                }
            )
        }
        .sheet(isPresented: $addingReaction) {
            AddReactionSheet(
                mine: Set(ReactionRules.chips(message.reactions ?? [], selfIds: ReactionChipsRow.selfIds(session, threadId: chat.threadId)).filter(\.mine).map(\.emoji)),
                pick: { emoji in
                    addingReaction = false
                    Task { await session.react(to: message, in: chat.threadId, emoji: emoji) }
                },
                close: { addingReaction = false }
            )
        }
        .alert("Edit and retry", isPresented: $showingEdit) {
            TextField("Message", text: $editingText)
            Button("Cancel", role: .cancel) {}
            if case let .bot(bot) = chat {
                Button("Send") {
                    let text = editingText.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !text.isEmpty else { return }
                    Task { await session.edit(message, for: bot, text: text) }
                }
            }
        } message: {
            Text("This creates a new version and continues from there.")
        }
        .sheet(item: $selecting) {
            SelectableTextSheet(text: $0.text, citation: CitationTarget(chat: chat, message: message, add: citeIntoComposer))
        }
        .sheet(item: $digest) {
            DigestSheet(summary: $0)
        }
        .sheet(isPresented: $reporting) {
            ReportMessageSheet(
                message: message,
                visibleText: Citations.split(attachedContent.text).display,
                botName: message.from?.name ?? chat.name,
                demo: session.isDemo
            )
        }
        .sheet(isPresented: $reportingPerson) {
            if let author = session.personAuthor(of: message, in: chat) {
                ReportPersonSheet(message: message, chat: chat, author: author)
                    .environmentObject(session)
            }
        }
        .confirmationDialog(blockTitle, isPresented: $confirmingBlock, titleVisibility: .visible) {
            if let author = session.personAuthor(of: message, in: chat) {
                Button("Block", role: .destructive) { Task { _ = await session.block(author) } }
                    .accessibilityIdentifier("block-confirm")
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Their messages in rooms and direct messages are hidden for you only. They are not told. You can unblock them in Settings.")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("message-\(message.id)")
    }

    private var blockTitle: String {
        let name = session.personAuthor(of: message, in: chat)?.name ?? ""
        return String(localized: "Block \(name)?")
    }

    /// The desktop's message actions for this row (ChatView.tsx `Bubble`,
    /// GroupView.tsx), each behind its gate and rule.
    private var actionSet: MessageActionSet {
        let gate = session.surfaceGate
        var set = MessageActionSet()
        guard !isPendingEdit else { return set }
        let quotable = MessageActionRules.canQuote(message)
        if quotable, gate.allows(.replyQuote), let reply = context.reply {
            set.reply = { reply(message) }
        }
        // Rooms offer Reply and Pin only (GroupView.tsx); View Source, Read
        // Aloud and Regenerate belong to a bot's own conversation.
        if case let .bot(bot) = chat {
            if MessageActionRules.canViewSource(message), message.kind == .text {
                set.showingSource = showingSource
                set.toggleSource = { showingSource.toggle() }
            }
            if MessageActionRules.canSpeak(message), gate.allows(.speakReply) {
                let text = message.text ?? ""
                let speaking = speaker.isSpeaking(message.id)
                set.speaking = speaking
                set.speak = speaking
                    ? { speaker.stop() }
                    : { speaker.speak(text, messageId: message.id, voiceId: bot.voice, botId: bot.id, session: session) }
            }
        }
        if case let .bot(bot) = chat, gate.allows(.regenerate), context.regenerableMessageId == message.id {
            set.regenerate = { Task { await session.regenerate(for: bot) } }
        }
        if quotable, gate.allows(.messagePin) {
            let pinned = context.pinnedMessageId == message.id
            set.pinned = pinned
            let target = chat
            set.togglePin = { Task { await session.setPinnedMessage(pinned ? nil : message.id, in: target) } }
        }
        if message.role == .bot, case .room = chat { set.routedBy = message.routedBy }
        if MessageReport.canReport(message, isBot: { session.state.bot($0) != nil }) {
            set.report = { reporting = true }
        } else if let author = session.personAuthor(of: message, in: chat) {
            // another person's line (App Store 1.2): Report to the admins,
            // Block or Unblock for this person only
            set.report = { reportingPerson = true }
            let blocked = session.blockedIds.contains(author.id)
            set.personName = author.name
            set.personBlocked = blocked
            set.toggleBlock = blocked
                ? { Task { _ = await session.unblock(author.id) } }
                : { confirmingBlock = true }
        }
        return set
    }

    @ViewBuilder
    private var content: some View {
        // A card projected for someone who is not its approval audience
        // (OwnerWait.tsx): who it waits on, or who settled it. No controls.
        if message.ownerWait != nil {
            OwnerWaitView(message: message)
        } else if let ref = message.pagePublish, ref.isDrawable, message.role == .bot {
            // a bot's page: its live card; a tap opens it (PublishedPages.tsx)
            PagePublishCardView(ref: ref, botId: message.from?.botId ?? chat.id, threadId: chat.threadId) {
                TextBubble(message: message, chat: chat, tailed: endsRun, openLink: openLink, cwAsk: askCw)
            }
        } else if let outbound = message.outbound, outbound.isDrawable, message.role == .bot {
            // a phone call or a purchase on its card (OutboundCard.tsx)
            OutboundCardView(card: outbound, accent: Theme.readable(MausPalette.color(chat.color)))
        } else if let attention = message.attention, message.role == .bot, message.kind == .text {
            // 2026-11-05: what a bot's turn elsewhere left for you
            // (AttentionCard.tsx). One conversation (#2081, #2098): the answer
            // is typed right here; Open thread exists only with threads shown.
            AttentionCardView(
                card: attention,
                tint: MausPalette.color(chat.color),
                openThread: threadsShown ? openThread : nil,
                openRun: attention.routineRunId.map { runId in { Task { await session.openRoutineRunInChat(id: runId) } } },
                reply: threadsShown ? nil : { text in try await session.answerAttention(attention, text: text, message: message, in: chat) },
                // #3471: one conversation: skipped without an answer
                skip: threadsShown ? nil : { await session.skipAttention(message, in: chat) },
                messageId: message.id
            )
            // #3465: a watch alert's two exits, for the bot's owner
            if let watches = WatchAlertRules.alert(of: message.routineRun), let bot = session.state.bot(attention.botId),
               session.surfaceGate.ownsBot(bot) {
                WatchAlertExitsView(watches: watches)
            }
        } else {
            kindContent
        }
    }

    /// The message's content by kind, drawn by its own view (#3108). One
    /// `@ViewBuilder` switch holding every card made Swift -O build the whole
    /// `_ConditionalContent` tree in a single body getter: 0.8.71 (build 140)
    /// overflowed the main thread's stack on the first row drawn when a chat
    /// opened. A child view's body is evaluated after this one returns, so
    /// each frame stays small.
    private var kindContent: some View {
        MessageKindContent(
            message: message,
            chat: chat,
            endsRun: endsRun,
            showingSource: showingSource,
            retryable: retryable,
            hideDigests: activityDetail == ActivityDetail.hidden.rawValue,
            openLink: openLink,
            openThread: openThread,
            threadOpener: threadsShown ? openThread : nil,
            afterResume: afterResume,
            askCw: askCw,
            openRun: routineRunOpener,
            select: { selecting = SelectableText(text: $0) },
            openDigest: { digest = $0 }
        )
    }

    /// This failed turn is the conversation's last row and its bot is idle.
    private var retryable: Bool {
        guard ErrorRowRules.isError(message), case let .bot(bot) = chat else { return false }
        return ErrorRowRules.retryableErrorId(
            in: session.visibleTranscript(forThread: chat.threadId),
            busy: bot.busy == true,
            pendingId: session.state.pendingEdits[chat.threadId]?.placeholderId
        ) == message.id
    }

    /// A run thread is opened by the same route an "Opened thread" chip
    /// takes, so it lands on screen without joining the thread list. No
    /// route — the run was deleted, or the phone holds no bot owning it —
    /// means no button.
    /// The threads setting (SidebarPrefs): with threads off, the chat is one
    /// conversation and no row offers a thread (#2081).
    private var threadsShown: Bool { SidebarPrefsModel.shared.showThreads }

    /// The bot a role banner names ("Nova s'est arrêté").
    private var roleNoticeBotName: String? {
        if let id = message.from?.botId, let bot = session.state.bot(id) { return bot.name }
        if case let .bot(bot) = chat { return bot.name }
        return nil
    }

    /// View run (#2098): the run's message in the bot's chat, from wherever
    /// the card sits (a room's card too). A run the computer no longer lists
    /// falls back to its execution thread when threads are shown and this
    /// phone has a route to it.
    private func routineRunOpener(_ card: RoutineRunCard) -> (() -> Void)? {
        let fallback = session.state.routineExecutionRef(for: card)
        let openThread = threadsShown ? openThread : nil
        return {
            Task {
                let listing = await session.loadRoutines()
                if let run = listing.runs.first(where: { $0.id == card.runId }) {
                    await session.openRoutineRunInChat(run)
                } else if let openThread, let fallback {
                    openThread(fallback)
                }
            }
        }
    }
}

/// A row is the same row while its message, its chat record and its place in
/// the run are. The callbacks are rebuilt on every render of the screen and
/// never compare equal, which without this made every row re-evaluate its
/// body (markdown included) whenever the chat screen did.
extension MessageRow: Equatable {
    static func == (lhs: MessageRow, rhs: MessageRow) -> Bool {
        lhs.message == rhs.message
            && Self.sameChat(lhs.chat, rhs.chat)
            && lhs.endsRun == rhs.endsRun
            && (lhs.openThread == nil) == (rhs.openThread == nil)
            && lhs.rowContext.same(as: rhs.rowContext, for: lhs.message)
    }

    /// The chat record without its transcript and task list: comparing the
    /// whole `Chat` compared the entire conversation once per row on every
    /// render (#3017, L05). A row reads the chat's identity, never its
    /// messages (those come from the session).
    static func sameChat(_ lhs: Chat, _ rhs: Chat) -> Bool {
        switch (lhs, rhs) {
        case let (.bot(a), .bot(b)):
            guard a.id == b.id else { return false }
            return slim(a) == slim(b)
        case let (.room(a), .room(b)):
            guard a.id == b.id else { return false }
            var x = a, y = b
            x.messages = nil
            y.messages = nil
            return x == y
        default:
            return false
        }
    }

    private static func slim(_ bot: Bot) -> Bot {
        var copy = bot
        copy.messages = nil
        copy.tasks = nil
        return copy
    }
}

/// The session state a transcript row draws from besides its message: the
/// edit in flight, blocked people, the viewer, demo mode and bot names. The
/// chat builds it once per render and rows compare it, so a frame that
/// changes none of it leaves every row alone (#3017, L02).
struct RowContext: Equatable {
    var pendingPlaceholderId: String?
    var lastVisibleId: String?
    var blockedIds: Set<String>
    var viewerId: String?
    var demo: Bool
    var botNames: [String]

    static let none = RowContext(pendingPlaceholderId: nil, lastVisibleId: nil, blockedIds: [], viewerId: nil, demo: false, botNames: [])

    /// The last line only matters to an error row (its Retry button): a new
    /// message would otherwise redraw every row above it.
    func same(as other: RowContext, for message: Message) -> Bool {
        pendingPlaceholderId == other.pendingPlaceholderId
            && (!ErrorRowRules.isError(message) || lastVisibleId == other.lastVisibleId)
            && blockedIds == other.blockedIds
            && viewerId == other.viewerId
            && demo == other.demo
            && botNames == other.botNames
    }
}


// MARK: - Content by kind
//
// Each kind draws from a small view of its own. The switch used to live in
// `MessageRow.kindContent` with every card inline; see that property.

/// The switch over `Message.kind`, one small view per case.
private struct MessageKindContent: View {
    let message: Message
    let chat: Chat
    let endsRun: Bool
    let showingSource: Bool
    /// This failed turn is the conversation's last row and its bot is idle.
    let retryable: Bool
    /// Activity detail set to hidden: no digest chip.
    let hideDigests: Bool
    let openLink: (URL, Message) -> OpenURLAction.Result
    /// Where an "Opened thread" chip goes (a receipt when nil).
    let openThread: ((ThreadRef) -> Void)?
    /// `openThread` only while the threads setting shows threads (#2081).
    let threadOpener: ((ThreadRef) -> Void)?
    let afterResume: (() -> Void)?
    let askCw: (CwActionBody) -> Void
    let openRun: (RoutineRunCard) -> (() -> Void)?
    /// The text-selection sheet with this text.
    let select: (String) -> Void
    /// The digest sheet with this summary.
    let openDigest: (DigestSummary) -> Void
    private var session: Session { SessionHub.session }

    var body: some View {
        switch message.kind {
        case .text:
            TextKindRow(message: message, chat: chat, endsRun: endsRun, showingSource: showingSource, openLink: openLink, askCw: askCw)
        case .options:
            OptionsKindRow(message: message, chat: chat)
        case .secret:
            SecretKindRow(message: message, chat: chat, endsRun: endsRun, openLink: openLink, askCw: askCw)
        case .activity:
            ActivityKindRow(message: message, chat: chat, openThread: openThread, retryable: retryable)
        case .compaction:
            ReceiptChip(icon: "square.3.layers.3d", label: message.compaction?.chipText ?? message.text ?? "") {
                select(message.compaction?.summary ?? message.text ?? "")
            }
        case .screen:
            // Views on request only (shared/requested-views.ts).
            if message.requested == true {
                ScreenShot(threadId: chat.threadId, message: message)
            }
        case .video:
            if let video = message.video, message.requested == true {
                VideoWidgetView(video: video, onRequestRefresh: { text in
                    Task { await session.send(text, to: chat) }
                })
            }
        case .widget:
            // A bot's card, list or form (show_widget); its text when there is
            // no tree to draw, or in a room, where widgets are refused.
            ChatWidgetMessageView(
                chat: chat, message: message,
                fallback: AnyView(TextFallbackRow(message: message, chat: chat, endsRun: endsRun, openLink: openLink, askCw: askCw))
            )
        case .digest:
            DigestKindRow(message: message, hidden: hideDigests, open: openDigest)
        case .routineRun:
            RoutineRunKindRow(
                message: message, chat: chat, endsRun: endsRun, openLink: openLink, askCw: askCw,
                threadOpener: threadOpener, afterResume: afterResume, openRun: openRun
            )
        case .connector:
            // The connect-an-app card is gone; a message of this kind still
            // carries text written for this reader, so show it.
            TextFallbackRow(message: message, chat: chat, endsRun: endsRun, openLink: openLink, askCw: askCw)
        case .access:
            if let access = message.access {
                AccessCardView(access: access)
            } else {
                TextFallbackRow(message: message, chat: chat, endsRun: endsRun, openLink: openLink, askCw: askCw)
            }
        case .goalRun:
            if let run = message.goalRun {
                GoalRunCardView(run: run)
            } else {
                TextFallbackRow(message: message, chat: chat, endsRun: endsRun, openLink: openLink, askCw: askCw)
            }
        case .roster:
            RosterKindRow(message: message)
        case .unknown:
            // A message kind from a newer computer. Almost everything the
            // harness sends carries `text`, so showing it is usually the
            // whole message and always better than a gap in the transcript.
            // When there is nothing to show, show nothing — a placeholder
            // saying "unsupported" is a worse gap than the gap.
            TextFallbackRow(message: message, chat: chat, endsRun: endsRun, openLink: openLink, askCw: askCw)
        }
    }
}

/// The message's text as a bubble when there is any; nothing otherwise.
private struct TextFallbackRow: View {
    let message: Message
    let chat: Chat
    let endsRun: Bool
    let openLink: (URL, Message) -> OpenURLAction.Result
    let askCw: (CwActionBody) -> Void

    var body: some View {
        if let text = message.text, !text.isEmpty {
            TextBubble(message: message, chat: chat, tailed: endsRun, openLink: openLink, cwAsk: askCw)
        }
    }
}

private struct TextKindRow: View {
    let message: Message
    let chat: Chat
    let endsRun: Bool
    let showingSource: Bool
    let openLink: (URL, Message) -> OpenURLAction.Result
    let askCw: (CwActionBody) -> Void

    var body: some View {
        if let ref = message.parallelTask, ref.part == .result {
            ParallelResultLabel(ref: ref)
        }
        if message.role != .user, let via = message.relayVia {
            RelayViaLabel(via: via)
        }
        TextBubble(message: message, chat: chat, tailed: endsRun, showingSource: showingSource, openLink: openLink, cwAsk: askCw)
    }
}

/// A structured ask draws its own card: its answers are the model's
/// questions, not an allow/deny a tap could stand for.
private struct OptionsKindRow: View {
    let message: Message
    let chat: Chat

    var body: some View {
        if let via = message.relayVia {
            RelayViaLabel(via: via)
        }
        if message.card?.roleTransition != nil {
            // 2026-11-05 (the owner): no "Agit comme" card in the chat
            EmptyView()
        } else if message.card?.phoneCallConsent != nil {
            // one-time phone-call consent (PhoneCallConsentCard.tsx)
            PhoneCallConsentCardView(
                chat: chat,
                message: message,
                accent: Theme.readable(MausPalette.color(chat.color))
            )
        } else if message.card?.questions.isEmpty == false {
            QuestionCardView(chat: chat, message: message)
        } else if let card = message.card, ProactiveChoiceCardView.draws(card) {
            // #3465: a watch domain's choice card, in the compact look (#3457)
            ProactiveChoiceCardView(chat: chat, message: message)
        } else if let card = message.card, FlatQuestionCardView.draws(card) {
            // a bot's flat ask: the same question card (QuestionSheet)
            FlatQuestionCardView(chat: chat, message: message)
        } else {
            CardView(chat: chat, message: message)
        }
    }
}

private struct SecretKindRow: View {
    let message: Message
    let chat: Chat
    let endsRun: Bool
    let openLink: (URL, Message) -> OpenURLAction.Result
    let askCw: (CwActionBody) -> Void

    var body: some View {
        if let secret = message.secret {
            // A decline that resumed leaves nothing to show (SecretRequestCard.tsx).
            if VaultLoginCard.isVaultLogin(secret) {
                // a bot's sign-in request: saved logins and 1Password (parité R10)
                VaultLoginCardView(chat: chat, message: message, secret: secret)
            } else if !SecretCardRules.isHidden(secret) {
                CredentialRequestCardView(chat: chat, message: message, secret: secret)
            }
        } else {
            TextFallbackRow(message: message, chat: chat, endsRun: endsRun, openLink: openLink, askCw: askCw)
        }
    }
}

private struct ActivityKindRow: View {
    let message: Message
    let chat: Chat
    let openThread: ((ThreadRef) -> Void)?
    let retryable: Bool
    private var session: Session { SessionHub.session }

    var body: some View {
        if message.tool?.roleNotice != nil {
            // 2026-11-05 (the owner): no role notice in the chat
            EmptyView()
        } else if let widget = message.tool?.widget, widget.isKnown, CwWidgets.isViewTool(message.tool?.name) {
            CwWidgetCard(widget: widget, threadId: chat.threadId, botId: message.from?.botId, brand: message.tool?.product) { action in
                Task { await session.requestCwAction(action, threadId: chat.threadId, botId: message.from?.botId) }
            }
        } else if let line = message.tool?.finishUntil {
            // #1329: relaunch x/N, met, bound (FinishUntilEditor.swift)
            FinishUntilRow(line: line)
        } else if let ref = message.parallelTask, ref.isCard {
            ParallelTaskCardView(chat: chat, message: message, ref: ref, openThread: openThread)
        } else if let refusal = PreSendRefusal.kind(of: message) {
            // #2013: an engine refusal before any prompt went out. A 1:1
            // chat never draws it (the composer says it); a room keeps a
            // quiet line, never the red error row.
            PreSendRefusalLine(kind: refusal)
                .accessibilityIdentifier("presend-refusal-\(message.id)")
        } else {
            ActivityChip(
                tool: message.tool, threadRef: message.threadRef?.live, openThread: openThread,
                outputIsProse: message.isTeammateReport
            )
        }
        // A failed turn on the conversation's last row: Retry sends the
        // last user line again (ChatView.tsx ErrorRow).
        if retryable, PreSendRefusal.kind(of: message) == nil, case let .bot(bot) = chat {
            ErrorRetryButton { await session.regenerate(for: bot) }
                .accessibilityIdentifier("error-retry-\(message.id)")
        }
        // A turn that failed because Claude Code is too old for the
        // model: offer to run the updater for the engine this thread uses.
        if message.tool?.claudeUpdate == true, case let .bot(bot) = chat {
            ClaudeUpdateCard(
                instanceId: bot.currentTaskModelSelection.instanceId,
                tint: MausPalette.color(chat.color)
            )
        }
    }
}

/// Not a bubble: a chip saying the turn did something, opening onto what.
/// No "Paid with" any more (#201): who paid stays in the model picker.
private struct DigestKindRow: View {
    let message: Message
    let hidden: Bool
    let open: (DigestSummary) -> Void

    var body: some View {
        let summary = DigestSummary(text: message.text ?? "")
        if !summary.isEmpty && !hidden {
            ReceiptChip(icon: "checklist", label: summary.chipLabel, hint: "Shows what this turn did") {
                open(summary)
            }
            .accessibilityIdentifier("digest-chip-\(message.id)")
        }
    }
}

private struct RoutineRunKindRow: View {
    let message: Message
    let chat: Chat
    let endsRun: Bool
    let openLink: (URL, Message) -> OpenURLAction.Result
    let askCw: (CwActionBody) -> Void
    let threadOpener: ((ThreadRef) -> Void)?
    let afterResume: (() -> Void)?
    let openRun: (RoutineRunCard) -> (() -> Void)?
    private var session: Session { SessionHub.session }

    /// 2026-11-05 (#2008): the bot that ran it leads the card; a room card
    /// falls back to the message's sender when listed.
    private var runBot: Bot? {
        if case let .bot(bot) = chat { return session.state.bot(bot.id) ?? bot }
        if let id = message.from?.botId { return session.state.bot(id) }
        return nil
    }

    var body: some View {
        if let card = message.routineRun {
            RoutineRunCardView(
                card: card,
                at: message.date,
                tint: MausPalette.color(chat.color),
                bot: runBot,
                openRun: openRun(card),
                // #2096: Stop on the muted line while the run is live (queued, running, waiting)
                stop: { Task { await session.cancelRoutineRun(id: card.runId) } },
                resume: card.autoPausedAfter == nil ? nil : {
                    // 2026-10-26: back on, the failure count from zero
                    Task {
                        if await session.resumeRoutine(id: card.routineId) != nil { afterResume?() }
                    }
                },
                openThread: threadOpener
            )
            // 2026-11-05: items only the person can do, each with its ticket
            if let attention = message.attention, !attention.items.isEmpty, card.knownStatus == .completed {
                AttentionItemsView(items: attention.items)
            }
            // #3465: a watch alert's two exits, for the bot's owner
            if let watches = WatchAlertRules.alert(of: card), let bot = runBot, session.surfaceGate.ownsBot(bot) {
                WatchAlertExitsView(watches: watches)
            }
        } else {
            // A computer that sent the kind without its card: the text
            // is written for exactly this reader.
            TextFallbackRow(message: message, chat: chat, endsRun: endsRun, openLink: openLink, askCw: askCw)
        }
    }
}

/// #1480: one neutral centred line (RosterLine.tsx), never a bubble.
private struct RosterKindRow: View {
    let message: Message

    var body: some View {
        if let note = message.roster {
            Text(String(localized: "\(note.name) left the group"))
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 4)
                .accessibilityIdentifier("roster-line-\(message.id)")
        } else if let text = message.text, !text.isEmpty {
            Text(verbatim: text)
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
                .frame(maxWidth: .infinity)
        }
    }
}
