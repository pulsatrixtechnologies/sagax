import CompanionCore
import SwiftUI
import UIKit

// Development context pods on the phone and the iPad (desktop #618,
// src/components/dev-pods/): Settings > Experimental turns them on (off by
// default, on this device only, like the desktop's switch); while the
// conversation looks like development work (DevDetector, with its
// hysteresis) a button in the chat's header opens the same pods:
// Environment, Context, Connectors, Outputs, Changes. A sheet on the iPhone,
// an inspector on the iPad (a sheet before iOS 17). Read only: existing
// data, no server write, no new route. A pod with nothing to say is hidden.

enum DevPodsPrefs {
    /// Settings > Experimental, this device only (the desktop keeps its
    /// switch in local storage too).
    static let enabled = "companion.prefs.devPods"
}

/// The header button's label, shared by the phone and the iPad headers.
enum DevPodsStrings {
    static var title: String { String(localized: "devPods.rail", defaultValue: "Development context") }
    static var show: String { String(localized: "devPods.toggle.show", defaultValue: "Show development context") }
    static var environment: String { String(localized: "devPods.environment.title", defaultValue: "Environment") }
    static var context: String { String(localized: "devPods.context.title", defaultValue: "Context") }
    static var connectors: String { String(localized: "devPods.connectors.title", defaultValue: "Connectors") }
    static var outputs: String { String(localized: "devPods.outputs.title", defaultValue: "Outputs") }
    static var changes: String { String(localized: "devPods.changes.title", defaultValue: "Changes") }
    static var tasks: String { String(localized: "devPods.tasks.title", defaultValue: "Background tasks") }
    static func finished(_ count: Int) -> String {
        String(localized: "devPods.tasks.finished", defaultValue: "{count} finished").replacingOccurrences(of: "{count}", with: String(count))
    }
    static var stopTask: String { String(localized: "Stop this task") }
    static var ownFolder: String { String(localized: "devPods.environment.ownFolder", defaultValue: "Its own folder") }
    static var branch: String { String(localized: "devPods.environment.branch", defaultValue: "Branch") }
    static var repository: String { String(localized: "devPods.environment.repository", defaultValue: "Repository") }
    static var copyPath: String { String(localized: "devPods.environment.copyPath", defaultValue: "Copy path") }
    static var copyBranch: String { String(localized: "devPods.environment.copyBranch", defaultValue: "Copy branch name") }
    static var folderActions: String { String(localized: "devPods.environment.folderMenu", defaultValue: "Folder actions") }
    static var computerSettings: String { String(localized: "devPods.environment.settings", defaultValue: "Computer settings") }
    static var showInConversation: String { String(localized: "devPods.changes.show", defaultValue: "Show in conversation") }
    static var copyCommit: String { String(localized: "devPods.changes.copySha", defaultValue: "Copy commit ID") }
    static var empty: String { String(localized: "devPods.empty", defaultValue: "Nothing to show yet. The pods fill in as the bot works.") }
    static var connectorsFailed: String { String(localized: "devPods.connectors.error", defaultValue: "Connectors could not load.") }
    static var authenticate: String { String(localized: "devPods.connectors.authenticate", defaultValue: "Authenticate") }
    static var settingTitle: String { String(localized: "devPods.setting.title", defaultValue: "Development context pods") }
    static var settingDetail: String {
        String(localized: "devPods.setting.detail", defaultValue: "Off by default. When a bot works as a developer, a button in the conversation shows its environment, context, connectors, files and changes.")
    }
    static func moreActions(_ title: String) -> String {
        String(localized: "devPods.changes.more", defaultValue: "More actions for \(title)")
    }
    static func contextOfWindow(tokens: String, percent: String, window: String) -> String {
        String(localized: "devPods.context.ofWindow", defaultValue: "Context \(tokens) (\(percent) of \(window))")
    }
    static func contextTokens(_ tokens: String) -> String {
        String(localized: "devPods.context.tokens", defaultValue: "Context \(tokens)")
    }

