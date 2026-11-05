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
    @EnvironmentObject private var session: Session
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
    /// View run (2026-10-29): the run's detail, as the routines screens show
    /// it, never the execution conversation. Continue in the conversation
    /// stays in the detail.
    @State private var openedRun: OpenedRoutineRun?
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
        session.state.versions(of: message, inThread: chat.threadId)
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
            ReactionChipsRow(message: message, chat: chat)
            // #270: Seen by (faces in a room, "Seen" with a bot)
            SeenByRow(message: message, chat: chat)

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
        .routineRunDetail(item: $openedRun) { opened in
            RoutineRunDetailView(run: opened.run, routine: opened.routine)
                .environmentObject(session)
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
            // 2026-11-05: what a bot's turn elsewhere left for you (AttentionCard.tsx)
            AttentionCardView(
                card: attention,
                tint: MausPalette.color(chat.color),
                openThread: openThread,
                openRun: attention.routineRunId.map { runId in attentionRunOpener(runId) }
            )
        } else {
            kindContent
        }
    }

    @ViewBuilder
    private var kindContent: some View {
        switch message.kind {
        case .text:
            if let ref = message.parallelTask, ref.part == .result {
                ParallelResultLabel(ref: ref)
            }
            TextBubble(message: message, chat: chat, tailed: endsRun, showingSource: showingSource, openLink: openLink, cwAsk: askCw)
        case .options:
            // A structured ask draws its own card: its answers are the
            // model's questions, not an allow/deny a tap could stand for.
            if message.card?.phoneCallConsent != nil {
                // one-time phone-call consent (PhoneCallConsentCard.tsx)
                PhoneCallConsentCardView(
                    chat: chat,
                    message: message,
                    accent: Theme.readable(MausPalette.color(chat.color))
                )
            } else if message.card?.questions.isEmpty == false {
                QuestionCardView(chat: chat, message: message)
            } else if let card = message.card, FlatQuestionCardView.draws(card) {
                // a bot's flat ask: the same question card (QuestionSheet)
                FlatQuestionCardView(chat: chat, message: message)
            } else {
                CardView(chat: chat, message: message)
            }
        case .secret:
            if let secret = message.secret {
                // A decline that resumed leaves nothing to show (SecretRequestCard.tsx).
                if VaultLoginCard.isVaultLogin(secret) {
                    // a bot's sign-in request: saved logins and 1Password (parité R10)
                    VaultLoginCardView(chat: chat, message: message, secret: secret)
                } else if !SecretCardRules.isHidden(secret) {
                    CredentialRequestCardView(chat: chat, message: message, secret: secret)
                }
            } else if let text = message.text, !text.isEmpty {
                TextBubble(message: message, chat: chat, tailed: endsRun, openLink: openLink, cwAsk: askCw)
            }
        case .activity:
            if let widget = message.tool?.widget, widget.isKnown, CwWidgets.isViewTool(message.tool?.name) {
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
        case .compaction:
            ReceiptChip(icon: "square.3.layers.3d", label: message.compaction?.chipText ?? message.text ?? "") {
                selecting = SelectableText(text: message.compaction?.summary ?? message.text ?? "")
            }
        case .screen:
            // Views on request only (shared/requested-views.ts).
            if message.requested == true {
                ScreenShot(threadId: chat.threadId, message: message)
            }
        case .video:
            if let video = message.video, message.requested == true {
                VideoWidgetView(video: video)
            }
        case .widget:
            // A bot's card, list or form (show_widget); its text when there is
            // no tree to draw, or in a room, where widgets are refused.
            ChatWidgetMessageView(
                chat: chat, message: message,
                fallback: AnyView(Group {
                    if let text = message.text, !text.isEmpty {
                        TextBubble(message: message, chat: chat, tailed: endsRun, openLink: openLink, cwAsk: askCw)
                    }
                })
            )
        case .digest:
            // Not a bubble: a chip saying the turn did something, opening
            // onto what. No "Paid with" any more (#201): who paid stays in
            // the model picker.
            let summary = DigestSummary(text: message.text ?? "")
            if !summary.isEmpty && activityDetail != ActivityDetail.hidden.rawValue {
                ReceiptChip(icon: "checklist", label: summary.chipLabel, hint: "Shows what this turn did") {
                    digest = summary
                }
                .accessibilityIdentifier("digest-chip-\(message.id)")
            }
        case .routineRun:
            if let card = message.routineRun {
                // 2026-11-05 (#2008): the bot that ran it leads the card; a
                // room card falls back to the message's sender when listed.
                let runBot: Bot? = {
                    if case let .bot(bot) = chat { return session.state.bot(bot.id) ?? bot }
                    if let id = message.from?.botId { return session.state.bot(id) }
                    return nil
                }()
                RoutineRunCardView(
                    card: card,
                    at: message.date,
                    tint: MausPalette.color(chat.color),
                    bot: runBot,
                    openRun: routineRunOpener(card),
                    resume: card.autoPausedAfter == nil ? nil : {
                        // 2026-10-26: back on, the failure count from zero
                        Task {
                            if await session.resumeRoutine(id: card.routineId) != nil { afterResume?() }
                        }
                    },
                    openThread: openThread
                )
                // 2026-11-05: items only the person can do, each with its ticket
                if let attention = message.attention, !attention.items.isEmpty, card.knownStatus == .completed {
                    AttentionItemsView(items: attention.items)
                }
            } else if let text = message.text, !text.isEmpty {
                // A computer that sent the kind without its card: the text
                // is written for exactly this reader.
                TextBubble(message: message, chat: chat, tailed: endsRun, openLink: openLink, cwAsk: askCw)
            }
        case .connector:
            // The connect-an-app card is gone; a message of this kind still
            // carries text written for this reader, so show it.
            if let text = message.text, !text.isEmpty {
                TextBubble(message: message, chat: chat, tailed: endsRun, openLink: openLink, cwAsk: askCw)
            }
        case .access:
            if let access = message.access {
                AccessCardView(access: access)
            } else if let text = message.text, !text.isEmpty {
                TextBubble(message: message, chat: chat, tailed: endsRun, openLink: openLink, cwAsk: askCw)
            }
        case .goalRun:
            if let run = message.goalRun {
                GoalRunCardView(run: run)
            } else if let text = message.text, !text.isEmpty {
                TextBubble(message: message, chat: chat, tailed: endsRun, openLink: openLink, cwAsk: askCw)
            }
        case .roster:
            // #1480: one neutral centred line (RosterLine.tsx), never a bubble
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
        case .unknown:
            // A message kind from a newer computer. Almost everything the
            // harness sends carries `text`, so showing it is usually the
            // whole message and always better than a gap in the transcript.
            // When there is nothing to show, show nothing — a placeholder
            // saying "unsupported" is a worse gap than the gap.
            if let text = message.text, !text.isEmpty {
                TextBubble(message: message, chat: chat, tailed: endsRun, openLink: openLink, cwAsk: askCw)
            }
        }
    }

    /// This failed turn is the conversation's last row and its bot is idle.
    private var retryable: Bool {
        guard ErrorRowRules.isError(message), case let .bot(bot) = chat else { return false }
        return ErrorRowRules.retryableErrorId(
            in: session.state.visibleTranscript(forThread: chat.threadId),
            busy: bot.busy == true,
            pendingId: session.state.pendingEdits[chat.threadId]?.placeholderId
        ) == message.id
    }

    /// A run thread is opened by the same route an "Opened thread" chip
    /// takes, so it lands on screen without joining the thread list. No
    /// route — the run was deleted, or the phone holds no bot owning it —
    /// means no button.
    /// View run opens the run's detail (a run of a deleted routine too, to
    /// read). A run the computer no longer lists falls back to its
    /// execution conversation when this phone has a route to it.
    /// A card's run, opened by its id (the card carries no RoutineRunCard).
    private func attentionRunOpener(_ runId: String) -> () -> Void {
        {
            Task {
                let listing = await session.loadRoutines()
                if let run = listing.runs.first(where: { $0.id == runId }) {
                    openedRun = OpenedRoutineRun(run: run, routine: listing.routines.first { $0.id == run.routineId })
                }
            }
        }
    }

    private func routineRunOpener(_ card: RoutineRunCard) -> (() -> Void)? {
        let fallback = session.state.routineExecutionRef(for: card)
        let openThread = openThread
        return {
            Task {
                let listing = await session.loadRoutines()
                if let run = listing.runs.first(where: { $0.id == card.runId }) {
                    openedRun = OpenedRoutineRun(run: run, routine: listing.routines.first { $0.id == run.routineId })
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
            && lhs.chat == rhs.chat
            && lhs.endsRun == rhs.endsRun
            && (lhs.openThread == nil) == (rhs.openThread == nil)
    }
}

/// A run opened from its card in the chat, with its routine when it still
/// exists. Also the destination of a routine-run push (#1700).
struct OpenedRoutineRun: Identifiable, Equatable {
    let run: RoutineRun
    let routine: Routine?
    var id: String { run.id }
}
