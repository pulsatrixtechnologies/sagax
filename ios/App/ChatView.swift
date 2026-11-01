// One conversation: the transcript, the approval cards, and the composer.
//
// The transcript is whatever the harness folded — settled text, tool chips,
// option cards, screenshots. This renders those and nothing else; it does
// not re-derive anything from provider events, because the server already
// did that and having two folds is how two clients start disagreeing.
//
// This file holds the screen's state and layout. Its parts live beside it in
// Features/Chat (header, "+" sheet, composer, attachment import, links,
// message rows and bubbles) and Cards (option and credential cards), so the
// iPhone and the iPad desktop layout can reuse them and feature packages do
// not collide in one file.
import SwiftUI
import CompanionCore
import PhotosUI
import UniformTypeIdentifiers
import ImageIO
// Unconditional, because the uses below are: `Color(uiColor:)` and
// `UIImage(data:)` are reached on every path through this file. A
// `canImport` guard around the import alone does not make the file portable
// — it only moves the failure from "no such module" to "no such type", and
// hides that this view is iOS-only behind something that looks like it
// isn't. The App target is iOS; CompanionCore is where the portable half
// lives.
import UIKit
import AVFoundation

struct ChatView: View {
    @Environment(\.themePalette) var themePalette
    let chat: Chat
    @State var selectedThreadId: String
    @EnvironmentObject var session: Session
    @Environment(\.dismiss) var dismiss
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @Environment(\.scenePhase) var scenePhase
    /// iPad desktop shell (Desktop/DesktopChat.swift): the desktop's header,
    /// composer and column; nil on the iPhone.
    @Environment(\.desktopChat) var desktopChat
    /// The desktop transcript's tokens (set with `desktopChat`).
    @Environment(\.desktopChatText) var desktopChatText
    /// The composer's text. Held in a model this screen does not observe:
    /// a keystroke re-renders the composer (`composerSlot` observes it), not
    /// the transcript above it.
    @State var draftModel = ComposerDraftModel()
    var draft: String {
        get { draftModel.text }
        nonmutating set { if draftModel.text != newValue { draftModel.text = newValue } }
    }
    /// The field's binding to `draft`.
    var draftBinding: Binding<String> {
        let model = draftModel
        return Binding(get: { model.text }, set: { if model.text != $0 { model.text = $0 } })
    }
    @State var revealedMessageId: String?
    /// The row the "New" line sits above, set when an unread chat opens.
    @State var newDividerBefore: String?
    @State var showingTasks = false
    /// Threads hidden: a thread shown over the conversation (ChatLinks).
    @State var besideThread: BesideThread?
    /// One conversation (SingleStream): how many earlier topics are drawn
    /// above the live one, newest first; the next one loads on request.
    @State var earlierTopicsShown = 0
    /// An earlier topic to bring on screen once drawn (a notification, a
    /// link, a search hit; Session.revealSegments).
    @State var pendingTopicReveal: String?
    /// A bot-to-bot conversation opened read only (BB1).
    @State var openBotConversation: BotConversation?
    @State var earlierConversationsOpen = false
    @State var showingComputer = false
    @State var showingPlus = false
    /// The bot panel, full screen, and the tab it opens on (`BotPanelDoor`).
    @State var showingPanel = false
    /// Development context pods (DevPodsView): Settings > Experimental's
    /// switch on this device, the detector's state for this thread, and
    /// whether the sheet or inspector is open.
    @AppStorage(DevPodsPrefs.enabled) var devPodsEnabled = false
    @State var devMode = DevModeState.off
    @State var devModeThread: String?
    @State var showingDevPods = false
    /// Edit rule opens the panel on Access; cleared when the panel closes.
    @State var panelSection: DesktopPanelSection?
    @State var panelTab: DesktopPanelTab = .details
    /// The live call (the composer's white capsule): the desktop's voice mode.
    @ObservedObject var call = CallController.shared
    /// The card under the call bar: its settings, its transcript, or none.
    @State var callPanel: CallBarPanel?
    /// Dynamic Type's factor for the call bar's row (CallBarMetrics.scale).
    @ScaledMetric(relativeTo: .body) var callBarScale: CGFloat = 1
    @Environment(\.isPresented) var isPresented
    @Environment(\.openURL) var openURL
    /// WP11: the Room info sheet (RM6), opened by a room's header.
    @State var showingRoomInfo = false
    /// The Room info's Threads row: the threads sheet once it has gone.
    @State var roomInfoOpensThreads = false
    /// WP3: failed sends, pasted chips, the busy choice, Steer and the "/" menu.
    @StateObject var power = ComposerModel()
    /// WP4: the find bar (MS11), the bottom follow and Jump to latest (MS14),
    /// citations waiting for the next send (CO8).
    @StateObject var finder = ChatFindModel()
    @StateObject var follow = BottomFollow()
    @StateObject var citations = CitationDrafts()
    @State var shareFile: ShareFile?
    /// The bot's "Share as Template" sheet (a public template link).
    @State var sharingTemplate: Bot?
    @State var showingPhotoPicker = false
    /// The composer's "+" > Take Photo: the system camera.
    @State var showingCamera = false
    @State var showingFileImporter = false
    @State var selectedPhotos: [PhotosPickerItem] = []
    @State var attachments: [PendingMessageAttachment] = []
    struct ComposerSnapshot {
        var text = ""
        var attachments: [PendingMessageAttachment] = []
        var error: String?
        /// The message a reply quotes, kept with its thread's draft.
        var replyTo: Message?
    }
    /// Reply (CO2): the message the next send quotes, drawn above the field.
    @State var replyTo: Message?
    @State var threadDrafts: [String: ComposerSnapshot] = [:]
    @State var preparingAttachments = false
    @State var sendingMessage = false
    /// Whether this bot can answer the person now (SendState.swift): a
    /// block keeps the send back and draws one line above the field.
    @State var sendBlockState = SendBlockState()
    /// Bumped to ask the send state again (Try again, back to the app, a
    /// refused send).
    @State var sendBlockTick = 0
    /// "Connect <engine>" on a phone: the settings sheet.
    @State var showingEngineSettings = false
    @State var attachmentError: String?
    @State var openingFileName: String?
    @State var fileOpenError: String?
    @State var filePreview: FilePreviewItem?
    @State var fileDownloadTask: Task<Void, Never>?
    @State var fileDownloadRequestID: UUID?
    @State var threadOpenTask: Task<Void, Never>?
    /// Why this bot chat could not be opened, after asking the server again
    /// (`ChatOpenProblemView`); nil while it shows or is being checked.
    @State var openProblem: BotThreadAvailability?
    /// The bots were reloaded from the server for this open.
    @State var openChecked = false
    /// Try again: runs the opening task once more for the same thread.
    @State var openAttempt = 0
    @FocusState var composerFocused: Bool
    @StateObject var dictation = SpeechDictation()
    /// A reply read aloud (its notice when another voice than xAI's reads it).
    @ObservedObject var speaker = MessageSpeaker.shared
    /// The composer's voice note (hold the mic, or + > Record a voice note).
    @StateObject var voiceNote = VoiceNoteRecorder()
    /// When the mic was pressed, and the wait before a press becomes a hold.
    @State var micPressStart: Date?
    @State var micHoldTask: Task<Void, Never>?
    /// Settings > Appearance > Tool calls ("Details"), the desktop's switch.
    @ObservedObject var toolCalls = ToolCallsSetting.shared
    /// Settings > Appearance > Threads: off drops thread receipts from the chat.
    @ObservedObject var threadPrefs = SidebarPrefsModel.shared
    var activityDetail: String { toolCalls.detail.rawValue }
    @AppStorage(PrefKey.quickReplies) var quickReplies = ""
    /// The run card above the composer (ST4, WP14 `RunCardView`).
    @AppStorage(RunCardPreference.key) var showRunCard = true
    @ObservedObject var runCardDismissals = RunCardDismissals.shared
    @ObservedObject var sidebarPrefs = SidebarPrefsModel.shared
    /// The page open over this conversation (2026-10-28, the page view):
    /// the conversation stays under it, its composer floats over the page.
    /// Its title and version follow what the page shows, so a message sent
    /// now names the page as it is (`dataContext.page`).
    @State var openPage: OpenPageRef?

