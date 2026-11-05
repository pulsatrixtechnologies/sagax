// One stretch of a bot's work in the chat, the desktop's ActivityRun and
// StepRow (#488, #518): one quiet line, "Worked 15s", the duration only
// like "Thought 2s" in Grok, small grey words, no frame. The count of tools
// and failures is spoken by VoiceOver and seen once open. It opens on the steps in order,
// each on a row of the same kind; the same step repeated back to back reads
// once with a count ("Read a file ×3") and opens to each call; the server
// an MCP call went through is named. A settled turn's narration sits among
// the steps where it was written. While the bot still works the line says
// what it is doing now. The words are the desktop's (`StepLabel`).
import SwiftUI
import CompanionCore

extension StepWords {
    /// The app's catalog, in the language chosen in Settings.
    static var app: StepWords {
        let stored = UserDefaults.standard.string(forKey: PrefKey.language) ?? AppLanguage.system.rawValue
        let locale = AppLanguage.resolved(stored).locale ?? Locale.current
        return StepWords(locale: locale) { key in
            let value = AppStrings.localized(key)
            return value == key ? nil : value
        }
    }
}

struct StepRunRow: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let run: StepRun
    let chat: Chat
    let openLink: (URL, Message) -> OpenURLAction.Result
    var openThread: ((ThreadRef) -> Void)? = nil
    var revealedMessageId: String? = nil
    var scrollToMessage: ((String) -> Void)? = nil
    @State private var expanded = false

    private var nameOf: StepNameOf {
        let names = Dictionary(session.state.bots.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
        return { names[$0] }
    }

    var body: some View {
        let words = StepWords.app
        let steps = run.steps
        // One step on its own reads as that step, as the desktop's lone chip.
        if steps.count == 1, !run.narrated, let only = steps.first {
            StepMessageRow(message: only, words: words, nameOf: nameOf)
                .padding(.leading, 2)
        } else {
            group(words)
        }
    }

    private func group(_ words: StepWords) -> some View {
        let summary = StepGroup.summarize(run.messages)
        let line = StepGroup.words(summary, elapsed: run.elapsed, words: words, nameOf: nameOf)
        return VStack(alignment: .leading, spacing: 4) {
            Button {
                withAnimation(.easeOut(duration: 0.18)) { expanded.toggle() }
                Haptics.selection()
            } label: {
                StepLineLabel(
                    label: line.label, target: line.target, phase: line.phase,
                    expandable: true, expanded: expanded, quietChevron: true
                )
            }
            .buttonStyle(.plain)
            .accessibilityLabel(line.accessibility)
            .accessibilityIdentifier("step-group.\(run.turnId ?? run.messages[0].id)")

            if expanded {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(StepGroup.merge(run.messages, words: words, nameOf: nameOf)) { entry in
                        switch entry {
                        case let .message(message):
                            MessageRow(chat: chat, message: message, endsRun: message.id == run.messages.last(where: { !StepGroup.isStep($0) })?.id, openLink: openLink, openThread: openThread)
                                .id(message.id)
                                .onAppear {
                                    if revealedMessageId == message.id { scrollToMessage?(message.id) }
                                }
                        case let .steps(_, messages, label, target, phase, duration):
                            if messages.count == 1, let only = messages.first {
                                StepMessageRow(message: only, words: words, nameOf: nameOf)
                            } else {
                                StepRepeatRow(
                                    messages: messages, label: "\(label) ×\(messages.count)", target: target, phase: phase,
                                    duration: StepLabel.duration(duration, words: words), words: words, nameOf: nameOf
                                )
                            }
                        }
                    }
                }
                .padding(.leading, 10)
                .overlay(alignment: .leading) { Rectangle().fill(Theme.hairline.opacity(0.6)).frame(width: 1).padding(.leading, 4) }
                .transition(.opacity)
            }
        }
        .padding(.leading, 2)
        .onValueChange(of: revealedMessageId, initial: true) { id in
            if run.messages.contains(where: { $0.id == id }) { expanded = true }
        }
    }
}

/// The words of one step line: label, target, counts, duration, chevron.
struct StepLineLabel: View {
    @Environment(\.themePalette) var themePalette
    let label: String
    var target: String? = nil
    var phase: StepPhase = .done
    var duration: String? = nil
    var expandable = false
    var expanded = false
    /// The turn's line: a faint chevron until it is open (the desktop shows
    /// it on hover only; a phone has no hover).
    var quietChevron = false

