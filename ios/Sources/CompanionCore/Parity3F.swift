// iOS parity lot 3F. The phone calls routes the desktop already has.
// Sagax has no computer snapshot: recover is POST /api/computer/update
// (rebuild from the current image, files stay). Reset still erases the
// organization workspace. Word times are not on the wire (the settle in
// server/index.ts keeps only path and mime), so a transcript is placed
// by its share of the clip.
import Foundation

// MARK: - Computer recover (O4)

public enum ComputerCare {
    /// Up and usable.
    private static let running: Set<String> = ["running", "ready", "idle"]
    /// Asleep or not created yet on purpose (an organization's environments
    /// sleep off hours): it starts with the next task.
    private static let asleep: Set<String> = ["stopped", "paused", "missing", "starting"]

    /// True for a real failure only: a problem the computer reports, or a
    /// state that is neither up nor asleep. A computer that sleeps or wakes
    /// is left alone (parity R7 review: a rebuild removes installed apps).
    /// Same rule as the desktop (src/lib/computer-recover.ts).
    public static func needsRecover(configured: Bool, state: String, problem: String?, waking: Bool) -> Bool {
        guard configured else { return false }
        if let problem, !problem.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return true }
        return !running.contains(state) && !asleep.contains(state)
    }
}

// MARK: - Other computers (O5)

public enum OtherComputerRefusal: Equatable, Sendable {
    case online, rate, failed
}

public enum OtherComputers {
    /// Computers other than the one bots use now (the newest online one),
    /// most recently seen first. A desktop without an id cannot be named.
    public static func list(_ desktops: [PersonDesktop]) -> [PersonDesktop] {
        let current = desktops.filter(\.online).max { $0.lastSeenAt < $1.lastSeenAt }
        return desktops
            .filter { desktop in
                guard let id = desktop.id, !id.isEmpty else { return false }
                return id != current?.id
            }
            .sorted { $0.lastSeenAt > $1.lastSeenAt }
    }

    /// 1 to 120 characters, no control character. Nil when the server would refuse it.
    public static func name(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (1...120).contains(trimmed.count) else { return nil }
        if trimmed.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7F }) { return nil }
        return trimmed
    }

    public static func refusal(code: String?) -> OtherComputerRefusal {
        switch code {
        case "computer_online": return .online
        case "computer_rate": return .rate
        default: return .failed
        }
    }
}

public struct ComputerChangeFailure: Error, Equatable, Sendable {
    public var code: String?
    public var message: String

    public var refusal: OtherComputerRefusal { OtherComputers.refusal(code: code) }
}

// MARK: - Voice note words (P3)

public struct VoiceNoteWord: Codable, Hashable, Sendable {
    public var text: String
    public var start: Double
    public var end: Double

    public init(text: String, start: Double, end: Double) {
        self.text = text
        self.start = start
        self.end = end
    }
}

public enum VoiceNoteWords {
    /// The word playing at `time`, or -1. Matches `wordIndexAt` on the desktop.
    public static func index(at time: Double, in words: [VoiceNoteWord]) -> Int {
        for (index, word) in words.enumerated() where time >= word.start && time < word.end {
            return index
        }
        return -1
    }

    /// Place each word by its share of the characters. Empty when there is
    /// no duration, no word, or the text is longer than a voice note (1000).
    public static func aligned(transcript: String?, duration: Double) -> [VoiceNoteWord] {
        guard duration.isFinite, duration > 0, let transcript else { return [] }
        let trimmed = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 1000 else { return [] }
        let parts = trimmed.split(whereSeparator: \.isWhitespace).map(String.init)
        guard !parts.isEmpty, parts.count <= 200 else { return [] }
        let weights = parts.map { max(1, $0.count) }
        let total = weights.reduce(0, +)
        var cursor = 0.0
        return parts.enumerated().map { index, text in
            let share = duration * Double(weights[index]) / Double(total)
            let start = cursor
            cursor += share
            let end = index == parts.count - 1 ? duration : cursor
            return VoiceNoteWord(text: text, start: start, end: max(end, start))
        }
    }
}

// MARK: - Published pages (C10)

public struct PublishedPageVersion: Decodable, Hashable, Sendable, Identifiable {
    public var n: Int
    public var title: String
    public var state: String
    public var id: Int { n }
}

public struct PublishedPageSummary: Decodable, Hashable, Sendable, Identifiable {
    public var id: String
    public var title: String
    public var status: String
    public var access: String
    public var expiresAt: Double?
    public var url: String?
    public var expired: Bool
    public var updatedAt: Double
    public var versions: [PublishedPageVersion]