    init(chat: Chat) {
        self.chat = chat
        _selectedThreadId = State(initialValue: chat.threadId)
    }

    /// The live bubble's scroll target. A constant because there is at most
    /// one per chat and it has no message id to borrow.
    static let liveBubbleId = "companion.live"
    static let bottomId = "companion.bottom"

    /// Lazy transcript is the default. DEBUG `-transcript-eager` forces the
    /// old VStack path for before/after measure only.
    static var usesLazyTranscript: Bool {
#if DEBUG
        !ProcessInfo.processInfo.arguments.contains("-transcript-eager")
#else
        true
#endif
    }

    /// The live chat record, so busy/unread stay current as frames land.
    var current: Chat {
        switch chat {
        case let .bot(bot):
            if let view = session.state.bot(bot.id)?.projected(forThread: selectedThreadId) { return .bot(view) }
            // Keep the exact target until a removed thread dismisses. Never
            // briefly fall back to a sibling while the view is closing.
            var removed = bot
            removed.threadId = selectedThreadId
            removed.busy = false
            return .bot(removed)
        case let .room(room):
            return session.state.rooms.first { $0.id == room.id }.map(Chat.room) ?? chat
        }
    }

    /// The topic under a fresh one is live: it gives way.
    var topicUnderFreshAlive: Bool {
        guard session.isFreshTopic(current), case let .bot(bot) = current,
              let task = bot.tasks?.first(where: { $0.threadId == bot.threadId }) else { return false }
        return task.busy == true || task.activity == "working" || task.activity == "waiting-on-you"
            || task.unread == true || task.waitingOnTeammate == true || session.state.queuedThreadIds.contains(bot.threadId)
    }

    /// The topic a fresh draft's first message made for this bot, if any.
    var startedTopic: String? {
        guard case let .bot(bot) = chat else { return nil }
        return session.startedTopics[bot.id]
    }

    /// A thread this bot's chat should move to in place (Go to message on a
    /// link of another of its conversations), if any.
    var threadSwitch: ThreadSwitch? {
        guard case let .bot(bot) = chat else { return nil }
        return session.threadSwitches[bot.id]
    }

    /// Bot selection is local to this screen; another device's navigation
    /// must not move a draft, approval, or Stop action to a different thread.
    var threadId: String { current.threadId }

    /// Whether the bot's thread on screen can be shown, by the rule the bot
    /// projects a thread with (nil for a room). Bug 2026-10-16: asking only
    /// the bot's thread list closed a chat on its first frame when an
    /// organization server sent the viewer's thread outside that list.
    var threadAvailability: BotThreadAvailability? {
        guard case let .bot(bot) = chat else { return nil }
        return BotThreadAvailability.of(botId: bot.id, threadId: selectedThreadId, in: session.state)
    }

    var selectedThreadWasRemoved: Bool {
        threadAvailability.map { !$0.isOpen } ?? false
    }

    /// The room on screen was in the state and is gone (deleted on the
    /// server). Only the change counts: a room opened before the snapshot
    /// lands is not dismissed.
    var openRoomWasRemoved: Bool {
        guard case .room = chat else { return false }
        return !OpenConversation.present(chat, in: session.state)
    }

    var messages: [Message] {
        session.state.visibleTranscript(forThread: threadId)
    }

    /// The transcript as the reader has asked to see it: every chip, folded
    /// runs, or none at all.
    var rows: [TranscriptRow] {
        transcriptRows(
            messages, detail: toolCalls.detail, showThreads: threadPrefs.threads.allows(.transcriptReceipts),
            threadBotId: current.isBot ? current.id : ""
        )
    }

    /// The composer's chip row, as edited in Settings.
    var storedChips: [ActionChipItem] {
        QuickReply.decode(quickReplies).map {
            ActionChipItem(id: $0.id, title: $0.title, icon: $0.icon, prompt: $0.prompt)
        }
    }

    /// Unread elsewhere — what the back pill's badge counts, like Messages.
    var unreadElsewhere: Int {
        let mine = current.unread ? 1 : 0
        return max(0, session.state.unreadCount - mine)
    }

    var body: some View {
        // Type-erased at two seams (layout, lifecycle, presentations): the
        // whole chain as one opaque type made the optimizer abort ("Possible
        // non-terminating type substitution") when archiving Release.
        AnyView(screen)
        // "Use bot color as accent": this bot's colour while its chat is open
        .modifier(OpenBotAccent(color: current.isBot ? current.color : nil, name: current.isBot ? current.name : nil))
        .sheet(item: $openBotConversation) { row in
            if case let .bot(bot) = current {
                BotConversationPage(row: row, selfBot: bot).environmentObject(session)
            }
        }
        .sheet(item: $besideThread) { beside in
            BesideThreadSheet(beside: beside).environmentObject(session)
        }
        .sheet(isPresented: $showingTasks) {
            if current.supportsTasks, threadPrefs.threads.allows(.threadList) {
                TaskManagerView(chat: current) { selectedThreadId = $0 }
            }
        }
        .fullScreenCover(isPresented: $showingPanel) {
            if case let .bot(bot) = current {
                ChatProfileRoute.destination(for: bot, tab: panelTab, section: panelSection)
                    .environmentObject(session)
            }
        }
        .sheet(isPresented: $showingRoomInfo, onDismiss: {
            if roomInfoOpensThreads {
                roomInfoOpensThreads = false
                showingTasks = true
            }
        }) {
            if case let .room(room) = current {
                RoomInfoSheet(roomId: room.id, openThreads: {
                    roomInfoOpensThreads = true
                    showingRoomInfo = false
                }, onDeleted: {
                    showingRoomInfo = false
                    dismiss()
                })
                .environmentObject(session)
            }
        }
        .alert(
            call.unavailable?.title ?? "",
            isPresented: Binding(get: { call.unavailable != nil }, set: { if !$0 { call.unavailable = nil } }),
            presenting: call.unavailable
        ) { unavailable in
            if let url = unavailable.keysUrl {
                Button(String(localized: "Add my xAI key")) { openURL(url) }
            }
            Button(String(localized: "OK"), role: .cancel) {}
        } message: { unavailable in
            Text(unavailable.lines.joined(separator: "\n"))
        }
        .sheet(item: $shareFile) { file in
            ActivityShareSheet(items: [file.url])
        }
        .sheet(item: $sharingTemplate) { bot in
            ShareTemplateSheet(bot: bot)
                .environmentObject(session)
        }
        .photosPicker(
            isPresented: $showingPhotoPicker,
            selection: $selectedPhotos,
            maxSelectionCount: max(1, AttachmentPolicy.maximumItems - attachments.count),
            matching: .any(of: [.images, .videos]),
            preferredItemEncoding: .current
        )
        .fullScreenCover(isPresented: $showingCamera) {
            CameraCapture(front: false) { image in
                showingCamera = false
                if let image { importCameraPhoto(image) }
            }
            .ignoresSafeArea()
        }
        .onValueChange(of: selectedPhotos) { items in
            guard !items.isEmpty else { return }
            Task { await importPhotos(items) }
        }
        .onValueChange(of: session.recoveredAttachmentSends) { delivered in
            let settled = attachments.contains { delivered.contains($0.id) }
            attachments.removeAll { delivered.contains($0.id) }
            if settled, attachments.isEmpty, session.recoveredAttachmentDraftTexts[threadId] == draft { draft = "" }
        }
        .onValueChange(of: draft) { text in
            if !attachments.isEmpty { session.rememberAttachmentDraftText(text, threadId: threadId) }
        }
        .onValueChange(of: attachments.map(\.id)) { _ in
            session.keepAttachmentDraft(attachments, threadId: threadId, text: draft)
        }
        .fileImporter(
            isPresented: $showingFileImporter,
            allowedContentTypes: [.content],
            allowsMultipleSelection: true,
            onCompletion: importFiles
        )
        .fullScreenCover(item: $filePreview) { preview in
            FilePreviewView(item: preview) {
                filePreview = nil
            }
        }
        .modifier(DevPodsPresentation(isPresented: $showingDevPods, inspector: desktopChat != nil) {
            devPodsContent
        })
        .onValueChange(of: devPodsSignature, initial: true) { _ in evaluateDevPods() }
    }