    var body: some View {
        HStack(spacing: 6) {
            Text(verbatim: label)
                .foregroundStyle(phase == .failed ? Theme.danger.opacity(0.9) : Theme.textSecondary)
                .opacity(phase == .running ? 0.75 : 1)
                .lineLimit(1)
                .layoutPriority(2)
            if let target {
                Text(verbatim: target)
                    .foregroundStyle(Theme.textTertiary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            if let duration {
                Text(verbatim: duration).foregroundStyle(Theme.textTertiary.opacity(0.8)).monospacedDigit().fixedSize()
            }
            if phase == .running { ProgressView().controlSize(.mini) }
            if expandable {
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Theme.textTertiary)
                    .rotationEffect(.degrees(expanded ? 180 : 0))
                    .opacity(quietChevron && !expanded ? 0.45 : 1)
            }
        }
        .font(.system(size: 13))
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }
}

/// One tool step: its sentence, and on a tap what it acted on and what came back.
struct StepMessageRow: View {
    @Environment(\.themePalette) var themePalette
    let message: Message
    let words: StepWords
    let nameOf: StepNameOf
    @State private var open = false

    var body: some View {
        if let tool = message.tool {
            let reading = StepLabel.read(tool, words: words, nameOf: nameOf)
            let args = StepLabel.arguments(tool.input, words: words)
            let result = StepLabel.result(tool.output)
            VStack(alignment: .leading, spacing: 4) {
                // 2026-11-05 (visible roles): the Perspicax role after the step
                RoleStepLine(role: tool.role, words: words) {
                    Button {
                        withAnimation(.easeOut(duration: 0.15)) { open.toggle() }
                        Haptics.selection()
                    } label: {
                        StepLineLabel(
                            label: reading.label, target: reading.target, phase: StepPhase.of(tool),
                            duration: StepLabel.duration(tool.durationMs, words: words), expandable: true, expanded: open
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel([reading.label, reading.target].compactMap { $0 }.joined(separator: ", "))
                    .accessibilityIdentifier("step.\(message.id)")
                }
                if open {
                    StepDetail(toolName: tool.name, args: args, result: result, words: words, autoApproval: tool.autoApproval)
                }
            }
        }
    }
}

/// The same step repeated back to back: one row with a count that opens to each call.
struct StepRepeatRow: View {
    let messages: [Message]
    let label: String
    let target: String?
    let phase: StepPhase
    let duration: String?
    let words: StepWords
    let nameOf: StepNameOf
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // the repeated calls share one role (StepGroup.merge splits on a change)
            RoleStepLine(role: messages[0].tool?.role, words: words) {
                Button {
                    withAnimation(.easeOut(duration: 0.15)) { open.toggle() }
                    Haptics.selection()
                } label: {
                    StepLineLabel(label: label, target: target, phase: phase, duration: duration, expandable: true, expanded: open)
                }
                .buttonStyle(.plain)
                .accessibilityLabel([label, target].compactMap { $0 }.joined(separator: ", "))
                .accessibilityIdentifier("step-repeat.\(messages[0].id)")
            }
            if open {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(messages, id: \.id) { StepMessageRow(message: $0, words: words, nameOf: nameOf) }
                }
                .padding(.leading, 10)
            }
        }
    }
}

/// What a step was given and the first lines of what it returned.
struct StepDetail: View {
    @Environment(\.themePalette) var themePalette
    let toolName: String
    let args: [(key: String, value: String)]
    let result: (text: String, cut: Bool)?
    let words: StepWords
    /// 2026-10-28: what answered the call's ask with no card; here only,
    /// never on the step's line.
    var autoApproval: ToolAutoApproval? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let autoApproval {
                Text(verbatim: words.t("step.detail.approval")).font(.caption2.weight(.semibold)).foregroundStyle(Theme.textTertiary)
                Text(verbatim: words.t("approval.auto.\(AutoApprovalReason.of(source: autoApproval.source).rawValue)"))
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("step-auto-approval")
            }
            // the technical id lives here only, never on the folded line
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(verbatim: words.t("step.detail.tool")).font(.caption2.weight(.semibold)).foregroundStyle(Theme.textTertiary)
                Text(verbatim: toolName)
                    .font(Theme.mono(12))
                    .foregroundStyle(Theme.textSecondary)
                    .textSelection(.enabled)
            }
            if !args.isEmpty {
                Text(verbatim: words.t("step.detail.arguments")).font(.caption2.weight(.semibold)).foregroundStyle(Theme.textTertiary)
                ForEach(Array(args.enumerated()), id: \.offset) { _, pair in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(verbatim: pair.key).foregroundStyle(Theme.textTertiary)
                        Text(verbatim: pair.value).foregroundStyle(Theme.textSecondary).textSelection(.enabled)
                    }
                    .font(Theme.mono(12))
                }
            }
            if let result {
                Text(verbatim: words.t("step.detail.result")).font(.caption2.weight(.semibold)).foregroundStyle(Theme.textTertiary)
                Text(verbatim: result.text)
                    .font(Theme.mono(12))
                    .foregroundStyle(Theme.textSecondary)
                    .textSelection(.enabled)
            }
        }
        .padding(.leading, 10)
        .padding(.vertical, 4)
        .frame(maxWidth: 520, alignment: .leading)
        .overlay(alignment: .leading) { Rectangle().fill(Theme.hairline.opacity(0.6)).frame(width: 1).padding(.leading, 2) }
    }
}
