import Foundation

// The Edit bot window's Personality and Skills pages on the iPad (round 4 of
// the parity sweep), the same requests as the desktop's sections:
// SoulField.tsx (the drift banner's file text and its Use the file / Keep
// the saved version), SkillsSection.tsx (the library pool, each skill's
// origin, Share and Stop sharing), SkillUpload.tsx (`skill-upload`, preview
// then install) and WriteCommandCard.tsx (`skill-template`, the written
// command as an ordinary SKILL.md, shared/written-skill.ts).

// MARK: - Soul

/// `GET /api/bots/:id/soul` with the file text the drift banner shows.
public struct SoulFileState: Decodable, Equatable, Sendable {
    public var revision: String?
    public var drift: Bool
    public var file: String?
    public var fileText: String?

    private enum CodingKeys: String, CodingKey { case revision, drift, file, fileText }

    public init(revision: String? = nil, drift: Bool = false, file: String? = nil, fileText: String? = nil) {
        self.revision = revision
        self.drift = drift
        self.file = file
        self.fileText = fileText
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        if let text = try? values.decodeIfPresent(String.self, forKey: .revision) {
            revision = text
        } else if let number = try? values.decodeIfPresent(Int.self, forKey: .revision) {
            revision = String(number)
        }
        drift = (try? values.decodeIfPresent(Bool.self, forKey: .drift)) ?? false
        file = try? values.decodeIfPresent(String.self, forKey: .file)
        fileText = try? values.decodeIfPresent(String.self, forKey: .fileText)
    }
}

public enum SoulDriftChoice: String, Sendable {
    case applyFile = "apply-file"
    case discardFile = "discard-file"
}

// MARK: - Skills listing

/// Where the bot reads a skill from (`features.skillsLibrary`).
public enum SkillOrigin: String, Decodable, Sendable {
    case `private`, library, me
}

/// The fields of a listed skill the iPad's `ManagedSkill` does not keep.
public struct SkillOriginInfo: Decodable, Hashable, Sendable {
    public struct AssignedBot: Decodable, Hashable, Sendable {
        public var id: String
        public var name: String
    }

    public var name: String
    public var origin: SkillOrigin?
    public var assignedBots: [AssignedBot]

    private enum CodingKeys: String, CodingKey { case name, origin, assignedBots }

    public init(name: String, origin: SkillOrigin? = nil, assignedBots: [AssignedBot] = []) {
        self.name = name
        self.origin = origin
        self.assignedBots = assignedBots
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        name = try values.decode(String.self, forKey: .name)
        origin = try? values.decodeIfPresent(SkillOrigin.self, forKey: .origin)
        assignedBots = (try? values.decodeIfPresent([Lossy<AssignedBot>].self, forKey: .assignedBots))?.compactMap(\.value) ?? []
    }
}

/// A library skill the bot has not been assigned yet.
public struct LibraryPoolSkill: Decodable, Hashable, Sendable, Identifiable {
    public var name: String
    public var description: String
    public var id: String { name }

    private enum CodingKeys: String, CodingKey { case name, description }

    public init(name: String, description: String = "") {
        self.name = name
        self.description = description
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        name = try values.decode(String.self, forKey: .name)
        description = (try? values.decodeIfPresent(String.self, forKey: .description)) ?? ""
    }
}

/// `GET /api/bots/:id/skills`: what `BotSkills` leaves out.
public struct SkillsLibraryListing: Decodable, Hashable, Sendable {
    public var origins: [SkillOriginInfo]
    public var library: [LibraryPoolSkill]
    public var assignedSkills: [String]

    private enum CodingKeys: String, CodingKey { case skills, library, assignedSkills }

    public init(origins: [SkillOriginInfo] = [], library: [LibraryPoolSkill] = [], assignedSkills: [String] = []) {
        self.origins = origins
        self.library = library
        self.assignedSkills = assignedSkills
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        origins = (try? values.decodeIfPresent([Lossy<SkillOriginInfo>].self, forKey: .skills))?.compactMap(\.value) ?? []
        library = (try? values.decodeIfPresent([Lossy<LibraryPoolSkill>].self, forKey: .library))?.compactMap(\.value) ?? []
        assignedSkills = (try? values.decodeIfPresent([String].self, forKey: .assignedSkills)) ?? []
    }