    var screen: some View {
        // A type-erased boundary: one long modifier chain on `body` made the
        // Release (-O, whole module) compiler abort with "non-terminating type
        // substitution" in ChatView.body (0.5.22, after #763).
        AnyView(screenLifecycle)
        .onValueChange(of: showingComputer) { shown in
            if shown { dictation.stop() }
        }
        .onValueChange(of: showingTasks) { shown in
            if shown { dictation.stop() }
        }
        // Show threads turned off here or on another device (`preferences`
        // frame): the open thread list goes at once, no relaunch.
        .onValueChange(of: threadPrefs.threads.allows(.threadList)) { allowed in
            if !allowed { showingTasks = false }
        }
        .onValueChange(of: showingRoomInfo) { shown in
            if shown { dictation.stop() }
        }
        // a draft another screen prepared for this thread, unsent (Tasks "Answer")
        .onReceive(ComposerPrefill.shared.$pending) { pending in
            if pending[threadId] != nil { takePrefill() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .approvalEditRule)) { note in
            // Edit rule: the bot's panel, where Access holds its Allow rules
            guard case let .bot(bot) = current, (note.object as? String).map({ $0 == bot.id }) ?? true else { return }
            panelSection = .access
            showingPanel = true
        }
        .onValueChange(of: showingPanel) { shown in
            if shown { dictation.stop() } else { panelSection = nil }
        }
        .onValueChange(of: call.active) { onCall in
            if onCall {
                dictation.stop()
                voiceNote.cancel()
            }
        }
        .onValueChange(of: showingPlus) { shown in
            if shown { dictation.stop() }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey]
            let value = (raw as? NSNumber)?.uintValue ?? (raw as? UInt)
            if value == AVAudioSession.InterruptionType.began.rawValue {
                dictation.stop()
                voiceNote.cancel()
            }
        }
        .onValueChange(of: dictation.transcript) { spoken in
            // Always join against the text frozen at capture start. A newer
            // partial then replaces the older partial instead of duplicating it.
            draft = Dictation.draft(base: dictation.base, transcript: spoken)
        }
        .onValueChange(of: dictation.isListening) { listening in
            if listening { composerFocused = false }
        }
        .onValueChange(of: threadId) { _ in voiceNote.cancel() }
        .onAppear { voiceNote.onCapped = { sendVoiceNote() } }
    }

    /// The arrival plus what follows the person in and out of the chat
    /// (visibility, scene phase, fresh topic on return).
    var screenLifecycle: some View {
        AnyView(arrival)
        .onAppear {
            if case let .bot(bot) = current { session.noteBackAtBot(bot.id) }
            if attachments.isEmpty { attachments = session.pendingAttachmentDraft(threadId: threadId) }
            if draft.isEmpty, !attachments.isEmpty { draft = session.pendingAttachmentDraftText(threadId: threadId) ?? "" }
            session.keepAttachmentDraft(attachments, threadId: threadId, text: draft)
        }
        .onDisappear {
            session.keepAttachmentDraft(attachments, threadId: threadId, text: draft)
            if case let .bot(bot) = current { session.noteLeftBot(bot.id) }
            if AttentionCenter.shared.viewingThreadId == current.threadId { AttentionCenter.shared.viewingThreadId = nil }
            dictation.stop()
            voiceNote.cancel()
            resetFilePreview()
            cancelThreadOpen()
            // Leaving the conversation hangs up, as on the desktop; a profile
            // or the computer pushed over it keeps the call.
            let chat = current
            DispatchQueue.main.async {
                if !isPresented, call.isOnCall(chat) { call.end() }
            }
        }
        .onValueChange(of: scenePhase) { phase in
            if phase != .active {
                dictation.stop()
                voiceNote.cancel()
            }
            // Back in the app while blocked: ask again, the cause may be fixed.
            if phase == .active, activeSendBlock != nil { sendBlockTick += 1 }
            // Fresh topic on return: away while the app is in the background;
            // back after the threshold, a fresh topic over the topic at rest.
            if case let .bot(bot) = current {
                if phase == .background { session.noteLeftBot(bot.id) }
                if phase == .active, session.freshTopicLeftAt(bot.id) != nil {
                    session.landOnBot(current, force: true)
                    session.noteBackAtBot(bot.id)
                }
            }
        }
        // Can this bot answer the person now? Asked on opening, on a bot,
        // thread or model change, then every 15 s while it cannot.
        .task(id: sendBlockTaskKey) { await runSendStateChecks() }
        .fullScreenCover(isPresented: $showingEngineSettings) {
            SettingsView(close: { showingEngineSettings = false })
                .background(Theme.bg.ignoresSafeArea())
        }
        .onValueChange(of: topicUnderFreshAlive) { alive in
            // the topic under a fresh one came alive (a turn, an approval, an
            // answer): it is shown, never hidden behind the fresh topic
            if alive, case let .bot(bot) = current { session.showTopicUnderFresh(bot.id) }
        }
        .onValueChange(of: startedTopic) { started in
            // the first message of a fresh topic made it: this chat moves there
            guard let started, case let .bot(bot) = current else { return }
            session.consumeStartedTopic(bot.id)
            selectedThreadId = started
        }
        .onValueChange(of: streamReadBackKey) { _ in drawFirstEarlierTopic() }
        .onValueChange(of: gateSignalsKey) { _ in
            if case let .bot(bot) = current, !threadPrefs.showThreads { takeGateSignals(bot.id) }
        }
        .onValueChange(of: pendingCitationsKey) { _ in takePendingCitations() }
        .onValueChange(of: threadSwitch) { request in
            // Go to message on a link of another conversation of this bot:
            // this screen switches there, as a thread chip does
            guard let request, case let .bot(bot) = current else { return }
            session.threadSwitches[bot.id] = nil
            selectedThreadId = request.threadId
        }
    }

    var arrival: some View {
        AnyView(openContent)
        .task(id: "\(threadId)#\(openAttempt)") {
            guard await resolveOpenThread() else { return }
            let openedChat = current
            // with one conversation the bot always opens at it (SingleStream.home):
            // nothing to remember, and a job or a run opened beside never becomes home
            if threadPrefs.showThreads { session.threadSelection.rememberThread(openedChat, connectionID: session.connection?.id) }
            AttentionCenter.shared.viewingThreadId = openedChat.threadId
            if case let .bot(bot) = openedChat, !threadPrefs.showThreads {
                takeGateSignals(bot.id)
                // the earlier topics are read with the conversation, as on the
                // desktop (streamUnreadReadWith): no row of their own could
                for topic in earlierTopics where topic.unread == true {
                    if let projected = session.state.bot(bot.id)?.projected(forThread: topic.threadId) { await session.markRead(.bot(projected)) }
                }
            } else {
                // Continue in the conversation may open the home chat with
                // threads shown, or a room: still take a queued report quote.
                takePendingCitations()
            }
            // #219: selecting a closed conversation with a person reopens it
            if case let .room(room) = openedChat { SidebarPrefsModel.shared.reopenIfClosed(session, room: room) }
            await session.loadThreadIfNeeded(openedChat.threadId)
            drawFirstEarlierTopic()
            // what was unread on opening keeps its "New" line until the chat
            // is left; opening a chat is what marks it read, exactly as on
            // the desktop
            newDividerBefore = openedChat.unread ? NewMessagesDivider.anchor(rows) : nil
            if openedChat.unread { await session.markRead(openedChat) }
#if DEBUG
            // `-open-plus`: the + sheet up, for the screenshot harness
            if ProcessInfo.processInfo.arguments.contains("-open-plus") { showingPlus = true }
            // `-fresh-topic`: the chat as a return after the threshold draws it
            // (Session+FreshTopic.swift), for the screenshot harness
            if ProcessInfo.processInfo.arguments.contains("-fresh-topic"), case let .bot(bot) = openedChat {
                session.freshTopics[bot.id] = openedChat.threadId
            }
            if ProcessInfo.processInfo.arguments.contains("-open-profile") { openProfile() }
            await pageDebugLaunch()
            if let screen = ParityLaunch.current?.screen {
                if screen.opensComputer { showingComputer = true }
                if screen.opensProfile {
                    // a push while the chat's own push still animates is
                    // dropped; 0.9 s was too tight once a busy Debug build
                    // settled the chat a little later
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    openProfile()
                }
            }
#endif
        }
        .onValueChange(of: selectedThreadWasRemoved) { removed in
            if removed {
                // Removed while on screen: ask the server before leaving, so
                // a frame that only narrowed the bot does not close the chat.
                if openProblem == nil { Task { await confirmRemoval() } }
            } else if openProblem != nil {
                // the bot or its thread arrived after all (a stream frame)
                retryOpen()
            }
        }
        // A room deleted while open leaves the screen (its composer would
        // write into nothing), and so does a conversation the person closes
        // or hides while it is open (OpenConversation, bug 2026-10-15).
        .onValueChange(of: openRoomWasRemoved) { removed in
            if removed { dismiss() }
        }
        .onValueChangePair(of: sidebarPrefs.prefs.hidden) { previous, next in
            if OpenConversation.newlyHidden(chat, previous: previous, next: next) { dismiss() }
        }
        .onValueChange(of: session.state.hasLoadedPage(forThread: threadId)) { loaded in
            let requestedThread = threadId
            if !loaded { Task { await session.loadThreadIfNeeded(requestedThread) } }
        }
        .onValueChange(of: current.unread) { unread in
            // A message can arrive while this chat is already on screen. The
            // initial task above will not run again, so clear that new unread
            // bit here rather than leaving a badge on an open conversation.
            let readChat = current
            if unread { Task { await session.markRead(readChat) } }
        }
        .onValueChangePair(of: threadId) { previous, next in
            earlierTopicsShown = 0
            pendingTopicReveal = nil
            dictation.stop()
            session.keepAttachmentDraft(attachments, threadId: previous, text: draft)
            threadDrafts[previous] = ComposerSnapshot(text: draft, attachments: attachments, error: attachmentError, replyTo: replyTo)
            let restored = threadDrafts.removeValue(forKey: next) ?? ComposerSnapshot()
            // another thread's draft coming back is not a paste
            power.pasteCheckSuppressed = restored.text != draft
            draft = restored.text
            attachments = restored.attachments.isEmpty ? session.pendingAttachmentDraft(threadId: next) : restored.attachments
            if draft.isEmpty, !attachments.isEmpty { draft = session.pendingAttachmentDraftText(threadId: next) ?? "" }
            attachmentError = restored.error
            replyTo = restored.replyTo
            // a draft prepared for the thread now shown (Tasks "Answer")
            takePrefill()
            selectedPhotos = []
            power.commandMenuForced = false
            showingPlus = false
            finder.close()
            follow.resume()
            // The local task picker changed threads. A download
            // started in the previous task must not open a sheet (or surface
            // its error) in the new one when the network reply arrives late.
            resetFilePreview()
            cancelThreadOpen()
        }
        .onValueChange(of: session.connection?.id) { _ in
            cancelThreadOpen()
        }
    }

    @ViewBuilder
    var layout: some View {
        // Read the transcript once for this render. Pagination changes the
        // array as a unit; repeatedly reaching through ObservableObject for
        // every row only recomputes the same value.
        // A fresh topic (Session+FreshTopic.swift) is invisible since
        // 2026-10-28: the next message starts a fresh engine context, and the
        // conversation stays one timeline on screen (the reference design).
        let fresh = false
        let transcript = rows
        let streamOn = !threadPrefs.showThreads && current.isBot && currentTopicIsSegment
        let readBack = session.state.hasMore[threadId] == false
        let topicsAbove = streamOn && readBack ? Array(earlierTopics.prefix(earlierTopicsShown).reversed()) : []
        let nextTopic = streamOn && readBack && earlierTopicsShown < earlierTopics.count ? earlierTopics[earlierTopicsShown] : nil
        let storedBot: Bot? = { if case let .bot(bot) = current { return session.state.bot(bot.id) }; return nil }()
        let visibleConversations = BotConversations.visible(
            storedBot?.botConversations ?? [],
            openThreadId: threadId,
            mainThreadId: storedBot?.mainThreadId,
            fallbackThreadId: storedBot?.threadId ?? threadId,
            linkedThreadIds: BotConversations.linkedThreadIds(in: messages))
        // Rows older than the first line fold behind "Earlier topics".
        let conversationSplit = BotConversations.split(
            visibleConversations, firstStart: transcript.first?.head.at, hasMore: session.state.hasMore[threadId] == true)
        let conversationRows = conversationSplit.inline
        let conversationAnchors = BotConversations.anchors(
            conversationRows, rowStarts: transcript.map { $0.head.at }, hasMore: session.state.hasMore[threadId] == true)
        // A VStack with the composer as a sibling, rather than a scroll view
        // with `.safeAreaInset`. The inset version sized itself to its
        // content, so a short transcript left the composer floating in the
        // middle of the screen with black beneath it. Here the scroll area is
        // explicitly told to take everything the composer does not.
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    // LazyVStack by default: long threads (pagination, DEBUG
                    // synthetic ~2000) stay cheap to open. Height is estimated
                    // until rows appear, so `.defaultScrollAnchor(.bottom)`
                    // alone can land mid-thread; the scrollTo(bottomId) paths
                    // below (initial, new message, stream follower, settle
                    // task, bottom onAppear) keep the newest message in view.
                    // ChatLiveTail and the bottom spacer stay in this stack so
                    // jump-to-latest, streaming and the thinking mascot keep
                    // one identity. DEBUG `-transcript-eager` forces VStack
                    // for before/after measure only.
                    let useLazyTranscript = Self.usesLazyTranscript
                    TranscriptStack(lazy: useLazyTranscript) {
                        // One conversation: the topic before the oldest one
                        // drawn loads on request, the way older messages do.
                        if let nextTopic {
                            Button("Load earlier messages") {
                                let anchor = topicsAbove.first.map { Self.topicAnchor($0.threadId) } ?? transcript.first?.id
                                earlierTopicsShown += 1
                                Task {
                                    await session.loadThreadIfNeeded(nextTopic.threadId)
                                    if let anchor { proxy.scrollTo(anchor, anchor: .top) }
                                }
                            }
                            .font(.footnote)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .accessibilityIdentifier("chat.earlierTopic.load")
                        }
                        // The earlier topics, oldest first, each under a quiet
                        // time line (the reference design draws one transcript;
                        // a topic is a fresh engine context underneath).
                        if case let .bot(bot) = current {
                            ForEach(topicsAbove, id: \.threadId) { topic in
                                if let projected = session.state.bot(bot.id)?.projected(forThread: topic.threadId) {
                                    EarlierTopicSection(
                                        chat: .bot(projected),
                                        rows: transcriptRows(session.state.visibleTranscript(forThread: topic.threadId), detail: toolCalls.detail, showThreads: false, threadBotId: bot.id),
                                        openLink: openLink, openThread: openThread, revealedMessageId: revealedMessageId,
                                        scrollToMessage: { proxy.scrollTo($0, anchor: .center) }
                                    )
                                    .id(Self.topicAnchor(topic.threadId))
                                }
                            }
                            if !topicsAbove.isEmpty, let live = bot.tasks?.first(where: { $0.threadId == threadId }) {
                                TopicDividerLine(date: Date(timeIntervalSince1970: live.createdAt / 1000), title: live.title)
                            }
                        }
                        if session.state.hasMore[threadId] == true {
                            Button("Load earlier messages") {
                                // keep the reader where they were: after older
                                // messages are prepended, sit back on the one
                                // that used to be at the top
                                let anchor = transcript.first?.id
                                Task {
                                    await session.loadOlder(threadId: threadId)
                                    if let anchor { proxy.scrollTo(anchor, anchor: .top) }
                                }
                            }
                            .font(.footnote)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                        }

                        if !fresh, !conversationSplit.leading.isEmpty {
                            EarlierConversationsFold(
                                rows: BotConversations.deduped(conversationSplit.leading),
                                open: $earlierConversationsOpen,
                                other: { session.state.bot($0) },
                                select: { openBotConversation = $0 })
                        }

                        ForEach(Array(transcript.enumerated()), id: \.element.id) { index, row in
                            VStack(alignment: .leading, spacing: 0) {
                                ForEach(conversationAnchors.before[index] ?? []) { conversationLine($0) }
                                // a gap in time is worth marking; a timestamp
                                // on every message is just noise
                                if let desktop = desktopChatText {
                                    // ChatView.tsx DaySeparator: a new calendar
                                    // day, 13 pt ink-secondary, 12 above and below
                                    if desktopStartsANewDay(at: index, in: transcript) {
                                        Text(verbatim: DesktopChatMetrics.dayLabel(row.head.date))
                                            .font(desktop.font(13))
                                            .frame(minHeight: 19.5)
                                            .foregroundStyle(desktop.inkSecondary)
                                            .frame(maxWidth: .infinity)
                                            .padding(.vertical, 12)
                                            .padding(.top, index == 0 ? 0 : DesktopChatMetrics.rowGap)
                                            .padding(.bottom, DesktopChatMetrics.rowGap)
                                    } else if index > 0 {
                                        Color.clear.frame(height: DesktopChatMetrics.rowGap)
                                    }
                                } else if startsANewStretch(at: index, in: transcript) {
                                    // 11 pt #555557, centred: about 22.6 pt
                                    // under the previous bubble and 17.6 pt
                                    // above the next one (reference 02).
                                    Text(RelativeStamp.separator(row.head.date))
                                        .font(Theme.Font.timestamp)
                                        .foregroundStyle(Theme.chatTimestamp)
                                        .frame(maxWidth: .infinity)
                                        .padding(.top, index == 0 ? 8 : 22.6)
                                        .padding(.bottom, 17.6)
                                } else if index > 0 {
                                    Color.clear.frame(height: Self.rowGap)
                                }
                                if desktopChatText == nil, row.id == newDividerBefore {
                                    NewMessagesLine()
                                }
                                // WP15 (RM21): another person's name over their run
                                if case let .person(_, name, initials, personId)? = roomPersonLabel(at: index, in: transcript) {
                                    RoomPersonLabel(name: name, initials: initials, personId: personId, roomId: { if case let .room(room) = current { return room.id } else { return nil } }())
                                }
                                switch row {
                                case let .message(message):
                                    MessageRow(
                                        chat: current,
                                        message: message,
                                        endsRun: endsRun(at: index, in: transcript),
                                        openLink: openLink,
                                        openThread: openThread
                                    )
                                    // Skips the row when only the screen
                                    // around it changed (a keystroke, the
                                    // follow state); what the row reads from
                                    // the session still updates it.
                                    .equatable()
                                case let .activityRun(run):
                                    StepRunRow(
                                        run: run, chat: current, openLink: openLink, openThread: openThread,
                                        revealedMessageId: revealedMessageId,
                                        scrollToMessage: { proxy.scrollTo($0, anchor: .center) }
                                    )
                                case let .voiceCall(card):
                                    VoiceCallCard(
                                        chat: current,
                                        card: card,
                                        forceOpen: card.messages.contains { $0.id == revealedMessageId },
                                        live: session.streamingStore
                                    )
                                }
                            }
                            .id(row.id)
#if DEBUG
                            .background { desktopParityRowProbe(row) }
#endif
                        }

                        ForEach(conversationAnchors.after) { conversationLine($0) }

                        // The reply as it is typed. It sits after the last
                        // settled message and disappears the moment the real
                        // one arrives — the store clears it on the same frame
                        // that appends the message, so there is never a beat
                        // where both are on screen.
                        // Only this tail observes the tokens: the rows above
                        // are not rebuilt while the reply streams.
                        ChatLiveTail(
                            store: session.streamingStore,
                            threadId: threadId,
                            onCall: call.active && call.isOnCall(current),
                            // Settings > Appearance: off, the reply appears once finished
                            streams: sidebarPrefs.streamReplies,
                            showsReasoning: activityDetail != ActivityDetail.hidden.rawValue,
                            busy: current.busy,
                            color: current.color,
                            name: current.name,
                            chat: current,
                            step: current.busy ? WorkingStepLine.current(messages) : nil
                        )

                        // The bottom of the conversation: 26.3 pt from the
                        // last bubble to the composer's top, less the
                        // composer's own top padding. Scrolling targets this,
                        // so the gap is always in view.
                        Color.clear
                            .frame(height: desktopChat == nil ? 26.3 - Self.composerTopPadding : DesktopChatMetrics.composerGap)
                            .id(Self.bottomId)
                            // Lazy stacks finish laying out after the first
                            // pass; re-assert the bottom while following so
                            // open-and-stream still land on the newest line.
                            .onAppear {
                                guard follow.following, session.focusedMessageId == nil, revealedMessageId == nil else { return }
                                proxy.scrollTo(Self.bottomId, anchor: .bottom)
                            }
                    }
                    .padding(.horizontal, desktopChat == nil ? Theme.Chat.bubbleLeading : 20)
                    .padding(.top, desktopChat == nil ? 12 : 56 - Self.topBarHeight)
                    .frame(maxWidth: desktopChat == nil ? CompanionLayout.chatWidth : DesktopShellRules.chatColumn + 40, alignment: .leading)
                    .frame(maxWidth: .infinity)
                    .environment(\.messageActions, messageActionContext)
                    .environment(\.citeIntoComposer, citeIntoComposer)
                    .environment(\.youtubeSendToBot, youtubeSendToBot)
                    .environment(\.conversationGallery, conversationGallery)
                    .environment(\.openPagePanel, openPagePanelAction)
                    .background(BottomFollowProbe(model: follow))
#if DEBUG
                    .background(LongTranscriptMetricsProbe(rowCount: transcript.count, lazyStack: useLazyTranscript))
#endif
                    // an earlier topic asked for (a notification, a link, a
                    // search hit): its start comes on screen once it is drawn
                    .task(id: topicRevealKey) {
                        guard let topic = pendingTopicReveal, session.state.hasLoadedPage(forThread: topic) else { return }
                        try? await Task.sleep(nanoseconds: 250_000_000)
                        guard !Task.isCancelled else { return }
                        withAnimation { proxy.scrollTo(Self.topicAnchor(topic), anchor: .top) }
                        pendingTopicReveal = nil
                    }
                }
                // The transcript starts under the top bar and scrolls
                // beneath it: a clear inset the height of the bar, then the
                // fade and the glass controls float over the content.
                .safeAreaInset(edge: .top, spacing: 0) {
                    // voice mode's call bar keeps its own row under the name
                    // capsule (and under the pinned banner when there is one)
                    VStack(spacing: 0) {
                        Color.clear.frame(height: Self.topBarHeight)
                        // A confidential thread's band: in the reserved
                        // inset, so the transcript never moves under it.
                        if ConfidentialBanner.shows(for: current) {
                            ConfidentialBannerView(edge: .top)
                        }
                        Color.clear.frame(height: (pinnedPreview == nil ? 0 : Self.pinnedBannerHeight)
                            + (callPillShown ? CallBarMetrics.inset(scale: callBarScale) : 0))
                    }
                }
                // iPad desktop: an open find bar sits in the column's flow,
                // so the transcript is cut under it (ChatView.tsx)
                .modifier(DesktopFindClip(open: desktopChat != nil && finder.isOpen && session.surfaceGate.allows(.findInConversation)))
                .overlay(alignment: .top) {
                    // the desktop's header floats over the transcript, unfaded
                    if desktopChat == nil {
                        ChatTopEdgeFade()
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                            .ignoresSafeArea()
                    }
                }
                .overlay(alignment: .top) { pinnedBanner }
                .overlay(alignment: .top) { chatHeaderSlot }
                // a failed routine run or a routine's access card: a passing
                // banner under the top bar, never a row (TransientNotices)
                .overlay(alignment: .top) {
                    TransientNoticeBanner(chat: current, messages: messages, openLink: openLink, openThread: openThread)
                        .padding(.top, Self.topBarHeight + 6)
                }
                .overlay(alignment: .bottom) {
                    if !follow.following, !transcript.isEmpty {
                        JumpToLatestButton {
                            follow.resume()
                            withAnimation(Motion.animation(.snappy, reduce: reduceMotion)) { proxy.scrollTo(Self.bottomId, anchor: .bottom) }
                        }
                        .padding(.bottom, 12)
                    }
                }
                .animation(.snappy(duration: 0.2), value: follow.following)
                // A conversation grows from the bottom: a transcript shorter
                // than the screen rests at the bottom, and opening a chat
                // starts on the newest message rather than the oldest.
                .scrollAnchorCompat(.bottom)
                // Tapping the transcript puts the keyboard away. The composer
                // is a sibling of this scroll view rather than inside it, so
                // nothing else here drops its focus — until this, the only way
                // back to the whole conversation was to leave the chat.
                // Simultaneous, not `.onTapGesture`: a tap that lands on a
                // link, a card button or a selected word still reaches the row
                // that owns it, and only also closes the keyboard.
                .simultaneousGesture(TapGesture().onEnded {
                    if composerFocused { composerFocused = false }
                    // and folds the call bar's card, as a click outside it
                    // does on the desktop
                    if callPanel != nil {
                        withAnimation(CallBarMetrics.motion(reduce: reduceMotion)) { callPanel = nil }
                    }
                })
                // And a drag down over the transcript pushes it away, the way
                // it does in Mail and Messages.
                .scrollDismissesKeyboard(.interactively)
                // The call bar sits over the thread, outside the tap above,
                // so a tap in its card never folds the card it lands in.
                .overlay(alignment: .top) { callBar }
                // `initial: true` is what opens the chat on the newest
                // message where `scrollAnchorCompat` cannot (iOS 16). On 17 the
                // anchor has already put us there and this is a no-op.
                .onValueChange(of: transcript.last?.id, initial: true) { _ in
                    guard let last = transcript.last else { return }
                    // Reading scrollback is not interrupted (MS14); your own
                    // send takes you back to the end.
                    if last.role == .user { follow.resume() }
                    guard follow.following else { return }
                    withAnimation(Motion.animation(.snappy, reduce: reduceMotion)) { proxy.scrollTo(Self.bottomId, anchor: .bottom) }
                }
                // Long markdown replies finish laying out after the first
                // pass; settle on the newest message once they have, unless a
                // deep link asked for a particular one.
                .task(id: threadId) {
                    // Lazy stacks keep revealing height after the first pass;
                    // several settles keep the newest message on screen.
                    for delay in [50, 150, 450, 900] {
                        try? await Task.sleep(nanoseconds: UInt64(delay) * 1_000_000)
                        guard !Task.isCancelled, session.focusedMessageId == nil, revealedMessageId == nil else { return }
                        guard follow.following else { return }
                        proxy.scrollTo(Self.bottomId, anchor: .bottom)
                    }
                }
                // Follow the text as it arrives. Keyed on length rather than
                // the string so this fires once per delta batch, and without
                // animation — animating every token turns a smooth stream
                // into a stutter, because each scroll interrupts the last.
                .background(LiveStreamFollower(store: session.streamingStore, threadId: threadId) { length in
                    guard length > 0, follow.following else { return }
                    proxy.scrollTo(Self.bottomId, anchor: .bottom)
                })
