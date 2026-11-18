import CompanionCore
import SwiftUI
import WatchKit

struct WatchChat: View {
    let bot: Bot
    @ObservedObject var session: WatchSession
    @Environment(\.scenePhase) private var phase
    private struct Line: Identifiable {
        let message: Message
        let threadId: String
        var id: String { message.id }
    }

    private struct Draft {
        let text: String
        let threadId: String
        let sendId = UUID().uuidString
    }

    @State private var messages: [Line] = []
    @State private var history: [String: [Line]] = [:]
    @State private var refreshId = UUID()
    @State private var loaded = false
    @State private var readFailed = false
    @State private var sending = false
    @State private var unsent: Draft?
    @State private var showTextInput = false
    @State private var fallbackSuggestions: [String] = []

    private var threadId: String { SingleStream.home(of: bot) ?? bot.mainThreadId ?? bot.threadId }
    private var palette: SkinPalette {
        SkinID.black.palette.withBotAccent(MausColors.hex(for: bot.color).flatMap(SkinColor.init(css:)))
    }

    var body: some View {
        ScrollViewReader { reader in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(messages) { line in
                        let message = line.message
                        if message.card != nil {
                            WatchMessageCard(bot: bot, threadId: line.threadId,
                                             message: message, session: session, onAnswered: { await refresh() })
                                .id(message.id)
                        } else if let text = message.text {
                            bubble(text, fromUser: message.role == .user)
                                .id(message.id)
                        }
                    }
                    if readFailed {
                        Text("Couldn’t load this conversation.")
                        Button("Retry") { Task { await refresh() } }
                    } else if messages.isEmpty {
                        if loaded { Text("Start the conversation.") } else { ProgressView() }
                    }
                    if let unsent {
                        Text(verbatim: unsent.text).foregroundStyle(.secondary)
                        Button("Retry sending") { Task { await send(unsent) } }
                    }
                    HStack(spacing: 6) {
                        Button("Reply") { compose(suggestions: [
                            String(localized: "Thanks!"), String(localized: "Continue"), String(localized: "Tell me more")
                        ]) }
                        Button { compose(suggestions: nil) } label: {
                            Image(systemName: "mic.fill")
                        }
                        .accessibilityLabel("Talk to my bot")
                        .frame(width: 44)
                    }
                    .disabled(sending)
                    .id("composer")
                }
                .padding(.horizontal, 3)
            }
            .onChange(of: messages.last?.id) {
                if !messages.isEmpty { reader.scrollTo("composer", anchor: .bottom) }
            }
        }
        .sheet(isPresented: $showTextInput) {
            List {
                TextFieldLink("Reply") { text in submitInput(text) }
                ForEach(fallbackSuggestions, id: \.self) { text in
                    Button(text) { submitInput(text) }
                }
            }
        }
        .navigationTitle(bot.name)
        .tint(watchColor(palette.accentText))
        .task(id: phase == .active ? threadId : nil) {
            guard phase == .active else { return }
            repeat {
                await refresh()
                do { try await Task.sleep(for: .seconds(4)) } catch { return }
            } while !Task.isCancelled
        }
    }

    private func bubble(_ text: String, fromUser: Bool) -> some View {
        let markdown = try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))
        return Text(markdown ?? AttributedString(text))
            .font(.callout)
            .foregroundStyle(watchColor(fromUser ? palette.bubbleUserText : palette.bubbleAssistantText))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(watchColor(fromUser ? palette.bubbleUser : palette.bubbleAssistant),
                        in: RoundedRectangle(cornerRadius: 12))
            .padding(fromUser ? .leading : .trailing, 10)
            .frame(maxWidth: .infinity, alignment: fromUser ? .trailing : .leading)
    }

    private func watchColor(_ token: SkinColor) -> Color {
        Color(.sRGB, red: token.red, green: token.green, blue: token.blue, opacity: token.alpha)
    }

    @MainActor private func refresh() async {
        guard let client = session.client else { return }
        let request = UUID()
        refreshId = request
        do {
            var rows = try await latest(in: threadId, client: client)
            guard !Task.isCancelled, refreshId == request else { return }
            readFailed = false
            if !loaded && !rows.isEmpty {
                messages = rows
                loaded = true
            }
            // A fresh segment can be empty. The bot's previous conversation
            // segments are history in this same chat, as on the phone.
            for segment in SingleStream.earlierSegments(bot.tasks, before: threadId).reversed() {
                if rows.count >= 35 { break }
                let previous: [Line]
                if let cached = history[segment.threadId] {
                    previous = cached
                } else {
                    guard let page = try? await latest(in: segment.threadId, client: client) else { break }
                    guard !Task.isCancelled, refreshId == request else { return }
                    previous = page
                    history[segment.threadId] = previous
                }
                rows.insert(contentsOf: previous.suffix(35 - rows.count), at: 0)
            }
            guard !Task.isCancelled, refreshId == request else { return }
            messages = rows
            loaded = true
        } catch {
            guard !Task.isCancelled, refreshId == request else { return }
            readFailed = true
            await session.recover(after: error, using: client)
        }
    }

    private func latest(in thread: String, client: CompanionClient) async throws -> [Line] {
        let page = try await client.messages(threadId: thread, limit: 35)
        var transcript = CompanionState()
        transcript.merge(page, intoThread: thread)
        return transcript.visibleTranscript(forThread: thread).compactMap { message in
            guard message.card != nil || (message.kind == .text && message.text?.isEmpty == false) else { return nil }
            return Line(message: message, threadId: thread)
        }
    }

    @MainActor private func compose(suggestions: [String]?) {
        guard let controller = WKApplication.shared().visibleInterfaceController else {
            fallbackSuggestions = suggestions ?? []
            showTextInput = true
            return
        }
        let identity = session.identity
        let destination = threadId
        controller.presentTextInputController(withSuggestions: suggestions, allowedInputMode: .plain) { result in
            guard let text = (result?.first as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !text.isEmpty else { return }
            Task { @MainActor in
                guard identity == session.identity else { return }
                await send(Draft(text: text, threadId: destination))
            }
        }
    }

    @MainActor private func submitInput(_ words: String) {
        let text = words.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        showTextInput = false
        let draft = Draft(text: text, threadId: threadId)
        let identity = session.identity
        Task { @MainActor in
            guard session.identity == identity else { return }
            await send(draft)
        }
    }

    @MainActor private func send(_ draft: Draft) async {
        guard !sending, let client = session.client else { return }
        let identity = session.identity
        sending = true
        defer { sending = false }
        do {
            _ = try await client.send(text: draft.text, to: .bot(id: bot.id, threadId: draft.threadId), sendId: draft.sendId)
            guard session.identity == identity else { return }
            unsent = nil
            await refresh()
        } catch {
            guard session.identity == identity else { return }
            unsent = draft
            await session.recover(after: error, using: client)
        }
    }
}