    public func origin(of name: String) -> SkillOriginInfo? { origins.first { $0.name == name } }
}

/// The desktop's `skillSourceLabel` (src/lib/skills-ui.ts), untranslated as there.
public enum SkillSourceLabel {
    public static func of(_ source: String) -> String {
        if source.isEmpty { return "Source" }
        if source.hasPrefix("learn:inbox/") { return "Learned from inbox" }
        if source.hasPrefix("learn:") { return "Learned" }
        if source.hasPrefix("org:") { return "Organization library" }
        if source == "local-import" { return "Imported" }
        if source.hasPrefix("upload:") { return "Uploaded" }
        if source.hasPrefix("github:") || source.contains("github.com") { return "GitHub" }
        if source.contains("skills.sh") { return "skills.sh" }
        return "Source"
    }
}

// MARK: - Upload

/// One file picked for Skills > Upload, its bytes in base64.
public struct SkillUploadFile: Encodable, Hashable, Sendable {
    public var name: String
    public var data: String

    public init(name: String, data: String) {
        self.name = name
        self.data = data
    }
}

/// One file of the upload's preview (server/skills/skill-upload.ts).
public struct SkillUploadItem: Decodable, Hashable, Sendable {
    public struct Problem: Decodable, Hashable, Sendable {
        public var code: String
        public var subject: String?
        public var detail: String
    }

    public struct Skill: Decodable, Hashable, Sendable {
        public var name: String
        public var description: String
        public var warnings: [String]
        public var skippedFiles: [String]
        public var skippedCount: Int

        private enum CodingKeys: String, CodingKey { case name, description, warnings, skippedFiles, skippedCount }

        public init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            name = try values.decode(String.self, forKey: .name)
            description = (try? values.decodeIfPresent(String.self, forKey: .description)) ?? ""
            warnings = (try? values.decodeIfPresent([String].self, forKey: .warnings)) ?? []
            skippedFiles = (try? values.decodeIfPresent([String].self, forKey: .skippedFiles)) ?? []
            skippedCount = (try? values.decodeIfPresent(Int.self, forKey: .skippedCount)) ?? 0
        }
    }

    public var file: String
    public var errors: [Problem]
    public var ignored: [String]
    public var ignoredCount: Int
    public var skills: [Skill]

    private enum CodingKeys: String, CodingKey { case file, errors, ignored, ignoredCount, skills }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        file = (try? values.decodeIfPresent(String.self, forKey: .file)) ?? ""
        errors = (try? values.decodeIfPresent([Lossy<Problem>].self, forKey: .errors))?.compactMap(\.value) ?? []
        ignored = (try? values.decodeIfPresent([String].self, forKey: .ignored)) ?? []
        ignoredCount = (try? values.decodeIfPresent(Int.self, forKey: .ignoredCount)) ?? 0
        skills = (try? values.decodeIfPresent([Lossy<Skill>].self, forKey: .skills))?.compactMap(\.value) ?? []
    }
}

public enum SkillUploadRules {
    /// Mirrors server/skills/skill-upload.ts.
    public static let maxFiles = 10
    public static let markdownMaxBytes = 256 * 1024
    public static let zipMaxBytes = 5 * 1024 * 1024
    public static let totalMaxBytes = 10 * 1024 * 1024

    /// True when a file of that name and size is too large to send.
    public static func tooLarge(name: String, bytes: Int) -> Bool {
        bytes > (name.lowercased().hasSuffix(".zip") ? zipMaxBytes : markdownMaxBytes)
    }
}

private struct SkillUploadPreviewAnswer: Decodable { var items: [Lossy<SkillUploadItem>]? }
private struct SkillUploadInstallAnswer: Decodable { var installed: [String]? }
private struct SkillUploadBody: Encodable {
    var mode: String
    var files: [SkillUploadFile]
}

