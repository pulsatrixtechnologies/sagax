// Parity lot R7 (O2): the bot's computer's scheduled update, read and set
// from the phone. Same route as the desktop's Settings > Computer
// (src/components/settings/ComputerCareSettings.tsx):
//
//   GET /api/computer/maintenance -> { schedule, nextWindowAt, lastResult?, running }
//   PUT /api/computer/maintenance  { enabled, days, hour, windowHours, timeZone }
//
// The server keys it to the person's own computer (server/routes/computer-care.ts).
import Foundation

public struct MaintenanceSchedule: Codable, Equatable, Sendable {
    public var enabled: Bool
    /// 0 = Sunday … 6 = Saturday, in `timeZone`.
    public var days: [Int]
    /// Start of the window, local hour 0-23.
    public var hour: Int
    /// 1 to 6 hours.
    public var windowHours: Int
    /// IANA zone of the person who set it.
    public var timeZone: String

    public init(enabled: Bool, days: [Int], hour: Int, windowHours: Int, timeZone: String) {
        self.enabled = enabled
        self.days = days
        self.hour = hour
        self.windowHours = windowHours
        self.timeZone = timeZone
    }

    /// What the server takes: days unique, in order and in range; hour and
    /// window clamped. Never an empty day list (the server refuses one).
    public var normalized: MaintenanceSchedule {
        var days = Array(Set(days.filter { (0...6).contains($0) })).sorted()
        if days.isEmpty { days = [0] }
        return MaintenanceSchedule(
            enabled: enabled,
            days: days,
            hour: min(23, max(0, hour)),
            windowHours: min(6, max(1, windowHours)),
            timeZone: timeZone.isEmpty ? "UTC" : timeZone
        )
    }

    /// Turn one day on or off. The last day stays on: a schedule needs one.
    public func toggling(day: Int) -> MaintenanceSchedule {
        guard (0...6).contains(day) else { return self }
        var next = self
        if days.contains(day) {
            guard days.count > 1 else { return self }
            next.days = days.filter { $0 != day }
        } else {
            next.days = days + [day]
        }
        return next.normalized
    }
}

public struct MaintenanceResult: Decodable, Equatable, Sendable {
    public enum Outcome: String, Decodable, Sendable {
        case updated, postponed, failed, unknown
        public init(from decoder: Decoder) throws {
            self = Outcome(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
        }
    }
    /// Epoch milliseconds.
    public var at: Double
    public var outcome: Outcome
    /// A short reason for a failure (an error sentence, never a secret).
    public var detail: String?
}

public struct ComputerMaintenance: Decodable, Equatable, Sendable {
    public var schedule: MaintenanceSchedule
    /// Epoch milliseconds of the next window's start, null when off.
    public var nextWindowAt: Double?
    public var lastResult: MaintenanceResult?
    public var running: Bool

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        schedule = try values.decode(MaintenanceSchedule.self, forKey: .schedule)
        nextWindowAt = try? values.decodeIfPresent(Double.self, forKey: .nextWindowAt)
        lastResult = try? values.decodeIfPresent(MaintenanceResult.self, forKey: .lastResult)
        running = (try? values.decodeIfPresent(Bool.self, forKey: .running)) ?? false
    }

    private enum CodingKeys: String, CodingKey { case schedule, nextWindowAt, lastResult, running }

    public var nextWindow: Date? { nextWindowAt.map { Date(timeIntervalSince1970: $0 / 1000) } }

    /// The schedule a first change starts from: the saved one, in the
    /// phone's zone when it was never set (the server's default is UTC).
    public func editable(phoneZone: String = TimeZone.current.identifier) -> MaintenanceSchedule {
        var schedule = self.schedule
        if !schedule.enabled && schedule.timeZone == "UTC" { schedule.timeZone = phoneZone }
        return schedule.normalized
    }
}

public extension CompanionClient {
    /// `GET /api/computer/maintenance`.
    func computerMaintenance() async throws -> ComputerMaintenance {
        try await send(makeRequest("GET", "/api/computer/maintenance"), as: ComputerMaintenance.self)
    }

    /// `PUT /api/computer/maintenance`: the whole schedule, normalized.
    func setComputerMaintenance(_ schedule: MaintenanceSchedule) async throws -> ComputerMaintenance {
        try await send(setComputerMaintenanceRequest(schedule), as: ComputerMaintenance.self)
    }

    func setComputerMaintenanceRequest(_ schedule: MaintenanceSchedule) throws -> URLRequest {
        try makeRequest("PUT", "/api/computer/maintenance", encodedBody: schedule.normalized)
    }
}