#if DEBUG
                .task { await desktopParityLaunch(proxy) }
#endif
                .task(id: session.focusedMessageId) {
                    guard let messageId = session.focusedMessageId,
                          messages.contains(where: { $0.id == messageId })
                    else { return }
                    revealedMessageId = messageId
                    // A message picked by hand is read where it is.
                    follow.pause()
                    // Materialize the lazy folded row first. Its target bubble
                    // scrolls itself into view once expansion has laid it out.
                    let folded = transcript.first { row in
                        if case let .activityRun(run) = row {
                            return run.messages.contains { $0.id == messageId }
                        }
                        if case let .voiceCall(card) = row {
                            return card.messages.contains { $0.id == messageId }
                        }
                        return false
                    }
                    proxy.scrollTo(folded?.id ?? messageId, anchor: .center)
                    // The expanded turn's bubbles (long markdown) finish laying
                    // out after the first pass and push the target down; land
                    // on it again once they have, as the newest-message settle
                    // above does. Focus is consumed after, since consuming it
                    // changes this task's id and would cancel the settle.
                    for delay in [150, 450] {
                        try? await Task.sleep(nanoseconds: UInt64(delay) * 1_000_000)
                        guard !Task.isCancelled else { return }
                        proxy.scrollTo(messageId, anchor: .center)
                    }
                    session.consumeFocus(messageId)
                }
            }
            .id(threadId)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            // an open page covers the conversation, which stays mounted (and
            // scrolled where it was) under it
            .opacity(openPage == nil ? 1 : 0)
            .allowsHitTesting(openPage == nil)
            .accessibilityHidden(openPage != nil)

            // The bot's one line over the floating composer while a page is
            // open: working, then its newest answer (PageComposerParts.tsx).
            if let openPage, let status = PageViewRules.statusLine(messages: messages, busy: current.busy, openedAt: openPage.openedAt) {
                PageBotStatusBubble(status: status, chat: current)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 4)
                    .transition(.opacity)
            }
            // The matching band above the composer: whatever is typed here
            // stays in a confidential thread.
            if ConfidentialBanner.shows(for: current) {
                ConfidentialBannerView(edge: .bottom)
            }
            composerSlot
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .background { openPageLayer }
        // The composer sits 30 pt above the screen's bottom edge, inside the
        // home-indicator area, as in the reference; the keyboard still
        // pushes it up.
        .ignoresSafeArea(.container, edges: .bottom)
        .background(chatBackground)
        .overlay(alignment: .bottom) { plusSheet }
        .onValueChange(of: callPillShown) { shown in
            if !shown { callPanel = nil }
        }
