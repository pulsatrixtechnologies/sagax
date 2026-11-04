// Settings > Backups > Restore a backup (WorkspaceBackupSettings.tsx): the
// file goes up once (`POST /api/workspace-backup/upload`), its password opens
// it (`/preview`: what it holds), and Replace installation, once REPLACE is
// typed, restores it (`/restore`). The password is sent once and kept nowhere.
import Foundation

public struct WorkspaceBackupSummary: Decodable, Equatable, Sendable {
    public var createdAt: String?
    public var appVersion: String?
    public var bots: Int
    public var groups: Int
    public var threads: Int
    public var messages: Int
    public var files: Int
}

public struct WorkspaceBackupPreview: Decodable, Equatable, Sendable {
    public var id: String
    public var summary: WorkspaceBackupSummary
}

public enum WorkspaceRestore {
    /// The word typed before a restore.
    public static let confirmation = "REPLACE"
    public static func ready(_ typed: String) -> Bool { typed == confirmation }
}

public extension CompanionClient {
    func uploadWorkspaceBackupRequest(_ data: Data) throws -> URLRequest {
        var request = try makeRequest("POST", "/api/workspace-backup/upload")
        request.setValue("application/octet-stream", forHTTPHeaderField: "content-type")
        request.httpBody = data
        request.timeoutInterval = 300
        return request
    }

    func uploadWorkspaceBackup(_ data: Data) async throws -> String {
        struct Answer: Decodable { var id: String }
        return try await send(uploadWorkspaceBackupRequest(data), as: Answer.self).id
    }

    func previewWorkspaceBackup(id: String, password: String) async throws -> WorkspaceBackupPreview {
        guard Self.validRouteID(id) else { throw APIError.badURL }
        return try await send(makeRequest("POST", "/api/workspace-backup/preview", body: ["id": id, "password": password]), as: WorkspaceBackupPreview.self)
    }

    func restoreWorkspaceBackupRequest(id: String) throws -> URLRequest {
        guard Self.validRouteID(id) else { throw APIError.badURL }
        return try makeRequest("POST", "/api/workspace-backup/restore", body: ["id": id, "confirmation": WorkspaceRestore.confirmation])
    }

    func restoreWorkspaceBackup(id: String) async throws {
        let (data, response) = try await perform(restoreWorkspaceBackupRequest(id: id))
        try Self.check(response, data)
    }
}
