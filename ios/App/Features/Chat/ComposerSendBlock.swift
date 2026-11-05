// The one line above the composer while the bot cannot answer this person
// (CompanionCore SendState.swift; desktop src/lib/send-state.ts and
// src/components/ComposerSendBlock.tsx): the reason and the one thing to do.
// Send is refused while it shows and the draft stays in the field; the
// line goes by itself once a check says the bot can answer again.
import SwiftUI
import CompanionCore

extension ChatView {
    /// What the send state is asked for: this bot, this thread, its model.
    /// Nil in a room.
    var sendBlockScope: String? {
        guard case let .bot(bot) = current else { return nil }
        return SendBlockState.scope(botId: bot.id, threadId: bot.threadId, model: bot.modelSelection)
    }

    /// The block for the conversation on screen, or nil.
    var activeSendBlock: SendBlock? { sendBlockState.block(for: sendBlockScope) }

    /// A new scope, or a request to ask again, restarts the checks.
    var sendBlockTaskKey: String { "\(sendBlockScope ?? "")#\(sendBlockTick)" }

    /// Ask once, then every 15 s while blocked. Any failure is "not blocked"
    /// (CompanionClient.sendState never throws).
    func runSendStateChecks() async {
        let scope = sendBlockScope
        guard let scope, case let .bot(bot) = current, let client = session.settingsClient else {
            sendBlockState.record(nil, for: scope)
            return
        }
        while !Task.isCancelled {
            let answer = await client.sendState(botId: bot.id, threadId: bot.threadId)
            guard !Task.isCancelled else { return }
            withAnimation(.snappy(duration: 0.2)) { sendBlockState.record(answer, for: scope) }
            guard let delay = sendBlockState.recheckDelay(for: scope) else { return }
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
        }
    }

    /// "Connect <engine>": the engines settings where the app has them (the
    /// iPad's Settings > Models and voice), the settings sheet on a phone.
    func connectSendBlockEngine() {
        dictation.stop()
        composerFocused = false
        if let desktopChat {
            desktopChat.openEngines()
        } else {
            showingEngineSettings = true
        }
    }

    @ViewBuilder
    var sendBlockLine: some View {
        if let block = activeSendBlock {
            ComposerSendBlockLine(
                block: block,
                connect: { connectSendBlockEngine() },
                retry: { sendBlockTick += 1 },
                switchEngine: {
                    dictation.stop()
                    composerFocused = false
                    choosingEngineForLimit = true
                }
            )
            .transition(.opacity)
        }
    }
}

struct ComposerSendBlockLine: View {
    let block: SendBlock
    let connect: () -> Void
    let retry: () -> Void
    var switchEngine: () -> Void = {}

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "exclamationmark.circle")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .accessibilityHidden(true)
            Text(Self.text(block))
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(Self.actionLabel(block)) {
                Haptics.selection()
                switch block.action {
                case .connect: connect()
                case .switchEngine: switchEngine()
                case .retry: retry()
                }
            }
            .font(.system(size: 13, weight: .semibold))
            .buttonStyle(.borderless)
            .accessibilityIdentifier("composer-send-block-action")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("composer-send-block")
    }

    /// The line, in the reader's language (desktop `sendBlock.*`).
    static func text(_ block: SendBlock) -> String {
        switch block.reason {
        case .engineNotConnected?:
            let engine = block.engineName
            return String(localized: "\(engine) is not connected for you. Connect \(engine) to talk to this bot.")
        case .computerOffline?:
            return String(localized: "The computer that serves this bot's local model is offline or asleep. Open Sagax on it, then try again.")
        case .localServerOffline?:
            return String(localized: "The local model is not responding: its server on that computer is stopped. Start it, then try again.")
        case .ownerComputerOffline?:
            if let owner = block.name, !owner.isEmpty {
                return String(localized: "\(owner)'s computer, which serves this bot's model, is offline. Try again once it is back.")
            }
            return String(localized: "The bot owner's computer, which serves this bot's model, is offline. Try again once it is back.")
        case .engineLimit?:
            let engine = block.engineName
            if block.limitCause == "credits" {
                return String(localized: "\(engine) is out of credit")
            }
            if let resetsAt = block.resetsAt, resetsAt > Date() {
                // the reader's own clock and time zone, never UTC
                let time = resetsAt.formatted(date: Calendar.current.isDateInToday(resetsAt) ? .omitted : .abbreviated, time: .shortened)
                return String(localized: "\(engine) limit reached, back at \(time)")
            }
            return String(localized: "\(engine) limit reached")
        case nil:
            return block.message
        }
    }

    /// The action button's label.
    static func actionLabel(_ block: SendBlock) -> String {
        if case let .connect(_, engine) = block.action {
            return String(localized: "Connect \(engine)")
        }
        if case .switchEngine = block.action {
            return String(localized: "Switch engine")
        }
        return String(localized: "Try again")
    }
}
