// Settings > Usage > Plan usage (`src/components/PlanUsage.tsx`): each
// signed-in provider's remaining subscription allowance, its 5-hour and
// weekly windows and any extra or per-model windows (GET /api/plan-usage,
// `?refresh=1` asks the providers again). An admin's Settings section.
import Foundation

public struct PlanUsageReport: Decodable, Equatable, Sendable {
    public struct Window: Decodable, Equatable, Sendable {
        public var available: Bool
        public var remainingPercent: Double?
        public var usedPercent: Double?
        public var resetsAt: String?

        public init(available: Bool, remainingPercent: Double?, usedPercent: Double?, resetsAt: String?) {
            self.available = available; self.remainingPercent = remainingPercent; self.usedPercent = usedPercent; self.resetsAt = resetsAt
        }
    }

    public struct Extra: Decodable, Equatable, Sendable {
        public var label: String
        public var remainingPercent: Double
        public var usedPercent: Double
        public var resetsAt: String?
        public var window: Window { Window(available: true, remainingPercent: remainingPercent, usedPercent: usedPercent, resetsAt: resetsAt) }
    }

    public struct ModelUsage: Decodable, Equatable, Sendable {
        public var name: String
        public var windows: [Extra]
    }

    public struct Provider: Decodable, Equatable, Sendable, Identifiable {
        public var id: String
        public var name: String
        public var plan: String?
        public var ok: Bool
        public var error: String?
        public var fiveHour: Window
        public var weekly: Window
        public var extra: [Extra]
        public var models: [ModelUsage]?
        /// "windows", "no-windows", "signed-out" or "error" (#1774); an
        /// older server names none (`ok` decides).
        public var state: String?
        public var access: String?
        public var instanceId: String?

        /// The row's state as the desktop reads it (`legacyState`).
        public var rowState: String { state ?? (ok ? "windows" : (error == nil ? "signed-out" : "error")) }
    }

    public var fetchedAt: String?
    public var providers: [Provider]
}

public enum PlanUsageRules {
    private static func date(_ iso: String?) -> Date? {
        guard let iso else { return nil }
        let full = ISO8601DateFormatter()
        full.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = full.date(from: iso) { return date }
        return ISO8601DateFormatter().date(from: iso)
    }

    /// `formatResetDistance`: "2d 3h", "4h 10m", "12m", "less than a minute", or nil when past or unknown.
    public static func resetDistance(_ resetsAt: String?, now: Date) -> String? {
        guard let at = date(resetsAt), at > now else { return nil }
        let minutes = Int((at.timeIntervalSince(now) / 60).rounded(.down))
        if minutes < 1 { return "less than a minute" }
        let days = minutes / 1440, hours = (minutes % 1440) / 60, mins = minutes % 60
        if days > 0 { return hours > 0 ? "\(days)d \(hours)h" : "\(days)d" }
        if hours > 0 { return mins > 0 ? "\(hours)h \(mins)m" : "\(hours)h" }
        return "\(mins)m"
    }

    /// `usageTone`: danger from 90 % used, warning from 70 %, else success.
    public enum Tone: Equatable, Sendable { case success, warning, danger }
    public static func tone(used: Double) -> Tone {
        used >= 90 ? .danger : used >= 70 ? .warning : .success
    }

    /// `connectedPlanRows` (2026-10-15): only the providers that are connected
    /// and answer. One in error or not signed in is left out, and with none
    /// left the Plan card is not drawn.
    public static func connected(_ report: PlanUsageReport?) -> [PlanUsageReport.Provider] {
        (report?.providers ?? []).filter(\.ok)
    }

    /// `usagePercent` (src/lib/account-menu.ts): the figure beside the
    /// account menu's plan row ("4% used"), the HIGHEST of the connected
    /// plans, each read on its weekly window (its 5-hour window when it
    /// reports no weekly one), rounded and clamped; nil without a plan that
    /// reports one.
    public static func menuPercent(_ report: PlanUsageReport?) -> Int? {
        var best: Int?
        for provider in report?.providers ?? [] {
            if let state = provider.state, state != "windows" { continue }
            if provider.state == nil, !provider.ok { continue }
            let window = provider.weekly.available && provider.weekly.usedPercent != nil ? provider.weekly : provider.fiveHour
            guard window.available, let used = window.usedPercent, used.isFinite else { continue }
            let value = Int(min(100, max(0, used)).rounded())
            best = best.map { max($0, value) } ?? value
        }
        return best
    }

    /// A deadline that has passed since the report: ask the providers again.
    public static func hasDueReset(_ report: PlanUsageReport, now: Date) -> Bool {
        report.providers.contains { provider in
            guard provider.ok else { return false }
            let stamps = [provider.fiveHour.available ? provider.fiveHour.resetsAt : nil,
                          provider.weekly.available ? provider.weekly.resetsAt : nil]
                + provider.extra.map(\.resetsAt) + (provider.models ?? []).flatMap { $0.windows.map(\.resetsAt) }
            return stamps.contains { stamp in date(stamp).map { $0 <= now } ?? false }
        }
    }
}

public extension CompanionClient {
    /// `GET /api/plan-usage[?refresh=1]`.
    func planUsage(refresh: Bool = false) async throws -> PlanUsageReport {
        var request = try makeRequest("GET", "/api/plan-usage", query: refresh ? [URLQueryItem(name: "refresh", value: "1")] : [])
        request.timeoutInterval = 60
        return try await send(request, as: PlanUsageReport.self)
    }
}
