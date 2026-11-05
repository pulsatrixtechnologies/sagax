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
        sendBlockFixError = nil
        // UI captures: a fixed advisory line, no server to ask
        if let preview = ComposerSendBlockLine.previewBlock {
            sendBlockState.record(scope == nil ? nil : preview, for: scope)
            return
        }
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

    /// "Try again" on an advisory refusal (#2013): the conversation's last
    /// user message goes again, as Retry does.
    func resendAfterRefusal() {
        guard case let .bot(bot) = current else { return }
        dictation.stop()
        withAnimation(.snappy(duration: 0.2)) { sendBlockState.record(nil, for: sendBlockScope) }
        Task { await session.regenerate(for: bot) }
    }

    /// "Fix" (#2013): Sagax repairs the cause, applies the state it answers,
    /// then sends the last user message again.
    func fixSendBlock(_ fix: String) {
        guard case let .bot(bot) = current, let client = session.settingsClient else { return }
        let scope = sendBlockScope
        dictation.stop()
        Task {
            guard let answer = await client.fixSendState(botId: bot.id, threadId: bot.threadId, fix: fix) else {
                sendBlockFixError = String(localized: "Sagax could not fix it. Try again.")
                return
            }
            sendBlockFixError = nil
            withAnimation(.snappy(duration: 0.2)) { sendBlockState.record(answer.block, for: scope) }
            guard answer.ok else {
                sendBlockFixError = String(localized: "Sagax could not fix it. Try again.")
                return
            }
            await session.regenerate(for: bot)
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
                },
                resend: { resendAfterRefusal() },
                fix: { fixSendBlock($0) },
                fixError: sendBlockFixError
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
    var resend: () -> Void = {}
    var fix: (String) -> Void = { _ in }
    var fixError: String?

    @State private var showingDetails = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: block.isAdvisory ? "info.circle" : "exclamationmark.circle")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityHidden(true)
                Text(Self.text(block))
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if Self.details(block) != nil {
                    Button(showingDetails ? String(localized: "Hide details") : String(localized: "Details")) {
                        Haptics.selection()
                        withAnimation(.snappy(duration: 0.2)) { showingDetails.toggle() }
                    }
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier("composer-send-block-details")
                }
                Button(Self.actionLabel(block)) {
                    Haptics.selection()
                    switch block.action {
                    case .connect: connect()
                    case .switchEngine: switchEngine()
                    case .retry: retry()
                    case .resend: resend()
                    case let .fix(id): fix(id)
                    }
                }
                .font(.system(size: 13, weight: .semibold))
                .buttonStyle(.borderless)
                .accessibilityIdentifier("composer-send-block-action")
            }
            if showingDetails, let details = Self.details(block) {
                // the engine's own words, as it said them
                Text(verbatim: details)
                    .font(.system(size: 12).monospaced())
                    .foregroundStyle(Theme.textSecondary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, 21)
                    .transition(.opacity)
                    .accessibilityIdentifier("composer-send-block-cause")
            }
            if let fixError {
                Text(verbatim: fixError)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.warning)
                    .padding(.leading, 21)
            }
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
        case .engineRefused?:
            let engine = block.engineName
            if block.refusal?.kind == "config_conflict" {
                return String(localized: "\(engine) has its own settings that conflict with this bot's tools. Nothing was sent.")
            }
            return String(localized: "\(engine) could not start this turn. Nothing was sent.")
        case .engineSignedOut?:
            let engine = block.engineName
            return String(localized: "\(engine) needs you to sign in again.")
        case nil:
            return block.message
        }
    }

    /// The action button's label.
    static func actionLabel(_ block: SendBlock) -> String {
        // a sign-in that expired: the engine settings, as Sign in
        if block.reason == .engineSignedOut, case .connect = block.action {
            return String(localized: "Sign in")
        }
        if case .fix = block.action {
            return String(localized: "Fix")
        }
        if case .connect(_, let engine) = block.action {
            return String(localized: "Connect \(engine)")
        }
        if case .switchEngine = block.action {
            return String(localized: "Switch engine")
        }
        return String(localized: "Try again")
    }
}

extension ComposerSendBlockLine {
    /// The engine's own words behind an advisory refusal, for Details.
    static func details(_ block: SendBlock) -> String? {
        guard let cause = block.refusal?.cause.trimmingCharacters(in: .whitespacesAndNewlines), !cause.isEmpty else { return nil }
        return cause
    }

    /// `-send-block-preview <fix|resend|signed-out>`: a fixed advisory line
    /// for the UI captures (with `-store-preview`).
    static var previewBlock: SendBlock? {
        let arguments = ProcessInfo.processInfo.arguments
        guard arguments.contains("-store-preview"), let flag = arguments.firstIndex(of: "-send-block-preview"),
              arguments.indices.contains(flag + 1) else { return nil }
        let cause = "Codex has an MCP server outside the selected configuration. Disable native MCP entries for this account before using tool selection."
        switch arguments[flag + 1] {
        case "resend":
            return SendBlock(reasonCode: "engine_refused", message: "", action: .resend, name: "Codex", advisory: true,
                             refusal: .init(kind: "engine_not_ready", cause: "Codex rejected its configuration as invalid."))
        case "signed-out":
            return SendBlock(reasonCode: "engine_signed_out", message: "", action: .connect(instanceId: "codex", engine: "Codex"), name: "Codex",
                             advisory: true, refusal: .init(kind: "signed_out", cause: "Codex sign-in expired."))
        default:
            return SendBlock(reasonCode: "engine_refused", message: "", action: .fix("codex_native_mcp"), name: "Codex", advisory: true,
                             refusal: .init(kind: "config_conflict", cause: cause))
        }
    }
}

/// A failed turn the engine refused before any prompt went out, in a room
/// (#2013): a quiet line, never the red error row. A 1:1 chat does not draw
/// it at all (the composer says it there).
struct PreSendRefusalLine: View {
    let kind: PreSendRefusalKind

    var body: some View {
        Label {
            Text(Self.text(kind))
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "info.circle")
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 2)
    }

    static func text(_ kind: PreSendRefusalKind) -> String {
        switch kind {
        case .engineLimit: String(localized: "The engine is at its limit. Nothing was sent.")
        case .signedOut: String(localized: "The engine needs a new sign-in. Nothing was sent.")
        case .configConflict: String(localized: "The engine's own settings conflict with this bot's tools. Nothing was sent.")
        case .engineNotReady: String(localized: "The engine could not start this turn. Nothing was sent.")
        }
    }
}
