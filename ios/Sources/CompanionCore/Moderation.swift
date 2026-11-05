// Content between people (App Store guideline 1.2; server/safety/moderation.ts,
// src/lib/moderation.ts): Report a message another person wrote (it goes
// to the organization's admins, or a solo server's owner, through the
// server), Block a person (personal: their lines fold away for me only, on
// every device of mine), and the terms of use accepted once per account.
//
// A bot's reply keeps its own Report (MessageReport: an email to
// Pulsatrix). This file is the person path only.
//
// Routes (request-auth.ts CLIENT_ALLOW): POST /api/threads/:t/messages/:m/report,
// GET/POST /api/me/blocks, DELETE /api/me/blocks/:id, GET/POST /api/me/terms.
// The demo answers each of them (Demo.swift).
import Foundation

public enum Moderation {
    /// The terms the person accepts (https://pulsatrix.ca/terms).
    public static let termsURL = URL(string: "https://pulsatrix.ca/terms")!
    public static let termsVersion = "2026-10-26"

    public enum Reason: String, CaseIterable, Identifiable, Codable, Sendable {
        case harassment, hate, sexual, violence, spam, privacy, other
        public var id: String { rawValue }
    }

    public struct BlockedPerson: Codable, Hashable, Identifiable, Sendable {
        public var id: String
        public var name: String
        public var at: Double

        public init(id: String, name: String, at: Double) {
            self.id = id
            self.name = name
            self.at = at
        }
    }

    public struct TermsStatus: Codable, Hashable, Sendable {
        public var accepted: Bool
        public var current: String
        public var url: String?
        public var version: String?
        public var acceptedAt: Double?

        public init(accepted: Bool, current: String = Moderation.termsVersion, url: String? = nil, version: String? = nil, acceptedAt: Double? = nil) {
            self.accepted = accepted
            self.current = current
            self.url = url
            self.version = version
            self.acceptedAt = acceptedAt
        }
    }

    /// A report people sent (`GET /api/moderation/reports`, admins only):
    /// Settings > Notifications > Reports.
    public struct Report: Codable, Hashable, Identifiable, Sendable {
        public var id: String
        public var at: Double
        public var groupName: String?
        public var peopleDm: Bool?
        public var reportedName: String?
        public var reason: String
        public var note: String?
        public var excerpt: String?
        public var reporterName: String?
        public var status: String

        public init(id: String, at: Double, groupName: String? = nil, peopleDm: Bool? = nil, reportedName: String? = nil,
                    reason: String, note: String? = nil, excerpt: String? = nil, reporterName: String? = nil, status: String) {
            self.id = id
            self.at = at
            self.groupName = groupName
            self.peopleDm = peopleDm
            self.reportedName = reportedName
            self.reason = reason
            self.note = note
            self.excerpt = excerpt
            self.reporterName = reporterName
            self.status = status
        }

        public var isOpen: Bool { status == "open" }
    }

    /// The open reports, then the last 20 handled (ModerationSettings.tsx).
    public static func listed(_ reports: [Report]) -> [Report] {
        reports.filter(\.isOpen) + Array(reports.filter { $0.status == "resolved" }.prefix(20))
    }

    /// The person behind a line someone else wrote.
    public struct Author: Hashable, Sendable {
        public var id: String
        public var name: String

        public init(id: String, name: String) {
            self.id = id
            self.name = name
        }
    }