#if DEBUG
        .overlay(alignment: .bottomLeading) {
            if CallDebug.injecting && call.active { CallDebugPanel(call: call).padding(.leading, 2).padding(.bottom, 120) }
        }
#endif
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden(true)
        // Hiding the bar above also disarms the system edge-swipe back
        // gesture, which is wired to the bar's navigation controller.
        // Re-arm it so a rightward swipe from the left edge pops back to
        // Home, the way the rest of iOS behaves.
        .background(SwipeBackBridge())
        .navigationDestination(isPresented: $showingComputer) {
            if case let .bot(bot) = current { ComputerView(bot: bot) }
        }
    }

    // MARK: - Header

    /// The top bar of reference 02: 44 pt glass circles 18 pt from the
    /// edges (back, computer) and the centred name capsule.
    static let topBarHeight: CGFloat = 56
    /// Space between two rows of the transcript.
    static let rowGap: CGFloat = 10
    static let composerTopPadding: CGFloat = 6

    /// True when this message opens a fresh stretch of conversation — the
    /// first one, or one that follows a gap of half an hour or more.
    /// The desktop marks a new calendar day only.
    /// Takes the draft prepared for this thread (ComposerPrefill), unsent:
    /// it goes before what the composer holds, and the composer takes focus.
    func takePrefill() {
        guard let text = ComposerPrefill.shared.take(threadId: threadId) else { return }
        draft = BotTodoList.merge(draft: text, into: draft)
        composerFocused = true
    }

    func desktopStartsANewDay(at index: Int, in rows: [TranscriptRow]) -> Bool {
        guard index > 0 else { return true }
        return !Calendar.current.isDate(rows[index].head.date, inSameDayAs: rows[index - 1].head.date)
    }

    func startsANewStretch(at index: Int, in rows: [TranscriptRow]) -> Bool {
        guard index > 0 else { return true }
        return rows[index].at - rows[index - 1].endAt > 30 * 60 * 1000
    }

    /// True when the next message is from someone else (or there is none),
    /// which is where a run of bubbles gets its tail — one per run, like
    /// every messaging app, rather than one per bubble.
    func endsRun(at index: Int, in rows: [TranscriptRow]) -> Bool {
        guard index + 1 < rows.count else { return true }
        let this = rows[index], next = rows[index + 1]
        if this.role != next.role { return true }
        if this.senderName != next.senderName { return true }
        // two people's lines in a room are two runs (RM21)
        if this.head.sender?.id != next.head.sender?.id { return true }
        // a card or a tool chip between two texts breaks the run visually
        return next.kind != .text
    }

    var canSend: Bool {
        (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty
            || !power.pastes(threadId).isEmpty || !citations.citations(threadId).isEmpty)
            && !preparingAttachments && !sendingMessage && session.attachmentUploadsReady(attachments)
    }

    /// Messages the harness is holding for this thread. They sit above the
    /// composer rather than pretending to be part of the transcript: the
    /// turn that is still running owns the transcript's tail, and these
    /// words have not been said yet.
    var heldSends: [QueuedSend] {
        session.state.pendingQueued[threadId] ?? []
    }

    var hasPendingApproval: Bool {
        messages.contains { $0.card?.isPending == true }
    }
}

