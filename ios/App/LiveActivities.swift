// Keeping the Dynamic Island and the lock screen in step with the bots.
//
// One Live Activity per bot that is doing something: needs you, or working.
// What to start, update and end is decided in CompanionCore
// (`LiveActivityPlan`, tested); this file only applies it to ActivityKit.
//
// Activities start with `pushType: .token` so the server can update and end
// them through APNs (`apns-push-type: liveactivity`) after the app is
// suspended or killed. Each activity's push token (and the push-to-start
// token on iOS 17.2+) is registered with `/api/push/activities` for this
// person and bot.
//
// The stream is foreground-only (plus a ~25 s grace), so the island is exact
// while the app is alive. After that:
// - ActivityKit push updates carry the new content-state;
// - every card also gets a stale date as a backstop;
// - a launch keeps the cards it finds until the first hydrate, then ends
//   the ones whose bot moved on, with a short "done" card.
import ActivityKit
import Combine
import Foundation
import os
import UIKit
import CompanionCore

private let activityLog = Logger(subsystem: "com.openmausbot.companion", category: "live-activity")

/// ActivityKit's content/alert API is iOS 16.2, so the whole coordinator is
/// gated and simply never built on anything older. Those phones keep the app;
/// they just have no Dynamic Island, which they do not have hardware for
/// either.
@available(iOS 16.2, *)
@MainActor
final class LiveActivityCoordinator {
    private var cancellable: AnyCancellable?
    /// What each activity id was last handed, to skip no-op updates.
    private var lastSent: [String: BotActivityContent] = [:]
    /// When each bot's current kind began, so an update does not reset the clock.
    private var since: [String: (kind: String, at: Date)] = [:]
    /// The knowledge the last pass ran with: a change refreshes every stale date.
    private var lastKnowledge: LiveActivityPlan.Knowledge?
    /// One pass at a time: ActivityKit calls are async, and two passes
    /// interleaving could start the same bot twice.
    private var running: Task<Void, Never>?
    private weak var session: Session?
    /// Last Live Activity push registrations by token hex.
    private var registeredTokens: [String: LiveActivityTokenRegistration] = [:]
    /// One listen task per ActivityKit activity id.
    private var tokenTasks: [String: Task<Void, Never>] = [:]
    private var pushToStartTask: Task<Void, Never>?

    func attach(to session: Session) {
        self.session = session
        // Answer from the island: the intent runs in this process.
        AnswerApprovalIntent.handler = { [weak self, weak session] threadId, requestId, choice, isPermission in
            await self?.answer(session: session, threadId: threadId, requestId: requestId, choice: choice, isPermission: isPermission)
        }
        // A push hydrated the state in the background: follow it now.
        session.afterPushHydrate = { [weak self] state in
            await self?.apply(state, knowledge: .background)
        }
        listenForPushToStartToken()
        // Adopt tokens for activities that survived a relaunch.
        for activity in Activity<BotActivityAttributes>.activities {
            watchPushToken(activity)
        }
        cancellable = session.statePublisher
            .combineLatest(session.$isDemo, session.$status.map { $0 == .live }.removeDuplicates())
            .debounce(for: .milliseconds(300), scheduler: DispatchQueue.main)
            .sink { [weak self] state, isDemo, live in
                guard let self else { return }
                // No Live Activity for the demo's made-up bots.
                let knowledge = Self.knowledge(live: live)
                Task { await self.apply(isDemo ? CompanionState() : state, knowledge: isDemo ? .live : knowledge) }
            }
    }

    /// The app leaves the screen (`active == false`) or comes back. Leaving,
    /// every card gets the short stale date at once, while the app still
    /// runs: the stream's linger may end in a suspension before the
    /// debounced pass runs. Coming back, the cards are vouched for again
    /// (the stream may have stayed live, so nothing else would say so).
    func sceneChanged(active: Bool) {
        guard let session else { return }
        let state = session.isDemo ? CompanionState() : session.state
        let knowledge: LiveActivityPlan.Knowledge = session.isDemo ? .live
            : active ? Self.knowledge(live: session.status == .live) : .unknown
        Task { await apply(state, knowledge: knowledge) }
    }