// MARK: - Written command

/// A command written in Skills > Write a command (shared/written-skill.ts).
public enum WrittenSkill {
    public static let source = "written:bot settings"
    public static let instructionsMax = 16_000
    public static let descriptionMax = 1024
    public static let nameMax = 64
    static let reserved: Set<String> = ["goal", "learn", "setup"]

    public enum Problem: String, Sendable { case name, reserved, taken, description, instructions }

    /// `isSkillName`: lowercase letters and digits in runs joined by single dashes.
    public static func validName(_ name: String) -> Bool {
        guard !name.isEmpty, name.count <= nameMax else { return false }
        return name.split(separator: "-", omittingEmptySubsequences: false).allSatisfy { part in
            !part.isEmpty && part.utf8.allSatisfy { (97...122).contains($0) || (48...57).contains($0) }
        }
    }

    /// The name field as the desktop types it: lowercase, spaces become dashes.
    public static func typedName(_ value: String) -> String {
        value.lowercased().replacingOccurrences(of: #"\s+"#, with: "-", options: .regularExpression)
    }

    /// One line, no quotes at its ends.
    public static func description(_ value: String) -> String {
        value.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"^["']+|["']+$"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    public static func problem(name: String, description: String, instructions: String, taken: [String] = []) -> Problem? {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !validName(name) { return .name }
        if reserved.contains(name) { return .reserved }
        if taken.contains(name) { return .taken }
        let line = Self.description(description)
        if line.isEmpty || line.count > descriptionMax { return .description }
        let body = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
        if body.isEmpty || body.count > instructionsMax { return .instructions }
        return nil
    }

    /// The SKILL.md, or nil for a draft `problem` rejects.
    public static func markdown(name: String, description: String, instructions: String) -> String? {
        guard problem(name: name, description: description, instructions: instructions) == nil else { return nil }
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return "---\nname: \(name)\ndescription: \(Self.description(description))\n---\n\n"
            + "# /\(name)\n\n"
            + "A command the user wrote. When they run /\(name), follow these instructions. "
            + "Where they say {input}, use what the user typed after the command.\n\n"
            + "\(instructions.trimmingCharacters(in: .whitespacesAndNewlines))\n"
    }
}

// MARK: - Calls

private struct FeatureLibraryConfig: Decodable {
    struct Features: Decodable { let skillsLibrary: Bool?; let skillAuthoring: Bool? }
    let features: Features?
}

private struct SkillTextAnswer: Decodable { var text: String? }

public extension CompanionClient {
    /// `features.skillsLibrary` and `features.skillAuthoring` of `/api/config`, on unless switched off.
    func skillsPageFlags() async throws -> (library: Bool, authoring: Bool) {
        let config = try await send(try makeRequest("GET", "/api/config"), as: FeatureLibraryConfig.self)
        return (config.features?.skillsLibrary != false, config.features?.skillAuthoring != false)
    }

    /// `GET /api/bots/:id/soul` (the drift state and the file's text).
    func soulFileState(botId: String) async throws -> SoulFileState {
        try await send(botRequest("GET", botId, "/soul"), as: SoulFileState.self)
    }

