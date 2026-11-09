import SwiftUI
import CompanionCore

/// A passing banner over the chat for a notice that is never a row
/// (`TransientNotices`, desktop TransientNotice.tsx): a routine run that
/// failed, a routine's access card. It leaves on its own after a few
/// seconds, when the person closes it, or once the routine has run again.
/// The failure that paused its routine (2026-10-26) offers Resume, and the
/// banner closes once the routine is back on.
struct TransientNoticeBanner: View {
    let chat: Chat
    let messages: [Message]
    let openLink: (URL, Message) -> OpenURLAction.Result
    var openThread: ((ThreadRef) -> Void)? = nil

    @State private var active: Message?
    private let memory = TransientNoticeMemory()

    var body: some View {
        Group {
            if let active {
                HStack(alignment: .top, spacing: 8) {
                    MessageRow(chat: chat, message: active, endsRun: true, openLink: openLink, openThread: openThread.map { open in
                        { ref in close(); open(ref) }
                    }, afterResume: close, rowContext: SessionHub.session.rowContext(forThread: chat.threadId))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Button(action: close) {
                        Image(systemName: "xmark").font(.footnote.weight(.semibold))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Close"))
                }
                .padding(10)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .padding(.horizontal, 12)
                .transition(.move(edge: .top).combined(with: .opacity))
                .accessibilityIdentifier("transient-notice-\(active.id)")
                .task(id: active.id) {
                    try? await Task.sleep(nanoseconds: UInt64(TransientNotices.visibleMs) * 1_000_000)
                    if self.active?.id == active.id { close() }
                }
            }
        }
        .onAppear(perform: refresh)
        .onChange(of: messages) { _ in refresh() }
    }

    private func refresh() {
        if let current = active {
            if TransientNotices.settled(current, in: messages) { close() }
            return
        }
        let now = Date().timeIntervalSince1970 * 1000
        guard let next = TransientNotices.pick(messages, now: now, shown: memory.shown) else { return }
        memory.remember(next.id)
        withAnimation { active = next }
    }

    private func close() {
        withAnimation { active = nil }
    }
}
