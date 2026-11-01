// The composer's power features on the chat screen (feature parity package
// WP3), each as the desktop's Composer.tsx does it: the "/" menu filled from
// the engine, "@" and "#" suggestions, the busy-send choice, Retry for a
// failed send, Steer for held sends, pasted images and long pastes, Compact,
// and Stop in a room. The rules live in CompanionCore (ComposerCommands,
// ComposerSuggestions, ComposerSend); the strips in Composer/*.
import SwiftUI
import CompanionCore
import UIKit

extension ChatView {
    // MARK: - The "/" menu

    /// The slash token the menu completes: at the draft's start, after a
    /// leading `@Bot ` in a room, or the "+" sheet's menu on any draft.
    var slashContext: (trigger: ComposerSlashTrigger, roomBotId: String?)? {
        if power.commandMenuDismissed { return nil }
        if power.commandMenuForced { return (ComposerSlashTrigger(query: "", start: 0, end: 0), nil) }
        switch current {
        case .bot:
            return ComposerSlashTrigger.at(draft).map { ($0, nil) }
        case let .room(room):
            if room.dm == true { return ComposerSlashTrigger.at(draft).map { ($0, nil) } }
            return RoomCommandRouting.slash(draft, members: roomCommandMembers(room)).map { ($0.trigger, $0.botId) }
        }
    }

    func roomCommandMembers(_ room: Room) -> [RoomCommandMember] {
        room.memberIds.compactMap { id in session.state.bot(id) }
            .map { RoomCommandMember(id: $0.id, name: $0.name, hidden: $0.hidden == true) }
    }

    /// The bots whose engine lists the menu shows (`groupCommandTargets`).
    var commandTargets: [(member: RoomCommandMember, mention: Bool)] {
        guard let context = slashContext, session.surfaceGate.allows(.engineCommands) else { return [] }
        switch current {
        case let .bot(bot):
            return [(RoomCommandMember(id: bot.id, name: bot.name), false)]
        case let .room(room):
            guard room.dm != true else { return [] }
            return RoomCommandRouting.targets(botId: context.roomBotId, members: roomCommandMembers(room), defaultResponder: room.defaultResponder)
        }
    }

    var slashMenuItems: [ComposerMenuItem] {
        guard let context = slashContext else { return [] }
        let query = context.trigger.query
        let supportsAgents = { (bot: Bot?) in power.abilities(bot?.modelSelection.instanceId)?.agentsMcp == true }
        switch current {
        case let .bot(bot):
            let sagax = SagaxSlashCommand.offered(
                isRoom: false, isDM: false, skillAuthoring: power.skillAuthoring,
                supportsAgents: supportsAgents(session.state.bot(bot.id) ?? bot)
            )
            let engine = session.surfaceGate.allows(.engineCommands)
                ? power.commands(botId: bot.id, threadId: bot.threadId)?.commands ?? []
                : []
            // the bot's own commands (`useSlashSkills`): a 1:1 chat only, as
            // in a room a command would reach several bots
            return ComposerCommandMenu.items(
                sagax: sagax, sagaxDescription: ComposerCommandMenuView.description,
                skills: power.skills(botId: bot.id), engine: engine, query: query
            )
        case let .room(room):
            let members = room.memberIds.compactMap { session.state.bot($0) }
            let sagax = SagaxSlashCommand.offered(
                isRoom: true, isDM: room.dm == true, skillAuthoring: power.skillAuthoring,
                supportsAgents: members.contains { supportsAgents($0) }
            )
            let sets = commandTargets.map { target in
                ComposerCommandMenu.RoomEngineCommands(
                    bot: .init(id: target.member.id, name: target.member.name),
                    commands: power.commands(botId: target.member.id, threadId: room.threadId, groupId: room.id)?.commands ?? [],
                    mention: target.mention
                )
            }
            return ComposerCommandMenu.roomItems(
                sagax: context.roomBotId == nil ? sagax : [],
                sagaxDescription: ComposerCommandMenuView.description, sets: sets, query: query
            )
        }
    }

    /// Changes when the menu needs other lists: opened, another thread, or
    /// a leading mention naming another bot.
    var commandLoadKey: String? {
        guard slashContext != nil else { return nil }
        return "\(threadId)|\(commandTargets.map(\.member.id).joined(separator: ","))"
    }