/// The "New" line above the replies that were unread when the chat opened
/// (`NewMessagesDivider`): a hairline in the accent on each side of a small
/// capitalised word.
struct NewMessagesLine: View {
    @Environment(\.themePalette) var themePalette

    var body: some View {
        HStack(spacing: 12) {
            Rectangle().fill(Theme.accentText.opacity(0.6)).frame(height: 1)
            Text("New")
                .textCase(.uppercase)
                .font(.system(size: 11, weight: .semibold))
                .kerning(0.6)
                .foregroundStyle(Theme.accentText)
                .fixedSize()
            Rectangle().fill(Theme.accentText.opacity(0.6)).frame(height: 1)
        }
        .padding(.vertical, 14)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("New messages"))
        .accessibilityIdentifier("chat-new-divider")
    }
}

/// The end of the transcript while a bot works: the reply as it is typed,
/// its reasoning before any answer exists, or the typing dots. The only part
/// of the chat that re-renders per streamed frame (`StreamingStore`).
struct ChatLiveTail: View {
    @ObservedObject var store: StreamingStore
    let threadId: String
    /// On a call the words are spoken, not typed out.
    let onCall: Bool
    /// "Show replies as they are written" (StreamReplies): off, the working
    /// line stays until the settled reply arrives whole.
    var streams: Bool = true
    let showsReasoning: Bool
    let busy: Bool
    let color: String
    let name: String
    /// The conversation, for its mascot on the thinking line.
    var chat: Chat? = nil
    /// 2026-10-29: the running call's step, named on the line in place of
    /// "Thinking…" (shared/working-step.ts); nil between calls.
    var step: WorkingStepLine.Current? = nil
    /// Replies that finished streaming while this chat was open.
    @State private var finished = 0