    static func norm(_ value: String?) -> String {
        (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// The person behind another person's text line, or nil: your own lines,
    /// a bot's reply, a line nobody is named on.
    ///
    /// A person's line is a user line whose `sender` is someone other than
    /// the viewer (RoomAuthor.of). In a room, a line whose `from` names no
    /// bot this phone knows is a person's too: the older room shape, the one
    /// the demo's Sam Rivera line has.
    public static func personAuthor(of message: Message, viewer: RoomViewer, inRoom: Bool, isBot: (String) -> Bool) -> Author? {
        guard message.kind == .text, !message.id.hasPrefix("optimistic-") else { return nil }
        if message.role == .user {
            guard let sender = message.sender else { return nil }
            let id = norm(sender.id)
            guard !id.isEmpty, id != norm(viewer.principalId) else { return nil }
            if let email = viewer.normalizedEmail, id == email { return nil }
            let name = sender.name.trimmingCharacters(in: .whitespacesAndNewlines)
            return Author(id: id, name: name.isEmpty ? id : name)
        }
        guard inRoom, let from = message.from, !isBot(from.botId) else { return nil }
        let id = norm(from.botId)
        guard !id.isEmpty else { return nil }
        return Author(id: id, name: from.name)
    }

    /// Whether this line is from someone the viewer blocked.
    public static func isBlocked(_ message: Message, viewer: RoomViewer, inRoom: Bool, isBot: (String) -> Bool, blocked: Set<String>) -> Bool {
        guard !blocked.isEmpty, let author = personAuthor(of: message, viewer: viewer, inRoom: inRoom, isBot: isBot) else { return false }
        return blocked.contains(author.id)
    }

    /// The ids of a blocked list, as `isBlocked` reads them.
    public static func ids(_ people: [BlockedPerson]) -> Set<String> {
        Set(people.map { norm($0.id) })
    }

    /// A direct conversation between two people whose other person the
    /// viewer blocked: its notices stay quiet.
    public static func isBlockedDM(_ room: Room, viewerId: String?, blocked: Set<String>) -> Bool {
        guard room.peopleDm == true, !blocked.isEmpty else { return false }
        let me = norm(viewerId)
        let others = (room.humanIds ?? []).map(norm).filter { $0 != me && !$0.isEmpty }
        return !others.isEmpty && others.allSatisfy(blocked.contains)
    }
}

// MARK: - The server's routes

public extension CompanionClient {
    struct ReportReceipt: Codable, Hashable, Sendable {
        public var id: String
        public var at: Double?
        public var status: String?
    }

    private struct ReportBody: Encodable {
        let reason: String
        let note: String?
    }

    private struct ReportAnswer: Decodable { let report: ReportReceipt }
    private struct BlocksAnswer: Decodable { let people: [Moderation.BlockedPerson] }

    func reportMessageRequest(threadId: String, messageId: String, reason: Moderation.Reason, note: String) throws -> URLRequest {
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        return try makeRequest("POST", "/api/threads/\(threadId)/messages/\(messageId)/report",
                               encodedBody: ReportBody(reason: reason.rawValue, note: trimmed.isEmpty ? nil : String(trimmed.prefix(1_000))))
    }

    /// Report another person's message to the admins.
    @discardableResult
    func reportMessage(threadId: String, messageId: String, reason: Moderation.Reason, note: String) async throws -> ReportReceipt {
        try await send(reportMessageRequest(threadId: threadId, messageId: messageId, reason: reason, note: note), as: ReportAnswer.self).report
    }

    func blockedPeopleRequest() throws -> URLRequest { try makeRequest("GET", "/api/me/blocks") }

    /// The people this person blocked.
    func blockedPeople() async throws -> [Moderation.BlockedPerson] {
        try await send(blockedPeopleRequest(), as: BlocksAnswer.self).people
    }

    func blockRequest(_ author: Moderation.Author) throws -> URLRequest {
        try makeRequest("POST", "/api/me/blocks", body: ["id": author.id, "name": author.name])
    }

    /// Block a person, for this person only. Answers the whole list.
    func block(_ author: Moderation.Author) async throws -> [Moderation.BlockedPerson] {
        try await send(blockRequest(author), as: BlocksAnswer.self).people
    }

    func unblockRequest(id: String) throws -> URLRequest {
        try makeRequest("DELETE", "/api/me/blocks/\(id)")
    }

    func unblock(id: String) async throws -> [Moderation.BlockedPerson] {
        try await send(unblockRequest(id: id), as: BlocksAnswer.self).people
    }

    private struct ReportsAnswer: Decodable { let reports: [Moderation.Report]? }
    private struct ReportOne: Decodable { let report: Moderation.Report }

    func moderationReportsRequest() throws -> URLRequest { try makeRequest("GET", "/api/moderation/reports") }

    /// Every report people sent, newest first (an admin, a solo server's owner).
    func moderationReports() async throws -> [Moderation.Report] {
        try await send(moderationReportsRequest(), as: ReportsAnswer.self).reports ?? []
    }

    func resolveReportRequest(id: String) throws -> URLRequest {
        try makeRequest("POST", "/api/moderation/reports/\(id)/resolve")
    }

    /// Mark one report handled.
    @discardableResult
    func resolveReport(id: String) async throws -> Moderation.Report {
        try await send(resolveReportRequest(id: id), as: ReportOne.self).report
    }

    func termsRequest() throws -> URLRequest { try makeRequest("GET", "/api/me/terms") }

    /// Whether this person accepted the terms (once per account).
    func terms() async throws -> Moderation.TermsStatus {
        try await send(termsRequest(), as: Moderation.TermsStatus.self)
    }

    func acceptTermsRequest(version: String) throws -> URLRequest {
        try makeRequest("POST", "/api/me/terms", body: ["version": version])
    }

    @discardableResult
    func acceptTerms(version: String = Moderation.termsVersion) async throws -> Moderation.TermsStatus {
        try await send(acceptTermsRequest(version: version), as: Moderation.TermsStatus.self)
    }
}