    func loadCommands(refresh: Bool = false) async {
        guard slashContext != nil else { return }
        let ids = commandTargets.map(\.member.id)
        switch current {
        case let .bot(bot):
            async let skills: Void = power.loadSkills(botId: bot.id, session: session)
            await power.load(botIds: ids, threadId: bot.threadId, groupId: nil, refresh: refresh, session: session)
            await skills
        case let .room(room):
            await power.load(botIds: ids, threadId: room.threadId, groupId: room.id, refresh: refresh, session: session)
        }
    }

    /// `pickCommand`: the row's insertion replaces the slash token. A room's
    /// /goal goes in as typed text, which sends as a goal.
    func pickCommand(_ item: ComposerMenuItem) {
        guard let context = slashContext, var insertion = item.insertion else { return }
        if case .sagax(.goal) = item.kind { insertion = "/goal " }
        power.commandMenuForced = false
        draft = context.trigger.replacing(in: draft, with: insertion)
        composerFocused = true
    }

    func closeCommandMenu() {
        withAnimation(.snappy(duration: 0.2)) {
            power.commandMenuForced = false
            power.commandMenuDismissed = true
            if draft == "/" { draft = "" }
        }
    }

    /// "+" > Slash commands: "/" in an empty draft, else the menu over it.
    func openCommandMenu() {
        power.commandMenuDismissed = false
        if draft.isEmpty {
            draft = "/"
        } else if ComposerSlashTrigger.at(draft) == nil {
            power.commandMenuForced = true
        }
        composerFocused = true
    }

    // MARK: - "@" and "#"

    var suggestionItems: [SuggestionStrip.Item] {
        guard slashContext == nil, session.surfaceGate.allows(.composerSuggestions) else { return [] }
        let mention = MentionQuery.at(draft)
        let thread = ThreadRefQuery.at(draft)
        if let mention, mention.start >= (thread?.start ?? -1) {
            let pool = MentionSuggestions.pool(for: current, bots: session.state.bots, people: PersonMentions.people(in: current, session: session))
            return MentionSuggestions.choices(pool, query: mention.query).map(SuggestionStrip.Item.mention)
        }
        if let thread {
            let shownBot = current.id
            return ThreadRefSuggestions.choices(
                session.threadRefCandidates, query: thread.query,
                currentBotId: shownBot, currentThreadId: threadId
            ).map { SuggestionStrip.Item.thread($0, showsBot: $0.botId != shownBot) }
        }
        return []
    }

    func pickSuggestion(_ item: SuggestionStrip.Item) {
        switch item {
        case let .mention(choice):
            guard let query = MentionQuery.at(draft) else { return }
            draft = query.completing(draft, with: choice)
        case let .thread(thread, _):
            guard let query = ThreadRefQuery.at(draft) else { return }
            draft = query.completing(draft, with: thread)
        }
        composerFocused = true
    }

    // MARK: - Draft changes

    /// Every edit reopens a menu put away for the previous text (the
    /// desktop clears its dismissal on change), and a long block inserted
    /// in one edit (the field's own paste) becomes a chip.
    func draftChanged(from old: String, to new: String) {
        // Only a keystroke that changes the strips above the field animates,
        // and only those changes: the field itself follows the typing as is.
        let reopensMenu = power.commandMenuDismissed
        let unforcesMenu = power.commandMenuForced && new.hasPrefix("/")
        if reopensMenu || unforcesMenu {
            withAnimation(.snappy(duration: 0.2)) {
                if reopensMenu { power.commandMenuDismissed = false }
                if unforcesMenu { power.commandMenuForced = false }
            }
        }
        if power.pasteCheckSuppressed {
            power.pasteCheckSuppressed = false
            return
        }
        guard composerFocused, !dictation.isListening, !dictation.isStarting,
              session.surfaceGate.allows(.pasteAttachment),
              let paste = PastedText.detect(old: old, new: new)
        else { return }
        withAnimation(.snappy(duration: 0.2)) {
            power.add(PastedText(text: paste.pasted), threadId: threadId)
        }
        draft = paste.remaining
    }