    var body: some View {
        tail
            // a light tap when the reply is done, the way Messages marks an
            // arrival (Settings > Haptics off: none)
            .feedback(.impact, trigger: finished)
            .onValueChangePair(of: store.text[threadId]?.isEmpty == false) { was, now in
                if was && !now { finished += 1 }
            }
    }

    @ViewBuilder
    private var tail: some View {
        if !onCall, streams, let live = store.text[threadId], !live.isEmpty {
            StreamingBubble(text: live, reasoning: nil, color: color)
                .padding(.top, ChatView.rowGap)
                .id(ChatView.liveBubbleId)
        } else if !onCall, showsReasoning, let thinking = store.reasoning[threadId], !thinking.isEmpty {
            // Only while there is no answer yet. Once tokens
            // of the reply exist, the reasoning is behind us
            // and showing both is just noise.
            StreamingBubble(text: nil, reasoning: thinking, color: color)
                .padding(.top, ChatView.rowGap)
                .id(ChatView.liveBubbleId)
        } else if busy {
            // the reference design's thinking line: the bot's own small
            // mascot at work, then a quiet word (the dots for a room)
            Group {
                if let chat, chat.isBot {
                    HStack(spacing: 10) {
                        ChatAvatarView(chat: chat, size: 28, state: .thinking, animated: true)
                        if let step, let label = WorkingStepText.label(step.step) {
                            // the step, and how long it has been quiet
                            TimelineView(.periodic(from: .now, by: 15)) { context in
                                Text([label, WorkingStepText.quiet(since: step.since, now: context.date)].compactMap { $0 }.joined(separator: " · "))
                                    .font(Theme.Font.body)
                                    .foregroundStyle(Theme.textTertiary)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                            }
                            .accessibilityIdentifier("chat-working-step")
                        } else {
                            Text("Thinking…")
                                .font(Theme.Font.body)
                                .foregroundStyle(Theme.textTertiary)
                        }
                    }
                    .padding(.leading, 4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement(children: .ignore)
                } else {
                    TypingIndicatorView(tintColor: MausPalette.color(color))
                }
            }
            .padding(.top, ChatView.rowGap)
            .id(ChatView.liveBubbleId)
            .accessibilityLabel("\(name) is working")
            .accessibilityValue(step.flatMap { WorkingStepText.label($0.step) } ?? "")
            .accessibilityIdentifier("chat-thinking")
        }
    }
}

/// Tells the theme which bot is open (Settings > Appearance > Use bot color
/// as accent, src/lib/bot-accent.ts `useBotAccent`): its colour while the
/// chat is on screen, the skin's own once it leaves.
private struct OpenBotAccent: ViewModifier {
    let color: String?
    /// The bot's name, for Hibou 98's title bar ("Sagax - Nova").
    var name: String? = nil

