// Where taps in the transcript go: thread chips, web links and desktop file
// links (downloaded and previewed). Split out of ChatView.swift unchanged.
import SwiftUI
import CompanionCore

extension ChatView {
    /// A chip that opened a thread on this bot switches this screen in
    /// place; one that opened a thread on a teammate pushes that chat.
    func openThread(_ ref: ThreadRef) {
        // Threads hidden: a thread outside this conversation (a parallel
        // task's detail, a job, a run) opens over it; Done brings the
        // conversation back where it was. Never a switch in place.
        if case let .bot(shown) = current, shown.id == ref.botId,
           let task = shown.tasks?.first(where: { $0.threadId == ref.threadId }),
           FreshTopic.opensBeside(task, shown: shown.tasks?.first { $0.threadId == selectedThreadId }, showThreads: threadPrefs.showThreads) {
            cancelThreadOpen()
            besideThread = BesideThread(botId: ref.botId, threadId: ref.threadId)
            return
        }
        cancelThreadOpen()
        let shownBotId: String? = current.isBot ? current.id : nil
        threadOpenTask = Task {
            let openedThreadId = await session.openThread(ref, shownBotId: shownBotId)
            guard !Task.isCancelled else { return }
            threadOpenTask = nil
            if let openedThreadId { selectedThreadId = openedThreadId }
        }
    }

    func cancelThreadOpen() {
        threadOpenTask?.cancel()
        threadOpenTask = nil
    }

    func openLink(_ url: URL, from message: Message) -> OpenURLAction.Result {
        // #4572: a record chip opens that record's card in a sheet, in this chat
        if let ref = RecordLinks.parse(url.absoluteString) {
            recordSheet = RecordSheetItem(ref: ref, label: RecordLinks.label(of: url.absoluteString, in: message.recordText))
            return .handled
        }
        // A thread reference ("#Title" sent as its canonical link, WP3).
        if let ref = ThreadRefs.parse(url.absoluteString) {
            if let botId = ref.botId, session.state.bot(botId) != nil {
                openThread(ThreadRef(botId: botId, threadId: ref.threadId, title: ""))
            } else if ref.threadId != threadId {
                session.openChat(threadId: ref.threadId)
            }
            return .handled
        }
        guard let target = LocalMessageLink.resolve(url) else {
            fileOpenError = "This link can't be opened securely."
            return .handled
        }
        switch target {
        case let .web(webURL):
            return .systemAction(webURL)
        case let .desktopFile(path):
            openFile(path: path, from: message)
            return .handled
        }
    }

    func openFile(path: String, from message: Message) {
        fileDownloadTask?.cancel()
        let requestID = UUID()
        fileDownloadRequestID = requestID
        let requestedThreadID = threadId
        fileOpenError = nil
        let name = URL(fileURLWithPath: path).lastPathComponent
        openingFileName = name.isEmpty ? "file" : name
        let task = Task {
            let downloaded = await session.downloadFile(
                threadId: requestedThreadID,
                messageId: message.id,
                path: path
            )
            if let downloaded, let preview = FilePreviewItem(downloaded: downloaded) {
                // Own the temporary file before checking cancellation so an
                // old link tap cannot strand it between Session and the sheet.
                guard !Task.isCancelled, fileDownloadRequestID == requestID else {
                    preview.cleanUp()
                    return
                }
                openingFileName = nil
                filePreview?.cleanUp()
                filePreview = preview
                fileDownloadRequestID = nil
                fileDownloadTask = nil
                return
            }
            guard !Task.isCancelled, fileDownloadRequestID == requestID else { return }
            openingFileName = nil
            fileDownloadRequestID = nil
            fileDownloadTask = nil
            guard downloaded != nil else {
                fileOpenError = session.actionError ?? "Couldn't open that file. Try again."
                session.actionError = nil
                return
            }
            fileOpenError = "The downloaded file couldn't be previewed."
        }
        fileDownloadTask = task
    }

    /// End the preview lifecycle owned by the task that just left the screen.
    func resetFilePreview() {
        fileDownloadTask?.cancel()
        fileDownloadTask = nil
        fileDownloadRequestID = nil
        openingFileName = nil
        fileOpenError = nil
        filePreview?.cleanUp()
        filePreview = nil
    }
}
