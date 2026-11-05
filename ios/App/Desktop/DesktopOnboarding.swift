// The desktop's first-run surfaces on the iPad shell, ported from
// src/components/onboarding/GuidedFirstRun.tsx (the three-step guide:
// connect an engine, create the first bot, send the first message),
// src/components/TermsGate.tsx (the terms of use, once per account) and
// src/components/onboarding/GuidedTour.tsx + Spotlight.tsx (the nine-step
// tour on the live interface). The rules (when each is due, which step is
// next, the config patches) are CompanionCore's `FirstRun` and `GuidedTour`.
import CompanionCore
import SwiftUI

// MARK: - State

/// The workspace's onboarding record and what is open, for one shell.
@MainActor
final class DesktopOnboardingModel: ObservableObject {
    @Published private(set) var record: OnboardingStatus?
    @Published private(set) var configLoaded = false
    /// The guided first run is up; `step` is the one it opened on.
    @Published var firstRunOpen = false
    @Published var firstRunStep: FirstRun.Step?
    /// The tour was opened on purpose (Settings > General, `toggleTour`).
    @Published var tourOpen = false
    /// The parity harness shows the terms dialog over the first run.
    @Published var parityTerms = false

    /// Read the record; open the first run when the workspace never finished it.
    func load(_ session: Session) async {
        guard !session.isDemo, let config = await session.configStatus() else { return }
        record = config.onboarding
        configLoaded = true
        // `welcomeDue`: only a session that may save the record (admin scope)
        let canSave = session.surfaceGate.allows(.experimentalSettings)
        if !firstRunOpen, FirstRun.due(record, configLoaded: configLoaded, canSave: canSave) {
            firstRunStep = nil
            firstRunOpen = true
        }
    }

    /// `completionPatch`: close first, then save (never trap the person).
    func finishFirstRun(_ session: Session) {
        firstRunOpen = false
        let patch = FirstRun.completionPatch()
        Task {
            guard let client = session.profileClient, let config = try? await client.saveOnboarding(patch) else { return }
            record = config.onboarding
        }
    }

    /// One tour step done (`hintSeenPatch`); false when it could not be saved.
    func markSeen(_ id: String, session: Session) async -> Bool {
        guard let patch = GuidedTour.seenPatch(record, id: id) else { return true }
        return await save(patch, session: session) {
            var next = $0 ?? OnboardingStatus()
            next.hintsSeen = (next.hintsSeen ?? []) + [id]
            return next
        }
    }

    /// Skip or Finish (`withTourFinished`).
    func finishTour(_ session: Session) {
        tourOpen = false
        let patch = GuidedTour.finishedPatch(record)
        Task {
            _ = await save(patch, session: session) {
                var next = $0 ?? OnboardingStatus()
                next.hintsSeen = (patch["onboarding"] as? [String: Any])?["hintsSeen"] as? [String]
                return next
            }
        }
    }

    /// A replay from the start (Settings > General > Take the tour).
    func replayTour(_ session: Session) {
        let patch = GuidedTour.resetPatch(record)
        Task {
            _ = await save(patch, session: session) {
                var next = $0 ?? OnboardingStatus()
                next.hintsSeen = (patch["onboarding"] as? [String: Any])?["hintsSeen"] as? [String]
                return next
            }
            tourOpen = true
        }
    }

    private func save(_ patch: [String: Any], session: Session, local: (OnboardingStatus?) -> OnboardingStatus) async -> Bool {
        guard let client = session.profileClient, !session.isDemo else {
            record = local(record)
            return true
        }
        guard let config = try? await client.saveOnboarding(patch) else { return false }
        record = config.onboarding ?? local(record)
        return true
    }

    #if DEBUG
    /// The parity harness's tour: the record says the welcome is done.
    func parityRecord(_ record: OnboardingStatus) {
        self.record = record
        configLoaded = true
    }
    #endif
}

extension Notification.Name {
    /// Settings > General's guided tours: the welcome (first run) or the app tour.
    static let desktopReplayFirstRun = Notification.Name("desktopReplayFirstRun")
    static let desktopReplayTour = Notification.Name("desktopReplayTour")
}