    func body(content: Content) -> some View {
        content
            .onAppear {
                ThemeStore.shared.setOpenBot(color)
                RetroOpenBot.shared.set(name)
            }
            .onValueChange(of: color) { ThemeStore.shared.setOpenBot($0) }
            .onValueChange(of: name) { RetroOpenBot.shared.set($0) }
            .onDisappear {
                if let color { ThemeStore.shared.setOpenBot(nil, leaving: color) }
                RetroOpenBot.shared.clear(name)
            }
    }
}

/// Threads hidden: a thread opened over the one conversation (ChatLinks).
struct BesideThread: Identifiable, Hashable {
    let botId: String
    let threadId: String
    var id: String { "\(botId):\(threadId)" }
}

/// That thread's own chat in a sheet. Done or a swipe down returns to the
/// conversation underneath, which never moved.
struct BesideThreadSheet: View {
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    let beside: BesideThread

    var body: some View {
        NavigationStack {
            Group {
                if let bot = session.state.bot(beside.botId)?.projected(forThread: beside.threadId) {
                    ChatView(chat: .bot(bot))
                } else {
                    Text("That thread is no longer on your computer.")
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .accessibilityIdentifier("beside-thread-done")
                }
            }
        }
        .accessibilityIdentifier("beside-thread.\(beside.threadId)")
    }
}


// MARK: - One conversation (SingleStream): the earlier topics above the live one

extension ChatView {
    /// The id the timeline scrolls to for a topic's start.
    static func topicAnchor(_ threadId: String) -> String { "topic:\(threadId)" }

    /// Whether the thread on screen is a segment of its bot's stream.
    var currentTopicIsSegment: Bool {
        guard case let .bot(bot) = current, let task = bot.tasks?.first(where: { $0.threadId == threadId }) else { return false }
        return SingleStream.isSegment(task)
    }

    /// The topics before the one on screen, newest first (the order
    /// scrolling back reaches them).
    var earlierTopics: [BotTask] {
        guard case let .bot(bot) = current, !threadPrefs.showThreads else { return [] }
        return SingleStream.earlierSegments(session.state.bot(bot.id)?.tasks, before: threadId).reversed()
    }

    var topicRevealKey: String {
        guard let topic = pendingTopicReveal else { return "" }
        return "\(topic):\(session.state.hasLoadedPage(forThread: topic))"
    }

    var streamReadBackKey: Bool {
        !threadPrefs.showThreads && currentTopicIsSegment && session.state.hasMore[threadId] == false
    }

    /// What the gate noted for this bot (Session.land): a thread to open
    /// beside the conversation, a topic to bring on screen.
    var gateSignalsKey: String {
        guard case let .bot(bot) = chat else { return "" }
        return "\(session.pendingBeside[bot.id]?.threadId ?? "")|\(session.revealSegments[bot.id] ?? "")"
    }

    /// Citations Continue in the conversation queued for this composer's thread.
    var pendingCitationsKey: String {
        let pending = session.pendingComposerCitations[threadId] ?? []
        return pending.map(\.id).joined(separator: ",")
    }

    /// The live topic read back to its start: the topic before it is drawn
    /// at once (the desktop's StreamEarlierTopics), the next on request.
    func drawFirstEarlierTopic() {
        guard streamReadBackKey, earlierTopicsShown == 0, let first = earlierTopics.first else { return }
        earlierTopicsShown = 1
        let threadId = first.threadId
        Task { await session.loadThreadIfNeeded(threadId) }
    }

    func takeGateSignals(_ botId: String) {
        if let beside = session.pendingBeside[botId] {
            session.pendingBeside[botId] = nil
            cancelThreadOpen()
            besideThread = beside
        }
        if let topic = session.revealSegments[botId] {
            session.revealSegments[botId] = nil
            // draw every topic back to that one, then scroll to its start
            let needed = earlierTopics.firstIndex { $0.threadId == topic }.map { $0 + 1 } ?? 0
            if needed > 0 {
                earlierTopicsShown = max(earlierTopicsShown, needed)
                pendingTopicReveal = topic
                Task {
                    for topicId in earlierTopics.prefix(needed).map(\.threadId) { await session.loadThreadIfNeeded(topicId) }
                }
            }
        }
        takePendingCitations()
    }

    /// #1699: Continue in the conversation's report quote lands in this
    /// composer's citation chips (desktop `appendDraftAttachments`).
    func takePendingCitations() {
        let id = threadId
        guard let pending = session.pendingComposerCitations[id], !pending.isEmpty else { return }
        session.pendingComposerCitations[id] = nil
        for citation in pending { citations.add(citation, to: id) }
    }
}

/// One earlier topic of the conversation: its rows, drawn like the live
/// topic's (the same row views), read only.
struct EarlierTopicSection: View {
    @EnvironmentObject private var session: Session
    let chat: Chat
    let rows: [TranscriptRow]
    let openLink: (URL, Message) -> OpenURLAction.Result
    let openThread: (ThreadRef) -> Void
    let revealedMessageId: String?
    let scrollToMessage: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                VStack(alignment: .leading, spacing: 0) {
                    if index > 0 { Color.clear.frame(height: ChatView.rowGap) }
                    switch row {
                    case let .message(message):
                        MessageRow(chat: chat, message: message, endsRun: true, openLink: openLink, openThread: openThread)
                            .equatable()
                    case let .activityRun(run):
                        StepRunRow(run: run, chat: chat, openLink: openLink, openThread: openThread, revealedMessageId: revealedMessageId, scrollToMessage: scrollToMessage)
                    case let .voiceCall(card):
                        VoiceCallCard(chat: chat, card: card, forceOpen: card.messages.contains { $0.id == revealedMessageId }, live: session.streamingStore)
                    }
                }
                .id(row.id)
            }
        }
        .accessibilityIdentifier("chat.earlierTopic")
    }
}

/// Between two topics of the one conversation: a quiet time line, like a
/// day separator. The topic's title stays as the accessibility label.
struct TopicDividerLine: View {
    let date: Date
    let title: String

    var body: some View {
        HStack(spacing: 10) {
            Rectangle().fill(Theme.chatTimestamp.opacity(0.35)).frame(height: 0.5)
            Text(RelativeStamp.separator(date))
                .font(Theme.Font.timestamp)
                .foregroundStyle(Theme.chatTimestamp)
                .fixedSize()
            Rectangle().fill(Theme.chatTimestamp.opacity(0.35)).frame(height: 0.5)
        }
        .padding(.vertical, 14)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(String(localized: "New topic")) · \(title)"))
        .accessibilityIdentifier("chat.topicDivider")
    }
}