    private static func knowledge(live: Bool) -> LiveActivityPlan.Knowledge {
        guard live else { return .unknown }
        return UIApplication.shared.applicationState == .background ? .background : .live
    }

    private func answer(session: Session?, threadId: String, requestId: String, choice: String, isPermission: Bool) async {
        guard let activity = Activity<BotActivityAttributes>.activities.first(where: {
            $0.content.state.canAnswer(threadId: threadId, requestId: requestId, choice: choice, isPermission: isPermission)
        }) else {
            session?.actionError = "This request has changed. Open the chat to review it."
            return
        }
        guard await session?.answer(threadId: threadId, requestId: requestId, choice: choice, isPermission: isPermission) == true else { return }
        // The buttons go at once: the stream (or the settled push) confirms
        // later, and may never come while the app is in the background.
        let next = LiveActivityPlan.answered(activity.content.state, choice: choice)
        lastSent[activity.id] = next
        await activity.update(ActivityContent(
            state: next, staleDate: Date().addingTimeInterval(LiveActivityPlan.backgroundStaleAfter),
            relevanceScore: LiveActivityPlan.relevance(next)
        ))
    }

    /// Plans against the system's activities and applies the plan, one pass
    /// at a time, and returns once ActivityKit has taken every change.
    func apply(_ state: CompanionState, knowledge: LiveActivityPlan.Knowledge) async {
        let previous = running
        let pass = Task { @MainActor [weak self] in
            await previous?.value
            await self?.pass(state, knowledge: knowledge)
        }
        running = pass
        await pass.value
    }