// MARK: - Shared pieces

/// `PulsatrixMark ground="app"`.
struct DesktopPulsatrixMark: View {
    @Environment(\.desktopTheme) private var theme
    let size: CGFloat

    var body: some View {
        Image(theme.dark ? "PulsatrixMark-dark" : "PulsatrixMark-light")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// `ProgressDots`: 16 pt slots 6 apart, one accent pill on the current one.
struct DesktopProgressDots: View {
    @Environment(\.desktopTheme) private var theme
    let count: Int
    let index: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<count, id: \.self) { i in
                Circle()
                    .fill(i < index ? theme.inkSecondary : theme.hairline)
                    .frame(width: 6, height: 6)
                    .opacity(i == index ? 0 : 1)
                    .frame(width: 16, height: 14)
            }
        }
        .overlay(alignment: .leading) {
            Capsule().fill(theme.accent)
                .frame(width: 16, height: 6)
                .offset(x: CGFloat(index) * 22)
                .animation(.easeOut(duration: 0.3), value: index)
        }
        .accessibilityHidden(true)
    }
}

/// `PrimaryButton`: full width, `rounded-lg bg-accent py-2.5 text-[15px] font-medium`.
private struct FirstRunPrimaryButton: View {
    @Environment(\.desktopTheme) private var theme
    let title: Text
    var disabled = false
    let identifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            title
                .font(theme.font(15, .medium))
                .foregroundStyle(theme.accentInk)
                .frame(maxWidth: .infinity)
                .frame(height: 42.5)
                .background(theme.accent, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
        .accessibilityIdentifier(identifier)
    }
}

/// `QuietButton`: `text-[12px] text-ink-secondary hover:text-ink`.
private struct FirstRunQuietButton: View {
    @Environment(\.desktopTheme) private var theme
    let title: Text
    let identifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            title.font(theme.font(12)).foregroundStyle(theme.inkSecondary)
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityIdentifier(identifier)
    }
}

// MARK: - Guided first run