    static func place(_ place: String) -> String {
        switch place {
        case "cloud": String(localized: "Cloud computer")
        case "vm": String(localized: "Local VM")
        case "local": String(localized: "This computer")
        case "browser": String(localized: "Browser")
        case "off": String(localized: "Off")
        default: String(localized: "Auto")
        }
    }
}

/// What the pods read, gathered by the chat (nothing here observes the session).
struct DevPodsInput {
    var bot: Bot
    var task: BotTask?
    var messages: [Message]
}

/// The pods, stacked as list sections in the desktop's order.
struct DevPodsView: View {
    let input: DevPodsInput
    /// The bot panel's computer tab (the desktop's gear to Works on).
    var openComputer: (() -> Void)?
    /// Scroll the conversation to a message.
    var showMessage: (String) -> Void
    var close: () -> Void

    @EnvironmentObject private var session: Session
    @Environment(\.openURL) private var openURL
    @State private var servers: [MCPServerListing]?
    @State private var serversFailed = false
    @State private var allConnectors = false
    /// owner/name of the folder's repository, from the bot's activity. Nil
    /// until it loads, and when the server has none.
    @State private var repo: String?

    static let connectorsShown = 3

    private var environment: DevEnvironment? {
        DevEnvironment.make(botComputer: input.bot.computer, taskSurface: input.task?.surface, botCwd: input.bot.cwd, messages: input.messages)
    }
    private var contextShare: DevContextShare? { DevContextShare(input.task?.usage) }
    private var outputs: [DevOutput] { DevPodSources.outputs(input.messages) }
    private var changes: [DevChange] { DevPodSources.changes(input.messages) }

    /// The parallel tasks of this conversation (the same ones its cards show).
    private struct BackgroundTask: Identifiable {
        var threadId: String
        var title: String
        var state: String
        var elapsed: String?
        var live: Bool
        var id: String { threadId }
    }

    private var background: [BackgroundTask] {
        let threadId = input.task?.threadId ?? input.bot.threadId
        let now = Date().timeIntervalSince1970 * 1000
        return (input.bot.tasks ?? []).compactMap { task -> BackgroundTask? in
            guard let link = task.parallelOf, link.threadId == threadId else { return nil }
            let done = link.outcome == "done" || link.outcome == "failed" || link.outcome == "stopped"
            let waiting = task.activity == "waiting-on-you"
            let state = done ? link.outcome! : waiting ? "waiting" : (task.busy == true ? "running" : "queued")
            let live = state == "running" || state == "waiting" || state == "queued"
            let started = task.turnStartedAt ?? link.at
            let elapsed = live ? now - started : link.reportedAt.map { $0 - started }
            return BackgroundTask(threadId: task.threadId, title: task.title, state: state, elapsed: elapsed.flatMap { $0 > 0 ? Self.elapsed($0) : nil }, live: live)
        }
    }

    /// Minutes and seconds, the same reading the desktop gives (`formatElapsed`).
    private static func elapsed(_ ms: Double) -> String {
        let total = Int(ms / 1000)
        let minutes = total / 60
        let seconds = total % 60
        return minutes > 0 ? "\(minutes)m \(String(format: "%02d", seconds))s" : "\(seconds)s"
    }

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
    private var mounted: [MCPServerListing] { servers.map { AccessRules.mounted($0, own: input.bot.mcpServers) } ?? [] }