    private func pass(_ state: CompanionState, knowledge: LiveActivityPlan.Knowledge) async {
        let activities = Activity<BotActivityAttributes>.activities
        guard ActivityAuthorizationInfo().areActivitiesEnabled || !activities.isEmpty else { return }
        let wants = wants(from: state)
        let forceRefresh = lastKnowledge != knowledge
        lastKnowledge = knowledge
        let plan = LiveActivityPlan.plan(
            wants: wants,
            running: activities.map { .init(id: $0.id, botId: $0.attributes.botId, content: $0.content.state) },
            knownBots: Set(state.bots.map(\.id)),
            knowledge: knowledge,
            lastSent: lastSent,
            forceRefresh: forceRefresh
        )
        let byId = Dictionary(activities.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        for action in plan {
            switch action {
            case let .start(botId, content, relevance, staleAfter):
                guard ActivityAuthorizationInfo().areActivitiesEnabled,
                      let bot = state.bots.first(where: { $0.id == botId }) else { continue }
                let attributes = BotActivityAttributes(
                    botId: bot.id, threadId: bot.threadId, name: bot.name, color: bot.color,
                    mascotLook: bot.mascotLook, mascotSkin: bot.mascotSkin
                )
                do {
                    // No alert of its own: the ask's notification already
                    // buzzes the phone and the watch once. The activity stays
                    // a quiet status with the answers on it. pushType: .token
                    // lets the server update and end it after the app sleeps.
                    let activity = try Activity.request(
                        attributes: attributes,
                        content: ActivityContent(state: content, staleDate: staleAfter.map { Date().addingTimeInterval($0) }, relevanceScore: relevance),
                        pushType: .token
                    )
                    lastSent[activity.id] = content
                    watchPushToken(activity)
                } catch {
                    // Not recorded as sent: the next pass tries again (the
                    // system refuses a start while the app is not visible).
                    activityLog.error("start refused for a bot: \(error.localizedDescription, privacy: .public)")
                }
            case let .update(id, content, relevance, staleAfter):
                guard let activity = byId[id] else { continue }
                lastSent[id] = content
                await activity.update(ActivityContent(
                    state: content, staleDate: staleAfter.map { Date().addingTimeInterval($0) }, relevanceScore: relevance
                ))
            case let .end(id, final, dismissAfter):
                guard let activity = byId[id] else { continue }
                lastSent.removeValue(forKey: id)
                since.removeValue(forKey: activity.attributes.botId)
                forgetPushToken(activityId: id)
                if let final {
                    await activity.end(
                        ActivityContent(state: final, staleDate: nil, relevanceScore: 0),
                        dismissalPolicy: .after(Date().addingTimeInterval(dismissAfter))
                    )
                } else {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
            }
        }
    }

    /// Listen for the per-activity push token and register it with the server.
    private func watchPushToken(_ activity: Activity<BotActivityAttributes>) {
        tokenTasks[activity.id]?.cancel()
        let botId = activity.attributes.botId
        let activityId = activity.id
        tokenTasks[activityId] = Task { [weak self] in
            for await tokenData in activity.pushTokenUpdates {
                guard !Task.isCancelled else { return }
                let hex = LiveActivityPushToken.hex(tokenData)
                await self?.registerToken(.init(kind: .update, token: hex, botId: botId, activityId: activityId))
            }
        }
    }

    private func forgetPushToken(activityId: String) {
        tokenTasks.removeValue(forKey: activityId)?.cancel()
    }

    /// Push-to-start token (iOS 17.2+): stored on the server for a later start.
    private func listenForPushToStartToken() {
        guard #available(iOS 17.2, *) else { return }
        pushToStartTask?.cancel()
        pushToStartTask = Task { [weak self] in
            for await tokenData in Activity<BotActivityAttributes>.pushToStartTokenUpdates {
                guard !Task.isCancelled else { return }
                let hex = LiveActivityPushToken.hex(tokenData)
                await self?.registerToken(.init(kind: .start, token: hex))
            }
        }
    }

    private func registerToken(_ want: LiveActivityTokenPlan.Want) async {
        guard let session, !session.isDemo else { return }
        guard let active = PushRegistrar.shared.activeClient?() else { return }
        guard LiveActivityTokenPlan.needsRegister(want: want, lastRegistered: registeredTokens) else { return }
        let frequent = ActivityAuthorizationInfo().frequentPushesEnabled
        guard let body = LiveActivityTokenPlan.registration(
            want: want,
            environment: PushRegistrar.environment,
            deviceToken: PushRegistrar.shared.deviceToken,
            frequentUpdates: frequent,
            appVersion: PushRegistrar.appVersion,
            deviceName: UIDevice.current.name
        ) else { return }
        do {
            try await active.client.registerLiveActivityToken(body)
            registeredTokens[want.token] = body
            activityLog.info("registered Live Activity \(want.kind.rawValue, privacy: .public) token")
        } catch {
            activityLog.notice("Live Activity token registration refused: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// The bots the Updates pill shows as needing you or working, as cards.
    private func wants(from state: CompanionState) -> [LiveActivityPlan.Want] {
        var wants: [LiveActivityPlan.Want] = []
        for update in state.updates where update.kind != .toReview {
            guard case let .bot(bot) = update.chat else { continue }
            let face = MausState.forBot(bot, last: state.visibleTranscript(forThread: bot.threadId).last)
            let kind = update.kind == .needsYou ? "needsYou" : "working"
            if since[bot.id]?.kind != kind { since[bot.id] = (kind, Date()) }
            // A confidential thread shows « Fil confidentiel » and nothing
            // it said, and its asks are answered in the chat only.
            let text = ConfidentialRedaction.liveActivity(for: update, botName: bot.name)
            wants.append(.init(botId: bot.id, content: BotActivityAttributes.ContentState(
                face: face.rawValue,
                kind: kind,
                headline: text.headline,
                line: text.line,
                threadId: update.chat.threadId,
                card: text.card,
                since: since[bot.id]?.at ?? Date()
            )))
        }
        return wants
    }
}

/// What the app actually holds.
///
/// `LiveActivityCoordinator` cannot exist below iOS 16.2, but the app's scene
/// does not want an `#available` around a stored property. The bridge owns the
/// coordinator where it is available and does nothing where it is not.
@MainActor
final class LiveActivityBridge {
    /// One per process: attached at launch by the app delegate, so a button
    /// on the lock screen that launches the app in the background (no
    /// window, no `onAppear`) still finds its handler.
    static let shared = LiveActivityBridge()

    private var coordinator: AnyObject?

    func sceneChanged(active: Bool) {
        guard #available(iOS 16.2, *), let coordinator = coordinator as? LiveActivityCoordinator else { return }
        coordinator.sceneChanged(active: active)
    }

    func attach(to session: Session) {
        guard #available(iOS 16.2, *) else { return }
        // `onAppear` runs again when the scene is rebuilt (a language
        // change): keep the one coordinator, its sent cards and its clocks.
        if coordinator != nil { return }
        #if DEBUG
        // Synthetic cards for captures: no coordinator to end them.
        if LiveActivityPreview.startIfRequested() { return }
        #endif
        let coordinator = LiveActivityCoordinator()
        coordinator.attach(to: session)
        self.coordinator = coordinator
    }

    /// The settled push (an ask answered on another device, or expired).
    static func settle(requestId: String) async {
        guard #available(iOS 16.2, *) else { return }
        for activity in Activity<BotActivityAttributes>.activities where activity.content.state.requestId == requestId {
            let next = LiveActivityPlan.answered(activity.content.state, choice: "")
            await activity.update(ActivityContent(
                state: next, staleDate: Date().addingTimeInterval(LiveActivityPlan.backgroundStaleAfter),
                relevanceScore: LiveActivityPlan.relevance(next)
            ))
        }
    }
}

#if DEBUG
/// `-liveActivityPreview`: synthetic activities for simulator captures of the
/// island and the lock screen (no stream, no account, made-up bots).
/// `-liveActivityPreview stale` starts them already stale.
@available(iOS 16.2, *)
enum LiveActivityPreview {
    @discardableResult
    static func startIfRequested() -> Bool {
        let arguments = ProcessInfo.processInfo.arguments
        guard let i = arguments.firstIndex(of: "-liveActivityPreview") else { return false }
        let stale = i + 1 < arguments.count && arguments[i + 1] == "stale"
        for activity in Activity<BotActivityAttributes>.activities {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
        let start = Date().addingTimeInterval(-372)
        let ask = try? JSONDecoder().decode(OptionCard.self, from: Data(#"{"title":"Run a command","subtitle":"","options":["Allow","Deny"],"requestId":"preview-ask","tool":"Bash"}"#.utf8))
        let samples: [(BotActivityAttributes, BotActivityContent)] = [
            (BotActivityAttributes(botId: "preview-scout", threadId: "t-scout", name: "Scout", color: "blue", mascotLook: nil, mascotSkin: nil),
             BotActivityContent(face: "alerting", kind: "needsYou", headline: "Scout needs you", line: "Run npm install in the web project?", threadId: "t-scout", card: ask, since: start)),
            (BotActivityAttributes(botId: "preview-juniper", threadId: "t-juniper", name: "Juniper", color: "green", mascotLook: nil, mascotSkin: nil),
             BotActivityContent(face: "working", kind: "working", headline: "Juniper is working", line: "Reading the quarterly report", threadId: "t-juniper", card: nil, since: start)),
        ]
        for (attributes, content) in samples {
            _ = try? Activity.request(
                attributes: attributes,
                content: ActivityContent(state: content, staleDate: stale ? Date().addingTimeInterval(-1) : nil,
                                         relevanceScore: LiveActivityPlan.relevance(content)),
                pushType: nil
            )
        }
        return true
    }
}
#endif
