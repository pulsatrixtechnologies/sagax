// "Seen by" (desktop #270, SeenBy.tsx and read-receipts-feed.ts): each
// participant once, under the last line they have read. In a room or a
// conversation between people: the label, up to five faces, then "+N"; a
// long press opens the names with their times (the desktop's hover). In a
// one-to-one chat with a bot: a quiet "Seen" under your last line until it
// answers. The phone reports its own position when the newest line shows.
import CompanionCore
import SwiftUI

@MainActor
final class ReadReceiptsCenter: ObservableObject {
    static let shared = ReadReceiptsCenter()

    @Published private(set) var reads: [String: ThreadReads] = [:]
    private var loading = Set<String>()
    private var reported: [String: String] = [:]

    func reads(for threadId: String) -> ThreadReads? { reads[threadId] }

    /// Read once per thread; a `reset` frame or a reconnect reads again.
    func ensureLoaded(_ threadId: String, session: Session) {
        guard reads[threadId] == nil, !loading.contains(threadId) else { return }
        load(threadId, session: session)
    }

    func load(_ threadId: String, session: Session) {
        guard let client = session.settingsClient else { return }
        loading.insert(threadId)
        Task {
            defer { loading.remove(threadId) }
            if let fetched = try? await client.threadReads(threadId: threadId) { reads[threadId] = fetched }
        }
    }

    func apply(_ frame: ThreadReadFrame, session: Session) {
        guard let current = reads[frame.threadId] else { return }
        if let next = ReadReceiptRules.apply(frame, to: current.reads) {
            reads[frame.threadId] = ThreadReads(reads: next, selfId: current.selfId)
        } else {
            reads[frame.threadId] = nil
            load(frame.threadId, session: session)
        }
    }

    /// The person's own position: the newest stored line shown while the
    /// app is in front (the desktop's focused, visible window).
    func report(_ threadId: String, messageId: String, session: Session) {
        guard UIApplication.shared.applicationState == .active, reported[threadId] != messageId,
              let client = session.settingsClient else { return }
        reported[threadId] = messageId
        Task { _ = try? await client.postThreadRead(threadId: threadId, messageId: messageId) }
    }

    func reset() {
        reads = [:]
        reported = [:]
    }
}

/// Under a message: the faces of who read up to it, or the bot's "Seen".
struct SeenByRow: View {
    /// Not observed (#3017, L02): `rowContext` carries the session state.
    private var session: Session { SessionHub.session }
    @ObservedObject private var center = ReadReceiptsCenter.shared
    @ObservedObject private var people = PeopleDirectory.shared
    let message: Message
    let chat: Chat
    var rowContext: RowContext = .none
    @State private var showingNames = false

    private var transcript: [Message] { session.visibleTranscript(forThread: chat.threadId) }

    var body: some View {
        content
            .onAppear {
                center.ensureLoaded(chat.threadId, session: session)
                // the newest stored line on screen is this person's position
                if transcript.last?.id == message.id, !message.id.hasPrefix("optimistic-") {
                    center.report(chat.threadId, messageId: message.id, session: session)
                }
            }
    }

    @ViewBuilder private var content: some View {
        if let reads = center.reads(for: chat.threadId), !reads.reads.isEmpty {
            switch chat {
            case let .bot(bot):
                if let place = ReadReceiptRules.botSeenCaption(order: transcript, reads: reads.reads, botId: bot.id),
                   place.messageId == message.id {
                    Text(ReadReceiptRules.captionShowsTime(sentAt: message.at, seenAt: place.at)
                         ? String(localized: "Seen at \(Self.time(place.at))")
                         : String(localized: "Seen"))
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("seen-caption")
                }
            case .room:
                let rows = ReadReceiptRules.seenRows(order: transcript, anchorable: ReadReceiptRules.roomAnchorable, reads: reads.reads, selfId: reads.selfId ?? session.roomViewer.actorId)
                if let entries = rows[message.id], !entries.isEmpty { faces(entries) }
            }
        }
    }

    private func faces(_ entries: [SeenEntry]) -> some View {
        let split = ReadReceiptRules.faces(entries)
        return HStack(spacing: 6) {
            Text("Seen by").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            HStack(spacing: -4) {
                ForEach(split.shown, id: \.participantId) { entry in face(entry) }
            }
            if split.more > 0 {
                Text(verbatim: "+\(split.more)").font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.textSecondary)
            }
        }
        .contentShape(Rectangle())
        // touch and hold: "Name · time" for each (the desktop's hover);
        // this menu wins over the message's own. A tap opens the list.
        .contextMenu {
            ForEach(entries, id: \.participantId) { entry in
                Button(String(localized: "\(name(entry)) · \(Self.time(entry.at))")) { showingNames = true }
            }
        }
        .onTapGesture { showingNames = true }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(String(localized: "Seen by \(entries.map { "\(name($0)) \(Self.time($0.at))" }.joined(separator: ", "))")))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { showingNames = true }
        .accessibilityIdentifier("seen-by")
        .sheet(isPresented: $showingNames) {
            NavigationStack {
                List(entries, id: \.participantId) { entry in
                    HStack(spacing: 12) {
                        face(entry, size: 28)
                        Text(verbatim: name(entry))
                        Spacer()
                        Text(verbatim: Self.time(entry.at)).foregroundStyle(Theme.textSecondary)
                    }
                    .accessibilityElement(children: .combine)
                }
                .navigationTitle("Seen by")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showingNames = false } } }
            }
            .presentationDetents([.medium])
        }
    }

    @ViewBuilder private func face(_ entry: SeenEntry, size: CGFloat = 16) -> some View {
        Group {
            if let botId = entry.botId, let bot = session.state.bot(botId) {
                BotMascotView(bot: bot, size: size)
            } else {
                PersonAvatar(initials: People.initials(name(entry)), size: size)
            }
        }
        .frame(width: size, height: size)
        .overlay(Circle().stroke(Theme.bg, lineWidth: 1))
    }

    /// The directory's name, a bot's, the line's sender, else "Someone".
    private func name(_ entry: SeenEntry) -> String {
        if let botId = entry.botId { return session.state.bot(botId)?.name ?? String(localized: "A bot") }
        let label = People.label(people.directory?.person(entry.participantId), fallback: "")
        if !label.isEmpty { return label }
        let sender = transcript.first { $0.sender?.id?.lowercased() == entry.participantId.lowercased() }?.sender?.name
        return sender ?? String(localized: "Someone")
    }

    static func time(_ at: Double) -> String {
        Date(timeIntervalSince1970: at / 1000).formatted(date: .omitted, time: .shortened)
    }
}
