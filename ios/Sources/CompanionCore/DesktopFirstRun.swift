// The guided first run and the guided tour's rules, ported from the
// desktop's src/lib/first-run.ts, src/lib/onboarding.ts and
// src/lib/guided-tour.ts so the iPad decides exactly as the desktop does:
// when the first run is due, which step it opens on, which tour step is next
// and how far along it is, and the `PUT /api/config` patches that record it.
import Foundation

/// `OnboardingStatus` (shared/wire.ts): the workspace's onboarding record.
public struct OnboardingStatus: Codable, Hashable, Sendable {
    public var completedAt: String?
    public var version: Int?
    public var hintsSeen: [String]?

    public init(completedAt: String? = nil, version: Int? = nil, hintsSeen: [String]? = nil) {
        self.completedAt = completedAt
        self.version = version
        self.hintsSeen = hintsSeen
    }
}

/// `InstanceInfo.install`: only its presence matters here.
public struct InstanceInstall: Codable, Hashable, Sendable {
    public var platform: String?

    public init(platform: String? = nil) { self.platform = platform }
}

public enum FirstRun {
    /// `WELCOME_VERSION`.
    public static let welcomeVersion = 1

    public enum Step: String, CaseIterable, Sendable {
        case engine, bot, message
    }

    /// `welcomeDue`: a workspace whose record is not complete at this
    /// version, for a session that can save it.
    public static func due(_ record: OnboardingStatus?, configLoaded: Bool, canSave: Bool) -> Bool {
        guard configLoaded, canSave else { return false }
        if let record, record.completedAt != nil, (record.version ?? 0) >= welcomeVersion { return false }
        return true
    }

    /// `firstRunInitialStep`.
    public static func initialStep(engineReady: Bool, botExists: Bool) -> Step {
        if !engineReady { return .engine }
        if !botExists { return .bot }
        return .message
    }

    /// `engineReady` (EngineLibrary.tsx).
    public static func engineReady(_ instance: Instance) -> Bool {
        if instance.driverKind == "clineAgent" {
            return instance.snapshot.state == "available" && instance.snapshot.authenticated == true
        }
        return instance.snapshot.state == "available"
            && (instance.access == "custom" || instance.snapshot.authenticated != false)
    }

    /// `engineSummary` without the company engines: the engines with an
    /// install recipe, ready first.
    public static func engines(_ instances: [Instance]) -> (ready: [Instance], setup: [Instance]) {
        let engines = instances.filter { $0.install != nil }
        return (engines.filter(engineReady), engines.filter { !engineReady($0) })
    }

    /// `completionPatch`.
    public static func completionPatch(now: Date = Date()) -> [String: Any] {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return ["onboarding": ["completedAt": formatter.string(from: now), "version": welcomeVersion]]
    }
}

public enum GuidedTour {
    public enum Placement: String, Sendable { case above, below, right }

    public enum Effect: String, Sendable {
        case openComputer, closeComputer, openTools, openApps, closeApps, openAutomations, backToChat
    }

    public struct Step: Hashable, Sendable {
        public let id: String
        public let anchor: String?
        public let skipIfMissing: Bool
        public let fallbackAnchor: String?
        public let placement: Placement
        public let onEnter: Effect?
        public let onExit: Effect?

        /// The copy's key suffix (`onboarding.tour.<copy>`).
        public var copy: String { String(id.dropFirst("tour.".count)) }
    }

    private static func step(_ id: String, _ anchor: String?, _ placement: Placement, skip: Bool = false,
                             fallback: String? = nil, enter: Effect? = nil, exit: Effect? = nil) -> Step {
        Step(id: id, anchor: anchor, skipIfMissing: skip, fallbackAnchor: fallback, placement: placement, onEnter: enter, onExit: exit)
    }

    /// `TOUR_STEPS`, in order.
    public static let steps: [Step] = [
        step("tour.composer", "composer", .above),
        step("tour.model", "composer-plus", .above),
        step("tour.computer", "computer", .below, exit: .openComputer),
        step("tour.computer-browser", "computer-browser", .below, skip: true, fallback: "computer-tabs", enter: .openComputer, exit: .closeComputer),
        step("tour.tools", "tools", .right, skip: true, exit: .openTools),
        step("tour.apps", "nav-apps", .right, skip: true, enter: .openTools, exit: .openApps),
        step("tour.apps-panel", "apps-panel", .below, skip: true, enter: .openApps, exit: .closeApps),
        step("tour.automations", "nav-automations", .right, skip: true, enter: .openTools, exit: .openAutomations),
        step("tour.automations-page", "automations-page", .below, skip: true, enter: .openAutomations, exit: .backToChat),
        step("tour.done", "composer", .above),
    ]

    /// `currentStep`: the first step not yet done.
    public static func current(_ record: OnboardingStatus?) -> Step? {
        let seen = Set(record?.hintsSeen ?? [])
        return steps.first { !seen.contains($0.id) }
    }

    /// `tourInProgress`.
    public static func inProgress(_ record: OnboardingStatus?) -> Bool {
        let seen = Set(record?.hintsSeen ?? [])
        return current(record) != nil && steps.contains { seen.contains($0.id) }
    }

    /// `stepNumber`: 1-based among the steps people see (all but done).
    public static func number(_ step: Step) -> (current: Int, total: Int) {
        let visible = steps.filter { $0.id != "tour.done" }
        let index = visible.firstIndex(of: step)
        return (index.map { $0 + 1 } ?? visible.count, visible.count)
    }

    /// `hintSeenPatch`: nil when the step is already recorded.
    public static func seenPatch(_ record: OnboardingStatus?, id: String) -> [String: Any]? {
        let seen = record?.hintsSeen ?? []
        if seen.contains(id) { return nil }
        return ["onboarding": ["hintsSeen": seen + [id]]]
    }

    /// `withTourFinished`, as the patch a skip sends.
    public static func finishedPatch(_ record: OnboardingStatus?) -> [String: Any] {
        var seen = record?.hintsSeen ?? []
        for step in steps where !seen.contains(step.id) { seen.append(step.id) }
        return ["onboarding": ["hintsSeen": seen]]
    }

    /// `withTourReset`: the hints without the tour, for a replay.
    public static func resetPatch(_ record: OnboardingStatus?) -> [String: Any] {
        let ids = Set(steps.map(\.id))
        return ["onboarding": ["hintsSeen": (record?.hintsSeen ?? []).filter { !ids.contains($0) }]]
    }
}

public extension CompanionClient {
    /// `PUT /api/config` with an onboarding patch; the answer is the new config.
    func saveOnboarding(_ patch: [String: Any]) async throws -> ConfigStatus {
        try await send(makeRequest("PUT", "/api/config", body: patch), as: ConfigStatus.self)
    }
}
