// Settings > Computer > Computer care > Disk saver (ComputerCareSettings.tsx,
// server/routes/computer-care.ts): what a cleanup of the bot's computer would
// free, then the chosen categories only; the trash only once confirmed.
import Foundation

public struct DiskSaverPreview: Decodable, Equatable, Sendable {
    public struct Item: Decodable, Equatable, Sendable, Identifiable {
        public var id: String
        public var bytes: Double
        public var userFiles: Bool
    }
    public var computerRunning: Bool
    public var items: [Item]
    public var totalBytes: Double

    /// `defaultSelection`: what has something to free and is not the person's own files.
    public var defaultSelection: Set<String> { Set(items.filter { $0.bytes > 0 && !$0.userFiles }.map(\.id)) }

    public func bytes(of selection: Set<String>) -> Double { items.filter { selection.contains($0.id) }.reduce(0) { $0 + $1.bytes } }

    public func touchesUserFiles(_ selection: Set<String>) -> Bool { items.contains { $0.userFiles && selection.contains($0.id) } }
}

public struct DiskSaverResult: Decodable, Equatable, Sendable {
    public var freedBytes: Double
    public var preview: DiskSaverPreview
}

public extension CompanionClient {
    func diskSaverPreview() async throws -> DiskSaverPreview {
        try await send(makeRequest("GET", "/api/computer/disk-saver"), as: DiskSaverPreview.self)
    }

    func diskSaverCleanRequest(_ categories: Set<String>, userFiles: Bool) throws -> URLRequest {
        var body: [String: Any] = ["categories": categories.sorted()]
        if userFiles { body["confirmUserFiles"] = true }
        return try makeRequest("POST", "/api/computer/disk-saver", body: body)
    }

    func diskSaverClean(_ categories: Set<String>, userFiles: Bool) async throws -> DiskSaverResult {
        try await send(diskSaverCleanRequest(categories, userFiles: userFiles), as: DiskSaverResult.self)
    }
}
