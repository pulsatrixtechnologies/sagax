// The coding session's side panel (desktop 1522091154, #2285): the
// "This session" card (status, duration, tokens) above the development
// pods, each a disclosure section with the panel's card. On the desktop it
// sits in the bot panel's Coding tab while the session window is open; the
// iPad draws it at the window's trailing edge (a sheet when too narrow).
import CompanionCore
import SwiftUI
import UIKit

enum CodingPanelStrings {
    static var title: String { String(localized: "This session") }
    static var status: String { String(localized: "Status") }
    static var duration: String { String(localized: "Duration") }
    static var tokens: String { String(localized: "Tokens") }
    static var toggle: String { String(localized: "Session details") }
}

/// What the panel reads, gathered by the coding chat.
struct CodingPanelInput {
    var item: BotActivityItem
    var detail: BotActivityDetail?
    var bot: Bot?
    var threadId: String?
    /// The task thread's raw messages (digests carry the tokens).
    var messages: [Message]
    var repo: String?
    var now: Date
}

struct CodingChatPanel: View {
    @Environment(\.themePalette) var themePalette
    let input: CodingPanelInput
    /// Scroll the transcript to a message.
    var showMessage: (String) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                CodingSessionCard(input: input)
                if let bot = input.bot {
                    CodingPodsStack(
                        bot: bot,
                        task: bot.tasks?.first { $0.threadId == input.threadId },
                        threadId: input.threadId,
                        messages: input.messages,
                        repo: input.repo,
                        showMessage: showMessage
                    )
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Theme.bg)
        .accessibilityIdentifier("coding.panel")
    }
}

// MARK: - Shared chrome

/// PANEL_LABEL: 13/18, tertiary ink.
private struct CodingPanelLabel: View {
    @Environment(\.themePalette) var themePalette
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Theme.font(13))
            .foregroundStyle(Theme.textTertiary)
            .lineLimit(1)
            .padding(.horizontal, 2)
    }
}

/// PANEL_CARD with its rows split by a weak hairline.
private struct CodingPanelCard<Content: View>: View {
    @Environment(\.themePalette) var themePalette
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private struct CodingPanelDivider: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.displayScale) private var displayScale
    var body: some View {
        Rectangle()
            .fill(Theme.hairline.opacity(0.6))
            .frame(height: 1 / max(displayScale, 1))
    }
}

/// A pod: an h2 with a chevron that folds its card (PodCard.tsx).
private struct CodingPodSection<Content: View>: View {
    @Environment(\.themePalette) var themePalette
    let id: String
    let title: String
    var trailing: String?
    var trailingTint: Color?
    @ViewBuilder let content: () -> Content

    @State private var open = true

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.easeOut(duration: 0.15)) { open.toggle() }
            } label: {
                HStack(spacing: 4) {
                    Text(verbatim: title)
                        .font(Theme.font(13))
                        .foregroundStyle(Theme.textTertiary)
                        .lineLimit(1)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(Theme.textTertiary)
                        .rotationEffect(.degrees(open ? 0 : -90))
                    Spacer(minLength: 8)
                    if let trailing {
                        Text(verbatim: trailing)
                            .font(Theme.font(12).monospacedDigit())
                            .foregroundStyle(trailingTint ?? Theme.textTertiary)
                    }
                }
                .padding(.horizontal, 2)
                .frame(minHeight: 18)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isHeader)
            .accessibilityValue(Text(verbatim: open ? String(localized: "Expanded") : String(localized: "Collapsed")))
            .accessibilityIdentifier("coding.pod.\(id).toggle")
            if open {
                CodingPanelCard(content: content)
                    .accessibilityIdentifier("coding.pod.\(id)")
            }
        }
    }
}

/// PANEL_ROW: px-3 py-2, 13/18.
private struct CodingPanelRow<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        HStack(spacing: 10) {
            content()
        }
        .font(Theme.font(13))
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - This session