    public var isPublished: Bool { status == "published" && !expired }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        title = (try? values.decodeIfPresent(String.self, forKey: .title)) ?? ""
        status = (try? values.decodeIfPresent(String.self, forKey: .status)) ?? "draft"
        access = (try? values.decodeIfPresent(String.self, forKey: .access)) ?? "private"
        expiresAt = try? values.decodeIfPresent(Double.self, forKey: .expiresAt)
        url = try? values.decodeIfPresent(String.self, forKey: .url)
        expired = (try? values.decodeIfPresent(Bool.self, forKey: .expired)) ?? false
        updatedAt = (try? values.decodeIfPresent(Double.self, forKey: .updatedAt)) ?? 0
        versions = (try? values.decodeIfPresent([Lossy<PublishedPageVersion>].self, forKey: .versions))?.compactMap(\.value) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, status, access, expiresAt, url, expired, updatedAt, versions
    }
}

public enum PublishedPageAccess: String, CaseIterable, Sendable {
    case `private`, org, link

    /// Hours until the link expires. 0 means never.
    public static let expiryHours = [0, 24, 24 * 7, 24 * 30]
}

public enum PublishedPagesRules {
    public static func validID(_ id: String) -> Bool {
        (8...40).contains(id.utf8.count) && id.utf8.allSatisfy { byte in
            (48...57).contains(byte) || (65...90).contains(byte) || (97...122).contains(byte) || byte == 45 || byte == 95
        }
    }

    /// Milliseconds, or nil for never. The server wants a safe integer in the future.
    public static func expiresAt(hours: Int, now: Date = Date()) -> Int? {
        guard hours > 0 else { return nil }
        return Int((now.timeIntervalSince1970 * 1000).rounded()) + hours * 3_600_000
    }
}

// MARK: - Client

private struct PublishedPageListBody: Decodable {
    var pages: [Lossy<PublishedPageSummary>]?
}

private struct PublishedPageBody: Decodable {
    var page: PublishedPageSummary?
}

private struct ComputerChangeBody: Decodable {
    var error: String?
    var code: String?
}

public extension CompanionClient {
    /// `POST /api/me/desktop-bridge/computers/rename`.
    func renameDesktopComputer(id: String, name: String) async throws {
        guard let name = OtherComputers.name(name), isDesktopID(id) else {
            throw ComputerChangeFailure(code: "computer_name", message: "A computer's name is 1 to 120 characters.")
        }
        try await changeDesktopComputer("rename", ["computer": id, "name": name])
    }

    /// `POST /api/me/desktop-bridge/computers/remove`. Refused while it is online.
    func removeDesktopComputer(id: String) async throws {
        guard isDesktopID(id) else { throw ComputerChangeFailure(code: "computer_missing", message: "Name the computer.") }
        try await changeDesktopComputer("remove", ["computer": id])
    }

    func publishedPages() async throws -> [PublishedPageSummary] {
        let body = try await send(makeRequest("GET", "/api/pages"), as: PublishedPageListBody.self)
        return (body.pages ?? []).compactMap(\.value)
    }

    func setPublishedPageAccess(id: String, access: PublishedPageAccess) async throws -> PublishedPageSummary {
        guard PublishedPagesRules.validID(id) else { throw APIError.badURL }
        let body = try await send(
            makeRequest("PATCH", "/api/pages/\(id)", body: ["access": access.rawValue]),
            as: PublishedPageBody.self
        )
        return try requiredPage(body)
    }

    /// `hours` 0 clears the expiry. Any other value is a future time.
    func setPublishedPageExpiry(id: String, hours: Int) async throws -> PublishedPageSummary {
        guard PublishedPagesRules.validID(id) else { throw APIError.badURL }
        var body: [String: Any] = [:]
        if let at = PublishedPagesRules.expiresAt(hours: hours) {
            body["expiresAt"] = at
        } else {
            body["expiresAt"] = NSNull()
        }
        let answer = try await send(makeRequest("PATCH", "/api/pages/\(id)", body: body), as: PublishedPageBody.self)
        return try requiredPage(answer)
    }

    func revokePublishedPage(id: String) async throws -> PublishedPageSummary {
        guard PublishedPagesRules.validID(id) else { throw APIError.badURL }
        let answer = try await send(makeRequest("POST", "/api/pages/\(id)/revoke", body: [:]), as: PublishedPageBody.self)
        return try requiredPage(answer)
    }

    func deletePublishedPage(id: String) async throws {
        guard PublishedPagesRules.validID(id) else { throw APIError.badURL }
        try await send(makeRequest("DELETE", "/api/pages/\(id)"))
    }

    private func changeDesktopComputer(_ action: String, _ body: [String: String]) async throws {
        var fields: [String: Any] = [:]
        for (key, value) in body { fields[key] = value }
        let request = try makeRequest("POST", "/api/me/desktop-bridge/computers/\(action)", body: fields)
        let (data, response) = try await perform(request)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            let parsed = try? JSONDecoder().decode(ComputerChangeBody.self, from: data)
            throw ComputerChangeFailure(code: parsed?.code, message: parsed?.error ?? "That computer could not be changed.")
        }
    }

    private func requiredPage(_ body: PublishedPageBody) throws -> PublishedPageSummary {
        guard let page = body.page else {
            throw APIError.transport("The computer sent something this app couldn't read.")
        }
        return page
    }

    private func isDesktopID(_ id: String) -> Bool {
        CompanionClient.validRouteID(id)
    }
}