    /// "Display in chat box": the chip's words back into the field.
    func displayPaste(_ paste: PastedText) {
        let next = PastedText.appending(paste.text, to: draft)
        power.remove(paste, threadId: threadId)
        // not a paste: the person asked for these words in the field
        power.pasteCheckSuppressed = true
        draft = next
    }

    // MARK: - Paste

    /// "+" > Paste: the copied image(s) as attachments, a long text as a
    /// chip, a short one into the field (Composer.tsx `handlePaste`).
    func pasteFromClipboard() {
        let board = UIPasteboard.general
        if board.hasImages {
            let images = board.images ?? []
            guard !images.isEmpty else {
                attachmentError = String(localized: "Could not read the clipboard image. Try attaching the image file instead.")
                return
            }
            addPastedImages(images.compactMap { $0.pngData() })
            return
        }
        guard let text = board.string, !text.isEmpty else {
            attachmentError = String(localized: "There is nothing to paste.")
            return
        }
        if PastedText.isLong(text) {
            power.add(PastedText(text: text), threadId: threadId)
        } else {
            power.pasteCheckSuppressed = true
            draft += text
        }
    }

    func addPastedImages(_ images: [Data]) {
        guard !images.isEmpty else { return }
        let existing = attachments
        var added: [PendingMessageAttachment] = []
        do {
            for (index, data) in images.enumerated() {
                let candidate = PendingMessageAttachment(
                    data: data,
                    name: images.count == 1 ? "Pasted image.png" : "Pasted image \(index + 1).png",
                    mime: "image/png",
                    kind: .image
                )
                try AttachmentPolicy.validate(existing + added + [candidate], sharedHost: session.surfaceGate.organization)
                added.append(candidate)
            }
            attachments.append(contentsOf: added)
            attachmentError = nil
            Haptics.selection()
        } catch {
            attachmentError = error.localizedDescription
        }
    }

    // MARK: - Failed sends

    func retry(_ failure: FailedSend) {
        guard !power.retrying.contains(failure.id), current.threadId == failure.threadId else { return }
        if activeSendBlock != nil { sendBlockTick += 1; return }
        power.retrying.insert(failure.id)
        let chat = current
        Task {
            let sent = await session.send(text: failure.requestText, attachments: failure.attachments, to: chat, options: failure.options)
            power.retrying.remove(failure.id)
            guard sent else {
                if let index = power.failed[failure.threadId]?.firstIndex(where: { $0.id == failure.id }) {
                    power.failed[failure.threadId]?[index].error = session.actionError ?? String(localized: "Couldn't send this message. Try again.")
                }
                session.actionError = nil
                return
            }
            power.forget(failure)
            // The words were still in the field (the phone keeps a failed
            // draft); they are sent now, so they leave it.
            if threadId == failure.threadId,
               draft.trimmingCharacters(in: .whitespacesAndNewlines) == failure.text.trimmingCharacters(in: .whitespacesAndNewlines),
               attachments.map(\.id) == failure.attachments.map(\.id) {
                draft = ""
                attachments = []
                if replyTo?.id == failure.replyToId { replyTo = nil }
            }
            SoundEffects.playSent()
            Haptics.impact(.medium)
        }
    }

    // MARK: - Held sends

    /// Whether the engine running this thread's turn takes words live. Nil
    /// until the engine list is read; the steer route then decides.
    var canSteerLive: Bool? {
        let instanceId: String?
        switch current {
        case let .bot(bot): instanceId = bot.modelSelection.instanceId
        case let .room(room): instanceId = room.busyBotId.flatMap { session.state.bot($0)?.modelSelection.instanceId }
        }
        return power.abilities(instanceId)?.queueing
    }

    var canSteerHeld: Bool {
        session.surfaceGate.allows(.queueSteer)
            && QueueSteer.available(busy: current.busy, queued: heldSends.count, approvalPending: hasPendingApproval)
    }

    func steerHeld() {
        guard let head = heldSends.first, !power.steering.contains(threadId) else { return }
        let thread = threadId
        let chat = current
        let live = canSteerLive
        power.steering.insert(thread)
        Haptics.selection()
        Task {
            await session.steerQueued(head, threadId: thread, in: chat, canSteer: live)
            power.steering.remove(thread)
        }
    }
}