struct CodingSessionCard: View {
    @Environment(\.themePalette) var themePalette
    let input: CodingPanelInput

    private var live: Bool { CodingChatRules.isLive(item: input.item, detail: input.detail) }

    var body: some View {
        let lead = CodingSessionRules.lead(item: input.item, detail: input.detail)
        let elapsed = CodingChatRules.elapsedLabel(item: input.item, detail: input.detail, nowMs: input.now.timeIntervalSince1970 * 1000)
        let tokens = CodingSessionRules.tokensLabel(input.messages)
        VStack(alignment: .leading, spacing: 8) {
            CodingPanelLabel(text: CodingPanelStrings.title)
                .accessibilityAddTraits(.isHeader)
            CodingPanelCard {
                row(CodingPanelStrings.status, id: "status") {
                    HStack(spacing: 6) {
                        Text(verbatim: CodingSessionRules.glyph(live: live))
                            .accessibilityHidden(true)
                        Text(verbatim: lead)
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .opacity(live ? 0.85 : 1)
                    }
                    .foregroundStyle(Theme.textPrimary)
                }
                CodingPanelDivider()
                row(CodingPanelStrings.duration, id: "duration") {
                    Text(verbatim: elapsed)
                        .monospacedDigit()
                        .foregroundStyle(Theme.textPrimary)
                }
                if let tokens {
                    CodingPanelDivider()
                    row(CodingPanelStrings.tokens, id: "tokens") {
                        Text(verbatim: tokens)
                            .monospacedDigit()
                            .foregroundStyle(Theme.textPrimary)
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("coding.session-card")
    }

    private func row<Value: View>(_ label: String, id: String, @ViewBuilder value: () -> Value) -> some View {
        let shown = value()
        return CodingPanelRow {
            Text(verbatim: label)
                .foregroundStyle(Theme.textSecondary)
                .layoutPriority(1)
            Spacer(minLength: 12)
            shown
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("coding.session.\(id)")
    }
}

// MARK: - Pods

/// The development pods in the desktop's order: Environment, Connectors,
/// Context, Changes, Background tasks, Outputs (DevPods.tsx).
struct CodingPodsStack: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    let task: BotTask?
    let threadId: String?
    let messages: [Message]
    let repo: String?
    var showMessage: (String) -> Void

    @EnvironmentObject private var session: Session
    @Environment(\.openURL) private var openURL
    @State private var servers: [MCPServerListing]?
    @State private var serversFailed = false
    @State private var allConnectors = false

    private var environment: DevEnvironment? {
        DevEnvironment.make(botComputer: bot.computer, taskSurface: task?.surface, botCwd: bot.cwd, messages: messages)
    }
    private var contextShare: DevContextShare? { DevContextShare(task?.usage) }
    private var outputs: [DevOutput] { DevPodSources.outputs(messages) }
    private var changes: [DevChange] { DevPodSources.changes(messages) }
    private var mounted: [MCPServerListing] { servers.map { AccessRules.mounted($0, own: bot.mcpServers) } ?? [] }

    private struct BackgroundTask: Identifiable {
        var threadId: String
        var title: String
        var state: String
        var elapsed: String?
        var live: Bool
        var id: String { threadId }
    }

    /// The parallel tasks started from this session's thread.
    private var background: [BackgroundTask] {
        guard let parent = threadId ?? task?.threadId else { return [] }
        let now = Date().timeIntervalSince1970 * 1000
        return (bot.tasks ?? []).compactMap { task -> BackgroundTask? in
            guard let link = task.parallelOf, link.threadId == parent else { return nil }
            let outcome = link.outcome ?? ""
            let done = outcome == "done" || outcome == "failed" || outcome == "stopped"
            let waiting = task.activity == "waiting-on-you"
            let state = done ? outcome : waiting ? "waiting" : (task.busy == true ? "running" : "queued")
            let live = state == "running" || state == "waiting" || state == "queued"
            let started = task.turnStartedAt ?? link.at
            let elapsed = live ? now - started : link.reportedAt.map { $0 - started }
            return BackgroundTask(threadId: task.threadId, title: task.title, state: state,
                                  elapsed: elapsed.flatMap { $0 > 0 ? Self.elapsed($0) : nil }, live: live)
        }
    }

    /// Minutes and seconds, as the pods sheet reads it (`formatElapsed`).
    private static func elapsed(_ ms: Double) -> String {
        let total = Int(min(max(0, ms / 1000), 1e9))
        let minutes = total / 60
        let seconds = total % 60
        return minutes > 0 ? "\(minutes)m \(String(format: "%02d", seconds))s" : "\(seconds)s"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            if let environment { environmentPod(environment) }
            connectorsPod
            if let contextShare { contextPod(contextShare) }
            if !changes.isEmpty { changesPod }
            if !background.isEmpty { tasksPod }
            if !outputs.isEmpty { outputsPod }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("coding.pods")
        .task(id: session.connection?.id) { await loadServers() }
    }

    // MARK: Environment

    private func environmentPod(_ data: DevEnvironment) -> some View {
        CodingPodSection(id: "environment", title: DevPodsStrings.environment) {
            if data.computer {
                CodingPanelRow {
                    Image(systemName: "desktopcomputer").foregroundStyle(Theme.textSecondary).frame(width: 16)
                    Text(verbatim: DevPodsStrings.place(data.place))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    if let state = data.state {
                        HStack(spacing: 6) {
                            Circle()
                                .fill(state == .ready ? Color.green : Color.orange)
                                .frame(width: 6, height: 6)
                            Text(state == .ready ? String(localized: "Ready") : String(localized: "Connecting"))
                                .font(Theme.font(12))
                                .foregroundStyle(Theme.textSecondary)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                .accessibilityIdentifier("coding.pod.environment.computer")
                CodingPanelDivider()
            }
            CodingPanelRow {
                Image(systemName: "folder").foregroundStyle(Theme.textSecondary).frame(width: 16)
                if let folder = data.folder {
                    Text(verbatim: DevPodSources.folderLabel(folder))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: 8)
                    copyMenu(DevPodsStrings.copyPath, value: folder, label: DevPodsStrings.folderActions)
                } else {
                    Text(verbatim: DevPodsStrings.ownFolder).foregroundStyle(Theme.textSecondary)
                    Spacer(minLength: 0)
                }
            }
            .accessibilityIdentifier("coding.pod.environment.folder")
            if let repo, !repo.isEmpty {
                CodingPanelDivider()
                CodingPanelRow {
                    Image(systemName: "square.stack.3d.up").foregroundStyle(Theme.textSecondary).frame(width: 16)
                    Text(verbatim: repo)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: 0)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text(verbatim: "\(DevPodsStrings.repository), \(repo)"))
                .accessibilityIdentifier("coding.pod.environment.repo")
            }
            if let branch = data.branch {
                CodingPanelDivider()
                CodingPanelRow {
                    Image(systemName: "arrow.triangle.branch").foregroundStyle(Theme.textSecondary).frame(width: 16)
                    Text(verbatim: branch)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .accessibilityLabel(Text(verbatim: "\(DevPodsStrings.branch), \(branch)"))
                    Spacer(minLength: 8)
                    copyMenu(DevPodsStrings.copyBranch, value: branch, label: DevPodsStrings.copyBranch)
                }
                .accessibilityIdentifier("coding.pod.environment.branch")
            }
        }
    }

    private func copyMenu(_ title: String, value: String, label: String) -> some View {
        Menu {
            Button { UIPasteboard.general.string = value } label: {
                Label(title, systemImage: "doc.on.doc")
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 24, height: 24)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(Text(verbatim: label))
    }

    // MARK: Connectors

    @ViewBuilder
    private var connectorsPod: some View {
        if serversFailed {
            CodingPodSection(id: "connectors", title: DevPodsStrings.connectors) {
                CodingPanelRow {
                    Text(verbatim: DevPodsStrings.connectorsFailed).foregroundStyle(Theme.textSecondary)
                    Spacer(minLength: 8)
                    Button(String(localized: "Retry")) { Task { await loadServers() } }
                        .buttonStyle(.borderless)
                        .accessibilityIdentifier("coding.pod.connectors.retry")
                }
            }
        } else if !mounted.isEmpty {
            let shown = allConnectors ? mounted : Array(mounted.prefix(DevPodsView.connectorsShown))
            CodingPodSection(id: "connectors", title: DevPodsStrings.connectors, trailing: "\(mounted.count)") {
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, server in
                    if index > 0 { CodingPanelDivider() }
                    CodingPanelRow {
                        Text(verbatim: String(server.name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Theme.textSecondary)
                            .frame(width: 18, height: 18)
                            .background(Theme.textSecondary.opacity(0.15), in: RoundedRectangle(cornerRadius: 5))
                        Text(verbatim: server.name)
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        if let auth = server.auth, auth != "connected", auth != "none" {
                            Text(verbatim: DevPodsStrings.authenticate)
                                .font(Theme.font(12))
                                .foregroundStyle(Color.orange)
                        }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("coding.pod.connector.\(server.name)")
                }
                if mounted.count > DevPodsView.connectorsShown {
                    CodingPanelDivider()
                    Button {
                        allConnectors.toggle()
                    } label: {
                        CodingPanelRow {
                            Text(allConnectors ? String(localized: "Show less") : String(localized: "Show more"))
                                .foregroundStyle(Theme.textSecondary)
                            Spacer(minLength: 0)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("coding.pod.connectors.more")
                }
            }
        }
    }

    private func loadServers() async {
        guard let client = session.profileClient else { return }
        do {
            servers = try await client.mcpServers().servers
            serversFailed = false
        } catch {
            if !Task.isCancelled { serversFailed = true }
        }
    }

    // MARK: Context

    private func contextPod(_ share: DevContextShare) -> some View {
        let tint: Color = share.tone == .quiet ? Theme.textTertiary : .orange
        let tokens = BotUsageTotal.formatTokens(share.tokens)
        let detail: String
        if let window = share.window, let percent = share.percent {
            detail = DevPodsStrings.contextOfWindow(tokens: tokens, percent: "\(percent)%", window: BotUsageTotal.formatTokens(window))
        } else {
            detail = DevPodsStrings.contextTokens(tokens)
        }
        return CodingPodSection(id: "context", title: DevPodsStrings.context, trailing: share.value, trailingTint: tint) {
            VStack(alignment: .leading, spacing: 8) {
                if let percent = share.percent {
                    ProgressView(value: Double(min(100, percent)), total: 100)
                        .tint(share.tone == .quiet ? Theme.textSecondary : .orange)
                        .accessibilityLabel(Text(verbatim: DevPodsStrings.context))
                }
                Text(verbatim: detail)
                    .font(Theme.font(12))
                    .foregroundStyle(Theme.textSecondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("coding.pod.context.detail")
        }
    }

    // MARK: Changes

    private var changesPod: some View {
        CodingPodSection(id: "changes", title: DevPodsStrings.changes, trailing: "\(changes.count)") {
            ForEach(Array(changes.enumerated()), id: \.element.id) { index, change in
                if index > 0 { CodingPanelDivider() }
                CodingPanelRow {
                    Image(systemName: change.kind == .pull ? "arrow.triangle.pull" : "smallcircle.filled.circle")
                        .foregroundStyle(Theme.textSecondary)
                        .frame(width: 16)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: change.title)
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(2)
                        Text(verbatim: change.whereLabel)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    Menu {
                        changeMenu(change)
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Theme.textSecondary)
                            .frame(width: 24, height: 24)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel(Text(verbatim: DevPodsStrings.moreActions(change.title)))
                }
                .contextMenu { changeMenu(change) }
                .accessibilityIdentifier("coding.pod.change.\(change.key)")
            }
        }
    }

    @ViewBuilder
    private func changeMenu(_ change: DevChange) -> some View {
        if let link = change.url, let url = URL(string: link) {
            Button { openURL(url) } label: { Label(String(localized: "Open"), systemImage: "arrow.up.right.square") }
            Button { UIPasteboard.general.string = link } label: { Label(String(localized: "Copy link"), systemImage: "link") }
        }
        Button {
            showMessage(change.messageId)
        } label: {
            Label(DevPodsStrings.showInConversation, systemImage: "text.bubble")
        }
        if let sha = change.sha {
            Button { UIPasteboard.general.string = sha } label: { Label(DevPodsStrings.copyCommit, systemImage: "doc.on.doc") }
        }
    }

    // MARK: Background tasks

    private func taskState(_ state: String) -> String {
        switch state {
        case "running": String(localized: "devPods.tasks.state.running", defaultValue: "Running")
        case "waiting": String(localized: "devPods.tasks.state.waiting", defaultValue: "Waiting")
        case "done": String(localized: "devPods.tasks.state.done", defaultValue: "Done")
        case "failed": String(localized: "devPods.tasks.state.failed", defaultValue: "Failed")
        case "stopped": String(localized: "devPods.tasks.state.stopped", defaultValue: "Stopped")
        default: String(localized: "devPods.tasks.state.queued", defaultValue: "Queued")
        }
    }

    private var tasksPod: some View {
        let finished = background.filter { ["done", "failed", "stopped"].contains($0.state) }.count
        return CodingPodSection(id: "tasks", title: DevPodsStrings.tasks, trailing: "\(background.count)") {
            ForEach(Array(background.enumerated()), id: \.element.id) { index, task in
                if index > 0 { CodingPanelDivider() }
                CodingPanelRow {
                    Text(verbatim: task.title)
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text(verbatim: [taskState(task.state), task.elapsed].compactMap { $0 }.joined(separator: " · "))
                        .font(Theme.font(12).monospacedDigit())
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                    if task.live {
                        Button {
                            Task { try? await session.profileClient?.stopParallelTask(botId: bot.id, threadId: task.threadId) }
                        } label: {
                            Image(systemName: "stop.fill")
                                .font(.system(size: 11))
                                .foregroundStyle(Theme.textSecondary)
                                .frame(width: 24, height: 24)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(verbatim: DevPodsStrings.stopTask))
                    }
                }
                .accessibilityIdentifier("coding.pod.task.\(task.threadId)")
            }
            if finished > 0 {
                CodingPanelDivider()
                CodingPanelRow {
                    Text(verbatim: DevPodsStrings.finished(finished))
                        .font(Theme.font(12))
                        .foregroundStyle(Theme.textSecondary)
                    Spacer(minLength: 0)
                }
                .accessibilityIdentifier("coding.pod.tasks.finished")
            }
        }
    }

    // MARK: Outputs

    private var outputsPod: some View {
        CodingPodSection(id: "outputs", title: DevPodsStrings.outputs, trailing: "\(outputs.count)") {
            ForEach(Array(outputs.enumerated()), id: \.element.id) { index, output in
                if index > 0 { CodingPanelDivider() }
                Button {
                    showMessage(output.messageId)
                } label: {
                    CodingPanelRow {
                        Image(systemName: output.kind == "image" ? "photo" : output.kind == "audio" ? "waveform" : "doc.text")
                            .foregroundStyle(Theme.textSecondary)
                            .frame(width: 16)
                        Text(verbatim: output.name)
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Theme.textTertiary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("coding.pod.output.\(output.name)")
            }
        }
    }
}