/// `GuidedFirstRun`: a dedicated, dismissible screen over the shell.
struct DesktopGuidedFirstRun: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var shell: DesktopShellModel
    @ObservedObject var onboarding: DesktopOnboardingModel

    @State private var step: FirstRun.Step?
    @State private var instances: [Instance]?
    @State private var failed = false
    @State private var checking = false
    @State private var openEngine: String?
    @State private var creating = false
    @State private var createFailed = false
    @State private var createdBotId: String?
    @State private var importing = false

    private var firstBot: Bot? { session.state.bots.first { $0.hidden != true } }

    private var engines: (ready: [Instance], setup: [Instance]) { FirstRun.engines(instances ?? []) }
    private var engineReadyNow: Bool { !engines.ready.isEmpty }

    private var current: FirstRun.Step {
        step ?? onboarding.firstRunStep ?? FirstRun.initialStep(engineReady: engineReadyNow, botExists: firstBot != nil)
    }

    private var messageBot: Bot? {
        createdBotId.flatMap { session.state.bot($0) } ?? firstBot
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                theme.app.ignoresSafeArea()
                card(maxHeight: geometry.size.height - 64)
                    .frame(maxWidth: current == .engine ? 680 : 480)
                    .padding(32)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .ignoresSafeArea()
        .background(DesktopEscapeKey(action: { finish(completed: false) }))
        .task { await refresh() }
        .sheet(isPresented: $importing) {
            AgentImportSheet(close: { importing = false }, imported: { bot in
                importing = false
                if let bot { createdBotId = bot.id; step = .message }
            })
            .environmentObject(session)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Get started"))
        .accessibilityIdentifier("desktop-first-run")
    }

    private func card(maxHeight: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                DesktopPulsatrixMark(size: 40)
                title.font(theme.font(18, .semibold)).foregroundStyle(theme.ink)
            }
            Group {
                switch current {
                case .engine: engineStep(maxHeight: maxHeight)
                case .bot: botStep
                case .message: messageStep
                }
            }
            footer.padding(.top, 24)
        }
        .padding(32)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.panel, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
        .overlay(alignment: .topTrailing) {
            FirstRunQuietButton(title: Text("Skip tour"), identifier: "first-run-skip") { finish(completed: false) }
                .padding(.top, 16).padding(.trailing, 16)
        }
        .shadow(color: .black.opacity(0.45), radius: 40, y: 30)
        .shadow(color: .black.opacity(0.25), radius: 12, y: 8)
    }

    private var title: Text {
        switch current {
        case .engine: Text("Your model providers")
        case .bot: Text("Create your first bot")
        case .message: Text("Send your first message")
        }
    }

    private var footer: some View {
        let index = FirstRun.Step.allCases.firstIndex(of: current) ?? 0
        return ZStack {
            HStack {
                if index > 0 {
                    FirstRunQuietButton(title: Text("Back"), identifier: "first-run-back") {
                        step = FirstRun.Step.allCases[index - 1]
                    }
                }
                Spacer()
                Text("Step \(String(index + 1)) of \(String(FirstRun.Step.allCases.count))")
                    .font(theme.font(11))
                    .foregroundStyle(theme.inkSecondary)
                    .accessibilityIdentifier("first-run-progress")
            }
            DesktopProgressDots(count: FirstRun.Step.allCases.count, index: index)
        }
    }

    // MARK: engine

    private func engineStep(maxHeight: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Bots run on AI tools installed on this computer. Here’s what we found.")
                .font(theme.font(13.5))
                .foregroundStyle(theme.inkSecondary)
                .padding(.top, 4)
            HStack(spacing: 12) {
                summary
                Spacer(minLength: 0)
                Button { Task { await refresh() } } label: {
                    HStack(spacing: 6) {
                        DesktopIconView(icon: .refresh, size: 12)
                        checking ? Text("Checking…") : Text("Check again")
                    }
                    .font(theme.font(12))
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(DesktopHoverFill(radius: 6))
                .disabled(checking)
                .accessibilityIdentifier("first-run-check-again")
            }
            .padding(.top, 16)
            ScrollView {
                VStack(spacing: 0) {
                    if let instances {
                        let rows = engines.ready + engines.setup
                        ForEach(Array(rows.enumerated()), id: \.element.instanceId) { index, instance in
                            if index > 0 { Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1) }
                            engineRow(instance)
                        }
                        if instances.isEmpty { EmptyView() }
                    } else if !failed {
                        ForEach(0..<3, id: \.self) { index in
                            if index > 0 { Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1) }
                            HStack(spacing: 12) {
                                RoundedRectangle(cornerRadius: 6).fill(theme.raised).frame(width: 18, height: 18)
                                RoundedRectangle(cornerRadius: 4).fill(theme.raised).frame(width: 128, height: 12)
                                Spacer()
                                Capsule().fill(theme.raised).frame(width: 56, height: 16)
                            }
                            .padding(.horizontal, 14).padding(.vertical, 12)
                        }
                    }
                }
            }
            // the list scrolls inside the card once the window is too short
            .frame(maxHeight: max(120, maxHeight - 300))
            .fixedSize(horizontal: false, vertical: true)
            .background(theme.card)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
            .padding(.top, 10)
            FirstRunPrimaryButton(title: Text("Continue"), identifier: "first-run-continue") { step = .bot }
                .padding(.top, 20)
        }
    }

    @ViewBuilder private var summary: some View {
        if instances == nil {
            (failed ? Text("Couldn't check your AI connections. Try again.") : Text("Checking…"))
                .font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
        } else if !engines.ready.isEmpty, engines.setup.isEmpty {
            HStack(spacing: 8) {
                DesktopIconView(icon: .check, size: 14, strokeWidth: 2.5)
                Text("Everything is ready. Your bots can start right away.")
            }
            .font(theme.font(12.5)).foregroundStyle(theme.success)
        } else {
            HStack(spacing: 0) {
                Text("\(String(engines.ready.count)) ready")
                Text(verbatim: "·").foregroundStyle(theme.hairline).padding(.horizontal, 6)
                Text("\(String(engines.setup.count)) to set up")
            }
            .font(theme.font(12.5).monospacedDigit()).foregroundStyle(theme.inkSecondary)
        }
    }

    private func engineRow(_ instance: Instance) -> some View {
        let ready = FirstRun.engineReady(instance)
        let open = openEngine == instance.instanceId
        let version = instance.snapshot.version.map { String($0.split(separator: " ").first ?? "") }
        let line = HStack(spacing: 12) {
            ProviderMarkView(instance: instance, size: 18).frame(width: 18, height: 18)
            // `text-[13.5px]`: a 20.25 line box
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(verbatim: instance.displayName ?? instance.driverKind)
                    .font(theme.font(13.5, .medium)).foregroundStyle(theme.ink).lineLimit(1)
                if let version, !version.isEmpty {
                    Text(verbatim: version).font(theme.font(11.5).monospacedDigit()).foregroundStyle(theme.inkSecondary)
                }
            }
            .frame(minHeight: 20.25)
            Spacer(minLength: 8)
            statusPill(ready: ready)
            if !ready {
                DesktopIconView(icon: .chevronRight, size: 14)
                    .foregroundStyle(theme.inkSecondary)
                    .rotationEffect(.degrees(open ? -90 : 90))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
        return VStack(spacing: 0) {
            if ready {
                line
            } else {
                Button { withAnimation(.easeOut(duration: 0.2)) { openEngine = open ? nil : instance.instanceId } } label: { line }
                    .buttonStyle(DesktopHoverFill(radius: 0, fill: \.raised))
                    .accessibilityIdentifier("first-run-engine.\(instance.instanceId)")
            }
            if !ready, open { engineSetup(instance) }
        }
    }

    /// `EngineSetup`: the driver's own steps run on the computer, so the
    /// iPad says what is wrong and opens Settings > Providers, where each
    /// engine is connected.
    private func engineSetup(_ instance: Instance) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let reason = instance.snapshot.reason, !reason.isEmpty {
                Text(verbatim: reason).font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button {
                shell.settingsSection = .engines
                shell.modal = .settings
            } label: { Text("Providers") }
                .buttonStyle(DesktopButtonStyle(kind: .control, size: 12.5, height: 28))
                .accessibilityIdentifier("first-run-engine-setup")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .padding(.horizontal, 14)
        .padding(.bottom, 14)
    }

    private func statusPill(ready: Bool) -> some View {
        HStack(spacing: 6) {
            Circle().fill(ready ? theme.success : theme.warning).frame(width: 6, height: 6)
            ready ? Text("Ready") : Text("Needs setup")
        }
        .font(theme.font(11, .medium))
        .foregroundStyle(ready ? theme.accentText : theme.warning)
        .padding(.horizontal, 8)
        .padding(.vertical, 2)
        .background((ready ? theme.accent : theme.warning).opacity(0.15), in: Capsule())
    }

    // MARK: bot

    private var botStep: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !engineReadyNow, instances != nil {
                Text("Connect an engine first so your bot has something to run on.")
                    .font(theme.font(13.5)).foregroundStyle(theme.inkSecondary).padding(.top, 4)
                FirstRunPrimaryButton(title: Text("Connect an engine"), identifier: "first-run-connect") { step = .engine }
                    .padding(.top, 20)
            } else if let firstBot {
                HStack(spacing: 8) {
                    DesktopIconView(icon: .check, size: 15, strokeWidth: 2.5)
                    Text("You already have a bot: \(firstBot.name).")
                }
                .font(theme.font(13.5)).foregroundStyle(theme.success).padding(.top, 4)
                FirstRunPrimaryButton(title: Text("Continue"), identifier: "first-run-continue") { step = .message }
                    .padding(.top, 20)
            } else {
                Text("One bot, set up for you: it picks the right engine and model on its own, and asks you before doing anything that leaves this computer. You can change all of it later.")
                    .font(theme.font(13.5)).lineSpacing(4).foregroundStyle(theme.inkSecondary).padding(.top, 4)
                    .fixedSize(horizontal: false, vertical: true)
                if createFailed {
                    Text("The bot could not be created. Try again.")
                        .font(theme.font(13)).foregroundStyle(theme.danger)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(theme.danger.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(theme.danger.opacity(0.25), lineWidth: 1))
                        .padding(.top, 16)
                }
                FirstRunPrimaryButton(title: creating ? Text("Creating…") : Text("Create my first bot"), disabled: creating,
                                      identifier: "first-run-create") { createFirstBot() }
                    .padding(.top, 20)
                FirstRunQuietButton(title: Text("More options"), identifier: "first-run-advanced") { shell.modal = .newBot }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 12)
            }
            if session.viewer?.botsReadOnly != true {
                FirstRunQuietButton(title: Text("Import an agent (Grok Bot, Claude Code)"), identifier: "first-run-import") { importing = true }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)
            }
        }
    }

    private func createFirstBot() {
        guard !creating else { return }
        creating = true
        createFailed = false
        Task {
            if let bot = await session.createBot() {
                createdBotId = bot.id
                shell.open(.bot(bot))
                step = .message
            } else {
                createFailed = true
            }
            creating = false
        }
    }

    // MARK: message

    private var messageStep: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 16) {
                if let bot = messageBot {
                    ChatAvatarView(chat: .bot(bot), size: 56, state: .happy, background: theme.panel)
                }
                Group {
                    if let bot = messageBot {
                        Text("\(bot.name) is ready. Type your first message and press Enter.")
                    } else {
                        Text("Your bot is ready. Type your first message and press Enter.")
                    }
                }
                .font(theme.font(13.5)).lineSpacing(4).foregroundStyle(theme.inkSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, 8)
            FirstRunPrimaryButton(title: Text("Start writing"), identifier: "first-run-start") {
                if let bot = messageBot { shell.open(.bot(bot)) }
                finish(completed: true)
            }
            .padding(.top, 20)
        }
    }

    // MARK: actions

    private func refresh() async {
        checking = true
        defer { checking = false }
        guard let client = session.profileClient, !session.isDemo else {
            instances = []
            return
        }
        do {
            instances = try await client.instances()
            failed = false
        } catch {
            failed = true
        }
    }

    private func finish(completed: Bool) {
        onboarding.finishFirstRun(session)
        // "Start writing" puts the caret in the composer (`focusComposer`)
        if completed {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { DesktopComposerCommand.post(.focus) }
        }
    }
}

