import Foundation

/// OpenTelemetry export (server/routes/telemetry.ts, #2609), as Settings >
/// Developer on the desktop reads it (src/lib/telemetry.ts). Header values go
/// up once; what comes back only names the saved headers.
public struct TelemetrySettingsView: Decodable, Equatable, Sendable {
    public struct Stats: Decodable, Equatable, Sendable {
        public var queued: Int?
        public var dropped: Int?
        public var exported: Int?
        public var failed: Int?
    }

    public var endpoint: String?
    public var headerNames: [String]
    public var serviceName: String?
    public var enabled: Bool
    public var stats: Stats?

    public init(endpoint: String? = nil, headerNames: [String] = [], serviceName: String? = nil, enabled: Bool = false, stats: Stats? = nil) {
        self.endpoint = endpoint
        self.headerNames = headerNames
        self.serviceName = serviceName
        self.enabled = enabled
        self.stats = stats
    }

    enum CodingKeys: String, CodingKey { case endpoint, headerNames, serviceName, enabled, stats }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        endpoint = try? c.decodeIfPresent(String.self, forKey: .endpoint)
        headerNames = (try? c.decodeIfPresent([String].self, forKey: .headerNames)) ?? []
        serviceName = try? c.decodeIfPresent(String.self, forKey: .serviceName)
        enabled = (try? c.decodeIfPresent(Bool.self, forKey: .enabled)) ?? false
        stats = try? c.decodeIfPresent(Stats.self, forKey: .stats)
    }

    /// The Trace export row's grey line, in English (looked up when drawn):
    /// the format and its arguments.
    public var summary: (format: String, arguments: [String]) {
        guard enabled, let endpoint, !endpoint.isEmpty else {
            return ("Off: enter a collector address to send traces.", [])
        }
        if let stats {
            return ("Sending to %@: %@ spans sent, %@ not accepted",
                    [endpoint, String(stats.exported ?? 0), String(stats.failed ?? 0)])
        }
        return ("Sending to %@", [endpoint])
    }
}

/// One header row of the form: a saved one keeps its value when left empty.
public struct TelemetryHeaderDraft: Identifiable, Equatable, Sendable {
    public var id = UUID()
    public var name: String
    public var value: String
    public var saved: Bool

    public init(name: String = "", value: String = "", saved: Bool = false) {
        self.name = name
        self.value = value
        self.saved = saved
    }

    /// `headerObject()` of TelemetrySettings.tsx: named rows that are saved
    /// or have a value; an empty value keeps the saved one.
    public static func object(_ rows: [TelemetryHeaderDraft]) -> [String: String] {
        var out: [String: String] = [:]
        for row in rows {
            let name = row.name.trimmingCharacters(in: .whitespacesAndNewlines)
            let value = row.value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty, row.saved || !value.isEmpty else { continue }
            out[name] = value
        }
        return out
    }
}

public extension CompanionClient {
    func telemetrySettings() async throws -> TelemetrySettingsView {
        try await send(makeRequest("GET", "/api/telemetry"), as: TelemetrySettingsView.self)
    }

    func saveTelemetry(endpoint: String, headers: [String: String], serviceName: String?) async throws -> TelemetrySettingsView {
        try await send(saveTelemetryRequest(endpoint: endpoint, headers: headers, serviceName: serviceName), as: TelemetrySettingsView.self)
    }

    func saveTelemetryRequest(endpoint: String, headers: [String: String], serviceName: String?) throws -> URLRequest {
        let name = serviceName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let body: [String: Any] = [
            "endpoint": endpoint.trimmingCharacters(in: .whitespacesAndNewlines),
            "headers": headers,
            "serviceName": name.isEmpty ? NSNull() : name,
        ]
        return try makeRequest("PUT", "/api/telemetry", body: body)
    }

    func removeTelemetry() async throws -> TelemetrySettingsView {
        try await send(makeRequest("DELETE", "/api/telemetry"), as: TelemetrySettingsView.self)
    }

    /// One test span to the typed collector, or to the saved one when `endpoint` is empty.
    func testTelemetry(endpoint: String, headers: [String: String]) async throws -> Bool {
        struct Answer: Decodable { var ok: Bool? }
        return try await send(testTelemetryRequest(endpoint: endpoint, headers: headers), as: Answer.self).ok == true
    }

    func testTelemetryRequest(endpoint: String, headers: [String: String]) throws -> URLRequest {
        let typed = endpoint.trimmingCharacters(in: .whitespacesAndNewlines)
        let body: [String: Any] = typed.isEmpty ? [:] : ["endpoint": typed, "headers": headers]
        return try makeRequest("POST", "/api/telemetry/test", body: body)
    }
}