    var body: some View {
        NavigationStack {
            List {
                if let environment { environmentSection(environment) }
                if let contextShare { contextSection(contextShare) }
                connectorsSection
                if !outputs.isEmpty { outputsSection }
                if !changes.isEmpty { changesSection }
                if !background.isEmpty { tasksSection }
                if environment == nil, contextShare == nil, mounted.isEmpty, !serversFailed, outputs.isEmpty, changes.isEmpty {
                    Section {
                        Text(verbatim: DevPodsStrings.empty)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("dev-pods.empty")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(Text(verbatim: DevPodsStrings.title))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Done"), action: close)
                        .accessibilityIdentifier("dev-pods.done")
                }
            }
        }
        .accessibilityIdentifier("dev-pods")
        .task(id: session.connection?.id) { await loadServers() }
        .task(id: "\(input.bot.id)|\(input.task?.threadId ?? "")") { await loadRepo() }
    }

    // MARK: Environment

    private func environmentSection(_ data: DevEnvironment) -> some View {
        Section {
            if data.computer {
                HStack(spacing: 10) {
                    Label(DevPodsStrings.place(data.place), systemImage: "desktopcomputer")
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    if let state = data.state {
                        HStack(spacing: 6) {
                            Circle()
                                .fill(state == .ready ? Color.green : Color.orange)
                                .frame(width: 6, height: 6)
                            Text(state == .ready ? String(localized: "Ready") : String(localized: "Connecting"))
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                    }
                    if let openComputer {
                        Button {
                            close()
                            openComputer()
                        } label: {
                            Image(systemName: "gearshape")
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel(Text(verbatim: DevPodsStrings.computerSettings))
                    }
                }
                .accessibilityIdentifier("dev-pods.environment.computer")
            }
            HStack(spacing: 10) {
                Label {
                    if let folder = data.folder {
                        Text(verbatim: DevPodSources.folderLabel(folder))
                            .lineLimit(1)
                            .truncationMode(.middle)
                    } else {
                        Text(verbatim: DevPodsStrings.ownFolder).foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: "folder")
                }
                if let folder = data.folder {
                    Spacer(minLength: 8)
                    Menu {
                        Button { UIPasteboard.general.string = folder } label: {
                            Label(DevPodsStrings.copyPath, systemImage: "doc.on.doc")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .frame(width: 32, height: 32)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel(Text(verbatim: DevPodsStrings.folderActions))
                }
            }
            .accessibilityIdentifier("dev-pods.environment.folder")
            if let repo {
                Label {
                    Text(verbatim: repo)
                        .font(.system(.callout, design: .monospaced))
                        .lineLimit(1)
                        .truncationMode(.middle)
                } icon: {
                    Image(systemName: "square.stack.3d.up")
                }
                .accessibilityLabel(Text(verbatim: "\(DevPodsStrings.repository), \(repo)"))
                .accessibilityIdentifier("dev-pods.environment.repo")
            }
            if let branch = data.branch {
                Label {
                    Text(verbatim: branch)
                        .font(.system(.callout, design: .monospaced))
                        .lineLimit(1)
                        .truncationMode(.middle)
                } icon: {
                    Image(systemName: "arrow.triangle.branch")
                }
                .accessibilityLabel(Text(verbatim: "\(DevPodsStrings.branch), \(branch)"))
                .accessibilityIdentifier("dev-pods.environment.branch")
                Spacer(minLength: 8)
                Menu {
                    Button { UIPasteboard.general.string = branch } label: {
                        Label(DevPodsStrings.copyBranch, systemImage: "doc.on.doc")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel(Text(verbatim: DevPodsStrings.copyBranch))
            }
        } header: {
            Text(verbatim: DevPodsStrings.environment)
        }
    }

    // MARK: Context

    @ViewBuilder
    private func contextBucket(_ id: String, _ text: String?) -> some View {
        if let text {
            Text(verbatim: text)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("dev-pods.context.\(id)")
        }
    }

    private func contextSection(_ share: DevContextShare) -> some View {
        let tint: Color = share.tone == .quiet ? .secondary : .orange
        let tokens = BotUsageTotal.formatTokens(share.tokens)
        let detail: String
        if let window = share.window, let percent = share.percent {
            detail = DevPodsStrings.contextOfWindow(tokens: tokens, percent: "\(percent)%", window: BotUsageTotal.formatTokens(window))
        } else {
            detail = DevPodsStrings.contextTokens(tokens)
        }
        return Section {
            VStack(alignment: .leading, spacing: 8) {
                if let percent = share.percent {
                    ProgressView(value: Double(min(100, percent)), total: 100)
                        .tint(tint)
                        .accessibilityLabel(Text(verbatim: DevPodsStrings.context))
                }
                Text(verbatim: detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if let buckets = share.buckets {
                    contextBucket("messages", buckets.messages.map { String(localized: "devPods.context.messages", defaultValue: "Messages: {count}").replacingOccurrences(of: "{count}", with: "\($0)") })
                    contextBucket("tools", buckets.tools.map { String(localized: "devPods.context.tools", defaultValue: "Tools: {bytes} bytes").replacingOccurrences(of: "{bytes}", with: "\($0)") })
                    contextBucket("memory", buckets.memory.map { String(localized: "devPods.context.memory", defaultValue: "Memory: {bytes} bytes").replacingOccurrences(of: "{bytes}", with: "\($0)") })
                    contextBucket("skills", buckets.skills.map { String(localized: "devPods.context.skills", defaultValue: "Skills: {bytes} bytes").replacingOccurrences(of: "{bytes}", with: "\($0)") })
                    contextBucket("agents", buckets.agents.map { String(localized: "devPods.context.agents", defaultValue: "Agents: {bytes} bytes").replacingOccurrences(of: "{bytes}", with: "\($0)") })
                    contextBucket("prompt", buckets.prompt.map { String(localized: "devPods.context.prompt", defaultValue: "Prompt: {bytes} bytes").replacingOccurrences(of: "{bytes}", with: "\($0)") })
                }
            }
            .padding(.vertical, 4)
            .accessibilityIdentifier("dev-pods.context")
        } header: {
            HStack {
                Text(verbatim: DevPodsStrings.context)
                Spacer()
                Text(verbatim: share.value)
                    .monospacedDigit()
                    .foregroundStyle(tint)
            }
        }
    }

    // MARK: Connectors

    @ViewBuilder
    private var connectorsSection: some View {
        if serversFailed {
            Section {
                HStack {
                    Text(verbatim: DevPodsStrings.connectorsFailed).foregroundStyle(.secondary)
                    Spacer()
                    Button(String(localized: "Retry")) { Task { await loadServers() } }
                        .buttonStyle(.borderless)
                }
            } header: {
                Text(verbatim: DevPodsStrings.connectors)
            }
        } else if !mounted.isEmpty {
            let shown = allConnectors ? mounted : Array(mounted.prefix(Self.connectorsShown))
            Section {
                ForEach(shown) { server in
                    Label {
                        Text(verbatim: server.name).lineLimit(1)
                        if let auth = server.auth, auth != "connected", auth != "none" {
                            Text(verbatim: DevPodsStrings.authenticate)
                                .font(.footnote)
                                .foregroundStyle(.orange)
                        }
                    } icon: {
                        Text(verbatim: String(server.name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .frame(width: 20, height: 20)
                            .background(Color.secondary.opacity(0.15), in: RoundedRectangle(cornerRadius: 5))
                    }
                    .accessibilityIdentifier("dev-pods.connector.\(server.name)")
                }
                if mounted.count > Self.connectorsShown {
                    Button(allConnectors ? String(localized: "Show less") : String(localized: "Show more")) {
                        allConnectors.toggle()
                    }
                    .accessibilityIdentifier("dev-pods.connectors.more")
                }
            } header: {
                Text(verbatim: DevPodsStrings.connectors)
            }
        }
    }

    /// The repository of this conversation, from the bot's coding activity.
    /// Nothing shows when the server has none.
    private func loadRepo() async {
        guard let client = session.profileClient, let threadId = input.task?.threadId else { return }
        guard let list = try? await client.botActivity(botId: input.bot.id, filter: .coding) else { return }
        let code = list.items.first { $0.threadId == threadId }?.code
        let name = code?.repo?.trimmingCharacters(in: .whitespacesAndNewlines)
        repo = (name?.isEmpty == false) ? name : nil
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

    // MARK: Outputs

    private var outputsSection: some View {
        Section {
            ForEach(outputs) { output in
                Button {
                    close()
                    showMessage(output.messageId)
                } label: {
                    Label {
                        Text(verbatim: output.name).lineLimit(1).truncationMode(.middle)
                    } icon: {
                        Image(systemName: output.kind == "image" ? "photo" : output.kind == "audio" ? "waveform" : "doc.text")
                    }
                }
                .accessibilityIdentifier("dev-pods.output.\(output.name)")
            }
        } header: {
            Text(verbatim: DevPodsStrings.outputs)
        }
    }

    // MARK: Changes

    private var changesSection: some View {
        Section {
            ForEach(changes) { change in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: change.kind == .pull ? "arrow.triangle.pull" : "smallcircle.filled.circle")
                        .foregroundStyle(.secondary)
                        .frame(width: 20)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: change.title).lineLimit(2)
                        Text(verbatim: change.whereLabel)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    Menu {
                        changeMenu(change)
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .frame(width: 32, height: 32)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel(Text(verbatim: DevPodsStrings.moreActions(change.title)))
                }
                .contextMenu { changeMenu(change) }
                .accessibilityIdentifier("dev-pods.change.\(change.key)")
            }
        } header: {
            Text(verbatim: DevPodsStrings.changes)
        }
    }

    @ViewBuilder
    private func changeMenu(_ change: DevChange) -> some View {
        if let link = change.url, let url = URL(string: link) {
            Button { openURL(url) } label: { Label(String(localized: "Open"), systemImage: "arrow.up.right.square") }
            Button { UIPasteboard.general.string = link } label: { Label(String(localized: "Copy link"), systemImage: "link") }
        }
        Button {
            close()
            showMessage(change.messageId)
        } label: {
            Label(DevPodsStrings.showInConversation, systemImage: "text.bubble")
        }
        if let sha = change.sha {
            Button { UIPasteboard.general.string = sha } label: { Label(DevPodsStrings.copyCommit, systemImage: "doc.on.doc") }
        }
    }

    // MARK: Background tasks

    private var tasksSection: some View {
        let finished = background.filter { ["done", "failed", "stopped"].contains($0.state) }.count
        return Section {
            ForEach(background) { task in
                HStack(spacing: 8) {
                    Text(verbatim: task.title).lineLimit(1)
                    Spacer(minLength: 8)
                    Text(verbatim: [taskState(task.state), task.elapsed].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    if task.live {
                        Button {
                            Task { try? await session.profileClient?.stopParallelTask(botId: input.bot.id, threadId: task.threadId) }
                        } label: {
                            Image(systemName: "stop.fill")
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel(Text(verbatim: DevPodsStrings.stopTask))
                    }
                }
                .accessibilityIdentifier("dev-pods.task.\(task.threadId)")
            }
            if finished > 0 {
                Text(verbatim: DevPodsStrings.finished(finished))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("dev-pods.tasks.finished")
            }
        } header: {
            Text(verbatim: DevPodsStrings.tasks)
        }
    }
}

// MARK: - Presentation

/// A sheet on the iPhone (medium and large detents); on the iPad's desktop
/// shell, an inspector at the trailing edge (iOS 17), which iOS itself turns
/// into a sheet in a compact width.
struct DevPodsPresentation<Pods: View>: ViewModifier {
    @Binding var isPresented: Bool
    let inspector: Bool
    /// Settings > Experimental's pods are on. Off, no inspector or sheet is
    /// attached at all, so nothing can present the pods (a stray
    /// "Development context" sheet showed on the iPad parity launches).
    var enabled = true
    @ViewBuilder let pods: () -> Pods

    func body(content: Content) -> some View {
        if !enabled {
            content
        } else if inspector, #available(iOS 17.0, *) {
            content.inspector(isPresented: $isPresented) {
                pods().inspectorColumnWidth(min: 280, ideal: 320, max: 380)
            }
        } else {
            content.sheet(isPresented: $isPresented) {
                pods().presentationDetents([.medium, .large])
            }
        }
    }
}

/// The header button (the desktop's panel icon in the header controls).
struct DevPodsHeaderButton: View {
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            Image(systemName: "sidebar.squares.right")
                .font(.system(size: 17, weight: .regular))
                .foregroundStyle(Theme.textPrimary)
                .frame(width: Theme.Metric.glassLarge, height: Theme.Metric.glassLarge)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .themeGlass(Circle())
        .chatGlassRim(Circle())
        .accessibilityLabel(Text(verbatim: DevPodsStrings.show))
        .accessibilityAddTraits(active ? .isSelected : [])
        .accessibilityIdentifier("header-dev-pods")
    }
}