// MARK: - Terms of use

/// `TermsGate`: a `DialogFrame` md (440) over everything, asked once per
/// account; "I agree" is kept on the server.
struct DesktopTermsDialog: View {
    @Environment(\.desktopTheme) private var theme
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var session: Session
    var accept: (() async -> Bool)?
    @State private var pending = false
    @State private var failed = false

    /// The shell draws the terms itself; CompanionApp's sheet stays away.
    @MainActor static var shellPresents = false

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.black.opacity(0.5).ignoresSafeArea()
                VStack(alignment: .leading, spacing: 0) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Terms of use")
                            .font(theme.font(17, .semibold)).tracking(-0.136)
                            .foregroundStyle(theme.ink)
                            .frame(minHeight: 24)
                        Text("Asked once per account")
                            .font(theme.font(13)).foregroundStyle(theme.inkSecondary)
                            .frame(minHeight: 18)
                    }
                    .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 4)
                    VStack(alignment: .leading, spacing: 0) {
                        paragraph(Text("Before you continue, read and accept the terms of use."))
                        paragraph(Text("There is zero tolerance for objectionable or abusive content. Anyone can report a message or block a person, and the admins review every report."))
                            .padding(.top, 24)
                        if failed {
                            Text("Could not save your answer. Check the connection and try again.")
                                .font(theme.font(12.5)).foregroundStyle(theme.danger).padding(.top, 8)
                        }
                    }
                    .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 20)
                    HStack(spacing: 8) {
                        Spacer()
                        pill(Text("Read the terms"), primary: false, identifier: "terms-read") { openURL(Moderation.termsURL) }
                        pill(Text("I agree"), primary: true, identifier: "terms-accept") { agree() }
                            .disabled(pending)
                            // `autoFocus` on I agree: the focus ring the desktop shows
                            .overlay(Capsule().inset(by: -3).strokeBorder(theme.focus, lineWidth: 2))
                    }
                    .padding(.horizontal, 20).padding(.bottom, 20)
                }
                .frame(width: min(440, geometry.size.width - 24))
                .background(theme.app, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .ignoresSafeArea()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("terms-sheet")
    }

    private func paragraph(_ text: Text) -> some View {
        text.font(theme.font(13))
            .lineSpacing(max(0, 19 - theme.uiFont(13).lineHeight))
            .foregroundStyle(theme.ink)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func pill(_ title: Text, primary: Bool, identifier: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            title.font(theme.font(13))
                .foregroundStyle(primary ? theme.app : theme.ink)
                .padding(.horizontal, 13)
                .frame(height: 30)
                .background(primary ? theme.ink : theme.hover, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(identifier)
    }

    private func agree() {
        pending = true
        failed = false
        Task {
            let ok: Bool
            if let accept { ok = await accept() } else { ok = await session.acceptTerms() }
            failed = !ok
            pending = false
        }
    }
}

// MARK: - Guided tour

/// `data-tour` anchors: each control the tour points at reports its frame.
struct DesktopTourAnchorKey: PreferenceKey {
    static var defaultValue: [String: Anchor<CGRect>] = [:]
    static func reduce(value: inout [String: Anchor<CGRect>], nextValue: () -> [String: Anchor<CGRect>]) {
        // the newest match wins, as `measure` takes the last visible one
        value.merge(nextValue()) { _, new in new }
    }
}

extension View {
    /// The desktop's `data-tour="<id>"` on this control.
    func desktopTourAnchor(_ id: String) -> some View {
        // transform, never set: the anchors inside this view stay reported
        transformAnchorPreference(key: DesktopTourAnchorKey.self, value: .bounds) { $0[id] = $1 }
    }
}

/// `GuidedTour` + `Spotlight`: one step at a time over the live shell.
struct DesktopGuidedTour: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var shell: DesktopShellModel
    @ObservedObject var onboarding: DesktopOnboardingModel
    let anchors: [String: Anchor<CGRect>]

    @State private var entered: String?
    @State private var fallback: String?
    @State private var saving = false
    @State private var failed = false
    @State private var cardHeight: CGFloat = 120
    @State private var shellSize: CGSize = .zero

    private static let pad: CGFloat = 8
    private static let radius: CGFloat = 14
    private static let cardWidth: CGFloat = 320
    private static let gap: CGFloat = 12

    private var step: GuidedTour.Step? { GuidedTour.current(onboarding.record) }

    private var active: Bool {
        guard let record = onboarding.record, record.completedAt != nil, step != nil, !onboarding.firstRunOpen else { return false }
        return onboarding.tourOpen || GuidedTour.inProgress(record)
    }

    var body: some View {
        GeometryReader { geometry in
            Color.clear
                .frame(width: 0, height: 0)
                .onAppear { shellSize = geometry.size }
                .onValueChange(of: geometry.size) { shellSize = $0 }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            if active, let step {
                let anchor = fallback == step.id ? step.fallbackAnchor : step.anchor
                let rect = anchor.flatMap { anchors[$0] }.map { geometry[$0].insetBy(dx: -Self.pad, dy: -Self.pad) }
                spotlight(step: step, rect: rect, in: geometry.size)
                    .task(id: step.id) { await enter(step) }
            }
        }
        .ignoresSafeArea()
    }

    private func spotlight(step: GuidedTour.Step, rect: CGRect?, in size: CGSize) -> some View {
        ZStack(alignment: .topLeading) {
            // `bg-black/55` with the anchor cut out; touches pass through
            Path { path in
                path.addRect(CGRect(origin: .zero, size: size))
                if let rect { path.addRect(rect) }
            }
            .fill(Color.black.opacity(0.55), style: FillStyle(eoFill: true))
            .allowsHitTesting(false)
            if let rect {
                // the accent ring and its soft halo
                RoundedRectangle(cornerRadius: Self.radius + 5, style: .continuous)
                    .strokeBorder(theme.accent.opacity(0.28), lineWidth: 5)
                    .frame(width: rect.width + 10, height: rect.height + 10)
                    .background(
                        RoundedRectangle(cornerRadius: Self.radius + 6, style: .continuous)
                            .stroke(theme.accent.opacity(0.3), lineWidth: 12)
                            .blur(radius: 18)
                    )
                    .offset(x: rect.minX - 5, y: rect.minY - 5)
                    .allowsHitTesting(false)
            }
            card(step: step)
                .frame(width: min(Self.cardWidth, size.width - 24))
                .background(GeometryReader { proxy in
                    Color.clear.onAppear { cardHeight = proxy.size.height }
                        .onValueChange(of: proxy.size.height) { cardHeight = $0 }
                })
                .offset(cardOrigin(step: step, rect: rect, in: size))
                .animation(.easeOut(duration: 0.32), value: rect)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-tour")
    }

    /// Spotlight's placement: beside a sidebar control, above or below the
    /// anchor (whichever has room), inside a window-sized anchor, or centred.
    private func cardOrigin(step: GuidedTour.Step, rect: CGRect?, in size: CGSize) -> CGSize {
        let width = min(Self.cardWidth, size.width - 24)
        guard let rect else {
            return CGSize(width: (size.width - width) / 2, height: (size.height - cardHeight) / 2)
        }
        if step.placement == .right, rect.maxX + Self.gap + width <= size.width - 12 {
            return CGSize(width: rect.maxX + Self.gap, height: max(12, min(rect.midY - 70, size.height - 180)))
        }
        let left = max(12, min(rect.minX, size.width - width - 12))
        let roomBelow = size.height - rect.maxY - Self.gap
        let roomAbove = rect.minY - Self.gap
        if roomBelow < 140, roomAbove < 140 {
            return CGSize(width: max(12, min(rect.maxX - width - Self.gap * 2, size.width - width - 12)), height: max(12, rect.minY + Self.gap * 2))
        }
        let below = step.placement == .below
            ? roomBelow >= 140 || roomAbove < roomBelow
            : roomAbove < 140 && roomBelow > roomAbove
        return below
            ? CGSize(width: left, height: rect.maxY + Self.gap)
            : CGSize(width: left, height: rect.minY - Self.gap - cardHeight)
    }

    private func card(step: GuidedTour.Step) -> some View {
        let closing = step.id == "tour.done"
        let number = GuidedTour.number(step)
        return HStack(alignment: .top, spacing: 12) {
            DesktopPulsatrixMark(size: 34).padding(.top, 2)
            VStack(alignment: .leading, spacing: 0) {
                copy(step)
                    .font(theme.font(13.5))
                    .lineSpacing(max(0, 13.5 * 1.625 - theme.uiFont(13.5).lineHeight))
                    .foregroundStyle(theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                if failed {
                    Text("Couldn't save your progress. Try again, or skip the tour.")
                        .font(theme.font(13.5)).foregroundStyle(theme.danger).padding(.top, 8)
                }
                HStack(spacing: 12) {
                    Button { closing ? finish() : advance(step) } label: {
                        (closing ? Text("Finish") : Text("Next"))
                            .font(theme.font(12.5, .medium))
                            .foregroundStyle(theme.accentInk)
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .background(theme.accent, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            // `autoFocus`: the focus ring the desktop shows
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).inset(by: -2).strokeBorder(theme.focus, lineWidth: 2))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier(closing ? "tour-finish" : "tour-next")
                    if !closing {
                        Text("Step \(String(number.current)) of \(String(number.total))")
                            .font(theme.font(11.5).monospacedDigit())
                            .foregroundStyle(theme.inkSecondary)
                            .accessibilityIdentifier("tour-progress")
                        Spacer(minLength: 0)
                        Button(action: finish) { Text("Skip tour").font(theme.font(12)).foregroundStyle(theme.inkSecondary) }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("tour-skip")
                    }
                }
                .padding(.top, 10)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .background(theme.panel, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
        .shadow(color: .black.opacity(0.6), radius: 30, y: 24)
        .background(DesktopEscapeKey(action: finish))
    }

    /// `onboarding.tour.<id>`; the composer step names the send key.
    private func copy(_ step: GuidedTour.Step) -> Text {
        switch step.copy {
        case "composer": Text("This is where you talk to your bots. Type anything and press \("Enter"). Every chat is a real agent on your machine.")
        case "model": Text("Every bot has its own brain. Open the + menu, then Model, to switch it, even mid-conversation.")
        case "computer": Text("Bots have hands. This button opens the Computer panel, where you watch the bot work. Let's open it.")
        case "computer-browser": Text("The bot's computer. Switch between its desktop and its own browser here; Browser is where it reads the web and fills in forms for you.")
        case "tools": Text("The foot of the sidebar: your avatar opens Team map, Automations, Browse Bots and your settings. The Capabilities pill sits right beside it.")
        case "apps": Text("Capabilities: plugins, skills, MCP servers and the connectors of your engines' accounts. Let's have a look.")
        case "apps-panel": Text("The marketplace. Sign in to an app once and every bot can use it as a tool. We'll close this and move on.")
        case "automations": Text("Automations. Bots that run on a schedule, or when a webhook calls. Let's open it.")
        case "automations-page": Text("A calendar. Drop a bot on a time and it runs by itself; the result lands in its chat. Next takes you back to the chat.")
        default: Text("That's the tour, and you're back in the chat. Your phone, the terminal, and everything else is in Settings. Replay this any time from Settings → General.")
        }
    }

    // MARK: steps

    /// Entering a step runs its effect once; a step whose control is not on
    /// screen points at its fallback or skips itself after the layout settles.
    private func enter(_ step: GuidedTour.Step) async {
        if entered != step.id {
            entered = step.id
            run(step.onEnter)
        }
        guard step.skipIfMissing else { return }
        try? await Task.sleep(nanoseconds: 400_000_000)
        guard self.step?.id == step.id, !present(step.anchor) else { return }
        run(step.onEnter)
        try? await Task.sleep(nanoseconds: 300_000_000)
        guard self.step?.id == step.id, !present(step.anchor) else { return }
        if let fallbackAnchor = step.fallbackAnchor, present(fallbackAnchor) {
            fallback = step.id
        } else {
            advance(step)
        }
    }

    private func present(_ anchor: String?) -> Bool {
        guard let anchor else { return true }
        return anchors[anchor] != nil
    }

    private func advance(_ step: GuidedTour.Step) {
        guard !saving else { return }
        saving = true
        failed = false
        Task {
            if await onboarding.markSeen(step.id, session: session) {
                run(step.onExit)
            } else {
                failed = true
            }
            saving = false
        }
    }

    private func finish() {
        // leave nothing open behind: the panel, Capabilities, a page, the menu
        if shell.panelOpen, shell.panelTab == .computer { run(.closeComputer) }
        if shell.modal == .plugins { run(.closeApps) }
        shell.menu = nil
        run(.backToChat)
        onboarding.finishTour(session)
    }

    /// The tour presses the real controls (the desktop's `run`).
    private func run(_ effect: GuidedTour.Effect?) {
        switch effect {
        case .openComputer:
            if case .bot? = shell.selected { shell.showPanel(.computer) }
        case .closeComputer:
            if shell.panelOpen { shell.togglePanel() }
        case .openTools:
            // open the account menu with Tools expanded so Automations
            // (`nav-automations`) is on screen for the next step
            if shell.menu?.kind != .profile || shell.menu?.expandSubmenu != "tools" {
                // foot of the sidebar: same place the parity captures open it
                let height = max(shellSize.height, 600)
                shell.menu = DesktopMenuRequest(
                    kind: .profile,
                    anchor: CGPoint(x: 8, y: height - 64),
                    opensUp: true,
                    expandSubmenu: "tools"
                )
            }
        case .openApps:
            shell.menu = nil
            shell.modal = .plugins
        case .closeApps:
            if shell.modal == .plugins { shell.modal = nil }
        case .openAutomations:
            shell.show(.automations)
        case .backToChat:
            shell.page = nil
        case nil:
            break
        }
    }
}