    func resolveSoulDriftRequest(botId: String, choice: SoulDriftChoice, fileText: String, expectedRevision: String) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try makeRequest("POST", "/api/bots/\(botId)/soul/\(choice.rawValue)",
                               body: ["fileText": fileText, "expectedRevision": expectedRevision])
    }

    /// `POST /api/bots/:id/soul/apply-file` or `discard-file`.
    func resolveSoulDrift(botId: String, choice: SoulDriftChoice, fileText: String, expectedRevision: String) async throws {
        try await send(resolveSoulDriftRequest(botId: botId, choice: choice, fileText: fileText, expectedRevision: expectedRevision))
    }

    /// `GET /api/bots/:id/skills`: the origins, the library pool and the assignments.
    func skillsLibraryListing(botId: String) async throws -> SkillsLibraryListing {
        try await send(botRequest("GET", botId, "/skills"), as: SkillsLibraryListing.self)
    }

    /// Where a skill's text and switch live: the bot, the library or the person's shelf.
    func skillOriginPath(botId: String, name: String, origin: SkillOrigin?) throws -> String {
        guard Self.validRouteID(botId), SkillRules.validName(name) else { throw APIError.badURL }
        switch origin {
        case .library: return "/api/skills-library/\(name)"
        case .me: return "/api/me/skills-library/\(name)"
        default: return "/api/bots/\(botId)/skills/\(name)"
        }
    }

    /// The SKILL.md of a skill, from where the bot reads it.
    func skillOriginText(botId: String, name: String, origin: SkillOrigin?) async throws -> String? {
        try await send(makeRequest("GET", skillOriginPath(botId: botId, name: name, origin: origin)), as: SkillTextAnswer.self).text
    }

    func setSkillOriginEnabledRequest(botId: String, name: String, origin: SkillOrigin?, enabled: Bool) throws -> URLRequest {
        try makeRequest("PATCH", skillOriginPath(botId: botId, name: name, origin: origin), body: ["enabled": enabled])
    }

    /// `PATCH {enabled}` where the skill lives.
    func setSkillOriginEnabled(botId: String, name: String, origin: SkillOrigin?, enabled: Bool) async throws {
        try await send(setSkillOriginEnabledRequest(botId: botId, name: name, origin: origin, enabled: enabled))
    }

    func shareSkillRequest(botId: String, name: String, scope: String, stop: Bool) throws -> URLRequest {
        guard Self.validRouteID(botId), SkillRules.validName(name), scope == "me" || scope == "organization" else { throw APIError.badURL }
        return try makeRequest("POST", "/api/bots/\(botId)/skills/\(name)/\(stop ? "unshare" : "share")", body: ["scope": scope])
    }

    /// `POST /api/bots/:id/skills/:name/share|unshare {scope}`.
    func shareSkill(botId: String, name: String, scope: String, stop: Bool) async throws {
        try await send(shareSkillRequest(botId: botId, name: name, scope: scope, stop: stop))
    }

    func skillUploadRequest(botId: String, install: Bool, files: [SkillUploadFile]) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        var request = try makeRequest("POST", "/api/bots/\(botId)/skill-upload",
                                      encodedBody: SkillUploadBody(mode: install ? "install" : "preview", files: files))
        // a 10 MB upload takes longer than a plain call
        request.timeoutInterval = max(request.timeoutInterval, 60)
        return request
    }

    /// `POST /api/bots/:id/skill-upload {mode: "preview"}`: what each file holds, nothing added.
    func previewSkillUpload(botId: String, files: [SkillUploadFile]) async throws -> [SkillUploadItem] {
        try await send(skillUploadRequest(botId: botId, install: false, files: files), as: SkillUploadPreviewAnswer.self)
            .items?.compactMap(\.value) ?? []
    }

    /// `POST /api/bots/:id/skill-upload {mode: "install"}`: the names added, switched off.
    func installSkillUpload(botId: String, files: [SkillUploadFile]) async throws -> [String] {
        try await send(skillUploadRequest(botId: botId, install: true, files: files), as: SkillUploadInstallAnswer.self).installed ?? []
    }

    func writtenCommandRequest(botId: String, name: String, description: String, instructions: String) throws -> URLRequest {
        guard Self.validRouteID(botId),
              let text = WrittenSkill.markdown(name: name, description: description, instructions: instructions)
        else { throw APIError.badURL }
        return try makeRequest("POST", "/api/bots/\(botId)/skill-template", body: [
            "name": name.trimmingCharacters(in: .whitespacesAndNewlines), "description": "", "warnings": [String](),
            "source": WrittenSkill.source, "text": text, "enabled": true,
        ])
    }

    /// `POST /api/bots/:id/skill-template`: the command as an ordinary skill, switched on.
    func saveWrittenCommand(botId: String, name: String, description: String, instructions: String) async throws {
        try await send(writtenCommandRequest(botId: botId, name: name, description: description, instructions: instructions))
    }
}
