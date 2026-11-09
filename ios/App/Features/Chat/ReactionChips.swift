// Emoji reactions under a message (desktop #270, Reactions.tsx): one chip per
// emoji in the order they first landed, highlighted when the viewer is among
// those who put it there; a tap toggles the viewer's own. Touch and hold a
// chip for who reacted (the desktop's tooltip); its entries open the list
// with the bots' mascots. The
// message menu's "Add reaction" takes any emoji (the desktop's search).
import CompanionCore
import SwiftUI

struct ReactionChipsRow: View {
    /// Not observed: the row above passes `rowContext` and redraws this
    /// when what it reads changes (#3017, L02).
    private var session: Session { SessionHub.session }
    @ObservedObject private var center = ReadReceiptsCenter.shared
    let message: Message
    let chat: Chat
    var rowContext: RowContext = .none
    @State private var details: ReactionChip?

    static func selfIds(_ session: Session, threadId: String) -> Set<String> {
        ReactionRules.selfIds(
            readSelf: ReadReceiptsCenter.shared.reads(for: threadId)?.selfId,
            viewerId: session.account?.principalId,
            personalServer: !session.surfaceGate.allows(.people)
        )
    }

    var body: some View {
        let selfIds = Self.selfIds(session, threadId: chat.threadId)
        let chips = ReactionRules.chips(message.reactions ?? [], selfIds: selfIds)
        if !chips.isEmpty {
            HStack(spacing: 6) {
                ForEach(chips, id: \.emoji) { chip in
                    Text(verbatim: "\(chip.emoji) \(chip.count)")
                        .font(.system(size: 13))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background((chip.mine ? Theme.accent : Theme.textSecondary).opacity(chip.mine ? 0.22 : 0.12), in: Capsule())
                        .overlay(Capsule().stroke(chip.mine ? Theme.accent : .clear, lineWidth: 1))
                        .onTapGesture {
                            Haptics.selection()
                            Task { await session.react(to: message, in: chat.threadId, emoji: chip.emoji) }
                        }
                        // touch and hold: who reacted (the desktop's tooltip);
                        // this menu wins over the message's own
                        .contextMenu {
                            Section(Self.label(chip, selfIds: selfIds)) {
                                ForEach(chip.actors, id: \.id) { actor in
                                    Button(Self.name(actor, selfIds: selfIds)) { details = chip }
                                }
                            }
                        }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(Text(Self.label(chip, selfIds: selfIds)))
                        .accessibilityAddTraits(chip.mine ? [.isButton, .isSelected] : .isButton)
                        .accessibilityAction(named: Text("Who reacted")) { details = chip }
                }
            }
            .sheet(item: Binding(get: { details.map(ChipBox.init) }, set: { details = $0?.chip })) { box in
                ReactionDetailsSheet(chip: box.chip, selfIds: selfIds) { details = nil }
            }
        }
    }

    /// "Ada, Scout and You reacted with 👍".
    static func label(_ chip: ReactionChip, selfIds: Set<String>) -> String {
        let names = chip.actors.map { name($0, selfIds: selfIds) }
        let list: String
        if names.count <= 1 {
            list = names.joined()
        } else {
            list = String(localized: "\(names.dropLast().joined(separator: ", ")) and \(names.last ?? "")")
        }
        return String(localized: "\(list) reacted with \(chip.emoji)")
    }

    static func name(_ actor: ReactionActor, selfIds: Set<String>) -> String {
        switch ReactionRules.actorLabel(actor, selfIds: selfIds) {
        case .you: String(localized: "You")
        case let .name(name): name
        case .aBot: String(localized: "A bot")
        case .someone: String(localized: "Someone")
        }
    }
}

private struct ChipBox: Identifiable {
    let chip: ReactionChip
    var id: String { chip.emoji }
}

/// Who put one emoji there.
struct ReactionDetailsSheet: View {
    @EnvironmentObject private var session: Session
    let chip: ReactionChip
    let selfIds: Set<String>
    let close: () -> Void

    var body: some View {
        NavigationStack {
            List(chip.actors, id: \.id) { actor in
                HStack(spacing: 12) {
                    if let botId = ReadReceiptRules.botId(of: actor.id), let bot = session.state.bot(botId) {
                        BotMascotView(bot: bot, size: 28, state: .happy)
                    } else {
                        let name = ReactionChipsRow.name(actor, selfIds: selfIds)
                        PersonAvatar(initials: People.initials(name), size: 28)
                    }
                    Text(verbatim: ReactionChipsRow.name(actor, selfIds: selfIds))
                }
            }
            .navigationTitle(String(localized: "Reacted with \(chip.emoji)"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done", action: close) } }
        }
        .presentationDetents([.medium])
    }
}

/// "Add reaction": the quick eight, then any emoji from the keyboard.
struct AddReactionSheet: View {
    let mine: Set<String>
    let pick: (String) -> Void
    let close: () -> Void
    @State private var typed = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 4), spacing: 12) {
                        ForEach(ReactionRules.quick, id: \.self) { emoji in
                            Button { pick(emoji) } label: {
                                Text(verbatim: emoji)
                                    .font(.system(size: 30))
                                    .frame(maxWidth: .infinity, minHeight: 48)
                                    .background(mine.contains(emoji) ? Theme.accent.opacity(0.2) : .clear, in: RoundedRectangle(cornerRadius: 10))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(Text("React with \(emoji)"))
                        }
                    }
                    .padding(.vertical, 4)
                }
                Section {
                    TextField("Any emoji", text: $typed)
                        .focused($focused)
                        .font(.system(size: 28))
                        .onSubmit(submit)
                        .onValueChange(of: typed) { value in
                            if ReactionRules.emoji(from: value) != nil { submit() }
                        }
                } footer: {
                    Text("Type or pick one emoji from the keyboard.")
                }
            }
            .navigationTitle("Add reaction")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: close) } }
        }
        .presentationDetents([.medium])
    }

    private func submit() {
        guard let emoji = ReactionRules.emoji(from: typed) else { return }
        pick(emoji)
    }
}
