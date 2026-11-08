// The island: a black shape at the top of the screen, sitting where the
// hardware Dynamic Island is, that grows into a square with a bot's face
// alive inside it — and shrinks back into the island when it is done.
//
// Apps cannot draw inside the real island, so this is the same trick X
// uses: a black rounded square that grows out of the island. The mascot
// engine does the rest — it already morphs every state and expression,
// which is what makes the square worth growing.
import SwiftUI
import CompanionCore

/// The hardware island's frame, in points from the top of the screen, on the
/// phones that have one. The expanded square is anchored here so it grows
/// out of the island; nothing is drawn over the island while collapsed.
enum IslandGeometry {
    static let size = CGSize(width: 126, height: 37)
    static let top: CGFloat = 11

    /// The window's top safe-area inset — the one number that places
    /// anything relative to the screen's top edge.
    static var topInset: CGFloat {
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first?.safeAreaInsets.top ?? 0
    }
}

/// The island shape, collapsed or expanded, with whatever is inside it.
/// Expanded, it is as tall as what it holds: the answers are never cut off
/// at the bottom, whatever the length of the question.
struct IslandShell<Content: View>: View {
    @Environment(\.themePalette) var themePalette
    let expanded: Bool
    var expandedWidth: CGFloat = 300
    @ViewBuilder let content: () -> Content

    private var radius: CGFloat { expanded ? 44 : IslandGeometry.size.height / 2 }

    var body: some View {
        Group {
            if expanded {
                content()
                    .frame(width: expandedWidth)
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(.opacity.combined(with: .scale(scale: 0.92)))
            } else {
                Color.clear.frame(width: IslandGeometry.size.width, height: IslandGeometry.size.height)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(Color.black)
                // a hairline, so the square still reads as a shape on a dark screen
                .overlay(
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .strokeBorder(Color.white.opacity(expanded ? 0.12 : 0), lineWidth: 1)
                )
        )
        .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        // Collapsed: gone entirely, island or not. The hardware island is
        // not one shape, so a fixed black pill parked behind it would peek
        // out; the square still grows out of the island because it is
        // anchored there and animates in with the same spring.
        .opacity(expanded ? 1 : 0)
        .scaleEffect(expanded ? 1 : 0.6, anchor: .top)
        .padding(.top, IslandGeometry.top)
        .shadow(color: .black.opacity(expanded ? 0.45 : 0), radius: 28, y: 12)
        .ignoresSafeArea(edges: .top)
    }
}

/// The roster's island: when a bot stops for you, it grows with that bot's
/// face, the question, and the answers. Tap the face to open the chat.
struct NeedsYouIsland: View {
    @Environment(\.themePalette) var themePalette
    let update: ChatUpdate?
    let open: (Chat) -> Void
    @EnvironmentObject private var session: Session
    @State private var shown: ChatUpdate?
    @State private var dismissedCardIds = Set<String>()
    @State private var answering = false
    // The comet face is the costliest draw in the app. It earns a beat of
    // motion when the island appears; an approval left unattended overnight
    // must not keep a 30fps orbit running until morning.
    @State private var attentionLive = true

    private var expanded: Bool { shown != nil }

    var body: some View {
        ZStack(alignment: .top) {
            if expanded {
                // tap anywhere else: put it away, keep the row's tag
                Color.black.opacity(0.001)
                    .ignoresSafeArea()
                    .onTapGesture { dismiss() }
            }
            IslandShell(expanded: expanded) {
                if let shown {
                    VStack(alignment: .leading, spacing: 12) {
                        // Who asks: a small face and the name, nothing added
                        // to it. Tap opens the chat. The hardware island
                        // covers the first 37pt; the row sits clear of it.
                        Button { open(shown.chat) } label: {
                            HStack(spacing: 10) {
                                ChatAvatarView(chat: shown.chat, size: 36, state: MausState.forChat(shown.chat, in: session.state), animated: attentionLive, comets: false)
                                Text(verbatim: shown.chat.name)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(MausPalette.color(shown.chat.color))
                                    .lineLimit(1)
                                Spacer(minLength: 0)
                            }
                        }
                        .buttonStyle(.plain)
                        .task(id: shown.chat.conversationID) {
                            attentionLive = true
                            try? await Task.sleep(for: .seconds(30))
                            attentionLive = false
                        }
                        .padding(.top, IslandGeometry.size.height + 10)

                        // The question first, in plain words, then its detail.
                        let text = NeedsYouText(update: shown)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(verbatim: text.question)
                                .font(.system(size: 17, weight: .semibold))
                                .foregroundStyle(.white)
                                .lineLimit(4)
                            if let detail = text.detail {
                                Text(verbatim: detail)
                                    .font(.system(size: 14))
                                    .foregroundStyle(.white.opacity(0.7))
                                    .lineLimit(3)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)

                        if let card = shown.card, card.isPending {
                            answers(card: card, chat: shown.chat)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 20)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .animation(.spring(response: 0.55, dampingFraction: 0.78), value: expanded)
        .onValueChange(of: update?.card?.requestId) { _ in reconcile() }
        .onAppear { reconcile() }
    }

    /// The answers, always on screen: two side by side, more stacked, up to
    /// the banner's own limit; past it, Open.
    @ViewBuilder
    private func answers(card: OptionCard, chat: Chat) -> some View {
        if card.skillRequest != nil {
            pill(String(localized: "Open chat to review"), refusal: false, color: chat.color) {
                open(chat)
                dismiss()
            }
        } else {
            // #2909: each answer titled whole with its short label; when
            // they cannot all be, Open only (the card has them in full)
            let answers = NotificationChoiceLabels.answers(for: card.options) ?? []
            let openOnly = answers.isEmpty
            let buttons = answers.map { answer in
                let option = answer.choice
                return pill(answer.title, refusal: CardStyle.isRefusal(option), color: chat.color) {
                    Haptics.selection()
                    answering = true
                    Task {
                        await session.answer(chat: chat, card: card, choice: option)
                        answering = false
                        dismiss()
                    }
                }
                .disabled(answering)
            }
            Group {
                if answers.count <= 2 && !openOnly {
                    HStack(spacing: 8) { ForEach(Array(buttons.enumerated()), id: \.offset) { $0.element } }
                } else {
                    VStack(spacing: 8) {
                        ForEach(Array(buttons.enumerated()), id: \.offset) { $0.element }
                        if openOnly {
                            pill(String(localized: "Open"), refusal: true, color: chat.color) {
                                open(chat)
                                dismiss()
                            }
                        }
                    }
                }
            }
        }
    }

    private func pill(_ title: String, refusal: Bool, color: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            // the card's own words, in the app's language when the catalog has them
            Text(verbatim: AppStrings.localized(title))
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .padding(.horizontal, 10)
                .frame(maxWidth: .infinity)
                .frame(height: 42)
                .background(Capsule().fill(refusal ? Color.white.opacity(0.16) : MausPalette.color(color)))
        }
        .buttonStyle(.plain)
    }

    /// Show a new needs-you the moment it lands; never re-show one the user
    /// put away; fold away when it is answered elsewhere.
    private func reconcile() {
        guard let update, update.kind == .needsYou, let id = update.card?.requestId else {
            shown = nil
            return
        }
        if dismissedCardIds.contains(id) { shown = nil; return }
        shown = update
    }

    private func dismiss() {
        if let id = shown?.card?.requestId { dismissedCardIds.insert(id) }
        shown = nil
    }
}
